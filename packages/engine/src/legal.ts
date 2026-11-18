import { SUITS } from './cards.js';
import { isPlayable, needsSuitChoice } from './rules.js';
import type { Action, Declaration, GameState, PlayerId } from './types.js';
import { getPlayerView, type PlayerView } from './view.js';

/**
 * Every player action `view.viewer` may legally take right now, stamped with `now`.
 * Works from the PlayerView alone, so bots and clients use the exact same
 * rules without seeing hidden information. System actions (TICK, NEXT_ROUND)
 * are not included.
 *
 * Declarations: for a play leaving 1 (or 0) cards, both the correct
 * Maw (Mamaw) and the "forgot to press" variant are legal moves; a player
 * who forgot can then still press MAW (or MAMAW in their window) late.
 */
export function getLegalActions(view: PlayerView, now: number): Action[] {
  const me = view.viewer;
  const r = view.round;
  if (view.isSpectator) return [];
  const actions: Action[] = [];

  if (view.phase === 'mamawWindow') {
    if (r.mamawWindow && now < r.mamawWindow.deadline) {
      actions.push({ type: r.mamawWindow.playerId === me ? 'MAMAW' : 'CALL_OUT', playerId: me, now });
    }
    return actions;
  }
  if (view.phase !== 'playing') return actions;

  if (r.mawDebt?.playerId === me) {
    actions.push({ type: 'MAW', playerId: me, now });
  } else if (r.mawDebt?.callable) {
    actions.push({ type: 'CALL_OUT', playerId: me, now });
  }
  if (r.current !== me) return actions;

  if (r.awaitingSuitChoice) {
    for (const suit of SUITS) actions.push({ type: 'CHOOSE_SUIT', playerId: me, suit, now });
    return actions;
  }
  const candidates = r.currentHasDrawn ? view.hand.filter((c) => c.id === r.drawnCardId) : view.hand;
  const remaining = view.hand.length - 1;
  const says: (Declaration | undefined)[] =
    remaining === 1 ? [undefined, 'maw'] : remaining === 0 ? [undefined, 'mamaw'] : [undefined];
  for (const card of candidates) {
    if (!isPlayable(card, r.top, r.pendingDraw)) continue;
    const suits = needsSuitChoice(card, r.top) ? SUITS : [undefined];
    for (const chosenSuit of suits) {
      for (const say of says) {
        actions.push({
          type: 'PLAY',
          playerId: me,
          cardId: card.id,
          ...(chosenSuit !== undefined && { chosenSuit }),
          ...(say !== undefined && { say }),
          now,
        });
      }
    }
  }

  if (r.currentHasDrawn) actions.push({ type: 'PASS', playerId: me, now });
  else actions.push({ type: 'DRAW', playerId: me, now });
  return actions;
}

/** Convenience: legal actions for `playerId` computed from the full state. */
export function legalActionsFor(state: GameState, playerId: PlayerId, now: number): Action[] {
  return getLegalActions(getPlayerView(state, playerId), now);
}
