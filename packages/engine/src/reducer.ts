import { handPoints, SUITS, type Card, type Suit } from './cards.js';
import { shuffle } from './rng.js';
import { effectiveTop, isPlayable, isPlayAgain, needsSuitChoice, seatAfter } from './rules.js';
import { cloneState } from './clone.js';
import { dealRound } from './setup.js';
import type {
  Action,
  EngineError,
  ErrorCode,
  GameState,
  PlayerId,
  Result,
  RoundState,
  TopCard,
} from './types.js';

/** SPEC §6.2: call-out window after a last card played without Mamaw. */
export const MAMAW_WINDOW_MS = 5000;
/** SPEC §4: penalty for a forgotten Maw/Mamaw. */
export const CALL_OUT_PENALTY = 2;

/**
 * The rules engine: (state, action) → new state | error.
 * Pure and deterministic: never mutates `state`, never reads clocks or global randomness.
 */
export function reduce(state: GameState, action: Action): Result<GameState> {
  if (state.phase === 'gameOver') return fail('GAME_OVER', 'The game is over');
  switch (action.type) {
    case 'PLAY':
      return play(state, action);
    case 'DRAW':
      return draw(state, action);
    case 'PASS':
      return pass(state, action);
    case 'MAW':
      return maw(state, action);
    case 'MAMAW':
      return mamaw(state, action);
    case 'CALL_OUT':
      return callOut(state, action);
    case 'CHOOSE_SUIT':
      return chooseSuit(state, action);
    case 'TICK':
      return tick(state, action);
    case 'NEXT_ROUND':
      return nextRound(state);
  }
}

type ActionOf<T extends Action['type']> = Extract<Action, { type: T }>;

function fail(code: ErrorCode, message: string): { ok: false; error: EngineError } {
  return { ok: false, error: { code, message } };
}

function ok(state: GameState): Result<GameState> {
  return { ok: true, state };
}

/** Common checks for actions only the current player may take during normal play. */
function checkTurn(state: GameState, playerId: PlayerId): EngineError | null {
  if (state.phase !== 'playing') return { code: 'WRONG_PHASE', message: `Cannot act during ${state.phase}` };
  if (!state.round.seats.includes(playerId)) return { code: 'NOT_A_PLAYER', message: `${playerId} is not in this round` };
  if (state.round.current !== playerId) return { code: 'NOT_YOUR_TURN', message: `It is ${state.round.current}'s turn` };
  return null;
}

function play(state: GameState, action: ActionOf<'PLAY'>): Result<GameState> {
  const turnError = checkTurn(state, action.playerId);
  if (turnError) return { ok: false, error: turnError };
  const r = state.round;
  if (r.awaitingSuitChoice) return fail('AWAITING_SUIT_CHOICE', 'Choose a suit for the starting Jack first');

  const hand = r.hands[action.playerId] as Card[];
  const card = hand.find((c) => c.id === action.cardId);
  if (!card) return fail('CARD_NOT_IN_HAND', `Card ${action.cardId} is not in your hand`);
  if (r.turn.hasDrawn && card.id !== r.turn.drawnCardId) {
    return fail('MUST_PLAY_DRAWN_CARD', 'After drawing you may only play the drawn card, or pass');
  }
  if (!isPlayable(card, r.top, r.pendingDraw)) {
    return fail(
      'ILLEGAL_CARD',
      r.pendingDraw > 0
        ? `Facing +${r.pendingDraw}: play a 7 or a Jack, or draw`
        : `${card.rank}${card.suit} does not match ${r.top.rank}${r.top.suit}`,
    );
  }
  const suitNeeded = needsSuitChoice(card, r.top);
  if (suitNeeded && action.chosenSuit === undefined) return fail('SUIT_REQUIRED', 'Choose a suit for the Jack');
  if (!suitNeeded && action.chosenSuit !== undefined) {
    return fail('SUIT_NOT_ALLOWED', 'A suit can only be chosen for a Jack played on a non-special card');
  }
  if (action.chosenSuit !== undefined && !SUITS.includes(action.chosenSuit)) {
    return fail('INVALID_SUIT', `Unknown suit ${String(action.chosenSuit)}`);
  }
  const remaining = hand.length - 1;
  if (action.say === 'maw' && remaining !== 1) return fail('INVALID_DECLARATION', 'Maw is pressed when going down to 1 card');
  if (action.say === 'mamaw' && remaining !== 0) return fail('INVALID_DECLARATION', 'Mamaw is pressed when playing your last card');

  // ---- valid: commit on a copy ----
  const next = cloneState(state);
  const round = next.round;
  const me = action.playerId;
  const myHand = round.hands[me] as Card[];
  myHand.splice(myHand.findIndex((c) => c.id === card.id), 1);
  round.discard.push(card);
  const eff: TopCard = effectiveTop(card, round.top, action.chosenSuit);
  round.top = eff;
  // SPEC §6.1: a pending Maw call-out is only valid until the next card is played.
  round.mawDebt = null;

  // SPEC §4: no win on a 9 (or a Jack acting as 9) — the player plays again with 0 cards.
  const wins = remaining === 0 && eff.rank !== '9';
  if (wins && action.say === 'mamaw') return ok(endRound(next, me));

  if (remaining === 1 && action.say !== 'maw') {
    round.mawDebt = { playerId: me, callable: true };
  }
  applyEffect(round, me);

  if (wins) {
    // SPEC §6.2: Mamaw forgotten — the card's effect already applied; 5s call-out window.
    next.phase = 'mamawWindow';
    round.mamawWindow = { playerId: me, deadline: action.now + MAMAW_WINDOW_MS };
  }
  return ok(next);
}

