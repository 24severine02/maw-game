'use client';

import type { Rank, Suit } from '@maw/engine';
import type { ClientToServerEvents, ServerToClientEvents, Session } from '@maw/protocol';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export type MawSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Server URL: NEXT_PUBLIC_SERVER_URL, else the same host on port 3001 (works on your LAN too). */
export function serverUrl(): string {
  return process.env.NEXT_PUBLIC_SERVER_URL ?? `${window.location.protocol}//${window.location.hostname}:3001`;
}

export function createSocket(): MawSocket {
  return io(serverUrl(), { transports: ['websocket'], reconnectionDelayMax: 3000 });
}

// ---- local persistence (best effort: storage can be unavailable) ----

const NAME_KEY = 'maw:name';
const sessionKey = (roomId: string) => `maw:session:${roomId.toUpperCase()}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const savedName = () => read(NAME_KEY) ?? '';
export const saveName = (name: string) => write(NAME_KEY, name);

export function savedSession(roomId: string): Session | null {
  const raw = read(sessionKey(roomId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}
export const saveSession = (s: Session) => write(sessionKey(s.roomId), JSON.stringify(s));
export const clearSession = (roomId: string) => write(sessionKey(roomId), null);

// ---- cards ----

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const isRed = (suit: Suit) => suit === 'H' || suit === 'D';
export const cardText = (rank: Rank, suit: Suit) => `${rank}${SUIT_SYMBOL[suit]}`;

/** Re-renders every `ms` while `active`; returns Date.now(). */
export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}
