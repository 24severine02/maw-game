import type { Action, Card, GameState, Rank, Suit } from '@maw/engine';

const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function cardLabel(rank: Rank, suit: Suit): string {
  return `${rank}${SUIT_SYMBOL[suit]}`;
}

/**
 * Human-readable log lines for one applied action. Only uses public
 * information: drawn cards are never named.
 */
export function describe(
  before: GameState,
  action: Action,
  after: GameState,
  name: (id: string) => string,
): string[] {
  const lines: string[] = [];
  const b = before.round;
  const a = after.round;
  const who = 'playerId' in action ? name(action.playerId) : '';

  switch (action.type) {
    case 'PLAY': {
      const card = b.hands[action.playerId]?.find((c) => c.id === action.cardId) as Card;
      let text = `${who} played ${cardLabel(card.rank, card.suit)}`;
      if (card.rank === 'J' && a.top.rank !== 'J') text += ` as ${cardLabel(a.top.rank, a.top.suit)}`;
      else if (card.rank === 'J') text += ` and chose ${SUIT_SYMBOL[a.top.suit]}`;
      if (action.say === 'maw') text += ' — Maw!';
      if (action.say === 'mamaw') text += ' — Mamaw!';
      lines.push(text);
      break;
    }
    case 'DRAW': {
      const drawn = (a.hands[action.playerId]?.length ?? 0) - (b.hands[action.playerId]?.length ?? 0);
      if (b.pendingDraw > 0) lines.push(`${who} drew ${drawn} (+${b.pendingDraw})`);
      else if (drawn === 0) lines.push(`${who} tried to draw, but no cards are left`);
      else lines.push(`${who} drew a card`);
      break;
    }
    case 'PASS':
      lines.push(`${who} passed`);
      break;
    case 'MAW':
      lines.push(`${who}: Maw!`);
      break;
    case 'MAMAW':
      lines.push(`${who}: Mamaw! Just in time`);
      break;
    case 'CALL_OUT': {
      const target = b.mamawWindow?.playerId ?? b.mawDebt?.playerId ?? '';
      lines.push(`${who} called out ${name(target)}! ${name(target)} draws 2`);
      break;
    }
    case 'CHOOSE_SUIT':
      lines.push(`${who} chose ${SUIT_SYMBOL[action.suit]}`);
      break;
    case 'NEXT_ROUND': {
      const final = a.isFinal ? 'Final round' : `Round ${a.number}`;
      lines.push(
        `${final}: ${a.seats.length} players, ${a.deckCount} deck${a.deckCount > 1 ? 's' : ''}. ` +
          `Starting card ${cardLabel(a.top.card.rank, a.top.card.suit)}. ${name(a.current)} starts.`,
      );
      break;
    }
    case 'TICK':
      break;
  }

  if (before.phase !== 'mamawWindow' && after.phase === 'mamawWindow' && a.mamawWindow) {
    lines.push(`${name(a.mamawWindow.playerId)} forgot to press Mamaw! 5 seconds to call them out…`);
  }
  if (after.results.length > before.results.length) {
    const r = after.results[after.results.length - 1]!;
    const points = Object.entries(r.points)
      .map(([id, p]) => `${name(id)} ${p}`)
      .join(', ');
    lines.push(`${name(r.winner)} wins round ${r.round}! Points: ${points}. Eliminated: ${r.eliminated.map(name).join(', ')}.`);
  }
  if (after.phase === 'gameOver' && after.winner) lines.push(`🏆 ${name(after.winner)} wins the game!`);
  return lines;
}
