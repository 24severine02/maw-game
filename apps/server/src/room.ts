import {
  chooseBotAction,
  createGame,
  DEFAULT_BOT,
  deckCountFor,
  getPlayerView,
  MAX_PLAYERS,
  reduce,
  type Action,
  type BotOptions,
  type GameState,
} from '@maw/engine';
import type { Ack, Announcement, LogEntry, MemberView, PlayerAction, RoomStatus, RoomView } from '@maw/protocol';
import { describe } from './describe.js';

export interface RoomOptions {
  /** Bots wait a random time in [min, max] ms before acting, so humans can follow. */
  botDelayMs: [number, number];
  /** Bots wait longer before calling out, so a human who forgot has a fair chance to press late. */
  botCallOutDelayMs: [number, number];
  /** Pause on the round results before the next round is dealt. */
  roundPauseMs: number;
  /** How long a disconnected player keeps their seat before a bot plays it (lobby: before removal). */
  reconnectGraceMs: number;
  /** Behaviour of the room's bots. Disconnected humans on autopilot use AUTOPILOT_BOT. */
  botOptions: BotOptions;
  /** Randomness for game seeds, bot choices and bot timing. */
  random: () => number;
  now: () => number;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  botDelayMs: [900, 1800],
  botCallOutDelayMs: [2000, 3200],
  roundPauseMs: 8000,
  reconnectGraceMs: 45_000,
  // Bots occasionally forget Maw/Mamaw (so humans get to call them out) and don't always catch you.
  botOptions: { callOutRate: 0.6, declareRate: 0.9, playRate: 1, latePressRate: 0.5 },
  random: Math.random,
  now: Date.now,
};

/** Plays an absent human's seat: never forgets Maw/Mamaw, but doesn't call others out on their behalf. */
export const AUTOPILOT_BOT: BotOptions = { ...DEFAULT_BOT, callOutRate: 0 };

export const MAX_NAME_LENGTH = 20;
const LOG_SIZE = 60;
const BOT_NAMES = ['Ada', 'Bix', 'Cleo', 'Dot', 'Ezra', 'Fen', 'Gus', 'Hana'];

export interface Member {
  id: string;
  name: string;
  token: string;
  isBot: boolean;
  connected: boolean;
  autopilot: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

type Fail = { ok: false; code: string; error: string };
const fail = (code: string, error: string): Fail => ({ ok: false, code, error });

/**
 * One game room: lobby membership, the authoritative GameState, timers
 * (Mamaw window, next round, reconnect grace) and bots. No socket code —
 * the transport subscribes via `onChange` and reads per-member `view()`s.
 */
export class Room {
  readonly id: string;
  status: RoomStatus = 'lobby';
  game: GameState | null = null;
  hostId: string | null = null;
  nextRoundAt: number | null = null;
  /** Called after every state change; the transport broadcasts views. */
  onChange: () => void = () => {};

  private readonly opts: RoomOptions;
  private readonly makeId: () => string;
  private members: Member[] = [];
  private log: LogEntry[] = [];
  private logSeq = 0;
  private announcement: Announcement | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string, makeId: () => string, options: Partial<RoomOptions> = {}) {
    this.id = id;
    this.makeId = makeId;
    this.opts = { ...DEFAULT_ROOM_OPTIONS, ...options };
  }

  // ---------- membership ----------

  getMember(id: string): Member | undefined {
    return this.members.find((m) => m.id === id);
  }

  memberByToken(token: string): Member | undefined {
    return this.members.find((m) => !m.isBot && m.token === token);
  }

  /** True when no human is connected (the room can be garbage-collected). */
  isAbandoned(): boolean {
    return !this.members.some((m) => !m.isBot && m.connected);
  }

