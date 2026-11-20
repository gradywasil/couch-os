import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CONTROLLER_LAYOUT_META,
  ControllerLayoutId,
  PlayerInfo,
} from '@couch-emu/shared';
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  Globe,
  Maximize2,
  Play,
  Sparkles,
} from 'lucide-react';
import { virtualGamepadManager } from '../lib/virtualGamepad';
import { playCartridgeInsert, playSwitchClack } from '../lib/uiSound';

interface CustomGameHostProps {
  players: PlayerInfo[];
  onCanvasReady: (canvas: HTMLCanvasElement | null) => void;
  onLayoutSuggested: (layout: ControllerLayoutId) => void;
  onRumbleSlot: (slot: number, durationMs: number, intensity: number) => void;
  onGameMetaChange: (meta: {
    mode: 'lobby' | 'webgame';
    title: string;
    systemName?: string;
  }) => void;
}

const WEB_GAME_PRESETS: Array<{ label: string; title: string; url: string }> = [
  {
    label: 'SDK Demo: Meteor Dodge',
    title: 'SDK Demo: Meteor Dodge',
    url: '/sdk-sample.html',
  },
];

const SDK_SNIPPET = `// 1. Standard Gamepad API (automatic for same-origin games)
function gameLoop() {
  const pads = navigator.getGamepads();
  if (pads[0]?.buttons[0].pressed) jump(0);
  requestAnimationFrame(gameLoop);
}

// 2. Or listen to CouchEmu postMessage bridge (works cross-origin!)
window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  if (e.data?.type === 'COUCH_EMU_INPUT') {
    const { slot, state } = e.data; // buttonsMask, axes: [lx, ly, rx, ry]
  }
  if (e.data?.type === 'COUCH_EMU_PLAYERS') {
    const { players } = e.data; // [{ id, name, color, slot }]
  }
});

// 3. Switch controller deck or trigger phone haptic rumble
window.parent.postMessage({ type: 'COUCH_EMU_SET_LAYOUT', layout: 'dualstick' }, '*');
window.parent.postMessage({ type: 'COUCH_EMU_RUMBLE', slot: 0, durationMs: 120 }, '*');`;

const VALID_LAYOUTS = new Set<string>(Object.keys(CONTROLLER_LAYOUT_META));
const RUMBLE_MIN_INTERVAL_MS = 60;

type BridgeMode = 'loading' | 'native' | 'bridge';

/** Public roster shape sent into the iframe (no clientId / internal fields). */
function toPublicRoster(players: PlayerInfo[]) {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    slot: p.slot,
    connected: p.connected,
    transport: p.transport,
  }));
}

/**
 * Normalizes user input into a safe iframe src. Only http(s), same-origin
 * relative paths and our own blob: URLs are allowed — never javascript:/data:.
 */
function normalizeGameUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  if (
    !/^[a-z][a-z0-9+.-]*:/i.test(candidate) &&
    !candidate.startsWith('/') &&
    !candidate.startsWith('.') &&
    /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(candidate)
  ) {
    candidate = `https://${candidate}`;
  }
  try {
    const url = new URL(candidate, window.location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return /^[a-z][a-z0-9+.-]*:/i.test(candidate) ? url.href : candidate;
    }
    return null;
  } catch {
    return null;
  }
}

function originOf(src: string): string {
  try {
    const url = new URL(src, window.location.href);
    // blob: URLs we mint carry our own origin
    return url.protocol === 'blob:' ? window.location.origin : url.origin;
  } catch {
    return '*';
  }
}

/** Picks the most likely game surface: the largest visible canvas. */
function findGameCanvas(doc: Document): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;
  doc.querySelectorAll('canvas').forEach((c) => {
    const area = (c.clientWidth || c.width) * (c.clientHeight || c.height);
    if (area > bestArea) {
      best = c;
      bestArea = area;
    }
  });
  return best;
}

