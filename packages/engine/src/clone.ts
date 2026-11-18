import type { Card } from './cards.js';
import type { GameState, PlayerId, RoundResult } from './types.js';

/**
 * Copy-on-write clone used by the reducer. Card and TopCard objects are
 * treated as immutable and shared; every container the reducer mutates
 * (arrays, hands, players, turn/maw/window records) is copied.
 * Much faster than structuredClone, which matters for bots and fuzzing.
 */
export function cloneState(s: GameState): GameState {
  const r = s.round;
  const hands: Record<PlayerId, Card[]> = {};
  for (const id of Object.keys(r.hands)) hands[id] = (r.hands[id] as Card[]).slice();
  return {
    ...s,
    players: s.players.map((p) => ({ ...p })),
    results: s.results.map(cloneResult),
    round: {
      ...r,
      seats: r.seats.slice(),
      hands,
      drawPile: r.drawPile.slice(),
      discard: r.discard.slice(),
      turn: { ...r.turn },
      mawDebt: r.mawDebt && { ...r.mawDebt },
      mamawWindow: r.mamawWindow && { ...r.mamawWindow },
    },
  };
}

export function cloneResult(res: RoundResult): RoundResult {
  return { ...res, points: { ...res.points }, eliminated: res.eliminated.slice() };
}
