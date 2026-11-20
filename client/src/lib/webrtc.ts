import {
  ControllerInputState,
  RtcSignalPayload,
  TransportMode,
} from '@couch-emu/shared';
import { WsClient } from './wsClient';
import { webAudioTap } from './audioTap';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  bundlePolicy: 'max-bundle',
};

type SignalPurpose = 'controller' | 'tv-stream';
type WireCandidate = Extract<
  RtcSignalPayload,
  { type: 'ice-candidate' }
>['candidate'];

/** A peer that goes `disconnected` this long without recovering is torn down. */
const DISCONNECT_GRACE_MS = 5000;
/** Max ICE candidates buffered for a peer whose remote description is pending. */
const MAX_PENDING_CANDIDATES = 64;
/** Sequence gap that we treat as a sender restart rather than reordering. */
const SEQ_RESET_GAP = 1000;
/** Silence after which any seq is accepted again (phone reloaded, etc.). */
const SEQ_RESYNC_IDLE_MS = 1500;

function hasRtc(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}

function toWireCandidate(c: RTCIceCandidate): WireCandidate {
  return {
    candidate: c.candidate,
    sdpMid: c.sdpMid,
    sdpMLineIndex: c.sdpMLineIndex,
  };
}

/**
 * Validates an untrusted controller frame. Returns null when the payload is
 * malformed so a bad phone can never poison the virtual gamepad state.
 */
export function parseControllerFrame(raw: unknown): ControllerInputState | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const s = data as Partial<ControllerInputState>;
  if (typeof s.seq !== 'number' || !Number.isFinite(s.seq)) return null;
  if (typeof s.buttonsMask !== 'number' || !Number.isFinite(s.buttonsMask)) {
    return null;
  }
  if (!Array.isArray(s.axes)) return null;
  return s as ControllerInputState;
}

/** Shared seq gate: drops duplicates & reordered frames, tolerates restarts. */
class SeqGate {
  private lastSeq = -Infinity;
  private lastAt = 0;

  accept(seq: number): boolean {
    const now = performance.now();
    const idle = now - this.lastAt > SEQ_RESYNC_IDLE_MS;
    if (seq <= this.lastSeq && !idle && this.lastSeq - seq < SEQ_RESET_GAP) {
      return false;
    }
    this.lastSeq = seq;
    this.lastAt = now;
    return true;
  }
}

/**
 * Thin wrapper over RTCPeerConnection that gets the boring-but-critical
 * signaling details right:
 * - remote ICE candidates that arrive before the remote description are queued
 *   and flushed once it is applied (otherwise addIceCandidate throws and the
 *   candidate is silently lost)
 * - local ICE candidates are held until our own offer/answer has been sent so
 *   the far side never sees a candidate before the description
 * - every event handler is detached on close so a stale peer can never mutate
 *   state that now belongs to its replacement
 */
class PeerLink {
  readonly pc: RTCPeerConnection;
  closed = false;
  private pendingRemote: RTCIceCandidateInit[] = [];
  private pendingLocal: WireCandidate[] = [];
  private descriptionSent = false;
  private disconnectTimer: number | null = null;

  constructor(
    private sendCandidate: (c: WireCandidate) => void,
    private onDead: (link: PeerLink) => void,
    private onState?: (state: RTCPeerConnectionState) => void,
  ) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;

