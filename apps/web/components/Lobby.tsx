'use client';

import type { Ack, RoomView } from '@maw/protocol';
import { useState } from 'react';

interface Props {
  view: RoomView;
  send: (event: 'lobby:addBot' | 'lobby:start') => Promise<Ack>;
  removeMember: (playerId: string) => Promise<Ack>;
  leave: () => void;
}

export function Lobby({ view, send, removeMember, leave }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isHost = view.hostId === view.you;
  const full = view.members.length >= view.maxPlayers;
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/room/${view.roomId}`;

  const run = async (p: Promise<Ack>) => {
    const res = await p;
    setError(res.ok ? null : res.error);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy; select the link instead');
    }
  };

  return (
    <main className="lobby">
      <header className="lobby-head">
        <h1 className="logo small">Maw</h1>
        <button className="btn ghost" onClick={leave}>
          Leave
        </button>
      </header>

      <section className="panel">
        <h2>
          Room <span className="code">{view.roomId}</span>
        </h2>
        <p className="muted">Share this link with your friends:</p>
        <div className="row">
          <input readOnly value={link} onFocus={(e) => e.target.select()} className="link-input" />
          <button className="btn" onClick={copy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>
          Players {view.members.length}/{view.maxPlayers}
        </h2>
        <ul className="members">
          {view.members.map((m) => (
            <li key={m.id}>
              <span className={`dot ${m.connected ? 'on' : 'off'}`} title={m.connected ? 'online' : 'offline'} />
              <span className="member-name">
                {m.name}
                {m.id === view.you && <span className="muted"> (you)</span>}
              </span>
              {m.isHost && <span className="badge">host</span>}
              {isHost && m.id !== view.you && (
                <button className="btn tiny ghost" onClick={() => run(removeMember(m.id))} aria-label={`Remove ${m.name}`}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="muted">
          {view.members.length < 2
            ? 'At least 2 players are needed.'
            : `${view.members.length} players → ${view.deckCount} deck${view.deckCount > 1 ? 's' : ''} (${view.deckCount * 52} cards)`}
        </p>
        {isHost ? (
          <div className="row">
            <button className="btn" onClick={() => run(send('lobby:addBot'))} disabled={full}>
              + Add bot
            </button>
            <button className="btn primary" onClick={() => run(send('lobby:start'))} disabled={view.members.length < 2}>
              Start game
            </button>
          </div>
        ) : (
          <p>Waiting for the host to start…</p>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
