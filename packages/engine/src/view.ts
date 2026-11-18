import type { Card } from './cards.js';
import { cloneResult } from './clone.js';
import type { GameState, MamawWindow, MawDebt, Phase, PlayerId, RoundResult, TopCard } from './types.js';

export interface PublicPlayer {
  id: PlayerId;
  eliminated: boolean;
  /** Seated in the current round (false for eliminated spectators). */
  inRound: boolean;
  handCount: number;
}

export interface RoundView {
  number: number;
  isFinal: boolean;
  deckCount: 1 | 2;
  seats: PlayerId[];
  direction: 1 | -1;
  current: PlayerId;
  pendingDraw: number;
  top: TopCard;
  discardCount: number;
  drawPileCount: number;
  awaitingSuitChoice: boolean;
  /** Whether the current player has already drawn their §2 card this turn (public). */
  currentHasDrawn: boolean;
  /** The card the viewer just drew — only set when the viewer is the current player. */
  drawnCardId: string | null;
  mawDebt: MawDebt | null;
  mamawWindow: MamawWindow | null;
  winner: PlayerId | null;
}

/** What one player (or spectator) is allowed to see. Contains no hidden information. */
export interface PlayerView {
  viewer: PlayerId;
  isSpectator: boolean;
  phase: Phase;
  players: PublicPlayer[];
  /** The viewer's own hand; empty for spectators. */
  hand: Card[];
  round: RoundView;
  results: RoundResult[];
  winner: PlayerId | null;
}

/**
 * Projects the full state to what `viewer` may see: other hands become counts,
 * the draw pile and the buried discard become counts, and the RNG state
 * (which would let a client predict reshuffles) is dropped.
 */
export function getPlayerView(state: GameState, viewer: PlayerId): PlayerView {
  const r = state.round;
  const inRound = r.seats.includes(viewer);
  const isCurrent = inRound && r.current === viewer;
  // Fresh containers throughout; Card/TopCard objects are immutable and shared.
  return {
    viewer,
    isSpectator: !inRound,
    phase: state.phase,
    players: state.players.map((p) => ({
      id: p.id,
      eliminated: p.eliminated,
      inRound: r.seats.includes(p.id),
      handCount: r.hands[p.id]?.length ?? 0,
    })),
    hand: inRound ? (r.hands[viewer] as Card[]).slice() : [],
    round: {
      number: r.number,
      isFinal: r.isFinal,
      deckCount: r.deckCount,
      seats: r.seats.slice(),
      direction: r.direction,
      current: r.current,
      pendingDraw: r.pendingDraw,
      top: r.top,
      discardCount: r.discard.length,
      drawPileCount: r.drawPile.length,
      awaitingSuitChoice: r.awaitingSuitChoice,
      currentHasDrawn: r.turn.hasDrawn,
      drawnCardId: isCurrent ? r.turn.drawnCardId : null,
      mawDebt: r.mawDebt && { ...r.mawDebt },
      mamawWindow: r.mamawWindow && { ...r.mamawWindow },
      winner: r.winner,
    },
    results: state.results.map(cloneResult),
    winner: state.winner,
  };
}