/** SPEC §3 effects of the (effective) top card, played by `by`. */
function applyEffect(round: RoundState, by: PlayerId): void {
  const rank = round.top.rank;
  let steps = 1;
  if (isPlayAgain(rank, round.isFinal)) {
    steps = 0;
  } else if (rank === '7') {
    round.pendingDraw += 2;
  } else if (rank === '8') {
    steps = 2;
  } else if (rank === 'Q') {
    round.direction = round.direction === 1 ? -1 : 1;
  }
  round.current = seatAfter(round, by, steps);
  round.turn = { hasDrawn: false, drawnCardId: null };
}

/**
 * Moves up to `count` cards from the draw pile into the player's hand,
 * reshuffling the discard pile (except its top card) when the pile runs out
 * (SPEC §2.3). If both are exhausted the remaining draws are forfeited.
 * Returns the cards drawn.
 */
function drawCards(state: GameState, playerId: PlayerId, count: number): Card[] {
  const round = state.round;
  const hand = round.hands[playerId] as Card[];
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (round.drawPile.length === 0) {
      const rest = round.discard.slice(0, -1);
      if (rest.length === 0) break;
      [round.drawPile, state.rng] = shuffle(rest, state.rng);
      round.discard = [round.top.card];
    }
    const card = round.drawPile.pop() as Card;
    hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

function draw(state: GameState, action: ActionOf<'DRAW'>): Result<GameState> {
  const turnError = checkTurn(state, action.playerId);
  if (turnError) return { ok: false, error: turnError };
  if (state.round.awaitingSuitChoice) return fail('AWAITING_SUIT_CHOICE', 'Choose a suit for the starting Jack first');
  if (state.round.turn.hasDrawn) return fail('ALREADY_DRAWN', 'You already drew this turn: play the drawn card or pass');

  const next = cloneState(state);
  const round = next.round;
  const me = action.playerId;
  const before = (round.hands[me] as Card[]).length;

  if (round.pendingDraw > 0) {
    // SPEC §3: draw the full total, then continue the turn normally.
    drawCards(next, me, round.pendingDraw);
    round.pendingDraw = 0;
  } else {
    const [card] = drawCards(next, me, 1);
    round.turn = { hasDrawn: true, drawnCardId: card?.id ?? null };
  }

  // SPEC §4 no-win-on-a-9: drawing from 0 to 1 card obliges the player to press Maw.
  if (before === 0 && (round.hands[me] as Card[]).length === 1) {
    round.mawDebt = { playerId: me, callable: false };
  }
  return ok(next);
}

function pass(state: GameState, action: ActionOf<'PASS'>): Result<GameState> {
  const turnError = checkTurn(state, action.playerId);
  if (turnError) return { ok: false, error: turnError };
  if (!state.round.turn.hasDrawn) return fail('CANNOT_PASS', 'You can only pass after drawing a card');

  const next = cloneState(state);
  const round = next.round;
  if (round.mawDebt?.playerId === action.playerId) round.mawDebt.callable = true;
  round.current = seatAfter(round, action.playerId, 1);
  round.turn = { hasDrawn: false, drawnCardId: null };
  return ok(next);
}

/** Decision: Maw may be pressed late, at any time until called out or the next card is played. */
function maw(state: GameState, action: ActionOf<'MAW'>): Result<GameState> {
  const debt = state.round.mawDebt;
  if (state.phase !== 'playing' || debt?.playerId !== action.playerId) {
    return fail('MAW_NOT_ALLOWED', 'Maw is pressed when you go down to 1 card');
  }
  const next = cloneState(state);
  next.round.mawDebt = null;
  return ok(next);
}

/** Decision: Mamaw may be pressed late, during the player's own call-out window; the win then stands. */
function mamaw(state: GameState, action: ActionOf<'MAMAW'>): Result<GameState> {
  const w = state.round.mamawWindow;
  if (state.phase !== 'mamawWindow' || w?.playerId !== action.playerId) {
    return fail('MAMAW_NOT_ALLOWED', 'Mamaw is pressed when you play your last card');
  }
  if (action.now >= w.deadline) return fail('WINDOW_CLOSED', 'The Mamaw window has closed');
  return ok(endRound(cloneState(state), w.playerId));
}

function callOut(state: GameState, action: ActionOf<'CALL_OUT'>): Result<GameState> {
  if (state.phase !== 'playing' && state.phase !== 'mamawWindow') {
    return fail('WRONG_PHASE', `Cannot call out during ${state.phase}`);
  }
  const r = state.round;
  if (!r.seats.includes(action.playerId)) return fail('NOT_A_PLAYER', `${action.playerId} is not in this round`);

  let target: PlayerId;
  if (state.phase === 'mamawWindow') {
    const w = r.mamawWindow as NonNullable<RoundState['mamawWindow']>;
    if (action.now >= w.deadline) return fail('WINDOW_CLOSED', 'The Mamaw call-out window has closed');
    target = w.playerId;
  } else if (r.mawDebt?.callable) {
    target = r.mawDebt.playerId;
  } else {
    return fail('NOTHING_TO_CALL_OUT', 'Nobody has forgotten Maw or Mamaw');
  }
  if (target === action.playerId) return fail('CANNOT_CALL_OUT_SELF', 'You cannot call yourself out');

  const next = cloneState(state);
  drawCards(next, target, CALL_OUT_PENALTY);
  next.round.mawDebt = null;
  next.round.mamawWindow = null;
  next.phase = 'playing';
  return ok(next);
}

function chooseSuit(state: GameState, action: ActionOf<'CHOOSE_SUIT'>): Result<GameState> {
  const turnError = checkTurn(state, action.playerId);
  if (turnError) return { ok: false, error: turnError };
  if (!state.round.awaitingSuitChoice) return fail('NO_SUIT_CHOICE_PENDING', 'There is no suit to choose');
  if (!(SUITS as readonly string[]).includes(action.suit)) return fail('INVALID_SUIT', `Unknown suit ${String(action.suit)}`);
  const next = cloneState(state);
  next.round.top = { ...next.round.top, suit: action.suit as Suit };
  next.round.awaitingSuitChoice = false;
  return ok(next);
}

function tick(state: GameState, action: ActionOf<'TICK'>): Result<GameState> {
  const w = state.round.mamawWindow;
  if (state.phase !== 'mamawWindow' || !w || action.now < w.deadline) return ok(state);
  // SPEC §6.2: nobody called out in time — the win stands.
  return ok(endRound(cloneState(state), w.playerId));
}

function nextRound(state: GameState): Result<GameState> {
  if (state.phase !== 'roundOver') return fail('WRONG_PHASE', 'The round is not over');
  const next = cloneState(state);
  const seats = next.players.filter((p) => !p.eliminated).map((p) => p.id);
  // Decision: the previous round's winner starts the next round.
  const first = next.round.winner as PlayerId;
  [next.round, next.rng] = dealRound(state.round.number + 1, seats, first, next.rng);
  next.phase = 'playing';
  return ok(next);
}

/**
 * SPEC §5: score the other players, eliminate the highest (all tied highest),
 * and end the game after the final or when only the winner is left.
 * Mutates and returns `state` (callers pass a fresh copy).
 */
function endRound(state: GameState, winner: PlayerId): GameState {
  const round = state.round;
  round.winner = winner;
  round.mamawWindow = null;
  round.mawDebt = null;
  round.pendingDraw = 0;
  round.turn = { hasDrawn: false, drawnCardId: null };

  const points: Record<PlayerId, number> = {};
  for (const id of round.seats) {
    if (id !== winner) points[id] = handPoints(round.hands[id] as Card[]);
  }
  const max = Math.max(...Object.values(points));
  const eliminated = Object.keys(points).filter((id) => points[id] === max);
  for (const p of state.players) if (eliminated.includes(p.id)) p.eliminated = true;
  state.results.push({ round: round.number, winner, points, eliminated });

  const remaining = state.players.filter((p) => !p.eliminated);
  if (round.isFinal || remaining.length <= 1) {
    state.phase = 'gameOver';
    state.winner = winner;
  } else {
    state.phase = 'roundOver';
  }
  return state;
}
