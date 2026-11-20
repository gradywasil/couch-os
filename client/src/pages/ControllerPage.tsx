import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CONTROLLER_LAYOUT_META,
  ControllerInputState,
  ControllerLayoutId,
  GAMEPAD_BUTTON,
  PLAYER_COLORS,
  PLAYER_RECONNECT_GRACE_MS,
  RoomState,
  ServerToClientMessage,
  TransportMode,
  createEmptyInputState,
  isControllerLayoutId,
  setButtonMask,
} from '@couch-emu/shared';
import {
  Check,
  ChevronDown,
  Gamepad2,
  LoaderCircle,
  LogOut,
  Maximize,
  Minimize,
  RotateCw,
  Tv,
  Vibrate,
  Volume2,
  VolumeX,
  WifiOff,
  Zap,
} from 'lucide-react';
import { WsClient } from '../lib/wsClient';
import { PlayerWebRtcClient } from '../lib/webrtc';
import { ControllerDeck } from '../components/controllers/ControllerDeck';
import {
  releaseAllTouchInputs,
  stopHaptics,
  triggerHaptic,
  triggerRumble,
  triggerRumbleThud,
  triggerSwitchClick,
  unlockAudio,
  withAlpha,
} from '../components/controllers/TouchPrimitives';

interface ControllerPageProps {
  initialRoomCode?: string;
}

// ===========================================================================
// Storage helpers (localStorage can throw in private mode / locked-down webviews)
// ===========================================================================

const KEY_CLIENT_ID = 'couch-emu-client-id';
const KEY_NAME = 'couch-emu-player-name';
const KEY_COLOR = 'couch-emu-player-color';
const KEY_SESSION = 'couch-emu-session';
const KEY_HAPTICS = 'couch-emu-haptics';
const KEY_SOUND = 'couch-emu-sound-clicks';

/** Auto-rejoin a remembered room after a reload for this long. */
const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const JOIN_TIMEOUT_MS = 10_000;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

let memoryClientId: string | null = null;

/** Stable per-device id; the server uses it to hand a dropped phone its old port back. */
function getOrCreateClientId(): string {
  const stored = safeGet(KEY_CLIENT_ID);
  if (stored) return stored;
  if (memoryClientId) return memoryClientId;
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  memoryClientId = id;
  safeSet(KEY_CLIENT_ID, id);
  return id;
}

function loadBoolPref(key: string, fallback: boolean): boolean {
  const raw = safeGet(key);
  return raw === null ? fallback : raw === 'true';
}

function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

interface JoinIntent {
  roomCode: string;
  name: string;
  /** null = let the console assign this port's colour */
  color: string | null;
}

interface StoredSession extends JoinIntent {
  at: number;
}

function loadSession(): StoredSession | null {
  const raw = safeGet(KEY_SESSION);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof s.roomCode !== 'string' ||
      typeof s.at !== 'number' ||
      Date.now() - s.at > SESSION_TTL_MS
    ) {
      return null;
    }
    return {
      roomCode: normalizeCode(s.roomCode),
      name: typeof s.name === 'string' ? s.name : '',
      color: typeof s.color === 'string' ? s.color : null,
      at: s.at,
    };
  } catch {
    return null;
  }
}

function saveSession(intent: JoinIntent): void {
  safeSet(KEY_SESSION, JSON.stringify({ ...intent, at: Date.now() }));
}

function clearSession(): void {
  safeSet(KEY_SESSION, null);
}

// ===========================================================================
// Fullscreen / orientation (iPhone Safari has no element fullscreen: never throw)
// ===========================================================================

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: (opts?: unknown) => Promise<void> | void;
};

function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FsDocument;
  const el = document.documentElement as FsElement;
  const enabled = Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled);
  return (
    enabled &&
    (typeof el.requestFullscreen === 'function' ||
      typeof el.webkitRequestFullscreen === 'function')
  );
}