  join(rawName: string): ({ ok: true; member: Member }) | Fail {
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
    if (!name) return fail('BAD_NAME', 'Please enter a nickname');
    if (this.status !== 'lobby') return fail('GAME_IN_PROGRESS', 'This game has already started');
    if (this.members.length >= MAX_PLAYERS) return fail('ROOM_FULL', `The room is full (${MAX_PLAYERS} players)`);
    const member: Member = {
      id: this.makeId(),
      name: this.uniqueName(name),
      token: this.makeId() + this.makeId(),
      isBot: false,
      connected: false,
      autopilot: false,
      graceTimer: null,
    };
    this.members.push(member);
    this.hostId ??= member.id;
    this.addLog(`${member.name} joined`);
    this.changed();
    return { ok: true, member };
  }

  /** A member's socket (re)connected. */
  connect(memberId: string): void {
    const m = this.getMember(memberId);
    if (!m) return;
    if (m.graceTimer) clearTimeout(m.graceTimer);
    m.graceTimer = null;
    const wasAway = m.autopilot;
    m.connected = true;
    m.autopilot = false;
    if (wasAway) this.addLog(`${m.name} is back`);
    this.ensureHost();
    this.afterChange();
  }

  /** A member's socket dropped: keep the seat for the grace period. */
  disconnect(memberId: string): void {
    const m = this.getMember(memberId);
    if (!m || !m.connected) return;
    m.connected = false;
    m.graceTimer = setTimeout(() => {
      m.graceTimer = null;
      if (this.status === 'lobby') {
        this.removeMember(m, `${m.name} left`);
      } else {
        m.autopilot = true;
        this.addLog(`${m.name} disconnected; a bot plays for them until they return`);
        this.ensureHost();
        this.afterChange();
      }
    }, this.opts.reconnectGraceMs);
    this.changed();
  }

  /** Explicit leave: lobby → seat removed; in game → bot takes over immediately. */
  leave(memberId: string): Ack {
    const m = this.getMember(memberId);
    if (!m) return fail('NOT_IN_ROOM', 'You are not in this room');
    if (m.graceTimer) clearTimeout(m.graceTimer);
    m.graceTimer = null;
    if (this.status === 'lobby') {
      this.removeMember(m, `${m.name} left`);
    } else {
      m.connected = false;
      m.autopilot = true;
      this.addLog(`${m.name} left; a bot plays for them`);
      this.ensureHost();
      this.afterChange();
    }
    return { ok: true };
  }

  addBot(byId: string): Ack {
    const check = this.hostLobbyCheck(byId);
    if (check) return check;
    if (this.members.length >= MAX_PLAYERS) return fail('ROOM_FULL', `The room is full (${MAX_PLAYERS} players)`);
    const used = new Set(this.members.map((m) => m.name));
    const base = BOT_NAMES.find((n) => !used.has(`🤖 ${n}`)) ?? 'Bot';
    const bot: Member = {
      id: this.makeId(),
      name: this.uniqueName(`🤖 ${base}`),
      token: '',
      isBot: true,
      connected: true,
      autopilot: false,
      graceTimer: null,
    };
    this.members.push(bot);
    this.addLog(`${bot.name} joined`);
    this.changed();
    return { ok: true };
  }

  /** Host removes a bot or another player from the lobby. */
  remove(byId: string, targetId: string): Ack {
    const check = this.hostLobbyCheck(byId);
    if (check) return check;
    const target = this.getMember(targetId);
    if (!target) return fail('NO_SUCH_PLAYER', 'That player is not in the room');
    if (target.id === byId) return fail('CANNOT_REMOVE_SELF', 'Use Leave to leave the room');
    this.removeMember(target, `${target.name} was removed`);
    return { ok: true };
  }

  start(byId: string): Ack {
    const check = this.hostLobbyCheck(byId);
    if (check) return check;
    if (this.members.length < 2) return fail('NOT_ENOUGH_PLAYERS', 'At least 2 players are needed (add a bot?)');
    const seed = Math.floor(this.opts.random() * 2 ** 31);
    const created = createGame({ playerIds: this.members.map((m) => m.id), seed });
    /* c8 ignore next -- membership rules above guarantee a valid setup */
    if (!created.ok) return fail(created.error.code, created.error.message);
    this.game = created.state;
    this.status = 'playing';
    const r = this.game.round;
    this.addLog(
      `Game started: ${r.seats.length} players, ${r.deckCount} deck${r.deckCount > 1 ? 's' : ''}` +
        `${r.isFinal ? ' (2 players: this round is the final)' : ''}. Starting card ` +
        `${r.top.card.rank}${{ S: '♠', H: '♥', D: '♦', C: '♣' }[r.top.card.suit]}. ${this.name(r.current)} starts.`,
    );
    this.afterChange();
    return { ok: true };
  }

