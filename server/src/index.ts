import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  ClientToServerMessage,
  ServerToClientMessage,
  isControllerLayoutId,
  sanitizeInputState,
} from '@couch-emu/shared';
import { getLocalNetworkInfo } from './lan.js';
import { ManagedRoom, RoomManager } from './roomManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json());

const roomManager = new RoomManager();
const sockets = new Map<string, WebSocket>();

/** Per-socket heartbeat bookkeeping (ws-level ping/pong, invisible to clients). */
interface SocketHealth {
  alive: boolean;
  pingSentAt: number;
}
const health = new Map<string, SocketHealth>();
const HEARTBEAT_MS = 10_000;
const MAX_MESSAGE_BYTES = 32 * 1024;

function isSocketAlive(socketId: string): boolean {
  return sockets.get(socketId)?.readyState === WebSocket.OPEN;
}

function send(ws: WebSocket | undefined, msg: ServerToClientMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function sendRaw(ws: WebSocket | undefined, data: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(data);
}

function broadcastRoomState(room: ManagedRoom): void {
  // Serialize once, fan out to every member of the room.
  const data = JSON.stringify({
    type: 'room:state',
    room: roomManager.toPublicRoomState(room),
  } satisfies ServerToClientMessage);
  if (room.hostId) {
    sendRaw(sockets.get(room.hostId), data);
  }
  for (const player of room.players.values()) {
    if (player.connected) sendRaw(sockets.get(player.socketId), data);
  }
  for (const tv of room.tvReceivers.values()) {
    sendRaw(sockets.get(tv.socketId), data);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    rooms: roomManager.roomCount,
    sockets: sockets.size,
  });
});

app.get('/api/network-info', (req, res) => {
  const net = getLocalNetworkInfo();
  const clientPort = process.env.CLIENT_PORT || '5173';
  const isProd = process.env.NODE_ENV === 'production';
  const port = isProd ? String(PORT) : clientPort;
  const hostHeader = req.headers.host;

  res.json({
    ...net,
    suggestedPort: Number(port),
    suggestedOrigin: net.primaryLanIp
      ? `http://${net.primaryLanIp}:${port}`
      : hostHeader
        ? `http://${hostHeader}`
        : `http://localhost:${port}`,
  });
});

// Serve built client in production if present
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('/*splat', (_req, res) => {
    res.sendFile('index.html', { root: clientDistPath });
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: MAX_MESSAGE_BYTES,
  // Input packets are tiny and latency-critical; compression only adds delay.
  perMessageDeflate: false,
});

