'use client';

import { getLegalActions, SUITS, type Action, type Card, type Suit } from '@maw/engine';
import type { Ack, PlayerAction, RoomView } from '@maw/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cardText, SUIT_NAME, SUIT_SYMBOL, isRed, useNow } from '@/lib/client';
import { PlayingCard } from './PlayingCard';
import { AnnouncementBanner } from './AnnouncementBanner';

interface Props {
  view: RoomView;
  act: (action: PlayerAction) => Promise<Ack>;
  serverNow: () => number;
  reset: () => Promise<Ack>;
  leave: () => void;
}

type PlayAction = Extract<Action, { type: 'PLAY' }>;

const strip = (a: Action): PlayerAction => {
  const { playerId: _p, now: _n, ...rest } = a as Action & { playerId: string };
  return rest as PlayerAction;
};

export function Table({ view, act, serverNow, reset, leave }: Props) {
  const g = view.game!;
  const r = g.round;
  const me = view.you;
  const [armed, setArmed] = useState<'maw' | 'mamaw' | null>(null);
  const [suitFor, setSuitFor] = useState<Card | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticking = g.phase === 'mamawWindow' || g.phase === 'roundOver';
  useNow(ticking);
  const now = serverNow();

  const names = useMemo(() => new Map(view.members.map((m) => [m.id, m.name])), [view.members]);
  const name = (id: string) => (id === me ? 'You' : (names.get(id) ?? '?'));
  const legal = getLegalActions(g, now);
  const has = (type: Action['type']) => legal.find((a) => a.type === type);
  const plays = legal.filter((a): a is PlayAction => a.type === 'PLAY');
  const playableIds = new Set(plays.map((p) => p.cardId));
  const myTurn = r.current === me && g.phase === 'playing' && !g.isSpectator;

  // Disarm Maw/Mamaw once it's no longer my turn.
  useEffect(() => {
    if (!myTurn) setArmed(null);
    setSuitFor(null);
  }, [myTurn, r.top.card.id]);

  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };
  const send = async (a: Action) => {
    const res = await act(strip(a));
    if (!res.ok) flash(res.error);
  };

  /** The PLAY for this card and suit, with the armed declaration if it applies. */
  const playFor = (cardId: string, suit: Suit | undefined): PlayAction | undefined => {
    const options = plays.filter((p) => p.cardId === cardId && p.chosenSuit === suit);
    return options.find((p) => p.say === armed && armed !== null) ?? options.find((p) => p.say === undefined);
  };

  const onCard = (card: Card) => {
    if (!myTurn) return;
    const options = plays.filter((p) => p.cardId === card.id);
    if (options.length === 0) {
      flash(r.currentHasDrawn ? 'You can only play the card you just drew, or pass' : `${cardText(card.rank, card.suit)} can’t be played on ${cardText(r.top.rank, r.top.suit)}`);
      return;
    }
    if (options.some((p) => p.chosenSuit !== undefined)) {
      setSuitFor(card);
      return;
    }
    const p = playFor(card.id, undefined);
    if (p) void send(p).then(() => setArmed(null));
  };

  const chooseSuit = (suit: Suit) => {
    const card = suitFor;
    setSuitFor(null);
    if (card) {
      const p = playFor(card.id, suit);
      if (p) void send(p).then(() => setArmed(null));
    } else {
      const c = legal.find((a) => a.type === 'CHOOSE_SUIT' && a.suit === suit);
      if (c) void send(c);
    }
  };

  // Maw/Mamaw: sent at once when owed (late press, or no-win-on-a-9); otherwise armed for the next card.
  const mawNow = has('MAW');
  const mamawNow = has('MAMAW');
  const canArm = myTurn && g.phase === 'playing';
  const onMaw = () => {
    if (mawNow) void send(mawNow);
    else setArmed((a) => (a === 'maw' ? null : 'maw'));
  };
  const onMamaw = () => {
    if (mamawNow) void send(mamawNow);
    else setArmed((a) => (a === 'mamaw' ? null : 'mamaw'));
  };
  const callOut = has('CALL_OUT');
  const draw = has('DRAW');
  const pass = has('PASS');
  const chooseStartSuit = myTurn && r.awaitingSuitChoice;

  // Seats starting after me, so the table reads clockwise from my left.
  const seatsFromMe = (() => {
    const i = r.seats.indexOf(me);
    return i < 0 ? r.seats : [...r.seats.slice(i + 1), ...r.seats.slice(0, i)];
  })();
  const spectators = view.members.filter((m) => !r.seats.includes(m.id));
  const handCount = (id: string) => g.players.find((p) => p.id === id)?.handCount ?? 0;

  const status = (() => {
    if (g.phase === 'gameOver') return `🏆 ${name(g.winner!)} ${g.winner === me ? 'win' : 'wins'} the game!`;
    if (g.phase === 'roundOver') return `${name(r.winner!)} ${r.winner === me ? 'win' : 'wins'} the round!`;
    if (g.phase === 'mamawWindow' && r.mamawWindow) {
      const s = Math.max(0, Math.ceil((r.mamawWindow.deadline - now) / 1000));
      return r.mamawWindow.playerId === me
        ? `Quick, press Mamaw before someone calls you out! ${s}s`
        : `${name(r.mamawWindow.playerId)} forgot Mamaw! Call them out! ${s}s`;
    }
    if (r.mawDebt?.playerId === me && r.mawDebt.callable) return 'You forgot Maw! Press it before someone calls you out!';
    if (g.isSpectator) return `You’re spectating. ${name(r.current)}’s turn`;
    if (!myTurn) return `${name(r.current)}’s turn`;
    if (r.awaitingSuitChoice) return 'The starting card is a Jack: choose the suit';
    if (r.pendingDraw > 0) return `Draw ${r.pendingDraw}, or stack a 7 or a Jack`;
    if (r.currentHasDrawn) return 'Play the card you drew, or pass';
    if (g.hand.length === 0) return 'No win on a 9: draw a card';
    return 'Your turn: play a card or draw';
  })();

  const topIsActing = r.top.card.rank === 'J';
  const lastResult = g.results.at(-1);

  return (
    <main className="table">
      <header className="table-head">
        <span className="logo small">Maw</span>
        <span className="pill">
          {r.isFinal ? 'Final' : `Round ${r.number}`} · {r.deckCount} deck{r.deckCount > 1 ? 's' : ''}
        </span>
        <span className="pill" title="Direction of play">
          {r.direction === 1 ? '↻ clockwise' : '↺ reversed'}
        </span>
        <span className="pill">Room {view.roomId}</span>
        <button className="btn tiny ghost" onClick={leave}>
          Leave
        </button>
      </header>

      <section className="opponents">
        {seatsFromMe.map((id) => {
          const m = view.members.find((x) => x.id === id);
          const n = handCount(id);
          return (
            <div key={id} className={`opponent ${r.current === id && g.phase === 'playing' ? 'turn' : ''}`}>
              <div className="opp-name">
                {m?.name}
                {m && !m.connected && !m.isBot && <span className="badge warn">{m.autopilot ? 'bot playing' : 'offline'}</span>}
              </div>
              <div className="mini-hand" aria-label={`${n} cards`}>
                {Array.from({ length: Math.min(n, 12) }, (_, i) => (
                  <span key={i} className="mini-card" />
                ))}
              </div>
              <div className={`opp-count ${n === 1 ? 'one' : ''}`}>
                {n} card{n === 1 ? '' : 's'}
              </div>
            </div>
          );
        })}
      </section>

      <section className="center">
        <div className="pile">
          <PlayingCard
            back
            playable={!!draw && myTurn}
            onClick={draw && myTurn ? () => void send(draw) : undefined}
            label="Draw pile"
          />
          <span className="pile-label">
            {r.drawPileCount} left{draw && myTurn ? ` · tap to draw${r.pendingDraw ? ` ${r.pendingDraw}` : ''}` : ''}
          </span>
        </div>
        <div className="pile">
          <PlayingCard rank={r.top.card.rank} suit={r.top.card.suit} />
          <span className="pile-label">
            {topIsActing && r.top.rank !== 'J' && <>acts as {cardText(r.top.rank, r.top.suit)}</>}
            {topIsActing && r.top.rank === 'J' && (
              <span className={isRed(r.top.suit) ? 'red-text' : ''}>
                suit: {SUIT_SYMBOL[r.top.suit]} {SUIT_NAME[r.top.suit]}
              </span>
            )}
          </span>
        </div>
        {r.pendingDraw > 0 && <div className="pending">+{r.pendingDraw}</div>}
      </section>

      <div className={`status ${myTurn ? 'mine' : ''} ${g.phase === 'mamawWindow' || mawNow ? 'alert' : ''}`}>{status}</div>
      {toast && <div className="toast">{toast}</div>}
      <AnnouncementBanner announcement={view.announcement} serverNow={serverNow} name={name} me={me} />

      {(suitFor || chooseStartSuit) && (
        <div className="suit-picker">
          <span>{suitFor ? `Jack: choose the new suit` : 'Choose the suit'}</span>
          <div className="row">
            {SUITS.map((s) => (
              <button key={s} className={`btn suit ${isRed(s) ? 'red-text' : ''}`} onClick={() => chooseSuit(s)} aria-label={SUIT_NAME[s]}>
                {SUIT_SYMBOL[s]}
              </button>
            ))}
            {suitFor && (
              <button className="btn ghost" onClick={() => setSuitFor(null)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {!g.isSpectator && (
        <>
          <section className="controls">
            <button
              className={`btn say ${armed === 'maw' ? 'armed' : ''} ${mawNow ? 'urgent' : ''}`}
              onClick={onMaw}
              disabled={!canArm && !mawNow}
              title="Press when your play leaves you with 1 card"
            >
              Maw!
            </button>
            <button
              className={`btn say ${armed === 'mamaw' ? 'armed' : ''} ${mamawNow ? 'urgent' : ''}`}
              onClick={onMamaw}
              disabled={!canArm && !mamawNow}
              title="Press when you play your last card"
            >
              Mamaw!
            </button>
            <button className={`btn callout ${callOut ? 'urgent' : ''}`} onClick={() => callOut && void send(callOut)} disabled={!callOut}>
              Call out!
            </button>
            {pass && (
              <button className="btn" onClick={() => void send(pass)}>
                Pass
              </button>
            )}
          </section>
          {armed && (
            <p className="hint">
              {armed === 'maw' ? 'Maw' : 'Mamaw'} is ready: it will be said with your next card.
            </p>
          )}

          <section className="hand" aria-label="Your hand">
            {g.hand.map((c) => (
              <PlayingCard
                key={c.id}
                rank={c.rank}
                suit={c.suit}
                playable={myTurn && playableIds.has(c.id)}
                dim={myTurn && !playableIds.has(c.id)}
                highlight={c.id === r.drawnCardId}
                onClick={() => onCard(c)}
              />
            ))}
            {g.hand.length === 0 && g.phase === 'playing' && <p className="muted">No cards in hand</p>}
          </section>
        </>
      )}

      {(g.phase === 'roundOver' || g.phase === 'gameOver') && lastResult && (
        <div className="overlay">
          <div className="panel results">
            <h2>{g.phase === 'gameOver' ? `🏆 ${name(g.winner!)} ${g.winner === me ? 'win' : 'wins'} the game!` : `Round ${lastResult.round}: ${name(lastResult.winner)} ${lastResult.winner === me ? 'win' : 'wins'}`}</h2>
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(lastResult.points)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, pts]) => (
                    <tr key={id} className={lastResult.eliminated.includes(id) ? 'out' : ''}>
                      <td>{name(id)}</td>
                      <td>
                        {pts}
                        {lastResult.eliminated.includes(id) && ' · eliminated'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {g.phase === 'roundOver' && view.nextRoundAt && (
              <p className="muted">Next round in {Math.max(0, Math.ceil((view.nextRoundAt - now) / 1000))}s…</p>
            )}
            {g.phase === 'gameOver' &&
              (view.hostId === me ? (
                <button className="btn primary" onClick={() => void reset()}>
                  Back to lobby
                </button>
              ) : (
                <p className="muted">Waiting for the host…</p>
              ))}
          </div>
        </div>
      )}

      <aside className="side">
        {spectators.length > 0 && (
          <p className="muted">Spectating: {spectators.map((m) => m.name).join(', ')}</p>
        )}
        <details>
          <summary>Rules</summary>
          <ul className="rules">
            <li>Match the top card’s suit or rank. A Jack goes on anything.</li>
            <li>Q reverses · 9 play again · 8 skips · 7 next draws 2 (stack with 7 or J)</li>
            <li>Jack on Q/9/8/7 copies it with the Jack’s suit; otherwise you choose a suit.</li>
            <li>Final (2 players): Q, 9 and 8 all mean play again.</li>
            <li>Going down to 1 card: press Maw! Playing your last card: press Mamaw! Before or right after the card — but if someone calls you out first, you draw 2.</li>
            <li>You can’t win on a 9: draw 1, press Maw, then play it if you can.</li>
          </ul>
        </details>
        <ol className="log" aria-label="Game log">
          {view.log
            .slice(-12)
            .reverse()
            .map((l) => (
              <li key={l.id}>{l.text}</li>
            ))}
        </ol>
      </aside>
    </main>
  );
}
