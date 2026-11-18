'use client';

import type { Announcement } from '@maw/protocol';
import { useEffect, useState } from 'react';

const SHOW_MS = 2200;

interface Props {
  announcement: Announcement | null;
  serverNow: () => number;
  /** Display name, 'You' for the viewer. */
  name: (id: string) => string;
  me: string;
}

/** Big full-screen flash for every Maw, Mamaw and call-out, so the whole table notices. */
export function AnnouncementBanner({ announcement, serverNow, name, me }: Props) {
  const [shown, setShown] = useState<Announcement | null>(null);

  useEffect(() => {
    // Ignore stale ones (e.g. the last announcement re-sent when reconnecting).
    if (!announcement || serverNow() - announcement.at > SHOW_MS) return;
    setShown(announcement);
    const t = setTimeout(() => setShown((s) => (s?.id === announcement.id ? null : s)), SHOW_MS);
    return () => clearTimeout(t);
    // Only a new announcement (new id) triggers the flash.
  }, [announcement?.id]);

  if (!shown) return null;
  const who = name(shown.playerId);
  const title = shown.kind === 'maw' ? 'Maw!' : shown.kind === 'mamaw' ? 'Mamaw!' : 'Call out!';
  const detail =
    shown.kind === 'callout' && shown.targetId
      ? shown.targetId === me
        ? `${who} called you out · you draw 2`
        : `${who} called out ${name(shown.targetId)} · ${name(shown.targetId)} draws 2`
      : `${who} ${shown.playerId === me ? 'say' : 'says'} ${title}`;
  return (
    <div className="announce" role="status" aria-live="assertive" key={shown.id}>
      <div className={`announce-box ${shown.kind}`}>
        <div className="announce-title">{title}</div>
        <div className="announce-detail">{detail}</div>
      </div>
    </div>
  );
}