    pc.onicecandidate = (evt) => {
      if (this.closed || !evt.candidate || !evt.candidate.candidate) return;
      const wire = toWireCandidate(evt.candidate);
      if (this.descriptionSent) this.sendCandidate(wire);
      else this.pendingLocal.push(wire);
    };

    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      const state = pc.connectionState;
      this.onState?.(state);
      if (state === 'connected') {
        this.clearDisconnectTimer();
      } else if (state === 'disconnected') {
        // Transient Wi-Fi blips often recover on their own; give ICE a moment.
        if (this.disconnectTimer === null) {
          this.disconnectTimer = window.setTimeout(() => {
            this.disconnectTimer = null;
            if (!this.closed && pc.connectionState !== 'connected') {
              this.onDead(this);
            }
          }, DISCONNECT_GRACE_MS);
        }
      } else if (state === 'failed' || state === 'closed') {
        this.onDead(this);
      }
    };
  }

  /** Call right after the local offer/answer went out over signaling. */
  markDescriptionSent(): void {
    this.descriptionSent = true;
    const queued = this.pendingLocal;
    this.pendingLocal = [];
    for (const c of queued) this.sendCandidate(c);
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(desc);
    if (this.closed) return;
    const queued = this.pendingRemote;
    this.pendingRemote = [];
    for (const c of queued) {
      await this.pc.addIceCandidate(c).catch(() => {});
    }
  }

  async addRemoteCandidate(candidate: WireCandidate): Promise<void> {
    if (this.closed) return;
    const init: RTCIceCandidateInit = {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    };
    if (!this.pc.remoteDescription) {
      if (this.pendingRemote.length < MAX_PENDING_CANDIDATES) {
        this.pendingRemote.push(init);
      }
      return;
    }
    await this.pc.addIceCandidate(init).catch(() => {});
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer !== null) {
      window.clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearDisconnectTimer();
    const pc = this.pc;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.ondatachannel = null;
    pc.ontrack = null;
    try {
      pc.close();
    } catch {
      // ignore
    }
    this.pendingLocal = [];
    this.pendingRemote = [];
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  HOST                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

interface ControllerPeer {
  link: PeerLink;
  channel: RTCDataChannel | null;
  gate: SeqGate;
}

interface TvPeer {
  link: PeerLink;
  videoSender: RTCRtpSender;
  audioSender: RTCRtpSender;
}

const TV_RETRY_BASE_MS = 1500;
const TV_RETRY_MAX_MS = 12000;
/** ~10 Mbps: crisp 1080p60 game video on a home LAN without starving Wi-Fi. */
const TV_MAX_BITRATE = 10_000_000;

export class HostWebRtcManager {
  private controllerPeers = new Map<string, ControllerPeer>();
  private tvPeers = new Map<string, TvPeer>();
  private knownTvIds = new Set<string>();
  private tvRetryTimers = new Map<string, number>();
  private tvRetryCounts = new Map<string, number>();

  private activeCanvas: HTMLCanvasElement | null = null;
  private capturedCanvas: HTMLCanvasElement | null = null;
  /** Canvas capture track we own (stopped when replaced). */
  private videoTrack: MediaStreamTrack | null = null;
  /** Stable msid stream so the TV sees one stream carrying video + audio. */
  private outStream: MediaStream | null = null;
  private streamingEnabled = false;
  private disposed = false;
  private unsubWs: (() => void) | null = null;
  /**
   * Tiny host->phone heartbeat on each input channel. A host on Wi-Fi that only
   * receives can doze in power-save, and the access point then buffers incoming
   * input until the next beacon (up to ~100 ms). Sending a byte every 40 ms
   * keeps the host's radio awake too. Phones ignore these frames.
   */
  private heartbeatTimer: number | null = null;

  constructor(
    private ws: WsClient,
    private onControllerInput: (
      playerId: string,
      state: ControllerInputState,
    ) => void,
  ) {
    // Host WS reconnects create a new socket on the server, which resets
    // tvStreamActive. Re-assert the cast state once the room is re-bound and
    // re-offer any TV peer that isn't healthy.
    this.unsubWs = ws.onMessage((msg) => {
      if (this.disposed) return;
      if (msg.type === 'room:state' || msg.type === 'host:created') {
        // Players get a new id on every rejoin; drop peers for ids that left.
        this.pruneControllerPeers(msg.room.players.map((p) => p.id));
      }
      if (msg.type !== 'host:created') return;
      if (this.streamingEnabled) {
        this.ws.send({ type: 'host:tv_stream_ready', active: true });
        for (const [tvId, peer] of this.tvPeers) {
          if (peer.link.pc.connectionState !== 'connected') {
            this.connectTvReceiver(tvId);
          }
        }
      }
    });
  }

  /* ── Canvas / stream management ───────────────────────────────────────── */

  setActiveCanvas(canvas: HTMLCanvasElement | null): void {
    if (this.disposed) return;
    this.activeCanvas = canvas;
    if (this.streamingEnabled) this.refreshVideoTrack();
  }

  setStreamingEnabled(enabled: boolean): void {
    if (this.disposed) return;
    const changed = this.streamingEnabled !== enabled;
    this.streamingEnabled = enabled;
    this.ws.send({ type: 'host:tv_stream_ready', active: enabled });
    if (!changed) return;
    if (enabled) {
      this.refreshVideoTrack();
      for (const id of this.knownTvIds) {
        if (!this.tvPeers.has(id)) this.connectTvReceiver(id);
      }
    } else {
      this.stopStream();
    }
  }

  private getOutStream(): MediaStream {
    if (!this.outStream) this.outStream = new MediaStream();
    return this.outStream;
  }

  /**
   * (Re)captures the active canvas if needed and hot-swaps the track on every
   * TV sender via replaceTrack — no SDP renegotiation is ever required because
   * each TV peer is created with fixed video + audio transceivers.
   */
  private refreshVideoTrack(): void {
    const canvas = this.activeCanvas;
    const current = this.videoTrack;
    if (
      canvas &&
      canvas === this.capturedCanvas &&
      current &&
      current.readyState === 'live'
    ) {
      return;
    }

    let next: MediaStreamTrack | null = null;
    if (canvas && typeof canvas.captureStream === 'function') {
      try {
        next = canvas.captureStream(60).getVideoTracks()[0] ?? null;
      } catch {
        next = null; // tainted / detached canvas
      }
    }
    if (next) {
      try {
        next.contentHint = 'motion';
      } catch {
        // ignore
      }
      next.addEventListener('ended', () => {
        if (this.videoTrack === next && this.streamingEnabled) {
          this.videoTrack = null;
          this.capturedCanvas = null;
          this.refreshVideoTrack();
        }
      });
    }

    this.videoTrack = next;
    this.capturedCanvas = next ? canvas : null;

    const swaps: Promise<unknown>[] = [];
    for (const peer of this.tvPeers.values()) {
      swaps.push(peer.videoSender.replaceTrack(next).catch(() => {}));
    }
    if (current && current !== next) {
      // Stop the old capture only after senders moved off it (avoids a black
      // frame flash on the TV between canvases).
      void Promise.allSettled(swaps).then(() => current.stop());
    }
  }

  private currentAudioTrack(): MediaStreamTrack | null {
    return webAudioTap.getAudioTracks()[0] ?? null;
  }

  private stopStream(): void {
    for (const id of Array.from(this.tvPeers.keys())) {
      this.closeTvPeer(id);
    }
    for (const t of this.tvRetryTimers.values()) window.clearTimeout(t);
    this.tvRetryTimers.clear();
    this.tvRetryCounts.clear();
    if (this.videoTrack) {
      this.videoTrack.stop();
      this.videoTrack = null;
    }
    this.capturedCanvas = null;
    // Audio track belongs to webAudioTap — never stop it.
  }

  /* ── TV receivers ─────────────────────────────────────────────────────── */

  syncTvReceivers(tvIds: string[]): void {
    if (this.disposed) return;
    this.knownTvIds = new Set(tvIds);
    for (const id of Array.from(this.tvPeers.keys())) {
      if (!this.knownTvIds.has(id)) this.closeTvPeer(id);
    }
    for (const [id, timer] of this.tvRetryTimers) {
      if (!this.knownTvIds.has(id)) {
        window.clearTimeout(timer);
        this.tvRetryTimers.delete(id);
        this.tvRetryCounts.delete(id);
      }
    }
    if (!this.streamingEnabled) return;
    for (const id of tvIds) {
      const peer = this.tvPeers.get(id);
      const state = peer?.link.pc.connectionState;
      if (!peer || state === 'failed' || state === 'closed') {
        this.connectTvReceiver(id);
      }
    }
  }

  private closeTvPeer(tvId: string): void {
    const peer = this.tvPeers.get(tvId);
    if (!peer) return;
    this.tvPeers.delete(tvId);
    peer.link.close();
  }

  private scheduleTvRetry(tvId: string): void {
    if (this.disposed || !this.streamingEnabled || !this.knownTvIds.has(tvId)) {
      return;
    }
    if (this.tvRetryTimers.has(tvId)) return;
    const attempt = (this.tvRetryCounts.get(tvId) ?? 0) + 1;
    this.tvRetryCounts.set(tvId, attempt);
    const delay = Math.min(TV_RETRY_MAX_MS, TV_RETRY_BASE_MS * 2 ** (attempt - 1));
    const timer = window.setTimeout(() => {
      this.tvRetryTimers.delete(tvId);
      if (this.streamingEnabled && this.knownTvIds.has(tvId)) {
        this.connectTvReceiver(tvId);
      }
    }, delay);
    this.tvRetryTimers.set(tvId, timer);
  }

  /** Creates (or recreates) the outbound video+audio peer for a TV. */
  connectTvReceiver(tvId: string): void {
    if (this.disposed || !this.streamingEnabled || !hasRtc()) return;
    this.closeTvPeer(tvId);
    this.refreshVideoTrack();

    let link: PeerLink;
    try {
      link = new PeerLink(
        (candidate) =>
          this.ws.send({
            type: 'rtc:signal',
            targetId: tvId,
            signal: { type: 'ice-candidate', purpose: 'tv-stream', candidate },
          }),
        (dead) => {
          if (this.tvPeers.get(tvId)?.link !== dead) return;
          this.closeTvPeer(tvId);
          this.scheduleTvRetry(tvId);
        },
        (state) => {
          if (state === 'connected') this.tvRetryCounts.delete(tvId);
        },
      );
    } catch {
      return;
    }

    const stream = this.getOutStream();
    const videoTx = link.pc.addTransceiver(this.videoTrack ?? 'video', {
      direction: 'sendonly',
      streams: [stream],
      sendEncodings: [{ maxBitrate: TV_MAX_BITRATE, maxFramerate: 60 }],
    });
    const audioTx = link.pc.addTransceiver(this.currentAudioTrack() ?? 'audio', {
      direction: 'sendonly',
      streams: [stream],
    });

    const peer: TvPeer = {
      link,
      videoSender: videoTx.sender,
      audioSender: audioTx.sender,
    };
    this.tvPeers.set(tvId, peer);
    void this.negotiateTv(tvId, peer);
  }

  private async negotiateTv(tvId: string, peer: TvPeer): Promise<void> {
    const { link } = peer;
    try {
      const offer = await link.pc.createOffer();
      if (link.closed) return;
      await link.pc.setLocalDescription(offer);
      if (link.closed) return;
      const sdp = link.pc.localDescription?.sdp ?? offer.sdp;
      if (!sdp) throw new Error('empty offer');
      this.ws.send({
        type: 'rtc:signal',
        targetId: tvId,
        signal: { type: 'offer', sdp, purpose: 'tv-stream' },
      });
      link.markDescriptionSent();
      this.tuneVideoSender(peer.videoSender);
    } catch {
      if (this.tvPeers.get(tvId) === peer) {
        this.closeTvPeer(tvId);
        this.scheduleTvRetry(tvId);
      }
    }
  }

  /**
   * Encoder tuning for a game canvas of up to 1920x1080@60: cap bitrate at a
   * LAN-friendly ceiling, never upscale, and favor smooth motion over
   * resolution when bandwidth dips. The canvas backing store may be resized at
   * runtime (ResizeObserver) — the capture track simply starts producing
   * frames at the new size and the encoder adapts without renegotiation.
   */
  private tuneVideoSender(sender: RTCRtpSender): void {
    try {
      const params = sender.getParameters() as RTCRtpSendParameters & {
        degradationPreference?: string;
      };
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      for (const enc of params.encodings) {
        enc.maxBitrate = TV_MAX_BITRATE;
        enc.maxFramerate = 60;
        enc.scaleResolutionDownBy = 1;
      }
      params.degradationPreference = 'maintain-framerate';
      void sender.setParameters(params).catch(() => {});
    } catch {
      // ignore — optional optimisation
    }
  }

  /* ── Signaling entry point ────────────────────────────────────────────── */

  async handleSignal(fromId: string, signal: RtcSignalPayload): Promise<void> {
    if (this.disposed || !hasRtc()) return;
    if (signal.purpose === 'controller') {
      await this.handleControllerSignal(fromId, signal);
    } else if (signal.purpose === 'tv-stream') {
      const peer = this.tvPeers.get(fromId);
      if (!peer) return;
      if (signal.type === 'answer') {
        if (peer.link.pc.signalingState !== 'have-local-offer') return;
        try {
          await peer.link.setRemoteDescription({
            type: 'answer',
            sdp: signal.sdp,
          });
        } catch {
          if (this.tvPeers.get(fromId) === peer) {
            this.closeTvPeer(fromId);
            this.scheduleTvRetry(fromId);
          }
        }
      } else if (signal.type === 'ice-candidate') {
        await peer.link.addRemoteCandidate(signal.candidate);
      }
    }
  }

  /* ── Controllers (phones offer, host answers) ─────────────────────────── */

  private async handleControllerSignal(
    fromId: string,
    signal: RtcSignalPayload,
  ): Promise<void> {
    if (signal.type === 'ice-candidate') {
      await this.controllerPeers.get(fromId)?.link.addRemoteCandidate(
        signal.candidate,
      );
      return;
    }
    if (signal.type !== 'offer') return;

    // A fresh offer always means the phone tore down its old connection.
    this.closeControllerPeer(fromId);

    let link: PeerLink;
    try {
      link = new PeerLink(
        (candidate) =>
          this.ws.send({
            type: 'rtc:signal',
            targetId: fromId,
            signal: { type: 'ice-candidate', purpose: 'controller', candidate },
          }),
        (dead) => {
          if (this.controllerPeers.get(fromId)?.link === dead) {
            this.closeControllerPeer(fromId);
          }
        },
      );
    } catch {
      return;
    }

    const peer: ControllerPeer = { link, channel: null, gate: new SeqGate() };
    this.controllerPeers.set(fromId, peer);

    link.pc.ondatachannel = (evt) => {
      if (link.closed) return;
      const channel = evt.channel;
      peer.channel = channel;
      this.ensureHeartbeat();
      channel.onmessage = (msgEvt) => {
        if (link.closed) return;
        const state = parseControllerFrame(msgEvt.data);
        if (!state || !peer.gate.accept(state.seq)) return;
        this.onControllerInput(fromId, state);
      };
      channel.onclose = () => {
        // Phone closed its input channel (left, reloaded, or fell back to WS).
        if (this.controllerPeers.get(fromId) === peer) {
          this.closeControllerPeer(fromId);
        }
      };
    };

    try {
      await link.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      if (link.closed) return;
      const answer = await link.pc.createAnswer();
      if (link.closed) return;
      await link.pc.setLocalDescription(answer);
      if (link.closed) return;
      const sdp = link.pc.localDescription?.sdp ?? answer.sdp;
      if (!sdp) throw new Error('empty answer');
      this.ws.send({
        type: 'rtc:signal',
        targetId: fromId,
        signal: { type: 'answer', sdp, purpose: 'controller' },
      });
      link.markDescriptionSent();
    } catch {
      if (this.controllerPeers.get(fromId) === peer) {
        this.closeControllerPeer(fromId);
      }
    }
  }

  private pruneControllerPeers(activeIds: string[]): void {
    if (this.controllerPeers.size === 0) return;
    const active = new Set(activeIds);
    for (const id of Array.from(this.controllerPeers.keys())) {
      if (!active.has(id)) this.closeControllerPeer(id);
    }
  }

  private closeControllerPeer(id: string): void {
    const peer = this.controllerPeers.get(id);
    if (!peer) return;
    this.controllerPeers.delete(id);
    if (peer.channel) {
      peer.channel.onmessage = null;
      peer.channel.onclose = null;
      try {
        peer.channel.close();
      } catch {
        // ignore
      }
    }
    peer.link.close();
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer !== null) return;
    this.heartbeatTimer = window.setInterval(() => {
      let any = false;
      for (const peer of this.controllerPeers.values()) {
        const ch = peer.channel;
        if (!ch || ch.readyState !== 'open') continue;
        any = true;
        if (ch.bufferedAmount > 1024) continue;
        try {
          ch.send('h');
        } catch {
          // ignore
        }
      }
      if (!any && this.controllerPeers.size === 0 && this.heartbeatTimer !== null) {
        window.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }, 40);
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.unsubWs?.();
    this.unsubWs = null;
    for (const id of Array.from(this.controllerPeers.keys())) {
      this.closeControllerPeer(id);
    }
    this.stopStream();
    this.knownTvIds.clear();
    this.activeCanvas = null;
    this.outStream = null;
    this.disposed = true;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  PLAYER (phone)                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

const PLAYER_CONNECT_TIMEOUT_MS = 8000;
const PLAYER_MAX_RETRIES = 3;
/** Redundant resends of the latest frame to survive lost unreliable packets. */
const REDUNDANT_RESEND_MS = [40, 120];
const KEEPALIVE_MS = 1000;
const MAX_BUFFERED_BYTES = 16 * 1024;

export class PlayerWebRtcClient {
  private link: PeerLink | null = null;
  private channel: RTCDataChannel | null = null;
  private connectTimer: number | null = null;
  private retryTimer: number | null = null;
  private retries = 0;
  private resendTimers: number[] = [];
  private keepaliveTimer: number | null = null;
  private lastFrame: string | null = null;
  public transport: TransportMode = 'ws';

  constructor(
    private ws: WsClient,
    private onTransportChange: (mode: TransportMode) => void,
  ) {}

  private setTransport(mode: TransportMode, notifyServer: boolean): void {
    if (this.transport === mode) return;
    this.transport = mode;
    this.onTransportChange(mode);
    if (notifyServer) {
      this.ws.send({ type: 'player:transport_changed', transport: mode });
    }
  }

  async connectToHost(): Promise<void> {
    this.teardown(false);
    this.clearRetry();
    if (!hasRtc()) return;
    await this.openPeer();
  }

  private async openPeer(): Promise<void> {
    let link: PeerLink;
    try {
      link = new PeerLink(
        (candidate) =>
          this.ws.send({
            type: 'rtc:signal',
            targetId: 'HOST',
            signal: { type: 'ice-candidate', purpose: 'controller', candidate },
          }),
        (dead) => {
          if (this.link === dead) this.fail();
        },
      );
    } catch {
      return;
    }
    this.link = link;

    const channel = link.pc.createDataChannel('controller', {
      ordered: false,
      maxRetransmits: 0,
    });
    this.channel = channel;

    channel.onopen = () => {
      if (this.channel !== channel) return;
      this.clearConnectTimer();
      this.retries = 0;
      this.setTransport('webrtc', true);
      this.startKeepalive();
    };
    channel.onclose = () => {
      if (this.channel !== channel) return;
      this.fail();
    };
    channel.onerror = () => {
      if (this.channel !== channel) return;
      this.fail();
    };

    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = null;
      if (this.link === link && channel.readyState !== 'open') this.fail();
    }, PLAYER_CONNECT_TIMEOUT_MS);

    try {
      const offer = await link.pc.createOffer();
      if (link.closed) return;
      await link.pc.setLocalDescription(offer);
      if (link.closed) return;
      const sdp = link.pc.localDescription?.sdp ?? offer.sdp;
      if (!sdp) throw new Error('empty offer');
      this.ws.send({
        type: 'rtc:signal',
        targetId: 'HOST',
        signal: { type: 'offer', sdp, purpose: 'controller' },
      });
      link.markDescriptionSent();
    } catch {
      if (this.link === link) this.fail();
    }
  }

  /** Falls back to WebSocket and schedules a bounded retry. */
  private fail(): void {
    this.teardown(true);
    if (this.retries >= PLAYER_MAX_RETRIES || this.retryTimer !== null) return;
    const delay = 2000 * 2 ** this.retries;
    this.retries += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.ws.connected) void this.openPeer();
    }, delay);
  }

  async handleSignal(signal: RtcSignalPayload): Promise<void> {
    const link = this.link;
    if (!link || signal.purpose !== 'controller') return;
    if (signal.type === 'answer') {
      if (link.pc.signalingState !== 'have-local-offer') return;
      try {
        await link.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      } catch {
        if (this.link === link) this.fail();
      }
    } else if (signal.type === 'ice-candidate') {
      await link.addRemoteCandidate(signal.candidate);
    }
  }

  sendInput(state: ControllerInputState): void {
    const channel = this.channel;
    if (channel?.readyState === 'open') {
      try {
        const frame = JSON.stringify(state);
        this.lastFrame = frame;
        // Under congestion skip the send; redundancy below still delivers the
        // newest state, which is all that matters for input.
        if (channel.bufferedAmount < MAX_BUFFERED_BYTES) channel.send(frame);
        this.scheduleRedundantResends();
        return;
      } catch {
        // Fall through to WebSocket
      }
    }
    this.ws.send({ type: 'input:state', state });
  }

  /**
   * The input channel is unreliable (maxRetransmits: 0) for latency, so a
   * lost "button released" frame would leave a button stuck. Re-send the
   * latest frame a couple of times; the host drops duplicates by seq.
   */
  private scheduleRedundantResends(): void {
    for (const t of this.resendTimers) window.clearTimeout(t);
    this.resendTimers = REDUNDANT_RESEND_MS.map((ms) =>
      window.setTimeout(() => this.resendLast(), ms),
    );
  }

  private resendLast(): void {
    const channel = this.channel;
    if (!this.lastFrame || channel?.readyState !== 'open') return;
    if (channel.bufferedAmount >= MAX_BUFFERED_BYTES) return;
    try {
      channel.send(this.lastFrame);
    } catch {
      // ignore
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = window.setInterval(() => this.resendLast(), KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      window.clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    for (const t of this.resendTimers) window.clearTimeout(t);
    this.resendTimers = [];
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retries = 0;
  }

  private teardown(notifyServer: boolean): void {
    this.clearConnectTimer();
    this.stopKeepalive();
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      try {
        channel.close();
      } catch {
        // ignore
      }
    }
    this.link?.close();
    this.link = null;
    this.lastFrame = null;
    this.setTransport('ws', notifyServer);
  }

  close(): void {
    this.clearRetry();
    this.teardown(false);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  TV RECEIVER                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export type TvLinkState = 'idle' | RTCPeerConnectionState;

export class TvWebRtcClient {
  private link: PeerLink | null = null;
  private hostId: string | null = null;
  /** Candidates that raced ahead of their offer, keyed by sender. */
  private earlyCandidates = new Map<string, WireCandidate[]>();

  constructor(
    private ws: WsClient,
    private onStream: (stream: MediaStream) => void,
    private onState?: (state: TvLinkState) => void,
  ) {}

  async handleSignal(fromId: string, signal: RtcSignalPayload): Promise<void> {
    if (signal.purpose !== 'tv-stream' || !hasRtc()) return;

    if (signal.type === 'ice-candidate') {
      if (this.link && this.hostId === fromId) {
        await this.link.addRemoteCandidate(signal.candidate);
      } else {
        const list = this.earlyCandidates.get(fromId) ?? [];
        if (list.length < MAX_PENDING_CANDIDATES) list.push(signal.candidate);
        this.earlyCandidates.set(fromId, list);
      }
      return;
    }
    if (signal.type !== 'offer') return;

    // Host always sends a brand-new offer for a brand-new peer.
    this.closeLink();
    this.hostId = fromId;

    let link: PeerLink;
    try {
      link = new PeerLink(
        (candidate) => {
          if (this.hostId) {
            this.ws.send({
              type: 'rtc:signal',
              targetId: this.hostId,
              signal: { type: 'ice-candidate', purpose: 'tv-stream', candidate },
            });
          }
        },
        (dead) => {
          if (this.link === dead) {
            // The host notices too and re-offers with backoff.
            this.closeLink();
            this.onState?.('failed');
          }
        },
        (state) => {
          if (this.link === link) this.onState?.(state);
        },
      );
    } catch {
      return;
    }
    this.link = link;
    this.onState?.('new');

    let fallbackStream: MediaStream | null = null;
    link.pc.ontrack = (evt) => {
      if (link.closed) return;
      // Minimize receive-side buffering for couch-latency gameplay.
      const receiver = evt.receiver as unknown as Record<string, unknown>;
      try {
        if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0;
        else receiver.playoutDelayHint = 0;
      } catch {
        // ignore
      }
      if (evt.streams[0]) {
        this.onStream(evt.streams[0]);
      } else {
        fallbackStream ??= new MediaStream();
        fallbackStream.addTrack(evt.track);
        this.onStream(fallbackStream);
      }
    };

    const early = this.earlyCandidates.get(fromId) ?? [];
    this.earlyCandidates.clear();

    try {
      await link.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      if (link.closed) return;
      for (const c of early) await link.addRemoteCandidate(c);
      const answer = await link.pc.createAnswer();
      if (link.closed) return;
      await link.pc.setLocalDescription(answer);
      if (link.closed) return;
      const sdp = link.pc.localDescription?.sdp ?? answer.sdp;
      if (!sdp) throw new Error('empty answer');
      this.ws.send({
        type: 'rtc:signal',
        targetId: fromId,
        signal: { type: 'answer', sdp, purpose: 'tv-stream' },
      });
      link.markDescriptionSent();
    } catch {
      if (this.link === link) {
        this.closeLink();
        this.onState?.('failed');
      }
    }
  }

  private closeLink(): void {
    this.link?.close();
    this.link = null;
  }

  close(): void {
    this.closeLink();
    this.hostId = null;
    this.earlyCandidates.clear();
    this.onState?.('idle');
  }
}
