import { describe, expect, it } from 'vitest';
import { MAMAW_WINDOW_MS } from '../src/index.js';
import { act, drawFor, handOf, id, passFor, play, rejects, scenario } from './helpers.js';

const callOut = (playerId: string, now = 0) => ({ type: 'CALL_OUT' as const, playerId, now });

describe('Maw (§4, §6.1)', () => {
  const s2 = () =>
    scenario({
      hands: { a: ['5S', '2C'], b: ['3S', '3C', '4H'], c: ['4S', '6S', 'KD'] },
      top: '5H',
    });

  it('pressing Maw with the play that leaves 1 card: nothing to call out', () => {
    const r = play(s2(), 'a', '5S', { say: 'maw' });
    expect(r.round.mawDebt).toBeNull();
    rejects(r, callOut('b'), 'NOTHING_TO_CALL_OUT');
  });

  it('forgetting Maw: any other player can call out, forgetter draws 2', () => {
    const r = play(s2(), 'a', '5S');
    expect(r.round.mawDebt).toEqual({ playerId: 'a', callable: true });
    const c = act(r, callOut('c'));
    expect(handOf(c, 'a')).toHaveLength(3);
    expect(c.round.mawDebt).toBeNull();
    expect(c.round.current).toBe('b');
    rejects(c, callOut('b'), 'NOTHING_TO_CALL_OUT');
  });

  it('the forgetter cannot call themselves out', () => {
    rejects(play(s2(), 'a', '5S'), callOut('a'), 'CANNOT_CALL_OUT_SELF');
  });

  it('Maw can be pressed late, before anyone calls out (decision)', () => {
    const r = play(s2(), 'a', '5S');
    const m = act(r, { type: 'MAW', playerId: 'a', now: 0 });
    expect(m.round.mawDebt).toBeNull();
    expect(m.round.current).toBe('b');
    rejects(m, callOut('b'), 'NOTHING_TO_CALL_OUT');
    // only by the forgetter, only once
    rejects(r, { type: 'MAW', playerId: 'b', now: 0 }, 'MAW_NOT_ALLOWED');
    rejects(m, { type: 'MAW', playerId: 'a', now: 0 }, 'MAW_NOT_ALLOWED');
  });

  it('late Maw is still possible after others draw and pass, but not once called out', () => {
    const s = scenario({ hands: { a: ['5S', '2C'], b: ['KD', 'KC'], c: ['4D'] }, top: '5H', draw: ['QH'] });
    const r = passFor(drawFor(play(s, 'a', '5S'), 'b'), 'b');
    expect(act(r, { type: 'MAW', playerId: 'a', now: 0 }).round.mawDebt).toBeNull();
    rejects(act(r, callOut('c')), { type: 'MAW', playerId: 'a', now: 0 }, 'MAW_NOT_ALLOWED');
  });

  it('call-out is valid until the next card is played', () => {
    const r = play(play(s2(), 'a', '5S'), 'b', '3S');
    expect(r.round.mawDebt).toBeNull();
    rejects(r, callOut('c'), 'NOTHING_TO_CALL_OUT');
  });

  it('drawing or passing does not end the call-out window', () => {
    const s = scenario({
      hands: { a: ['5S', '2C'], b: ['KD', 'KC'], c: ['4D'] },
      top: '5H',
      draw: ['QH'],
    });
    const r = passFor(drawFor(play(s, 'a', '5S'), 'b'), 'b');
    expect(r.round.mawDebt?.playerId).toBe('a');
    expect(handOf(act(r, callOut('b')), 'a')).toHaveLength(3);
  });

  it('only seated players can call out (spectators cannot)', () => {
    const s = scenario({
      players: ['a', 'b', 'c', 'x'],
      eliminated: ['x'],
      hands: { a: ['5S', '2C'], b: ['3S'], c: ['4S'] },
      top: '5H',
    });
    rejects(play(s, 'a', '5S'), callOut('x'), 'NOT_A_PLAYER');
  });

  it('a call-out penalty can trigger a reshuffle', () => {
    const s = scenario({
      players: ['a', 'b'],
      hands: { a: ['5S', '2C'], b: ['3S'] },
      top: '5H',
      rest: 'discard',
    });
    const c = act(play(s, 'a', '5S'), callOut('b'));
    expect(handOf(c, 'a')).toHaveLength(3);
    expect(c.round.discard).toHaveLength(1);
  });

  it('play-again card down to 1: Maw still required', () => {
    const s = scenario({ hands: { a: ['9H', '2H'], b: ['3S'], c: ['4S'] }, top: '5H' });
    const r = play(s, 'a', '9H');
    expect(r.round.mawDebt?.playerId).toBe('a');
    // a's own next card ends the call-out window
    expect(play(r, 'a', '2H', { say: 'mamaw' }).phase).toBe('roundOver');
  });

  it('MAW without a pending obligation is rejected', () => {
    rejects(s2(), { type: 'MAW', playerId: 'a', now: 0 }, 'MAW_NOT_ALLOWED');
  });
});

