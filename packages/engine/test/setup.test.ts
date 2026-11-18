import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  cardPoints,
  checkInvariants,
  createGame,
  deckCountFor,
  effectiveTop,
  handPoints,
  makeRandom,
  nextFloat,
  RANKS,
  seedRng,
  shuffle,
  type GameState,
  type Rank,
} from '../src/index.js';
import { applyStartingCard, dealRound } from '../src/setup.js';
import { act, codes, scenario } from './helpers.js';

function game(n: number, seed = 1): GameState {
  const res = createGame({ playerIds: Array.from({ length: n }, (_, i) => `p${i}`), seed });
  if (!res.ok) throw new Error(res.error.message);
  return res.state;
}

/** Finds a seed whose starting card has the given rank (deterministic search). */
function gameStartingWith(rank: Rank, n: number): GameState {
  for (let seed = 0; seed < 10_000; seed++) {
    const g = game(n, seed);
    if (g.round.discard[0]?.rank === rank) return g;
  }
  throw new Error(`no seed starts with ${rank}`);
}

describe('deck building (§1)', () => {
  it('builds 52 unique cards per deck', () => {
    const one = buildDeck(1);
    expect(one).toHaveLength(52);
    expect(new Set(one.map((c) => c.id)).size).toBe(52);
    const two = buildDeck(2);
    expect(two).toHaveLength(104);
    expect(new Set(two.map((c) => c.id)).size).toBe(104);
    expect(new Set(two.map((c) => `${c.rank}${c.suit}`)).size).toBe(52);
  });

  it('uses 1 deck for 2 players and 2 decks for 3+', () => {
    expect(deckCountFor(2)).toBe(1);
    for (let n = 3; n <= 8; n++) expect(deckCountFor(n)).toBe(2);
  });
});

describe('scoring table (§5)', () => {
  it.each([
    ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6],
    ['10', 10], ['K', 10], ['A', 10],
    ['7', 14], ['8', 16], ['9', 18], ['Q', 20], ['J', 20],
  ] as [Rank, number][])('%s is worth %i', (rank, pts) => {
    expect(cardPoints(rank)).toBe(pts);
  });

  it('every rank has a score and hands sum', () => {
    for (const r of RANKS) expect(cardPoints(r)).toBeGreaterThan(0);
    expect(handPoints(buildDeck(1).filter((c) => c.suit === 'S'))).toBe(
      2 + 3 + 4 + 5 + 6 + 10 + 10 + 10 + 14 + 16 + 18 + 20 + 20,
    );
  });
});

describe('seedable RNG', () => {
  it('is deterministic and in [0,1)', () => {
    const a = makeRandom(7);
    const b = makeRandom(7);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(nextFloat(seedRng(1))[0]).not.toBe(nextFloat(seedRng(2))[0]);
  });

  it('shuffles into a permutation without mutating the input', () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const [out, next] = shuffle(items, seedRng(3));
    expect(items).toEqual(Array.from({ length: 52 }, (_, i) => i));
    expect([...out].sort((x, y) => x - y)).toEqual(items);
    expect(out).not.toEqual(items);
    expect(next).not.toBe(seedRng(3));
    expect(shuffle(items, seedRng(3))[0]).toEqual(out);
  });
});

describe('effectiveTop', () => {
  it('a wild Jack without a chosen suit keeps its own suit', () => {
    const [jack, two] = [buildDeck(1).find((c) => c.id === '0:JD')!, buildDeck(1)[1]!];
    expect(effectiveTop(jack, { card: two, rank: two.rank, suit: two.suit }, undefined)).toMatchObject({
      rank: 'J',
      suit: 'D',
    });
  });
});

describe('createGame / dealing (§1)', () => {
  it('rejects bad player lists', () => {
    for (const playerIds of [['a'], Array.from({ length: 9 }, (_, i) => `p${i}`), ['a', 'a'], ['a', '']]) {
      const res = createGame({ playerIds, seed: 1 });
      expect(res.ok ? 'ok' : res.error.code).toBe('INVALID_SETUP');
    }
  });

  it.each([2, 3, 5, 8])('deals 7 cards each to %i players and turns up a starting card', (n) => {
    const g = game(n);
    const r = g.round;
    expect(r.deckCount).toBe(n >= 3 ? 2 : 1);
    expect(r.isFinal).toBe(n === 2);
    for (const id of r.seats) expect(r.hands[id]).toHaveLength(7);
    expect(r.discard).toHaveLength(1);
    expect(r.drawPile).toHaveLength(r.deckCount * 52 - 7 * n - 1);
    expect(g.phase).toBe('playing');
    expect(checkInvariants(g)).toEqual([]);
  });

  it('is deterministic for a seed and differs across seeds', () => {
    expect(game(4, 99)).toEqual(game(4, 99));
    expect(codes(game(4, 99).round.hands.p0 ?? [])).not.toEqual(codes(game(4, 100).round.hands.p0 ?? []));
  });

  it('seat 0 starts round 1 (decision)', () => {
    expect(gameStartingWith('5', 4).round.current).toBe('p0');
  });
});

describe('starting card (§1, §6.3)', () => {
  it('7: first player faces +2', () => {
    const g = gameStartingWith('7', 3);
    expect(g.round.current).toBe('p0');
    expect(g.round.pendingDraw).toBe(2);
    const after = act(g, { type: 'DRAW', playerId: 'p0', now: 0 });
    expect(after.round.hands.p0).toHaveLength(9);
    expect(after.round.current).toBe('p0');
  });

  it('8: first player is skipped', () => {
    expect(gameStartingWith('8', 3).round.current).toBe('p1');
  });

  it('Q: direction is reversed, first player still starts', () => {
    const g = gameStartingWith('Q', 3);
    expect(g.round.direction).toBe(-1);
    expect(g.round.current).toBe('p0');
  });

  it('9: no effect', () => {
    const g = gameStartingWith('9', 3);
    expect(g.round.current).toBe('p0');
    expect(g.round.direction).toBe(1);
  });

  it('final: a starting Q or 8 has no effect (nobody played it)', () => {
    for (const rank of ['Q', '8'] as const) {
      const g = gameStartingWith(rank, 2);
      expect(g.round.current).toBe('p0');
      expect(g.round.direction).toBe(1);
    }
  });

  it('Jack: first player chooses the suit before doing anything else', () => {
    const g = gameStartingWith('J', 3);
    expect(g.round.awaitingSuitChoice).toBe(true);
    const r1 = act(g, { type: 'CHOOSE_SUIT', playerId: 'p0', suit: 'D', now: 0 });
    expect(r1.round.top.suit).toBe('D');
    expect(r1.round.top.rank).toBe('J');
    expect(r1.round.awaitingSuitChoice).toBe(false);
    expect(r1.round.current).toBe('p0');
  });

  it('applyStartingCard on a hand-built round matches dealRound', () => {
    const [round] = dealRound(1, ['x', 'y', 'z'], 'y', seedRng(5));
    expect(round.current === 'y' || round.top.rank === '8').toBe(true);
    const s = scenario({ hands: { a: ['2H'], b: ['3H'], c: ['4H'] }, top: '8S' });
    applyStartingCard(s.round);
    expect(s.round.current).toBe('b');
  });
});
