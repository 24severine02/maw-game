import { randomBytes, randomInt } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '@maw/protocol';
import { Server, type Socket } from 'socket.io';
import { Room, type RoomOptions } from './room.js';

export interface MawServerOptions {
  /** Allowed browser origins for Socket.io CORS; `true` reflects any origin (dev). */
  corsOrigin: string[] | true;
  room: Partial<RoomOptions>;
  /** Delete a room this long after its last human disconnects. */
  abandonedRoomTtlMs: number;
}

const DEFAULTS: MawServerOptions = { corsOrigin: true, room: {}, abandonedRoomTtlMs: 10 * 60_000 };

interface SocketData {
  roomId?: string;
  playerId?: string;
}
type MawSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Room codes avoid look-alike characters (0/O, 1/I/L). */
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = (len: number) => Array.from({ length: len }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
const randomId = () => randomBytes(6).toString('base64url');

export interface MawServer {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  rooms: Map<string, Room>;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

/**
 * Authoritative game server: rooms in memory, one Socket.io connection per
 * player. Every change is pushed to each member as their own RoomView, so a
 * client never receives another player's hand.
 */
export function createMawServer(options: Partial<MawServerOptions> = {}): MawServer {
  const opts = { ...DEFAULTS, ...options };
  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    res.writeHead(404).end();
  });
  const io: MawServer['io'] = new Server(http, { cors: { origin: opts.corsOrigin } });
  const rooms = new Map<string, Room>();
  /** `${roomId}:${playerId}` → socket id currently holding that seat. */
  const seatSockets = new Map<string, string>();
  const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const broadcast = (room: Room) => {
    for (const m of room.humanMembers()) {
      const sid = seatSockets.get(`${room.id}:${m.id}`);
      if (sid) io.to(sid).emit('room:state', room.view(m.id));
    }
  };

  const createRoom = (): Room => {
    let id = randomCode(5);
    while (rooms.has(id)) id = randomCode(5);
    const room = new Room(id, randomId, opts.room);
    room.onChange = () => broadcast(room);
    rooms.set(id, room);
    return room;
  };

  /** Schedules deletion of a room nobody is connected to; cancelled if someone comes back. */
  const checkAbandoned = (room: Room) => {
    const existing = cleanupTimers.get(room.id);
    if (existing) clearTimeout(existing);
    cleanupTimers.delete(room.id);
    if (!room.isAbandoned()) return;
    cleanupTimers.set(
      room.id,
      setTimeout(() => {
        cleanupTimers.delete(room.id);
        if (!room.isAbandoned()) return;
        room.dispose();
        rooms.delete(room.id);
      }, opts.abandonedRoomTtlMs),
    );
  };

  /** Detach a socket from whatever seat it holds. */
  const unbind = (socket: MawSocket) => {
    const { roomId, playerId } = socket.data;
    socket.data = {};
    if (!roomId || !playerId) return;
    const key = `${roomId}:${playerId}`;
    if (seatSockets.get(key) !== socket.id) return;
    seatSockets.delete(key);
    const room = rooms.get(roomId);
    if (!room) return;
    room.disconnect(playerId);
    checkAbandoned(room);
  };

  const bind = (socket: MawSocket, room: Room, playerId: string) => {
    if (socket.data.roomId !== room.id || socket.data.playerId !== playerId) unbind(socket);
    const key = `${room.id}:${playerId}`;
    seatSockets.set(key, socket.id); // a newer tab takes over the seat
    socket.data = { roomId: room.id, playerId };
    room.connect(playerId);
    checkAbandoned(room);
  };

  io.on('connection', (socket: MawSocket) => {
    /** Wraps a handler: validates the ack callback and turns exceptions into error acks. */
    const handle =
      <A extends unknown[]>(fn: (...args: A) => Ack) =>
      (...args: [...A, unknown]) => {
        const ack = args[args.length - 1];
        if (typeof ack !== 'function') return;
        try {
          (ack as (r: Ack) => void)(fn(...(args.slice(0, -1) as A)));
        } catch (e) {
          (ack as (r: Ack) => void)({ ok: false, code: 'SERVER_ERROR', error: (e as Error).message });
        }
      };

    const seat = (): { room: Room; playerId: string } | null => {
      const { roomId, playerId } = socket.data;
      const room = roomId ? rooms.get(roomId) : undefined;
      if (!room || !playerId || !room.getMember(playerId)) return null;
      return { room, playerId };
    };
    const notInRoom: Ack = { ok: false, code: 'NOT_IN_ROOM', error: 'Join a room first' };

    socket.on(
      'room:create',
      handle((payload: { name?: unknown }) => {
        if (typeof payload?.name !== 'string') return { ok: false, code: 'BAD_REQUEST', error: 'name is required' };
        const room = createRoom();
        const joined = room.join(payload.name);
        if (!joined.ok) {
          rooms.delete(room.id);
          return joined;
        }
        bind(socket, room, joined.member.id);
        return { ok: true, roomId: room.id, playerId: joined.member.id, token: joined.member.token };
      }),
    );

    socket.on(
      'room:join',
      handle((payload: { roomId?: unknown; name?: unknown; token?: unknown }) => {
        if (typeof payload?.roomId !== 'string') return { ok: false, code: 'BAD_REQUEST', error: 'roomId is required' };
        const room = rooms.get(payload.roomId.toUpperCase());
        if (!room) return { ok: false, code: 'NO_ROOM', error: 'This room does not exist (or has expired)' };
        if (typeof payload.token === 'string' && payload.token) {
          const member = room.memberByToken(payload.token);
          if (member) {
            bind(socket, room, member.id);
            return { ok: true, roomId: room.id, playerId: member.id, token: member.token };
          }
          if (typeof payload.name !== 'string') {
            return { ok: false, code: 'SEAT_GONE', error: 'Your seat in this room is no longer available' };
          }
        }
        if (typeof payload.name !== 'string') return { ok: false, code: 'BAD_REQUEST', error: 'name is required' };
        const joined = room.join(payload.name);
        if (!joined.ok) return joined;
        bind(socket, room, joined.member.id);
        return { ok: true, roomId: room.id, playerId: joined.member.id, token: joined.member.token };
      }),
    );

    socket.on(
      'room:leave',
      handle(() => {
        const s = seat();
        if (!s) return notInRoom;
        seatSockets.delete(`${s.room.id}:${s.playerId}`);
        socket.data = {};
        const res = s.room.leave(s.playerId);
        checkAbandoned(s.room);
        return res;
      }),
    );

    socket.on('lobby:addBot', handle(() => seat()?.room.addBot(seat()!.playerId) ?? notInRoom));
    socket.on(
      'lobby:remove',
      handle((payload: { playerId?: unknown }) => {
        const s = seat();
        if (!s) return notInRoom;
        if (typeof payload?.playerId !== 'string') return { ok: false, code: 'BAD_REQUEST', error: 'playerId is required' };
        return s.room.remove(s.playerId, payload.playerId);
      }),
    );
    socket.on('lobby:start', handle(() => seat()?.room.start(seat()!.playerId) ?? notInRoom));
    socket.on('lobby:reset', handle(() => seat()?.room.reset(seat()!.playerId) ?? notInRoom));
    socket.on(
      'game:action',
      handle((payload: { action?: unknown }) => {
        const s = seat();
        if (!s) return notInRoom;
        const action = payload?.action;
        if (typeof action !== 'object' || action === null || typeof (action as { type?: unknown }).type !== 'string') {
          return { ok: false, code: 'BAD_REQUEST', error: 'action is required' };
        }
        const type = (action as { type: string }).type;
        if (type === 'TICK' || type === 'NEXT_ROUND') return { ok: false, code: 'BAD_REQUEST', error: 'Not a player action' };
        // playerId/now are always set by the server, overriding anything the client sent.
        return s.room.act(s.playerId, action as Parameters<Room['act']>[1]);
      }),
    );

    socket.on('disconnect', () => unbind(socket));
  });

  return {
    http,
    io,
    rooms,
    listen: (port, host) =>
      new Promise((resolve) => {
        http.listen(port, host, () => {
          const addr = http.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      }),
    close: async () => {
      for (const t of cleanupTimers.values()) clearTimeout(t);
      for (const room of rooms.values()) room.dispose();
      rooms.clear();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
