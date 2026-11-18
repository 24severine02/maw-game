import { expect } from 'vitest';
import {
  buildDeck,
  checkInvariants,
  deckCountFor,
  reduce,
  type Action,
  type Card,
  type ErrorCode,
  type GameState,
  type Rank,
  type Suit,
} from '../src/index.js';

/** Parses a card code like "7H", "10S", "JD" into rank/suit. */
export function parse(code: string): { rank: Rank; suit: Suit } {
  return { rank: code.slice(0, -1) as Rank, suit: code.slice(-1) as Suit };
}

export interface ScenarioOptions {
  /** Seat order; default ['a', 'b', 'c']. */
  players?: string[];
  eliminated?: string[];
  hands: Record<string, string[]>;
  /** Face-up top card code. */
  top: string;
  /** Effective identity of the top card (for a Jack acting as something else). */
  topAs?: string;
  /** Cards on top of the draw pile, first = drawn first. */
  draw?: string[];
  /** Extra cards buried in the discard pile under the top card. */
  discard?: string[];
  /** Where unassigned cards go (default: bottom of the draw pile). */
  rest?: 'draw' | 'discard' | { hand: string };
  current?: string;
  direction?: 1 | -1;
  pendingDraw?: number;
  rng?: number;
}

/**
 * Builds a valid mid-round GameState with exact hands and piles.
 * All cards of the deck(s) are accounted for so card conservation holds.
 */
export function scenario(o: ScenarioOptions): GameState {
  const players = o.players ?? ['a', 'b', 'c'];
  const eliminated = o.eliminated ?? [];
  const seats = players.filter((p) => !eliminated.includes(p));
  const deckCount = deckCountFor(seats.length);
  const pool = buildDeck(deckCount);
  const take = (code: string): Card => {
    const { rank, suit } = parse(code);
    const i = pool.findIndex((c) => c.rank === rank && c.suit === suit);
    if (i < 0) throw new Error(`No ${code} left in the deck`);
    return pool.splice(i, 1)[0] as Card;
  };

  const hands: Record<string, Card[]> = {};
  for (const id of seats) hands[id] = (o.hands[id] ?? []).map(take);
  const topCard = take(o.top);
  const buried = (o.discard ?? []).map(take);
  const drawTop = (o.draw ?? []).map(take);
  const rest = o.rest ?? 'draw';
  let drawPile = [...drawTop].reverse();
  let discard = [...buried, topCard];
  if (rest === 'draw') drawPile = [...pool, ...drawPile];
  else if (rest === 'discard') discard = [...pool, ...buried, topCard];
  else (hands[rest.hand] as Card[]).push(...pool);

  const as = parse(o.topAs ?? o.top);
  const state: GameState = {
    players: players.map((id) => ({ id, eliminated: eliminated.includes(id) })),
    rng: o.rng ?? 42,
    phase: 'playing',
    round: {
      number: 1,
      isFinal: seats.length === 2,
      deckCount,
      seats,
      hands,
      drawPile,
      discard,
      top: { card: topCard, rank: as.rank, suit: as.suit },
      direction: o.direction ?? 1,
      current: o.current ?? (seats[0] as string),
      pendingDraw: o.pendingDraw ?? 0,
      turn: { hasDrawn: false, drawnCardId: null },
      awaitingSuitChoice: false,
      mawDebt: null,
      mamawWindow: null,
      winner: null,
    },
    results: [],
    winner: null,
  };
  expect(checkInvariants(state)).toEqual([]);
  return state;
}

/** Id of the first card with this code in the player's hand. */
export function id(state: GameState, player: string, code: string): string {
  const { rank, suit } = parse(code);
  const card = state.round.hands[player]?.find((c) => c.rank === rank && c.suit === suit);
  if (!card) throw new Error(`${player} has no ${code}`);
  return card.id;
}

export function codes(cards: readonly Card[]): string[] {
  return cards.map((c) => `${c.rank}${c.suit}`);
}

export function handOf(state: GameState, player: string): string[] {
  return codes(state.round.hands[player] ?? []);
}

/** Applies an action that must succeed, checking invariants. */
export function act(state: GameState, action: Action): GameState {
  const res = reduce(state, action);
  if (!res.ok) throw new Error(`Expected ok, got ${res.error.code}: ${res.error.message}`);
  expect(checkInvariants(res.state)).toEqual([]);
  return res.state;
}

/** Applies an action that must fail with `code`; also checks the input was not mutated. */
export function rejects(state: GameState, action: Action, code: ErrorCode): void {
  const before = structuredClone(state);
  const res = reduce(state, action);
  expect(res.ok ? 'ok' : res.error.code).toBe(code);
  expect(state).toEqual(before);
}

/** Shorthand for a PLAY action by card code. */
export function play(
  state: GameState,
  player: string,
  code: string,
  extra: { chosenSuit?: Suit; say?: 'maw' | 'mamaw'; now?: number } = {},
): GameState {
  return act(state, { type: 'PLAY', playerId: player, cardId: id(state, player, code), now: 0, ...extra });
}

export function drawFor(state: GameState, player: string): GameState {
  return act(state, { type: 'DRAW', playerId: player, now: 0 });
}

export function passFor(state: GameState, player: string): GameState {
  return act(state, { type: 'PASS', playerId: player, now: 0 });
}
