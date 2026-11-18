'use client';

import type { Ack, PlayerAction, RoomView, Session } from '@maw/protocol';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearSession,
  createSocket,
  saveName,
  savedName,
  savedSession,
  saveSession,
  type MawSocket,
} from '@/lib/client';
import { Lobby } from './Lobby';
import { Table } from './Table';

type Stage = 'connecting' | 'needName' | 'in' | 'error';

/**
 * Owns the socket for one room. `roomId === 'NEW'` creates a room with the
 * saved nickname, then swaps the URL to the real code. Reconnects re-join
 * with the saved token, so a dropped player gets their seat back.
 */
export function RoomClient({ roomId: initialRoomId }: { roomId: string }) {
  const [view, setView] = useState<RoomView | null>(null);
  const [stage, setStage] = useState<Stage>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState('');
  const socketRef = useRef<MawSocket | null>(null);
  const roomIdRef = useRef(initialRoomId);
  /** serverNow − Date.now(), so countdowns use the server's clock. */
  const offsetRef = useRef(0);

  useEffect(() => {
    setName(savedName());
    const socket = createSocket();
    socketRef.current = socket;

    const onSession = (res: Ack<Session>) => {
      if (res.ok) {
        saveSession(res);
        roomIdRef.current = res.roomId;
        if (window.location.pathname !== `/room/${res.roomId}`) window.history.replaceState(null, '', `/room/${res.roomId}`);
        setStage('in');
        setError(null);
      } else if (res.code === 'SEAT_GONE') {
        clearSession(roomIdRef.current);
        setStage('needName');
      } else {
        setError(res.error);
        setStage(res.code === 'BAD_NAME' || res.code === 'ROOM_FULL' ? 'needName' : 'error');
      }
    };

    socket.on('connect', () => {
      setConnected(true);
      const roomId = roomIdRef.current;
      if (roomId === 'NEW') {
        const n = savedName();
        if (n) socket.emit('room:create', { name: n }, onSession);
        else setStage('needName');
        return;
      }
      const session = savedSession(roomId);
      if (session) socket.emit('room:join', { roomId, token: session.token }, onSession);
      else setStage('needName');
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => {
      setConnected(false);
      setError('Cannot reach the game server. Is it running?');
    });
    socket.on('room:state', (v) => {
      offsetRef.current = v.serverNow - Date.now();
      setView(v);
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  const submitName = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const socket = socketRef.current;
    if (!n || !socket) return;
    saveName(n);
    setError(null);
    const onAck = (res: Ack<Session>) => {
      if (res.ok) {
        saveSession(res);
        roomIdRef.current = res.roomId;
        window.history.replaceState(null, '', `/room/${res.roomId}`);
        setStage('in');
      } else {
        setError(res.error);
        if (res.code === 'NO_ROOM' || res.code === 'GAME_IN_PROGRESS') setStage('error');
      }
    };
    if (roomIdRef.current === 'NEW') socket.emit('room:create', { name: n }, onAck);
    else socket.emit('room:join', { roomId: roomIdRef.current, name: n }, onAck);
  };

  const send = useCallback(
    (event: 'lobby:addBot' | 'lobby:start' | 'lobby:reset' | 'room:leave') =>
      new Promise<Ack>((resolve) => socketRef.current?.emit(event, resolve)),
    [],
  );
  const removeMember = useCallback(
    (playerId: string) => new Promise<Ack>((resolve) => socketRef.current?.emit('lobby:remove', { playerId }, resolve)),
    [],
  );
  const act = useCallback(
    (action: PlayerAction) => new Promise<Ack>((resolve) => socketRef.current?.emit('game:action', { action }, resolve)),
    [],
  );
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const leave = async () => {
    await send('room:leave');
    clearSession(roomIdRef.current);
    window.location.href = '/';
  };

  if (stage === 'error') {
    return (
      <main className="center-page">
        <div className="panel">
          <h2>Can’t join this room</h2>
          <p>{error}</p>
          <Link className="btn primary" href="/">
            Back to start
          </Link>
        </div>
      </main>
    );
  }

  if (stage === 'needName') {
    return (
      <main className="center-page">
        <form className="panel" onSubmit={submitName}>
          <h2>{roomIdRef.current === 'NEW' ? 'Create a room' : `Join room ${roomIdRef.current}`}</h2>
          <label htmlFor="name">Your nickname</label>
          <input id="name" value={name} maxLength={20} autoFocus onChange={(e) => setName(e.target.value)} />
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={!name.trim() || !connected}>
            {roomIdRef.current === 'NEW' ? 'Create' : 'Join'}
          </button>
        </form>
      </main>
    );
  }

  if (!view || stage !== 'in') {
    return (
      <main className="center-page">
        <p className="muted">{error ?? 'Connecting…'}</p>
      </main>
    );
  }

  return (
    <>
      {!connected && <div className="banner warn">Connection lost, reconnecting…</div>}
      {view.status === 'lobby' ? (
        <Lobby view={view} send={send} removeMember={removeMember} leave={leave} />
      ) : (
        <Table view={view} act={act} serverNow={serverNow} reset={() => send('lobby:reset')} leave={leave} />
      )}
    </>
  );
}
