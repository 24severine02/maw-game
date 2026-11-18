import { checkInvariants, makeRandom, type BotOptions } from '@maw/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type RoomOptions } from '../src/room.js';

let seq = 0;
const makeId = () => `id${++seq}`;

function newRoom(opts: Partial<RoomOptions> = {}): Room {
  return new Room('ROOM1', makeId, {
    random: makeRandom(1),
    botDelayMs: [100, 200],
    botCallOutDelayMs: [200, 300],
    roundPauseMs: 1000,
    reconnectGraceMs: 5000,
    ...opts,
  });
}

/** Host + n bots, started, host disconnected so bots (and autopilot) play everything. */
function botGame(bots: number, botOptions?: BotOptions, seed = 1): Room {
  const room = newRoom({ random: makeRandom(seed), ...(botOptions && { botOptions }) });
  const host = join(room, 'Host');
  for (let i = 0; i < bots; i++) expect(room.addBot(host).ok).toBe(true);
  expect(room.start(host).ok).toBe(true);
  room.leave(host);
  return room;
}

function join(room: Room, name: string): string {
  const res = room.join(name);
  if (!res.ok) throw new Error(res.error);
  room.connect(res.member.id);
  return res.member.id;
}

function runToEnd(room: Room, maxMs = 3_600_000): void {
  for (let t = 0; t < maxMs && room.status === 'playing'; t += 500) {
    vi.advanceTimersByTime(500);
    expect(checkInvariants(room.game!)).toEqual([]);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe('lobby', () => {
  it('first joiner is host; names are trimmed, required and made unique', () => {
    const room = newRoom();
    const a = join(room, '  Alice  ');
    const b = join(room, 'Alice');
    expect(room.hostId).toBe(a);
    expect(room.view(a).members.map((m) => [m.name, m.isHost])).toEqual([
      ['Alice', true],
      ['Alice 2', false],
    ]);
    expect(room.join('   ')).toMatchObject({ ok: false, code: 'BAD_NAME' });
    expect(room.getMember(b)?.token).toBeTruthy();
    expect(room.memberByToken(room.getMember(b)!.token)?.id).toBe(b);
  });

  it('caps the room at 8 and reports the deck count for the current size', () => {
    const room = newRoom();
    const host = join(room, 'H');
    expect(room.view(host).deckCount).toBe(1);
    room.addBot(host);
    expect(room.view(host).deckCount).toBe(1);
    room.addBot(host);
    expect(room.view(host).deckCount).toBe(2);
    for (let i = 0; i < 5; i++) room.addBot(host);
    expect(room.view(host).members).toHaveLength(8);
    expect(room.addBot(host)).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    expect(room.join('Late')).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    expect(new Set(room.view(host).members.map((m) => m.name)).size).toBe(8);
  });

  it('only the host can add/remove bots and start; at least 2 players', () => {
    const room = newRoom();
    const host = join(room, 'H');
    const guest = join(room, 'G');
    expect(room.addBot(guest)).toMatchObject({ code: 'NOT_HOST' });
    expect(room.start(guest)).toMatchObject({ code: 'NOT_HOST' });
    expect(room.remove(guest, host)).toMatchObject({ code: 'NOT_HOST' });
    expect(room.remove(host, host)).toMatchObject({ code: 'CANNOT_REMOVE_SELF' });
    expect(room.remove(host, 'nobody')).toMatchObject({ code: 'NO_SUCH_PLAYER' });
    expect(room.remove(host, guest).ok).toBe(true);
    expect(room.start(host)).toMatchObject({ code: 'NOT_ENOUGH_PLAYERS' });
    room.addBot(host);
    expect(room.start(host).ok).toBe(true);
    expect(room.status).toBe('playing');
    expect(room.join('Late')).toMatchObject({ code: 'GAME_IN_PROGRESS' });
    expect(room.addBot(host)).toMatchObject({ code: 'WRONG_STATUS' });
  });

  it('host leaving the lobby passes host to the next human; disconnect grace removes seats', () => {
    const room = newRoom();
    const a = join(room, 'A');
    const b = join(room, 'B');
    room.leave(a);
    expect(room.hostId).toBe(b);
    expect(room.leave('ghost')).toMatchObject({ code: 'NOT_IN_ROOM' });
    const c = join(room, 'C');
    room.disconnect(c);
    vi.advanceTimersByTime(4999);
    expect(room.getMember(c)).toBeDefined();
    room.connect(c); // back in time
    room.disconnect(c);
    vi.advanceTimersByTime(5000);
    expect(room.getMember(c)).toBeUndefined();
    expect(room.isAbandoned()).toBe(false);
    room.leave(b);
    expect(room.isAbandoned()).toBe(true);
    expect(room.hostId).toBeNull();
  });
});

describe('game', () => {
  it('start deals a game; each member sees only their own hand', () => {
    const room = newRoom();
    const a = join(room, 'A');
    const b = join(room, 'B');
    room.start(a);
    const va = room.view(a);
    const vb = room.view(b);
    expect(va.game?.hand).toHaveLength(7);
    expect(JSON.stringify(va)).not.toContain(vb.game!.hand[0]!.id);
    expect(va.log.at(-1)?.text).toMatch(/Game started: 2 players, 1 deck \(2 players: this round is the final\)/);
  });

  it('act fills in playerId and now; engine errors are passed through', () => {
    const room = newRoom();
    const a = join(room, 'A');
    const b = join(room, 'B');
    expect(room.act(a, { type: 'DRAW' })).toMatchObject({ code: 'WRONG_STATUS' });
    room.start(a);
    const current = room.game!.round.current;
    const other = current === a ? b : a;
    expect(room.act(other, { type: 'DRAW' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(room.act('ghost', { type: 'DRAW' })).toMatchObject({ code: 'NOT_IN_ROOM' });
    if (room.game!.round.awaitingSuitChoice) room.act(current, { type: 'CHOOSE_SUIT', suit: 'H' });
    expect(room.act(current, { type: 'DRAW' }).ok).toBe(true);
    expect(room.view(a).log.some((l) => /drew/.test(l.text))).toBe(true);
  });

  it('bots play a whole game to the end (host left → autopilot)', () => {
    const room = botGame(4);
    runToEnd(room);
    expect(room.status).toBe('finished');
    expect(room.game?.winner).toBeTruthy();
    expect(room.view('x').log.at(-1)?.text).toMatch(/wins the game/);
    expect(room.view('x').members[0]).toMatchObject({ name: 'Host', autopilot: true });
  });

  it('forgetful bots trigger Mamaw windows; the server closes them with TICK', () => {
    let windows = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const room = botGame(2, { callOutRate: 0, declareRate: 0, playRate: 1, latePressRate: 0 }, seed);
      room.onChange = () => {
        if (room.game?.phase === 'mamawWindow' && /forgot to press Mamaw/.test(room.view('x').log.at(-1)!.text)) windows++;
      };
      runToEnd(room);
      expect(room.status).toBe('finished');
    }
    expect(windows).toBeGreaterThan(0);
  });

  it('bots call out forgetters', () => {
    const logs: string[] = [];
    for (let seed = 1; seed <= 4; seed++) {
      const room = botGame(3, { callOutRate: 1, declareRate: 0.5, playRate: 1, latePressRate: 0 }, seed);
      room.onChange = () => logs.push(room.view('x').log.at(-1)!.text);
      runToEnd(room);
      expect(room.status).toBe('finished');
    }
    expect(logs.some((t) => /called out/.test(t))).toBe(true);
  });

  it('every Maw, Mamaw and call-out is announced; bots sometimes press late', () => {
    const seen = new Map<string, number>();
    const logs: string[] = [];
    for (let seed = 1; seed <= 4; seed++) {
      const room = botGame(3, { callOutRate: 0.5, declareRate: 0.5, playRate: 1, latePressRate: 0.5 }, seed);
      let lastId = 0;
      room.onChange = () => {
        const v = room.view('x');
        logs.push(...v.log.slice(-3).map((l) => l.text));
        const a = v.announcement;
        if (!a || a.id === lastId) return;
        expect(a.id).toBe(lastId + 1);
        lastId = a.id;
        seen.set(a.kind, (seen.get(a.kind) ?? 0) + 1);
        if (a.kind === 'callout') {
          expect(a.targetId).toBeTruthy();
          expect(a.targetId).not.toBe(a.playerId);
        } else expect(a.targetId).toBeNull();
      };
      runToEnd(room);
      expect(room.status).toBe('finished');
    }
    expect([...seen.keys()].sort()).toEqual(['callout', 'mamaw', 'maw']);
    expect(logs.some((t) => /Just in time/.test(t))).toBe(true);
  });

  it('between rounds the next round is dealt after the pause', () => {
    const room = botGame(3);
    let sawPause = false;
    for (let i = 0; i < 20_000 && room.status === 'playing'; i++) {
      vi.advanceTimersByTime(100);
      if (room.game?.phase === 'roundOver') {
        sawPause = true;
        expect(room.view('x').nextRoundAt).toBeGreaterThan(Date.now());
        vi.advanceTimersByTime(1000);
        expect(room.game.phase).not.toBe('roundOver');
        break;
      }
    }
    expect(sawPause).toBe(true);
  });

  it('a disconnected player is replaced by autopilot after the grace period and returns on reconnect', () => {
    const room = newRoom({ botDelayMs: [100, 100] });
    const a = join(room, 'A');
    const b = join(room, 'B');
    room.start(a);
    room.disconnect(b);
    room.disconnect(b); // idempotent
    expect(room.view(a).members[1]).toMatchObject({ connected: false, autopilot: false });
    vi.advanceTimersByTime(5000);
    expect(room.view(a).members[1]).toMatchObject({ autopilot: true });
    room.connect(b);
    expect(room.view(a).members[1]).toMatchObject({ connected: true, autopilot: false });
    expect(room.view(a).log.at(-1)?.text).toBe('B is back');
  });

  it('host on autopilot hands host to a connected human; reset returns to the lobby', () => {
    const room = newRoom();
    const a = join(room, 'A');
    const b = join(room, 'B');
    room.addBot(a);
    room.start(a);
    room.leave(a);
    expect(room.hostId).toBe(b);
    expect(room.reset(b)).toMatchObject({ code: 'WRONG_STATUS' });
    room.leave(b);
    runToEnd(room);
    expect(room.status).toBe('finished');
    room.connect(b);
    expect(room.reset(a)).toMatchObject({ code: 'NOT_HOST' });
    expect(room.reset(b).ok).toBe(true);
    expect(room.status).toBe('lobby');
    expect(room.game).toBeNull();
    // A left for good and is dropped; the bot stays
    expect(room.view(b).members.map((m) => m.isBot)).toEqual([false, true]);
    expect(room.start(b).ok).toBe(true);
  });

  it('dispose stops all timers', () => {
    const room = botGame(2);
    const changes = vi.fn();
    room.onChange = changes;
    room.dispose();
    vi.advanceTimersByTime(60_000);
    expect(changes).not.toHaveBeenCalled();
  });
});
