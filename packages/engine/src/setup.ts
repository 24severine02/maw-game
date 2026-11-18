import { buildDeck, deckCountFor, HAND_SIZE, type Card } from './cards.js';
import { seedRng, shuffle, type RngState } from './rng.js';
import { seatAfter } from './rules.js';
import type { GameState, PlayerId, Result, RoundState } from './types.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export interface NewGameOptions {
  /** Players in seat order. */
  playerIds: readonly PlayerId[];
  seed: number;
}

export function createGame(options: NewGameOptions): Result<GameState> {
  const ids = options.playerIds;
  if (ids.length < MIN_PLAYERS || ids.length > MAX_PLAYERS) {
    return err(`Maw needs ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${ids.length}`);
  }
  if (new Set(ids).size !== ids.length) return err('Player ids must be unique');
  if (ids.some((id) => id.length === 0)) return err('Player ids must be non-empty');

  const [round, rng] = dealRound(1, [...ids], ids[0] as PlayerId, seedRng(options.seed));
  return {
    ok: true,
    state: {
      players: ids.map((id) => ({ id, eliminated: false })),
      rng,
      phase: 'playing',
      round,
      results: [],
      winner: null,
    },
  };
}

function err(message: string): Result<never> {
  return { ok: false, error: { code: 'INVALID_SETUP', message } };
}

/**
 * Builds and shuffles the deck(s), deals 7 cards each starting with `first`,
 * turns up the starting card and applies its effect to the first player (SPEC §1).
 */
export function dealRound(
  number: number,
  seats: PlayerId[],
  first: PlayerId,
  rng: RngState,
): [RoundState, RngState] {
  const deckCount = deckCountFor(seats.length);
  const [drawPile, nextRng] = shuffle(buildDeck(deckCount), rng);

  const hands: Record<PlayerId, Card[]> = {};
  for (const id of seats) hands[id] = [];
  const startIdx = seats.indexOf(first);
  for (let i = 0; i < HAND_SIZE; i++) {
    for (let k = 0; k < seats.length; k++) {
      const id = seats[(startIdx + k) % seats.length] as PlayerId;
      (hands[id] as Card[]).push(drawPile.pop() as Card);
    }
  }
  const start = drawPile.pop() as Card;

  const round: RoundState = {
    number,
    isFinal: seats.length === 2,
    deckCount,
    seats,
    hands,
    drawPile,
    discard: [start],
    top: { card: start, rank: start.rank, suit: start.suit },
    direction: 1,
    current: first,
    pendingDraw: 0,
    turn: { hasDrawn: false, drawnCardId: null },
    awaitingSuitChoice: false,
    mawDebt: null,
    mamawWindow: null,
    winner: null,
  };
  applyStartingCard(round);
  return [round, nextRng];
}

/**
 * SPEC §1 + §6.3. Nobody played the starting card, so the "play again" meaning
 * (9 always, Q/8 in the final) has no effect.
 */
export function applyStartingCard(round: RoundState): void {
  const { rank } = round.top;
  if (rank === 'J') {
    round.awaitingSuitChoice = true;
  } else if (rank === '7') {
    round.pendingDraw = 2;
  } else if (!round.isFinal && rank === '8') {
    round.current = seatAfter(round, round.current, 1);
  } else if (!round.isFinal && rank === 'Q') {
    round.direction = -1;
  }
}
