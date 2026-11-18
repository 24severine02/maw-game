import { describe, expect, it } from 'vitest';
import type { Suit } from '../src/index.js';
import { act, drawFor, handOf, id, play, rejects, scenario } from './helpers.js';

const base = () =>
  scenario({
    hands: { a: ['5H', '9S', 'KD', '2C'], b: ['3C', '4C'], c: ['6D', 'AD'] },
    top: '5S',
  });

describe('legal moves (§2.1)', () => {
  it('matches suit', () => {
    const s = play(base(), 'a', '9S');
    expect(s.round.top.card.rank).toBe('9');
  });

  it('matches rank', () => {
    const s = play(base(), 'a', '5H');
    expect(s.round.top).toMatchObject({ rank: '5', suit: 'H' });
    expect(s.round.current).toBe('b');
    expect(handOf(s, 'a')).toEqual(['9S', 'KD', '2C']);
    expect(s.round.discard).toHaveLength(2);
  });

  it('rejects a card that matches neither', () => {
    rejects(base(), { type: 'PLAY', playerId: 'a', cardId: id(base(), 'a', 'KD'), now: 0 }, 'ILLEGAL_CARD');
  });

  it('rejects playing out of turn, unknown cards and non-players', () => {
    const s = base();
    rejects(s, { type: 'PLAY', playerId: 'b', cardId: id(s, 'b', '3C'), now: 0 }, 'NOT_YOUR_TURN');
    rejects(s, { type: 'PLAY', playerId: 'a', cardId: id(s, 'b', '3C'), now: 0 }, 'CARD_NOT_IN_HAND');
    rejects(s, { type: 'PLAY', playerId: 'zed', cardId: 'x', now: 0 }, 'NOT_A_PLAYER');
    rejects(s, { type: 'DRAW', playerId: 'b', now: 0 }, 'NOT_YOUR_TURN');
    rejects(s, { type: 'PASS', playerId: 'b', now: 0 }, 'NOT_YOUR_TURN');
  });

  it('turn order wraps around the table', () => {
    const s = scenario({ hands: { a: ['2H', '3H'], b: ['4H', '5H'], c: ['6H', '7C'] }, top: '9H', current: 'c' });
    expect(play(s, 'c', '6H').round.current).toBe('a');
  });

  it('rejects suit choices and declarations that do not apply', () => {
    const s = base();
    rejects(s, { type: 'PLAY', playerId: 'a', cardId: id(s, 'a', '5H'), chosenSuit: 'C', now: 0 }, 'SUIT_NOT_ALLOWED');
    rejects(s, { type: 'PLAY', playerId: 'a', cardId: id(s, 'a', '5H'), say: 'maw', now: 0 }, 'INVALID_DECLARATION');
    rejects(s, { type: 'PLAY', playerId: 'a', cardId: id(s, 'a', '5H'), say: 'mamaw', now: 0 }, 'INVALID_DECLARATION');
  });
});

describe('Queen: reverse (§3)', () => {
  it('reverses direction with 3+ players', () => {
    const s = scenario({ hands: { a: ['QS', '2C'], b: ['3C'], c: ['4S', '5C'] }, top: '5S' });
    const r = play(s, 'a', 'QS');
    expect(r.round.direction).toBe(-1);
    expect(r.round.current).toBe('c');
    const r2 = play(r, 'c', '4S');
    expect(r2.round.current).toBe('b');
  });

  it('a second Queen restores direction', () => {
    const s = scenario({
      hands: { a: ['QS', '2C', '9D'], b: ['3C', '4D'], c: ['QD', '5C'] },
      top: '5S',
    });
    const r = play(play(s, 'a', 'QS'), 'c', 'QD');
    expect(r.round.direction).toBe(1);
    expect(r.round.current).toBe('a');
  });
});