describe('Mamaw (§4, §6.2)', () => {
  const last = (card = '5S') =>
    scenario({
      hands: { a: [card], b: ['3S', '3C'], c: ['4S', '6S', 'KD'] },
      top: '5H',
    });

  it('playing the last card with Mamaw wins the round', () => {
    const r = play(last(), 'a', '5S', { say: 'mamaw' });
    expect(r.phase).toBe('roundOver');
    expect(r.round.winner).toBe('a');
  });

  it.each(['7H', '8H', 'QH', 'JS'])('a player can win with %s', (card) => {
    const r = play(last(card), 'a', card, { say: 'mamaw', ...(card === 'JS' && { chosenSuit: 'D' as const }) });
    expect(r.round.winner).toBe('a');
    expect(r.round.pendingDraw).toBe(0);
  });

  it('a Jack copying a 7/8/Q as last card also wins', () => {
    const s = scenario({ hands: { a: ['JS'], b: ['3S'], c: ['4S'] }, top: '7H' });
    expect(play(s, 'a', 'JS', { say: 'mamaw' }).round.winner).toBe('a');
  });

  it('forgotten Mamaw opens a 5s call-out window; nothing else may happen', () => {
    const r = play(last(), 'a', '5S', { now: 1000 });
    expect(r.phase).toBe('mamawWindow');
    expect(r.round.mamawWindow).toEqual({ playerId: 'a', deadline: 1000 + MAMAW_WINDOW_MS });
    expect(r.round.current).toBe('b');
    rejects(r, { type: 'PLAY', playerId: 'b', cardId: id(r, 'b', '3S'), now: 2000 }, 'WRONG_PHASE');
    rejects(r, { type: 'DRAW', playerId: 'b', now: 2000 }, 'WRONG_PHASE');
    rejects(r, { type: 'MAW', playerId: 'a', now: 2000 }, 'MAW_NOT_ALLOWED');
    rejects(r, callOut('a', 2000), 'CANNOT_CALL_OUT_SELF');
  });

  it('Mamaw can be pressed late during the window: the win stands at once (decision)', () => {
    const r = play(last(), 'a', '5S', { now: 1000 });
    const m = act(r, { type: 'MAMAW', playerId: 'a', now: 1000 + MAMAW_WINDOW_MS - 1 });
    expect(m.phase).toBe('roundOver');
    expect(m.round.winner).toBe('a');
    expect(m.round.mamawWindow).toBeNull();
    rejects(r, { type: 'MAMAW', playerId: 'b', now: 2000 }, 'MAMAW_NOT_ALLOWED');
    rejects(r, { type: 'MAMAW', playerId: 'a', now: 1000 + MAMAW_WINDOW_MS }, 'WINDOW_CLOSED');
    rejects(last(), { type: 'MAMAW', playerId: 'a', now: 0 }, 'MAMAW_NOT_ALLOWED');
    // once called out, it is too late
    rejects(act(r, callOut('b', 2000)), { type: 'MAMAW', playerId: 'a', now: 2000 }, 'MAMAW_NOT_ALLOWED');
  });

  it('called out within the window: forgetter draws 2, round continues', () => {
    const r = play(last(), 'a', '5S', { now: 1000 });
    const c = act(r, callOut('c', 1000 + MAMAW_WINDOW_MS - 1));
    expect(c.phase).toBe('playing');
    expect(c.round.mamawWindow).toBeNull();
    expect(handOf(c, 'a')).toHaveLength(2);
    expect(c.round.current).toBe('b');
  });

  it('the forgotten card still takes effect if called out (e.g. a 7)', () => {
    const r = play(last('7H'), 'a', '7H', { now: 0 });
    const c = act(r, callOut('b', 10));
    expect(c.round.pendingDraw).toBe(2);
    expect(c.round.current).toBe('b');
  });

  it('TICK before the deadline does nothing; at the deadline the win stands', () => {
    const r = play(last(), 'a', '5S', { now: 1000 });
    expect(act(r, { type: 'TICK', now: 5999 })).toBe(r);
    const t = act(r, { type: 'TICK', now: 6000 });
    expect(t.phase).toBe('roundOver');
    expect(t.round.winner).toBe('a');
    expect(t.round.mamawWindow).toBeNull();
  });

  it('a call-out at or after the deadline is rejected', () => {
    const r = play(last(), 'a', '5S', { now: 1000 });
    rejects(r, callOut('b', 6000), 'WINDOW_CLOSED');
  });

  it('TICK outside a window is a no-op', () => {
    const s = last();
    expect(act(s, { type: 'TICK', now: 1e9 })).toBe(s);
  });
});

