import {
  ClientToServerMessage,
  ServerToClientMessage,
} from '@couch-emu/shared';

type MessageListener = (msg: ServerToClientMessage) => void;
type StatusListener = (connected: boolean) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();
  private queue: ClientToServerMessage[] = [];
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private disposed = false;
  private attempt = 0;
  private lastPongAt = 0;
  private readonly onWake = () => {
    // Phones suspend sockets when the screen locks; reconnect the moment the
    // page is visible / back online instead of waiting out the backoff.
    if (document.visibilityState !== 'visible') return;
    if (!this.connected) {
      this.reconnectNow();
      return;
    }
    // A socket that survived a screen lock may be half-dead (no FIN ever
    // arrived). Probe it and recycle it if the server doesn't answer quickly.
    const probeAt = performance.now();
    this.send({ type: 'ping', ts: probeAt });
    window.setTimeout(() => {
      if (this.connected && this.lastPongAt < probeAt) this.forceReconnect();
    }, 2500);
  };
  public connected = false;
  public rttMs: number | null = null;

  constructor(private url = WsClient.defaultUrl()) {
    document.addEventListener('visibilitychange', this.onWake);
    window.addEventListener('online', this.onWake);
    this.connect();
  }

  private forceReconnect(): void {
    const ws = this.ws;
    if (!ws) return;
    // Detach first so the stale socket's close event can't double-schedule.
    this.ws = null;
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      // ignore
    }
    if (this.connected) {
      this.connected = false;
      this.rttMs = null;
      this.notifyStatus(false);
    }
    this.stopPing();
    this.reconnectNow();
  }

  private reconnectNow(): void {
    if (this.disposed) return;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  static defaultUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  private connect(): void {
    if (this.disposed) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.connected = true;
      this.notifyStatus(true);
      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        ws.send(JSON.stringify(msg));
      }
      this.startPing();
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(String(evt.data)) as ServerToClientMessage;
        if (msg.type === 'pong') {
          this.lastPongAt = performance.now();
          this.rttMs = Math.max(1, Math.round(this.lastPongAt - msg.ts));
        }
        for (const fn of this.listeners) {
          fn(msg);
        }
      } catch {
        // Ignore malformed packets
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      const wasConnected = this.connected;
      this.connected = false;
      this.rttMs = null;
      if (wasConnected) this.notifyStatus(false);
      this.stopPing();
      if (!this.disposed) {
        // Exponential backoff with jitter: 400ms → 5s cap.
        const base = Math.min(5000, 400 * 2 ** Math.min(this.attempt, 4));
        this.attempt++;
        const delay = base * (0.75 + Math.random() * 0.5);
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private startPing(): void {
    this.stopPing();
    this.lastPongAt = performance.now();
    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      // Three missed pongs: the link is dead even if the socket says open.
      if (performance.now() - this.lastPongAt > 10_000) {
        this.forceReconnect();
        return;
      }
      this.send({ type: 'ping', ts: performance.now() });
    }, 3000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private notifyStatus(connected: boolean): void {
    for (const fn of this.statusListeners) {
      fn(connected);
    }
  }

  send(msg: ClientToServerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      // Never queue time-sensitive traffic: input, pings, WebRTC signaling
      // (the peer it targets is gone after a reconnect) or transport flips.
      if (
        msg.type !== 'input:state' &&
        msg.type !== 'ping' &&
        msg.type !== 'rtc:signal' &&
        msg.type !== 'player:transport_changed'
      ) {
        this.queue.push(msg);
        if (this.queue.length > 50) this.queue.shift();
      }
    }
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.connected);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onWake);
    window.removeEventListener('online', this.onWake);
    this.stopPing();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
    this.statusListeners.clear();
  }
}