describe('8: skip (§3)', () => {
  it('skips the next player', () => {
    const s = scenario({ hands: { a: ['8S', '2C'], b: ['3C'], c: ['4C', '5C'] }, top: '5S' });
    expect(play(s, 'a', '8S').round.current).toBe('c');
  });

  it('skips in the current direction', () => {
    const s = scenario({
      hands: { a: ['8S', '2C'], b: ['3C'], c: ['4C', '5C'], d: ['6C', '7D'] },
      players: ['a', 'b', 'c', 'd'],
      top: '5S',
      direction: -1,
    });
    expect(play(s, 'a', '8S').round.current).toBe('c');
  });
});

describe('9: play again (§3)', () => {
  it('the same player plays again', () => {
    const s = scenario({ hands: { a: ['9S', '2S', '4D'], b: ['3C'], c: ['4C'] }, top: '5S' });
    const r = play(s, 'a', '9S');
    expect(r.round.current).toBe('a');
    expect(play(r, 'a', '2S').round.current).toBe('b');
  });

  it('if they cannot follow up they follow §2 (draw, then play or pass)', () => {
    const s = scenario({ hands: { a: ['9S', '4D', '5D'], b: ['3C'], c: ['4C'] }, top: '5S', draw: ['KC'] });
    const r = drawFor(play(s, 'a', '9S'), 'a');
    expect(r.round.turn.drawnCardId).not.toBeNull();
    expect(act(r, { type: 'PASS', playerId: 'a', now: 0 }).round.current).toBe('b');
  });
});

describe('7: draw 2, stacking (§3)', () => {
  const s7 = () =>
    scenario({
      hands: { a: ['7S', '2C', '3C'], b: ['7H', 'JD', '4H', '2H'], c: ['7C', '5D', '6D'] },
      top: '5S',
      draw: ['KC', 'KD', 'KH', 'KS', 'QC', 'QD'],
    });

  it('next player draws 2 and then continues their turn', () => {
    const r = play(s7(), 'a', '7S');
    expect(r.round.pendingDraw).toBe(2);
    expect(r.round.current).toBe('b');
    const d = drawFor(r, 'b');
    expect(d.round.pendingDraw).toBe(0);
    expect(handOf(d, 'b')).toEqual(['7H', 'JD', '4H', '2H', 'KC', 'KD']);
    expect(d.round.current).toBe('b');
    expect(d.round.turn.hasDrawn).toBe(false);
  });

  it('after drawing, may play a card of the current suit', () => {
    const d = drawFor(play(s7(), 'a', '7S'), 'b');
    rejects(d, { type: 'PLAY', playerId: 'b', cardId: id(d, 'b', 'KC'), now: 0 }, 'ILLEGAL_CARD');
    const s = scenario({
      hands: { a: ['7S', '2C', '3C'], b: ['4S', '5H'], c: ['5D', '6D'] },
      top: '5S',
    });
    const r = play(drawFor(play(s, 'a', '7S'), 'b'), 'b', '4S');
    expect(r.round.current).toBe('c');
    expect(r.round.pendingDraw).toBe(0);
  });

  it('after drawing, may play a 7 (starting a fresh +2) or draw 1 per §2', () => {
    const d = drawFor(play(s7(), 'a', '7S'), 'b');
    const r = play(d, 'b', '7H');
    expect(r.round.pendingDraw).toBe(2);
    const d2 = drawFor(d, 'b');
    expect(d2.round.turn.hasDrawn).toBe(true);
    expect(handOf(d2, 'b')).toHaveLength(7);
  });

  it('facing a pending draw only a 7 or a Jack may be played', () => {
    const r = play(s7(), 'a', '7S');
    rejects(r, { type: 'PLAY', playerId: 'b', cardId: id(r, 'b', '2H'), now: 0 }, 'ILLEGAL_CARD');
    rejects(r, { type: 'PASS', playerId: 'b', now: 0 }, 'CANNOT_PASS');
  });

  it('stacks: 7 on 7 passes +4, the next player draws 4', () => {
    const r = play(play(s7(), 'a', '7S'), 'b', '7H');
    expect(r.round.pendingDraw).toBe(4);
    expect(r.round.current).toBe('c');
    const r2 = play(r, 'c', '7C');
    expect(r2.round.pendingDraw).toBe(6);
    const d = drawFor(r2, 'a');
    expect(handOf(d, 'a')).toHaveLength(2 + 6);
  });

  it('a Jack acts as a 7 of its own suit and stacks', () => {
    const r = play(play(s7(), 'a', '7S'), 'b', 'JD');
    expect(r.round.top).toMatchObject({ rank: '7', suit: 'D' });
    expect(r.round.pendingDraw).toBe(4);
    // c may answer with a 7 ...
    expect(play(r, 'c', '7C').round.pendingDraw).toBe(6);
    // ... or draw 4, then play a ♦ (the Jack's suit)
    const d = drawFor(r, 'c');
    expect(handOf(d, 'c')).toHaveLength(7);
    expect(play(d, 'c', '5D').round.current).toBe('a');
  });

  it('a Jack on a Jack-acting-as-7 still counts as a 7 (§6.4)', () => {
    const s = scenario({
      hands: { a: ['JS', '2C'], b: ['JH', '4H'], c: ['5D', '6D'] },
      top: '7C',
      topAs: '7C',
      pendingDraw: 2,
    });
    const r = play(play(s, 'a', 'JS'), 'b', 'JH');
    expect(r.round.top).toMatchObject({ rank: '7', suit: 'H' });
    expect(r.round.pendingDraw).toBe(6);
  });

  it('a Jack on a resolved 7 still copies the 7', () => {
    const s = scenario({ hands: { a: ['JS', '2C'], b: ['4H'], c: ['5D'] }, top: '7C' });
    const r = play(s, 'a', 'JS');
    expect(r.round.pendingDraw).toBe(2);
    rejects(s, { type: 'PLAY', playerId: 'a', cardId: id(s, 'a', 'JS'), chosenSuit: 'H', now: 0 }, 'SUIT_NOT_ALLOWED');
  });
});

