import type { Card, Rank, Suit } from './cards.js';
import type { RngState } from './rng.js';

export type PlayerId = string;

/** Effective identity of the top of the discard pile (a Jack may act as another rank/suit). */
export interface TopCard {
  readonly card: Card;
  readonly rank: Rank;
  readonly suit: Suit;
}

export interface TurnState {
  /** The current player has drawn their single §2 card this turn. */
  hasDrawn: boolean;
  /** Id of that drawn card (null if nothing could be drawn). Only it may be played afterwards. */
  drawnCardId: string | null;
}

/**
 * A player who is at 1 card and has not pressed Maw yet. They may still press
 * it (MAW) at any time until someone calls them out or the next card is played.
 * `callable` is false only in the no-win-on-a-9 case while it is still their
 * turn: they reached 1 card by drawing and only owe Maw once they pass.
 */
export interface MawDebt {
  playerId: PlayerId;
  callable: boolean;
}

/** Last card played without Mamaw: others may call out, or the player may still press Mamaw, until `deadline` (ms). */
export interface MamawWindow {
  playerId: PlayerId;
  deadline: number;
}

export interface RoundState {
  number: number;
  /** Exactly 2 players in the round: Q/8/9 all mean play again; winner wins the game. */
  isFinal: boolean;
  deckCount: 1 | 2;
  /** Active players in seat order. */
  seats: PlayerId[];
  hands: Record<PlayerId, Card[]>;
  /** Last element is the top of the draw pile. */
  drawPile: Card[];
  /** Last element is the face-up top card. */
  discard: Card[];
  top: TopCard;
  direction: 1 | -1;
  current: PlayerId;
  pendingDraw: number;
  turn: TurnState;
  /** Starting card was a Jack: the first player must choose a suit before anything else. */
  awaitingSuitChoice: boolean;
  mawDebt: MawDebt | null;
  mamawWindow: MamawWindow | null;
  winner: PlayerId | null;
}

export interface PlayerState {
  id: PlayerId;
  eliminated: boolean;
}

export interface RoundResult {
  round: number;
  winner: PlayerId;
  /** Points for every non-winning player in the round. */
  points: Record<PlayerId, number>;
  eliminated: PlayerId[];
}

export type Phase = 'playing' | 'mamawWindow' | 'roundOver' | 'gameOver';

export interface GameState {
  players: PlayerState[];
  rng: RngState;
  phase: Phase;
  round: RoundState;
  results: RoundResult[];
  winner: PlayerId | null;
}

export type Declaration = 'maw' | 'mamaw';

/** Every action carries `now` (ms, supplied by the server) so the engine never reads a clock. */
export type Action =
  | {
      type: 'PLAY';
      playerId: PlayerId;
      cardId: string;
      /** Required when a Jack is played on a non-special card; forbidden otherwise. */
      chosenSuit?: Suit;
      /** Press Maw (leaves 1 card) or Mamaw (leaves 0 cards) together with the play. */
      say?: Declaration;
      now: number;
    }
  | { type: 'DRAW'; playerId: PlayerId; now: number }
  | { type: 'PASS'; playerId: PlayerId; now: number }
  /** Press Maw on its own: late (after a play left you 1 card), or in the no-win-on-a-9 case. */
  | { type: 'MAW'; playerId: PlayerId; now: number }
  /** Press Mamaw late, during your own Mamaw window: the win stands immediately. */
  | { type: 'MAMAW'; playerId: PlayerId; now: number }
  | { type: 'CALL_OUT'; playerId: PlayerId; now: number }
  | { type: 'CHOOSE_SUIT'; playerId: PlayerId; suit: Suit; now: number }
  /** System: closes an expired Mamaw window. */
  | { type: 'TICK'; now: number }
  /** System: deals the next round after a round ends. */
  | { type: 'NEXT_ROUND'; now: number };

export type ActionType = Action['type'];

export type ErrorCode =
  | 'GAME_OVER'
  | 'WRONG_PHASE'
  | 'NOT_A_PLAYER'
  | 'NOT_YOUR_TURN'
  | 'AWAITING_SUIT_CHOICE'
  | 'NO_SUIT_CHOICE_PENDING'
  | 'CARD_NOT_IN_HAND'
  | 'MUST_PLAY_DRAWN_CARD'
  | 'ILLEGAL_CARD'
  | 'SUIT_REQUIRED'
  | 'SUIT_NOT_ALLOWED'
  | 'INVALID_SUIT'
  | 'INVALID_DECLARATION'
  | 'ALREADY_DRAWN'
  | 'CANNOT_PASS'
  | 'MAW_NOT_ALLOWED'
  | 'MAMAW_NOT_ALLOWED'
  | 'NOTHING_TO_CALL_OUT'
  | 'CANNOT_CALL_OUT_SELF'
  | 'WINDOW_CLOSED'
  | 'INVALID_SETUP';

export interface EngineError {
  code: ErrorCode;
  message: string;
}

export type Result<T> = { ok: true; state: T } | { ok: false; error: EngineError };
