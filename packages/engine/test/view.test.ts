import { describe, expect, it } from 'vitest';
import {
  chooseBotAction,
  getLegalActions,
  getPlayerView,
  legalActionsFor,
  makeRandom,
  reduce,
  type Action,
} from '../src/index.js';
import { act, drawFor, id, play, scenario } from './helpers.js';

describe('getPlayerView', () => {
  const s = () =>
    scenario({
      players: ['a', 'b', 'c', 'x'],
      eliminated: ['x'],
      hands: { a: ['5S', '2C'], b: ['3S', '9D', 'KD'], c: ['4S'] },
      top: '5H',
      draw: ['QH'],
    });

  it("shows only the viewer's own hand; others are counts", () => {
    const state = s();
    const v = getPlayerView(state, 'b');
    expect(v.hand.map((c) => c.id)).toEqual(state.round.hands.b?.map((c) => c.id));
    expect(v.players.map((p) => [p.id, p.handCount, p.inRound, p.eliminated])).toEqual([
      ['a', 2, true, false],
      ['b', 3, true, false],
      ['c', 1, true, false],
      ['x', 0, false, true],
    ]);
    const json = JSON.stringify(v);
    for (const other of ['a', 'c']) {
      for (const card of state.round.hands[other] ?? []) expect(json).not.toContain(card.id);
    }
    for (const card of state.round.drawPile) expect(json).not.toContain(card.id);
    expect(json).not.toContain('"rng"');
  });

  it('exposes the drawn card only to the player who drew it', () => {
    const d = drawFor(s(), 'a');
    const drawn = d.round.turn.drawnCardId as string;
    expect(getPlayerView(d, 'a').round.drawnCardId).toBe(drawn);
    expect(getPlayerView(d, 'b').round.drawnCardId).toBeNull();
    expect(getPlayerView(d, 'b').round.currentHasDrawn).toBe(true);
    expect(JSON.stringify(getPlayerView(d, 'b'))).not.toContain(drawn);
  });

  it('spectators and strangers see no hand and have no actions', () => {
    for (const viewer of ['x', 'nobody']) {
      const v = getPlayerView(s(), viewer);
      expect(v.isSpectator).toBe(true);
      expect(v.hand).toEqual([]);
      expect(getLegalActions(v, 0)).toEqual([]);
    }
  });

  it('is a detached copy', () => {
    const state = s();
    const v = getPlayerView(state, 'a');
    v.hand.pop();
    expect(state.round.hands.a).toHaveLength(2);
  });
});

/** Every legal action is accepted by the reducer. */
function expectAllAccepted(state: ReturnType<typeof scenario>, actions: Action[]): void {
  for (const a of actions) {
    const res = reduce(state, a);
    expect(res.ok, `${JSON.stringify(a)} → ${res.ok ? '' : res.error.code}`).toBe(true);
  }
}

describe('getLegalActions', () => {
  it('lists matching plays plus DRAW for the current player', () => {
    const state = scenario({ hands: { a: ['5S', '2H', 'KD', 'JC'], b: ['3S'], c: ['4S'] }, top: '5H' });
    const acts = legalActionsFor(state, 'a', 7);
    const plays = acts.filter((a) => a.type === 'PLAY');
    // 5S, 2H, and JC × 4 suits
    expect(plays).toHaveLength(6);
    expect(acts.at(-1)).toEqual({ type: 'DRAW', playerId: 'a', now: 7 });
    expect(acts.every((a) => a.now === 7)).toBe(true);
    expectAllAccepted(state, acts);
    expect(legalActionsFor(state, 'b', 0)).toEqual([]);
  });

  it('includes both the declared and the forgetful variant when going to 1 or 0 cards', () => {
    const one = scenario({ hands: { a: ['5S', '2C'], b: ['3S'], c: ['4S'] }, top: '5H' });
    expect(legalActionsFor(one, 'a', 0).map((a) => (a.type === 'PLAY' ? a.say ?? '-' : a.type))).toEqual([
      '-',
      'maw',
      'DRAW',
    ]);
    const zero = scenario({ hands: { a: ['5S'], b: ['3S'], c: ['4S'] }, top: '5H' });
    expect(legalActionsFor(zero, 'a', 0).map((a) => (a.type === 'PLAY' ? a.say ?? '-' : a.type))).toEqual([
      '-',
      'mamaw',
      'DRAW',
    ]);
  });

  it('after drawing: only the drawn card (if playable) and PASS', () => {
    const state = drawFor(
      scenario({ hands: { a: ['5S', '2C'], b: ['3S'], c: ['4S'] }, top: '5H', draw: ['6H'] }),
      'a',
    );
    const acts = legalActionsFor(state, 'a', 0);
    expect(acts.map((a) => a.type)).toEqual(['PLAY', 'PASS']);
    expectAllAccepted(state, acts);
  });

  it('facing a pending draw: only 7s, Jacks and DRAW', () => {
    const state = scenario({
      hands: { a: ['7S', 'JD', '5H', '2H'], b: ['3S'], c: ['4S'] },
      top: '7H',
      pendingDraw: 2,
    });
    const acts = legalActionsFor(state, 'a', 0);
    expect(acts.map((a) => (a.type === 'PLAY' ? id(state, 'a', '7S') === a.cardId : a.type))).toEqual([
      true,
      false,
      'DRAW',
    ]);
    expectAllAccepted(state, acts);
  });

  it('suit choice, MAW and CALL_OUT', () => {
    const sj = scenario({ hands: { a: ['2H'], b: ['3S'], c: ['4S'] }, top: 'JC' });
    sj.round.awaitingSuitChoice = true;
    expect(legalActionsFor(sj, 'a', 0).map((a) => a.type)).toEqual(Array(4).fill('CHOOSE_SUIT'));
    expectAllAccepted(sj, legalActionsFor(sj, 'a', 0));

    const nine = drawFor(
      play(scenario({ hands: { a: ['9S'], b: ['3C'], c: ['4C'] }, top: '5S', draw: ['KH'] }), 'a', '9S'),
      'a',
    );
    expect(legalActionsFor(nine, 'a', 0).map((a) => a.type)).toEqual(['MAW', 'PASS']);

    const forgot = play(scenario({ hands: { a: ['5S', '2C'], b: ['3S'], c: ['4S'] }, top: '5H' }), 'a', '5S');
    expect(legalActionsFor(forgot, 'c', 0)).toEqual([{ type: 'CALL_OUT', playerId: 'c', now: 0 }]);
    expect(legalActionsFor(forgot, 'a', 0)).toEqual([{ type: 'MAW', playerId: 'a', now: 0 }]);
    expect(legalActionsFor(forgot, 'b', 0).map((a) => a.type)).toContain('CALL_OUT');
  });

  it('mamaw window: CALL_OUT for others until the deadline; nothing in roundOver', () => {
    const w = play(scenario({ hands: { a: ['5S'], b: ['3S'], c: ['4S'] }, top: '5H' }), 'a', '5S', { now: 0 });
    expect(legalActionsFor(w, 'b', 4999)).toEqual([{ type: 'CALL_OUT', playerId: 'b', now: 4999 }]);
    expect(legalActionsFor(w, 'b', 5000)).toEqual([]);
    expect(legalActionsFor(w, 'a', 0)).toEqual([{ type: 'MAMAW', playerId: 'a', now: 0 }]);
    expect(legalActionsFor(w, 'a', 5000)).toEqual([]);
    const over = act(w, { type: 'TICK', now: 5000 });
    expect(legalActionsFor(over, 'b', 0)).toEqual([]);
  });
});

