import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ControllerInputState,
  GAMEPAD_BUTTON,
  PlayerInfo,
} from '@couch-emu/shared';
import { Activity, Cpu, Gamepad2, Radio, Vibrate, Wifi } from 'lucide-react';
import { virtualGamepadManager } from '../lib/virtualGamepad';
import { playSwitchClack } from '../lib/uiSound';

interface GamepadTesterProps {
  players: PlayerInfo[];
  onTestRumble: (playerId: string) => void;
}

type InputSourceMode = 'ws' | 'gamepad-api';

interface ButtonSpec {
  idx: number;
  label: string;
  zone: 'dpad' | 'action' | 'system';
}

const BUTTON_LABELS: ButtonSpec[] = [
  { idx: GAMEPAD_BUTTON.DPAD_UP, label: '▲', zone: 'dpad' },
  { idx: GAMEPAD_BUTTON.DPAD_DOWN, label: '▼', zone: 'dpad' },
  { idx: GAMEPAD_BUTTON.DPAD_LEFT, label: '◄', zone: 'dpad' },
  { idx: GAMEPAD_BUTTON.DPAD_RIGHT, label: '►', zone: 'dpad' },
  { idx: GAMEPAD_BUTTON.SOUTH, label: 'B/A', zone: 'action' },
  { idx: GAMEPAD_BUTTON.EAST, label: 'A/B', zone: 'action' },
  { idx: GAMEPAD_BUTTON.WEST, label: 'Y/X', zone: 'action' },
  { idx: GAMEPAD_BUTTON.NORTH, label: 'X/Y', zone: 'action' },
  { idx: GAMEPAD_BUTTON.L1, label: 'L1', zone: 'system' },
  { idx: GAMEPAD_BUTTON.R1, label: 'R1', zone: 'system' },
  { idx: GAMEPAD_BUTTON.L2, label: 'L2', zone: 'action' },
  { idx: GAMEPAD_BUTTON.R2, label: 'R2', zone: 'action' },
  { idx: GAMEPAD_BUTTON.SELECT, label: 'SEL', zone: 'system' },
  { idx: GAMEPAD_BUTTON.START, label: 'STR', zone: 'system' },
  { idx: GAMEPAD_BUTTON.L3, label: 'L3', zone: 'system' },
  { idx: GAMEPAD_BUTTON.R3, label: 'R3', zone: 'system' },
  { idx: GAMEPAD_BUTTON.HOME, label: 'HOME', zone: 'system' },
];

const LED_SEGMENTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/** Persistence trail length in frames (~200ms at 60Hz). */
const TRAIL_LENGTH = 12;
const SLOTS = [0, 1, 2, 3] as const;
const API_SLOT_COLORS = ['#FF3B5C', '#B5FF2A', '#22D3EE', '#FFB800'];
const STICK_META = [
  { label: 'L-STICK', hex: '#B5FF2A', rgb: '181, 255, 42' },
  { label: 'R-STICK', hex: '#22D3EE', rgb: '34, 211, 238' },
] as const;

function getSegmentColor(index: number): string {
  if (index <= 5) return '#B5FF2A';
  if (index <= 7) return '#FFB800';
  return '#FF3B5C';
}

function getZoneActiveStyle(zone: ButtonSpec['zone']): {
  bg: string;
  text: string;
  border: string;
  glow: string;
} {
  if (zone === 'dpad') {
    return {
      bg: '#B5FF2A',
      text: '#07060B',
      border: '#D9FF85',
      glow: 'rgba(181, 255, 42, 0.55)',
    };
  }
  if (zone === 'system') {
    return {
      bg: '#22D3EE',
      text: '#07060B',
      border: '#67E8F9',
      glow: 'rgba(34, 211, 238, 0.55)',
    };
  }
  return {
    bg: '#FF3B5C',
    text: '#FFFFFF',
    border: '#FF8FA3',
    glow: 'rgba(255, 59, 92, 0.6)',
  };
}

function hex4(mask: number): string {
  return `0x${(mask >>> 0).toString(16).padStart(4, '0').toUpperCase()}`;
}

/** Trigger value: analog when reported, otherwise the digital bit. */
function triggerValue(mask: number, bit: number, analog: number | undefined): number {
  const a = typeof analog === 'number' && Number.isFinite(analog) ? analog : 0;
  if (a > 0) return Math.min(1, a);
  return (mask & (1 << bit)) !== 0 ? 1 : 0;
}

