import crypto from 'node:crypto';
import {
  ActiveGameInfo,
  ClientRole,
  ControllerLayoutId,
  MAX_PLAYERS,
  PLAYER_COLORS,
  PLAYER_RECONNECT_GRACE_MS,
  PlayerInfo,
  RoomState,
  TransportMode,
  TvReceiverInfo,
} from '@couch-emu/shared';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,6}$/;

export interface ManagedPlayer extends PlayerInfo {
  socketId: string;
}

export interface ManagedTv extends TvReceiverInfo {
  socketId: string;
}

export interface ManagedRoom {
  roomCode: string;
  hostId: string | null;
  hostConnected: boolean;
  defaultLayout: ControllerLayoutId;
  tvStreamActive: boolean;
  activeGame: ActiveGameInfo;
  /** Keyed by player id (== the socket id of their current connection). */
  players: Map<string, ManagedPlayer>;
  tvReceivers: Map<string, ManagedTv>;
  createdAt: number;
  hostDisconnectedAt: number | null;
}

export interface SocketBinding {
  id: string;
  role: ClientRole;
  roomCode: string;
}

export type JoinFailure = { ok: false; code: string; message: string };

export interface DetachResult {
  roomCode: string;
  role: ClientRole;
  room: ManagedRoom | null;
}

export class RoomManager {
  private rooms = new Map<string, ManagedRoom>();
  private bindings = new Map<string, SocketBinding>();

  constructor(private now: () => number = Date.now) {}

  generateRoomCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
  }

  /**
   * Creates a room for a host, or hands an existing room back to a host that
   * reconnected with its saved code. A room whose host socket is still alive
   * is never taken over (e.g. a duplicated browser tab that copied
   * sessionStorage) — the newcomer gets a fresh room instead.
   */
  createOrReclaimHostRoom(
    socketId: string,
    requestedCode?: string,
    isSocketAlive: (socketId: string) => boolean = () => false,
  ): { room: ManagedRoom; hostId: string } {
    this.detachSocket(socketId);

    const normalized = requestedCode?.trim().toUpperCase();
    const existing = normalized ? this.rooms.get(normalized) : undefined;
    const hostStillLive =
      existing?.hostId != null &&
      existing.hostId !== socketId &&
      isSocketAlive(existing.hostId);

    if (existing && !hostStillLive) {
      if (existing.hostId && existing.hostId !== socketId) {
        this.bindings.delete(existing.hostId);
      }
      existing.hostId = socketId;
      existing.hostConnected = true;
      existing.hostDisconnectedAt = null;
      this.bindings.set(socketId, {
        id: socketId,
        role: 'host',
        roomCode: existing.roomCode,
      });
      return { room: existing, hostId: socketId };
    }

    const roomCode =
      normalized && !existing && ROOM_CODE_PATTERN.test(normalized)
        ? normalized
        : this.generateRoomCode();

    const room: ManagedRoom = {
      roomCode,
      hostId: socketId,
      hostConnected: true,
      defaultLayout: 'snes',
      tvStreamActive: false,
      activeGame: {
        mode: 'lobby',
        title: 'Couch Console Lobby',
      },
      players: new Map(),
      tvReceivers: new Map(),
      createdAt: this.now(),
      hostDisconnectedAt: null,
    };

    this.rooms.set(roomCode, room);
    this.bindings.set(socketId, {
      id: socketId,
      role: 'host',
      roomCode,
    });

    return { room, hostId: socketId };
  }

  /**
   * Joins a phone to a room. A phone presenting a clientId already known to
   * the room (connected or within its reconnect grace window) takes its old
   * port back; the superseded socket id is returned so the caller can close it.
   */
  joinPlayer(
    socketId: string,
    rawRoomCode: string,
    name: string,
    clientId: string,
    preferredColor?: string,
  ):
    | {
        ok: true;
        room: ManagedRoom;
        player: ManagedPlayer;
        replacedSocketId?: string;
      }
    | JoinFailure {
    const roomCode = String(rawRoomCode ?? '').trim().toUpperCase();
    const room = this.rooms.get(roomCode);
    if (!room) {
      return {
        ok: false,
        code: 'ROOM_NOT_FOUND',
        message: `Room "${roomCode}" not found. Check the code on the TV screen.`,
      };
    }

    this.detachSocket(socketId);

    const cleanName = String(name ?? '').trim().slice(0, 18) || '';
    const color = sanitizeColor(preferredColor);
    const cleanClientId = String(clientId ?? '').slice(0, 64) || socketId;

    let existingByClient: ManagedPlayer | undefined;
    for (const p of room.players.values()) {
      if (p.clientId === cleanClientId) {
        existingByClient = p;
        break;
      }
    }

    if (existingByClient) {
      const previousSocketId = existingByClient.socketId;
      room.players.delete(existingByClient.id);
      if (previousSocketId !== socketId) {
        this.bindings.delete(previousSocketId);
      }
      const updated: ManagedPlayer = {
        ...existingByClient,
        id: socketId,
        socketId,
        name: cleanName || existingByClient.name,
        color: color || existingByClient.color,
        connected: true,
        disconnectedAt: undefined,
        transport: 'ws',
        latencyMs: undefined,
      };
      room.players.set(socketId, updated);
      this.bindings.set(socketId, { id: socketId, role: 'player', roomCode });
      return {
        ok: true,
        room,
        player: updated,
        replacedSocketId:
          previousSocketId !== socketId && existingByClient.connected
            ? previousSocketId
            : undefined,
      };
    }

    const takenSlots = new Set(
      Array.from(room.players.values()).map((p) => p.slot),
    );
    let slot = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!takenSlots.has(i)) {
        slot = i;
        break;
      }
    }

    if (slot === -1) {
      return {
        ok: false,
        code: 'ROOM_FULL',
        message: `Room "${roomCode}" is full (max ${MAX_PLAYERS} players).`,
      };
    }

    const player: ManagedPlayer = {
      id: socketId,
      socketId,
      clientId: cleanClientId,
      name: cleanName || `Player ${slot + 1}`,
      color: color || PLAYER_COLORS[slot % PLAYER_COLORS.length],
      slot,
      connected: true,
      transport: 'ws',
    };

    room.players.set(socketId, player);
    this.bindings.set(socketId, { id: socketId, role: 'player', roomCode });

    return { ok: true, room, player };
  }

  joinTv(
    socketId: string,
    rawRoomCode: string,
  ): { ok: true; room: ManagedRoom; tv: ManagedTv } | JoinFailure {
    const roomCode = String(rawRoomCode ?? '').trim().toUpperCase();
    const room = this.rooms.get(roomCode);
    if (!room) {
      return {
        ok: false,
        code: 'ROOM_NOT_FOUND',
        message: `Room "${roomCode}" not found.`,
      };
    }

    this.detachSocket(socketId);

    const tv: ManagedTv = {
      id: socketId,
      socketId,
      connectedAt: this.now(),
    };
    room.tvReceivers.set(socketId, tv);
    this.bindings.set(socketId, { id: socketId, role: 'tv', roomCode });

    return { ok: true, room, tv };
  }

  setLayout(
    roomCode: string,
    layout: ControllerLayoutId,
    playerId?: string,
  ): ManagedRoom | null {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    if (playerId) {
      const player = room.players.get(playerId);
      if (!player) return null;
      player.layoutOverride = layout;
    } else {
      room.defaultLayout = layout;
      for (const player of room.players.values()) {
        player.layoutOverride = undefined;
      }
    }
    return room;
  }

  swapSlots(roomCode: string, slotA: number, slotB: number): ManagedRoom | null {
    const room = this.rooms.get(roomCode);
    if (
      !room ||
      !Number.isInteger(slotA) ||
      !Number.isInteger(slotB) ||
      slotA === slotB ||
      slotA < 0 ||
      slotB < 0 ||
      slotA >= MAX_PLAYERS ||
      slotB >= MAX_PLAYERS
    ) {
      return null;
    }

    let playerA: ManagedPlayer | undefined;
    let playerB: ManagedPlayer | undefined;
    for (const p of room.players.values()) {
      if (p.slot === slotA) playerA = p;
      else if (p.slot === slotB) playerB = p;
    }

    if (!playerA && !playerB) return room;
    if (playerA) playerA.slot = slotB;
    if (playerB) playerB.slot = slotA;
    return room;
  }

  kickPlayer(
    roomCode: string,
    playerId: string,
  ): { room: ManagedRoom; removed: ManagedPlayer } | null {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    const player = room.players.get(playerId);
    if (!player) return null;
    room.players.delete(playerId);
    this.bindings.delete(player.socketId);
    return { room, removed: player };
  }

  /** Explicit leave from the phone: frees the port immediately. */
  leavePlayer(socketId: string): ManagedRoom | null {
    const binding = this.bindings.get(socketId);
    if (!binding || binding.role !== 'player') return null;
    this.bindings.delete(socketId);
    const room = this.rooms.get(binding.roomCode);
    if (!room) return null;
    room.players.delete(socketId);
    return room;
  }

  setGame(roomCode: string, activeGame: ActiveGameInfo): ManagedRoom | null {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    room.activeGame = {
      mode: activeGame.mode,
      title: String(activeGame.title ?? '').slice(0, 80),
      systemName: activeGame.systemName?.slice(0, 40),
      controls: activeGame.controls?.slice(0, 160),
      accent: activeGame.accent?.slice(0, 16),
    };
    return room;
  }

  setTvStreamActive(roomCode: string, active: boolean): ManagedRoom | null {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    room.tvStreamActive = Boolean(active);
    return room;
  }

  setPlayerTransport(
    socketId: string,
    transport: TransportMode,
  ): ManagedRoom | null {
    const binding = this.bindings.get(socketId);
    if (!binding || binding.role !== 'player') return null;
    const room = this.rooms.get(binding.roomCode);
    if (!room) return null;
    const player = room.players.get(socketId);
    if (!player || player.transport === transport) return null;
    player.transport = transport;
    return room;
  }

  setPlayerLatency(socketId: string, latencyMs: number): ManagedRoom | null {
    const binding = this.bindings.get(socketId);
    if (!binding || binding.role !== 'player') return null;
    const room = this.rooms.get(binding.roomCode);
    const player = room?.players.get(socketId);
    if (!room || !player) return null;
    const rounded = Math.max(0, Math.min(9999, Math.round(latencyMs)));
    // Only report meaningful changes so we don't spam room broadcasts.
    if (
      player.latencyMs !== undefined &&
      Math.abs(player.latencyMs - rounded) < 4
    ) {
      return null;
    }
    player.latencyMs = rounded;
    return room;
  }

  /**
   * Called when a socket closes. Players are kept in their port (marked
   * disconnected) for a grace window so a phone that locks its screen or
   * hops Wi-Fi can snap straight back in.
   */
  detachSocket(socketId: string): DetachResult | null {
    const binding = this.bindings.get(socketId);
    if (!binding) return null;
    this.bindings.delete(socketId);

    const room = this.rooms.get(binding.roomCode);
    if (!room) {
      return { roomCode: binding.roomCode, role: binding.role, room: null };
    }

    if (binding.role === 'host') {
      if (room.hostId === socketId) {
        room.hostConnected = false;
        room.hostId = null;
        room.tvStreamActive = false;
        room.hostDisconnectedAt = this.now();
      }
    } else if (binding.role === 'player') {
      const player = room.players.get(socketId);
      if (player) {
        player.connected = false;
        player.disconnectedAt = this.now();
        player.transport = 'ws';
        player.latencyMs = undefined;
      }
    } else if (binding.role === 'tv') {
      room.tvReceivers.delete(socketId);
    }

    return { roomCode: binding.roomCode, role: binding.role, room };
  }

  /** Releases ports whose phones never came back. Returns touched rooms. */
  pruneDisconnectedPlayers(graceMs = PLAYER_RECONNECT_GRACE_MS): ManagedRoom[] {
    const now = this.now();
    const touched: ManagedRoom[] = [];
    for (const room of this.rooms.values()) {
      let changed = false;
      for (const [id, p] of room.players) {
        if (
          !p.connected &&
          p.disconnectedAt !== undefined &&
          now - p.disconnectedAt > graceMs
        ) {
          room.players.delete(id);
          changed = true;
        }
      }
      if (changed) touched.push(room);
    }
    return touched;
  }

  /**
   * Deletes rooms whose host has been gone longer than `ttlMs` with nobody
   * connected, or longer than `abandonMs` regardless of who is waiting.
   * Returns the deleted rooms so the caller can notify lingering sockets.
   */
  pruneExpiredRooms(ttlMs = 60_000, abandonMs = 30 * 60_000): ManagedRoom[] {
    const now = this.now();
    const removed: ManagedRoom[] = [];
    for (const [code, room] of this.rooms.entries()) {
      if (room.hostConnected || room.hostDisconnectedAt === null) continue;
      const hostGoneFor = now - room.hostDisconnectedAt;
      const anyoneConnected =
        room.tvReceivers.size > 0 ||
        Array.from(room.players.values()).some((p) => p.connected);
      if ((hostGoneFor > ttlMs && !anyoneConnected) || hostGoneFor > abandonMs) {
        this.rooms.delete(code);
        for (const p of room.players.values()) this.bindings.delete(p.socketId);
        for (const t of room.tvReceivers.values()) this.bindings.delete(t.socketId);
        removed.push(room);
      }
    }
    return removed;
  }

  getBinding(socketId: string): SocketBinding | undefined {
    return this.bindings.get(socketId);
  }

  getRoom(roomCode: string): ManagedRoom | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  toPublicRoomState(room: ManagedRoom): RoomState {
    const players: PlayerInfo[] = Array.from(room.players.values())
      .map(({ socketId: _s, ...rest }) => rest)
      .sort((a, b) => a.slot - b.slot);

    const tvReceivers: TvReceiverInfo[] = Array.from(
      room.tvReceivers.values(),
    ).map(({ socketId: _s, ...rest }) => rest);

    return {
      roomCode: room.roomCode,
      hostConnected: room.hostConnected,
      defaultLayout: room.defaultLayout,
      tvStreamActive: room.tvStreamActive,
      activeGame: room.activeGame,
      players,
      tvReceivers,
    };
  }
}

function sanitizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : undefined;
}
