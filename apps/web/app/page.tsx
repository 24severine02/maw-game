'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { saveName, savedName } from '@/lib/client';

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => setName(savedName()), []);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    saveName(name.trim());
    router.push('/room/new');
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    if (name.trim()) saveName(name.trim());
    router.push(`/room/${c}`);
  };

  return (
    <main className="home">
      <h1 className="logo">Maw</h1>
      <p className="tagline">The card game where you must not forget to say it.</p>

      <form className="panel" onSubmit={create}>
        <label htmlFor="name">Your nickname</label>
        <input id="name" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoFocus />
        <button className="btn primary" disabled={!name.trim()}>
          Create a room
        </button>
      </form>

      <form className="panel" onSubmit={join}>
        <label htmlFor="code">Have a room code?</label>
        <div className="row">
          <input
            id="code"
            value={code}
            maxLength={5}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDE"
            className="code-input"
          />
          <button className="btn" disabled={!code.trim()}>
            Join
          </button>
        </div>
      </form>
    </main>
  );
}
