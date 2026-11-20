import React, { useEffect, useLayoutEffect, useRef } from 'react';

/*
 * Touch primitives for the phone controller.
 *
 * Hot-path rule: nothing in here calls setState from a pointer event. Pressed
 * visuals are driven by `data-*` attributes and inline styles written straight
 * to the DOM through refs, so a touch reaches the network without waiting for
 * React to re-render anything.
 */

export interface ButtonMaskUpdater {
  onButtonChange: (buttonIndex: number, pressed: boolean) => void;
  onAnalogTrigger?: (side: 'l2' | 'r2', value: number) => void;
  hapticsEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Styles (scoped to ctl-* classes; injected once, after index.css has loaded)
// ---------------------------------------------------------------------------

const PRIMITIVE_STYLE_ID = 'couch-ctl-primitives';
const PRIMITIVE_CSS = `
.ctl-key{-webkit-tap-highlight-color:transparent;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}
.ctl-key.ctl-key{transition:transform 130ms cubic-bezier(.34,1.56,.64,1),box-shadow 150ms ease,filter 150ms ease;}
.ctl-key.ctl-key[data-pressed]{transform:translateY(3px) scale(.93);filter:brightness(1.22) saturate(1.15);box-shadow:inset 0 2px 7px rgba(0,0,0,.58),inset 0 0 12px var(--ctl-glow-in),0 0 18px var(--ctl-glow),0 0 38px var(--ctl-glow-far),0 1px 0 rgba(0,0,0,.72);transition-duration:0ms;}
.ctl-key .ctl-key-ring{opacity:0;transition:opacity 140ms ease;}
.ctl-key[data-pressed] .ctl-key-ring{opacity:1;transition-duration:0ms;}
.ctl-key .ctl-ripple{opacity:0;}
.ctl-dpad{touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;transition:box-shadow 120ms ease;}
.ctl-dpad.ctl-dpad[data-active]{box-shadow:inset 0 4px 16px rgba(0,0,0,.88),0 0 24px var(--ctl-accent-30),0 1px 0 rgba(255,255,255,.12);transition-duration:0ms;}
.ctl-dpad .ctl-dpad-cross{transition:transform 70ms cubic-bezier(.22,1,.36,1);}
.ctl-dpad .ctl-arm{transition:color 90ms ease,background 90ms ease;}
.ctl-dpad[data-up] .ctl-arm-up{color:var(--ctl-accent);background:linear-gradient(180deg,var(--ctl-accent-30) 0%,transparent 100%);transition-duration:0ms;}
.ctl-dpad[data-down] .ctl-arm-down{color:var(--ctl-accent);background:linear-gradient(0deg,var(--ctl-accent-30) 0%,transparent 100%);transition-duration:0ms;}
.ctl-dpad[data-left] .ctl-arm-left{color:var(--ctl-accent);background:linear-gradient(90deg,var(--ctl-accent-30) 0%,transparent 100%);transition-duration:0ms;}
.ctl-dpad[data-right] .ctl-arm-right{color:var(--ctl-accent);background:linear-gradient(270deg,var(--ctl-accent-30) 0%,transparent 100%);transition-duration:0ms;}
.ctl-dpad[data-up] .ctl-arm-up .ctl-led,.ctl-dpad[data-down] .ctl-arm-down .ctl-led,.ctl-dpad[data-left] .ctl-arm-left .ctl-led,.ctl-dpad[data-right] .ctl-arm-right .ctl-led{background:var(--ctl-accent);box-shadow:0 0 8px var(--ctl-accent);}
.ctl-dpad .ctl-pip{transition:transform 90ms ease,background 90ms ease,box-shadow 90ms ease;}
.ctl-dpad[data-up][data-left] .ctl-pip-nw,.ctl-dpad[data-up][data-right] .ctl-pip-ne,.ctl-dpad[data-down][data-left] .ctl-pip-sw,.ctl-dpad[data-down][data-right] .ctl-pip-se{background:var(--ctl-accent);box-shadow:0 0 9px var(--ctl-accent);transform:scale(1.4);}
.ctl-stick{touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}
.ctl-stick .ctl-stick-label{transition:color 120ms ease;}
.ctl-stick[data-active] .ctl-stick-label{color:var(--ctl-hl);transition-duration:0ms;}
.ctl-stick .ctl-stick-telemetry{transition:opacity 120ms ease;}
`;

let primitiveStylesInjected = false;
function ensurePrimitiveStyles(): void {
  if (primitiveStylesInjected || typeof document === 'undefined') return;
  primitiveStylesInjected = true;
  if (document.getElementById(PRIMITIVE_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = PRIMITIVE_STYLE_ID;
  el.textContent = PRIMITIVE_CSS;
  document.head.appendChild(el);
}

/** Appends a 2-digit hex alpha to a #RGB / #RRGGBB colour; other formats pass through. */
export function withAlpha(color: string, alphaHex: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}${alphaHex}`;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [r, g, b] = color.slice(1);
    return `#${r}${r}${g}${g}${b}${b}${alphaHex}`;
  }
  return color;
}

// ---------------------------------------------------------------------------
// Global "let go of everything" registry
// ---------------------------------------------------------------------------

const releasers = new Set<() => void>();

/**
 * Releases every pressed button, D-pad and stick on the page (firing their
 * "released" callbacks) and forgets every tracked finger, so fingers that are
 * still physically down do not re-press anything until they lift and touch
 * again. Call on visibilitychange / blur / pagehide.
 */
export function releaseAllTouchInputs(): void {
  for (const fn of Array.from(releasers)) {
    try {
      fn();
    } catch {
      // keep releasing the rest
    }
  }
  pointerOwner.clear();
  pointerCapturer.clear();
}

function useReleaser(release: () => void): void {
  const ref = useRef(release);
  ref.current = release;
  useEffect(() => {
    const fn = () => ref.current();
    releasers.add(fn);
    return () => {
      releasers.delete(fn);
      fn();
    };
  }, []);
}

// ---------------------------------------------------------------------------
// Web Audio micro-click & rumble thud
// ---------------------------------------------------------------------------

let sharedAudioCtx: AudioContext | null = null;
let sharedClickNoiseBuffer: AudioBuffer | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!sharedAudioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return null;
      sharedAudioCtx = new Ctx();
    }
    if (sharedAudioCtx.state !== 'running') {
      void sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Unlocks Web Audio from inside a user gesture (iOS only allows it from
 * touchend/click). Returns true once the context is running.
 */
export function unlockAudio(): boolean {
  const ctx = getAudioContext();
  if (!ctx) return true;
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    // ignore
  }
  return ctx.state === 'running';
}

function getClickNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (
    sharedClickNoiseBuffer &&
    sharedClickNoiseBuffer.sampleRate === ctx.sampleRate
  ) {
    return sharedClickNoiseBuffer;
  }
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.01));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const decay = Math.pow(1 - i / length, 2.2);
    data[i] = (Math.random() * 2 - 1) * decay;
  }
  sharedClickNoiseBuffer = buffer;
  return buffer;
}

/**
 * Tactile mechanical key-switch micro-click (6ms filtered transient + soft 180Hz body thud).
 * Essential on iOS Safari where navigator.vibrate is unsupported.
 */
export function triggerSwitchClick(
  enabled: boolean | undefined,
  pitch = 1,
): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'running') return;

  try {
    const now = ctx.currentTime;
    const safePitch = Math.max(0.55, Math.min(1.6, pitch));

    const noise = ctx.createBufferSource();
    noise.buffer = getClickNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2600 * safePitch, now);
    filter.Q.setValueAtTime(2.4, now);

    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.085, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.0065);

    noise.connect(filter);
    filter.connect(clickGain);
    clickGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.008);

    const bodyOsc = ctx.createOscillator();
    bodyOsc.type = 'sine';
    bodyOsc.frequency.setValueAtTime(180 * safePitch, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(72, now + 0.022);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.11, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.024);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(ctx.destination);
    bodyOsc.start(now);
    bodyOsc.stop(now + 0.026);
  } catch {
    // ignore Web Audio errors on locked contexts
  }
}

/**
 * Short low-frequency sub-bass motor thump for rumble impulses (gives iOS users felt audio impact).
 */
export function triggerRumbleThud(
  enabled: boolean | undefined,
  durationMs = 160,
  intensity = 0.7,
): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'running') return;

  try {
    const now = ctx.currentTime;
    const dur = Math.max(0.08, Math.min(0.28, durationMs / 1000));
    const clampedIntensity = Math.max(0.2, Math.min(1, intensity));

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(74, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + dur);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(160, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18 * clampedIntensity, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.01);
  } catch {
    // ignore Web Audio errors
  }
}

function canVibrate(): boolean {
  return (
    typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  );
}

/** Haptic tap. Accepts a duration or a vibrate() pattern. */
export function triggerHaptic(
  enabled: boolean | undefined,
  ms: number | number[] = 12,
): void {
  if (!enabled || !canVibrate()) return;
  try {
    if (Array.isArray(ms)) {
      navigator.vibrate(ms.map((v) => Math.max(0, Math.min(400, Math.round(v)))));
    } else {
      navigator.vibrate(Math.max(4, Math.min(400, Math.round(ms))));
    }
  } catch {
    // ignore unsupported browsers
  }
}

/**
 * Host-driven rumble. Phones only have an on/off motor, so lower intensities
 * are rendered as a pulse-width pattern; the total length follows durationMs.
 */
