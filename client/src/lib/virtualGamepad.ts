import {
  ControllerInputState,
  createEmptyInputState,
} from '@couch-emu/shared';

/**
 * Virtual Gamepad layer.
 *
 * Phone controllers arrive as `ControllerInputState` packets. This module
 * turns them into objects that look and behave like W3C standard-mapping
 * Gamepads and patches `navigator.getGamepads()` so emulators (RetroArch /
 * Emscripten), the built-in arcade games and embedded same-origin web games
 * all see phones as ordinary controllers.
 *
 * Design notes:
 * - Each slot owns ONE long-lived pad object whose `buttons`/`axes` are
 *   mutated in place (Firefox-style live objects). Games that cache the pad
 *   from `gamepadconnected` keep working; games that poll every frame get the
 *   same object back with no per-frame allocation beyond one small array.
 * - When a different player takes a slot (swap / rejoin) the old pad is
 *   disconnected and a fresh one is connected, and the seq gate is reset so
 *   the new phone's lower sequence numbers aren't discarded as "stale".
 * - Physical pads plugged into the host are merged into free indices. When a
 *   physical pad's native index is taken by a phone, it is exposed through a
 *   lightweight view whose `index` matches its array position.
 * - `GamepadEvent` is patched so `new GamepadEvent('gamepadconnected',
 *   { gamepad: virtualPad })` works (the native constructor throws a TypeError
 *   for non-native Gamepad objects — Nostalgist does exactly this on boot).
 */

export interface VirtualGamepadButton {
  pressed: boolean;
  touched: boolean;
  value: number;
}

export interface VirtualGamepad {
  id: string;
  index: number;
  connected: boolean;
  mapping: GamepadMappingType;
  timestamp: number;
  axes: number[];
  buttons: VirtualGamepadButton[];
  vibrationActuator: {
    type: string;
    effects: string[];
    playEffect: (
      type: string,
      params?: {
        duration?: number;
        startDelay?: number;
        strongMagnitude?: number;
        weakMagnitude?: number;
      },
    ) => Promise<'complete' | 'preempted'>;
    reset: () => Promise<'complete'>;
  };
  hapticActuators: Array<{
    type: string;
    pulse: (value: number, duration: number) => Promise<boolean>;
  }>;
}

type RumbleHandler = (
  slot: number,
  durationMs: number,
  intensity: number,
) => void;

type StateChangeListener = () => void;

interface SlotPlayer {
  slot: number;
  name: string;
  connected?: boolean;
  id?: string;
}

const BUTTON_COUNT = 17;
const AXIS_COUNT = 4;
const TRIGGER_PRESS_THRESHOLD = 0.12;
/** Sequence gap we treat as a sender restart rather than reordering. */
const SEQ_RESET_GAP = 1000;
/** Silence after which any seq is accepted again (phone reload). */
const SEQ_RESYNC_IDLE_MS = 1500;
/** Minimum spacing between rumble packets per slot unless stronger. */
const RUMBLE_MIN_INTERVAL_MS = 80;

const EMPTY_STATE: ControllerInputState = Object.freeze(
  createEmptyInputState(0),
) as ControllerInputState;

/** Every non-native pad object we hand out (virtual + remapped views). */
const syntheticPads = new WeakSet<object>();

function clamp(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n < min ? min : n > max ? max : n;
}

function makeGamepadEvent(
  win: Window,
  type: string,
  pad: object,
  init?: EventInit,
): Event {
  const W = win as Window & typeof globalThis;
  const evt = new W.Event(type, {
    bubbles: init?.bubbles ?? false,
    cancelable: init?.cancelable ?? false,
    composed: init?.composed ?? false,
  });
  Object.defineProperty(evt, 'gamepad', {
    value: pad,
    enumerable: true,
    configurable: true,
  });
  const native = nativeGamepadEventCtors.get(win) ?? W.GamepadEvent;
  if (native?.prototype) {
    try {
      Object.setPrototypeOf(evt, native.prototype);
    } catch {
      // keep plain Event — `gamepad` own property still works
    }
  }
  return evt;
}