/** Stick position mapped into the 96×96 scope, clamped to the unit circle. */
function stickPoint(ax: number, ay: number): { x: number; y: number } {
  const cx = Math.max(-1, Math.min(1, ax || 0));
  const cy = Math.max(-1, Math.min(1, ay || 0));
  const mag = Math.hypot(cx, cy);
  const s = mag > 1 ? 1 / mag : 1;
  return { x: 48 + cx * s * 34, y: 48 + cy * s * 34 };
}

/* ── Imperative DOM registry (written by the rAF loop, never by React) ──── */

interface StickDom {
  beam: SVGLineElement | null;
  dot: SVGGElement | null;
  trail: SVGPolylineElement | null;
  trailGlow: SVGPolylineElement | null;
  readout: HTMLDivElement | null;
}

interface SlotDom {
  subtitle: HTMLDivElement | null;
  triggers: Array<{ pct: HTMLSpanElement | null; segs: (HTMLSpanElement | null)[] }>;
  sticks: StickDom[];
  buttons: (HTMLSpanElement | null)[];
}

function createSlotDom(): SlotDom {
  return {
    subtitle: null,
    triggers: [0, 1].map(() => ({ pct: null, segs: [] })),
    sticks: [0, 1].map(() => ({
      beam: null,
      dot: null,
      trail: null,
      trailGlow: null,
      readout: null,
    })),
    buttons: [],
  };
}

interface SlotCache {
  key: string;
  subtitle: string;
  trails: [Array<{ x: number; y: number }>, Array<{ x: number; y: number }>];
  trailKeys: [string, string];
}

function createSlotCache(): SlotCache {
  return { key: '', subtitle: '', trails: [[], []], trailKeys: ['', ''] };
}

/** Reusable per-slot scratch for Gamepad API snapshots (no per-frame allocs). */
interface Scratch {
  connected: boolean;
  id: string;
  timestamp: number;
  canRumble: boolean;
  state: ControllerInputState;
}

function createScratch(): Scratch {
  return {
    connected: false,
    id: '',
    timestamp: 0,
    canRumble: false,
    state: { buttonsMask: 0, l2: 0, r2: 0, axes: [0, 0, 0, 0], seq: 0 },
  };
}

function readPadInto(pad: Gamepad | null | undefined, out: Scratch): void {
  if (!pad || !pad.connected) {
    out.connected = false;
    out.id = '';
    out.canRumble = false;
    out.state.buttonsMask = 0;
    out.state.l2 = 0;
    out.state.r2 = 0;
    out.state.axes[0] = out.state.axes[1] = out.state.axes[2] = out.state.axes[3] = 0;
    return;
  }
  let mask = 0;
  const len = Math.min(17, pad.buttons.length);
  for (let i = 0; i < len; i++) {
    if (pad.buttons[i]?.pressed) mask |= 1 << i;
  }
  out.connected = true;
  out.id = pad.id;
  out.timestamp = pad.timestamp;
  out.canRumble = Boolean(
    (pad as Gamepad & { vibrationActuator?: { playEffect?: unknown } })
      .vibrationActuator?.playEffect,
  );
  out.state.buttonsMask = mask;
  out.state.l2 = pad.buttons[GAMEPAD_BUTTON.L2]?.value ?? 0;
  out.state.r2 = pad.buttons[GAMEPAD_BUTTON.R2]?.value ?? 0;
  out.state.axes[0] = pad.axes[0] ?? 0;
  out.state.axes[1] = pad.axes[1] ?? 0;
  out.state.axes[2] = pad.axes[2] ?? 0;
  out.state.axes[3] = pad.axes[3] ?? 0;
  out.state.seq = Math.round(pad.timestamp);
}

function pulseLocalGamepad(slot: number) {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return;
  }
  const pad = navigator.getGamepads()?.[slot] as
    | (Gamepad & {
        vibrationActuator?: {
          playEffect?: (
            type: string,
            params?: {
              duration?: number;
              strongMagnitude?: number;
              weakMagnitude?: number;
            },
          ) => Promise<unknown>;
        };
      })
    | null;
  if (pad?.vibrationActuator?.playEffect) {
    void pad.vibrationActuator
      .playEffect('dual-rumble', {
        duration: 180,
        strongMagnitude: 0.9,
        weakMagnitude: 0.6,
      })
      .catch(() => {});
  }
}