describe('bot', () => {
  it('only returns legal actions, or null when idle', () => {
    const state = scenario({ hands: { a: ['5S', '2C'], b: ['3S'], c: ['4S'] }, top: '5H' });
    const rand = makeRandom(1);
    for (let i = 0; i < 50; i++) {
      const a = chooseBotAction(getPlayerView(state, 'a'), 0, rand);
      expect(legalActionsFor(state, 'a', 0)).toContainEqual(a);
    }
    expect(chooseBotAction(getPlayerView(state, 'b'), 0, rand)).toBeNull();
    expect(chooseBotAction(getPlayerView(state, 'x'), 0, rand)).toBeNull();
  });

  it('default bot declares correctly, calls out, and chooses suits', () => {
    const rand = makeRandom(2);
    const one = scenario({ hands: { a: ['5S', '2C'], b: ['3S'], c: ['4S'] }, top: '5H' });
    expect(chooseBotAction(getPlayerView(one, 'a'), 0, rand)).toMatchObject({ type: 'PLAY', say: 'maw' });

    const forgot = play(one, 'a', '5S');
    expect(chooseBotAction(getPlayerView(forgot, 'c'), 0, rand)).toMatchObject({ type: 'CALL_OUT' });

    const sj = scenario({ hands: { a: ['2H'], b: ['3S'], c: ['4S'] }, top: 'JC' });
    sj.round.awaitingSuitChoice = true;
    expect(chooseBotAction(getPlayerView(sj, 'a'), 0, rand)?.type).toBe('CHOOSE_SUIT');

    const nine = drawFor(
      play(scenario({ hands: { a: ['9S'], b: ['3C'], c: ['4C'] }, top: '5S', draw: ['KH'] }), 'a', '9S'),
      'a',
    );
    expect(chooseBotAction(getPlayerView(nine, 'a'), 0, rand)?.type).toBe('MAW');
  });

  it('a forgetful, draw-happy bot forgets declarations and draws voluntarily', () => {
    const one = scenario({ hands: { a: ['5S', '2C'], b: ['3S'], c: ['4S'] }, top: '5H' });
    const forgetful = { callOutRate: 0, declareRate: 0, playRate: 1, latePressRate: 0 };
    expect(chooseBotAction(getPlayerView(one, 'a'), 0, makeRandom(3), forgetful)).toMatchObject({ type: 'PLAY' });
    expect(
      (chooseBotAction(getPlayerView(one, 'a'), 0, makeRandom(3), forgetful) as { say?: string }).say,
    ).toBeUndefined();
    expect(
      chooseBotAction(getPlayerView(one, 'a'), 0, makeRandom(3), { ...forgetful, playRate: 0 })?.type,
    ).toBe('DRAW');
    const forgot = play(one, 'a', '5S');
    expect(chooseBotAction(getPlayerView(forgot, 'c'), 0, makeRandom(3), forgetful)).toBeNull();
    expect(chooseBotAction(getPlayerView(forgot, 'a'), 0, makeRandom(3), forgetful)).toBeNull();
  });

  it('a bot that forgot presses Maw/Mamaw late when latePressRate allows', () => {
    const late = { callOutRate: 0, declareRate: 0, playRate: 1, latePressRate: 1 };
    const forgot = play(scenario({ hands: { a: ['5S', '2C'], b: ['3S'], c: ['4S'] }, top: '5H' }), 'a', '5S');
    expect(chooseBotAction(getPlayerView(forgot, 'a'), 0, makeRandom(4), late)?.type).toBe('MAW');
    const w = play(scenario({ hands: { a: ['5S'], b: ['3S'], c: ['4S'] }, top: '5H' }), 'a', '5S', { now: 0 });
    expect(chooseBotAction(getPlayerView(w, 'a'), 10, makeRandom(4), late)?.type).toBe('MAMAW');
  });
});