wss.on('connection', (ws) => {
  const socketId = crypto.randomUUID();
  sockets.set(socketId, ws);
  health.set(socketId, { alive: true, pingSentAt: 0 });
  // Disable Nagle so small input frames go out immediately.
  (ws as unknown as { _socket?: { setNoDelay?: (v: boolean) => void } })._socket?.setNoDelay?.(true);

  ws.on('pong', () => {
    const h = health.get(socketId);
    if (!h) return;
    h.alive = true;
    if (h.pingSentAt > 0) {
      const rtt = Date.now() - h.pingSentAt;
      const room = roomManager.setPlayerLatency(socketId, rtt);
      if (room) broadcastRoomState(room);
    }
  });

  ws.on('message', (rawData) => {
    let msg: ClientToServerMessage;
    try {
      msg = JSON.parse(rawData.toString()) as ClientToServerMessage;
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
        throw new Error('bad shape');
      }
    } catch {
      send(ws, {
        type: 'error',
        code: 'INVALID_JSON',
        message: 'Malformed message payload.',
      });
      return;
    }

    switch (msg.type) {
      case 'ping': {
        send(ws, { type: 'pong', ts: msg.ts, serverTs: Date.now() });
        break;
      }

      case 'host:create': {
        const { room, hostId } = roomManager.createOrReclaimHostRoom(
          socketId,
          typeof msg.roomCode === 'string' ? msg.roomCode : undefined,
          isSocketAlive,
        );
        send(ws, {
          type: 'host:created',
          roomCode: room.roomCode,
          hostId,
          room: roomManager.toPublicRoomState(room),
        });
        broadcastRoomState(room);
        break;
      }

      case 'player:join': {
        const result = roomManager.joinPlayer(
          socketId,
          msg.roomCode,
          msg.name,
          msg.clientId,
          msg.color,
        );
        if (!result.ok) {
          send(ws, {
            type: 'error',
            code: result.code,
            message: result.message,
          });
          return;
        }
        if (result.replacedSocketId) {
          // Same phone opened a second connection: retire the stale one.
          const stale = sockets.get(result.replacedSocketId);
          send(stale, {
            type: 'kicked',
            reason: 'This controller reconnected from another tab.',
          });
          stale?.close(4001, 'superseded');
        }
        send(ws, {
          type: 'player:joined',
          playerId: result.player.id,
          slot: result.player.slot,
          room: roomManager.toPublicRoomState(result.room),
        });
        broadcastRoomState(result.room);
        break;
      }

      case 'player:leave': {
        const room = roomManager.leavePlayer(socketId);
        if (room) {
          broadcastRoomState(room);
        }
        break;
      }

      case 'tv:join': {
        const result = roomManager.joinTv(socketId, msg.roomCode);
        if (!result.ok) {
          send(ws, {
            type: 'error',
            code: result.code,
            message: result.message,
          });
          return;
        }
        send(ws, {
          type: 'tv:joined',
          tvId: result.tv.id,
          room: roomManager.toPublicRoomState(result.room),
        });
        broadcastRoomState(result.room);
        break;
      }

      case 'input:state': {
        const binding = roomManager.getBinding(socketId);
        if (!binding || binding.role !== 'player') return;
        const room = roomManager.getRoom(binding.roomCode);
        if (!room || !room.hostId) return;
        const player = room.players.get(socketId);
        if (!player) return;
        const state = sanitizeInputState(msg.state);
        if (!state) return;

        send(sockets.get(room.hostId), {
          type: 'input:remote',
          playerId: player.id,
          slot: player.slot,
          state,
        });
        break;
      }

      case 'player:transport_changed': {
        if (msg.transport !== 'ws' && msg.transport !== 'webrtc') return;
        const room = roomManager.setPlayerTransport(socketId, msg.transport);
        if (room) {
          broadcastRoomState(room);
        }
        break;
      }

      case 'host:set_layout': {
        const binding = roomManager.getBinding(socketId);
        if (!binding || binding.role !== 'host') return;
        if (!isControllerLayoutId(msg.layout)) return;
        const room = roomManager.setLayout(
          binding.roomCode,
          msg.layout,
          msg.playerId,
        );
        if (!room) return;
        if (msg.playerId) {
          const target = room.players.get(msg.playerId);
          send(target && sockets.get(target.socketId), {
            type: 'layout:changed',
            layout: msg.layout,
          });
        } else {
          for (const p of room.players.values()) {
            send(sockets.get(p.socketId), {
              type: 'layout:changed',
              layout: msg.layout,
            });
          }
        }
        broadcastRoomState(room);
        break;
      }

      case 'host:swap_slots': {
        const binding = roomManager.getBinding(socketId);
        if (!binding || binding.role !== 'host') return;
        const room = roomManager.swapSlots(
          binding.roomCode,
          msg.slotA,
          msg.slotB,
        );
        if (room) {
          broadcastRoomState(room);
        }
        break;
      }

      case 'host:kick_player': {
        const binding = roomManager.getBinding(socketId);
        if (!binding || binding.role !== 'host') return;
        const res = roomManager.kickPlayer(binding.roomCode, msg.playerId);
        if (!res) return;
        send(sockets.get(res.removed.socketId), {
          type: 'kicked',
          reason: 'Removed from room by host.',
        });
        broadcastRoomState(res.room);
        break;
      }

      case 'host:set_game': {
        const binding = roomManager.getBinding(socketId);
        if (!binding || binding.role !== 'host') return;
        if (!msg.activeGame || typeof msg.activeGame !== 'object') return;
        const room = roomManager.setGame(binding.roomCode, msg.activeGame);
        if (room) {
          broadcastRoomState(room);
        }
        break;
      }

      case 'host:tv_stream_ready': {
        const binding = roomManager.getBinding(socketId);
        if (!binding || binding.role !== 'host') return;
        const room = roomManager.setTvStreamActive(binding.roomCode, msg.active);
        if (room) {
          broadcastRoomState(room);
        }
        break;
      }

      case 'host:rumble': {
        const binding = roomManager.getBinding(socketId);
        if (!binding || binding.role !== 'host') return;
        const room = roomManager.getRoom(binding.roomCode);
        if (!room) return;
        const player = room.players.get(msg.playerId);
        if (!player) return;
        const durationMs = Number(msg.durationMs);
        const intensity = Number(msg.intensity);
        send(sockets.get(player.socketId), {
          type: 'rumble',
          durationMs: Number.isFinite(durationMs)
            ? Math.max(0, Math.min(2000, durationMs))
            : 100,
          intensity: Number.isFinite(intensity)
            ? Math.max(0, Math.min(1, intensity))
            : 0.7,
        });
        break;
      }

      case 'rtc:signal': {
        const binding = roomManager.getBinding(socketId);
        if (!binding || !msg.signal || typeof msg.targetId !== 'string') return;
        const room = roomManager.getRoom(binding.roomCode);
        if (!room) return;

        // Players/TVs may address the host via the 'HOST' alias. Every target
        // must belong to the sender's room.
        const resolvedTargetId =
          msg.targetId === 'HOST' ? room.hostId : msg.targetId;
        if (!resolvedTargetId || resolvedTargetId === socketId) return;
        const isMember =
          room.hostId === resolvedTargetId ||
          room.players.get(resolvedTargetId)?.connected === true ||
          room.tvReceivers.has(resolvedTargetId);
        if (!isMember) return;

        send(sockets.get(resolvedTargetId), {
          type: 'rtc:signal',
          fromId: socketId,
          fromRole: binding.role,
          signal: msg.signal,
        });
        break;
      }
    }
  });

  ws.on('error', () => {
    // 'close' always follows; swallow so a bad frame can't crash the process.
  });

  ws.on('close', () => {
    sockets.delete(socketId);
    health.delete(socketId);
    const detached = roomManager.detachSocket(socketId);
    if (detached?.room) {
      broadcastRoomState(detached.room);
    }
  });
});

