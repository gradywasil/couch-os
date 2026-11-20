export type ControllerLayoutId =
  | 'nes'
  | 'snes'
  | 'gba'
  | 'genesis'
  | 'n64'
  | 'dualstick';

export type ClientRole = 'host' | 'player' | 'tv';

export type TransportMode = 'ws' | 'webrtc';

/**
 * Standard W3C Gamepad API button indices.
 * Positional mapping aligns with RetroArch RetroPad & standard controllers:
 * 0 = South (B on Nintendo / A on Xbox)
 * 1 = East  (A on Nintendo / B on Xbox)
 * 2 = West  (Y on SNES     / X on Xbox)
 * 3 = North (X on SNES     / Y on Xbox)
 */
export const GAMEPAD_BUTTON = {
  SOUTH: 0,
  EAST: 1,
  WEST: 2,
  NORTH: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  HOME: 16,
} as const;

export type GamepadButtonIndex =
  (typeof GAMEPAD_BUTTON)[keyof typeof GAMEPAD_BUTTON];

export interface ControllerInputState {
  /** Bitmask of standard Gamepad buttons 0..16 */
  buttonsMask: number;
  /** Analog trigger values [0, 1] */
  l2?: number;
  r2?: number;
  /** Normalized axes [-1, 1]: [leftX, leftY, rightX, rightY] */
  axes: [number, number, number, number];
  /** Monotonically increasing sequence number per sender */
  seq: number;
  /** Optional sender timestamp for latency estimation */
  ts?: number;
}

/** Max simultaneous player ports a room exposes (P1–P4). */
export const MAX_PLAYERS = 4;

/** How long a dropped phone keeps its player port before it is released. */
export const PLAYER_RECONNECT_GRACE_MS = 45_000;

export const CONTROLLER_LAYOUT_IDS: readonly ControllerLayoutId[] = [
  'nes',
  'snes',
  'gba',
  'genesis',
  'n64',
  'dualstick',
];

export function isControllerLayoutId(value: unknown): value is ControllerLayoutId {
  return (
    typeof value === 'string' &&
    (CONTROLLER_LAYOUT_IDS as readonly string[]).includes(value)
  );
}

function clampUnit(v: unknown, min: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n < min ? min : n > 1 ? 1 : n;
}

/**
 * Normalizes an untrusted input packet: clamps axes/triggers into range,
 * masks buttons to the 17 standard indices and rejects non-finite values.
 * Returns null when the payload is not an input state at all.
 */
export function sanitizeInputState(raw: unknown): ControllerInputState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ControllerInputState>;
  if (typeof r.buttonsMask !== 'number' || !Number.isFinite(r.buttonsMask)) {
    return null;
  }
  const axes = Array.isArray(r.axes) ? r.axes : [];
  const seq = typeof r.seq === 'number' && Number.isFinite(r.seq) ? r.seq : 0;
  const out: ControllerInputState = {
    buttonsMask: r.buttonsMask & 0x1ffff,
    l2: clampUnit(r.l2, 0),
    r2: clampUnit(r.r2, 0),
    axes: [
      clampUnit(axes[0], -1),
      clampUnit(axes[1], -1),
      clampUnit(axes[2], -1),
      clampUnit(axes[3], -1),
    ],
    seq,
  };
  if (typeof r.ts === 'number' && Number.isFinite(r.ts)) out.ts = r.ts;
  return out;
}

export function createEmptyInputState(seq = 0): ControllerInputState {
  return {
    buttonsMask: 0,
    l2: 0,
    r2: 0,
    axes: [0, 0, 0, 0],
    seq,
  };
}

export function isButtonPressed(mask: number, index: number): boolean {
  return (mask & (1 << index)) !== 0;
}

export function setButtonMask(
  mask: number,
  index: number,
  pressed: boolean,
): number {
  if (pressed) {
    return mask | (1 << index);
  }
  return mask & ~(1 << index);
}

export interface PlayerInfo {
  id: string;
  clientId: string;
  name: string;
  color: string;
  /** 0-indexed player port: 0 = P1, 1 = P2, 2 = P3, 3 = P4 */
  slot: number;
  connected: boolean;
  /** Epoch ms when the player's socket dropped; set while `connected` is false. */
  disconnectedAt?: number;
  layoutOverride?: ControllerLayoutId;
  latencyMs?: number;
  transport: TransportMode;
}

export interface TvReceiverInfo {
  id: string;
  connectedAt: number;
}

export interface ActiveGameInfo {
  mode: 'lobby' | 'emulator' | 'webgame';
  title: string;
  systemName?: string;
  controls?: string;
  accent?: string;
}

export interface RoomState {
  roomCode: string;
  hostConnected: boolean;
  defaultLayout: ControllerLayoutId;
  tvStreamActive: boolean;
  activeGame: ActiveGameInfo;
  players: PlayerInfo[];
  tvReceivers: TvReceiverInfo[];
}

export type RtcSignalPayload =
  | { type: 'offer'; sdp: string; purpose: 'controller' | 'tv-stream' }
  | { type: 'answer'; sdp: string; purpose: 'controller' | 'tv-stream' }
  | {
      type: 'ice-candidate';
      candidate: {
        candidate: string;
        sdpMid?: string | null;
        sdpMLineIndex?: number | null;
      };
      purpose: 'controller' | 'tv-stream';
    };

