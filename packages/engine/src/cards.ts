export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

/**
 * A physical card. `id` is unique within a round (two decks → two copies of
 * each rank/suit, distinguished by the deck index prefix).
 */
export interface Card {
  readonly id: string;
  readonly rank: Rank;
  readonly suit: Suit;
}

export const CARDS_PER_DECK = 52;
export const HAND_SIZE = 7;

/** Ranks whose effect a Jack copies (SPEC §3). */
export const SPECIAL_RANKS: readonly Rank[] = ['7', '8', '9', 'Q'];

export function isSpecialRank(rank: Rank): boolean {
  return SPECIAL_RANKS.includes(rank);
}

export function cardId(deck: number, rank: Rank, suit: Suit): string {
  return `${deck}:${rank}${suit}`;
}

/** Builds `deckCount` standard 52-card decks in a fixed (unshuffled) order. */
export function buildDeck(deckCount: number): Card[] {
  const cards: Card[] = [];
  for (let deck = 0; deck < deckCount; deck++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ id: cardId(deck, rank, suit), rank, suit });
      }
    }
  }
  return cards;
}

/** SPEC §1 / §5: 1 deck for 2 players, 2 decks for 3+. */
export function deckCountFor(playerCount: number): 1 | 2 {
  return playerCount >= 3 ? 2 : 1;
}

/** Penalty points for a card left in hand at round end (SPEC §5). */
export function cardPoints(rank: Rank): number {
  switch (rank) {
    case '7':
      return 14;
    case '8':
      return 16;
    case '9':
      return 18;
    case 'Q':
    case 'J':
      return 20;
    case '10':
    case 'K':
    case 'A':
      return 10;
    default:
      return Number(rank);
  }
}

export function handPoints(hand: readonly Card[]): number {
  return hand.reduce((sum, c) => sum + cardPoints(c.rank), 0);
}