// Heartbeat: phones that sleep or drop off Wi-Fi often never send a TCP FIN.
// Terminate sockets that miss a pong so their port enters the grace window.
setInterval(() => {
  const now = Date.now();
  for (const [id, ws] of sockets) {
    const h = health.get(id);
    if (!h) continue;
    if (!h.alive) {
      ws.terminate();
      continue;
    }
    h.alive = false;
    h.pingSentAt = now;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, HEARTBEAT_MS);

setInterval(() => {
  for (const room of roomManager.pruneDisconnectedPlayers()) {
    broadcastRoomState(room);
  }
  for (const room of roomManager.pruneExpiredRooms(120_000)) {
    for (const p of room.players.values()) {
      const ws = sockets.get(p.socketId);
      send(ws, { type: 'kicked', reason: 'The console closed this room.' });
    }
    for (const t of room.tvReceivers.values()) {
      send(sockets.get(t.socketId), {
        type: 'kicked',
        reason: 'The console closed this room.',
      });
    }
  }
}, 5_000);

server.listen(PORT, HOST, () => {
  const net = getLocalNetworkInfo();
  console.log(`[couch-emu] Server listening on http://${HOST}:${PORT}`);
  if (net.primaryLanIp) {
    console.log(
      `[couch-emu] LAN IP detected: ${net.primaryLanIp} (phones can connect over Wi-Fi)`,
    );
  }
});