  /** Back to the lobby after a finished game, keeping everyone still here. */
  reset(byId: string): Ack {
    if (byId !== this.hostId) return fail('NOT_HOST', 'Only the host can do that');
    if (this.status !== 'finished') return fail('WRONG_STATUS', 'The game is not finished');
    for (const m of this.members.filter((x) => !x.isBot && !x.connected)) this.dropMember(m);
    this.game = null;
    this.status = 'lobby';
    this.addLog('Back to the lobby');
    this.afterChange();
    return { ok: true };
  }

  // ---------- game ----------

  act(byId: string, action: PlayerAction): Ack {
    if (this.status !== 'playing' || !this.game) return fail('WRONG_STATUS', 'No game in progress');
    if (!this.getMember(byId)) return fail('NOT_IN_ROOM', 'You are not in this room');
    return this.dispatch({ ...action, playerId: byId, now: this.opts.now() } as Action);
  }

  private dispatch(action: Action): Ack {
    const before = this.game as GameState;
    const res = reduce(before, action);
    if (!res.ok) return fail(res.error.code, res.error.message);
    this.game = res.state;
    this.announce(before, action);
    for (const line of describe(before, action, res.state, (id) => this.name(id))) this.addLog(line);
    if (res.state.phase === 'gameOver') this.status = 'finished';
    this.afterChange();
    return { ok: true };
  }

  /** Re-arms all timers for the current state, then notifies listeners. */
  private afterChange(): void {
    this.clearGameTimers();
    const g = this.game;
    if (this.status === 'playing' && g) {
      const now = this.opts.now();
      if (g.phase === 'mamawWindow' && g.round.mamawWindow) {
        const deadline = g.round.mamawWindow.deadline;
        this.tickTimer = setTimeout(
          () => this.dispatch({ type: 'TICK', now: Math.max(deadline, this.opts.now()) }),
          Math.max(0, deadline - now),
        );
      }
      if (g.phase === 'roundOver') {
        this.nextRoundAt = now + this.opts.roundPauseMs;
        this.roundTimer = setTimeout(() => this.dispatch({ type: 'NEXT_ROUND', now: this.opts.now() }), this.opts.roundPauseMs);
      }
      this.scheduleBot();
    }
    this.changed();
  }

