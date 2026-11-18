import type { Rank, Suit } from '@maw/engine';
import { isRed, SUIT_SYMBOL } from '@/lib/client';

interface Props {
  rank?: Rank;
  suit?: Suit;
  /** Face-down card. */
  back?: boolean;
  playable?: boolean;
  dim?: boolean;
  highlight?: boolean;
  size?: 'normal' | 'small';
  onClick?: () => void;
  label?: string;
}

export function PlayingCard({ rank, suit, back, playable, dim, highlight, size = 'normal', onClick, label }: Props) {
  const cls = [
    'card',
    size,
    back ? 'back' : suit && isRed(suit) ? 'red' : 'black',
    playable ? 'playable' : '',
    dim ? 'dim' : '',
    highlight ? 'highlight' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const content =
    back || !rank || !suit ? null : (
      <>
        <span className="corner">
          {rank}
          <br />
          {SUIT_SYMBOL[suit]}
        </span>
        <span className="pip">{SUIT_SYMBOL[suit]}</span>
        <span className="corner flip">
          {rank}
          <br />
          {SUIT_SYMBOL[suit]}
        </span>
      </>
    );
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-label={label ?? (back ? 'card' : `${rank} of ${suit}`)}>
        {content}
      </button>
    );
  }
  return (
    <div className={cls} aria-label={label}>
      {content}
    </div>
  );
}