/** Writes one slot's live state into its DOM nodes (diffed via cache). */
function paintSlot(
  dom: SlotDom,
  cache: SlotCache,
  st: ControllerInputState,
  connected: boolean,
  subtitle: string,
): void {
  const mask = connected ? st.buttonsMask : 0;
  const l2 = connected ? triggerValue(mask, GAMEPAD_BUTTON.L2, st.l2) : 0;
  const r2 = connected ? triggerValue(mask, GAMEPAD_BUTTON.R2, st.r2) : 0;
  const ax = st.axes;

  // Trails sample every frame so they decay into the dot when idle.
  for (let s = 0; s < 2; s++) {
    const pt = connected
      ? stickPoint(ax[s * 2] ?? 0, ax[s * 2 + 1] ?? 0)
      : { x: 48, y: 48 };
    const trail = cache.trails[s as 0 | 1];
    trail.push(pt);
    if (trail.length > TRAIL_LENGTH) trail.shift();
    let pts = '';
    for (const p of trail) pts += `${p.x.toFixed(1)},${p.y.toFixed(1)} `;
    if (pts !== cache.trailKeys[s]) {
      cache.trailKeys[s as 0 | 1] = pts;
      const sd = dom.sticks[s];
      sd.trail?.setAttribute('points', pts);
      sd.trailGlow?.setAttribute('points', pts);
    }
  }

  if (subtitle !== cache.subtitle) {
    cache.subtitle = subtitle;
    if (dom.subtitle) dom.subtitle.textContent = subtitle;
  }

  const key = `${connected ? 1 : 0}|${mask}|${l2.toFixed(2)}|${r2.toFixed(2)}|${(ax[0] ?? 0).toFixed(3)}|${(ax[1] ?? 0).toFixed(3)}|${(ax[2] ?? 0).toFixed(3)}|${(ax[3] ?? 0).toFixed(3)}`;
  if (key === cache.key) return;
  cache.key = key;

  // Triggers
  [l2, r2].forEach((val, t) => {
    const td = dom.triggers[t];
    const lit = val > 0.01 ? Math.max(1, Math.round(val * 10)) : 0;
    if (td.pct) {
      td.pct.textContent = `${Math.round(val * 100)}%`;
      td.pct.style.color =
        !connected || lit === 0
          ? 'rgba(245,244,240,0.35)'
          : lit >= 9
            ? '#FF3B5C'
            : lit >= 7
              ? '#FFB800'
              : '#B5FF2A';
    }
    for (let i = 0; i < td.segs.length; i++) {
      const seg = td.segs[i];
      if (!seg) continue;
      if (connected && i < lit) {
        const c = getSegmentColor(i);
        seg.style.backgroundColor = c;
        seg.style.borderColor = c;
        seg.style.boxShadow = `0 0 9px ${c}CC, inset 0 1px 0 rgba(255,255,255,0.5)`;
      } else {
        seg.style.backgroundColor = '';
        seg.style.borderColor = '';
        seg.style.boxShadow = '';
      }
    }
  });

  // Sticks
  for (let s = 0; s < 2; s++) {
    const sd = dom.sticks[s];
    const rawX = connected ? Math.max(-1, Math.min(1, ax[s * 2] ?? 0)) : 0;
    const rawY = connected ? Math.max(-1, Math.min(1, ax[s * 2 + 1] ?? 0)) : 0;
    const pt = stickPoint(rawX, rawY);
    sd.beam?.setAttribute('x2', pt.x.toFixed(2));
    sd.beam?.setAttribute('y2', pt.y.toFixed(2));
    sd.dot?.setAttribute(
      'transform',
      `translate(${(pt.x - 48).toFixed(2)} ${(pt.y - 48).toFixed(2)})`,
    );
    if (sd.readout) {
      sd.readout.textContent = `X ${rawX >= 0 ? '+' : ''}${rawX.toFixed(2)} · Y ${rawY >= 0 ? '+' : ''}${rawY.toFixed(2)}`;
    }
  }

  // Button matrix
  BUTTON_LABELS.forEach((b, i) => {
    const el = dom.buttons[i];
    if (!el) return;
    const down = connected && (mask & (1 << b.idx)) !== 0;
    if (down) {
      const a = getZoneActiveStyle(b.zone);
      el.style.background = a.bg;
      el.style.color = a.text;
      el.style.borderColor = a.border;
      el.style.boxShadow = `inset 0 2px 4px rgba(0, 0, 0, 0.25), 0 0.5px 0 #050508, 0 0 14px ${a.glow}`;
      el.style.transform = 'translateY(2.5px)';
    } else {
      el.style.background = '';
      el.style.color = '';
      el.style.borderColor = '';
      el.style.boxShadow = '';
      el.style.transform = '';
    }
  });
}

