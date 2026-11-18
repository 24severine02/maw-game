import type { Action, PlayerView } from '@maw/engine';

/** Omit that distributes over a union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * What a client sends to act in the game. The server fills in `playerId`
 * (from the socket's seat) and `now` (its own clock); clients cannot send
 * the system actions TICK or NEXT_ROUND.
 */
export type PlayerAction = DistributiveOmit<Exclude<Action, { type: 'TICK' | 'NEXT_ROUND' }>, 'playerId' | 'now'>;

export type RoomStatus = 'lobby' | 'playing' | 'finished';

export interface MemberView {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  /** A disconnected human whose seat is being played by a bot until they return. */
  autopilot: boolean;
}

export interface LogEntry {
  id: number;
  text: string;
}

/**
 * A Maw, Mamaw or call-out that just happened, shown big on every screen.
 * `id` increases with each announcement; `at` is server time.
 */
export interface Announcement {
  id: number;
  kind: 'maw' | 'mamaw' | 'callout';
  /** Who pressed the button. */
  playerId: string;
  /** For a call-out: the player who has to draw. */
  targetId: string | null;
  at: number;
}

/** Everything one client sees. Sent to each member individually after every change. */
export interface RoomView {
  roomId: string;
  /** The receiving member's id. */
  you: string;
  hostId: string;
  status: RoomStatus;
  /** Seat order. */
  members: MemberView[];
  maxPlayers: number;
  /** Deck count the game will start with, given the current members (SPEC §1). */
  deckCount: 1 | 2;
  /** The engine's PlayerView for `you`; null in the lobby. */
  game: PlayerView | null;
  /** Server time (ms) at which the next round is dealt, while the round is over. */
  nextRoundAt: number | null;
  /** Server clock when this view was sent; clients use it to correct countdowns. */
  serverNow: number;
  log: LogEntry[];
  /** The latest Maw/Mamaw/call-out (clients show it only if recent). */
  announcement: Announcement | null;
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; code: string; error: string };
export type AckFn<T extends object = object> = (result: Ack<T>) => void;

export interface Session {
  roomId: string;
  playerId: string;
  /** Secret used to reclaim the seat after a disconnect. */
  token: string;
}

export interface ClientToServerEvents {
  'room:create': (payload: { name: string }, ack: AckFn<Session>) => void;
  /** Join with a name (new seat) or with a token (reconnect to an existing seat). */
  'room:join': (payload: { roomId: string; name?: string; token?: string }, ack: AckFn<Session>) => void;
  'room:leave': (ack: AckFn) => void;
  'lobby:addBot': (ack: AckFn) => void;
  'lobby:remove': (payload: { playerId: string }, ack: AckFn) => void;
  'lobby:start': (ack: AckFn) => void;
  /** After a finished game: back to the lobby with the same people. */
  'lobby:reset': (ack: AckFn) => void;
  'game:action': (payload: { action: PlayerAction }, ack: AckFn) => void;
}

export interface ServerToClientEvents {
  'room:state': (view: RoomView) => void;
}