function getFullscreenElement(): Element | null {
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

async function settle(result: unknown): Promise<void> {
  if (result && typeof (result as Promise<void>).then === 'function') {
    await (result as Promise<void>).catch(() => {});
  }
}

async function enterLandscapeFullscreen(): Promise<boolean> {
  let ok = false;
  try {
    const el = document.documentElement as FsElement;
    if (!getFullscreenElement()) {
      if (typeof el.requestFullscreen === 'function') {
        await settle(el.requestFullscreen({ navigationUI: 'hide' }));
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        await settle(el.webkitRequestFullscreen());
      }
    }
    ok = Boolean(getFullscreenElement());
  } catch {
    // unsupported
  }
  try {
    const orientation = (
      typeof screen !== 'undefined' ? screen.orientation : undefined
    ) as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    if (orientation && typeof orientation.lock === 'function') {
      await settle(orientation.lock('landscape'));
    }
  } catch {
    // orientation lock unsupported (iOS) or not in fullscreen
  }
  return ok;
}

async function exitFullscreen(): Promise<void> {
  try {
    const d = document as FsDocument;
    if (!getFullscreenElement()) return;
    if (typeof d.exitFullscreen === 'function') await settle(d.exitFullscreen());
    else if (typeof d.webkitExitFullscreen === 'function')
      await settle(d.webkitExitFullscreen());
  } catch {
    // ignore
  }
}

// ===========================================================================
// Input pump: refs only, no React in the path from touch to network
// ===========================================================================

/**
 * Sequence numbers must keep rising across page reloads, because the host
 * drops packets whose seq is not newer than the last one it saw for the port.
 * Seeding from the wall clock (ms) guarantees that at any send rate < 1/ms.
 */
function seedSeq(): number {
  return Math.max(1, Date.now() - 1_700_000_000_000);
}

const KEEPALIVE_IDLE_MS = 1000;
/**
 * While playing, re-send the latest frame ~60x/s. Phones put their Wi-Fi radio
 * into power-save after ~100-200 ms without traffic, and the next press then
 * waits for the radio to wake (often tens of ms, sometimes 100+). A steady
 * trickle of tiny frames keeps it awake. The host drops duplicates by seq, so
 * resends cost it one comparison; they also cover any lost unreliable packet.
 */
const STREAM_INTERVAL_MS = 15;
/** Keep streaming this long after the last change (pauses between moves). */
const STREAM_HOLD_MS = 5000;

class InputPump {
  readonly state: ControllerInputState = createEmptyInputState(seedSeq());
  private rafId: number | null = null;
  private sentInFrame = false;
  private axesDirty = false;
  private lastSendAt = 0;
  private lastChangeAt = 0;
  private lastFrame: ControllerInputState | null = null;

  constructor(private transmit: (s: ControllerInputState) => void) {}

  /** Button edges go out immediately: they are rare and latency-critical. */
  setButton(index: number, pressed: boolean): void {
    const s = this.state;
    const next = setButtonMask(s.buttonsMask, index, pressed);
    if (next === s.buttonsMask) return;
    s.buttonsMask = next;
    if (index === GAMEPAD_BUTTON.L2) s.l2 = pressed ? 1 : 0;
    if (index === GAMEPAD_BUTTON.R2) s.r2 = pressed ? 1 : 0;
    this.flush();
  }

  setDpad(dirs: { up: boolean; down: boolean; left: boolean; right: boolean }): void {
    const s = this.state;
    let m = s.buttonsMask;
    m = setButtonMask(m, GAMEPAD_BUTTON.DPAD_UP, dirs.up);
    m = setButtonMask(m, GAMEPAD_BUTTON.DPAD_DOWN, dirs.down);
    m = setButtonMask(m, GAMEPAD_BUTTON.DPAD_LEFT, dirs.left);
    m = setButtonMask(m, GAMEPAD_BUTTON.DPAD_RIGHT, dirs.right);
    if (m === s.buttonsMask) return;
    s.buttonsMask = m;
    this.flush();
  }

  /**
   * Stick motion is coalesced: the first change in a frame is sent at once,
   * later ones in the same frame are merged into one send on the next frame.
   * Returning to centre is always sent immediately.
   */
  setStick(stick: 'left' | 'right', x: number, y: number): void {
    const a = this.state.axes;
    const i = stick === 'left' ? 0 : 2;
    if (a[i] === x && a[i + 1] === y) return;
    a[i] = x;
    a[i + 1] = y;
    if (x === 0 && y === 0) {
      this.flush();
      return;
    }
    const stalled = performance.now() - this.lastSendAt > 48; // rAF throttled
    if (!this.sentInFrame || stalled) {
      this.flush();
    } else {
      this.axesDirty = true;
      this.ensureFrame();
    }
  }

  isNeutral(): boolean {
    const s = this.state;
    return (
      s.buttonsMask === 0 &&
      s.axes[0] === 0 &&
      s.axes[1] === 0 &&
      s.axes[2] === 0 &&
      s.axes[3] === 0
    );
  }

  /** Forces an all-released state onto the wire. */
  zero(): void {
    const s = this.state;
    s.buttonsMask = 0;
    s.l2 = 0;
    s.r2 = 0;
    s.axes = [0, 0, 0, 0];
    this.flush();
  }

  flush(): void {
    const s = this.state;
    s.seq += 1;
    s.ts = Math.round(performance.now());
    const frame: ControllerInputState = {
      buttonsMask: s.buttonsMask,
      l2: s.l2,
      r2: s.r2,
      axes: [s.axes[0], s.axes[1], s.axes[2], s.axes[3]],
      seq: s.seq,
      ts: s.ts,
    };
    this.lastFrame = frame;
    this.transmit(frame);
    this.lastSendAt = performance.now();
    this.lastChangeAt = this.lastSendAt;
    this.sentInFrame = true;
    this.axesDirty = false;
    this.ensureFrame();
  }

  /**
   * Called on a fast timer. While "hot" (input held, or a change in the last
   * few seconds) the latest frame is re-sent unchanged at ~60 Hz to keep the
   * phone's Wi-Fi awake; otherwise a fresh frame goes out once a second.
   */
  keepalive(): void {
    const now = performance.now();
    const gap = now - this.lastSendAt;
    const hot = !this.isNeutral() || now - this.lastChangeAt < STREAM_HOLD_MS;
    if (hot && this.lastFrame) {
      if (gap >= STREAM_INTERVAL_MS) {
        this.transmit(this.lastFrame);
        this.lastSendAt = now;
      }
    } else if (gap >= KEEPALIVE_IDLE_MS) {
      this.flush();
      // An idle heartbeat is not player activity.
      this.lastChangeAt = 0;
    }
  }

  /** Drop frame bookkeeping (rAF does not run while the page is hidden). */
  suspend(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.sentInFrame = false;
    this.axesDirty = false;
  }

  private ensureFrame(): void {
    if (this.rafId === null) this.rafId = requestAnimationFrame(this.onFrame);
  }

  private onFrame = (): void => {
    this.rafId = null;
    this.sentInFrame = false;
    if (this.axesDirty) this.flush();
  };
}

// ===========================================================================
// Scoped page styles
// ===========================================================================

const PAGE_STYLE_ID = 'couch-ctl-page';
const PAGE_CSS = `
html.ctl-page,html.ctl-page body{overscroll-behavior:none;-webkit-text-size-adjust:100%;text-size-adjust:100%;}
html.ctl-lock,html.ctl-lock body{overflow:hidden;height:100%;}
html.ctl-lock body{position:fixed;inset:0;width:100%;}
.ctl-root,.ctl-root *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}
.ctl-root{touch-action:none;overscroll-behavior:none;}
.ctl-join{touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
.ctl-join *{-webkit-tap-highlight-color:transparent;}
.ctl-join label,.ctl-join button,.ctl-join h1,.ctl-join p,.ctl-join span{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}
.ctl-join input{font-size:16px;-webkit-user-select:text;user-select:text;}
.ctl-press{transition:transform 140ms cubic-bezier(.34,1.56,.64,1),filter 140ms ease;}
.ctl-press:active{transform:scale(.96);filter:brightness(1.15);transition-duration:40ms;}
@keyframes ctl-pop{0%{opacity:0;transform:scale(.6)}55%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
@keyframes ctl-fade-out{to{opacity:0;visibility:hidden}}
@keyframes ctl-burst{0%{transform:scale(.3);opacity:.95}100%{transform:scale(2.8);opacity:0}}
@keyframes ctl-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(2px)}}
@keyframes ctl-drop{0%{opacity:0;transform:translate(-50%,-10px) scale(.96)}100%{opacity:1;transform:translate(-50%,0) scale(1)}}
@keyframes ctl-flap{0%{transform:perspective(160px) rotateX(-95deg);opacity:.15}70%{transform:perspective(160px) rotateX(12deg);opacity:1}100%{transform:perspective(160px) rotateX(0);opacity:1}}
@keyframes ctl-breathe{0%,100%{opacity:.5}50%{opacity:1}}
@keyframes ctl-ring{0%{transform:scale(.8);opacity:.85}100%{transform:scale(1.9);opacity:0}}
@keyframes ctl-spin{to{transform:rotate(360deg)}}
@keyframes ctl-sheet{0%{opacity:0;transform:translateY(-8px) scale(.98)}100%{opacity:1;transform:translateY(0) scale(1)}}
.ctl-anim-pop{animation:ctl-pop 420ms cubic-bezier(.34,1.56,.64,1) both;}
.ctl-anim-shake{animation:ctl-shake 380ms cubic-bezier(.36,.07,.19,.97) both;}
.ctl-anim-drop{animation:ctl-drop 260ms cubic-bezier(.22,1,.36,1) both;}
.ctl-anim-flap{animation:ctl-flap 260ms cubic-bezier(.22,1,.36,1) both;transform-origin:50% 50%;}
.ctl-anim-breathe{animation:ctl-breathe 1.4s ease-in-out infinite;}
.ctl-anim-ring{animation:ctl-ring 1.6s cubic-bezier(.16,1,.3,1) infinite;}
.ctl-anim-spin{animation:ctl-spin 900ms linear infinite;}
.ctl-anim-sheet{animation:ctl-sheet 220ms cubic-bezier(.22,1,.36,1) both;}
.ctl-reveal{animation:ctl-fade-out 360ms ease 1250ms forwards;}
.ctl-reveal-burst{animation:ctl-burst 900ms cubic-bezier(.16,1,.3,1) both;}
@media (prefers-reduced-motion:reduce){.ctl-anim-pop,.ctl-anim-shake,.ctl-anim-flap,.ctl-anim-ring,.ctl-reveal-burst{animation:none!important}}
`;

function ensurePageStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PAGE_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = PAGE_STYLE_ID;
  el.textContent = PAGE_CSS;
  document.head.appendChild(el);
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ===========================================================================
// Profiles
// ===========================================================================

const PROFILE_PILLS: Array<{
  id: ControllerLayoutId;
  short: string;
  subtitle: string;
  shellBg: string;
  accentColor: string;
  dots: string[];
}> = [
  {
    id: 'dualstick',
    short: 'PRO',
    subtitle: 'Obsidian Hybrid',
    shellBg: '#141320',
    accentColor: '#FF3B5C',
    dots: ['#34D399', '#FF3B5C', '#22D3EE', '#FFB800'],
  },
  {
    id: 'snes',
    short: 'SNES',
    subtitle: 'Graphite · 4-Jewel',
    shellBg: '#2B2F3A',
    accentColor: '#3B82F6',
    dots: ['#2563EB', '#16A34A', '#E11D48', '#F59E0B'],
  },
  {
    id: 'nes',
    short: 'NES',
    subtitle: 'Dark Faceplate',
    shellBg: '#181A22',
    accentColor: '#E52521',
    dots: ['#E52521', '#E52521'],
  },
  {
    id: 'gba',
    short: 'GBA',
    subtitle: 'Atomic Indigo',
    shellBg: '#312A6E',
    accentColor: '#34D399',
    dots: ['#E6E8F2', '#34D399'],
  },
  {
    id: 'genesis',
    short: '6-BTN',
    subtitle: 'Obsidian Fight Pad',
    shellBg: '#13151B',
    accentColor: '#FF3B1D',
    dots: ['#FF3B1D', '#94A3B8'],
  },
  {
    id: 'n64',
    short: 'N64',
    subtitle: 'Obsidian · Gold',
    shellBg: '#181A23',
    accentColor: '#FACC15',
    dots: ['#FACC15', '#2563EB', '#16A34A'],
  },
];

const AUTO_SWATCH_BG =
  'conic-gradient(from 0deg, #38bdf8, #c084fc, #fb7185, #fb923c, #facc15, #4ade80, #2dd4bf, #38bdf8)';

// ===========================================================================
// Small self-updating widgets (they re-render on their own, never the deck)
// ===========================================================================

const LinkBadge: React.FC<{
  wsRef: React.RefObject<WsClient | null>;
  transport: TransportMode;
  online: boolean;
}> = ({ wsRef, transport, online }) => {
  const [rtt, setRtt] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const v = wsRef.current?.rttMs ?? null;
      setRtt((prev) => (prev === v ? prev : v));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [wsRef]);

  if (!online) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#FFB800]/45 bg-[#FFB800]/12 text-[#FFCF4D] font-osd text-[16px] leading-none shrink-0">
        <WifiOff className="w-3 h-3" />
        <span className="ctl-anim-breathe">OFFLINE</span>
      </span>
    );
  }

  const isP2p = transport === 'webrtc';
  const quality =
    rtt === null ? '#94A3B8' : rtt < 45 ? '#B5FF2A' : rtt < 100 ? '#FFB800' : '#FF3B5C';

  return (
    <span
      title={
        isP2p
          ? 'Peer-to-peer link to the console (lowest latency)'
          : 'Relayed through the server (WebSocket)'
      }
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border font-osd text-[16px] leading-none shrink-0 ${
        isP2p
          ? 'bg-[#B5FF2A]/10 border-[#B5FF2A]/35 text-[#B5FF2A]'
          : 'bg-[#22D3EE]/10 border-[#22D3EE]/35 text-[#22D3EE]'
      }`}
    >
      {isP2p ? <Zap className="w-3 h-3" /> : <Tv className="w-3 h-3" />}
      <span>{isP2p ? 'P2P' : 'WS'}</span>
      <span className="flex items-center gap-1 text-white/80">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: quality, boxShadow: `0 0 6px ${quality}` }}
        />
        {rtt === null ? '—' : `${rtt}ms`}
      </span>
    </span>
  );
};

const ReconnectBanner: React.FC<{ slotLabel: string; color: string }> = ({
  slotLabel,
  color,
}) => {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(
    0,
    Math.ceil((PLAYER_RECONNECT_GRACE_MS - (now - startedAt)) / 1000),
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="ctl-anim-drop pointer-events-none absolute left-1/2 top-3 z-40 flex items-center gap-2.5 pl-2 pr-3.5 py-2 rounded-lg bg-[#07060B]/95 border border-[#FFB800]/50 shadow-[0_10px_30px_rgba(0,0,0,0.6),0_0_24px_rgba(255,184,0,0.18)] max-w-[calc(100%-24px)]"
    >
      <span className="relative flex items-center justify-center w-7 h-7 shrink-0">
        <span
          className="ctl-anim-ring absolute inset-0 rounded-full border-2"
          style={{ borderColor: color }}
        />
        <LoaderCircle className="ctl-anim-spin w-4 h-4 text-[#FFB800]" />
      </span>
      <span className="min-w-0">
        <span className="block font-osd text-[19px] text-[#FFCF4D] leading-none osd-glow">
          RECONNECTING…
        </span>
        <span className="block font-mono-tech text-[9.5px] font-bold text-white/60 leading-tight truncate">
          {left > 0
            ? `Holding your ${slotLabel} slot · ${left}s`
            : 'Still trying — keep this page open'}
        </span>
      </span>
    </div>
  );
};

// ===========================================================================
// Page
// ===========================================================================

type Phase = 'form' | 'joining' | 'joined' | 'reconnecting';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'warn';
}

export const ControllerPage: React.FC<ControllerPageProps> = ({
  initialRoomCode = '',
}) => {
  const urlCode = useMemo(() => normalizeCode(initialRoomCode), [initialRoomCode]);
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const fsSupported = useMemo(() => fullscreenSupported(), []);

  // A remembered session for this room (tab reloaded / killed in background)
  // rejoins straight away; the server gives the same port back by clientId.
  const [bootSession] = useState<StoredSession | null>(() => {
    const s = loadSession();
    if (!s) return null;
    if (urlCode && urlCode !== s.roomCode) return null;
    return s;
  });

  const wsRef = useRef<WsClient | null>(null);
  const rtcRef = useRef<PlayerWebRtcClient | null>(null);
  const intentRef = useRef<JoinIntent | null>(bootSession);
  const deckWrapRef = useRef<HTMLDivElement>(null);
  const rumbleGlowRef = useRef<HTMLDivElement>(null);
  const rumbleAnimsRef = useRef<Animation[]>([]);

  const [phase, setPhaseState] = useState<Phase>(
    bootSession ? 'reconnecting' : 'form',
  );
  const phaseRef = useRef<Phase>(phase);
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const [wsConnected, setWsConnected] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState(
    () => urlCode || bootSession?.roomCode || '',
  );
  const [codeFocused, setCodeFocused] = useState(false);
  const [nameInput, setNameInput] = useState(() => safeGet(KEY_NAME) ?? '');
  const [selectedColor, setSelectedColor] = useState<string | null>(() => {
    const c = safeGet(KEY_COLOR);
    return c && (PLAYER_COLORS as readonly string[]).includes(c) ? c : null;
  });

  const [joinedRoom, setJoinedRoom] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [slot, setSlot] = useState<number>(0);
  const [localLayoutOverride, setLocalLayoutOverride] =
    useState<ControllerLayoutId | null>(null);
  const [hostLayout, setHostLayout] = useState<ControllerLayoutId | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [transport, setTransport] = useState<TransportMode>('ws');
  const [hapticsEnabled, setHapticsEnabled] = useState(() =>
    loadBoolPref(KEY_HAPTICS, true),
  );
  const [soundClicks, setSoundClicks] = useState(() =>
    loadBoolPref(KEY_SOUND, true),
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPortrait, setIsPortrait] = useState(
    () => window.innerHeight > window.innerWidth,
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const [reveal, setReveal] = useState<{ id: number; slot: number; color: string } | null>(null);
  const [leaveArmed, setLeaveArmed] = useState(false);

  const hapticsRef = useRef(hapticsEnabled);
  hapticsRef.current = hapticsEnabled;
  const soundRef = useRef(soundClicks);
  soundRef.current = soundClicks;

  useLayoutEffect(() => {
    ensurePageStyles();
  }, []);

  // --- Input pump -----------------------------------------------------------
  const [pump] = useState(
    () =>
      new InputPump((state) => {
        const p = phaseRef.current;
        if (p !== 'joined' && p !== 'reconnecting') return;
        rtcRef.current?.sendInput(state);
      }),
  );

  const handleButtonChange = useCallback(
    (buttonIndex: number, pressed: boolean) => pump.setButton(buttonIndex, pressed),
    [pump],
  );
  const handleDirectionsChange = useCallback(
    (dirs: { up: boolean; down: boolean; left: boolean; right: boolean }) =>
      pump.setDpad(dirs),
    [pump],
  );
  const handleStickChange = useCallback(
    (stick: 'left' | 'right', x: number, y: number) => pump.setStick(stick, x, y),
    [pump],
  );

  /** Lets go of every control and puts an all-released state on the wire. */
  const releaseEverything = useCallback(() => {
    releaseAllTouchInputs();
    pump.zero();
    pump.suspend();
    stopHaptics();
  }, [pump]);

  // --- Toasts -----------------------------------------------------------------
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), text, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2600);
  }, []);

  const revealTimerRef = useRef<number | null>(null);
  const celebrate = useCallback((slotIndex: number, color: string) => {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    setReveal({ id: Date.now(), slot: slotIndex, color });
    triggerHaptic(hapticsRef.current, [18, 50, 30]);
    triggerSwitchClick(soundRef.current, 1.25);
    revealTimerRef.current = window.setTimeout(() => {
      setReveal(null);
      revealTimerRef.current = null;
    }, 1700);
  }, []);

  const showError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setErrorKey((k) => k + 1);
    triggerHaptic(hapticsRef.current, [14, 40, 14]);
  }, []);

  // --- Rumble (WAAPI on refs; never re-renders the deck) ---------------------
  const playRumble = useCallback((durationMs: number, intensity: number) => {
    const d = Math.max(0, Math.min(2000, Number(durationMs) || 0));
    const k = Math.max(0, Math.min(1, Number(intensity) || 0));
    for (const a of rumbleAnimsRef.current) a.cancel();
    rumbleAnimsRef.current = [];
    if (d === 0 || k === 0) {
      stopHaptics();
      return;
    }
    triggerRumble(hapticsRef.current, d, k);
    triggerRumbleThud(soundRef.current, d, k);

    const glow = rumbleGlowRef.current;
    if (glow && typeof glow.animate === 'function') {
      rumbleAnimsRef.current.push(
        glow.animate(
          [
            { opacity: 0 },
            { opacity: 0.35 + 0.65 * k, offset: 0.12 },
            { opacity: 0 },
          ],
          { duration: Math.max(180, d), easing: 'ease-out' },
        ),
      );
    }
    const wrap = deckWrapRef.current;
    if (wrap && typeof wrap.animate === 'function' && !prefersReducedMotion()) {
      const amp = 1.5 + 3.5 * k;
      rumbleAnimsRef.current.push(
        wrap.animate(
          [
            { transform: 'translate3d(0,0,0)' },
            { transform: `translate3d(${-amp}px, ${amp * 0.5}px, 0)` },
            { transform: `translate3d(${amp}px, ${-amp * 0.5}px, 0)` },
            { transform: `translate3d(${-amp * 0.7}px, ${-amp * 0.25}px, 0)` },
            { transform: `translate3d(${amp * 0.5}px, ${amp * 0.25}px, 0)` },
            { transform: 'translate3d(0,0,0)' },
          ],
          {
            duration: 160,
            iterations: Math.max(1, Math.min(6, Math.round(d / 160))),
            easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)',
          },
        ),
      );
    }
  }, []);

  // --- Session transitions ----------------------------------------------------
  const resetToForm = useCallback(
    (message: string | null) => {
      releaseAllTouchInputs();
      pump.suspend();
      intentRef.current = null;
      clearSession();
      rtcRef.current?.close();
      setPhase('form');
      setJoinedRoom(null);
      setPlayerId(null);
      setHostLayout(null);
      setLocalLayoutOverride(null);
      setTransport('ws');
      setDrawerOpen(false);
      setLeaveArmed(false);
      if (message) showError(message);
    },
    [pump, setPhase, showError],
  );

  const sendJoin = useCallback(() => {
    const intent = intentRef.current;
    const ws = wsRef.current;
    if (!intent || !ws) return;
    ws.send({
      type: 'player:join',
      roomCode: intent.roomCode,
      name: intent.name,
      ...(intent.color ? { color: intent.color } : {}),
      clientId,
    });
  }, [clientId]);

  // Message handling lives in a ref so the socket effect never goes stale.
  const onMessageRef = useRef<(msg: ServerToClientMessage) => void>(() => {});
  onMessageRef.current = (msg) => {
    const rtc = rtcRef.current;
    const ws = wsRef.current;
    switch (msg.type) {
      case 'player:joined': {
        const intent = intentRef.current;
        if (!intent) {
          // Cancelled while the join was in flight.
          if (ws?.connected) ws.send({ type: 'player:leave' });
          return;
        }
        const prevPhase = phaseRef.current;
        const hadRoom = joinedRoom !== null;
        setPhase('joined');
        setErrorMsg(null);
        setPlayerId(msg.playerId);
        setSlot(msg.slot);
        setJoinedRoom(msg.room);
        setHostLayout(null);
        saveSession(intent);
        const me = msg.room.players.find((p) => p.id === msg.playerId);
        const color =
          me?.color ?? intent.color ?? PLAYER_COLORS[msg.slot % PLAYER_COLORS.length];
        if (!hadRoom) {
          celebrate(msg.slot, color);
        } else if (prevPhase === 'reconnecting') {
          showToast(`Back online · still P${msg.slot + 1}`, 'good');
          triggerHaptic(hapticsRef.current, [10, 30, 10]);
        }
        // The server gives us a new player id on every (re)join, so the host's
        // P2P peer for the old id is gone: always renegotiate.
        void rtc?.connectToHost();
        // Re-sync whatever is currently held.
        pump.flush();
        break;
      }
      case 'room:state': {
        if (!intentRef.current) return;
        setJoinedRoom(msg.room);
        setHostLayout(null);
        break;
      }
      case 'layout:changed': {
        if (!isControllerLayoutId(msg.layout)) return;
        setLocalLayoutOverride(null);
        setHostLayout(msg.layout);
        showToast(`Console switched you to ${CONTROLLER_LAYOUT_META[msg.layout].label}`);
        triggerHaptic(hapticsRef.current, 12);
        break;
      }
      case 'rtc:signal': {
        void rtc?.handleSignal(msg.signal);
        break;
      }
      case 'rumble': {
        if (phaseRef.current === 'joined' || phaseRef.current === 'reconnecting') {
          playRumble(msg.durationMs, msg.intensity);
        }
        break;
      }
      case 'kicked': {
        pump.zero();
        resetToForm(msg.reason || 'You were removed from the room.');
        break;
      }
      case 'error': {
        const p = phaseRef.current;
        if (p === 'joining') {
          const code = intentRef.current?.roomCode;
          resetToForm(msg.message);
          if (code) setRoomCodeInput(code);
        } else if (p === 'reconnecting') {
          if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'ROOM_FULL') {
            const code = intentRef.current?.roomCode;
            resetToForm(
              msg.code === 'ROOM_NOT_FOUND'
                ? 'That room has closed. Enter the new code from the TV.'
                : msg.message,
            );
            if (code && msg.code === 'ROOM_FULL') setRoomCodeInput(code);
            else setRoomCodeInput('');
          }
        } else if (p === 'joined' && msg.message) {
          showToast(msg.message, 'warn');
        }
        break;
      }
      default:
        break;
    }
  };

  // --- Socket lifecycle -------------------------------------------------------
  useEffect(() => {
    const ws = new WsClient();
    wsRef.current = ws;
    const rtc = new PlayerWebRtcClient(ws, (mode) => setTransport(mode));
    rtcRef.current = rtc;

    const unsubStatus = ws.onStatus((connected) => {
      setWsConnected(connected);
      const p = phaseRef.current;
      if (connected) {
        // Every (re)connect re-sends player:join with the same clientId so the
        // server hands back our port within its grace window.
        if (intentRef.current && p !== 'form') sendJoin();
      } else if (p === 'joined') {
        setPhase('reconnecting');
      }
    });
    const unsubMsg = ws.onMessage((msg) => onMessageRef.current(msg));

    return () => {
      unsubStatus();
      unsubMsg();
      rtc.close();
      ws.dispose();
      wsRef.current = null;
      rtcRef.current = null;
    };
  }, [sendJoin, setPhase]);

  // Join request watchdog.
  useEffect(() => {
    if (phase !== 'joining') return;
    const id = window.setTimeout(() => {
      if (phaseRef.current !== 'joining') return;
      const code = intentRef.current?.roomCode;
      resetToForm("The console didn't answer. Check the code and try again.");
      if (code) setRoomCodeInput(code);
    }, JOIN_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [phase, resetToForm]);

  const inSession = phase === 'joined' || phase === 'reconnecting';
  const showDeck = inSession && joinedRoom !== null;

  // Keepalive while in a session.
  useEffect(() => {
    if (!inSession) return;
    const id = window.setInterval(() => pump.keepalive(), 8);
    return () => window.clearInterval(id);
  }, [inSession, pump]);

  // Backgrounding / focus loss: release everything and send a zeroed state.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') releaseEverything();
    };
    window.addEventListener('blur', releaseEverything);
    window.addEventListener('pagehide', releaseEverything);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', releaseEverything);
      window.removeEventListener('pagehide', releaseEverything);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [releaseEverything]);

  // Screen Wake Lock: re-acquired whenever the page becomes visible again
  // (the browser drops it automatically when hidden).
  useEffect(() => {
    if (!inSession || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    let pending = false;

    const acquire = async () => {
      if (disposed || pending || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      pending = true;
      try {
        const s = await navigator.wakeLock.request('screen');
        if (disposed) {
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
        });
      } catch {
        // denied (low battery, no user activation yet, unsupported)
      } finally {
        pending = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    // Some browsers need user activation: retry on the next touch.
    const onPointer = () => {
      if (!sentinel) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerdown', onPointer, { passive: true });
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onPointer);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [inSession]);

  // Unlock Web Audio on the first real gesture (iOS needs touchend/click).
  useEffect(() => {
    const events = ['touchend', 'pointerup', 'click'] as const;
    const onGesture = () => {
      if (unlockAudio()) {
        for (const ev of events) document.removeEventListener(ev, onGesture, true);
      }
    };
    for (const ev of events) document.addEventListener(ev, onGesture, true);
    return () => {
      for (const ev of events) document.removeEventListener(ev, onGesture, true);
    };
  }, []);

  // Page chrome: block pinch / double-tap zoom, pull-to-refresh and rubber-banding.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('ctl-page');
    const prevent = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    // iOS Safari ignores user-scalable=no; its proprietary gesture events don't.
    document.addEventListener('gesturestart', prevent, { passive: false });
    document.addEventListener('gesturechange', prevent, { passive: false });
    return () => {
      root.classList.remove('ctl-page');
      document.removeEventListener('gesturestart', prevent);
      document.removeEventListener('gesturechange', prevent);
    };
  }, []);

  useEffect(() => {
    if (!showDeck) return;
    const root = document.documentElement;
    root.classList.add('ctl-lock');
    const preventMove = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchmove', preventMove, { passive: false });
    return () => {
      root.classList.remove('ctl-lock');
      document.removeEventListener('touchmove', preventMove);
    };
  }, [showDeck]);

  // Orientation + fullscreen tracking.
  useEffect(() => {
    const onResize = () => setIsPortrait(window.innerHeight > window.innerWidth);
    const onFs = () => setIsFullscreen(Boolean(getFullscreenElement()));
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, []);

  // Persist prefs.
  useEffect(() => safeSet(KEY_HAPTICS, String(hapticsEnabled)), [hapticsEnabled]);
  useEffect(() => safeSet(KEY_SOUND, String(soundClicks)), [soundClicks]);

  // Auto-disarm the leave confirmation.
  useEffect(() => {
    if (!leaveArmed) return;
    const id = window.setTimeout(() => setLeaveArmed(false), 2600);
    return () => window.clearTimeout(id);
  }, [leaveArmed]);

  // Unmount: timers + in-flight animations.
  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
      for (const a of rumbleAnimsRef.current) a.cancel();
      rumbleAnimsRef.current = [];
      pump.suspend();
      stopHaptics();
    },
    [pump],
  );

  // --- Derived ----------------------------------------------------------------
  const myPlayer = useMemo(
    () => joinedRoom?.players.find((p) => p.id === playerId),
    [joinedRoom, playerId],
  );
  const effectiveSlot = myPlayer?.slot ?? slot;
  const effectiveColor =
    myPlayer?.color ??
    intentRef.current?.color ??
    selectedColor ??
    PLAYER_COLORS[effectiveSlot % PLAYER_COLORS.length];
  const candidateLayout =
    localLayoutOverride ??
    hostLayout ??
    myPlayer?.layoutOverride ??
    joinedRoom?.defaultLayout;
  const effectiveLayout: ControllerLayoutId = isControllerLayoutId(candidateLayout)
    ? candidateLayout
    : 'snes';

  // Tell the player when the host moves them to another port.
  const prevSlotRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== 'joined') {
      if (phase === 'form') prevSlotRef.current = null;
      return;
    }
    const prev = prevSlotRef.current;
    prevSlotRef.current = effectiveSlot;
    if (prev !== null && prev !== effectiveSlot) {
      showToast(`You're now Player ${effectiveSlot + 1}`, 'good');
      triggerHaptic(hapticsRef.current, [12, 40, 12]);
    }
  }, [effectiveSlot, phase, showToast]);

  // One-time rotate tip for portrait players.
  const rotateTipShownRef = useRef(false);
  useEffect(() => {
    if (phase !== 'joined' || !isPortrait || rotateTipShownRef.current) return;
    rotateTipShownRef.current = true;
    const id = window.setTimeout(
      () => showToast('Tip: turn your phone sideways for the full-size deck'),
      1900,
    );
    return () => window.clearTimeout(id);
  }, [phase, isPortrait, showToast]);

  // --- Actions ----------------------------------------------------------------
  const codeReady = roomCodeInput.length >= 4;
  const displayName = nameInput.trim();
  const previewColor = selectedColor ?? '#F5F4F0';

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (phaseRef.current !== 'form') return;
    const code = normalizeCode(roomCodeInput);
    if (code.length < 4) {
      showError('Enter the room code shown on the TV.');
      return;
    }
    const name = nameInput.trim().slice(0, 18);
    safeSet(KEY_NAME, name);
    safeSet(KEY_COLOR, selectedColor ?? '');
    unlockAudio();
    triggerHaptic(hapticsEnabled, 12);
    triggerSwitchClick(soundClicks, 1.05);
    (document.activeElement as HTMLElement | null)?.blur?.();

    setErrorMsg(null);
    intentRef.current = { roomCode: code, name, color: selectedColor };
    setPhase('joining');
    if (wsRef.current?.connected) sendJoin();
  };

  const handleCancelRejoin = () => {
    if (wsRef.current?.connected) wsRef.current.send({ type: 'player:leave' });
    const code = intentRef.current?.roomCode ?? '';
    resetToForm(null);
    setRoomCodeInput(code);
  };

  const handleLeave = () => {
    if (!leaveArmed) {
      setLeaveArmed(true);
      triggerHaptic(hapticsEnabled, 8);
      return;
    }
    releaseAllTouchInputs();
    pump.zero();
    if (wsRef.current?.connected) wsRef.current.send({ type: 'player:leave' });
    resetToForm(null);
    triggerSwitchClick(soundClicks, 0.8);
  };

  const handleSelectProfile = (id: ControllerLayoutId) => {
    setLocalLayoutOverride(id);
    setDrawerOpen(false);
    triggerHaptic(hapticsEnabled, 9);
    triggerSwitchClick(soundClicks, 1.12);
  };

  const handleRotate = async () => {
    if (fsSupported) {
      const ok = await enterLandscapeFullscreen();
      if (ok) return;
    }
    showToast('Turn your phone sideways for the full-size deck');
  };

  const handleToggleFullscreen = () => {
    if (isFullscreen) void exitFullscreen();
    else void enterLandscapeFullscreen();
  };

  const toggleSound = () => {
    setSoundClicks((prev) => {
      const next = !prev;
      if (next) triggerSwitchClick(true, 1.15);
      return next;
    });
  };

  const toggleHaptics = () => {
    setHapticsEnabled((prev) => {
      const next = !prev;
      if (next) triggerHaptic(true, 14);
      return next;
    });
  };

  // =========================================================================
  // REJOINING AFTER RELOAD (no room snapshot yet)
  // =========================================================================
  if (inSession && !joinedRoom) {
    const code = intentRef.current?.roomCode ?? roomCodeInput;
    const color = intentRef.current?.color ?? '#B5FF2A';
    return (
      <div className="ctl-join min-h-[100dvh] cinema-stage-bg text-[#F5F4F0] flex flex-col items-center justify-center px-5 py-8 relative overflow-hidden">
        <div
          aria-hidden="true"
          style={{
            background: `radial-gradient(circle at 50% 35%, ${withAlpha(color, '22')} 0%, transparent 60%)`,
          }}
          className="pointer-events-none fixed inset-0"
        />
        <div className="ctl-anim-pop relative w-full max-w-xs console-deck rounded-[28px] p-6 flex flex-col items-center text-center">
          <span className="relative flex items-center justify-center w-20 h-20 mb-4">
            <span
              className="ctl-anim-ring absolute inset-0 rounded-full border-2"
              style={{ borderColor: color }}
            />
            <span
              className="w-16 h-16 rounded-full flex items-center justify-center bg-[#090810] border border-white/10"
              style={{ boxShadow: `0 0 24px ${withAlpha(color, '55')}` }}
            >
              <Gamepad2 className="w-7 h-7" style={{ color }} />
            </span>
          </span>
          <p className="font-mono-tech text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
            {wsConnected ? 'Rejoining room' : 'Finding the console'}
          </p>
          <p className="font-brand font-extrabold text-3xl tracking-[0.18em] text-[#B5FF2A] mt-1 [text-shadow:0_0_16px_rgba(181,255,42,0.5)]">
            {code}
          </p>
          <p className="text-xs text-white/55 mt-3 leading-relaxed">
            Your controller slot is held while you reconnect.
          </p>
          <button
            type="button"
            onClick={handleCancelRejoin}
            className="ctl-press mt-5 px-4 py-2 rounded-xl border border-white/15 bg-white/[0.04] font-mono-tech text-[11px] font-bold uppercase tracking-[0.16em] text-white/70 cursor-pointer"
          >
            Use a different code
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // PAIRING SCREEN
  // =========================================================================
  if (!showDeck) {
    const slotCount = Math.max(4, Math.min(6, roomCodeInput.length));
    const isJoining = phase === 'joining';
    const canSubmit = wsConnected && !isJoining && codeReady;

    return (
      <div className="ctl-join min-h-[100dvh] cinema-stage-bg text-[#F5F4F0] flex flex-col items-center justify-center px-4 py-6 relative overflow-x-hidden">
        <div
          aria-hidden="true"
          style={{
            background: `radial-gradient(circle at 50% 0%, ${withAlpha(previewColor, '24')} 0%, transparent 62%)`,
          }}
          className="pointer-events-none fixed inset-0 transition-[background] duration-300"
        />

        <div
          className="w-full max-w-sm bg-[#0B0A12] border border-white/[0.09] shadow-[0_30px_70px_-30px_rgba(0,0,0,1),inset_0_1px_0_rgba(255,255,255,0.06)] rounded-[28px] p-5 sm:p-6 relative overflow-hidden"
          style={{
            marginTop: 'env(safe-area-inset-top)',
            marginBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Accent lightbar */}
          <div
            style={{
              background: selectedColor ?? AUTO_SWATCH_BG,
              boxShadow: `0 0 22px ${withAlpha(previewColor, 'aa')}`,
            }}
            className="absolute top-0 left-10 right-10 h-1.5 rounded-b-full transition-all duration-200"
          />

          {[
            'top-3.5 left-3.5',
            'top-3.5 right-3.5',
            'bottom-3 left-3.5',
            'bottom-3 right-3.5',
          ].map((pos) => (
            <span
              key={pos}
              aria-hidden="true"
              className={`pointer-events-none absolute ${pos} w-2 h-2 rounded-full bg-[#090810] border border-white/15 shadow-[inset_0_1px_2px_rgba(0,0,0,0.9)] flex items-center justify-center`}
            >
              <span className="w-1 h-[1px] bg-white/25 rotate-45 block" />
            </span>
          ))}

          {/* Header */}
          <div className="flex items-center justify-between gap-2.5 mt-1.5 mb-5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                style={{
                  borderColor: withAlpha(previewColor, '55'),
                  boxShadow: `inset 0 2px 8px rgba(0,0,0,0.9), 0 0 18px ${withAlpha(previewColor, '26')}`,
                }}
                className="relative w-11 h-11 rounded-lg bg-[#090810] border flex items-center justify-center shrink-0 transition-all duration-200"
              >
                <Gamepad2
                  className="w-5 h-5 transition-colors duration-200"
                  style={{ color: selectedColor ?? '#B5FF2A' }}
                />
              </div>
              <div className="min-w-0">
                <h1 className="font-brand font-extrabold text-xl tracking-tight text-[#F5F4F0] leading-none truncate">
                  COUCH·OS
                </h1>
                <p className="font-osd text-[17px] leading-none text-[#B5FF2A]/80 mt-1.5 truncate">
                  PAIR THIS PHONE
                </p>
              </div>
            </div>

            <span
              role="status"
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border font-osd text-[16px] leading-none shrink-0 ${
                wsConnected
                  ? 'bg-[#B5FF2A]/12 border-[#B5FF2A]/45 text-[#B5FF2A]'
                  : 'bg-[#FFB800]/12 border-[#FFB800]/45 text-[#FFCF4D]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  wsConnected ? 'bg-[#B5FF2A]' : 'bg-[#FFB800] ctl-anim-breathe'
                }`}
              />
              {wsConnected ? 'ONLINE' : 'LINKING…'}
            </span>
          </div>

          <form onSubmit={handleJoin} className="space-y-4" noValidate>
            {/* Room code split-flap */}
            <div>
              <div className="flex items-center justify-between mb-1.5 px-0.5">
                <label
                  htmlFor="room-code-input"
                  className="font-osd text-[18px] leading-none text-white/80"
                >
                  ROOM CODE
                </label>
                <span className="font-osd text-[15px] leading-none text-white/40">
                  ON THE TV
                </span>
              </div>

              <div className="relative">
                <div
                  className={`grid gap-2 pointer-events-none ${
                    slotCount === 4
                      ? 'grid-cols-4'
                      : slotCount === 5
                        ? 'grid-cols-5'
                        : 'grid-cols-6'
                  }`}
                >
                  {Array.from({ length: slotCount }).map((_, idx) => {
                    const char = roomCodeInput[idx] ?? '';
                    const isActiveSlot =
                      codeFocused &&
                      idx === Math.min(roomCodeInput.length, slotCount - 1);
                    const accent = selectedColor ?? '#B5FF2A';
                    return (
                      <div
                        key={idx}
                        style={
                          isActiveSlot
                            ? {
                                borderColor: accent,
                                boxShadow: `inset 0 3px 12px rgba(0,0,0,0.95), 0 0 0 1.5px ${withAlpha(accent, '88')}, 0 0 16px ${withAlpha(accent, '33')}`,
                              }
                            : undefined
                        }
                        className="relative hw-lcd h-16 flex items-center justify-center overflow-hidden transition-all duration-150"
                      >
                        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.06] to-transparent" />
                        <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] bg-black/95 z-20 shadow-[0_1px_0_rgba(255,255,255,0.08)]" />
                        <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2.5 bg-[#2A293A] rounded-r-sm z-20" />
                        <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 w-1 h-2.5 bg-[#2A293A] rounded-l-sm z-20" />

                        {char ? (
                          <span
                            key={`${idx}-${char}`}
                            style={{
                              color: '#B5FF2A',
                              textShadow: '0 0 16px rgba(181, 255, 42, 0.6)',
                            }}
                            className="ctl-anim-flap relative z-10 font-osd text-[46px] leading-none"
                          >
                            {char}
                          </span>
                        ) : isActiveSlot ? (
                          <span
                            style={{
                              backgroundColor: accent,
                              boxShadow: `0 0 10px ${accent}`,
                            }}
                            className="relative z-10 w-0.5 h-7 rounded-full ctl-anim-breathe"
                          />
                        ) : (
                          <span className="relative z-10 w-2 h-2 rounded-full bg-white/15" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Transparent real input over the flaps (keyboard, paste, autofill) */}
                <input
                  id="room-code-input"
                  type="text"
                  inputMode="text"
                  maxLength={6}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  enterKeyHint="next"
                  autoFocus={!roomCodeInput}
                  value={roomCodeInput}
                  onFocus={() => setCodeFocused(true)}
                  onBlur={() => setCodeFocused(false)}
                  onChange={(e) => {
                    setErrorMsg(null);
                    const next = normalizeCode(e.target.value);
                    if (next.length > roomCodeInput.length) {
                      triggerHaptic(hapticsEnabled, 5);
                    }
                    setRoomCodeInput(next);
                  }}
                  aria-label="Room code"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-text caret-transparent"
                />
              </div>
            </div>

            {/* Name */}
            <div>
              <label
                htmlFor="player-name-input"
                className="block font-osd text-[18px] leading-none text-white/80 mb-1.5 px-0.5"
              >
                YOUR NAME
              </label>
              <input
                id="player-name-input"
                type="text"
                maxLength={18}
                autoComplete="nickname"
                autoCorrect="off"
                enterKeyHint="go"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Player"
                className="w-full hw-lcd px-3.5 py-3 text-base font-bold text-[#F5F4F0] placeholder:text-white/30 focus:outline-none focus:border-[#B5FF2A]/50 transition"
              />
            </div>

            {/* Colour */}
            <div>
              <div className="flex items-center justify-between mb-1.5 px-0.5">
                <span className="font-osd text-[18px] leading-none text-white/80">
                  CONTROLLER LIGHT
                </span>
                <button
                  type="button"
                  aria-pressed={selectedColor === null}
                  onClick={() => {
                    setSelectedColor(null);
                    triggerHaptic(hapticsEnabled, 6);
                    triggerSwitchClick(soundClicks, 1.1);
                  }}
                  className={`ctl-press inline-flex items-center gap-1.5 px-2 py-1 rounded-md border font-osd text-[15px] leading-none cursor-pointer ${
                    selectedColor === null
                      ? 'border-white/60 text-white bg-white/10'
                      : 'border-white/15 text-white/50'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: AUTO_SWATCH_BG }}
                  />
                  AUTO
                </button>
              </div>
              <div className="grid grid-cols-8 gap-1.5 hw-lcd p-2.5">
                {PLAYER_COLORS.map((c) => {
                  const active = selectedColor === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Use colour ${c}`}
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedColor(c);
                        triggerHaptic(hapticsEnabled, 6);
                        triggerSwitchClick(soundClicks, 1.18);
                      }}
                      style={{
                        backgroundColor: c,
                        boxShadow: active ? `0 0 16px ${withAlpha(c, 'bb')}` : undefined,
                      }}
                      className={`ctl-press relative aspect-square w-full rounded-[6px] border-2 border-[#07060B] cursor-pointer flex items-center justify-center ${
                        active
                          ? 'scale-110 ring-2 ring-white ring-offset-1 ring-offset-[#07060B]'
                          : 'opacity-70'
                      }`}
                    >
                      {active && (
                        <Check className="ctl-anim-pop w-3.5 h-3.5 text-[#07060B]" strokeWidth={3.5} />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="font-mono-tech text-[9px] text-white/40 mt-1.5 px-0.5">
                {selectedColor === null
                  ? 'Auto: you get your player number’s colour.'
                  : 'Shown on the TV next to your name.'}
              </p>
            </div>

            {errorMsg && (
              <div
                key={errorKey}
                role="alert"
                className="ctl-anim-shake rounded-lg bg-[#FF3B5C]/14 border border-[#FF3B5C]/60 px-3.5 py-2.5 text-xs text-[#FF8CA0] font-bold"
              >
                {errorMsg}
              </div>
            )}

            {/* Pair */}
            <button
              type="submit"
              disabled={!canSubmit}
              style={
                canSubmit && selectedColor
                  ? { boxShadow: `0 10px 30px ${withAlpha(selectedColor, '40')}` }
                  : undefined
              }
              className="ctl-press console-btn-hot w-full py-4 px-4 rounded-xl disabled:opacity-45 disabled:pointer-events-none font-brand font-extrabold text-sm tracking-[0.14em] uppercase cursor-pointer flex items-center justify-center gap-2.5"
            >
              {isJoining || !wsConnected ? (
                <LoaderCircle className="ctl-anim-spin w-4 h-4 shrink-0" />
              ) : (
                <span
                  style={{
                    background: selectedColor ?? AUTO_SWATCH_BG,
                    boxShadow: `0 0 10px ${previewColor}`,
                  }}
                  className="w-2.5 h-2.5 rounded-full border border-black/40 shrink-0"
                />
              )}
              <span className="truncate">
                {!wsConnected
                  ? 'Connecting to console…'
                  : isJoining
                    ? 'Pairing…'
                    : codeReady
                      ? `Join ${roomCodeInput}${displayName ? ` as ${displayName}` : ''}`
                      : 'Enter room code'}
              </span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================================
  // CONNECTED CONTROLLER
  // =========================================================================
  const activeProfile =
    PROFILE_PILLS.find((p) => p.id === effectiveLayout) ?? PROFILE_PILLS[0];
  const reconnecting = phase === 'reconnecting';
  const slotLabel = `P${effectiveSlot + 1}`;
  const glowAccent = joinedRoom.activeGame.accent ?? effectiveColor;
  const playerName = myPlayer?.name ?? intentRef.current?.name ?? '';

  const iconBtn =
    'ctl-press p-2 rounded-md border cursor-pointer shrink-0 flex items-center justify-center';

  return (
    <div
      className="ctl-root controller-surface fixed inset-0 bg-[#07060B] text-[#F5F4F0] flex flex-col overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* HUD */}
      <div
        className="relative z-30 bg-[#07060B]/95 border-b border-white/[0.08] shrink-0 shadow-[0_4px_18px_rgba(0,0,0,0.6)]"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingLeft: 'max(8px, env(safe-area-inset-left))',
          paddingRight: 'max(8px, env(safe-area-inset-right))',
        }}
      >
        <div className="h-11 flex items-center justify-between gap-2">
          {/* Player identity */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="relative flex items-center justify-center h-8 min-w-[44px] px-2 rounded-[5px] font-osd text-[24px] text-[#07060B] shrink-0 leading-none"
              style={{
                backgroundColor: effectiveColor,
                boxShadow: `0 0 16px ${withAlpha(effectiveColor, '88')}, inset 0 1px 0 rgba(255,255,255,0.45)`,
              }}
              aria-label={`You are player ${effectiveSlot + 1}`}
            >
              {slotLabel}
            </span>
            <div className="min-w-0 hidden min-[400px]:block">
              <div className="font-display text-[13px] font-bold text-[#F5F4F0] truncate max-w-[120px] leading-tight">
                {playerName || `Player ${effectiveSlot + 1}`}
              </div>
              <div className="font-osd text-[15px] text-[#B5FF2A]/85 leading-none mt-0.5">
                ROOM {joinedRoom.roomCode}
              </div>
            </div>
          </div>

          {/* Inline profile pills (wide screens) */}
          <div className="hidden min-[720px]:flex items-center gap-1 px-1 py-0.5 hw-lcd overflow-x-auto no-scrollbar">
            {PROFILE_PILLS.map((pill) => {
              const isActive = effectiveLayout === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => handleSelectProfile(pill.id)}
                  style={
                    isActive
                      ? {
                          backgroundColor: withAlpha(pill.accentColor, '24'),
                          borderColor: withAlpha(pill.accentColor, '88'),
                          color: '#F5F4F0',
                          boxShadow: `0 0 10px ${withAlpha(pill.accentColor, '33')}`,
                        }
                      : undefined
                  }
                  className={`ctl-press px-2 py-1 rounded-md border font-osd text-[16px] leading-none cursor-pointer shrink-0 ${
                    isActive ? '' : 'border-transparent text-white/50'
                  }`}
                >
                  {pill.short}
                </button>
              );
            })}
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-1.5 shrink-0">
            <LinkBadge wsRef={wsRef} transport={transport} online={!reconnecting} />

            <button
              type="button"
              aria-expanded={drawerOpen}
              onClick={() => {
                triggerHaptic(hapticsEnabled, 6);
                triggerSwitchClick(soundClicks, 1.1);
                setDrawerOpen((open) => !open);
              }}
              className={`ctl-press min-[720px]:hidden inline-flex items-center gap-1.5 px-2 py-1 rounded-md border font-osd text-[17px] leading-none cursor-pointer ${
                drawerOpen
                  ? 'bg-[#B5FF2A]/10 border-[#B5FF2A]/70 text-[#B5FF2A]'
                  : 'hw-lcd border-white/15 text-[#F5F4F0]'
              }`}
              title="Controller layout & settings"
            >
              <span
                style={{ backgroundColor: activeProfile.accentColor }}
                className="w-2 h-2 rounded-full shrink-0"
              />
              <span>{activeProfile.short}</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-150 ${
                  drawerOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            <button
              type="button"
              aria-pressed={soundClicks}
              onClick={toggleSound}
              className={`${iconBtn} hidden min-[540px]:flex ${
                soundClicks
                  ? 'bg-[#B5FF2A]/12 border-[#B5FF2A]/40 text-[#B5FF2A]'
                  : 'bg-[#111019] border-white/10 text-white/35'
              }`}
              title={soundClicks ? 'Click sounds on' : 'Click sounds off'}
            >
              {soundClicks ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              aria-pressed={hapticsEnabled}
              onClick={toggleHaptics}
              className={`${iconBtn} hidden min-[540px]:flex ${
                hapticsEnabled
                  ? 'bg-[#FF3B5C]/16 border-[#FF3B5C]/50 text-[#FF6B84]'
                  : 'bg-[#111019] border-white/10 text-white/35'
              }`}
              title="Vibration"
            >
              <Vibrate className="w-3.5 h-3.5" />
            </button>

            {isPortrait && (
              <button
                type="button"
                onClick={() => void handleRotate()}
                className={`${iconBtn} bg-[#111019] border-white/12 text-white/80`}
                title="Rotate to landscape"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            )}

            {fsSupported && !isPortrait && (
              <button
                type="button"
                onClick={handleToggleFullscreen}
                className={`${iconBtn} bg-[#111019] border-white/12 text-white/80`}
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
              </button>
            )}

            <button
              type="button"
              onClick={handleLeave}
              className={`ctl-press h-[30px] rounded-md border cursor-pointer shrink-0 flex items-center justify-center gap-1 overflow-hidden transition-[width,background-color] duration-200 ${
                leaveArmed
                  ? 'w-[64px] bg-[#FF3B5C] border-[#FF3B5C] text-white'
                  : 'w-[30px] bg-[#FF3B5C]/14 border-[#FF3B5C]/45 text-[#FF6B84]'
              }`}
              title={leaveArmed ? 'Tap again to leave' : 'Leave room'}
              aria-label={leaveArmed ? 'Tap again to leave the room' : 'Leave room'}
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              {leaveArmed && (
                <span className="font-osd text-[15px] leading-none">
                  SURE?
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Layout + settings sheet */}
        {drawerOpen && (
          <>
            <div
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-30 bg-black/65 backdrop-blur-[2px]"
            />
            <div className="absolute left-0 right-0 top-full mt-2 px-2.5 z-40 flex items-center justify-center">
              <div className="ctl-anim-sheet w-full max-w-md bg-[#0B0A12] border border-white/[0.1] shadow-[0_24px_60px_-20px_rgba(0,0,0,1)] rounded-xl p-2.5">
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="font-osd text-[17px] leading-none text-white/55">
                    PAD LAYOUT
                  </span>
                  <span className="font-osd text-[17px] leading-none text-[#B5FF2A] osd-glow">
                    {CONTROLLER_LAYOUT_META[effectiveLayout].label}
                  </span>
                </div>

                <div className="grid grid-cols-2 min-[420px]:grid-cols-3 gap-2">
                  {PROFILE_PILLS.map((card) => {
                    const isActive = effectiveLayout === card.id;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => handleSelectProfile(card.id)}
                        style={{
                          backgroundColor: card.shellBg,
                          borderColor: isActive ? '#B5FF2A' : 'rgba(255,255,255,0.12)',
                          boxShadow: isActive ? '0 0 14px rgba(181,255,42,0.28)' : undefined,
                        }}
                        className="ctl-press relative rounded-lg border px-2.5 py-2.5 text-left cursor-pointer overflow-hidden"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-osd text-[20px] leading-none text-[#F5F4F0]">
                            {card.short}
                          </span>
                          <div className="flex items-center gap-1">
                            {card.dots.map((dotColor, i) => (
                              <span
                                key={i}
                                style={{ backgroundColor: dotColor }}
                                className="w-2 h-2 rounded-full border border-black/50"
                              />
                            ))}
                          </div>
                        </div>
                        <div className="font-mono-tech text-[9px] font-bold mt-1 truncate text-white/55">
                          {card.subtitle}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2.5">
                  <button
                    type="button"
                    aria-pressed={soundClicks}
                    onClick={toggleSound}
                    className={`ctl-press flex items-center justify-center gap-2 py-2.5 rounded-lg border font-mono-tech text-[10px] font-extrabold tracking-wider cursor-pointer ${
                      soundClicks
                        ? 'bg-[#B5FF2A]/12 border-[#B5FF2A]/40 text-[#B5FF2A]'
                        : 'bg-[#111019] border-white/10 text-white/45'
                    }`}
                  >
                    {soundClicks ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                    CLICKS {soundClicks ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    aria-pressed={hapticsEnabled}
                    onClick={toggleHaptics}
                    className={`ctl-press flex items-center justify-center gap-2 py-2.5 rounded-lg border font-mono-tech text-[10px] font-extrabold tracking-wider cursor-pointer ${
                      hapticsEnabled
                        ? 'bg-[#FF3B5C]/16 border-[#FF3B5C]/50 text-[#FF6B84]'
                        : 'bg-[#111019] border-white/10 text-white/45'
                    }`}
                  >
                    <Vibrate className="w-3.5 h-3.5" />
                    RUMBLE {hapticsEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Deck */}
      <div
        className="relative flex-1 min-h-0"
        style={{
          paddingTop: 6,
          paddingRight: 'max(6px, env(safe-area-inset-right))',
          paddingBottom: 'max(6px, env(safe-area-inset-bottom))',
          paddingLeft: 'max(6px, env(safe-area-inset-left))',
        }}
      >
        <div
          ref={deckWrapRef}
          className="relative w-full h-full transition-[filter] duration-300"
          style={reconnecting ? { filter: 'saturate(0.35) brightness(0.78)' } : undefined}
        >
          <ControllerDeck
            layout={effectiveLayout}
            playerColor={effectiveColor}
            playerSlot={effectiveSlot}
            hapticsEnabled={hapticsEnabled}
            soundClicks={soundClicks}
            isPortrait={isPortrait}
            gameTitle={joinedRoom.activeGame.title}
            gameControls={joinedRoom.activeGame.controls}
            gameAccent={joinedRoom.activeGame.accent}
            onButtonChange={handleButtonChange}
            onDirectionsChange={handleDirectionsChange}
            onStickChange={handleStickChange}
          />
          {/* Rumble glow (animated via WAAPI) */}
          <div
            ref={rumbleGlowRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[28px] z-30"
            style={{
              opacity: 0,
              boxShadow: `inset 0 0 0 2px ${glowAccent}, inset 0 0 48px ${withAlpha(glowAccent, '77')}, 0 0 30px ${withAlpha(glowAccent, '55')}`,
            }}
          />
        </div>

        {reconnecting ? (
          <ReconnectBanner slotLabel={slotLabel} color={effectiveColor} />
        ) : !joinedRoom.hostConnected ? (
          <div
            role="status"
            className="ctl-anim-drop pointer-events-none absolute left-1/2 top-3 z-40 flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#07060B]/95 border border-[#22D3EE]/45 shadow-[0_10px_30px_rgba(0,0,0,0.6)] max-w-[calc(100%-24px)]"
          >
            <Tv className="w-4 h-4 text-[#22D3EE] ctl-anim-breathe shrink-0" />
            <span className="font-osd text-[17px] leading-none text-white/80 truncate">
              NO SIGNAL · WAITING FOR THE CONSOLE…
            </span>
          </div>
        ) : null}

        {toast && (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className={`ctl-anim-drop pointer-events-none absolute left-1/2 z-40 px-3.5 py-2 rounded-lg border shadow-[0_10px_30px_rgba(0,0,0,0.6)] font-osd text-[18px] leading-tight max-w-[calc(100%-24px)] text-center ${
              isPortrait
                ? 'top-[44%]'
                : reconnecting || !joinedRoom.hostConnected
                  ? 'top-[64px]'
                  : 'top-3'
            } ${
              toast.tone === 'good'
                ? 'bg-[#07060B]/95 border-[#B5FF2A]/50 text-[#D7FF8A]'
                : toast.tone === 'warn'
                  ? 'bg-[#07060B]/95 border-[#FF3B5C]/55 text-[#FF9AAC]'
                  : 'bg-[#07060B]/95 border-white/15 text-white/85'
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>

      {/* Slot reveal */}
      {reveal && (
        <div
          key={reveal.id}
          aria-hidden="true"
          className="ctl-reveal pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${withAlpha(reveal.color, '40')} 0%, rgba(7,6,11,0.88) 62%)`,
          }}
        >
          <span
            className="ctl-reveal-burst absolute w-48 h-48 rounded-full border-4"
            style={{ borderColor: reveal.color, boxShadow: `0 0 40px ${reveal.color}` }}
          />
          <div className="ctl-anim-pop relative flex flex-col items-center">
            <span className="font-osd text-[26px] leading-none text-white/80 osd-glow">
              YOU ARE PLAYER
            </span>
            <span
              className="font-osd leading-[0.85] text-[160px]"
              style={{
                color: reveal.color,
                textShadow: `0 0 36px ${withAlpha(reveal.color, 'aa')}, 0 6px 0 rgba(0,0,0,0.5)`,
              }}
            >
              {reveal.slot + 1}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