describe('Jack (§3)', () => {
  it('can be played on anything', () => {
    for (const top of ['2H', '10C', 'KD', 'AS']) {
      const s = scenario({ hands: { a: ['JS', '3D'], b: ['4H'], c: ['5D'] }, top });
      expect(play(s, 'a', 'JS', { chosenSuit: 'H' }).round.current).toBe('b');
    }
  });

  it('on a non-special card the player chooses the new suit', () => {
    const s = scenario({ hands: { a: ['JS', '3D'], b: ['4H', 'KH', '2S'], c: ['5D'] }, top: '2C' });
    const r = play(s, 'a', 'JS', { chosenSuit: 'H' });
    expect(r.round.top).toMatchObject({ rank: 'J', suit: 'H' });
    rejects(r, { type: 'PLAY', playerId: 'b', cardId: id(r, 'b', '2S'), now: 0 }, 'ILLEGAL_CARD');
    expect(play(r, 'b', 'KH').round.top.suit).toBe('H');
  });

  it('may keep its own suit or pick any suit, but a choice is required', () => {
    const s = scenario({ hands: { a: ['JS', '3D'], b: ['4H'], c: ['5D'] }, top: '2C' });
    for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
      expect(play(s, 'a', 'JS', { chosenSuit: suit }).round.top.suit).toBe(suit);
    }
    rejects(s, { type: 'PLAY', playerId: 'a', cardId: id(s, 'a', 'JS'), now: 0 }, 'SUIT_REQUIRED');
    rejects(
      s,
      { type: 'PLAY', playerId: 'a', cardId: id(s, 'a', 'JS'), chosenSuit: 'X' as Suit, now: 0 },
      'INVALID_SUIT',
    );
  });

  it.each([
    ['QH', 'Q', (r: ReturnType<typeof scenario>) => expect(r.round.direction).toBe(-1)],
    ['8H', '8', (r: ReturnType<typeof scenario>) => expect(r.round.current).toBe('c')],
    ['9H', '9', (r: ReturnType<typeof scenario>) => expect(r.round.current).toBe('a')],
    ['7H', '7', (r: ReturnType<typeof scenario>) => expect(r.round.pendingDraw).toBe(2)],
  ] as const)('on %s copies its rank and effect with the Jack suit', (top, rank, check) => {
    const s = scenario({ hands: { a: ['JS', '3D'], b: ['4H'], c: ['5D'] }, top });
    const r = play(s, 'a', 'JS');
    expect(r.round.top).toMatchObject({ rank, suit: 'S' });
    check(r);
  });

  it('J♠ on 7♥ = 7♠: next player answers with a 7, a Jack, or draws then plays a ♠', () => {
    const s = scenario({ hands: { a: ['JS', '3D'], b: ['2S', '2H', 'KC'], c: ['5D'] }, top: '7H' });
    const r = play(s, 'a', 'JS');
    const d = drawFor(r, 'b');
    rejects(d, { type: 'PLAY', playerId: 'b', cardId: id(d, 'b', '2H'), now: 0 }, 'ILLEGAL_CARD');
    expect(play(d, 'b', '2S').round.top.suit).toBe('S');
  });

  it('a Jack can always be played on a Jack; on a wild Jack it chooses a suit again', () => {
    const s = scenario({ hands: { a: ['JS', '3D'], b: ['JH', '4H'], c: ['5D'] }, top: '2C' });
    const r = play(play(s, 'a', 'JS', { chosenSuit: 'D' }), 'b', 'JH', { chosenSuit: 'C' });
    expect(r.round.top).toMatchObject({ rank: 'J', suit: 'C' });
  });

  it('a Jack on a Jack-acting-as-9 copies the 9', () => {
    const s = scenario({ hands: { a: ['JS', 'JD', '3D'], b: ['4H'], c: ['5D'] }, top: '9C' });
    const r = play(play(s, 'a', 'JS'), 'a', 'JD');
    expect(r.round.top).toMatchObject({ rank: '9', suit: 'D' });
    expect(r.round.current).toBe('a');
  });
});

