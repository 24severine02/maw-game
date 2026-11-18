import { describe, expect, it } from 'vitest';
import { checkInvariants, createGame, reduce } from '../src/index.js';
import { act, play, rejects, scenario } from './helpers.js';

const next = { type: 'NEXT_ROUND' as const, now: 0 };

describe('round end & scoring (§5)', () => {
  it('scores the other players and eliminates the one with the most points', () => {
    const s = scenario({
      players: ['a', 'b', 'c', 'd'],
      hands: { a: ['5S'], b: ['2C', '3C'], c: ['QD', 'JD'], d: ['7H', 'KH'] },
      top: '5H',
    });
    const r = play(s, 'a', '5S', { say: 'mamaw' });
    expect(r.results).toEqual([{ round: 1, winner: 'a', points: { b: 5, c: 40, d: 24 }, eliminated: ['c'] }]);
    expect(r.players.find((p) => p.id === 'c')?.eliminated).toBe(true);
    expect(r.phase).toBe('roundOver');
  });

  it('a tie for most points eliminates all tied players', () => {
    const s = scenario({
      players: ['a', 'b', 'c', 'd'],
      hands: { a: ['5S'], b: ['QC'], c: ['JD'], d: ['2H'] },
      top: '5H',
    });
    const r = play(s, 'a', '5S', { say: 'mamaw' });
    expect(r.results[0]?.eliminated).toEqual(['b', 'c']);
    expect(r.phase).toBe('roundOver');
  });

  it('new round: remaining players, 7 cards each, winner starts (decision), deck count re-evaluated', () => {
    const s = scenario({
      players: ['a', 'b', 'c', 'd'],
      hands: { a: ['2C'], b: ['5S'], c: ['QD'], d: ['3D'] },
      top: '5H',
      current: 'b',
    });
    const over = play(s, 'b', '5S', { say: 'mamaw' });
    expect(over.results[0]?.eliminated).toEqual(['c']);
    const r = act(over, next);
    expect(r.phase).toBe('playing');
    expect(r.round.number).toBe(2);
    expect(r.round.seats).toEqual(['a', 'b', 'd']);
    expect(r.round.deckCount).toBe(2);
    expect(r.round.winner).toBeNull();
    for (const id of r.round.seats) expect(r.round.hands[id]).toHaveLength(7);
    expect(r.round.hands.c).toBeUndefined();
    // b won; a starting 8 would skip b
    expect(r.round.current).toBe(r.round.top.card.rank === '8' ? 'd' : 'b');
    expect(checkInvariants(r)).toEqual([]);
  });

  it('when 2 players remain the next round is the final, with 1 deck', () => {
    const s = scenario({
      hands: { a: ['5S'], b: ['2C'], c: ['QD'] },
      top: '5H',
    });
    const r = act(play(s, 'a', '5S', { say: 'mamaw' }), next);
    expect(r.round.seats).toEqual(['a', 'b']);
    expect(r.round.isFinal).toBe(true);
    expect(r.round.deckCount).toBe(1);
    expect(r.round.drawPile.length + r.round.discard.length).toBe(52 - 14);
  });

  it('the winner of the final wins the game', () => {
    const s = scenario({ players: ['a', 'b'], hands: { a: ['5S'], b: ['2C'] }, top: '5H' });
    const r = play(s, 'a', '5S', { say: 'mamaw' });
    expect(r.phase).toBe('gameOver');
    expect(r.winner).toBe('a');
    expect(r.results[0]?.eliminated).toEqual(['b']);
  });

  it('if eliminations leave only the round winner, they win the game', () => {
    const s = scenario({ hands: { a: ['5S'], b: ['QC'], c: ['JD'] }, top: '5H' });
    const r = play(s, 'a', '5S', { say: 'mamaw' });
    expect(r.results[0]?.eliminated).toEqual(['b', 'c']);
    expect(r.phase).toBe('gameOver');
    expect(r.winner).toBe('a');
  });

  it('the game cannot continue after it is over, and NEXT_ROUND only after a round', () => {
    const s = scenario({ players: ['a', 'b'], hands: { a: ['5S'], b: ['2C'] }, top: '5H' });
    rejects(s, next, 'WRONG_PHASE');
    const over = play(s, 'a', '5S', { say: 'mamaw' });
    rejects(over, next, 'GAME_OVER');
    rejects(over, { type: 'TICK', now: 0 }, 'GAME_OVER');
  });

  it('round-over phase blocks play actions', () => {
    const s = scenario({ hands: { a: ['5S'], b: ['2C', '3C'], c: ['QD'] }, top: '5H' });
    const over = play(s, 'a', '5S', { say: 'mamaw' });
    rejects(over, { type: 'DRAW', playerId: 'b', now: 0 }, 'WRONG_PHASE');
    rejects(over, { type: 'CALL_OUT', playerId: 'b', now: 0 }, 'WRONG_PHASE');
    rejects(over, { type: 'MAW', playerId: 'b', now: 0 }, 'MAW_NOT_ALLOWED');
  });

  it('eliminated players are spectators: they cannot act', () => {
    const s = scenario({
      players: ['a', 'b', 'x'],
      eliminated: ['x'],
      hands: { a: ['5S', '2C'], b: ['3S'] },
      top: '5H',
      current: 'a',
    });
    rejects(s, { type: 'DRAW', playerId: 'x', now: 0 }, 'NOT_A_PLAYER');
  });
});

describe('determinism', () => {
  it('same seed + same actions → identical states', () => {
    const run = () => {
      const g = createGame({ playerIds: ['a', 'b', 'c'], seed: 123 });
      if (!g.ok) throw new Error();
      let s = g.state;
      for (let i = 0; i < 20; i++) {
        const res = reduce(s, { type: 'DRAW', playerId: s.round.current, now: i });
        if (res.ok) s = res.state;
        const p = reduce(s, { type: 'PASS', playerId: s.round.current, now: i });
        if (p.ok) s = p.state;
      }
      return s;
    };
    expect(run()).toEqual(run());
  });
});
