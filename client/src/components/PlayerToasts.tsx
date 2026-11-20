import React, { useEffect, useRef, useState } from 'react';
import { PlayerInfo } from '@couch-emu/shared';
import { playConfirmPop, playUiTick } from '../lib/uiSound';

type ToastKind = 'joined' | 'reconnected' | 'lost' | 'left';

interface Toast {
  id: number;
  kind: ToastKind;
  name: string;
  color: string;
  slot: number;
}

const TOAST_MS = 3400;

const LABELS: Record<ToastKind, string> = {
  joined: 'JOINED THE COUCH',
  reconnected: 'RECONNECTED',
  lost: 'SIGNAL LOST · PORT HELD',
  left: 'LEFT THE ROOM',
};

/**
 * Diffs the room roster and pops a big player-colored toast whenever a phone
 * joins, drops, comes back or leaves — so the room reacts even mid-game.
 */
export function PlayerToasts({
  players,
}: {
  players: PlayerInfo[];
}): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prev = useRef<Map<string, PlayerInfo> | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const current = new Map(players.map((p) => [p.clientId, p]));
    const before = prev.current;
    prev.current = current;
    // First snapshot (page load / host reconnect) is not news.
    if (!before) return;

    const fresh: Toast[] = [];
    const push = (kind: ToastKind, p: PlayerInfo) =>
      fresh.push({
        id: nextId.current++,
        kind,
        name: p.name,
        color: p.color,
        slot: p.slot,
      });

    for (const [clientId, p] of current) {
      const was = before.get(clientId);
      if (!was) push(p.connected ? 'joined' : 'lost', p);
      else if (!was.connected && p.connected) push('reconnected', p);
      else if (was.connected && !p.connected) push('lost', p);
    }
    for (const [clientId, p] of before) {
      if (!current.has(clientId)) push('left', p);
    }
    if (fresh.length === 0) return;

    const positive = fresh.some((t) => t.kind === 'joined' || t.kind === 'reconnected');
    if (positive) playConfirmPop(true);
    else playUiTick(0.7);

    setToasts((list) => [...list, ...fresh].slice(-4));
    for (const t of fresh) {
      window.setTimeout(() => {
        setToasts((list) => list.filter((x) => x.id !== t.id));
      }, TOAST_MS);
    }
  }, [players]);

  return (
    <div
      className="pointer-events-none fixed top-16 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 w-[min(92vw,420px)]"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const good = t.kind === 'joined' || t.kind === 'reconnected';
        return (
          <div
            key={t.id}
            className="player-toast w-full rounded-2xl px-3.5 py-2.5 flex items-center gap-3 border backdrop-blur-xl"
            style={{
              borderColor: `${t.color}${good ? 'AA' : '55'}`,
              background: `linear-gradient(110deg, ${t.color}${good ? '33' : '1A'}, rgba(11,10,18,0.92) 55%)`,
              boxShadow: good
                ? `0 10px 40px -10px ${t.color}, inset 0 1px 0 rgba(255,255,255,0.12)`
                : '0 10px 30px -12px rgba(0,0,0,0.9)',
            }}
          >
            <span
              className={`w-10 h-10 rounded-full flex items-center justify-center font-mono-tech text-xs font-extrabold shrink-0 ${
                good ? 'player-toast-badge' : ''
              }`}
              style={{
                backgroundColor: good ? t.color : 'rgba(255,255,255,0.08)',
                color: good ? '#07060B' : t.color,
                boxShadow: good ? `0 0 18px ${t.color}` : 'none',
                border: good ? 'none' : `1.5px dashed ${t.color}88`,
              }}
            >
              P{t.slot + 1}
            </span>
            <div className="min-w-0">
              <div className="font-display text-sm font-extrabold text-white truncate">
                {t.name}
              </div>
              <div
                className="font-mono-tech text-[10px] font-extrabold tracking-[0.14em]"
                style={{ color: good ? t.color : 'rgba(255,255,255,0.55)' }}
              >
                {LABELS[t.kind]}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
