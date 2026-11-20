import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ActiveGameInfo,
  CONTROLLER_LAYOUT_META,
  ControllerLayoutId,
  RoomState,
} from '@couch-emu/shared';
import {
  ArrowDown,
  ArrowUp,
  Cast,
  Check,
  Copy,
  ExternalLink,
  Gamepad2,
  Globe,
  MonitorPlay,
  QrCode,
  Radio,
  Smartphone,
  Sparkles,
  Tv,
  UserX,
  Vibrate,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { WsClient } from '../lib/wsClient';
import { virtualGamepadManager } from '../lib/virtualGamepad';
import { HostWebRtcManager } from '../lib/webrtc';
import {
  isUiSfxEnabled,
  playConfirmPop,
  playSwitchClack,
  setUiSfxEnabled,
} from '../lib/uiSound';
import { ArcadeHub } from '../games/ArcadeHub';
import { PlayerToasts } from '../components/PlayerToasts';

// Secondary console modes load on first use (the emulator pulls in RetroArch).
const EmulatorHost = React.lazy(() =>
  import('../components/EmulatorHost').then((m) => ({ default: m.EmulatorHost })),
);
const CustomGameHost = React.lazy(() =>
  import('../components/CustomGameHost').then((m) => ({
    default: m.CustomGameHost,
  })),
);
const GamepadTester = React.lazy(() =>
  import('../components/GamepadTester').then((m) => ({
    default: m.GamepadTester,
  })),
);

function ModeLoading(): React.ReactElement {
  return (
    <div className="flex-1 min-h-[50vh] flex items-center justify-center">
      <span className="font-mono-tech text-[11px] font-extrabold tracking-[0.3em] text-white/45 animate-pulse">
        LOADING MODULE…
      </span>
    </div>
  );
}

type HostTab = 'arena' | 'emulator' | 'webgame' | 'tester';

const LAYOUT_PROFILES: {
  id: ControllerLayoutId;
  label: string;
  sub: string;
  dotColor: string;
}[] = [
  { id: 'dualstick', label: 'PRO', sub: 'Dual Stick', dotColor: '#FFB800' },
  { id: 'snes', label: 'SNES', sub: '4-Face + L/R', dotColor: '#A855F7' },
  { id: 'nes', label: 'NES', sub: 'Classic 2-Btn', dotColor: '#FF3B5C' },
  { id: 'gba', label: 'GBA', sub: 'Handheld', dotColor: '#38BDF8' },
  { id: 'genesis', label: '6-BTN', sub: 'Arcade Pad', dotColor: '#22D3EE' },
  { id: 'n64', label: 'N64', sub: 'Stick + C-Pad', dotColor: '#B5FF2A' },
];

const MODE_TABS: {
  id: HostTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'arena', label: 'ARCADE 60', icon: Sparkles },
  { id: 'emulator', label: 'RETRO WASM', icon: MonitorPlay },
  { id: 'webgame', label: 'WEB ADAPTER', icon: Globe },
  { id: 'tester', label: 'PAD LAB', icon: Gamepad2 },
];

