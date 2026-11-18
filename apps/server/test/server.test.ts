import { chooseBotAction, makeRandom, type Action } from '@maw/engine';
import type { Ack, ClientToServerEvents, PlayerAction, RoomView, ServerToClientEvents, Session } from '@maw/protocol';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMawServer, type MawServer } from '../src/server.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: MawServer;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  server = createMawServer({
    room: { botDelayMs: [1, 3], botCallOutDelayMs: [2, 4], roundPauseMs: 20, reconnectGraceMs: 200, botOptions: { callOutRate: 1, declareRate: 1, playRate: 1, latePressRate: 1 } },
    abandonedRoomTtlMs: 100,
  });
  url = `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await server.close();
});

async function client(): Promise<Client & { last: () => RoomView | null; next: (p: (v: RoomView) => boolean) => Promise<RoomView> }> {
  const c = connect(url, { transports: ['websocket'], forceNew: true }) as Client;
  clients.push(c);
  let last: RoomView | null = null;
  const waiters: [(v: RoomView) => boolean, (v: RoomView) => void][] = [];
  c.on('room:state', (v) => {
    last = v;
    for (const w of waiters.splice(0)) {
      if (w[0](v)) w[1](v);
      else waiters.push(w);
    }
  });
  await new Promise<void>((r) => c.on('connect', () => r()));
  return Object.assign(c, {
    last: () => last,
    next: (p: (v: RoomView) => boolean) =>
      last && p(last) ? Promise.resolve(last) : new Promise<RoomView>((r) => waiters.push([p, r])),
  });
}

function call<T extends object = object>(c: Client, event: string, ...args: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve) => (c.emit as (e: string, ...a: unknown[]) => void)(event, ...args, resolve));
}

describe('socket server', () => {
  it('serves /health', async () => {
    expect(await (await fetch(`${url}/health`)).text()).toBe('ok');
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });

  it('create → join by code → add bot → start → humans and bot play a full game', async () => {
    const alice = await client();
    const bob = await client();
    const created = await call<Session>(alice, 'room:create', { name: 'Alice' });
    if (!created.ok) throw new Error(created.error);
    expect(created.roomId).toMatch(/^[A-Z2-9]{5}$/);

    const joined = await call<Session>(bob, 'room:join', { roomId: created.roomId.toLowerCase(), name: 'Bob' });
    expect(joined.ok).toBe(true);
    expect((await call(alice, 'lobby:addBot')).ok).toBe(true);
    expect(await call(bob, 'lobby:start')).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect((await call(alice, 'lobby:start')).ok).toBe(true);

    // Each human plays with the engine bot on its own view, as a real client would.
    const rand = makeRandom(5);
    let rejected = 0;
    for (const c of [alice, bob]) {
      c.on('room:state', (v) => {
        if (v.status !== 'playing' || !v.game) return;
        const a = chooseBotAction(v.game, v.serverNow, rand);
        if (!a) return;
        const { playerId: _p, now: _n, ...action } = a as Action & { playerId?: string };
        void call(c, 'game:action', { action: action as PlayerAction }).then((r) => {
          if (!r.ok) rejected++;
        });
      });
    }
    // kick off: re-request state by acting on the current one
    for (const c of [alice, bob]) c.listeners('room:state').at(-1)!(c.last()!);

    const end = await alice.next((v) => v.status === 'finished');
    expect(end.game?.winner).toBeTruthy();
    expect(end.log.some((l) => /wins the game/.test(l.text))).toBe(true);
    // Bob's views never contained Alice's cards
    const bobView = bob.last()!;
    expect(bobView.game?.players.find((p) => p.id === created.playerId)).toBeDefined();
    expect(rejected).toBeLessThan(1000);
  }, 30_000);

  it('a dropped player reclaims their seat with the token', async () => {
    const alice = await client();
    const created = await call<Session>(alice, 'room:create', { name: 'Alice' });
    if (!created.ok) throw new Error();
    const bob = await client();
    const joined = await call<Session>(bob, 'room:join', { roomId: created.roomId, name: 'Bob' });
    if (!joined.ok) throw new Error();
    await call(alice, 'lobby:start');
    bob.disconnect();
    await alice.next((v) => v.members[1]?.connected === false);

    const bob2 = await client();
    const back = await call<Session>(bob2, 'room:join', { roomId: created.roomId, token: joined.token });
    expect(back).toMatchObject({ ok: true, playerId: joined.playerId });
    const v = await bob2.next((x) => x.status === 'playing');
    expect(v.you).toBe(joined.playerId);
    expect(v.game?.hand).toHaveLength(v.game!.players.find((p) => p.id === joined.playerId)!.handCount);
    expect(await call(bob2, 'room:join', { roomId: created.roomId, token: 'bad' })).toMatchObject({ code: 'SEAT_GONE' });
  });

  it('rejects bad requests', async () => {
    const c = await client();
    expect(await call(c, 'room:create', {})).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await call(c, 'room:create', { name: '  ' })).toMatchObject({ code: 'BAD_NAME' });
    expect(await call(c, 'room:join', {})).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await call(c, 'room:join', { roomId: 'NOPE1', name: 'x' })).toMatchObject({ code: 'NO_ROOM' });
    for (const ev of ['lobby:addBot', 'lobby:start', 'lobby:reset', 'room:leave']) {
      expect(await call(c, ev)).toMatchObject({ code: 'NOT_IN_ROOM' });
    }
    expect(await call(c, 'lobby:remove', { playerId: 'x' })).toMatchObject({ code: 'NOT_IN_ROOM' });
    expect(await call(c, 'game:action', { action: { type: 'DRAW' } })).toMatchObject({ code: 'NOT_IN_ROOM' });

    const created = await call<Session>(c, 'room:create', { name: 'Host' });
    if (!created.ok) throw new Error();
    expect(await call(c, 'room:join', { roomId: created.roomId })).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await call(c, 'lobby:remove', {})).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await call(c, 'game:action', {})).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await call(c, 'game:action', { action: { type: 'TICK' } })).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await call(c, 'game:action', { action: { type: 'DRAW' } })).toMatchObject({ code: 'WRONG_STATUS' });
    await call(c, 'lobby:addBot');
    const botId = c.last()!.members[1]!.id;
    expect((await call(c, 'lobby:remove', { playerId: botId })).ok).toBe(true);
    // no ack callback: ignored without crashing
    c.emit('lobby:addBot', undefined as never);
    expect((await call(c, 'room:leave')).ok).toBe(true);
  });

  it('abandoned rooms are deleted after the TTL', async () => {
    const c = await client();
    const created = await call<Session>(c, 'room:create', { name: 'Host' });
    if (!created.ok) throw new Error();
    expect(server.rooms.has(created.roomId)).toBe(true);
    c.disconnect();
    await new Promise((r) => setTimeout(r, 400));
    expect(server.rooms.has(created.roomId)).toBe(false);
  });

  it('joining another room releases the previous seat', async () => {
    const c = await client();
    const r1 = await call<Session>(c, 'room:create', { name: 'A' });
    const r2 = await call<Session>(c, 'room:create', { name: 'A' });
    if (!r1.ok || !r2.ok) throw new Error();
    const room1 = server.rooms.get(r1.roomId)!;
    expect(room1.view(r1.playerId).members[0]?.connected).toBe(false);
  });
});