export const CustomGameHost: React.FC<CustomGameHostProps> = ({
  players,
  onCanvasReady,
  onLayoutSuggested,
  onRumbleSlot,
  onGameMetaChange,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const canvasObserverRef = useRef<MutationObserver | null>(null);
  const reportedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Origin we post to; refined from the iframe's own messages (redirects). */
  const targetOriginRef = useRef<string>(window.location.origin);
  const lastPostedSeqRef = useRef<Map<number, number>>(new Map());
  const lastRumbleAtRef = useRef<Map<number, number>>(new Map());

  const playersRef = useRef(players);
  playersRef.current = players;
  const onCanvasReadyRef = useRef(onCanvasReady);
  const onLayoutSuggestedRef = useRef(onLayoutSuggested);
  const onRumbleSlotRef = useRef(onRumbleSlot);
  const onGameMetaChangeRef = useRef(onGameMetaChange);
  onCanvasReadyRef.current = onCanvasReady;
  onLayoutSuggestedRef.current = onLayoutSuggested;
  onRumbleSlotRef.current = onRumbleSlot;
  onGameMetaChangeRef.current = onGameMetaChange;

  const [urlInput, setUrlInput] = useState('/sdk-sample.html');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [activeSrc, setActiveSrc] = useState<string | null>('/sdk-sample.html');
  const [activeTitle, setActiveTitle] = useState('SDK Demo: Meteor Dodge');
  const [showDocs, setShowDocs] = useState(false);
  const [copiedSdk, setCopiedSdk] = useState(false);
  const [bridgeMode, setBridgeMode] = useState<BridgeMode>('loading');

  const postToGame = useCallback((message: unknown) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(message, targetOriginRef.current);
    } catch {
      // invalid target origin — drop
    }
  }, []);

  const reportCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (reportedCanvasRef.current === canvas) return;
    reportedCanvasRef.current = canvas;
    onCanvasReadyRef.current(canvas);
  }, []);

  const stopCanvasObserver = () => {
    canvasObserverRef.current?.disconnect();
    canvasObserverRef.current = null;
  };

  // Announce the initial preset so the room / TV show the right title.
  useEffect(() => {
    onGameMetaChangeRef.current({
      mode: 'webgame',
      title: 'SDK Demo: Meteor Dodge',
      systemName: 'Web Game Adapter',
    });
  }, []);

  // Full teardown on unmount.
  useEffect(() => {
    const iframe = iframeRef.current;
    return () => {
      stopCanvasObserver();
      virtualGamepadManager.detachFromIframe(iframe);
      reportedCanvasRef.current = null;
      onCanvasReadyRef.current(null);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // New source → previous game surface is gone.
  useEffect(() => {
    stopCanvasObserver();
    reportCanvas(null);
    setBridgeMode('loading');
    targetOriginRef.current = activeSrc ? originOf(activeSrc) : '*';
    lastPostedSeqRef.current.clear();
  }, [activeSrc, reportCanvas]);

  useEffect(() => {
    postToGame({ type: 'COUCH_EMU_PLAYERS', players: toPublicRoster(players) });
  }, [players, postToGame]);

  // Forward only the slots whose input actually changed.
  useEffect(() => {
    return virtualGamepadManager.onChange(() => {
      if (!iframeRef.current?.contentWindow) return;
      const posted = lastPostedSeqRef.current;
      for (const p of playersRef.current) {
        const state = virtualGamepadManager.getSlotState(p.slot);
        if (posted.get(p.slot) === state.seq) continue;
        posted.set(p.slot, state.seq);
        postToGame({
          type: 'COUCH_EMU_INPUT',
          slot: p.slot,
          playerId: p.id,
          state,
        });
      }
    });
  }, [postToGame]);

  // SDK bridge: only trust messages from our own iframe's window.
  useEffect(() => {
    const onMessage = (evt: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || evt.source !== win) return;
      const data = evt.data as { type?: unknown } | null;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
        return;
      }
      if (!data.type.startsWith('COUCH_EMU_')) return;
      // Follow redirects: the game's real origin is whatever it speaks from.
      targetOriginRef.current =
        evt.origin && evt.origin !== 'null' ? evt.origin : '*';

      if (data.type === 'COUCH_EMU_SET_LAYOUT') {
        const layout = (data as { layout?: unknown }).layout;
        if (typeof layout === 'string' && VALID_LAYOUTS.has(layout)) {
          onLayoutSuggestedRef.current(layout as ControllerLayoutId);
        }
      } else if (data.type === 'COUCH_EMU_RUMBLE') {
        const { slot, durationMs, intensity } = data as {
          slot?: unknown;
          durationMs?: unknown;
          intensity?: unknown;
        };
        if (typeof slot !== 'number' || !Number.isInteger(slot)) return;
        if (slot < 0 || slot > 7) return;
        const now = performance.now();
        const last = lastRumbleAtRef.current.get(slot) ?? 0;
        if (now - last < RUMBLE_MIN_INTERVAL_MS) return;
        lastRumbleAtRef.current.set(slot, now);
        const dur =
          typeof durationMs === 'number' && Number.isFinite(durationMs)
            ? Math.min(2000, Math.max(10, durationMs))
            : 120;
        const inten =
          typeof intensity === 'number' && Number.isFinite(intensity)
            ? Math.min(1, Math.max(0, intensity))
            : 0.8;
        onRumbleSlotRef.current(slot, dur, inten);
      } else if (data.type === 'COUCH_EMU_HELLO') {
        postToGame({
          type: 'COUCH_EMU_PLAYERS',
          players: toPublicRoster(playersRef.current),
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postToGame]);

  const replaceBlobUrl = (next: string | null) => {
    if (blobUrlRef.current && blobUrlRef.current !== next) {
      URL.revokeObjectURL(blobUrlRef.current);
    }
    blobUrlRef.current = next;
  };

  const loadPreset = (preset: { title: string; url: string }) => {
    playCartridgeInsert();
    replaceBlobUrl(null);
    setUrlError(null);
    setUrlInput(preset.url);
    setActiveSrc(preset.url);
    setActiveTitle(preset.title);
    onGameMetaChangeRef.current({
      mode: 'webgame',
      title: preset.title,
      systemName: 'Web Game Adapter',
    });
  };

  const handleLoadUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeGameUrl(urlInput);
    if (!normalized) {
      setUrlError('Enter an http(s) URL or a path like /my-game.html');
      return;
    }
    playCartridgeInsert();
    replaceBlobUrl(null);
    setUrlError(null);
    setUrlInput(normalized);
    setActiveSrc(normalized);
    let title = normalized;
    try {
      const u = new URL(normalized, window.location.href);
      title = u.origin === window.location.origin ? u.pathname : u.host;
    } catch {
      // keep raw
    }
    setActiveTitle(title);
    onGameMetaChangeRef.current({
      mode: 'webgame',
      title,
      systemName: 'Web Game Adapter',
    });
  };

  const handleLoadHtmlFile = (file: File) => {
    playCartridgeInsert();
    const nextBlob = URL.createObjectURL(file);
    replaceBlobUrl(nextBlob);
    setUrlError(null);
    setActiveSrc(nextBlob);
    setActiveTitle(file.name);
    onGameMetaChangeRef.current({
      mode: 'webgame',
      title: file.name.replace(/\.html?$/i, ''),
      systemName: 'Local HTML5 Game',
    });
  };

  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    stopCanvasObserver();
    lastPostedSeqRef.current.clear();

    const native = virtualGamepadManager.attachToIframe(iframe);
    setBridgeMode(native ? 'native' : 'bridge');
    postToGame({
      type: 'COUCH_EMU_PLAYERS',
      players: toPublicRoster(playersRef.current),
    });

    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      doc = null;
    }
    if (!doc) {
      // Cross-origin: canvas not capturable for /tv casting.
      reportCanvas(null);
      return;
    }
    reportCanvas(findGameCanvas(doc));

    // Many games create (or replace) their canvas after load.
    const observer = new MutationObserver(() => {
      const current = reportedCanvasRef.current;
      if (current && current.isConnected) return;
      reportCanvas(findGameCanvas(doc as Document));
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    canvasObserverRef.current = observer;
  };

  const handleCopySdk = () => {
    playSwitchClack(1.1);
    void navigator.clipboard?.writeText(SDK_SNIPPET).catch(() => {});
    setCopiedSdk(true);
    window.setTimeout(() => setCopiedSdk(false), 1800);
  };

  return (
    <div className="flex flex-col h-full gap-3.5 text-[#F5F4F0]">
      {/* Dark Obsidian Adapter Bridge Deck */}
      <div className="console-deck rounded-2xl overflow-hidden shrink-0">
        <div className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <form
            onSubmit={handleLoadUrl}
            className="flex items-center gap-2 flex-1 min-w-[240px]"
          >
            <div
              className={`crt-well flex items-center gap-2 flex-1 rounded-xl px-3 py-1.5 focus-within:ring-2 focus-within:ring-[#FF3B5C]/60 ${
                urlError ? 'ring-2 ring-[#FF3B5C]/70' : ''
              }`}
              title={urlError ?? undefined}
            >
              <Globe className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (urlError) setUrlError(null);
                }}
                aria-label="Web game URL"
                aria-invalid={Boolean(urlError)}
                spellCheck={false}
                autoComplete="off"
                placeholder="https://your-web-game.example or /sdk-sample.html"
                className="flex-1 bg-transparent text-xs font-mono-tech font-bold text-[#F5F4F0] outline-none placeholder:text-white/30"
              />
            </div>
            <button
              type="submit"
              className="console-btn-hot inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-mono-tech text-xs font-extrabold uppercase tracking-wider cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" /> LAUNCH
            </button>
            {urlError && (
              <span
                role="alert"
                className="hidden lg:inline font-mono-tech text-[10px] font-bold text-[#FF8FA3] whitespace-nowrap"
              >
                {urlError}
              </span>
            )}
          </form>

          <div className="flex flex-wrap items-center gap-1.5">
            {WEB_GAME_PRESETS.map((preset) => {
              const isCurrent = activeSrc === preset.url;
              return (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() => loadPreset(preset)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-mono-tech text-[11px] font-extrabold uppercase tracking-wide cursor-pointer ${
                    isCurrent
                      ? 'console-btn border-[#B5FF2A]/55 text-[#B5FF2A]'
                      : 'console-btn text-white/75'
                  }`}
                >
                  <Sparkles className="w-3 h-3 text-[#B5FF2A]" />
                  {preset.label}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                playSwitchClack(0.95);
                fileInputRef.current?.click();
              }}
              className="console-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-mono-tech text-[11px] font-extrabold uppercase tracking-wide cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#22D3EE]" /> LOCAL .HTML
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".html,.htm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLoadHtmlFile(f);
                e.target.value = '';
              }}
            />

            <button
              type="button"
              onClick={() => {
                playSwitchClack(showDocs ? 0.9 : 1.12);
                setShowDocs((s) => !s);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-mono-tech text-[11px] font-extrabold uppercase tracking-wide cursor-pointer ${
                showDocs
                  ? 'console-btn border-[#22D3EE]/60 text-[#22D3EE] shadow-[0_0_16px_rgba(34,211,238,0.22)]'
                  : 'console-btn text-white/85'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" /> SDK BRIDGE
            </button>

            <button
              type="button"
              onClick={() => {
                playSwitchClack(1.05);
                iframeRef.current?.requestFullscreen?.().catch(() => {});
              }}
              className="console-btn p-1.5 rounded-xl cursor-pointer"
              title="Fullscreen"
            >
              <Maximize2 className="w-3.5 h-3.5 text-[#F5F4F0]" />
            </button>
          </div>
        </div>
      </div>

      {/* Collapsible SDK Bridge Docs & Code Snippet Card */}
      {showDocs && (
        <div className="console-deck rounded-2xl overflow-hidden text-xs animate-spring-pop shrink-0">
          <div className="h-1 w-full smpte-bar opacity-85" />
          <div className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Gamepad2 className="w-4 h-4 text-[#FF3B5C]" />
                <span className="font-brand font-extrabold text-sm text-[#F5F4F0] tracking-tight">
                  COUCH·OS WEB ADAPTER // POSTMESSAGE SDK
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopySdk}
                  className={`${
                    copiedSdk ? 'console-btn-volt' : 'console-btn'
                  } inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono-tech text-[10px] font-extrabold uppercase tracking-wider cursor-pointer`}
                >
                  {copiedSdk ? (
                    <>
                      <Check className="w-3 h-3" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-[#22D3EE]" /> Copy Snippet
                    </>
                  )}
                </button>
                <a
                  href="/sdk-sample.html"
                  target="_blank"
                  rel="noreferrer"
                  className="console-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono-tech text-[10px] font-extrabold uppercase tracking-wider"
                >
                  Inspect Sample <ExternalLink className="w-3 h-3 text-[#22D3EE]" />
                </a>
              </div>
            </div>
            <pre className="crt-well rounded-xl p-3.5 overflow-x-auto text-[11px] text-[#B5FF2A] font-mono-tech leading-relaxed">
              {SDK_SNIPPET}
            </pre>
          </div>
        </div>
      )}

      {/* Sony PVM Obsidian Housing Framing the Embedded HTML5 Viewport */}
      <div className="pvm-housing rounded-[24px] p-2.5 flex flex-col flex-1 min-h-[420px] gap-2">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-1.5 w-8 rounded-full smpte-bar shrink-0" />
            <span className="font-mono-tech text-[10px] font-bold uppercase tracking-[0.18em] text-white/55 truncate">
              WEB ADAPTER // {activeTitle}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {bridgeMode !== 'loading' && (
              <span
                className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-md font-mono-tech text-[9px] font-extrabold uppercase tracking-widest border ${
                  bridgeMode === 'native'
                    ? 'border-[#22D3EE]/45 text-[#22D3EE] bg-[#22D3EE]/10'
                    : 'border-[#FFB800]/45 text-[#FFB800] bg-[#FFB800]/10'
                }`}
                title={
                  bridgeMode === 'native'
                    ? 'Same-origin: navigator.getGamepads() is patched and the canvas can be cast to /tv'
                    : 'Cross-origin: input arrives via the postMessage SDK bridge; /tv casting unavailable'
                }
              >
                {bridgeMode === 'native' ? 'GAMEPAD API' : 'SDK BRIDGE · NO CAST'}
              </span>
            )}
            <span className="flex items-center gap-2 font-mono-tech text-[10px] font-extrabold text-[#B5FF2A]">
              <span className="w-2 h-2 rounded-full bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A]" />
              {players.length}P LINKED
            </span>
          </div>
        </div>

        <div className="relative flex-1 min-h-[380px] crt-well rounded-[16px] overflow-hidden bg-[#05050A]">
          {activeSrc && (
            <iframe
              ref={iframeRef}
              src={activeSrc}
              title={activeTitle}
              onLoad={handleIframeLoad}
              allow="autoplay; fullscreen; gamepad"
              className="w-full h-full border-0 block"
            />
          )}
          {activeSrc && bridgeMode === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#05050A]/85 pointer-events-none">
              <div className="w-10 h-10 border-[3px] border-[#22D3EE] border-t-[#FF3B5C] rounded-full animate-spin" />
              <p className="font-mono-tech text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#22D3EE]">
                LOADING WEB CARTRIDGE…
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


