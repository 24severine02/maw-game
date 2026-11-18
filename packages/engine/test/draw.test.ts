import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../src/index.js';
import { act, codes, drawFor, handOf, id, passFor, play, rejects, scenario } from './helpers.js';

describe('drawing (§2.2)', () => {
  it('no playable card: draw 1, play it if playable', () => {
    const s = scenario({ hands: { a: ['KD', '2C'], b: ['3C'], c: ['4C'] }, top: '5S', draw: ['6S'] });
    const d = drawFor(s, 'a');
    expect(handOf(d, 'a')).toEqual(['KD', '2C', '6S']);
    expect(d.round.turn).toEqual({ hasDrawn: true, drawnCardId: id(d, 'a', '6S') });
    expect(d.round.current).toBe('a');
    const p = play(d, 'a', '6S');
    expect(p.round.current).toBe('b');
    expect(p.round.turn.hasDrawn).toBe(false);
  });

  it('drawn card not playable: pass', () => {
    const s = scenario({ hands: { a: ['KD', '2C'], b: ['3C'], c: ['4C'] }, top: '5S', draw: ['6H'] });
    const d = drawFor(s, 'a');
    rejects(d, { type: 'PLAY', playerId: 'a', cardId: id(d, 'a', '6H'), now: 0 }, 'ILLEGAL_CARD');
    const p = passFor(d, 'a');
    expect(p.round.current).toBe('b');
    expect(handOf(p, 'a')).toHaveLength(3);
  });

  it('may keep a playable drawn card and pass', () => {
    const s = scenario({ hands: { a: ['KD'], b: ['3C'], c: ['4C'] }, top: '5S', draw: ['6S'] });
    expect(passFor(drawFor(s, 'a'), 'a').round.current).toBe('b');
  });

  it('after drawing only the drawn card may be played', () => {
    const s = scenario({ hands: { a: ['5H', '2C'], b: ['3C'], c: ['4C'] }, top: '5S', draw: ['6S'] });
    const d = drawFor(s, 'a');
    rejects(d, { type: 'PLAY', playerId: 'a', cardId: id(d, 'a', '5H'), now: 0 }, 'MUST_PLAY_DRAWN_CARD');
    rejects(d, { type: 'DRAW', playerId: 'a', now: 0 }, 'ALREADY_DRAWN');
  });

  it('voluntary draw is allowed even with a playable card (decision)', () => {
    const s = scenario({ hands: { a: ['5H', '2C'], b: ['3C'], c: ['4C'] }, top: '5S' });
    expect(drawFor(s, 'a').round.turn.hasDrawn).toBe(true);
  });

  it('cannot pass without drawing', () => {
    const s = scenario({ hands: { a: ['KD'], b: ['3C'], c: ['4C'] }, top: '5S' });
    rejects(s, { type: 'PASS', playerId: 'a', now: 0 }, 'CANNOT_PASS');
  });
});

describe('reshuffling (§2.3)', () => {
  it('empty draw pile: the discard pile except the top card becomes the new draw pile', () => {
    const s = scenario({
      players: ['a', 'b'],
      hands: { a: ['KD'], b: ['3C'] },
      top: '5S',
      rest: 'discard',
    });
    expect(s.round.drawPile).toHaveLength(0);
    const buried = s.round.discard.length - 1;
    const d = drawFor(s, 'a');
    expect(d.round.discard.map((c) => c.id)).toEqual([s.round.top.card.id]);
    expect(d.round.drawPile).toHaveLength(buried - 1);
    expect(d.rng).not.toBe(s.rng);
    expect(handOf(d, 'a')).toHaveLength(2);
    expect(checkInvariants(d)).toEqual([]);
  });

  it('reshuffles mid-way through a multi-card draw', () => {
    const s = scenario({
      players: ['a', 'b'],
      hands: { a: ['7S', '2C'], b: ['3C'] },
      top: '5S',
      draw: ['KH'],
      rest: 'discard',
    });
    const r = drawFor(play(s, 'a', '7S'), 'b');
    expect(handOf(r, 'b')).toHaveLength(3);
    expect(handOf(r, 'b')).toContain('KH');
    expect(r.round.discard).toHaveLength(1);
    expect(r.round.discard[0]?.rank).toBe('7');
  });

  it('a reshuffled Jack loses its acted identity: the top keeps its own', () => {
    const s = scenario({
      players: ['a', 'b'],
      hands: { a: ['KD'], b: ['3C'] },
      top: 'JS',
      topAs: 'JH',
      discard: ['JC'],
      rest: { hand: 'b' },
    });
    const d = drawFor(s, 'a');
    expect(handOf(d, 'a')).toEqual(['KD', 'JC']);
    expect(d.round.top).toMatchObject({ rank: 'J', suit: 'H' });
  });

  it('when both piles are exhausted the remaining draws are forfeited (decision)', () => {
    const s = scenario({
      players: ['a', 'b'],
      hands: { a: ['2C'], b: ['3C'] },
      top: '7S',
      pendingDraw: 4,
      current: 'b',
      draw: ['KH'],
      rest: { hand: 'a' },
    });
    const r = drawFor(s, 'b');
    expect(handOf(r, 'b')).toEqual(['3C', 'KH']);
    expect(r.round.pendingDraw).toBe(0);
    const d = drawFor(r, 'b');
    expect(d.round.turn).toEqual({ hasDrawn: true, drawnCardId: null });
    expect(passFor(d, 'b').round.current).toBe('a');
    expect(codes(d.round.discard)).toEqual(['7S']);
    rejects(d, { type: 'PLAY', playerId: 'b', cardId: id(d, 'b', '3C'), now: 0 }, 'MUST_PLAY_DRAWN_CARD');
    expect(act(d, { type: 'PASS', playerId: 'b', now: 0 }).round.current).toBe('a');
  });
});