const nativeGamepadEventCtors = new WeakMap<Window, typeof GamepadEvent>();

function patchGamepadEventCtor(win: Window): void {
  const W = win as Window & typeof globalThis;
  if (nativeGamepadEventCtors.has(win)) return;
  const Native = W.GamepadEvent;
  if (typeof Native !== 'function') return;
  nativeGamepadEventCtors.set(win, Native);

  const Patched = function (type: string, init?: GamepadEventInit) {
    const pad = init?.gamepad as object | undefined;
    if (pad && syntheticPads.has(pad)) {
      return makeGamepadEvent(win, type, pad, init);
    }
    return new Native(type, init as GamepadEventInit);
  } as unknown as typeof GamepadEvent;
  (Patched as unknown as { prototype: unknown }).prototype = Native.prototype;

  try {
    Object.defineProperty(win, 'GamepadEvent', {
      configurable: true,
      writable: true,
      value: Patched,
    });
  } catch {
    nativeGamepadEventCtors.delete(win);
  }
}

function unpatchGamepadEventCtor(win: Window): void {
  const Native = nativeGamepadEventCtors.get(win);
  if (!Native) return;
  try {
    Object.defineProperty(win, 'GamepadEvent', {
      configurable: true,
      writable: true,
      value: Native,
    });
  } catch {
    // ignore
  }
  nativeGamepadEventCtors.delete(win);
}

/**
 * Exposes a physical pad at a different array index than its native one.
 * Getters forward to the most recent native snapshot.
 */
class RemappedPhysicalPad {
  constructor(
    public src: Gamepad,
    public readonly index: number,
  ) {
    syntheticPads.add(this);
  }
  get id() {
    return this.src.id;
  }
  get connected() {
    return this.src.connected;
  }
  get mapping() {
    return this.src.mapping;
  }
  get timestamp() {
    return this.src.timestamp;
  }
  get axes() {
    return this.src.axes;
  }
  get buttons() {
    return this.src.buttons;
  }
  get vibrationActuator() {
    return (this.src as Gamepad & { vibrationActuator?: unknown })
      .vibrationActuator;
  }
  get hapticActuators() {
    return (this.src as Gamepad & { hapticActuators?: unknown }).hapticActuators;
  }
}

interface SlotRecord {
  pad: VirtualGamepad;
  /** Player id (or name) currently owning this slot; '' = provisional. */
  owner: string;
  state: ControllerInputState;
  lastSeq: number;
  lastAt: number;
}

interface RumbleState {
  until: number;
  intensity: number;
  lastSent: number;
}

export class VirtualGamepadManager {
  private slots = new Map<number, SlotRecord>();
  private nativeGetGamepads: (() => (Gamepad | null)[]) | null = null;
  private installed = false;
  private hasSynced = false;
  private rumbleHandler: RumbleHandler | null = null;
  private rumbleStates = new Map<number, RumbleState>();
  private listeners = new Set<StateChangeListener>();
  private attachedWindows = new Set<Window>();

  private physAssign = new Map<number, number>();
  private physViews = new Map<number, RemappedPhysicalPad>();
  private physSeen = new Set<number>();

