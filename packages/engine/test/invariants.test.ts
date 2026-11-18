import { describe, expect, it } from 'vitest';
import { checkInvariants, type GameState } from '../src/index.js';
import { play, scenario } from './helpers.js';

const base = () =>
  scenario({ hands: { a: ['5S', '2C'], b: ['3S', '3C'], c: ['4S'] }, top: '5H', draw: ['KD'] });

/** Each corruption must be reported by checkInvariants with a message containing `expected`. */
const corruptions: [string, (s: GameState) => void][] = [
  ['card count', (s) => s.round.drawPile.pop()],
  ['duplicate', (s) => s.round.drawPile.splice(0, 1, s.round.drawPile[1] as never)],
  ['hands for players', (s) => (s.round.hands.zz = [])],
  ['wrong deck count', (s) => (s.round.deckCount = 1)],
  ['isFinal', (s) => (s.round.isFinal = true)],
  ['seats do not match', (s) => (s.players[0]!.eliminated = true)],
  ['not seated', (s) => (s.round.current = 'zz')],
  ['top does not match', (s) => (s.round.top = { ...s.round.top, card: s.round.drawPile[0]! })],
  ['modified identity', (s) => (s.round.top = { ...s.round.top, suit: 'C' })],
  ['bad pendingDraw', (s) => (s.round.pendingDraw = 3)],
  ['pending draw without a 7', (s) => (s.round.pendingDraw = 2)],
  ['pending draw after drawing', (s) => {
    s.round.top = { ...s.round.top, rank: '7' };
    s.round.pendingDraw = 2;
    s.round.turn.hasDrawn = true;
  }],
  ['drawn card not in current hand', (s) => (s.round.turn.drawnCardId = 'nope')],
  ['suit choice pending', (s) => (s.round.awaitingSuitChoice = true)],
  ['mamawWindow/phase', (s) => (s.phase = 'mamawWindow')],
  ['mamaw window for a player holding', (s) => {
    s.phase = 'mamawWindow';
    s.round.mamawWindow = { playerId: 'a', deadline: 0 };
  }],
  ['impossible hand size', (s) => (s.round.mawDebt = { playerId: 'a', callable: false })],
  ['impossible hand size', (s) => {
    s.round.hands.c = [];
    s.round.discard.unshift(...[]);
    s.round.mawDebt = { playerId: 'c', callable: true };
  }],
  ['maw debt and mamaw window', (s) => {
    s.round.mawDebt = { playerId: 'c', callable: true };
    s.round.mamawWindow = { playerId: 'c', deadline: 0 };
  }],
  ['round winner/phase', (s) => (s.phase = 'roundOver')],
  ['round winner holds cards', (s) => (s.round.winner = 'a')],
  ['game winner/phase', (s) => (s.winner = 'a')],
  ['game winner is not the only', (s) => {
    s.phase = 'gameOver';
    s.winner = 'a';
  }],
  ['fewer than 2', (s) => {
    s.phase = 'roundOver';
    s.players.forEach((p) => (p.eliminated = p.id !== 'a'));
  }],
];

describe('checkInvariants', () => {
  it('accepts valid states', () => {
    expect(checkInvariants(base())).toEqual([]);
    expect(checkInvariants(play(base(), 'a', '5S'))).toEqual([]);
  });

  it('tolerates references to players without a hand', () => {
    const s = base();
    delete s.round.hands.c;
    s.round.current = 'zz';
    s.round.turn.drawnCardId = 'x';
    s.phase = 'mamawWindow';
    s.round.mamawWindow = { playerId: 'zz', deadline: 0 };
    s.round.mawDebt = { playerId: 'zz', callable: true };
    s.round.winner = 'zz';
    const errors = checkInvariants(s);
    expect(errors).toContain('card count 103 !== 104');
    expect(errors).toContain('maw debt with an impossible hand size');
  });

  it.each(corruptions.map(([msg, fn], i) => [`${i}: ${msg}`, msg, fn] as const))(
    'detects %s',
    (_, msg, corrupt) => {
      const s = base();
      corrupt(s);
      expect(checkInvariants(s).join('\n')).toContain(msg);
    },
  );
});
