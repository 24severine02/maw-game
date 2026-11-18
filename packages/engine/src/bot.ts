import { getLegalActions } from './legal.js';
import type { Action } from './types.js';
import type { PlayerView } from './view.js';

export interface BotOptions {
  /** Probability of calling out a forgetter when possible. */
  callOutRate: number;
  /** Probability of pressing Maw/Mamaw correctly (the rest of the time it "forgets"). */
  declareRate: number;
  /** Probability of playing a card when one is playable (otherwise draw/pass voluntarily). */
  playRate: number;
  /** After forgetting: probability of pressing Maw/Mamaw late when asked to act (before being called out). */
  latePressRate: number;
}

/** Default bot: never forgets, always calls out, always plays when it can. */
export const DEFAULT_BOT: BotOptions = { callOutRate: 1, declareRate: 1, playRate: 1, latePressRate: 1 };

/**
 * Simple random bot. Sees only its PlayerView and only ever returns one of
 * `getLegalActions(view, now)` — or null when it has nothing to do.
 * `rand` must return floats in [0, 1); pass a seeded one (see makeRandom) for determinism.
 */
export function chooseBotAction(
  view: PlayerView,
  now: number,
  rand: () => number,
  options: BotOptions = DEFAULT_BOT,
): Action | null {
  const legal = getLegalActions(view, now);
  if (legal.length === 0) return null;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;

  const callOut = legal.find((a) => a.type === 'CALL_OUT');
  if (callOut && rand() < options.callOutRate) return callOut;
  // Forgot Maw/Mamaw: maybe press it late, before someone calls us out.
  const late = legal.find((a) => a.type === 'MAMAW' || (a.type === 'MAW' && view.round.mawDebt?.callable));
  if (late && rand() < options.latePressRate) return late;
  if (view.round.current !== view.viewer || view.phase !== 'playing') return null;

  const choose = legal.find((a) => a.type === 'CHOOSE_SUIT');
  if (choose) return pick(legal.filter((a) => a.type === 'CHOOSE_SUIT'));

  const remember = rand() < options.declareRate;
  const maw = legal.find((a) => a.type === 'MAW');
  if (maw && remember) return maw;

  const plays = legal.filter((a) => a.type === 'PLAY');
  const hasDeclarations = plays.some((a) => a.say !== undefined);
  const candidates = hasDeclarations ? plays.filter((a) => (a.say !== undefined) === remember) : plays;
  const fallback = legal.find((a) => a.type === 'DRAW' || a.type === 'PASS') as Action;
  if (candidates.length > 0 && rand() < options.playRate) return pick(candidates);
  return fallback;
}
