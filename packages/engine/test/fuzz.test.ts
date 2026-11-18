import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  chooseBotAction,
  createGame,
  getPlayerView,
  legalActionsFor,
  makeRandom,
  MAMAW_WINDOW_MS,
  reduce,
  type Action,
  type BotOptions,
  type GameState,
} from '../src/index.js';

const GAMES = 1000;
const MAX_STEPS = 20_000;
/** Games whose every legal move is also replayed through the reducer (slower). */
const DEEP_CHECK_GAMES = 50;

/**
 * Plays a full game with bots. Bots forget Maw/Mamaw and draw voluntarily
 * sometimes so call-outs, windows and reshuffles all get exercised.
 */
function playGame(seed: number): { state: GameState; steps: number; stats: Record<string, number> } {
  const rand = makeRandom(seed ^ 0x9e3779b9);
  const players = 2 + (seed % 7);
  const created = createGame({ playerIds: Array.from({ length: players }, (_, i) => `p${i}`), seed });
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  const opts: BotOptions = { callOutRate: 0.5, declareRate: 0.85, playRate: 0.9, latePressRate: 0.3 };
  const stats: Record<string, number> = {};
  let now = 0;
  const deep = seed < DEEP_CHECK_GAMES;

  const apply = (action: Action) => {
    const before = deep ? JSON.stringify(state) : '';
    const res = reduce(state, action);
    if (!res.ok) {
      throw new Error(`seed ${seed}: legal ${JSON.stringify(action)} rejected: ${res.error.code} ${res.error.message}`);
    }
    if (deep && JSON.stringify(state) !== before) throw new Error(`seed ${seed}: reduce mutated its input (${action.type})`);
    const violations = checkInvariants(res.state);
    if (violations.length > 0) throw new Error(`seed ${seed} after ${action.type}: ${violations.join('; ')}`);
    stats[action.type] = (stats[action.type] ?? 0) + 1;
    state = res.state;
  };

  for (let steps = 0; steps < MAX_STEPS; steps++) {
    now += 1000;
    if (state.phase === 'gameOver') return { state, steps, stats };
    if (state.phase === 'roundOver') {
      apply({ type: 'NEXT_ROUND', now });
      continue;
    }

    if (deep) {
      for (const pid of state.round.seats) {
        for (const a of legalActionsFor(state, pid, now)) {
          const res = reduce(state, a);
          if (!res.ok) throw new Error(`seed ${seed}: legal ${JSON.stringify(a)} rejected: ${res.error.code}`);
        }
      }
      // views never leak other hands
      for (const pid of state.round.seats) {
        const json = JSON.stringify(getPlayerView(state, pid));
        for (const other of state.round.seats) {
          if (other === pid) continue;
          for (const c of state.round.hands[other] ?? []) {
            if (json.includes(`"${c.id}"`)) throw new Error(`view of ${pid} leaks ${other}'s ${c.id}`);
          }
        }
      }
    }

    // Someone forgot: the others may call out, or the forgetter may press late — in
    // random seat order. Only ask when that is possible at all: building every view
    // each step is the slow part.
    const r = state.round;
    const debtor = r.mamawWindow?.playerId ?? (r.mawDebt?.callable ? r.mawDebt.playerId : null);
    const racers = debtor === null ? [] : r.seats.slice();
    let acted = false;
    for (const pid of racers.sort(() => rand() - 0.5)) {
      const a = chooseBotAction(getPlayerView(state, pid), now, rand, opts);
      if (a && (a.type === 'CALL_OUT' || a.type === 'MAMAW' || (a.type === 'MAW' && pid === debtor))) {
        apply(a);
        acted = true;
        break;
      }
    }
    if (acted) continue;

    if (state.phase === 'mamawWindow') {
      apply({ type: 'TICK', now: now + MAMAW_WINDOW_MS });
      continue;
    }
    const a = chooseBotAction(getPlayerView(state, state.round.current), now, rand, opts);
    if (!a) throw new Error(`seed ${seed}: current player ${state.round.current} has no move (deadlock)`);
    apply(a);
  }
  throw new Error(`seed ${seed}: game did not finish in ${MAX_STEPS} steps`);
}

describe('fuzz: random bot games', () => {
  it(`plays ${GAMES} full games without errors or invariant violations`, () => {
    const totals: Record<string, number> = {};
    let rounds = 0;
    let maxSteps = 0;
    for (let seed = 0; seed < GAMES; seed++) {
      const { state, steps, stats } = playGame(seed);
      expect(state.phase).toBe('gameOver');
      expect(state.players.filter((p) => !p.eliminated).map((p) => p.id)).toEqual([state.winner]);
      expect(state.results.at(-1)?.winner).toBe(state.winner);
      rounds += state.results.length;
      maxSteps = Math.max(maxSteps, steps);
      for (const [k, v] of Object.entries(stats)) totals[k] = (totals[k] ?? 0) + v;
    }
    // Every kind of action actually happened somewhere in the run.
    for (const t of ['PLAY', 'DRAW', 'PASS', 'MAW', 'MAMAW', 'CALL_OUT', 'CHOOSE_SUIT', 'TICK', 'NEXT_ROUND']) {
      expect(totals[t], t).toBeGreaterThan(0);
    }
    expect(rounds).toBeGreaterThan(GAMES);
    expect(maxSteps).toBeLessThan(MAX_STEPS);
  }, 120_000);
});