  install(): void {
    if (this.installed || typeof navigator === 'undefined') return;
    const proto = Object.getPrototypeOf(navigator) as Navigator;
    const orig =
      typeof navigator.getGamepads === 'function'
        ? navigator.getGamepads.bind(navigator)
        : typeof proto?.getGamepads === 'function'
          ? proto.getGamepads.bind(navigator)
          : () => [];

    this.nativeGetGamepads = orig as () => (Gamepad | null)[];

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      writable: true,
      value: () => this.getMergedGamepads(),
    });
    patchGamepadEventCtor(window);
    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed || typeof navigator === 'undefined') return;
    if (this.nativeGetGamepads) {
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        writable: true,
        value: this.nativeGetGamepads,
      });
    }
    unpatchGamepadEventCtor(window);
    this.installed = false;
  }

  setRumbleHandler(handler: RumbleHandler | null): void {
    this.rumbleHandler = handler;
  }

  onChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // one bad listener must not break input delivery
      }
    }
  }

  /* ── Events ───────────────────────────────────────────────────────────── */

  private dispatchTo(
    win: Window,
    type: 'gamepadconnected' | 'gamepaddisconnected',
    pad: VirtualGamepad,
  ): void {
    try {
      win.dispatchEvent(makeGamepadEvent(win, type, pad));
    } catch {
      this.attachedWindows.delete(win);
    }
  }

  private broadcastGamepadEvent(
    type: 'gamepadconnected' | 'gamepaddisconnected',
    pad: VirtualGamepad,
  ): void {
    if (typeof window !== 'undefined') this.dispatchTo(window, type, pad);
    for (const win of Array.from(this.attachedWindows)) {
      if (win.closed) {
        this.attachedWindows.delete(win);
        continue;
      }
      this.dispatchTo(win, type, pad);
    }
  }

  /* ── Pad lifecycle ────────────────────────────────────────────────────── */

  private createPad(slot: number, label: string): VirtualGamepad {
    const buttons: VirtualGamepadButton[] = [];
    for (let i = 0; i < BUTTON_COUNT; i++) {
      buttons.push({ pressed: false, touched: false, value: 0 });
    }
    const rumble = (duration: number, intensity: number) =>
      this.requestRumble(slot, duration, intensity);

    const pad: VirtualGamepad = {
      id: `CouchEmu Phone Controller P${slot + 1} - ${label} (STANDARD GAMEPAD Vendor: c0e1 Product: 0001)`,
      index: slot,
      connected: true,
      mapping: 'standard',
      timestamp: performance.now(),
      axes: [0, 0, 0, 0],
      buttons,
      vibrationActuator: {
        type: 'dual-rumble',
        effects: ['dual-rumble', 'trigger-rumble'],
        playEffect: (_type, params) => {
          const duration = clamp(params?.duration ?? 200, 0, 5000);
          const intensity = Math.max(
            clamp(params?.strongMagnitude, 0, 1),
            clamp(params?.weakMagnitude, 0, 1),
          );
          const delay = clamp(params?.startDelay ?? 0, 0, 5000);
          return new Promise((resolve) => {
            window.setTimeout(() => {
              rumble(duration, intensity);
              window.setTimeout(() => resolve('complete'), duration);
            }, delay);
          });
        },
        reset: async () => {
          this.rumbleStates.delete(slot);
          return 'complete';
        },
      },
      hapticActuators: [
        {
          type: 'vibration',
          pulse: async (value: number, duration: number) => {
            rumble(clamp(duration, 0, 5000), clamp(value, 0, 1));
            return true;
          },
        },
      ],
    };
    syntheticPads.add(pad);
    return pad;
  }

  private connectSlot(slot: number, label: string, owner: string): SlotRecord {
    const rec: SlotRecord = {
      pad: this.createPad(slot, label),
      owner,
      state: EMPTY_STATE,
      lastSeq: -Infinity,
      lastAt: 0,
    };
    this.slots.set(slot, rec);
    this.broadcastGamepadEvent('gamepadconnected', rec.pad);
    return rec;
  }

  private disconnectSlot(slot: number): void {
    const rec = this.slots.get(slot);
    if (!rec) return;
    this.slots.delete(slot);
    this.rumbleStates.delete(slot);
    const pad = rec.pad;
    pad.connected = false;
    pad.timestamp = performance.now();
    for (const b of pad.buttons) {
      b.pressed = false;
      b.touched = false;
      b.value = 0;
    }
    for (let i = 0; i < pad.axes.length; i++) pad.axes[i] = 0;
    this.broadcastGamepadEvent('gamepaddisconnected', pad);
  }

  syncConnectedSlots(players: SlotPlayer[]): void {
    this.hasSynced = true;
    const active = new Map<number, SlotPlayer>();
    for (const p of players) {
      if (p.connected === false) continue;
      if (!Number.isInteger(p.slot) || p.slot < 0) continue;
      active.set(p.slot, p);
    }

    let changed = false;
    for (const slot of Array.from(this.slots.keys())) {
      const rec = this.slots.get(slot)!;
      const next = active.get(slot);
      const nextOwner = next ? (next.id ?? next.name) : null;
      if (!next) {
        this.disconnectSlot(slot);
        changed = true;
      } else if (rec.owner === '') {
        rec.owner = nextOwner ?? '';
      } else if (rec.owner !== nextOwner) {
        // Different phone now owns this port (swap / rejoin): new controller.
        this.disconnectSlot(slot);
        changed = true;
      }
    }

    for (const [slot, p] of active) {
      if (!this.slots.has(slot)) {
        this.connectSlot(slot, p.name, p.id ?? p.name);
        changed = true;
      }
    }

    if (changed) this.emitChange();
  }

  /**
   * Re-fires gamepadconnected for all active virtual pads.
   * Useful right after an emulator or iframe game mounts its listeners.
   */
  reannounceAll(targetWindow: Window = window): void {
    for (const rec of this.slots.values()) {
      if (rec.pad.connected) {
        this.dispatchTo(targetWindow, 'gamepadconnected', rec.pad);
      }
    }
  }

  /**
   * Hooks a same-origin iframe's navigator.getGamepads so embedded web games
   * automatically read virtual phone controllers. Safe to call on every load.
   */
  attachToIframe(iframe: HTMLIFrameElement): boolean {
    try {
      const win = iframe.contentWindow;
      if (!win || !win.navigator) return false;
      Object.defineProperty(win.navigator, 'getGamepads', {
        configurable: true,
        writable: true,
        value: () => this.getMergedGamepads(),
      });
      patchGamepadEventCtor(win);
      this.attachedWindows.add(win);
      this.reannounceAll(win);
      return true;
    } catch {
      // Cross-origin iframes use the postMessage SDK bridge instead
      return false;
    }
  }

  /** Stops broadcasting connect/disconnect events into an iframe. */
  detachFromIframe(target: HTMLIFrameElement | Window | null): void {
    if (!target) return;
    const win =
      'contentWindow' in target
        ? (target as HTMLIFrameElement).contentWindow
        : (target as Window);
    if (win) this.attachedWindows.delete(win);
  }

  /* ── Input ────────────────────────────────────────────────────────────── */

  applyInput(slot: number, state: ControllerInputState): void {
    if (!state || typeof state.seq !== 'number') return;
    let rec = this.slots.get(slot);
    if (!rec) {
      // After the first roster sync, input for unknown slots is a stale packet
      // from a player who just left — never resurrect a ghost controller.
      if (this.hasSynced || !Number.isInteger(slot) || slot < 0) return;
      rec = this.connectSlot(slot, `P${slot + 1}`, '');
    }

    const now = performance.now();
    const idle = now - rec.lastAt > SEQ_RESYNC_IDLE_MS;
    if (
      state.seq <= rec.lastSeq &&
      !idle &&
      rec.lastSeq - state.seq < SEQ_RESET_GAP
    ) {
      return; // duplicate or reordered packet
    }
    rec.lastSeq = state.seq;
    rec.lastAt = now;

    const mask = typeof state.buttonsMask === 'number' ? state.buttonsMask : 0;
    const srcAxes = Array.isArray(state.axes) ? state.axes : EMPTY_STATE.axes;
    const l2 = clamp(state.l2, 0, 1);
    const r2 = clamp(state.r2, 0, 1);
    const axes: [number, number, number, number] = [
      clamp(srcAxes[0], -1, 1),
      clamp(srcAxes[1], -1, 1),
      clamp(srcAxes[2], -1, 1),
      clamp(srcAxes[3], -1, 1),
    ];

    rec.state = {
      buttonsMask: mask,
      l2,
      r2,
      axes,
      seq: state.seq,
      ts: state.ts,
    };

    const pad = rec.pad;
    pad.timestamp = now;
    for (let i = 0; i < AXIS_COUNT; i++) pad.axes[i] = axes[i];

    for (let i = 0; i < BUTTON_COUNT; i++) {
      const digital = ((mask >>> i) & 1) === 1;
      const analog = i === 6 ? l2 : i === 7 ? r2 : 0;
      const btn = pad.buttons[i];
      if (analog > 0) {
        btn.value = analog;
        btn.pressed = digital || analog > TRIGGER_PRESS_THRESHOLD;
      } else {
        btn.value = digital ? 1 : 0;
        btn.pressed = digital;
      }
      btn.touched = btn.pressed || btn.value > 0;
    }

    this.emitChange();
  }

  getSlotState(slot: number): ControllerInputState {
    return this.slots.get(slot)?.state ?? EMPTY_STATE;
  }

  /** The live virtual pad object for a slot (null if none). */
  getVirtualPad(slot: number): VirtualGamepad | null {
    return this.slots.get(slot)?.pad ?? null;
  }

  isVirtualGamepad(pad: unknown): boolean {
    return typeof pad === 'object' && pad !== null && syntheticPads.has(pad);
  }

  /* ── Rumble ───────────────────────────────────────────────────────────── */

  /**
   * Coalesces rumble requests per slot. Games often call playEffect every
   * frame; without this the phone would be flooded with WS packets.
   */
  private requestRumble(slot: number, durationMs: number, intensity: number): void {
    if (!this.rumbleHandler) return;
    if (intensity <= 0.01 || durationMs <= 0) {
      this.rumbleStates.delete(slot);
      return;
    }
    const now = performance.now();
    const end = now + durationMs;
    const st = this.rumbleStates.get(slot);
    if (st) {
      const stronger = intensity > st.intensity + 0.05;
      if (!stronger) {
        if (st.until >= end - 20) return; // already covered
        if (now - st.lastSent < RUMBLE_MIN_INTERVAL_MS) return;
      }
    }
    this.rumbleStates.set(slot, { until: end, intensity, lastSent: now });
    this.rumbleHandler(slot, Math.round(durationMs), intensity);
  }

  /* ── navigator.getGamepads() ──────────────────────────────────────────── */

  getMergedGamepads(): (Gamepad | null)[] {
    let len = 4;
    for (const slot of this.slots.keys()) {
      if (slot + 1 > len) len = slot + 1;
    }
    const out: (Gamepad | null)[] = new Array(len);
    for (let i = 0; i < len; i++) out[i] = null;
    for (const [slot, rec] of this.slots) {
      if (rec.pad.connected) out[slot] = rec.pad as unknown as Gamepad;
    }

    let native: ArrayLike<Gamepad | null> = [];
    try {
      native = this.nativeGetGamepads ? this.nativeGetGamepads() : [];
    } catch {
      native = [];
    }

    const seen = this.physSeen;
    seen.clear();
    for (let i = 0; i < native.length; i++) {
      const rp = native[i];
      if (!rp || !rp.connected) continue;
      const key = rp.index;
      seen.add(key);

      let target = this.physAssign.get(key);
      if (target === undefined || out[target]) {
        target = key < out.length && !out[key] ? key : -1;
        if (target === -1 && key >= out.length) target = key;
        if (target === -1) {
          target = 0;
          while (target < out.length && out[target]) target++;
        }
        this.physAssign.set(key, target);
      }
      while (out.length <= target) out.push(null);

      if (target === key) {
        out[target] = rp;
        this.physViews.delete(key);
      } else {
        let view = this.physViews.get(key);
        if (!view || view.index !== target) {
          view = new RemappedPhysicalPad(rp, target);
          this.physViews.set(key, view);
        } else {
          view.src = rp;
        }
        out[target] = view as unknown as Gamepad;
      }
    }

    if (this.physAssign.size > seen.size) {
      for (const key of Array.from(this.physAssign.keys())) {
        if (!seen.has(key)) {
          this.physAssign.delete(key);
          this.physViews.delete(key);
        }
      }
    }

    return out;
  }
}

export const virtualGamepadManager = new VirtualGamepadManager();