export function triggerRumble(
  enabled: boolean | undefined,
  durationMs: number,
  intensity: number,
): void {
  if (!enabled || !canVibrate()) return;
  const total = Math.max(0, Math.min(1500, Math.round(durationMs)));
  const k = Math.max(0, Math.min(1, intensity));
  try {
    if (total === 0 || k === 0) {
      navigator.vibrate(0);
      return;
    }
    if (k >= 0.8 || total < 60) {
      navigator.vibrate(Math.max(12, total));
      return;
    }
    const on = Math.round(10 + k * 22);
    const off = Math.round(8 + (1 - k) * 26);
    const pattern: number[] = [];
    let elapsed = 0;
    while (elapsed < total) {
      pattern.push(on, off);
      elapsed += on + off;
    }
    navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

export function stopHaptics(): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(0);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Key routing: pointer capture + slide between keys
// ---------------------------------------------------------------------------
//
// Every finger is captured by the key it first touched, so up/cancel always
// reach us even if the finger wanders. While it moves we hit-test: leaving a
// key (plus a small slop margin) releases it, and arriving on another key
// presses that one, so a thumb can roll from B to A like on real hardware.

interface KeyTarget {
  el: HTMLElement | null;
  pointers: Set<number>;
  rect: DOMRect | null;
  add(pointerId: number): void;
  remove(pointerId: number): void;
  reset(): void;
}

const keyByElement = new WeakMap<Element, KeyTarget>();
/** pointerId -> key currently pressed by that finger (null = finger in a gap). */
const pointerOwner = new Map<number, KeyTarget | null>();
/** pointerId -> key whose element holds the pointer capture. */
const pointerCapturer = new Map<number, KeyTarget>();

function slopFor(rect: DOMRect): number {
  return Math.max(8, Math.min(16, Math.min(rect.width, rect.height) * 0.28));
}

function isInsideWithSlop(t: KeyTarget, x: number, y: number): boolean {
  const r = t.rect;
  if (!r) return false;
  const s = slopFor(r);
  return (
    x >= r.left - s && x <= r.right + s && y >= r.top - s && y <= r.bottom + s
  );
}

function keyPointerDown(t: KeyTarget, e: React.PointerEvent<HTMLElement>): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  const id = e.pointerId;
  try {
    e.currentTarget.setPointerCapture(id);
  } catch {
    // ignore
  }
  const prev = pointerOwner.get(id);
  if (prev && prev !== t) prev.remove(id);
  pointerOwner.set(id, t);
  pointerCapturer.set(id, t);
  t.add(id);
}

function keyPointerMove(e: React.PointerEvent<HTMLElement>): void {
  const id = e.pointerId;
  if (!pointerOwner.has(id)) return;
  const cur = pointerOwner.get(id) ?? null;
  const x = e.clientX;
  const y = e.clientY;
  if (cur && isInsideWithSlop(cur, x, y)) return;

  let next: KeyTarget | null = null;
  const hit =
    typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(x, y)
      : null;
  const keyEl = hit?.closest('[data-ctl-key]');
  if (keyEl) next = keyByElement.get(keyEl) ?? null;
  if (next === cur) return;

  cur?.remove(id);
  pointerOwner.set(id, next);
  next?.add(id);
}

function keyPointerEnd(id: number): void {
  pointerCapturer.delete(id);
  if (!pointerOwner.has(id)) return;
  const cur = pointerOwner.get(id) ?? null;
  pointerOwner.delete(id);
  cur?.remove(id);
}

interface KeyFeedback {
  onPress: (pressed: boolean) => void;
  haptics: boolean;
  sound: boolean;
  pitch: number;
  hapticMs: number;
}

function playRipple(el: HTMLElement | null): void {
  if (!el || typeof el.animate !== 'function') return;
  try {
    el.animate(
      [
        { transform: 'scale(0.8)', opacity: 0.9 },
        { transform: 'scale(1.7)', opacity: 0 },
      ],
      { duration: 340, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  } catch {
    // ignore
  }
}

function useKeyTarget(
  elRef: React.RefObject<HTMLElement | null>,
  rippleRef: React.RefObject<HTMLElement | null>,
  feedbackRef: React.MutableRefObject<KeyFeedback>,
): KeyTarget {
  const targetRef = useRef<KeyTarget | null>(null);
  if (!targetRef.current) {
    const t: KeyTarget = {
      el: null,
      pointers: new Set<number>(),
      rect: null,
      add(id) {
        if (t.pointers.has(id)) return;
        const wasIdle = t.pointers.size === 0;
        t.pointers.add(id);
        if (!wasIdle) return;
        const el = t.el;
        if (el) {
          // Measure before the pressed transform is applied.
          t.rect = el.getBoundingClientRect();
          el.setAttribute('data-pressed', '');
        }
        const fb = feedbackRef.current;
        fb.onPress(true);
        playRipple(rippleRef.current);
        triggerHaptic(fb.haptics, fb.hapticMs);
        triggerSwitchClick(fb.sound, fb.pitch);
      },
      remove(id) {
        if (!t.pointers.delete(id)) return;
        if (t.pointers.size > 0) return;
        t.el?.removeAttribute('data-pressed');
        feedbackRef.current.onPress(false);
      },
      reset() {
        if (t.pointers.size === 0) return;
        for (const id of t.pointers) {
          if (pointerOwner.get(id) === t) pointerOwner.set(id, null);
        }
        t.pointers.clear();
        t.el?.removeAttribute('data-pressed');
        feedbackRef.current.onPress(false);
      },
    };
    targetRef.current = t;
  }

  useLayoutEffect(() => {
    ensurePrimitiveStyles();
    const t = targetRef.current!;
    const el = elRef.current;
    t.el = el;
    if (el) keyByElement.set(el, t);
    const release = () => t.reset();
    releasers.add(release);
    return () => {
      releasers.delete(release);
      // Fingers captured by this element will never deliver another event.
      for (const [id, cap] of pointerCapturer) {
        if (cap === t) keyPointerEnd(id);
      }
      t.reset();
      if (el) keyByElement.delete(el);
      t.el = null;
    };
  }, [elRef, rippleRef]);

  return targetRef.current;
}

function shapeClassFor(shape: 'circle' | 'pill' | 'bumper'): string {
  return shape === 'bumper' ? 'rounded-xl' : 'rounded-full';
}

function glowVars(accent: string): React.CSSProperties {
  return {
    ['--ctl-accent' as string]: accent,
    ['--ctl-glow' as string]: withAlpha(accent, '88'),
    ['--ctl-glow-in' as string]: withAlpha(accent, '55'),
    ['--ctl-glow-far' as string]: withAlpha(accent, '38'),
  } as React.CSSProperties;
}

interface KeyShellProps {
  label: React.ReactNode;
  subLabel?: string;
  accentColor: string;
  className: string;
  shape: 'circle' | 'pill' | 'bumper';
  concave?: boolean;
  ariaLabel?: string;
  feedback: KeyFeedback;
}

/** Shared markup + behaviour for TactileButton and DirectionalAxisButton. */
const KeyShell: React.FC<KeyShellProps> = ({
  label,
  subLabel,
  accentColor,
  className,
  shape,
  concave = false,
  ariaLabel,
  feedback,
}) => {
  const elRef = useRef<HTMLButtonElement>(null);
  const rippleRef = useRef<HTMLSpanElement>(null);
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const target = useKeyTarget(elRef, rippleRef, feedbackRef);

  const shapeClass = shapeClassFor(shape);
  const posClass = /\b(absolute|fixed|sticky)\b/.test(className)
    ? ''
    : 'relative';

  return (
    <button
      ref={elRef}
      type="button"
      tabIndex={-1}
      data-ctl-key=""
      aria-label={
        ariaLabel ?? (typeof label === 'string' && label ? label : undefined)
      }
      onPointerDown={(e) => keyPointerDown(target, e)}
      onPointerMove={keyPointerMove}
      onPointerUp={(e) => keyPointerEnd(e.pointerId)}
      onPointerCancel={(e) => keyPointerEnd(e.pointerId)}
      onLostPointerCapture={(e) => keyPointerEnd(e.pointerId)}
      onContextMenu={(e) => e.preventDefault()}
      style={glowVars(accentColor)}
      className={`ctl-key controller-surface tactile-key ${posClass} select-none flex flex-col items-center justify-center font-display font-bold border ${shapeClass} ${className}`}
    >
      {/* Expanding halo ripple, replayed via WAAPI on each fresh press */}
      <span
        ref={rippleRef}
        style={{
          borderColor: accentColor,
          boxShadow: `0 0 12px ${withAlpha(accentColor, '99')}`,
        }}
        className={`ctl-ripple pointer-events-none absolute -inset-1 border-2 ${shapeClass}`}
      />

      {/* Molded 3D keycap specular rim highlight */}
      <span
        className={`pointer-events-none absolute inset-[1px] ${shapeClass} bg-gradient-to-b from-white/[0.26] via-transparent to-black/[0.16]`}
      />

      {/* Pressed luminous inner ring (CSS-driven by data-pressed) */}
      <span
        style={{
          borderColor: withAlpha(accentColor, 'cc'),
          boxShadow: `inset 0 0 8px ${withAlpha(accentColor, '66')}`,
        }}
        className={`ctl-key-ring pointer-events-none absolute inset-[2px] border ${shapeClass}`}
      />

      {concave && shape === 'circle' && (
        <span className="pointer-events-none absolute inset-[16%] rounded-full bg-gradient-to-b from-black/[0.18] via-transparent to-white/[0.16] shadow-[inset_0_2px_4px_rgba(0,0,0,0.24)]" />
      )}

      <span className="relative z-10 leading-none pointer-events-none drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.42)]">
        {label}
      </span>
      {subLabel && (
        <span className="relative z-10 text-[8px] uppercase tracking-wider opacity-75 leading-none mt-0.5 pointer-events-none font-mono-tech">
          {subLabel}
        </span>
      )}
    </button>
  );
};

// --- Tactile Hardware Button ---
interface TactileButtonProps {
  buttonIndex: number;
  label: React.ReactNode;
  subLabel?: string;
  onButtonChange: (buttonIndex: number, pressed: boolean) => void;
  hapticsEnabled?: boolean;
  soundClicks?: boolean;
  accentColor?: string;
  clickPitch?: number;
  className?: string;
  shape?: 'circle' | 'pill' | 'bumper';
  concave?: boolean;
  ariaLabel?: string;
}

export const TactileButton: React.FC<TactileButtonProps> = ({
  buttonIndex,
  label,
  subLabel,
  onButtonChange,
  hapticsEnabled = true,
  soundClicks = false,
  accentColor = '#ff6b2b',
  clickPitch = 1,
  className = '',
  shape = 'circle',
  concave = false,
  ariaLabel,
}) => (
  <KeyShell
    label={label}
    subLabel={subLabel}
    accentColor={accentColor}
    className={className}
    shape={shape}
    concave={concave}
    ariaLabel={ariaLabel}
    feedback={{
      onPress: (pressed) => onButtonChange(buttonIndex, pressed),
      haptics: hapticsEnabled,
      sound: soundClicks,
      pitch: clickPitch,
      hapticMs: 10,
    }}
  />
);

// --- Directional Axis Button (e.g. N64 C-Buttons) ---
interface DirectionalAxisButtonProps {
  label: React.ReactNode;
  subLabel?: string;
  onPressChange: (pressed: boolean) => void;
  hapticsEnabled?: boolean;
  soundClicks?: boolean;
  accentColor?: string;
  clickPitch?: number;
  className?: string;
  shape?: 'circle' | 'pill' | 'bumper';
  ariaLabel?: string;
}

export const DirectionalAxisButton: React.FC<DirectionalAxisButtonProps> = ({
  label,
  subLabel,
  onPressChange,
  hapticsEnabled = true,
  soundClicks = false,
  accentColor = '#facc15',
  clickPitch = 1.15,
  className = '',
  shape = 'circle',
  ariaLabel,
}) => (
  <KeyShell
    label={label}
    subLabel={subLabel}
    accentColor={accentColor}
    className={className}
    shape={shape}
    ariaLabel={ariaLabel}
    feedback={{
      onPress: onPressChange,
      haptics: hapticsEnabled,
      sound: soundClicks,
      pitch: clickPitch,
      hapticMs: 9,
    }}
  />
);

// --- 3D Physical Rocker 8-Way D-Pad ---
export interface DPadDirections {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

interface DPadProps {
  upIndex: number;
  downIndex: number;
  leftIndex: number;
  rightIndex: number;
  onDirectionsChange: (dirs: DPadDirections) => void;
  hapticsEnabled?: boolean;
  soundClicks?: boolean;
  sizeClass?: string;
  accentColor?: string;
  tone?: 'light' | 'dark';
  styleVariant?: 'cross' | 'saucer';
}

const DIR_UP = 1;
const DIR_DOWN = 2;
const DIR_LEFT = 4;
const DIR_RIGHT = 8;

/** Component threshold to switch a direction on / keep it on (hysteresis stops boundary flicker). */
const DPAD_ON = 0.42;
const DPAD_HOLD = 0.32;

function maskToDirs(mask: number): DPadDirections {
  return {
    up: (mask & DIR_UP) !== 0,
    down: (mask & DIR_DOWN) !== 0,
    left: (mask & DIR_LEFT) !== 0,
    right: (mask & DIR_RIGHT) !== 0,
  };
}

/**
 * Unified multi-touch 8-way D-Pad with 3D physical rocker tilt.
 * Rolling a thumb around the pad moves smoothly through the diagonals; the
 * cardinal sectors are slightly wider than the diagonal ones (~50° vs ~40°).
 */
export const TouchDPad: React.FC<DPadProps> = ({
  onDirectionsChange,
  hapticsEnabled = true,
  soundClicks = false,
  sizeClass = 'w-40 h-40',
  accentColor = '#ff3b1d',
  tone = 'dark',
  styleVariant = 'cross',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const crossRef = useRef<HTMLDivElement>(null);
  /** Fingers on the pad, most recent last; the last one steers. */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const rectRef = useRef<DOMRect | null>(null);
  const lastMaskRef = useRef(0);
  const latestRef = useRef({ onDirectionsChange, hapticsEnabled, soundClicks });
  latestRef.current = { onDirectionsChange, hapticsEnabled, soundClicks };

  const applyMask = (mask: number) => {
    if (mask === lastMaskRef.current) return;
    lastMaskRef.current = mask;
    const dirs = maskToDirs(mask);

    // Paint first via the DOM (no React render), then notify.
    const el = containerRef.current;
    if (el) {
      el.toggleAttribute('data-up', dirs.up);
      el.toggleAttribute('data-down', dirs.down);
      el.toggleAttribute('data-left', dirs.left);
      el.toggleAttribute('data-right', dirs.right);
      el.toggleAttribute('data-active', mask !== 0);
    }
    const cross = crossRef.current;
    if (cross) {
      const rotX = (dirs.up ? 13 : 0) + (dirs.down ? -13 : 0);
      const rotY = (dirs.right ? 13 : 0) + (dirs.left ? -13 : 0);
      const shiftX = (dirs.right ? 2.5 : 0) + (dirs.left ? -2.5 : 0);
      const shiftY = (dirs.down ? 2.5 : 0) + (dirs.up ? -2.5 : 0);
      cross.style.transform = `perspective(220px) rotateX(${rotX}deg) rotateY(${rotY}deg) translate3d(${shiftX}px, ${shiftY}px, 0)`;
    }

    const l = latestRef.current;
    l.onDirectionsChange(dirs);
    if (mask !== 0) {
      triggerHaptic(l.hapticsEnabled, 7);
      triggerSwitchClick(l.soundClicks, 0.88);
    }
  };

  const computeMask = (clientX: number, clientY: number): number => {
    const rect = rectRef.current;
    if (!rect) return 0;
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    const prev = lastMaskRef.current;
    const deadzone = rect.width * (prev === 0 ? 0.11 : 0.085);
    if (dist <= deadzone) return 0;
    const cos = dx / dist;
    const sin = dy / dist;
    const th = (bit: number) => ((prev & bit) !== 0 ? DPAD_HOLD : DPAD_ON);
    let mask = 0;
    if (cos > th(DIR_RIGHT)) mask |= DIR_RIGHT;
    else if (cos < -th(DIR_LEFT)) mask |= DIR_LEFT;
    if (sin > th(DIR_DOWN)) mask |= DIR_DOWN;
    else if (sin < -th(DIR_UP)) mask |= DIR_UP;
    if (mask === 0) {
      // Hysteresis can leave a gap right on a boundary: fall back to the
      // dominant axis so a finger outside the dead zone always registers.
      if (Math.abs(cos) >= Math.abs(sin)) mask = cos > 0 ? DIR_RIGHT : DIR_LEFT;
      else mask = sin > 0 ? DIR_DOWN : DIR_UP;
    }
    return mask;
  };

  const steer = () => {
    const pts = pointersRef.current;
    if (pts.size === 0) {
      applyMask(0);
      return;
    }
    let last: { x: number; y: number } | undefined;
    for (const p of pts.values()) last = p;
    if (last) applyMask(computeMask(last.x, last.y));
  };

  const releasePointer = (id: number) => {
    const pts = pointersRef.current;
    if (!pts.delete(id)) return;
    steer();
  };

  useReleaser(() => {
    pointersRef.current.clear();
    applyMask(0);
  });

  useLayoutEffect(() => {
    ensurePrimitiveStyles();
  }, []);

  const isLight = tone === 'light';
  const isSaucer = styleVariant === 'saucer';

  const wellClasses = isLight
    ? 'bg-gradient-to-b from-[#1A1B29] to-[#121320] border-2 border-[#0E0F18] shadow-[inset_0_5px_14px_rgba(0,0,0,0.75),0_1px_0_rgba(255,255,255,0.2)]'
    : 'bg-gradient-to-b from-[#0E1015] to-[#08090D] border-2 border-[#141412] shadow-[inset_0_5px_16px_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.12)]';

  const verticalArmClasses = isLight
    ? 'bg-gradient-to-b from-[#ECEEF5] via-[#D6D8E2] to-[#BFC3D0] border-2 border-[#181924] shadow-[inset_0_2px_0_rgba(255,255,255,0.85),0_5px_0_#0F101A,0_9px_14px_rgba(0,0,0,0.5)]'
    : 'bg-gradient-to-b from-[#33363F] via-[#23252C] to-[#17191F] border-2 border-[#0C0D11] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.2),0_5px_0_#07080B,0_9px_14px_rgba(0,0,0,0.65)]';

  const horizontalArmClasses = isLight
    ? 'bg-gradient-to-b from-[#E6E8F0] via-[#D4D6E0] to-[#BCC0CE] border-2 border-[#181924] shadow-[inset_0_2px_0_rgba(255,255,255,0.82),0_5px_0_#0F101A,0_9px_14px_rgba(0,0,0,0.5)]'
    : 'bg-gradient-to-b from-[#30333C] via-[#22242B] to-[#16181E] border-2 border-[#0C0D11] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.18),0_5px_0_#07080B,0_9px_14px_rgba(0,0,0,0.65)]';

  const centerBridgeBg = isLight ? 'bg-[#D5D7E1]' : 'bg-[#24262E]';
  const dimpleOuter = isLight
    ? 'bg-gradient-to-b from-[#B4B8C6] to-[#E2E4EE] border border-[#181924]/25 shadow-[inset_0_2px_5px_rgba(0,0,0,0.35)]'
    : 'bg-gradient-to-b from-[#0E1015] to-[#1E212B] border border-white/10 shadow-[inset_0_2px_5px_rgba(0,0,0,0.9)]';
  const dimpleInner = isLight
    ? 'border-[#181924]/15 bg-[#C8CCD8]'
    : 'border-white/[0.08] bg-[#15171F]';
  const idleArrowClass = isLight ? 'text-[#4B4F62]' : 'text-white/30';
  const idleRidgeClass = isLight
    ? 'bg-[#181924]/22 shadow-[0_1px_0_rgba(255,255,255,0.75)]'
    : 'bg-black/55 shadow-[0_1px_0_rgba(255,255,255,0.14)]';

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Directional pad"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        rectRef.current = e.currentTarget.getBoundingClientRect();
        const pts = pointersRef.current;
        pts.delete(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        steer();
      }}
      onPointerMove={(e) => {
        const p = pointersRef.current.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        steer();
      }}
      onPointerUp={(e) => releasePointer(e.pointerId)}
      onPointerCancel={(e) => releasePointer(e.pointerId)}
      onLostPointerCapture={(e) => releasePointer(e.pointerId)}
      onContextMenu={(e) => e.preventDefault()}
      style={
        {
          ['--ctl-accent' as string]: accentColor,
          ['--ctl-accent-30' as string]: withAlpha(accentColor, '30'),
        } as React.CSSProperties
      }
      className={`ctl-dpad controller-surface relative shrink-0 rounded-full flex items-center justify-center ${wellClasses} ${sizeClass}`}
    >
      <div className="absolute inset-2 rounded-full border border-white/[0.07] pointer-events-none" />

      {/* 4 diagonal corner LED pips (lit by CSS when both neighbours are held) */}
      {[
        { cls: 'ctl-pip-nw', pos: 'top-[15%] left-[15%]' },
        { cls: 'ctl-pip-ne', pos: 'top-[15%] right-[15%]' },
        { cls: 'ctl-pip-sw', pos: 'bottom-[15%] left-[15%]' },
        { cls: 'ctl-pip-se', pos: 'bottom-[15%] right-[15%]' },
      ].map((pip) => (
        <span
          key={pip.cls}
          className={`ctl-pip ${pip.cls} pointer-events-none absolute w-1.5 h-1.5 rounded-full z-20 bg-white/15 ${pip.pos}`}
        />
      ))}

      {/* 3D rocker cross arms (or Genesis floating saucer) */}
      <div
        ref={crossRef}
        style={{
          transform:
            'perspective(220px) rotateX(0deg) rotateY(0deg) translate3d(0px, 0px, 0)',
          transformStyle: 'preserve-3d',
        }}
        className="ctl-dpad-cross relative w-[84%] h-[84%] pointer-events-none flex items-center justify-center"
      >
        {isSaucer && (
          <div className="absolute inset-[4%] rounded-full bg-gradient-to-b from-[#2A2D37] via-[#1A1C23] to-[#111218] border-2 border-[#090A0E] shadow-[inset_0_2px_2px_rgba(255,255,255,0.16),0_6px_0_#050608,0_10px_16px_rgba(0,0,0,0.7)]">
            <div className="absolute inset-[10%] rounded-full border border-dashed border-white/[0.12]" />
          </div>
        )}

        <div
          className={`absolute left-1/3 top-0 w-1/3 h-full rounded-[9px] ${verticalArmClasses}`}
        />
        <div
          className={`absolute top-1/3 left-0 h-1/3 w-full rounded-[9px] ${horizontalArmClasses}`}
        />

        <div
          className={`absolute left-[34%] top-[34%] w-[32%] h-[32%] ${centerBridgeBg} flex items-center justify-center`}
        >
          <div
            className={`w-[70%] h-[70%] rounded-full flex items-center justify-center ${dimpleOuter}`}
          >
            <div
              className={`w-[48%] h-[48%] rounded-full border ${dimpleInner}`}
            />
          </div>
        </div>

        {/* UP */}
        <div
          className={`ctl-arm ctl-arm-up absolute left-1/3 top-0 w-1/3 h-1/3 rounded-t-[9px] flex flex-col items-center justify-center gap-[3px] ${idleArrowClass}`}
        >
          <span className={`ctl-led w-4 h-[2.5px] rounded-full ${idleRidgeClass}`} />
          <span className={`w-3.5 h-[1.5px] rounded-full ${idleRidgeClass}`} />
          <span className="text-[8px] leading-none">▲</span>
        </div>

        {/* DOWN */}
        <div
          className={`ctl-arm ctl-arm-down absolute left-1/3 bottom-0 w-1/3 h-1/3 rounded-b-[9px] flex flex-col items-center justify-center gap-[3px] ${idleArrowClass}`}
        >
          <span className="text-[8px] leading-none">▼</span>
          <span className={`w-3.5 h-[1.5px] rounded-full ${idleRidgeClass}`} />
          <span className={`ctl-led w-4 h-[2.5px] rounded-full ${idleRidgeClass}`} />
        </div>

        {/* LEFT */}
        <div
          className={`ctl-arm ctl-arm-left absolute top-1/3 left-0 w-1/3 h-1/3 rounded-l-[9px] flex items-center justify-center gap-[3px] ${idleArrowClass}`}
        >
          <span className={`ctl-led h-4 w-[2.5px] rounded-full ${idleRidgeClass}`} />
          <span className={`h-3.5 w-[1.5px] rounded-full ${idleRidgeClass}`} />
          <span className="text-[8px] leading-none">◀</span>
        </div>

        {/* RIGHT */}
        <div
          className={`ctl-arm ctl-arm-right absolute top-1/3 right-0 w-1/3 h-1/3 rounded-r-[9px] flex items-center justify-center gap-[3px] ${idleArrowClass}`}
        >
          <span className="text-[8px] leading-none">▶</span>
          <span className={`h-3.5 w-[1.5px] rounded-full ${idleRidgeClass}`} />
          <span className={`ctl-led h-4 w-[2.5px] rounded-full ${idleRidgeClass}`} />
        </div>
      </div>
    </div>
  );
};

// --- Precision Hall-Effect Style Analog Stick ---
interface AnalogStickProps {
  onChange: (x: number, y: number) => void;
  hapticsEnabled?: boolean;
  soundClicks?: boolean;
  floatingCenter?: boolean;
  sizeClass?: string;
  label?: string;
  accentColor?: string;
  /** Optional anodized aluminum collar ring around the outer bezel (e.g. Vermilion / Cobalt) */
  ringColor?: string;
  /** Mechanical gate shape inside the well ('octagonal' for authentic N64 8-sided gate!) */
  gate?: 'circle' | 'octagonal';
  /** Cap tone ('light' for N64 matte-gray thumbstick, 'dark' for knurled graphite elastomer) */
  capTone?: 'dark' | 'light';
}

/** Radial dead zone (fraction of throw) and outer saturation point. */
const STICK_DEADZONE = 0.12;
const STICK_SATURATE = 0.94;

const OCTAGON_POINTS = [0, 45, 90, 135, 180, 225, 270, 315]
  .map((deg) => {
    const rad = ((deg - 22.5) * Math.PI) / 180;
    const r = 45.5;
    return `${(50 + Math.cos(rad) * r).toFixed(2)},${(50 + Math.sin(rad) * r).toFixed(2)}`;
  })
  .join(' ');

const OCTAGON_INNER_POINTS = [0, 45, 90, 135, 180, 225, 270, 315]
  .map((deg) => {
    const rad = ((deg - 22.5) * Math.PI) / 180;
    const r = 41.5;
    return `${(50 + Math.cos(rad) * r).toFixed(2)},${(50 + Math.sin(rad) * r).toFixed(2)}`;
  })
  .join(' ');

const GATE_R = 41;
const GATE_CIRCUMFERENCE = 2 * Math.PI * GATE_R;

export const AnalogStick: React.FC<AnalogStickProps> = ({
  onChange,
  hapticsEnabled = true,
  soundClicks = false,
  floatingCenter = false,
  sizeClass = 'w-32 h-32',
  label,
  accentColor = '#ff3b1d',
  ringColor,
  gate = 'circle',
  capTone = 'dark',
}) => {
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const telemetryRef = useRef<SVGGElement>(null);
  const vectorRef = useRef<SVGLineElement>(null);
  const arcRef = useRef<SVGCircleElement>(null);
  const pipRef = useRef<SVGCircleElement>(null);

  const pointerIdRef = useRef<number | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const originOffsetRef = useRef({ x: 0, y: 0 });
  const lastOutRef = useRef({ x: 0, y: 0 });
  const edgeArmedRef = useRef(true);
  const visualRef = useRef({ dx: 0, dy: 0, mag: 0, angle: 0, active: false });

  const isLightCap = capTone === 'light';
  const activeHighlight = ringColor ?? accentColor;
  const idleBorder = isLightCap
    ? '#181A22'
    : ringColor
      ? withAlpha(ringColor, '95')
      : 'rgba(255,255,255,0.22)';

  const latestRef = useRef({
    onChange,
    hapticsEnabled,
    soundClicks,
    activeHighlight,
    idleBorder,
  });
  latestRef.current = {
    onChange,
    hapticsEnabled,
    soundClicks,
    activeHighlight,
    idleBorder,
  };

  /** Writes the knob + telemetry straight to the DOM (no React render). */
  const paint = () => {
    const v = visualRef.current;
    const { activeHighlight: hl, idleBorder: idle } = latestRef.current;
    const knob = knobRef.current;
    if (knob) {
      knob.style.transform = `translate3d(${v.dx}px, ${v.dy}px, 0) scale(${v.active ? 1.06 : 1})`;
      knob.style.transition = v.active
        ? 'transform 0ms'
        : 'transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 180ms ease, border-color 180ms ease';
      knob.style.borderColor = v.active ? hl : idle;
      knob.style.boxShadow = v.active
        ? `0 0 ${14 + Math.round(v.mag * 16)}px ${withAlpha(hl, '77')}, 0 8px 18px rgba(0,0,0,0.82), inset 0 1.5px 1px rgba(255,255,255,0.35)`
        : '0 8px 16px rgba(0,0,0,0.78), inset 0 1.5px 1px rgba(255,255,255,0.28)';
    }
    padRef.current?.toggleAttribute('data-active', v.active);

    const showTelemetry = v.active && v.mag > 0;
    const group = telemetryRef.current;
    if (group) group.style.opacity = showTelemetry ? '1' : '0';
    if (!showTelemetry) return;

    const cos = Math.cos(v.angle);
    const sin = Math.sin(v.angle);
    const vec = vectorRef.current;
    if (vec) {
      vec.setAttribute('x2', (50 + cos * GATE_R * v.mag).toFixed(2));
      vec.setAttribute('y2', (50 + sin * GATE_R * v.mag).toFixed(2));
      vec.setAttribute('stroke-opacity', (0.4 + v.mag * 0.4).toFixed(2));
    }
    const arc = arcRef.current;
    if (arc) {
      const frac = 0.08 + v.mag * 0.16;
      const deg = (v.angle * 180) / Math.PI - (frac * 360) / 2;
      arc.setAttribute(
        'stroke-dasharray',
        `${(GATE_CIRCUMFERENCE * frac).toFixed(2)} ${GATE_CIRCUMFERENCE.toFixed(2)}`,
      );
      arc.setAttribute('transform', `rotate(${deg.toFixed(2)} 50 50)`);
      arc.style.opacity = (0.5 + v.mag * 0.5).toFixed(2);
    }
    const pip = pipRef.current;
    if (pip) {
      pip.setAttribute('cx', (50 + cos * GATE_R).toFixed(2));
      pip.setAttribute('cy', (50 + sin * GATE_R).toFixed(2));
    }
  };

  // Initial paint and repaint when colours change (layout / player colour).
  useLayoutEffect(() => {
    ensurePrimitiveStyles();
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHighlight, idleBorder]);

  const emit = (x: number, y: number) => {
    const last = lastOutRef.current;
    if (last.x === x && last.y === y) return;
    last.x = x;
    last.y = y;
    latestRef.current.onChange(x, y);
  };

  const updatePosition = (clientX: number, clientY: number) => {
    const rect = rectRef.current;
    if (!rect) return;
    const maxR = rect.width * 0.36;
    const cx = rect.left + rect.width / 2 + originOffsetRef.current.x;
    const cy = rect.top + rect.height / 2 + originOffsetRef.current.y;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }

    // Scaled radial dead zone: output ramps continuously from 0 at the edge of
    // the dead zone to 1 just before the gate, so there is no jump.
    const raw = Math.min(1, dist / maxR);
    const mag =
      raw <= STICK_DEADZONE
        ? 0
        : Math.min(1, (raw - STICK_DEADZONE) / (STICK_SATURATE - STICK_DEADZONE));
    const angle = Math.atan2(dy, dx);
    const nx = mag === 0 ? 0 : Math.round(Math.cos(angle) * mag * 1000) / 1000;
    const ny = mag === 0 ? 0 : Math.round(Math.sin(angle) * mag * 1000) / 1000;

    visualRef.current = { dx, dy, mag, angle, active: true };
    paint();
    emit(nx === 0 ? 0 : nx, ny === 0 ? 0 : ny);

    // A tiny tick when the stick hits the gate edge.
    if (mag >= 1 && edgeArmedRef.current) {
      edgeArmedRef.current = false;
      triggerHaptic(latestRef.current.hapticsEnabled, 5);
    } else if (mag < 0.85) {
      edgeArmedRef.current = true;
    }
  };

  const reset = () => {
    pointerIdRef.current = null;
    originOffsetRef.current = { x: 0, y: 0 };
    edgeArmedRef.current = true;
    visualRef.current = { dx: 0, dy: 0, mag: 0, angle: 0, active: false };
    paint();
    emit(0, 0);
  };

  useReleaser(() => {
    if (pointerIdRef.current !== null || visualRef.current.active) reset();
  });

  const handleDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (pointerIdRef.current !== null) return; // one thumb per stick
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    pointerIdRef.current = e.pointerId;
    const pad = padRef.current;
    rectRef.current = pad ? pad.getBoundingClientRect() : null;

    const rect = rectRef.current;
    if (floatingCenter && rect) {
      const maxFloat = rect.width * 0.16;
      const rawOx = e.clientX - (rect.left + rect.width / 2);
      const rawOy = e.clientY - (rect.top + rect.height / 2);
      const oDist = Math.hypot(rawOx, rawOy);
      originOffsetRef.current =
        oDist > maxFloat && oDist > 0
          ? { x: (rawOx / oDist) * maxFloat, y: (rawOy / oDist) * maxFloat }
          : { x: rawOx, y: rawOy };
    } else {
      originOffsetRef.current = { x: 0, y: 0 };
    }

    const l = latestRef.current;
    triggerHaptic(l.hapticsEnabled, 7);
    triggerSwitchClick(l.soundClicks, 0.74);
    updatePosition(e.clientX, e.clientY);
  };

  const endPointer = (id: number) => {
    if (pointerIdRef.current === id) reset();
  };

  return (
    <div
      ref={padRef}
      style={
        {
          ['--ctl-hl' as string]: activeHighlight,
          ...(ringColor
            ? {
                boxShadow: `0 0 0 3px ${ringColor}, 0 0 0 5px #141412, inset 0 6px 16px rgba(0,0,0,0.92)`,
              }
            : {}),
        } as React.CSSProperties
      }
      className={`ctl-stick controller-surface relative shrink-0 rounded-full bg-gradient-to-b from-[#0C0E14] to-[#06070B] border-2 border-[#141412] shadow-[inset_0_6px_18px_rgba(0,0,0,0.92),0_1px_0_rgba(255,255,255,0.12)] flex items-center justify-center ${sizeClass}`}
    >
      {/* Generous invisible hit zone extending 12px past the physical bezel */}
      <div
        role="slider"
        aria-label={label ? `${label} stick` : 'Analog stick'}
        aria-valuenow={0}
        onPointerDown={handleDown}
        onPointerMove={(e) => {
          if (pointerIdRef.current !== e.pointerId) return;
          updatePosition(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => endPointer(e.pointerId)}
        onPointerCancel={(e) => endPointer(e.pointerId)}
        onLostPointerCapture={(e) => endPointer(e.pointerId)}
        onContextMenu={(e) => e.preventDefault()}
        className="controller-surface absolute -inset-3 rounded-full z-20"
      />

      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        {gate === 'octagonal' ? (
          <>
            <polygon
              points={OCTAGON_POINTS}
              fill="rgba(255,255,255,0.035)"
              stroke="rgba(255,255,255,0.28)"
              strokeWidth="2"
              strokeLinejoin="miter"
            />
            <polygon
              points={OCTAGON_INNER_POINTS}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
              const rad = ((deg - 22.5) * Math.PI) / 180;
              return (
                <circle
                  key={deg}
                  cx={50 + Math.cos(rad) * 45.5}
                  cy={50 + Math.sin(rad) * 45.5}
                  r="1.35"
                  fill="rgba(255,255,255,0.34)"
                />
              );
            })}
          </>
        ) : (
          <>
            <circle
              cx="50"
              cy="50"
              r={GATE_R}
              fill="none"
              stroke={ringColor ? withAlpha(ringColor, '38') : 'rgba(255,255,255,0.1)'}
              strokeWidth="1.5"
              strokeDasharray="3 4"
            />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
              const rad = (deg * Math.PI) / 180;
              return (
                <line
                  key={deg}
                  x1={50 + Math.cos(rad) * 36.5}
                  y1={50 + Math.sin(rad) * 36.5}
                  x2={50 + Math.cos(rad) * 40.5}
                  y2={50 + Math.sin(rad) * 40.5}
                  stroke={
                    deg % 90 === 0 && ringColor
                      ? withAlpha(ringColor, '88')
                      : 'rgba(255,255,255,0.18)'
                  }
                  strokeWidth={deg % 90 === 0 ? '1.7' : '1'}
                  strokeLinecap="round"
                />
              );
            })}
          </>
        )}

        {/* Live vector line + directional arc telemetry (painted imperatively) */}
        <g
          ref={telemetryRef}
          className="ctl-stick-telemetry"
          style={{ opacity: 0 }}
        >
          <line
            ref={vectorRef}
            x1="50"
            y1="50"
            x2="50"
            y2="50"
            stroke={activeHighlight}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle
            ref={arcRef}
            cx="50"
            cy="50"
            r={GATE_R}
            fill="none"
            stroke={activeHighlight}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`0 ${GATE_CIRCUMFERENCE}`}
            style={{ filter: `drop-shadow(0 0 4px ${activeHighlight})` }}
          />
          <circle
            ref={pipRef}
            cx="50"
            cy="9"
            r="2.5"
            fill={activeHighlight}
            style={{ filter: `drop-shadow(0 0 5px ${activeHighlight})` }}
          />
        </g>
      </svg>

      {/* Textured knurled concave thumbstick dome (transform painted imperatively) */}
      <div
        ref={knobRef}
        className={`relative z-10 w-[54%] h-[54%] rounded-full border-2 flex items-center justify-center pointer-events-none ${
          isLightCap
            ? 'bg-gradient-to-b from-[#E3E5ED] via-[#C6C9D4] to-[#9FA4B2]'
            : 'bg-gradient-to-b from-[#3A3F4E] via-[#242834] to-[#161922]'
        }`}
      >
        <div
          className={`w-[84%] h-[84%] rounded-full border-2 border-dashed flex items-center justify-center ${
            isLightCap
              ? 'border-[#1A1C24]/25 controller-grip-texture'
              : 'border-white/20 controller-grip-texture-dark'
          }`}
        >
          <div
            className={`w-[78%] h-[78%] rounded-full flex items-center justify-center ${
              isLightCap
                ? 'bg-gradient-to-b from-[#B0B4C2] to-[#DCDFE9] shadow-[inset_0_3px_6px_rgba(0,0,0,0.38)] border border-[#1A1C24]/20'
                : 'bg-gradient-to-b from-[#0E1017] to-[#1F232F] shadow-[inset_0_3px_8px_rgba(0,0,0,0.92)] border border-white/10'
            }`}
          >
            {label && (
              <span
                className={`ctl-stick-label text-[10px] font-mono-tech font-extrabold ${
                  isLightCap ? 'text-[#2B2E3B]' : 'text-white/60'
                }`}
              >
                {label}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