export type ClientToServerMessage =
  | { type: 'host:create'; roomCode?: string }
  | {
      type: 'player:join';
      roomCode: string;
      name: string;
      color?: string;
      clientId: string;
    }
  | { type: 'player:leave' }
  | { type: 'tv:join'; roomCode: string }
  | {
      type: 'host:set_layout';
      layout: ControllerLayoutId;
      playerId?: string;
    }
  | { type: 'host:swap_slots'; slotA: number; slotB: number }
  | { type: 'host:kick_player'; playerId: string }
  | { type: 'host:set_game'; activeGame: ActiveGameInfo }
  | { type: 'host:tv_stream_ready'; active: boolean }
  | {
      type: 'host:rumble';
      playerId: string;
      durationMs: number;
      intensity: number;
    }
  | { type: 'player:transport_changed'; transport: TransportMode }
  | { type: 'input:state'; state: ControllerInputState }
  | { type: 'rtc:signal'; targetId: string; signal: RtcSignalPayload }
  | { type: 'ping'; ts: number };

export type ServerToClientMessage =
  | { type: 'host:created'; roomCode: string; hostId: string; room: RoomState }
  | {
      type: 'player:joined';
      playerId: string;
      slot: number;
      room: RoomState;
    }
  | { type: 'tv:joined'; tvId: string; room: RoomState }
  | { type: 'room:state'; room: RoomState }
  | {
      type: 'input:remote';
      playerId: string;
      slot: number;
      state: ControllerInputState;
    }
  | { type: 'layout:changed'; layout: ControllerLayoutId }
  | { type: 'rumble'; durationMs: number; intensity: number }
  | {
      type: 'rtc:signal';
      fromId: string;
      fromRole: ClientRole;
      signal: RtcSignalPayload;
    }
  | { type: 'kicked'; reason: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; ts: number; serverTs: number };

export interface ConsoleProfile {
  id: string;
  name: string;
  core: string;
  extensions: string[];
  layout: ControllerLayoutId;
}

export const CONSOLE_PROFILES: ConsoleProfile[] = [
  {
    id: 'nes',
    name: 'Nintendo (NES)',
    core: 'fceumm',
    extensions: ['.nes', '.fds', '.unf', '.unif'],
    layout: 'nes',
  },
  {
    id: 'snes',
    name: 'Super Nintendo (SNES)',
    core: 'snes9x',
    extensions: ['.sfc', '.smc', '.fig', '.swc'],
    layout: 'snes',
  },
  {
    id: 'gba',
    name: 'Game Boy Advance (GBA)',
    core: 'mgba',
    extensions: ['.gba'],
    layout: 'gba',
  },
  {
    id: 'gb',
    name: 'Game Boy / Color',
    core: 'gambatte',
    extensions: ['.gb', '.gbc'],
    layout: 'nes',
  },
  {
    id: 'genesis',
    name: 'Sega Genesis / Mega Drive',
    core: 'genesis_plus_gx',
    extensions: ['.md', '.gen', '.smd', '.bin'],
    layout: 'genesis',
  },
  {
    id: 'n64',
    name: 'Nintendo 64',
    core: 'mupen64plus_next',
    extensions: ['.z64', '.n64', '.v64'],
    layout: 'n64',
  },
  {
    id: 'pce',
    name: 'PC Engine / TurboGrafx-16',
    core: 'mednafen_pce_fast',
    extensions: ['.pce'],
    layout: 'nes',
  },
];

export function detectConsoleProfile(
  filename: string,
): ConsoleProfile | undefined {
  const lower = filename.toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx === -1) return undefined;
  const ext = lower.slice(dotIdx);
  return CONSOLE_PROFILES.find((p) => p.extensions.includes(ext));
}

export const PLAYER_COLORS = [
  '#38bdf8', // P1 Sky Blue
  '#fb7185', // P2 Coral Rose
  '#4ade80', // P3 Mint Green
  '#facc15', // P4 Amber Gold
  '#c084fc', // P5 Violet
  '#fb923c', // P6 Orange
  '#2dd4bf', // P7 Teal
  '#f472b6', // P8 Pink
] as const;

export const CONTROLLER_LAYOUT_META: Record<
  ControllerLayoutId,
  { label: string; shortLabel: string; description: string }
> = {
  nes: {
    label: 'NES Classic',
    shortLabel: 'NES',
    description: 'D-Pad, Select/Start, B & A',
  },
  snes: {
    label: 'Super NES',
    shortLabel: 'SNES',
    description: 'D-Pad, 4 Face Buttons (Y/X/B/A), L & R',
  },
  gba: {
    label: 'Game Boy Advance',
    shortLabel: 'GBA',
    description: 'D-Pad, B & A, L & R Triggers',
  },
  genesis: {
    label: 'Sega Genesis 6-Btn',
    shortLabel: 'GEN',
    description: 'D-Pad, X/Y/Z + A/B/C Arcade Layout',
  },
  n64: {
    label: 'Nintendo 64',
    shortLabel: 'N64',
    description: 'Analog Stick, D-Pad, A/B, C-Pad, L/R/Z',
  },
  dualstick: {
    label: 'Dual-Stick Pro',
    shortLabel: 'PRO',
    description: 'Dual Analog Sticks, D-Pad, 4 Face, L1/L2/R1/R2',
  },
};