export const HostPage: React.FC = () => {
  const wsRef = useRef<WsClient | null>(null);
  const rtcRef = useRef<HostWebRtcManager | null>(null);

  const [wsConnected, setWsConnected] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [tab, setTab] = useState<HostTab>('arena');
  const [lanOrigin, setLanOrigin] = useState<string>(window.location.origin);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [tvStreamEnabled, setTvStreamEnabled] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [uiSfxOn, setUiSfxOn] = useState<boolean>(() => isUiSfxEnabled());
  const [buzzingSlot, setBuzzingSlot] = useState<number | null>(null);
  const [slotActivity, setSlotActivity] = useState<
    [boolean, boolean, boolean, boolean]
  >([false, false, false, false]);

  const roomRef = useRef<RoomState | null>(null);
  roomRef.current = room;

  useEffect(() => {
    fetch('/api/network-info')
      .then((r) => r.json())
      .then((data: { suggestedOrigin?: string }) => {
        if (
          window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1'
        ) {
          if (data.suggestedOrigin) {
            setLanOrigin(data.suggestedOrigin);
          }
        } else {
          setLanOrigin(window.location.origin);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    virtualGamepadManager.install();
    const ws = new WsClient();
    wsRef.current = ws;

    const rtc = new HostWebRtcManager(ws, (playerId, state) => {
      const currentRoom = roomRef.current;
      const p = currentRoom?.players.find((x) => x.id === playerId);
      if (p) {
        virtualGamepadManager.applyInput(p.slot, state);
      }
    });
    rtcRef.current = rtc;

    virtualGamepadManager.setRumbleHandler((slot, durationMs, intensity) => {
      const p = roomRef.current?.players.find((x) => x.slot === slot);
      if (p) {
        ws.send({
          type: 'host:rumble',
          playerId: p.id,
          durationMs,
          intensity,
        });
      }
    });

    const unsubStatus = ws.onStatus((connected) => {
      setWsConnected(connected);
      if (connected) {
        const savedCode =
          sessionStorage.getItem('couch-emu-host-room') ?? undefined;
        ws.send({ type: 'host:create', roomCode: savedCode });
      }
    });

    const unsubMsg = ws.onMessage((msg) => {
      if (msg.type === 'host:created') {
        sessionStorage.setItem('couch-emu-host-room', msg.roomCode);
        setRoom(msg.room);
      } else if (msg.type === 'room:state') {
        setRoom(msg.room);
      } else if (msg.type === 'input:remote') {
        virtualGamepadManager.applyInput(msg.slot, msg.state);
      } else if (msg.type === 'rtc:signal') {
        void rtc.handleSignal(msg.fromId, msg.signal);
      }
    });

    return () => {
      unsubStatus();
      unsubMsg();
      virtualGamepadManager.setRumbleHandler(null);
      rtc.dispose();
      ws.dispose();
    };
  }, []);

  // Close pairing drawer on Escape
  useEffect(() => {
    if (!pairingOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        playSwitchClack(0.86);
        setPairingOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pairingOpen]);

  // Subscribe to virtualGamepadManager.onChange (throttled ~15fps) for live P1-P4 LED activity
  useEffect(() => {
    const lastSeqs = [0, 0, 0, 0];
    const activeUntil = [0, 0, 0, 0];
    let flushTimer: number | null = null;
    let decayTimer: number | null = null;

    const flushState = () => {
      flushTimer = null;
      const now = performance.now();
      const next: [boolean, boolean, boolean, boolean] = [
        activeUntil[0] > now,
        activeUntil[1] > now,
        activeUntil[2] > now,
        activeUntil[3] > now,
      ];
      setSlotActivity((prev) =>
        prev[0] === next[0] &&
        prev[1] === next[1] &&
        prev[2] === next[2] &&
        prev[3] === next[3]
          ? prev
          : next,
      );

      if (next.some(Boolean)) {
        if (decayTimer !== null) window.clearTimeout(decayTimer);
        decayTimer = window.setTimeout(flushState, 90);
      }
    };

    const unsub = virtualGamepadManager.onChange(() => {
      const now = performance.now();
      let touched = false;
      for (let slot = 0; slot < 4; slot++) {
        const st = virtualGamepadManager.getSlotState(slot);
        const hasAxis =
          Math.abs(st.axes[0] ?? 0) > 0.08 ||
          Math.abs(st.axes[1] ?? 0) > 0.08 ||
          Math.abs(st.axes[2] ?? 0) > 0.08 ||
          Math.abs(st.axes[3] ?? 0) > 0.08 ||
          (st.l2 ?? 0) > 0.05 ||
          (st.r2 ?? 0) > 0.05;
        if (
          (st.seq > 0 && st.seq !== lastSeqs[slot]) ||
          st.buttonsMask !== 0 ||
          hasAxis
        ) {
          lastSeqs[slot] = st.seq;
          activeUntil[slot] = now + 260;
          touched = true;
        }
      }
      if (touched && flushTimer === null) {
        flushTimer = window.setTimeout(flushState, 66);
      }
    });

    return () => {
      unsub();
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      if (decayTimer !== null) window.clearTimeout(decayTimer);
    };
  }, []);

  useEffect(() => {
    if (!room) return;
    virtualGamepadManager.syncConnectedSlots(
      room.players.filter((p) => p.connected),
    );
    rtcRef.current?.syncTvReceivers(room.tvReceivers.map((t) => t.id));
  }, [room]);

  const joinUrl = useMemo(() => {
    if (!room) return '';
    return `${lanOrigin}/play/${room.roomCode}`;
  }, [lanOrigin, room]);

  const tvUrl = useMemo(() => {
    if (!room) return '';
    return `${lanOrigin}/tv/${room.roomCode}`;
  }, [lanOrigin, room]);

  useEffect(() => {
    if (!joinUrl) return;
    QRCode.toDataURL(joinUrl, {
      width: 280,
      margin: 1,
      color: { dark: '#07060B', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(() => {});
  }, [joinUrl]);

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement | null) => {
    rtcRef.current?.setActiveCanvas(canvas);
  }, []);

  const handleLayoutSuggested = useCallback((layout: ControllerLayoutId) => {
    wsRef.current?.send({ type: 'host:set_layout', layout });
  }, []);

  const handleGameMetaChange = useCallback((activeGame: ActiveGameInfo) => {
    wsRef.current?.send({ type: 'host:set_game', activeGame });
  }, []);

  const handleToggleTvStream = () => {
    const next = !tvStreamEnabled;
    playSwitchClack(next ? 1.15 : 0.85);
    setTvStreamEnabled(next);
    rtcRef.current?.setStreamingEnabled(next);
  };

  const handleToggleUiSfx = () => {
    const next = !uiSfxOn;
    setUiSfxEnabled(next);
    setUiSfxOn(next);
    if (next) {
      playConfirmPop(true);
    }
  };

  const handleRumbleSlot = useCallback(
    (slot: number, durationMs: number, intensity: number) => {
      const p = roomRef.current?.players.find((x) => x.slot === slot);
      if (p) {
        wsRef.current?.send({
          type: 'host:rumble',
          playerId: p.id,
          durationMs,
          intensity,
        });
      }
    },
    [],
  );

  const handleBuzzPlayer = (slot: number, playerId: string) => {
    playConfirmPop(true);
    wsRef.current?.send({
      type: 'host:rumble',
      playerId,
      durationMs: 220,
      intensity: 1,
    });
    setBuzzingSlot(slot);
    window.setTimeout(() => {
      setBuzzingSlot((curr) => (curr === slot ? null : curr));
    }, 320);
  };

  const handleCopyJoinUrl = () => {
    if (!joinUrl) return;
    playConfirmPop(true);
    void navigator.clipboard?.writeText(joinUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1800);
  };

  const handleCopyRoomCode = () => {
    if (!room?.roomCode) return;
    playConfirmPop(true);
    void navigator.clipboard?.writeText(room.roomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1600);
  };

  const handleOpenPairing = useCallback(() => {
    playSwitchClack(1.06);
    setPairingOpen(true);
  }, []);

  const handleTabChange = (nextTab: HostTab, idx: number) => {
    playSwitchClack(0.95 + idx * 0.06);
    setTab(nextTab);
    if (nextTab === 'arena') {
      handleGameMetaChange({
        mode: 'webgame',
        title: '60-Game Arcade Vault',
        systemName: 'COUCH·OS',
        controls: 'Browse & launch any of 60 arcade cartridges',
        accent: '#FF3B5C',
      });
    } else if (nextTab === 'tester') {
      handleGameMetaChange({
        mode: 'lobby',
        title: 'Input Telemetry Lab',
        controls: 'Test analog sticks, L2/R2 triggers & haptics',
        accent: '#B5FF2A',
      });
    }
  };

  // Ports held by phones that dropped and are inside their reconnect grace
  // window stay reserved but don't drive games (bots fill in meanwhile).
  const allPlayers = room?.players ?? [];
  const connectedPlayers = useMemo(
    () => allPlayers.filter((p) => p.connected),
    [allPlayers],
  );
  const tvReceiverCount = room?.tvReceivers.length ?? 0;

  return (
    <div className="min-h-screen w-full cinema-stage-bg text-[#F5F4F0] flex flex-col overflow-x-hidden">
      {/* Set-top box: wordmark, input sources, front-panel LCD */}
      <header className="sticky top-0 z-30 h-14 pl-4 pr-3 sm:pl-6 sm:pr-4 bg-[#07060B]/88 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-5 min-w-0 h-full">
          <div className="flex items-center gap-2.5 shrink-0">
            <span
              className="grid grid-cols-2 gap-[2px] w-[14px] h-[14px] shrink-0"
              aria-hidden="true"
            >
              <span className="rounded-[2px] bg-[#FF3B5C]" />
              <span className="rounded-[2px] bg-[#FFB800]" />
              <span className="rounded-[2px] bg-[#B5FF2A]" />
              <span className="rounded-[2px] bg-[#22D3EE]" />
            </span>
            <span className="font-brand font-extrabold text-base sm:text-lg tracking-tight text-white leading-none">
              COUCH·OS
            </span>
            <span
              title={wsConnected ? 'Console Link Online' : 'Reconnecting…'}
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                wsConnected
                  ? 'bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A]'
                  : 'bg-[#FF3B5C] tv-blink shadow-[0_0_8px_#FF3B5C]'
              }`}
            />
          </div>

          <nav
            aria-label="Input source"
            className="hidden lg:flex items-center h-full border-l border-white/[0.07] pl-2"
          >
            {MODE_TABS.map((item, idx) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTabChange(item.id, idx)}
                  aria-current={active ? 'page' : undefined}
                  className="hw-tab"
                >
                  <span className="hw-tab-num">{idx + 1}</span>
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Front-panel LCD: four port LEDs + room code */}
          <button
            type="button"
            onClick={handleOpenPairing}
            title="Controllers & room code"
            className="hw-lcd group inline-flex items-center gap-3 h-10 pl-3 pr-3.5 cursor-pointer hover:border-white/20 transition"
          >
            <span className="hidden sm:flex items-center gap-1.5">
              {[0, 1, 2, 3].map((slot) => {
                const player = connectedPlayers.find((p) => p.slot === slot);
                const active = Boolean(player && slotActivity[slot]);
                return (
                  <span key={slot} className="flex flex-col items-center gap-[3px]">
                    <span
                      className="w-2 h-2 rounded-full transition-all duration-100"
                      style={
                        player
                          ? {
                              backgroundColor: player.color,
                              boxShadow: active
                                ? `0 0 12px ${player.color}, 0 0 0 2px rgba(255,255,255,0.7)`
                                : `0 0 8px ${player.color}`,
                            }
                          : { backgroundColor: 'rgba(255,255,255,0.12)' }
                      }
                    />
                    <span
                      className="font-osd text-[10px] leading-none"
                      style={{ color: player ? player.color : 'rgba(255,255,255,0.25)' }}
                    >
                      {slot + 1}
                    </span>
                  </span>
                );
              })}
            </span>
            <span className="hidden sm:block h-6 w-px bg-white/10" />
            <span className="flex flex-col items-start leading-none">
              <span className="font-mono-tech text-[8px] font-bold tracking-[0.2em] text-white/35">
                ROOM
              </span>
              <span
                className={`font-osd text-[22px] leading-[0.85] tracking-[0.08em] osd-glow ${
                  wsConnected ? 'text-[#B5FF2A]' : 'text-[#FF3B5C]'
                }`}
              >
                {wsConnected ? (room?.roomCode ?? '····') : 'OFFLINE'}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={handleOpenPairing}
            className="console-btn-hot inline-flex items-center gap-1.5 h-10 px-3.5 rounded-[9px] font-mono-tech text-[11px] font-extrabold tracking-wide cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">PAIR PHONE</span>
            <span className="sm:hidden">PAIR</span>
          </button>

          <div className="hidden sm:flex items-center gap-1">
            <button
              type="button"
              onClick={handleToggleTvStream}
              title={tvStreamEnabled ? 'Stop TV broadcast' : 'Broadcast to a TV'}
              data-on={tvStreamEnabled}
              className="hw-chip h-10"
              style={{ ['--chip-on' as string]: '#FF3B5C' }}
            >
              {tvStreamEnabled ? (
                <span className="w-2 h-2 rounded-full bg-[#FF3B5C] tv-blink shadow-[0_0_8px_#FF3B5C]" />
              ) : (
                <Cast className="w-3.5 h-3.5" />
              )}
              {tvStreamEnabled ? 'ON AIR' : 'CAST'}
              {tvReceiverCount > 0 && (
                <span className="font-osd text-[14px] leading-none">{tvReceiverCount}</span>
              )}
            </button>
            {room && (
              <a
                href={`/tv/${room.roomCode}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => playSwitchClack(1.05)}
                title={`Open TV receiver (${tvUrl})`}
                aria-label="Open TV receiver"
                className="hw-chip hw-chip-icon h-10 w-10"
              >
                <Tv className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              type="button"
              onClick={handleToggleUiSfx}
              title={uiSfxOn ? 'Mute console sounds' : 'Enable console sounds'}
              aria-label={uiSfxOn ? 'Mute console sounds' : 'Enable console sounds'}
              className={`hw-chip hw-chip-icon h-10 w-10 ${uiSfxOn ? '' : 'text-[#FF3B5C]'}`}
            >
              {uiSfxOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Input sources on smaller screens */}
      <nav
        aria-label="Input source"
        className="lg:hidden flex items-center px-2 bg-[#07060B]/92 border-b border-white/[0.08] overflow-x-auto no-scrollbar shrink-0"
      >
        {MODE_TABS.map((item, idx) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleTabChange(item.id, idx)}
              aria-current={active ? 'page' : undefined}
              className="hw-tab h-11 shrink-0"
            >
              <span className="hw-tab-num">{idx + 1}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Full-Bleed 100% Width Console Stage */}
      <main className="flex-1 w-full flex flex-col min-w-0">
        <React.Suspense fallback={<ModeLoading />}>
        {tab === 'arena' && (
          <ArcadeHub
            players={connectedPlayers}
            onCanvasReady={handleCanvasReady}
            onLayoutSuggested={handleLayoutSuggested}
            onGameMetaChange={handleGameMetaChange}
            onRumbleSlot={handleRumbleSlot}
            onOpenPairing={handleOpenPairing}
            roomCode={room?.roomCode}
          />
        )}
        {tab === 'emulator' && (
          <div className="flex-1 w-full max-w-[1640px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col">
            <EmulatorHost
              onCanvasReady={handleCanvasReady}
              onLayoutSuggested={handleLayoutSuggested}
              onGameMetaChange={handleGameMetaChange}
            />
          </div>
        )}
        {tab === 'webgame' && (
          <div className="flex-1 w-full max-w-[1640px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col">
            <CustomGameHost
              players={connectedPlayers}
              onCanvasReady={handleCanvasReady}
              onLayoutSuggested={handleLayoutSuggested}
              onRumbleSlot={handleRumbleSlot}
              onGameMetaChange={handleGameMetaChange}
            />
          </div>
        )}
        {tab === 'tester' && (
          <div className="flex-1 w-full max-w-[1640px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col">
            <GamepadTester
              players={connectedPlayers}
              onTestRumble={(playerId) =>
                wsRef.current?.send({
                  type: 'host:rumble',
                  playerId,
                  durationMs: 180,
                  intensity: 1,
                })
              }
            />
          </div>
        )}
        </React.Suspense>
      </main>

      {/* Mounted once the first roster arrives so existing players on a
          page reload aren't announced as new arrivals. */}
      {room && <PlayerToasts players={allPlayers} />}

      {/* Slide-Over Wireless Controller & QR Pairing Drawer */}
      {pairingOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Wireless Controllers and QR Pairing"
        >
          {/* Blurred Backdrop Scrim */}
          <div
            className="absolute inset-0 bg-black/68 backdrop-blur-sm"
            onClick={() => {
              playSwitchClack(0.86);
              setPairingOpen(false);
            }}
          />

          {/* Right Slide-Over Obsidian Console Deck */}
          <aside className="animate-drawer-in relative z-10 w-full max-w-[400px] h-full flex flex-col bg-[#07060B] border-l border-white/[0.09] shadow-[-30px_0_80px_-20px_rgba(0,0,0,0.9)]">
            {/* Drawer Header */}
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-[#FF3B5C]/12 border border-[#FF3B5C]/40 flex items-center justify-center text-[#FF3B5C] shrink-0">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-osd text-[26px] leading-none text-white osd-glow">
                    CONTROLLERS
                  </h2>
                  <p className="font-mono-tech text-[10px] text-white/45 uppercase tracking-[0.14em] mt-1">
                    Scan · no app · 1–4 players
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  playSwitchClack(0.86);
                  setPairingOpen(false);
                }}
                aria-label="Close Pairing Drawer"
                className="hw-chip"
              >
                <span>ESC</span>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Scrollable Drawer Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* 1. Scannable QR Code + Giant Split-Flap Room Code */}
              <section className="rounded-lg bg-white/[0.025] border border-white/[0.08] p-4 space-y-4">
                <div className="flex items-center gap-4">
                  {/* Crisp White Padded Tile ONLY Around QR for Instant Phone Scanning */}
                  {qrDataUrl ? (
                    <div className="relative p-2.5 rounded-lg bg-white shadow-[0_0_32px_rgba(255,255,255,0.14)] shrink-0">
                      <span className="pointer-events-none absolute top-1.5 left-1.5 w-2.5 h-2.5 border-t-2 border-l-2 border-[#FF3B5C]" />
                      <span className="pointer-events-none absolute top-1.5 right-1.5 w-2.5 h-2.5 border-t-2 border-r-2 border-[#FF3B5C]" />
                      <span className="pointer-events-none absolute bottom-1.5 left-1.5 w-2.5 h-2.5 border-b-2 border-l-2 border-[#FF3B5C]" />
                      <span className="pointer-events-none absolute bottom-1.5 right-1.5 w-2.5 h-2.5 border-b-2 border-r-2 border-[#FF3B5C]" />
                      <img
                        src={qrDataUrl}
                        alt="Scan to pair phone controller"
                        className="w-32 h-32 block rounded-md"
                      />
                    </div>
                  ) : (
                    <div className="w-[148px] h-[148px] rounded-lg bg-white/10 animate-pulse shrink-0" />
                  )}

                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div>
                      <span className="font-osd text-[16px] leading-none text-white/45 block">
                        ROOM CODE
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyRoomCode}
                        title="Click to copy Room Code"
                        className="mt-1.5 w-full hw-lcd px-3 py-2 flex items-center justify-between gap-2 hover:border-[#B5FF2A]/50 transition cursor-pointer"
                      >
                        <span className="font-osd text-[38px] tracking-[0.1em] text-[#B5FF2A] leading-[0.8] osd-glow">
                          {room?.roomCode ?? '----'}
                        </span>
                        {copiedCode ? (
                          <Check className="w-4 h-4 text-[#B5FF2A] shrink-0" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-white/45 shrink-0" />
                        )}
                      </button>
                    </div>

                    <p className="text-[11px] text-white/60 leading-snug">
                      Point a phone camera at the code. Phones need to be on the
                      same Wi-Fi as this console.
                    </p>
                  </div>
                </div>

                {/* LAN URL Readout + Copy / Sim Actions */}
                <div className="space-y-2">
                  <div
                    className="hw-lcd px-3 py-2 font-mono-tech text-[11px] text-[#22D3EE] truncate"
                    title={joinUrl}
                  >
                    {joinUrl || 'CONNECTING TO LAN…'}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleCopyJoinUrl}
                      className="hw-chip h-9 justify-center"
                    >
                      {copiedUrl ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#B5FF2A]" /> COPIED
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> COPY URL
                        </>
                      )}
                    </button>
                    {room ? (
                      <a
                        href={`/play/${room.roomCode}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => playSwitchClack(1.1)}
                        className="hw-chip h-9 justify-center text-[#22D3EE]"
                      >
                        PHONE SIM <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="hw-chip h-9 justify-center opacity-45">
                        PHONE SIM
                      </span>
                    )}
                  </div>
                </div>
              </section>

              {/* 2. 6-Deck Wireless Pad Profile Selector */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-osd text-[18px] leading-none text-white/60">
                    PAD LAYOUT
                  </span>
                  <span className="font-mono-tech text-[10px] font-bold px-2 py-0.5 rounded bg-white/[0.06] border border-white/10 text-white/85">
                    {room
                      ? CONTROLLER_LAYOUT_META[room.defaultLayout].label
                      : 'SYNC'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {LAYOUT_PROFILES.map((item, idx) => {
                    const active = room?.defaultLayout === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          playSwitchClack(0.95 + idx * 0.05);
                          wsRef.current?.send({
                            type: 'host:set_layout',
                            layout: item.id,
                          });
                        }}
                        className={`rounded-lg px-2.5 py-2.5 text-left transition cursor-pointer border ${
                          active
                            ? 'bg-[#B5FF2A]/[0.07] border-[#B5FF2A]/50 shadow-[inset_0_0_16px_rgba(181,255,42,0.1)]'
                            : 'bg-white/[0.025] border-white/[0.08] hover:bg-white/[0.06] hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor: item.dotColor,
                              boxShadow: active
                                ? `0 0 10px ${item.dotColor}`
                                : 'none',
                            }}
                          />
                          <span
                            className={`w-4 h-1 rounded-full ${
                              active
                                ? 'bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A]'
                                : 'bg-white/15'
                            }`}
                          />
                        </div>
                        <div className="font-osd text-[20px] text-white leading-none">
                          {item.label}
                        </div>
                        <div className="font-mono-tech text-[9px] text-white/45 mt-1 truncate">
                          {item.sub}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 3. Connected P1-P4 Player Slots */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-osd text-[18px] leading-none text-white/60">
                    PLAYER PORTS
                  </span>
                  <span className="font-osd text-[18px] leading-none text-[#B5FF2A] osd-glow">
                    {connectedPlayers.length}/4 LIVE
                  </span>
                </div>

                <div className="space-y-2">
                  {[0, 1, 2, 3].map((slot) => {
                    const player = allPlayers.find((p) => p.slot === slot);
                    const reconnecting = Boolean(player && !player.connected);
                    const isInputActive = Boolean(player && slotActivity[slot]);
                    const isBuzzing = buzzingSlot === slot;

                    return (
                      <div
                        key={slot}
                        className={`rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 border transition ${
                          player
                            ? reconnecting
                              ? 'bg-white/[0.02] border-dashed border-[#FFB800]/45'
                              : 'bg-white/[0.045] border-white/[0.12]'
                            : 'bg-transparent border-dashed border-white/[0.09]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* Player Slot Pill LED */}
                          <div className="relative shrink-0">
                            <div
                              className="w-10 h-9 rounded-[5px] flex items-center justify-center font-osd text-[20px] leading-none transition-all"
                              style={
                                player
                                  ? {
                                      backgroundColor: player.color,
                                      color: '#07060B',
                                      boxShadow: isInputActive
                                        ? `0 0 0 2px #FFFFFF, 0 0 18px ${player.color}`
                                        : `0 0 12px ${player.color}77`,
                                    }
                                  : {
                                      backgroundColor: 'rgba(255,255,255,0.04)',
                                      color: 'rgba(255,255,255,0.3)',
                                      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
                                    }
                              }
                            >
                              P{slot + 1}
                            </div>
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#07060B] transition-all ${
                                isInputActive
                                  ? 'bg-[#B5FF2A] scale-125 shadow-[0_0_8px_#B5FF2A]'
                                  : reconnecting
                                    ? 'bg-[#FFB800] animate-pulse'
                                    : player
                                      ? 'bg-[#B5FF2A]/70'
                                      : 'bg-white/15'
                              }`}
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-display text-xs font-extrabold text-white truncate">
                                {player ? player.name : 'Open port'}
                              </span>
                              {player && (
                                <span
                                  className={`font-osd text-[14px] leading-none px-1.5 py-[3px] rounded shrink-0 ${
                                    player.transport === 'webrtc'
                                      ? 'bg-[#B5FF2A]/20 text-[#B5FF2A] border border-[#B5FF2A]/40'
                                      : 'bg-white/10 text-white/75 border border-white/15'
                                  }`}
                                >
                                  {player.transport === 'webrtc' ? 'RTC' : 'WS'}
                                </span>
                              )}
                            </div>
                            <div className="font-osd text-[15px] leading-tight text-white/45">
                              {player
                                ? reconnecting
                                  ? 'RECONNECTING… PORT HELD'
                                  : isInputActive
                                    ? 'LIVE INPUT'
                                    : player.latencyMs !== undefined
                                      ? `CONNECTED · ${player.latencyMs}MS`
                                      : 'CONNECTED'
                                : 'SCAN THE CODE TO JOIN'}
                            </div>
                          </div>
                        </div>

                        {player && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleBuzzPlayer(slot, player.id)}
                              title={`Buzz P${slot + 1} phone`}
                              className={`px-2 py-1 rounded-md font-mono-tech text-[10px] font-extrabold inline-flex items-center gap-1 cursor-pointer transition ${
                                isBuzzing
                                  ? 'bg-[#FF3B5C] text-white'
                                  : 'bg-[#FFB800]/18 hover:bg-[#FFB800]/30 text-[#FFB800] border border-[#FFB800]/35'
                              }`}
                            >
                              <Vibrate className="w-3 h-3" />
                              BUZZ
                            </button>
                            {slot > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  playSwitchClack(1.08);
                                  wsRef.current?.send({
                                    type: 'host:swap_slots',
                                    slotA: slot,
                                    slotB: slot - 1,
                                  });
                                }}
                                className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.14] text-white/75 hover:text-white cursor-pointer transition"
                                title={`Move up to P${slot}`}
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                            )}
                            {slot < 3 && (
                              <button
                                type="button"
                                onClick={() => {
                                  playSwitchClack(0.92);
                                  wsRef.current?.send({
                                    type: 'host:swap_slots',
                                    slotA: slot,
                                    slotB: slot + 1,
                                  });
                                }}
                                className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.14] text-white/75 hover:text-white cursor-pointer transition"
                                title={`Move down to P${slot + 2}`}
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                playSwitchClack(0.75);
                                wsRef.current?.send({
                                  type: 'host:kick_player',
                                  playerId: player.id,
                                });
                              }}
                              className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-[#FF3B5C] text-white/65 hover:text-white cursor-pointer transition"
                              title="Disconnect player"
                            >
                              <UserX className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 4. WebRTC TV Receiver Broadcast Card */}
              <section className="rounded-lg bg-white/[0.025] border border-white/[0.08] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-osd text-[18px] leading-none text-white/80 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-[#FF3B5C]" />
                    CAST TO A TV
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 font-osd text-[15px] leading-none px-2 py-[3px] rounded ${
                      tvReceiverCount > 0
                        ? 'bg-[#B5FF2A]/20 text-[#B5FF2A] border border-[#B5FF2A]/40'
                        : 'bg-white/[0.06] text-white/50 border border-white/10'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        tvReceiverCount > 0
                          ? 'bg-[#B5FF2A] animate-pulse'
                          : 'bg-white/30'
                      }`}
                    />
                    {tvReceiverCount} LIVE
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleToggleTvStream}
                    data-on={tvStreamEnabled}
                    style={{ ['--chip-on' as string]: '#FF3B5C' }}
                    className="hw-chip h-9 justify-center"
                  >
                    <Cast className="w-3.5 h-3.5" />
                    {tvStreamEnabled ? 'ON AIR' : 'START CAST'}
                  </button>
                  {room ? (
                    <a
                      href={`/tv/${room.roomCode}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => playSwitchClack(1.05)}
                      title={tvUrl}
                      className="hw-chip h-9 justify-center"
                    >
                      <Tv className="w-3.5 h-3.5 text-[#FF3B5C]" />
                      OPEN /TV
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="hw-chip h-9 justify-center opacity-45">
                      OPEN /TV
                    </span>
                  )}
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