describe('no win on a 9 (§4)', () => {
  const nine = (draw: string[], top = '5S', card = '9S') =>
    scenario({ hands: { a: [card], b: ['3C', '2D'], c: ['4C', '6D'] }, top, draw });

  it('last card 9: no win, the player plays again with 0 cards', () => {
    const r = play(nine(['2S']), 'a', '9S', { say: 'mamaw' });
    expect(r.phase).toBe('playing');
    expect(r.round.current).toBe('a');
    expect(handOf(r, 'a')).toEqual([]);
    rejects(r, { type: 'PASS', playerId: 'a', now: 0 }, 'CANNOT_PASS');
  });

  it('Mamaw is optional on the 9 itself (no penalty either way)', () => {
    const r = play(nine(['2S']), 'a', '9S');
    expect(r.phase).toBe('playing');
    expect(r.round.mamawWindow).toBeNull();
  });

  it('draw 1, press Maw, then play it with Mamaw → win', () => {
    const r = drawFor(play(nine(['2S']), 'a', '9S'), 'a');
    expect(r.round.mawDebt).toEqual({ playerId: 'a', callable: false });
    rejects(r, callOut('b'), 'NOTHING_TO_CALL_OUT');
    const m = act(r, { type: 'MAW', playerId: 'a', now: 0 });
    expect(m.round.mawDebt).toBeNull();
    const w = play(m, 'a', '2S', { say: 'mamaw' });
    expect(w.round.winner).toBe('a');
  });

  it('draw 1, press Maw, not playable → pass and keep it', () => {
    const r = drawFor(play(nine(['KH']), 'a', '9S'), 'a');
    const p = passFor(act(r, { type: 'MAW', playerId: 'a', now: 0 }), 'a');
    expect(handOf(p, 'a')).toEqual(['KH']);
    expect(p.round.current).toBe('b');
    rejects(p, callOut('b'), 'NOTHING_TO_CALL_OUT');
  });

  it('forgetting that Maw before passing can be called out (or pressed late)', () => {
    const r = passFor(drawFor(play(nine(['KH']), 'a', '9S'), 'a'), 'a');
    expect(r.round.mawDebt).toEqual({ playerId: 'a', callable: true });
    expect(handOf(act(r, callOut('c')), 'a')).toHaveLength(3);
    expect(act(r, { type: 'MAW', playerId: 'a', now: 0 }).round.mawDebt).toBeNull();
  });

  it('a Jack acting as 9 as last card does not win either', () => {
    const r = play(nine(['2D'], '9H', 'JD'), 'a', 'JD', { say: 'mamaw' });
    expect(r.round.top).toMatchObject({ rank: '9', suit: 'D' });
    expect(r.round.current).toBe('a');
    expect(r.phase).toBe('playing');
  });

  it('a drawn 9 played as the last card again does not win (repeat)', () => {
    const r = drawFor(play(nine(['9D', '3D']), 'a', '9S'), 'a');
    const again = play(r, 'a', '9D', { say: 'mamaw' });
    expect(again.round.current).toBe('a');
    expect(handOf(drawFor(again, 'a'), 'a')).toEqual(['3D']);
  });

  it('in the final, Q or 8 as last card still wins (decision)', () => {
    for (const card of ['QS', '8S']) {
      const s = scenario({ players: ['a', 'b'], hands: { a: [card], b: ['3C'] }, top: '5S' });
      expect(play(s, 'a', card, { say: 'mamaw' }).round.winner).toBe('a');
    }
  });

  it('in the final, a forgotten Mamaw on Q keeps the window; called out → play again', () => {
    const s = scenario({ players: ['a', 'b'], hands: { a: ['QS'], b: ['3C'] }, top: '5S' });
    const r = play(s, 'a', 'QS', { now: 0 });
    expect(r.phase).toBe('mamawWindow');
    const c = act(r, callOut('b', 1));
    expect(c.round.current).toBe('a');
    expect(handOf(c, 'a')).toHaveLength(2);
  });
});
