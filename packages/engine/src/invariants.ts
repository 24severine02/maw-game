import { CARDS_PER_DECK, type Card } from './cards.js';
import type { GameState } from './types.js';

/**
 * Structural invariants every reachable state must satisfy. Returns a list of
 * violations (empty = OK). Used by the fuzz test; cheap enough for a server
 * to run in debug builds.
 */
export function checkInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const r = state.round;

  // Card conservation: every card of the round's deck(s) is in exactly one place.
  const all: Card[] = [...r.drawPile, ...r.discard, ...r.seats.flatMap((id) => r.hands[id] ?? [])];
  if (all.length !== r.deckCount * CARDS_PER_DECK) {
    errors.push(`card count ${all.length} !== ${r.deckCount * CARDS_PER_DECK}`);
  }
  if (new Set(all.map((c) => c.id)).size !== all.length) errors.push('duplicate card ids');
  if (Object.keys(r.hands).length !== r.seats.length) errors.push('hands for players not in the round');

  // Seats and players.
  const active = state.players.filter((p) => !p.eliminated).map((p) => p.id);
  if (r.deckCount !== (r.seats.length >= 3 ? 2 : 1)) errors.push('wrong deck count for seat count');
  if (r.isFinal !== (r.seats.length === 2)) errors.push('isFinal does not match seat count');
  if (state.phase === 'playing' || state.phase === 'mamawWindow') {
    if (active.join() !== r.seats.join()) errors.push('seats do not match non-eliminated players');
  }
  if (!r.seats.includes(r.current)) errors.push(`current player ${r.current} not seated`);

  // Discard pile and top card.
  const topCard = r.discard[r.discard.length - 1];
  if (!topCard || topCard.id !== r.top.card.id) errors.push('top does not match discard pile');
  if (r.top.card.rank !== 'J' && (r.top.rank !== r.top.card.rank || r.top.suit !== r.top.card.suit)) {
    errors.push('non-Jack top card has a modified identity');
  }

  // Turn state.
  if (r.pendingDraw < 0 || r.pendingDraw % 2 !== 0) errors.push(`bad pendingDraw ${r.pendingDraw}`);
  if (r.pendingDraw > 0 && r.top.rank !== '7') errors.push('pending draw without a 7 on top');
  if (r.pendingDraw > 0 && r.turn.hasDrawn) errors.push('pending draw after drawing');
  if (r.turn.drawnCardId !== null && !(r.hands[r.current] ?? []).some((c) => c.id === r.turn.drawnCardId)) {
    errors.push('drawn card not in current hand');
  }
  if (r.awaitingSuitChoice && r.top.card.rank !== 'J') errors.push('suit choice pending without a Jack on top');

  // Maw / Mamaw.
  if ((state.phase === 'mamawWindow') !== (r.mamawWindow !== null)) errors.push('mamawWindow/phase mismatch');
  if (r.mamawWindow && (r.hands[r.mamawWindow.playerId] ?? []).length !== 0) {
    errors.push('mamaw window for a player holding cards');
  }
  // A forgetter may draw before the next card is played (debt persists), but while they can
  // still press Maw they must be on exactly 1 card.
  const debtorCards = r.mawDebt ? (r.hands[r.mawDebt.playerId] ?? []).length : 1;
  if (r.mawDebt && (!r.mawDebt.callable ? debtorCards !== 1 : debtorCards < 1)) {
    errors.push('maw debt with an impossible hand size');
  }
  if (r.mawDebt && r.mamawWindow) errors.push('maw debt and mamaw window at once');

  // Round / game end.
  const over = state.phase === 'roundOver' || state.phase === 'gameOver';
  if (over !== (r.winner !== null)) errors.push('round winner/phase mismatch');
  if (r.winner !== null && (r.hands[r.winner] ?? []).length !== 0) errors.push('round winner holds cards');
  if ((state.phase === 'gameOver') !== (state.winner !== null)) errors.push('game winner/phase mismatch');
  if (state.winner !== null && active.join() !== state.winner) errors.push('game winner is not the only active player');
  if (state.phase === 'roundOver' && active.length < 2) errors.push('round over with fewer than 2 players left');

  return errors;
}
