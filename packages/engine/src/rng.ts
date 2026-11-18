/**
 * Seedable, serialisable PRNG (mulberry32). The whole generator state is a
 * single uint32 stored in GameState, so the reducer stays pure: every random
 * step takes a state and returns the next one.
 */
export type RngState = number;

export function seedRng(seed: number): RngState {
  return seed >>> 0;
}

/** Returns a float in [0, 1) and the next RNG state. */
export function nextFloat(state: RngState): [number, RngState] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Fisher–Yates shuffle. Does not mutate `items`. */
export function shuffle<T>(items: readonly T[], state: RngState): [T[], RngState] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    let r: number;
    [r, s] = nextFloat(s);
    const j = Math.floor(r * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return [out, s];
}

/** Convenience for callers outside the reducer (bots, tests): a stateful `() => number`. */
export function makeRandom(seed: number): () => number {
  let s = seedRng(seed);
  return () => {
    let r: number;
    [r, s] = nextFloat(s);
    return r;
  };
}