/* ── Slot module: static structure only; live values painted imperatively ─ */

interface SlotModuleProps {
  slot: number;
  dom: SlotDom;
  isConnected: boolean;
  slotColor: string;
  displayName: string;
  hz: number;
  pulsing: boolean;
  isBuzzing: boolean;
  canPulse: boolean;
  onPulse: (slot: number) => void;
}

const SlotModule = memo(function SlotModule({
  slot,
  dom,
  isConnected,
  slotColor,
  displayName,
  hz,
  pulsing,
  isBuzzing,
  canPulse,
  onPulse,
}: SlotModuleProps) {
  return (
    <div
      className={`rounded-2xl p-4 flex flex-col justify-between gap-3.5 transition ${
        isConnected ? 'console-deck' : 'crt-well opacity-65 border-white/5'
      }`}
      style={
        isConnected
          ? {
              borderColor: `${slotColor}45`,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), 0 18px 40px -20px ${slotColor}33`,
            }
          : undefined
      }
    >
      {/* Module Header Strip */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-9 h-9 rounded-xl border flex items-center justify-center font-mono-tech text-xs font-extrabold shrink-0"
            style={
              isConnected
                ? {
                    backgroundColor: `${slotColor}22`,
                    borderColor: slotColor,
                    color: slotColor,
                    boxShadow: `0 0 16px ${slotColor}40, inset 0 1px 0 rgba(255,255,255,0.2)`,
                  }
                : {
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    borderColor: 'rgba(255,255,255,0.12)',
                    color: 'rgba(245,244,240,0.35)',
                  }
            }
          >
            P{slot + 1}
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-extrabold text-[#F5F4F0] truncate leading-tight">
              {displayName}
            </div>
            <div
              ref={(el) => {
                dom.subtitle = el;
              }}
              className="text-[10px] font-mono-tech font-medium text-white/45 truncate mt-0.5"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={`crt-well inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono-tech text-[10px] font-extrabold transition ${
              pulsing ? 'text-[#B5FF2A]' : 'text-white/35'
            }`}
            title="Input updates received per second"
          >
            <Radio
              className={`w-3 h-3 ${
                pulsing
                  ? 'text-[#B5FF2A] animate-pulse drop-shadow-[0_0_6px_#B5FF2A]'
                  : 'text-white/25'
              }`}
            />
            <span>{hz} Hz</span>
          </div>

          {isConnected && canPulse && (
            <button
              type="button"
              onClick={() => onPulse(slot)}
              className={`${
                isBuzzing ? 'console-btn-volt' : 'console-btn'
              } inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono-tech text-[10px] font-extrabold uppercase tracking-wide cursor-pointer`}
              title="Send haptic test pulse"
            >
              <Vibrate
                className={`w-3 h-3 ${isBuzzing ? 'text-[#07060B]' : 'text-[#FF3B5C]'}`}
              />
              PULSE
            </button>
          )}
        </div>
      </div>

      {/* 10-Segment LED VU-Meter Bars (L2 & R2 Triggers) */}
      <div className="grid grid-cols-2 gap-2.5">
        {['L2 TRIGGER', 'R2 TRIGGER'].map((label, t) => (
          <div key={label} className="crt-well rounded-xl px-2.5 py-2 space-y-1.5">
            <div className="flex items-center justify-between font-mono-tech text-[10px]">
              <span className="text-white/55 font-bold tracking-wider">{label}</span>
              <span
                ref={(el) => {
                  dom.triggers[t].pct = el;
                }}
                className="font-extrabold text-white/35"
              >
                0%
              </span>
            </div>
            <div className="flex items-center gap-[3px] h-3">
              {LED_SEGMENTS.map((segIdx) => (
                <span
                  key={segIdx}
                  ref={(el) => {
                    dom.triggers[t].segs[segIdx] = el;
                  }}
                  className="flex-1 h-full rounded-[2.5px] bg-white/[0.06] border border-white/[0.06] shadow-[inset_0_1px_2px_rgba(0,0,0,0.85)]"
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Phosphor CRT XY Oscilloscopes */}
      <div className="flex items-center justify-around gap-3 py-0.5">
        {STICK_META.map((meta, s) => {
          const sd = dom.sticks[s];
          const gradId = `phosphor-${slot}-${s}`;
          return (
            <div key={meta.label} className="flex flex-col items-center gap-1.5">
              <div className="relative w-24 h-24 sm:w-26 sm:h-26 rounded-full crt-well overflow-hidden shadow-[inset_0_4px_14px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.08)]">
                <svg
                  viewBox="0 0 96 96"
                  className="w-full h-full block"
                  aria-label={`${meta.label} oscilloscope`}
                >
                  <defs>
                    <radialGradient id={gradId} cx="50%" cy="50%" r="50%">
                      <stop
                        offset="0%"
                        stopColor={meta.hex}
                        stopOpacity={isConnected ? 0.16 : 0.04}
                      />
                      <stop offset="100%" stopColor="#05050A" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <circle cx="48" cy="48" r="45" fill={`url(#${gradId})`} />
                  <circle
                    cx="48"
                    cy="48"
                    r="36"
                    fill="none"
                    stroke={`rgba(${meta.rgb}, 0.24)`}
                    strokeWidth="1"
                  />
                  <circle
                    cx="48"
                    cy="48"
                    r="18"
                    fill="none"
                    stroke={`rgba(${meta.rgb}, 0.14)`}
                    strokeWidth="1"
                    strokeDasharray="2.5 2.5"
                  />
                  <line x1="6" y1="48" x2="90" y2="48" stroke={`rgba(${meta.rgb}, 0.2)`} strokeWidth="1" />
                  <line x1="48" y1="6" x2="48" y2="90" stroke={`rgba(${meta.rgb}, 0.2)`} strokeWidth="1" />
                  {[20, 34, 62, 76].map((pos) => (
                    <React.Fragment key={pos}>
                      <line x1={pos} y1="45.5" x2={pos} y2="50.5" stroke={`rgba(${meta.rgb}, 0.3)`} strokeWidth="0.9" />
                      <line x1="45.5" y1={pos} x2="50.5" y2={pos} stroke={`rgba(${meta.rgb}, 0.3)`} strokeWidth="0.9" />
                    </React.Fragment>
                  ))}

                  <g visibility={isConnected ? 'visible' : 'hidden'}>
                    {/* Decaying phosphor persistence trail */}
                    <polyline
                      ref={(el) => {
                        sd.trailGlow = el;
                      }}
                      fill="none"
                      stroke={`rgba(${meta.rgb}, 0.16)`}
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <polyline
                      ref={(el) => {
                        sd.trail = el;
                      }}
                      fill="none"
                      stroke={`rgba(${meta.rgb}, 0.45)`}
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Live vector beam */}
                    <line
                      ref={(el) => {
                        sd.beam = el;
                      }}
                      x1="48"
                      y1="48"
                      x2="48"
                      y2="48"
                      stroke={meta.hex}
                      strokeWidth="2.1"
                      strokeLinecap="round"
                      style={{ filter: `drop-shadow(0 0 5px rgba(${meta.rgb}, 0.95))` }}
                    />
                  </g>

                  <circle cx="48" cy="48" r="2" fill={`rgba(${meta.rgb}, 0.55)`} />

                  <g
                    ref={(el) => {
                      sd.dot = el;
                    }}
                    visibility={isConnected ? 'visible' : 'hidden'}
                  >
                    <circle cx="48" cy="48" r="7.5" fill={meta.hex} opacity="0.25" />
                    <circle
                      cx="48"
                      cy="48"
                      r="4.2"
                      fill={meta.hex}
                      stroke="#FFFFFF"
                      strokeWidth="1.1"
                      style={{ filter: `drop-shadow(0 0 6px rgba(${meta.rgb}, 1))` }}
                    />
                    <circle cx="48" cy="48" r="1.5" fill="#FFFFFF" />
                  </g>
                  {!isConnected && (
                    <circle
                      cx="48"
                      cy="48"
                      r="3.2"
                      fill="#1E2030"
                      stroke={`rgba(${meta.rgb}, 0.25)`}
                      strokeWidth="1"
                    />
                  )}
                </svg>
                <div className="crt-scanlines absolute inset-0 rounded-full opacity-55" />
              </div>

              <div className="text-center leading-tight">
                <div
                  className="font-mono-tech text-[9px] font-extrabold uppercase tracking-[0.16em]"
                  style={{ color: isConnected ? meta.hex : 'rgba(245,244,240,0.4)' }}
                >
                  {meta.label}
                </div>
                <div
                  ref={(el) => {
                    sd.readout = el;
                  }}
                  className="font-mono-tech text-[10px] font-bold text-[#F5F4F0]/85 mt-0.5"
                >
                  X +0.00 · Y +0.00
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Button Switch Matrix */}
      <div className="pt-2.5 border-t border-white/10">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono-tech text-[9px] font-extrabold uppercase tracking-[0.16em] text-white/45 flex items-center gap-1.5">
            <Gamepad2 className="w-3 h-3 text-[#22D3EE]" />
            SWITCH MATRIX // {BUTTON_LABELS.length}-KEY
          </span>
          <span
            className={`font-mono-tech text-[9px] font-extrabold tracking-widest ${
              isConnected ? 'text-[#B5FF2A]' : 'text-white/30'
            }`}
          >
            {isConnected ? 'LIVE' : 'STANDBY'}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {BUTTON_LABELS.map((b, i) => (
            <span
              key={b.idx}
              ref={(el) => {
                dom.buttons[i] = el;
              }}
              className={`inline-flex items-center justify-center min-w-[34px] px-2 py-1 rounded-lg text-[10px] font-mono-tech font-extrabold select-none transition-all duration-75 border ${
                isConnected
                  ? 'console-btn text-[#F5F4F0]/90'
                  : 'crt-well text-white/25'
              }`}
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});

/* ── Bench ────────────────────────────────────────────────────────────── */

export const GamepadTester: React.FC<GamepadTesterProps> = ({
  players,
  onTestRumble,
}) => {
  const [sourceMode, setSourceMode] = useState<InputSourceMode>('ws');
  const [buzzingAll, setBuzzingAll] = useState(false);
  const [buzzingSlot, setBuzzingSlot] = useState<number | null>(null);
  /** API-mode roster: changes only when a pad (dis)connects. */
  const [apiPads, setApiPads] = useState<Array<{ id: string; canRumble: boolean } | null>>(
    [null, null, null, null],
  );
  const [rates, setRates] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const [pulseActive, setPulseActive] = useState<[boolean, boolean, boolean, boolean]>(
    [false, false, false, false],
  );

  const domRef = useRef<SlotDom[]>(SLOTS.map(() => createSlotDom()));
  const cacheRef = useRef<SlotCache[]>(SLOTS.map(() => createSlotCache()));
  const scratchRef = useRef<Scratch[]>(SLOTS.map(() => createScratch()));
  const maskElRef = useRef<HTMLDivElement | null>(null);
  const packetTimesRef = useRef<number[][]>([[], [], [], []]);
  const lastPacketAtRef = useRef<number[]>([0, 0, 0, 0]);
  const lastSeqRef = useRef<number[]>([-1, -1, -1, -1]);
  const timersRef = useRef<number[]>([]);

  const playersRef = useRef(players);
  playersRef.current = players;
  const modeRef = useRef(sourceMode);
  modeRef.current = sourceMode;

  // Reset meters when switching source so stale numbers never linger.
  useEffect(() => {
    packetTimesRef.current = [[], [], [], []];
    lastSeqRef.current = [-1, -1, -1, -1];
    lastPacketAtRef.current = [0, 0, 0, 0];
    cacheRef.current = SLOTS.map(() => createSlotCache());
  }, [sourceMode]);

  // WS mode: count real packets (not renders) per slot.
  useEffect(() => {
    return virtualGamepadManager.onChange(() => {
      if (modeRef.current !== 'ws') return;
      const now = performance.now();
      for (let slot = 0; slot < 4; slot++) {
        const st = virtualGamepadManager.getSlotState(slot);
        if (st.seq > 0 && st.seq !== lastSeqRef.current[slot]) {
          lastSeqRef.current[slot] = st.seq;
          lastPacketAtRef.current[slot] = now;
          packetTimesRef.current[slot].push(now);
        }
      }
    });
  }, []);

  // Low-frequency metrics → React (≈4.5 Hz), only when values change.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      const cutoff = now - 1000;
      const nextRates: [number, number, number, number] = [0, 0, 0, 0];
      const nextPulse: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      for (let slot = 0; slot < 4; slot++) {
        const list = packetTimesRef.current[slot];
        let drop = 0;
        while (drop < list.length && list[drop] < cutoff) drop++;
        if (drop) list.splice(0, drop);
        nextRates[slot] = list.length;
        nextPulse[slot] = now - lastPacketAtRef.current[slot] < 220;
      }
      setRates((prev) =>
        prev.every((v, i) => v === nextRates[i]) ? prev : nextRates,
      );
      setPulseActive((prev) =>
        prev.every((v, i) => v === nextPulse[i]) ? prev : nextPulse,
      );
    }, 220);
    return () => window.clearInterval(timer);
  }, []);

  // Single rAF loop paints every live value straight into the DOM.
  useEffect(() => {
    let rafId = 0;
    const lastTs = [-1, -1, -1, -1];
    let lastConnSig = '';

    const frame = () => {
      const mode = modeRef.current;
      const now = performance.now();
      let combined = 0;

      let pads: (Gamepad | null)[] = [];
      if (mode === 'gamepad-api' && typeof navigator.getGamepads === 'function') {
        try {
          pads = navigator.getGamepads() as (Gamepad | null)[];
        } catch {
          pads = [];
        }
      }

      let connSig = '';
      for (let slot = 0; slot < 4; slot++) {
        let state: ControllerInputState;
        let connected: boolean;
        let subtitle: string;

        if (mode === 'ws') {
          const player = playersRef.current.find((p) => p.slot === slot);
          connected = Boolean(player);
          state = virtualGamepadManager.getSlotState(slot);
          subtitle = player
            ? `${player.transport.toUpperCase()} · SEQ #${state.seq} · ${hex4(state.buttonsMask)}`
            : 'NO SIGNAL // PAIR PHONE TO BIND';
        } else {
          const scratch = scratchRef.current[slot];
          readPadInto(pads[slot], scratch);
          connected = scratch.connected;
          state = scratch.state;
          connSig += connected ? `${scratch.id}|${scratch.canRumble ? 1 : 0};` : '-;';
          if (connected && scratch.timestamp !== lastTs[slot]) {
            lastTs[slot] = scratch.timestamp;
            lastPacketAtRef.current[slot] = now;
            packetTimesRef.current[slot].push(now);
          }
          subtitle = connected
            ? `W3C ${pads[slot]?.mapping === 'standard' ? 'STANDARD' : 'RAW'} · TS ${state.seq} · ${hex4(state.buttonsMask)}`
            : 'CONNECT USB / BLUETOOTH PAD OR PRESS ANY BUTTON';
        }

        if (connected) combined |= state.buttonsMask;
        paintSlot(domRef.current[slot], cacheRef.current[slot], state, connected, subtitle);
      }

      const maskEl = maskElRef.current;
      if (maskEl) {
        const text = hex4(combined);
        if (maskEl.textContent !== text) {
          maskEl.textContent = text;
          maskEl.style.color = combined !== 0 ? '#FF3B5C' : 'rgba(245,244,240,0.45)';
        }
      }

      if (mode === 'gamepad-api' && connSig !== lastConnSig) {
        lastConnSig = connSig;
        const scratch = scratchRef.current;
        setApiPads(
          SLOTS.map((s) =>
            scratch[s].connected
              ? { id: scratch[s].id || `Standard Gamepad #${s + 1}`, canRumble: scratch[s].canRumble }
              : null,
          ),
        );
      } else if (mode === 'ws') {
        lastConnSig = '';
      }

      rafId = window.requestAnimationFrame(frame);
    };

    rafId = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, []);

  const activeCount =
    sourceMode === 'ws' ? players.length : apiPads.filter(Boolean).length;
  const peakHz = Math.max(...rates);

  const handlePulseSlot = useCallback(
    (slot: number) => {
      playSwitchClack(1.05);
      const player = playersRef.current.find((p) => p.slot === slot);
      if (modeRef.current === 'ws' && player) {
        onTestRumble(player.id);
      } else {
        pulseLocalGamepad(slot);
      }
      setBuzzingSlot(slot);
      timersRef.current.push(
        window.setTimeout(() => {
          setBuzzingSlot((curr) => (curr === slot ? null : curr));
        }, 260),
      );
    },
    [onTestRumble],
  );

  const handleBuzzAll = () => {
    if (activeCount === 0) return;
    playSwitchClack(0.85);
    if (sourceMode === 'ws') {
      for (const p of players) onTestRumble(p.id);
    } else {
      apiPads.forEach((pad, slot) => {
        if (pad?.canRumble) pulseLocalGamepad(slot);
      });
    }
    setBuzzingAll(true);
    timersRef.current.push(window.setTimeout(() => setBuzzingAll(false), 320));
  };

  return (
    <div className="flex flex-col h-full gap-3.5 text-[#F5F4F0]">
      {/* Top Diagnostic Telemetry Header Bar */}
      <div className="console-deck rounded-2xl overflow-hidden shrink-0">
        <div className="h-1 w-full smpte-bar opacity-90" />
        <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl crt-well flex items-center justify-center shrink-0 relative">
              <Activity className="w-5 h-5 text-[#B5FF2A]" />
              <span
                className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-[#07060B] ${
                  activeCount > 0 ? 'bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A]' : 'bg-white/25'
                }`}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-brand font-extrabold text-base sm:text-lg tracking-tight text-[#F5F4F0] leading-tight">
                  PAD LAB // OSCILLOSCOPE BENCH
                </h3>
                <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-[#22D3EE] font-mono-tech text-[9px] font-bold tracking-widest">
                  TEK-MKII
                </span>
              </div>
              <p className="font-mono-tech text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.1em] text-white/45 truncate mt-0.5">
                {sourceMode === 'ws'
                  ? 'PHONE INPUT BUS // RAW PACKETS · SEQ · HAPTICS'
                  : 'navigator.getGamepads() // WHAT GAMES SEE (PHONES + USB/BT)'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="crt-well rounded-xl px-3 py-1.5 flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    activeCount > 0
                      ? 'bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A] animate-pulse'
                      : 'bg-[#FF3B5C]/70'
                  }`}
                />
                <span className="font-mono-tech text-[11px] font-extrabold tracking-wider text-[#B5FF2A]">
                  {activeCount}/4 PADS
                </span>
              </div>
              <span className="w-px h-3.5 bg-white/12" />
              <div
                className="font-mono-tech text-[11px] font-bold tracking-wider text-[#22D3EE]"
                title="Peak input update rate"
              >
                {peakHz} HZ
              </div>
              <span className="w-px h-3.5 bg-white/12" />
              <div
                ref={maskElRef}
                className="font-mono-tech text-[11px] font-bold tracking-wider"
                style={{ color: 'rgba(245,244,240,0.45)' }}
                title="Combined button bitmask"
              >
                0x0000
              </div>
            </div>

            <div className="crt-well rounded-xl p-1 flex items-center gap-1" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={sourceMode === 'ws'}
                onClick={() => {
                  playSwitchClack(1.05);
                  setSourceMode('ws');
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono-tech text-[10px] font-extrabold uppercase tracking-wider cursor-pointer transition ${
                  sourceMode === 'ws'
                    ? 'bg-[#B5FF2A] text-[#07060B] shadow-[0_0_12px_rgba(181,255,42,0.35)]'
                    : 'text-white/55 hover:text-white'
                }`}
              >
                <Wifi className="w-3 h-3" /> PHONE BUS
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sourceMode === 'gamepad-api'}
                onClick={() => {
                  playSwitchClack(1.05);
                  setSourceMode('gamepad-api');
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono-tech text-[10px] font-extrabold uppercase tracking-wider cursor-pointer transition ${
                  sourceMode === 'gamepad-api'
                    ? 'bg-[#22D3EE] text-[#07060B] shadow-[0_0_12px_rgba(34,211,238,0.35)]'
                    : 'text-white/55 hover:text-white'
                }`}
              >
                <Cpu className="w-3 h-3" /> WEB API
              </button>
            </div>

            <button
              type="button"
              disabled={activeCount === 0}
              onClick={handleBuzzAll}
              className={`console-btn-hot inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-mono-tech text-[11px] font-extrabold uppercase tracking-wider cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                buzzingAll ? 'translate-y-[2.5px] brightness-110' : ''
              }`}
            >
              <Vibrate className="w-3.5 h-3.5" />
              RUMBLE ALL
            </button>
          </div>
        </div>
      </div>

      {/* 2x2 Hardware Diagnostic Modules */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 flex-1">
        {SLOTS.map((slot) => {
          const player = players.find((p) => p.slot === slot);
          const apiPad = apiPads[slot];
          const isConnected = sourceMode === 'ws' ? Boolean(player) : Boolean(apiPad);
          const slotColor =
            sourceMode === 'ws' ? player?.color ?? '#22D3EE' : API_SLOT_COLORS[slot];
          const displayName =
            sourceMode === 'ws'
              ? player
                ? player.name
                : `PORT 0${slot + 1} · OPEN`
              : apiPad
                ? apiPad.id
                : `GAMEPAD SLOT 0${slot + 1} · IDLE`;
          return (
            <SlotModule
              key={slot}
              slot={slot}
              dom={domRef.current[slot]}
              isConnected={isConnected}
              slotColor={slotColor}
              displayName={displayName}
              hz={isConnected ? rates[slot] : 0}
              pulsing={isConnected && pulseActive[slot]}
              isBuzzing={buzzingSlot === slot}
              canPulse={sourceMode === 'ws' ? Boolean(player) : Boolean(apiPad?.canRumble)}
              onPulse={handlePulseSlot}
            />
          );
        })}
      </div>
    </div>
  );
};
