import { isSpecialRank, type Card, type Rank, type Suit } from './cards.js';
import type { PlayerId, RoundState, TopCard } from './types.js';

/**
 * SPEC §2/§3: a card is playable if it matches the top card's (effective)
 * suit or rank, or is a Jack. Facing a pending draw, only a 7 or a Jack.
 */
export function isPlayable(card: Card, top: TopCard, pendingDraw: number): boolean {
  if (card.rank === 'J') return true;
  if (pendingDraw > 0) return card.rank === '7';
  return card.suit === top.suit || card.rank === top.rank;
}

/** Whether playing this card requires the player to choose a suit (Jack on a non-special). */
export function needsSuitChoice(card: Card, top: TopCard): boolean {
  return card.rank === 'J' && !isSpecialRank(top.rank);
}

/**
 * SPEC §3 Jack: on a special card it copies that rank with the Jack's own
 * suit; otherwise it stays a Jack and takes the chosen suit. A Jack on a Jack
 * copies whatever the lower Jack was acting as (assumption §6.4).
 */
export function effectiveTop(card: Card, top: TopCard, chosenSuit: Suit | undefined): TopCard {
  if (card.rank !== 'J') return { card, rank: card.rank, suit: card.suit };
  if (isSpecialRank(top.rank)) return { card, rank: top.rank, suit: card.suit };
  return { card, rank: 'J', suit: chosenSuit ?? card.suit };
}

/** Q/8/9 mean play again in the final; 9 always does. */
export function isPlayAgain(rank: Rank, isFinal: boolean): boolean {
  return rank === '9' || (isFinal && (rank === '8' || rank === 'Q'));
}

export function seatAfter(round: RoundState, from: PlayerId, steps: number): PlayerId {
  const n = round.seats.length;
  const i = round.seats.indexOf(from);
  const j = (((i + steps * round.direction) % n) + n) % n;
  return round.seats[j] as PlayerId;
}
