import React, { useEffect, useRef, useState } from 'react';
import { PLAYER_COLORS, PlayerInfo } from '@couch-emu/shared';
import { MiniGameMeta } from './miniGamesRegistry';

/** Beat names the parent can hook sounds onto. */
export type IntroBeat = 'card' | 3 | 2 | 1 | 'go';

interface BootIntroProps {
  game: MiniGameMeta;
  players: PlayerInfo[];
  botsEnabled: boolean;
  /** Show the full title card before the countdown (first launch). */
  full: boolean;
  onBeat: (beat: IntroBeat) => void;
  /** Fired on GO — the game should start simulating now. */
  onGo: () => void;
  /** Fired once the overlay has fully faded out. */
  onDone: () => void;
}

const CARD_MS = 1650;
const COUNT_MS = 560;

/**
 * Cinematic cartridge boot: title card with the player roster, then a punchy
 * 3-2-1-GO. Enter, click or tap skips straight to GO.
 */
export function BootIntro({
  game,
  players,
  botsEnabled,
  full,
  onBeat,
  onGo,
  onDone,
}: BootIntroProps): React.ReactElement {
  const [beat, setBeat] = useState<IntroBeat>(full ? 'card' : 3);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);
  const fired = useRef(false);
  const cb = useRef({ onBeat, onGo, onDone });
  cb.current = { onBeat, onGo, onDone };

  const clear = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  const go = () => {
    if (fired.current) return;
    fired.current = true;
    clear();
    setBeat('go');
    cb.current.onBeat('go');
    cb.current.onGo();
    timers.current.push(
      window.setTimeout(() => setLeaving(true), 380),
      window.setTimeout(() => cb.current.onDone(), 900),
    );
  };

  useEffect(() => {
    const at = (ms: number, fn: () => void) =>
      timers.current.push(window.setTimeout(fn, ms));
    const base = full ? CARD_MS : 0;
    if (full) cb.current.onBeat('card');
    ([3, 2, 1] as const).forEach((n, i) => {
      at(base + i * COUNT_MS, () => {
        setBeat(n);
        cb.current.onBeat(n);
      });
    });
    at(base + 3 * COUNT_MS, go);

    // Only Enter skips: movement/action keys are players getting ready.
    const skip = (e: KeyboardEvent) => {
      if (e.key === 'Enter') go();
    };
    // Defer so the click/keypress that launched the game doesn't skip it.
    const armed = window.setTimeout(() => {
      window.addEventListener('keydown', skip);
    }, 250);
    return () => {
      clear();
      window.clearTimeout(armed);
      window.removeEventListener('keydown', skip);
    };
    // Runs once per mount; parent remounts via `key` for each boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showCard = beat === 'card';
  const roster = [0, 1, 2, 3].map((slot) => {
    const human = players.find((p) => p.slot === slot);
    if (human) return { slot, name: human.name, color: human.color, kind: 'PHONE' };
    if (slot === 0) return { slot, name: 'Keyboard', color: PLAYER_COLORS[0], kind: 'KEYS' };
    return botsEnabled
      ? { slot, name: `CPU ${slot + 1}`, color: PLAYER_COLORS[slot], kind: 'CPU' }
      : { slot, name: 'Open', color: '#3a3946', kind: 'OPEN' };
  });

  return (
    <div
      className={`boot-intro absolute inset-0 z-[15] flex items-center justify-center overflow-hidden cursor-pointer select-none ${
        leaving ? 'boot-intro-leave' : ''
      }`}
      style={{ ['--accent' as string]: game.accent }}
      onPointerDown={go}
      role="presentation"
    >
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          showCard ? 'bg-[#05040A]/88' : 'bg-[#05040A]/40'
        }`}
      />
      <div className="boot-intro-rays absolute inset-[-40%]" aria-hidden="true" />

      {showCard ? (
        <div className="relative w-full max-w-3xl px-6 text-center boot-card-in">
          <div className="font-osd text-[22px] sm:text-[26px] leading-none text-[#B5FF2A] osd-glow">
            NOW TUNED TO CH {game.number}
            <span className="text-white/45"> · {game.genre.toUpperCase()}</span>
          </div>
          <h2
            className="boot-title font-brand font-extrabold leading-[0.92] tracking-tight text-white mt-3"
            style={{ textShadow: `0 0 42px ${game.accent}AA, 0 0 2px #fff` }}
          >
            {game.title}
          </h2>
          <p className="mt-3 text-sm sm:text-base text-white/70 max-w-xl mx-auto">
            {game.tagline}
          </p>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 max-w-2xl mx-auto">
            {roster.map((r, i) => (
              <div
                key={r.slot}
                className="boot-roster-chip rounded-lg px-3 py-2.5 border text-left"
                style={{
                  animationDelay: `${180 + i * 90}ms`,
                  borderColor: r.kind === 'OPEN' ? 'rgba(255,255,255,0.08)' : `${r.color}88`,
                  background:
                    r.kind === 'OPEN'
                      ? 'rgba(255,255,255,0.02)'
                      : `linear-gradient(135deg, ${r.color}2E, rgba(10,9,16,0.85))`,
                  boxShadow: r.kind === 'OPEN' ? 'none' : `0 0 24px -6px ${r.color}`,
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="font-mono-tech text-[11px] font-extrabold"
                    style={{ color: r.kind === 'OPEN' ? '#6b6a78' : r.color }}
                  >
                    P{r.slot + 1}
                  </span>
                  <span className="font-osd text-[14px] leading-none text-white/45">
                    {r.kind}
                  </span>
                </div>
                <div
                  className={`mt-0.5 font-display text-sm font-extrabold truncate ${
                    r.kind === 'OPEN' ? 'text-white/30' : 'text-white'
                  }`}
                >
                  {r.name}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 font-mono-tech text-[11px] text-white/60 tracking-wide">
            {game.controls}
          </div>
        </div>
      ) : (
        <div key={String(beat)} className="relative boot-count-pop">
          <span
            className={`boot-count font-brand font-extrabold leading-none ${
              beat === 'go' ? 'boot-count-go' : ''
            }`}
            style={{
              color: beat === 'go' ? '#B5FF2A' : '#ffffff',
              textShadow:
                beat === 'go'
                  ? '0 0 60px #B5FF2A, 0 0 120px #B5FF2A88'
                  : `0 0 60px ${game.accent}, 0 0 4px #fff`,
            }}
          >
            {beat === 'go' ? 'GO!' : beat}
          </span>
          <span className="boot-count-ring" aria-hidden="true" />
        </div>
      )}

      <div className="absolute bottom-4 left-0 right-0 text-center font-osd text-[16px] leading-none text-white/40">
        {beat === 'go' ? '' : 'ENTER / CLICK TO SKIP'}
      </div>
    </div>
  );
}