describe('final round with 2 players (§3)', () => {
  const two = (a: string[], top = '5S') =>
    scenario({ players: ['a', 'b'], hands: { a, b: ['2H', '3H'] }, top });

  it.each(['QS', '8S', '9S'])('%s means play again', (card) => {
    const r = play(two([card, '4S', '6S']), 'a', card);
    expect(r.round.current).toBe('a');
    expect(r.round.direction).toBe(1);
  });

  it.each(['QD', '8D', '9D'])('a Jack copying %s in the final also means play again', (top) => {
    const r = play(two(['JS', '4S', '6S'], top), 'a', 'JS');
    expect(r.round.current).toBe('a');
  });

  it('7 still makes the other player draw 2', () => {
    const r = play(two(['7S', '4S']), 'a', '7S');
    expect(r.round.current).toBe('b');
    expect(r.round.pendingDraw).toBe(2);
  });
});

describe('starting Jack suit choice', () => {
  const sj = () => {
    const s = scenario({ hands: { a: ['2H', '3H'], b: ['4H'], c: ['5D'] }, top: 'JC' });
    s.round.awaitingSuitChoice = true;
    return s;
  };

  it('blocks play and draw until chosen', () => {
    const s = sj();
    rejects(s, { type: 'PLAY', playerId: 'a', cardId: id(s, 'a', '2H'), now: 0 }, 'AWAITING_SUIT_CHOICE');
    rejects(s, { type: 'DRAW', playerId: 'a', now: 0 }, 'AWAITING_SUIT_CHOICE');
    rejects(s, { type: 'CHOOSE_SUIT', playerId: 'b', suit: 'H', now: 0 }, 'NOT_YOUR_TURN');
    rejects(s, { type: 'CHOOSE_SUIT', playerId: 'a', suit: 'Z' as Suit, now: 0 }, 'INVALID_SUIT');
    const r = act(s, { type: 'CHOOSE_SUIT', playerId: 'a', suit: 'H', now: 0 });
    expect(play(r, 'a', '2H').round.current).toBe('b');
  });

  it('rejects CHOOSE_SUIT when no choice is pending', () => {
    const s = scenario({ hands: { a: ['2H'], b: ['4H'], c: ['5D'] }, top: '3C' });
    rejects(s, { type: 'CHOOSE_SUIT', playerId: 'a', suit: 'H', now: 0 }, 'NO_SUIT_CHOICE_PENDING');
  });
});