  /**
   * Picks the next automated move: a bot's call-out or late Maw/Mamaw first
   * (out of turn), else the current seat's move if it is automated.
   */
  private scheduleBot(): void {
    const g = this.game as GameState;
    const now = this.opts.now();
    const automated = this.members.filter((m) => (m.isBot || m.autopilot) && g.round.seats.includes(m.id));
    const outOfTurn: Action[] = [];
    for (const m of automated) {
      if (m.id === g.round.current && g.phase === 'playing') continue;
      const a = chooseBotAction(getPlayerView(g, m.id), now, this.opts.random, this.botOptionsFor(m));
      if (a && (a.type === 'CALL_OUT' || a.type === 'MAW' || a.type === 'MAMAW')) outOfTurn.push(a);
    }
    let chosen: Action | null = outOfTurn[Math.floor(this.opts.random() * outOfTurn.length)] ?? null;
    const current = this.getMember(g.round.current);
    if (!chosen && g.phase === 'playing' && current && (current.isBot || current.autopilot)) {
      chosen = chooseBotAction(getPlayerView(g, current.id), now, this.opts.random, this.botOptionsFor(current));
    }
    if (!chosen) return;
    const [min, max] = chosen.type === 'CALL_OUT' ? this.opts.botCallOutDelayMs : this.opts.botDelayMs;
    const action = chosen;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      // A stale move (e.g. a call-out after the window closed) must not stall the bots.
      if (!this.dispatch({ ...action, now: this.opts.now() }).ok) this.afterChange();
    }, min + this.opts.random() * (max - min));
  }

  private botOptionsFor(m: Member): BotOptions {
    return m.isBot ? this.opts.botOptions : AUTOPILOT_BOT;
  }

  private clearGameTimers(): void {
    for (const t of [this.tickTimer, this.roundTimer, this.botTimer]) if (t) clearTimeout(t);
    this.tickTimer = this.roundTimer = this.botTimer = null;
    this.nextRoundAt = null;
  }

  dispose(): void {
    this.clearGameTimers();
    for (const m of this.members) if (m.graceTimer) clearTimeout(m.graceTimer);
    this.onChange = () => {};
  }

  // ---------- views ----------

  view(memberId: string): RoomView {
    return {
      roomId: this.id,
      you: memberId,
      hostId: this.hostId ?? '',
      status: this.status,
      members: this.members.map(
        (m): MemberView => ({
          id: m.id,
          name: m.name,
          isHost: m.id === this.hostId,
          isBot: m.isBot,
          connected: m.connected,
          autopilot: m.autopilot,
        }),
      ),
      maxPlayers: MAX_PLAYERS,
      deckCount: deckCountFor(Math.max(2, this.members.length)),
      game: this.game ? getPlayerView(this.game, memberId) : null,
      nextRoundAt: this.nextRoundAt,
      serverNow: this.opts.now(),
      log: this.log.slice(),
      announcement: this.announcement,
    };
  }

  humanMembers(): Member[] {
    return this.members.filter((m) => !m.isBot);
  }

  // ---------- helpers ----------

  private hostLobbyCheck(byId: string): Fail | null {
    if (byId !== this.hostId) return fail('NOT_HOST', 'Only the host can do that');
    if (this.status !== 'lobby') return fail('WRONG_STATUS', 'Only possible in the lobby');
    return null;
  }

  private removeMember(m: Member, logText: string): void {
    this.dropMember(m);
    this.addLog(logText);
    this.ensureHost();
    this.changed();
  }

  private dropMember(m: Member): void {
    if (m.graceTimer) clearTimeout(m.graceTimer);
    this.members = this.members.filter((x) => x !== m);
  }

  /** Host = first connected, present human; keep the current host while they're connected or within grace. */
  private ensureHost(): void {
    const host = this.hostId ? this.getMember(this.hostId) : undefined;
    if (host && !host.autopilot) return;
    const next = this.members.find((m) => !m.isBot && m.connected && !m.autopilot);
    if (next) {
      this.hostId = next.id;
    } else if (!host) {
      this.hostId = this.members.find((m) => !m.isBot)?.id ?? null;
    }
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.members.map((m) => m.name));
    if (!taken.has(name)) return name;
    for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`;
  }

  private name(id: string): string {
    return this.getMember(id)?.name ?? '?';
  }

  /** Records a Maw, Mamaw or call-out (from `action`, just applied to `before`) for every screen. */
  private announce(before: GameState, action: Action): void {
    let kind: Announcement['kind'] | null = null;
    let targetId: string | null = null;
    if (action.type === 'PLAY' && action.say) kind = action.say;
    else if (action.type === 'MAW') kind = 'maw';
    else if (action.type === 'MAMAW') kind = 'mamaw';
    else if (action.type === 'CALL_OUT') {
      kind = 'callout';
      targetId = before.round.mamawWindow?.playerId ?? before.round.mawDebt?.playerId ?? null;
    }
    if (!kind || !('playerId' in action)) return;
    const id = (this.announcement?.id ?? 0) + 1;
    this.announcement = { id, kind, playerId: action.playerId, targetId, at: this.opts.now() };
  }

  private addLog(text: string): void {
    this.log.push({ id: ++this.logSeq, text });
    if (this.log.length > LOG_SIZE) this.log.shift();
  }

  private changed(): void {
    this.onChange();
  }
}
