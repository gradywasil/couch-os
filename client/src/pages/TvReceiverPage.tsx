import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { PlayerInfo, RoomState } from '@couch-emu/shared';
import {
  Maximize2,
  Minimize2,
  Power,
  Radio,
  Smartphone,
  Tv,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { WsClient } from '../lib/wsClient';
import { TvLinkState, TvWebRtcClient } from '../lib/webrtc';
import { playConfirmPop, playSwitchClack } from '../lib/uiSound';

interface TvReceiverPageProps {
  initialRoomCode?: string;
}

const JOIN_RETRY_MS = 4000;
const HUD_HIDE_MS = 3000;

/** Scoped keyframes for the TV receiver (prefixed to avoid collisions). */
const TV_STYLES = `
@keyframes tvrx-aurora-a { 0%,100% { transform: translate3d(-12%, -8%, 0) scale(1); } 50% { transform: translate3d(14%, 10%, 0) scale(1.18); } }
@keyframes tvrx-aurora-b { 0%,100% { transform: translate3d(10%, 12%, 0) scale(1.1); } 50% { transform: translate3d(-14%, -6%, 0) scale(0.92); } }
@keyframes tvrx-aurora-c { 0%,100% { transform: translate3d(0, 0, 0) scale(0.95); } 50% { transform: translate3d(8%, -14%, 0) scale(1.15); } }
@keyframes tvrx-sweep { 0% { transform: translateY(-30vh); } 100% { transform: translateY(130vh); } }
@keyframes tvrx-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-0.06em); } }
@keyframes tvrx-flip { 0% { transform: perspective(600px) rotateX(-95deg); opacity: 0; } 70% { transform: perspective(600px) rotateX(12deg); opacity: 1; } 100% { transform: perspective(600px) rotateX(0); opacity: 1; } }
@keyframes tvrx-dot { 0%,80%,100% { opacity: 0.2; } 40% { opacity: 1; } }
@keyframes tvrx-ring { 0% { transform: scale(0.8); opacity: 0.7; } 100% { transform: scale(2.4); opacity: 0; } }
@keyframes tvrx-fade-in { 0% { opacity: 0; transform: translateY(12px); } 100% { opacity: 1; transform: translateY(0); } }
.tvrx-anim-a { animation: tvrx-aurora-a 22s ease-in-out infinite; }
.tvrx-anim-b { animation: tvrx-aurora-b 28s ease-in-out infinite; }
.tvrx-anim-c { animation: tvrx-aurora-c 34s ease-in-out infinite; }
.tvrx-sweep { animation: tvrx-sweep 7s linear infinite; }
.tvrx-tile { animation: tvrx-flip 700ms cubic-bezier(0.34, 1.56, 0.64, 1) both, tvrx-float 4.5s ease-in-out infinite; }
.tvrx-dot { animation: tvrx-dot 1.4s ease-in-out infinite; }
.tvrx-ring { animation: tvrx-ring 2.2s cubic-bezier(0.22, 1, 0.36, 1) infinite; }
.tvrx-enter { animation: tvrx-fade-in 600ms cubic-bezier(0.22, 1, 0.36, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .tvrx-anim-a, .tvrx-anim-b, .tvrx-anim-c, .tvrx-sweep, .tvrx-tile, .tvrx-dot, .tvrx-ring, .tvrx-enter { animation: none !important; }
}
`;

const StandbyOscilloscope: React.FC<{
  statusLabel: string;
  rightLabel: string;
  accentColor?: string;
}> = ({ statusLabel, rightLabel, accentColor = '#B5FF2A' }) => (
  <div className="crt-well rounded-2xl px-3 py-2.5 relative overflow-hidden">
    <svg
      viewBox="0 0 600 54"
      className="w-full h-12 block"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1="0" y1="27" x2="600" y2="27" stroke="rgba(181, 255, 42, 0.14)" strokeWidth="1" />
      {[60, 120, 180, 240, 300, 360, 420, 480, 540].map((x) => (
        <line key={x} x1={x} y1="8" x2={x} y2="46" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1" />
      ))}
      <path
        d="M0 27 Q 25 14, 50 27 T 100 27 T 150 27 T 200 27 T 250 27 T 300 27 T 350 27 T 400 27 T 450 27 T 500 27 T 550 27 T 600 27"
        fill="none"
        stroke="rgba(255, 59, 92, 0.45)"
        strokeWidth="1.4"
        strokeDasharray="10 6"
      >
        <animate attributeName="stroke-dashoffset" from="0" to="64" dur="2.8s" repeatCount="indefinite" />
      </path>
      <path
        d="M0 27 Q 18 7, 37.5 27 T 75 27 T 112.5 27 T 150 27 T 187.5 27 T 225 27 T 262.5 27 T 300 27 T 337.5 27 T 375 27 T 412.5 27 T 450 27 T 487.5 27 T 525 27 T 562.5 27 T 600 27"
        fill="none"
        stroke={accentColor}
        strokeWidth="2.2"
        strokeDasharray="18 8"
        style={{ filter: `drop-shadow(0 0 6px ${accentColor}CC)` }}
      >
        <animate attributeName="stroke-dashoffset" from="52" to="0" dur="1.7s" repeatCount="indefinite" />
      </path>
    </svg>
    <div className="crt-scanlines absolute inset-0 opacity-60" />
    <div
      className="absolute top-1.5 left-3 font-mono-tech text-[9px] font-bold tracking-[0.2em] uppercase"
      style={{ color: `${accentColor}CC` }}
    >
      {statusLabel}
    </div>
    <div className="absolute top-1.5 right-3 font-mono-tech text-[9px] font-bold tracking-[0.2em] text-white/40 uppercase">
      {rightLabel}
    </div>
  </div>
);

/** Animated "…" for waiting copy. */
const WaitingDots: React.FC = () => (
  <span aria-hidden="true" className="inline-flex gap-[0.12em] ml-[0.15em]">
    {[0, 1, 2].map((i) => (
      <span key={i} className="tvrx-dot" style={{ animationDelay: `${i * 0.18}s` }}>
        .
      </span>
    ))}
  </span>
);

type WakeLockSentinelLike = { release: () => Promise<void> };

export const TvReceiverPage: React.FC<TvReceiverPageProps> = ({
  initialRoomCode = '',
}) => {
  const wsRef = useRef<WsClient | null>(null);
  const tvRtcRef = useRef<TvWebRtcClient | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const boundTracksRef = useRef<WeakSet<MediaStreamTrack>>(new WeakSet());
  const hudTimerRef = useRef<number | null>(null);
  const activeRoomCodeRef = useRef<string>(initialRoomCode.trim().toUpperCase());
  const userMutedRef = useRef(false);
  const joinedRef = useRef(false);

  const [sessionKey, setSessionKey] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode.toUpperCase());
  const [pendingCode, setPendingCode] = useState(activeRoomCodeRef.current);
  const [joinedRoom, setJoinedRoom] = useState<RoomState | null>(null);
  const [linkState, setLinkState] = useState<TvLinkState>('idle');
  const [videoFlowing, setVideoFlowing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lanOrigin, setLanOrigin] = useState<string>(window.location.origin);
  const [qrDataUrl, setQrDataUrl] = useState('');

  joinedRef.current = Boolean(joinedRoom);
  const isLive = Boolean(joinedRoom?.tvStreamActive && videoFlowing);

  /* ── Video plumbing ───────────────────────────────────────────────────── */

  /** Try to play with sound; fall back to muted + "tap to unmute" overlay. */
  const tryPlay = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.srcObject) return;
    v.muted = userMutedRef.current;
    try {
      await v.play();
      setMuted(v.muted);
      setNeedsGesture(false);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      if (!v.muted) {
        v.muted = true;
        setMuted(true);
        setNeedsGesture(true);
        await v.play().catch(() => {});
      }
    }
  }, []);

  const bindVideoTracks = useCallback((stream: MediaStream) => {
    const update = () => {
      const tracks = stream.getVideoTracks();
      setVideoFlowing(tracks.some((t) => t.readyState === 'live' && !t.muted));
    };
    for (const track of stream.getVideoTracks()) {
      if (boundTracksRef.current.has(track)) continue;
      boundTracksRef.current.add(track);
      track.addEventListener('mute', update);
      track.addEventListener('unmute', update);
      track.addEventListener('ended', update);
    }
    update();
  }, []);

  const attachStream = useCallback(
    (stream: MediaStream) => {
      streamRef.current = stream;
      bindVideoTracks(stream);
      const v = videoRef.current;
      if (v && v.srcObject !== stream) {
        v.srcObject = stream;
      }
      void tryPlay();
    },
    [bindVideoTracks, tryPlay],
  );

  // Re-attach if the <video> element mounts after the stream arrived.
  useEffect(() => {
    const v = videoRef.current;
    if (v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
      void tryPlay();
    }
  });

  const resetVideo = useCallback(() => {
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setVideoFlowing(false);
  }, []);

  /* ── Signaling session (recreated on "disconnect") ────────────────────── */

  useEffect(() => {
    const ws = new WsClient();
    wsRef.current = ws;

    const tvRtc = new TvWebRtcClient(
      ws,
      (stream) => attachStream(stream),
      (state) => setLinkState(state),
    );
    tvRtcRef.current = tvRtc;

    const unsubStatus = ws.onStatus((connected) => {
      setWsConnected(connected);
      const code = activeRoomCodeRef.current;
      if (connected && code) {
        ws.send({ type: 'tv:join', roomCode: code });
      }
    });

    const unsubMsg = ws.onMessage((msg) => {
      if (msg.type === 'tv:joined') {
        setErrorMsg(null);
        setJoinedRoom(msg.room);
        activeRoomCodeRef.current = msg.room.roomCode;
        setPendingCode(msg.room.roomCode);
      } else if (msg.type === 'room:state') {
        // Don't tear down the peer when tvStreamActive flips off: it also
        // blips during a host WS reconnect while P2P video keeps flowing. If
        // the host really stopped, it closes its side and our link dies.
        setJoinedRoom(msg.room);
      } else if (msg.type === 'rtc:signal') {
        void tvRtc.handleSignal(msg.fromId, msg.signal);
      } else if (msg.type === 'error') {
        setErrorMsg(msg.message);
      }
    });

    return () => {
      unsubStatus();
      unsubMsg();
      tvRtc.close();
      tvRtcRef.current = null;
      ws.dispose();
      wsRef.current = null;
    };
  }, [sessionKey, attachStream, resetVideo]);

  // Keep knocking while the room doesn't exist yet (host may still be booting).
  useEffect(() => {
    if (joinedRoom || !errorMsg || !wsConnected || !pendingCode) return;
    const timer = window.setInterval(() => {
      const code = activeRoomCodeRef.current;
      if (code && !joinedRef.current) {
        wsRef.current?.send({ type: 'tv:join', roomCode: code });
      }
    }, JOIN_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [joinedRoom, errorMsg, wsConnected, pendingCode]);

  /* ── Join URL + QR for the idle screen ────────────────────────────────── */

  useEffect(() => {
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return;
    let cancelled = false;
    fetch('/api/network-info')
      .then((r) => r.json())
      .then((data: { suggestedOrigin?: string }) => {
        if (!cancelled && data.suggestedOrigin) setLanOrigin(data.suggestedOrigin);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const roomCode = joinedRoom?.roomCode ?? '';
  const joinUrl = roomCode ? `${lanOrigin}/play/${roomCode}` : '';
  const joinUrlLabel = useMemo(() => {
    if (!joinUrl) return '';
    try {
      const u = new URL(joinUrl);
      return `${u.host}${u.pathname}`;
    } catch {
      return joinUrl;
    }
  }, [joinUrl]);

  useEffect(() => {
    if (!joinUrl) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(joinUrl, {
      width: 420,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#07060B', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  /* ── Fullscreen, wake lock, HUD ───────────────────────────────────────── */

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Keep the TV awake while tuned to a room.
  useEffect(() => {
    if (!joinedRoom) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      nav.wakeLock
        ?.request('screen')
        .then((s) => {
          if (disposed) void s.release().catch(() => {});
          else sentinel = s;
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release().catch(() => {});
    };
  }, [Boolean(joinedRoom)]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearHudTimer = () => {
    if (hudTimerRef.current !== null) {
      window.clearTimeout(hudTimerRef.current);
      hudTimerRef.current = null;
    }
  };

  const revealHud = useCallback(() => {
    setHudVisible(true);
    clearHudTimer();
    if (isLive) {
      hudTimerRef.current = window.setTimeout(() => setHudVisible(false), HUD_HIDE_MS);
    }
  }, [isLive]);

  useEffect(() => {
    if (!isLive) {
      setHudVisible(true);
      clearHudTimer();
      return;
    }
    revealHud();
    const onActivity = () => revealHud();
    window.addEventListener('mousemove', onActivity);
    window.addEventListener('touchstart', onActivity, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('touchstart', onActivity);
      clearHudTimer();
    };
  }, [isLive, revealHud]);

  const unmute = useCallback(() => {
    userMutedRef.current = false;
    const v = videoRef.current;
    setNeedsGesture(false);
    setMuted(false);
    if (v) {
      v.muted = false;
      void v.play().catch(() => {});
    }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    const nextMuted = !(v?.muted ?? muted);
    playSwitchClack(nextMuted ? 0.88 : 1.15);
    if (!nextMuted) {
      unmute();
    } else {
      userMutedRef.current = true;
      setMuted(true);
      if (v) v.muted = true;
    }
    revealHud();
  }, [muted, revealHud, unmute]);

  const toggleFullscreen = useCallback(() => {
    playSwitchClack(1.05);
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
    revealHud();
  }, [revealHud]);

  // Remote-friendly shortcuts: F = fullscreen, M = mute, any key reveals HUD.
  useEffect(() => {
    if (!joinedRoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else {
        revealHud();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [joinedRoom, toggleFullscreen, toggleMute, revealHud]);

  const handleDisconnect = useCallback(() => {
    playSwitchClack(0.85);
    activeRoomCodeRef.current = '';
    setPendingCode('');
    resetVideo();
    setJoinedRoom(null);
    setErrorMsg(null);
    setLinkState('idle');
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    // Fresh socket so the server drops this receiver and the host stops casting.
    setSessionKey((k) => k + 1);
  }, [resetVideo]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const code = roomCodeInput.trim().toUpperCase();
    if (!code) return;
    playConfirmPop(true);
    setErrorMsg(null);
    activeRoomCodeRef.current = code;
    setPendingCode(code);
    wsRef.current?.send({ type: 'tv:join', roomCode: code });
  };

  /* ── Render: join form ────────────────────────────────────────────────── */

  if (!joinedRoom) {
    const waitingForRoom = Boolean(errorMsg && pendingCode);
    return (
      <div className="min-h-screen hw-grid-bg flex flex-col text-[#F5F4F0]">
        <style>{TV_STYLES}</style>
        <div className="h-1.5 w-full smpte-bar shrink-0" />

        <div className="flex-1 flex items-center justify-center p-5 sm:p-8">
          <div className="w-full max-w-md pvm-housing rounded-[28px] overflow-hidden animate-spring-pop">
            <div className="h-1.5 w-full smpte-bar" />
            <div className="p-6 sm:p-7">
              <div className="flex items-start justify-between gap-3 mb-5">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl crt-well flex items-center justify-center shrink-0 relative">
                    <Tv className="w-6 h-6 text-[#B5FF2A]" />
                    <span
                      className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-[#0A0910] ${
                        wsConnected
                          ? 'bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A]'
                          : 'bg-[#FFB800] animate-pulse'
                      }`}
                    />
                  </div>
                  <div>
                    <h1 className="font-brand text-lg sm:text-xl font-extrabold tracking-tight text-[#F5F4F0] leading-tight">
                      COUCH·TV // CH-01
                    </h1>
                    <p className="font-mono-tech text-[10px] font-bold uppercase tracking-[0.16em] text-white/45 mt-1">
                      WEBRTC 60FPS BROADCAST RECEIVER
                    </p>
                  </div>
                </div>
                <div className="crt-well rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 shrink-0">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      wsConnected ? 'bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A]' : 'bg-[#FFB800] animate-pulse'
                    }`}
                  />
                  <span className="font-mono-tech text-[9px] font-extrabold uppercase tracking-widest text-white/75">
                    {wsConnected ? 'ONLINE' : 'SYNCING'}
                  </span>
                </div>
              </div>

              <div className="mb-5">
                <StandbyOscilloscope
                  statusLabel="TUNER CARRIER // 59.94 HZ"
                  rightLabel={
                    !wsConnected
                      ? 'LINKING…'
                      : waitingForRoom
                        ? `SCANNING ${pendingCode}`
                        : 'SIGNAL READY'
                  }
                  accentColor={wsConnected ? (waitingForRoom ? '#22D3EE' : '#B5FF2A') : '#FFB800'}
                />
              </div>

              <form onSubmit={handleJoin} className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5 px-0.5">
                    <label
                      htmlFor="tv-room-code-input"
                      className="font-mono-tech text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/50"
                    >
                      ROOM CODE
                    </label>
                    <span className="font-mono-tech text-[10px] font-bold text-[#22D3EE]">
                      SHOWN ON THE HOST SCREEN
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      id="tv-room-code-input"
                      type="text"
                      maxLength={6}
                      value={roomCodeInput}
                      onChange={(e) =>
                        setRoomCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                      }
                      placeholder="ABCD"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      autoFocus={!initialRoomCode}
                      className="w-full crt-well rounded-2xl px-4 py-4 text-center font-brand text-3xl sm:text-4xl font-extrabold tracking-[0.32em] pl-[0.32em] text-[#B5FF2A] placeholder:text-[#B5FF2A]/20 uppercase outline-none focus:ring-2 focus:ring-[#FF3B5C] transition"
                    />
                    <div className="pointer-events-none absolute inset-x-3 top-1/2 h-px bg-black/70" />
                  </div>
                </div>

                {errorMsg && (
                  <div
                    role="status"
                    className="px-3.5 py-2.5 rounded-xl bg-[#FF3B5C]/12 border border-[#FF3B5C]/50 font-mono-tech text-xs font-bold text-[#FF8FA3] text-center leading-relaxed"
                  >
                    {errorMsg}
                    {waitingForRoom && (
                      <div className="mt-1 text-[10px] text-white/50 font-semibold">
                        Retrying {pendingCode} automatically
                        <WaitingDots />
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!wsConnected || !roomCodeInput.trim()}
                  className="console-btn-hot w-full py-3.5 rounded-2xl font-brand font-extrabold text-sm sm:text-base tracking-[0.14em] uppercase cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Radio className="w-4 h-4" />
                  {wsConnected ? 'TUNE IN' : 'CONNECTING…'}
                </button>
              </form>

              <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between font-mono-tech text-[10px] font-bold text-white/40">
                <span>PVM-MKII // COUCH·OS</span>
                <span>1080P60 · LOW-LATENCY RTC</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Render: tuned to a room ──────────────────────────────────────────── */

  const connectedPlayers: PlayerInfo[] = joinedRoom.players.filter(
    (p) => p.connected !== false,
  );
  const gameTitle =
    joinedRoom.activeGame.mode === 'lobby' ? null : joinedRoom.activeGame.title;

  const status: { label: string; color: string; detail: string } = !wsConnected
    ? {
        label: 'RECONNECTING',
        color: '#FFB800',
        detail: 'Lost the console link — reconnecting',
      }
    : !joinedRoom.hostConnected
      ? {
          label: 'HOST OFFLINE',
          color: '#FFB800',
          detail: 'The host console went offline — hang tight',
        }
      : !joinedRoom.tvStreamActive
        ? {
            label: 'STANDBY',
            color: '#B5FF2A',
            detail: 'Waiting for the host to start casting to this TV',
          }
        : linkState === 'failed' || linkState === 'disconnected'
          ? {
              label: 'RE-LINKING',
              color: '#FF3B5C',
              detail: 'Video link dropped — re-establishing',
            }
          : linkState === 'connected'
            ? {
                label: 'LINKED',
                color: '#22D3EE',
                detail: gameTitle
                  ? `Loading ${gameTitle}`
                  : 'Host is in the menus — pick a game to start',
              }
            : {
                label: 'TUNING',
                color: '#22D3EE',
                detail: 'Locking onto the host’s video signal',
              };

  const codeChars = joinedRoom.roomCode.split('');

  return (
    <div
      onClick={() => {
        if (needsGesture) unmute();
        else revealHud();
      }}
      className={`fixed inset-0 bg-[#07060B] flex flex-col select-none text-[#F5F4F0] overflow-hidden ${
        isLive && !hudVisible ? 'cursor-none' : ''
      }`}
    >
      <style>{TV_STYLES}</style>

      {/* Edge-to-edge video stage (always mounted so the stream can attach) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        disablePictureInPicture
        className={`absolute inset-0 w-full h-full object-contain bg-black transition-opacity duration-500 ${
          isLive ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Auto-fading HUD pill (live) */}
      {isLive && (
        <div
          className={`absolute top-4 inset-x-4 z-30 flex justify-center transition-all duration-500 pointer-events-none ${
            hudVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
          }`}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`console-deck rounded-full px-3 py-1.5 flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 ${
              hudVisible ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full crt-well font-mono-tech text-[10px] font-extrabold tracking-widest text-[#B5FF2A]">
              <span className="w-2 h-2 rounded-full bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A] animate-pulse" />
              LIVE
            </span>
            <span className="font-mono-tech text-xs font-extrabold tracking-wider text-[#F5F4F0] px-1">
              {joinedRoom.roomCode}
              <span className="text-white/35 mx-1.5">·</span>
              <span className="text-white/80 font-semibold">{joinedRoom.activeGame.title}</span>
            </span>
            {connectedPlayers.length > 0 && (
              <span className="font-mono-tech text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-white/8 border border-white/12 text-[#22D3EE]">
                {connectedPlayers.length}P
              </span>
            )}
            <span className="w-px h-4 bg-white/12 hidden sm:inline-block" />
            <button
              type="button"
              onClick={toggleMute}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-mono-tech text-[10px] font-extrabold uppercase tracking-wider cursor-pointer ${
                muted ? 'console-btn-hot' : 'console-btn'
              }`}
              title={muted ? 'Unmute TV audio (M)' : 'Mute TV audio (M)'}
              aria-pressed={muted}
            >
              {muted ? (
                <>
                  <VolumeX className="w-3.5 h-3.5" /> UNMUTE
                </>
              ) : (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-[#B5FF2A]" /> AUDIO
                </>
              )}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="console-btn p-1.5 rounded-full cursor-pointer"
              title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              className="console-btn p-1.5 rounded-full text-[#FF3B5C] hover:text-white cursor-pointer"
              title="Disconnect from room"
              aria-label="Disconnect from room"
            >
              <Power className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Click-to-unmute overlay when autoplay with sound was blocked */}
      {isLive && needsGesture && (
        <div className="absolute inset-0 z-40 flex items-end justify-center pb-10 px-4 bg-gradient-to-t from-black/70 via-black/10 to-transparent">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playSwitchClack(1.15);
              unmute();
            }}
            className="console-deck hover:border-[#FF3B5C]/70 inline-flex items-center gap-4 pl-3 pr-7 py-3 rounded-full font-display font-extrabold text-[#F5F4F0] cursor-pointer transition active:translate-y-[2px] animate-spring-pop"
            style={{ fontSize: 'clamp(1rem, 1.8vw, 1.6rem)' }}
          >
            <span className="relative inline-flex items-center justify-center w-12 h-12 rounded-full console-btn-hot">
              <span className="absolute inset-0 rounded-full border-2 border-[#FF3B5C] tvrx-ring" />
              <VolumeX className="w-6 h-6" />
            </span>
            Click anywhere for sound
          </button>
        </div>
      )}

      {/* ── Idle / waiting screen ─────────────────────────────────────── */}
      {!isLive && (
        <div className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-[#07060B]">
          {/* Animated aurora backdrop */}
          <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
            <div
              className="absolute -top-1/4 -left-1/4 w-[75vw] h-[75vw] rounded-full blur-3xl opacity-40 tvrx-anim-a"
              style={{ background: 'radial-gradient(circle, rgba(255,59,92,0.55) 0%, transparent 62%)' }}
            />
            <div
              className="absolute -bottom-1/3 -right-1/4 w-[80vw] h-[80vw] rounded-full blur-3xl opacity-35 tvrx-anim-b"
              style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.5) 0%, transparent 62%)' }}
            />
            <div
              className="absolute top-1/4 left-1/3 w-[55vw] h-[55vw] rounded-full blur-3xl opacity-25 tvrx-anim-c"
              style={{ background: 'radial-gradient(circle, rgba(181,255,42,0.45) 0%, transparent 60%)' }}
            />
            <div
              className="absolute inset-0 opacity-[0.35]"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
                backgroundSize: '44px 44px',
              }}
            />
            <div className="absolute inset-x-0 h-[22vh] tvrx-sweep bg-gradient-to-b from-transparent via-white/[0.045] to-transparent" />
            <div className="crt-scanlines absolute inset-0 opacity-50" />
          </div>
          <div className="relative h-1.5 w-full smpte-bar shrink-0" />

          {/* Top bar */}
          <header className="relative z-10 flex items-center justify-between gap-4 px-[4vw] pt-[3vh]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl crt-well flex items-center justify-center shrink-0">
                <Tv className="w-5 h-5 text-[#B5FF2A]" />
              </div>
              <div className="min-w-0">
                <div className="font-brand font-extrabold tracking-[0.12em] text-[#F5F4F0] leading-none" style={{ fontSize: 'clamp(1rem, 1.6vw, 1.5rem)' }}>
                  COUCH·TV
                </div>
                <div
                  className="font-mono-tech font-extrabold uppercase tracking-[0.22em] mt-1 flex items-center gap-2"
                  style={{ color: status.color, fontSize: 'clamp(0.65rem, 0.9vw, 0.85rem)' }}
                >
                  <span
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: status.color, boxShadow: `0 0 10px ${status.color}` }}
                  />
                  {status.label}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {gameTitle && (
                <span className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-full console-deck font-mono-tech text-xs font-extrabold tracking-wider text-white/80 max-w-[34vw] truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B5C]" />
                  {gameTitle}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullscreen();
                }}
                className="console-btn p-2.5 rounded-xl cursor-pointer"
                title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDisconnect();
                }}
                className="console-btn p-2.5 rounded-xl text-[#FF3B5C] cursor-pointer"
                title="Disconnect / switch room"
                aria-label="Disconnect / switch room"
              >
                <Power className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Hero: room code + QR */}
          <main className="relative z-10 flex-1 flex items-center justify-center px-[4vw] py-[2vh] min-h-0">
            <div className="w-full max-w-[1500px] flex flex-col lg:flex-row items-center justify-center gap-[4vw]">
              <div className="flex flex-col items-center lg:items-start text-center lg:text-left tvrx-enter">
                <div
                  className="font-mono-tech font-extrabold uppercase tracking-[0.34em] text-white/55 flex items-center gap-2"
                  style={{ fontSize: 'clamp(0.8rem, 1.25vw, 1.25rem)' }}
                >
                  <Smartphone className="w-[1.2em] h-[1.2em] text-[#FF3B5C]" />
                  Grab a phone · join with code
                </div>

                <div
                  className="flex gap-[0.12em] mt-[2vh]"
                  role="img"
                  aria-label={`Room code ${codeChars.join(' ')}`}
                  style={{ fontSize: 'clamp(4.5rem, 13vw, 13rem)' }}
                >
                  {codeChars.map((ch, i) => (
                    <span
                      key={`${joinedRoom.roomCode}-${i}`}
                      className="tvrx-tile relative inline-flex items-center justify-center w-[0.92em] h-[1.18em] rounded-[0.14em] crt-well font-brand font-extrabold leading-none text-[#B5FF2A]"
                      style={{
                        animationDelay: `${i * 90}ms, ${700 + i * 260}ms`,
                        textShadow: '0 0 0.18em rgba(181,255,42,0.55), 0 0 0.5em rgba(181,255,42,0.25)',
                        boxShadow:
                          'inset 0 0.04em 0.12em rgba(0,0,0,0.95), 0 0.08em 0.3em -0.08em rgba(181,255,42,0.25), 0 0 0 1px rgba(255,255,255,0.06)',
                      }}
                    >
                      {ch}
                      <span className="pointer-events-none absolute inset-x-[0.06em] top-1/2 h-[0.012em] min-h-px bg-black/80" />
                    </span>
                  ))}
                </div>

                {joinUrlLabel && (
                  <div
                    className="mt-[2.5vh] font-mono-tech font-bold text-white/70 tracking-wide break-all"
                    style={{ fontSize: 'clamp(0.95rem, 1.55vw, 1.6rem)' }}
                  >
                    or visit <span className="text-[#22D3EE] font-extrabold">{joinUrlLabel}</span>
                  </div>
                )}

                <div
                  className="mt-[3vh] inline-flex items-center gap-3 px-[1.1em] py-[0.55em] rounded-full console-deck font-display font-extrabold text-[#F5F4F0]/90"
                  style={{ fontSize: 'clamp(0.9rem, 1.35vw, 1.35rem)' }}
                  role="status"
                  aria-live="polite"
                >
                  <span className="relative flex w-[0.6em] h-[0.6em]">
                    <span className="absolute inset-0 rounded-full tvrx-ring" style={{ backgroundColor: status.color }} />
                    <span className="relative w-full h-full rounded-full" style={{ backgroundColor: status.color }} />
                  </span>
                  {status.detail}
                  <WaitingDots />
                </div>
              </div>

              {qrDataUrl && (
                <div className="tvrx-enter shrink-0 flex flex-col items-center" style={{ animationDelay: '180ms' }}>
                  <div
                    className="rounded-[1.6rem] bg-white p-[1vw] shadow-[0_0_0_6px_rgba(255,255,255,0.06),0_30px_80px_-20px_rgba(255,59,92,0.45)]"
                    style={{ width: 'clamp(11rem, 22vw, 22rem)' }}
                  >
                    <img src={qrDataUrl} alt={`QR code to join room ${joinedRoom.roomCode}`} className="w-full h-auto block [image-rendering:pixelated]" />
                  </div>
                  <div
                    className="mt-3 font-mono-tech font-extrabold uppercase tracking-[0.3em] text-white/60"
                    style={{ fontSize: 'clamp(0.7rem, 1vw, 1rem)' }}
                  >
                    Scan to play
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* Player ports */}
          <footer className="relative z-10 px-[4vw] pb-[4vh]">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-[1.2vw] max-w-[1500px] mx-auto">
              {[0, 1, 2, 3].map((slot) => {
                const player = connectedPlayers.find((p) => p.slot === slot);
                return (
                  <div
                    key={slot}
                    className={`rounded-2xl px-[1.2vw] py-[1.4vh] flex items-center gap-[0.9vw] border transition-all duration-500 ${
                      player ? 'console-deck tvrx-enter' : 'crt-well opacity-50 border-white/5'
                    }`}
                    style={
                      player
                        ? {
                            borderColor: `${player.color}99`,
                            boxShadow: `0 0 34px ${player.color}30, inset 0 1px 0 rgba(255,255,255,0.14)`,
                          }
                        : undefined
                    }
                  >
                    <div
                      className="shrink-0 rounded-xl border flex items-center justify-center font-mono-tech font-extrabold"
                      style={{
                        width: 'clamp(2.4rem, 3.4vw, 3.6rem)',
                        height: 'clamp(2.4rem, 3.4vw, 3.6rem)',
                        fontSize: 'clamp(0.85rem, 1.2vw, 1.25rem)',
                        ...(player
                          ? {
                              backgroundColor: `${player.color}22`,
                              borderColor: player.color,
                              color: player.color,
                              boxShadow: `0 0 18px ${player.color}55`,
                            }
                          : {
                              backgroundColor: 'rgba(255,255,255,0.04)',
                              borderColor: 'rgba(255,255,255,0.1)',
                              color: 'rgba(245,244,240,0.35)',
                            }),
                      }}
                    >
                      P{slot + 1}
                    </div>
                    <div className="min-w-0">
                      <div
                        className="font-display font-extrabold text-[#F5F4F0] truncate leading-tight"
                        style={{ fontSize: 'clamp(0.95rem, 1.45vw, 1.5rem)' }}
                      >
                        {player ? player.name : 'Open seat'}
                      </div>
                      <div
                        className="font-mono-tech font-extrabold uppercase tracking-[0.2em] mt-0.5"
                        style={{
                          fontSize: 'clamp(0.6rem, 0.8vw, 0.8rem)',
                          color: player ? '#B5FF2A' : 'rgba(245,244,240,0.3)',
                        }}
                      >
                        {player ? 'Ready' : 'Waiting'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </footer>
        </div>
      )}
    </div>
  );
};
