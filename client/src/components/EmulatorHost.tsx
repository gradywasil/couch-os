import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Nostalgist } from 'nostalgist';
import {
  CONSOLE_PROFILES,
  ConsoleProfile,
  ControllerLayoutId,
  detectConsoleProfile,
} from '@couch-emu/shared';
import {
  AlertTriangle,
  Disc3,
  Download,
  FolderOpen,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { virtualGamepadManager } from '../lib/virtualGamepad';
import { webAudioTap } from '../lib/audioTap';
import {
  playCartridgeEject,
  playCartridgeInsert,
  playConfirmPop,
  playSwitchClack,
} from '../lib/uiSound';

interface SavedSlot {
  blob: Blob;
  thumbnailUrl?: string;
  savedAt: number;
  romName: string;
}

interface EmulatorHostProps {
  onCanvasReady: (canvas: HTMLCanvasElement | null) => void;
  onLayoutSuggested: (layout: ControllerLayoutId) => void;
  onGameMetaChange: (meta: {
    mode: 'lobby' | 'emulator';
    title: string;
    systemName?: string;
  }) => void;
}

type BootErrorKind = 'detect' | 'empty' | 'network' | 'boot';

interface BootError {
  kind: BootErrorKind;
  title: string;
  detail: string;
  raw?: string;
}

type LaunchOptions = Parameters<typeof Nostalgist.launch>[0];

const SHORT_SYSTEM_LABELS: Record<string, string> = {
  nes: 'NES',
  snes: 'SNES',
  gba: 'GBA',
  gb: 'GBC',
  genesis: 'GENESIS',
  n64: 'N64',
  pce: 'PCE',
};

const ROM_ACCEPT = Array.from(
  new Set([...CONSOLE_PROFILES.flatMap((p) => p.extensions), '.zip']),
).join(',');

/**
 * Explicit RetroPad binds for P1–P4 against the W3C "standard" mapping that
 * virtual phone pads (and most physical pads) expose. RetroArch's rwebpad
 * autoconfig usually matches these, but pinning them means every core gets
 * positional input even when autoconfig can't identify the device name.
 *
 * Positional RetroPad → console mapping is then handled by each core:
 *   NES/GB/PCE: B=South, A=East · SNES: B/A/Y/X = S/E/W/N · GBA adds L/R
 *   Genesis (genesis_plus_gx): A=West(Y), B=South(B), C=East(A),
 *     X=L1, Y=North(X), Z=R1 — matches the phone's 6-button deck
 *   N64 (mupen64plus_next): A=South, B=West, Z=L2, C-buttons=right stick
 */
function buildRetroPadBinds(): Record<string, string | number> {
  const buttons: Array<[string, number]> = [
    ['b', 0],
    ['a', 1],
    ['y', 2],
    ['x', 3],
    ['l', 4],
    ['r', 5],
    ['l2', 6],
    ['r2', 7],
    ['select', 8],
    ['start', 9],
    ['l3', 10],
    ['r3', 11],
    ['up', 12],
    ['down', 13],
    ['left', 14],
    ['right', 15],
  ];
  const axes: Array<[string, string]> = [
    ['l_x_plus', '+0'],
    ['l_x_minus', '-0'],
    ['l_y_plus', '+1'],
    ['l_y_minus', '-1'],
    ['r_x_plus', '+2'],
    ['r_x_minus', '-2'],
    ['r_y_plus', '+3'],
    ['r_y_minus', '-3'],
  ];
  const cfg: Record<string, string | number> = {};
  for (let p = 1; p <= 4; p++) {
    cfg[`input_player${p}_joypad_index`] = p - 1;
    for (const [name, idx] of buttons) {
      cfg[`input_player${p}_${name}_btn`] = String(idx);
    }
    for (const [name, axis] of axes) {
      cfg[`input_player${p}_${name}_axis`] = axis;
    }
  }
  return cfg;
}

const RETROPAD_BINDS = buildRetroPadBinds();

function describeBootError(
  err: unknown,
  fileName: string,
  core: string,
  systemLabel: string,
): BootError {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('load failed') ||
    lower.includes('404') ||
    lower.includes('cors')
  ) {
    return {
      kind: 'network',
      title: `Couldn't download the ${core} core`,
      detail:
        'Emulator cores stream from the jsDelivr CDN on first boot. Check the host computer’s internet connection, then retry.',
      raw,
    };
  }
  return {
    kind: 'boot',
    title: `${systemLabel} couldn't boot this cartridge`,
    detail: `“${fileName}” may be a bad dump, a compressed format this core can't read, or a ROM for a different console. Try another core below.`,
    raw: raw || undefined,
  };
}

export const EmulatorHost: React.FC<EmulatorHostProps> = ({
  onCanvasReady,
  onLayoutSuggested,
  onGameMetaChange,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emulatorRef = useRef<Nostalgist | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stateInputRef = useRef<HTMLInputElement>(null);
  const launchAbortRef = useRef<AbortController | null>(null);
  const launchTokenRef = useRef(0);
  const lastFileRef = useRef<File | null>(null);
  const timersRef = useRef<number[]>([]);
  const noticeTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  // Latest-callback refs so effects/cleanup never call stale props.
  const onCanvasReadyRef = useRef(onCanvasReady);
  const onLayoutSuggestedRef = useRef(onLayoutSuggested);
  const onGameMetaChangeRef = useRef(onGameMetaChange);
  onCanvasReadyRef.current = onCanvasReady;
  onLayoutSuggestedRef.current = onLayoutSuggested;
  onGameMetaChangeRef.current = onGameMetaChange;

  const [selectedCore, setSelectedCore] = useState<string>('auto');
  const [romName, setRomName] = useState<string | null>(null);
  const [systemName, setSystemName] = useState<string | null>(null);
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'running' | 'paused' | 'error'
  >('idle');
  const [bootError, setBootError] = useState<BootError | null>(null);
  const [crtEnabled, setCrtEnabled] = useState<boolean>(true);
  const [muted, setMuted] = useState<boolean>(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const [savedState, setSavedState] = useState<SavedSlot | null>(null);
  const savedStateRef = useRef<SavedSlot | null>(null);
  savedStateRef.current = savedState;
  const [stateBusy, setStateBusy] = useState<'saving' | 'loading' | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  const flashNotice = useCallback((ok: boolean, text: string) => {
    if (!mountedRef.current) return;
    setNotice({ ok, text });
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      if (mountedRef.current) setNotice(null);
    }, 2600);
  }, []);

  const clearTimers = () => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  };

  /** Stops any in-flight launch and tears down the running core. */
  const cleanupEmulator = useCallback(() => {
    launchTokenRef.current += 1;
    launchAbortRef.current?.abort();
    launchAbortRef.current = null;
    clearTimers();
    const emu = emulatorRef.current;
    emulatorRef.current = null;
    if (emu) {
      try {
        emu.exit({ removeCanvas: true });
      } catch {
        // ignore exit errors
      }
    }
    stageRef.current?.querySelectorAll('canvas').forEach((c) => c.remove());
    canvasRef.current = null;
    onCanvasReadyRef.current(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupEmulator();
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      const thumb = savedStateRef.current?.thumbnailUrl;
      if (thumb) URL.revokeObjectURL(thumb);
    };
  }, [cleanupEmulator]);

  const resolveProfile = (
    fileName: string,
    coreOverride: string,
  ): ConsoleProfile | undefined => {
    if (coreOverride !== 'auto') {
      // An explicit core wins: derive layout/label from the core, not the
      // extension (e.g. a .bin forced onto a different core).
      return CONSOLE_PROFILES.find((p) => p.core === coreOverride);
    }
    return detectConsoleProfile(fileName);
  };

  const launchRomFile = async (file: File, coreOverride = selectedCore) => {
    lastFileRef.current = file;
    cleanupEmulator();
    setBootError(null);

    if (file.size === 0) {
      setStatus('error');
      setBootError({
        kind: 'empty',
        title: 'This cartridge is blank',
        detail: `“${file.name}” is an empty file. Re-download or re-dump the ROM and try again.`,
      });
      return;
    }

    const profile = resolveProfile(file.name, coreOverride);
    const core = coreOverride !== 'auto' ? coreOverride : profile?.core;
    if (!core) {
      setStatus('error');
      setBootError({
        kind: 'detect',
        title: 'Which console is this for?',
        detail: `Couldn't auto-detect a system for “${file.name}”. Pick the matching core and the cartridge will boot right away.`,
      });
      return;
    }

    playCartridgeInsert();
    setStatus('loading');

    const layout: ControllerLayoutId = profile?.layout ?? 'snes';
    const sysLabel = profile?.name ?? core;
    const token = launchTokenRef.current;
    const abort = new AbortController();
    launchAbortRef.current = abort;

    try {
      webAudioTap.install();

      const stage = stageRef.current;
      if (!stage) throw new Error('Stage container missing');
      const canvas = document.createElement('canvas');
      canvas.className = 'w-full h-full object-contain block';
      stage.prepend(canvas);
      canvasRef.current = canvas;

      const instance = await Nostalgist.launch({
        element: canvas,
        core,
        rom: file,
        signal: abort.signal,
        retroarchConfig: {
          pause_nonactive: false,
          input_autodetect_enable: true,
          input_max_users: 4,
          audio_mute_enable: mutedRef.current,
          ...RETROPAD_BINDS,
        } as LaunchOptions['retroarchConfig'],
      });

      // A newer launch, eject or unmount happened while we were booting.
      if (token !== launchTokenRef.current || !mountedRef.current) {
        try {
          instance.exit({ removeCanvas: true });
        } catch {
          // ignore
        }
        return;
      }

      launchAbortRef.current = null;
      emulatorRef.current = instance;
      setRomName(file.name);
      setSystemName(sysLabel);
      setStatus('running');

      // Some cores attach gamepad listeners a beat after boot.
      timersRef.current.push(
        window.setTimeout(() => virtualGamepadManager.reannounceAll(), 250),
        window.setTimeout(() => virtualGamepadManager.reannounceAll(), 1000),
      );

      onCanvasReadyRef.current(canvas);
      onLayoutSuggestedRef.current(layout);
      onGameMetaChangeRef.current({
        mode: 'emulator',
        title: file.name.replace(/\.[^.]+$/, ''),
        systemName: sysLabel,
      });
    } catch (err) {
      if (token !== launchTokenRef.current || !mountedRef.current) return;
      launchAbortRef.current = null;
      stageRef.current?.querySelectorAll('canvas').forEach((c) => c.remove());
      canvasRef.current = null;
      setStatus('error');
      setBootError(describeBootError(err, file.name, core, sysLabel));
    }
  };

  const retryWithCore = (core: string) => {
    const file = lastFileRef.current;
    playSwitchClack(1.05);
    setSelectedCore(core);
    if (file) void launchRomFile(file, core);
  };

  const handleTogglePause = () => {
    const emu = emulatorRef.current;
    if (!emu) return;
    playSwitchClack(status === 'running' ? 0.9 : 1.12);
    if (status === 'running') {
      emu.pause();
      setStatus('paused');
    } else if (status === 'paused') {
      emu.resume();
      setStatus('running');
    }
  };

  const handleRestart = () => {
    const emu = emulatorRef.current;
    if (!emu) return;
    playSwitchClack(0.85);
    try {
      emu.restart();
      if (status === 'paused') {
        emu.resume();
        setStatus('running');
      }
    } catch {
      flashNotice(false, 'Restart failed');
    }
  };

  const handleSaveState = async () => {
    const emu = emulatorRef.current;
    if (!emu || !romName || stateBusy) return;
    setStateBusy('saving');
    try {
      const res = await emu.saveState();
      if (!mountedRef.current) return;
      const thumbnailUrl = res.thumbnail
        ? URL.createObjectURL(res.thumbnail)
        : undefined;
      setSavedState((prev) => {
        if (prev?.thumbnailUrl) URL.revokeObjectURL(prev.thumbnailUrl);
        return {
          blob: res.state,
          thumbnailUrl,
          savedAt: Date.now(),
          romName,
        };
      });
      playConfirmPop(true);
      flashNotice(true, 'State saved');
    } catch {
      flashNotice(false, 'Save failed — this core may not support states');
    } finally {
      if (mountedRef.current) setStateBusy(null);
    }
  };

  const loadStateBlob = async (blob: Blob) => {
    const emu = emulatorRef.current;
    if (!emu || stateBusy) return;
    setStateBusy('loading');
    playSwitchClack(1.18);
    try {
      await emu.loadState(blob);
      if (status === 'paused') {
        emu.resume();
        setStatus('running');
      }
      flashNotice(true, 'State loaded');
    } catch {
      flashNotice(false, 'Load failed — state is from another game or core');
    } finally {
      if (mountedRef.current) setStateBusy(null);
    }
  };

  const handleLoadState = () => {
    if (savedState && savedState.romName === romName) {
      void loadStateBlob(savedState.blob);
    }
  };

  const handleDownloadState = () => {
    if (!savedState) return;
    playSwitchClack(1.0);
    const url = URL.createObjectURL(savedState.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${savedState.romName.replace(/\.[^.]+$/, '')}.state`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking synchronously can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleToggleMute = () => {
    const nextMuted = !muted;
    playSwitchClack(nextMuted ? 0.85 : 1.1);
    setMuted(nextMuted);
    const emu = emulatorRef.current;
    if (emu) {
      try {
        // RetroArch's own MUTE toggle: affects only the emulator, never the
        // console UI sounds or other tapped audio graphs.
        emu.sendCommand('MUTE');
      } catch {
        // ignore
      }
    }
  };

  const handleEject = () => {
    playCartridgeEject();
    cleanupEmulator();
    setRomName(null);
    setSystemName(null);
    setStatus('idle');
    setBootError(null);
    onGameMetaChangeRef.current({
      mode: 'lobby',
      title: 'Couch Console Lobby',
    });
  };

  const handleFullscreen = () => {
    playSwitchClack(1.05);
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    } else {
      void stage.requestFullscreen?.().catch(() => {});
    }
  };

  const canLoadSaved = Boolean(savedState && savedState.romName === romName);

  return (
    <div className="flex flex-col h-full gap-3.5 text-[#F5F4F0]">
      {/* Dark Obsidian Console Deck Control Strip */}
      <div className="console-deck rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Core Selector inside recessed crt-well */}
          <div className="crt-well flex items-center gap-2 rounded-xl px-2.5 py-1.5">
            <span className="text-[10px] font-mono-tech font-extrabold uppercase tracking-[0.16em] text-[#22D3EE]">
              CORE
            </span>
            <select
              value={selectedCore}
              onChange={(e) => {
                playSwitchClack(1.05);
                setSelectedCore(e.target.value);
              }}
              className="bg-transparent text-xs font-mono-tech font-bold text-[#F5F4F0] outline-none cursor-pointer pr-1"
            >
              <option value="auto" className="bg-[#111019] text-[#F5F4F0]">
                Auto-detect from ROM
              </option>
              {CONSOLE_PROFILES.map((p) => (
                <option
                  key={p.id}
                  value={p.core}
                  className="bg-[#111019] text-[#F5F4F0]"
                >
                  {p.name} ({p.core})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              playSwitchClack(0.95);
              fileInputRef.current?.click();
            }}
            className="console-btn-hot inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-mono-tech text-xs font-extrabold uppercase tracking-wider cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            LOAD ROM
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ROM_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void launchRomFile(file);
              e.target.value = '';
            }}
          />
          <input
            ref={stateInputRef}
            type="file"
            accept=".state,.st,.ss,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadStateBlob(file);
              e.target.value = '';
            }}
          />
        </div>

        {/* Playback, Save States & CRT Control Strip */}
        <div className="flex flex-wrap items-center gap-1.5">
          {status === 'running' || status === 'paused' ? (
            <>
              <button
                type="button"
                onClick={handleTogglePause}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-mono-tech text-[11px] font-extrabold uppercase cursor-pointer ${
                  status === 'paused' ? 'console-btn-volt' : 'console-btn'
                }`}
              >
                {status === 'running' ? (
                  <>
                    <Pause className="w-3.5 h-3.5 text-[#FFB800]" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 text-[#090B06]" /> Resume
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleRestart}
                className="console-btn inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-mono-tech text-[11px] font-extrabold uppercase cursor-pointer"
                title="Restart Console"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#22D3EE]" />
                <span className="hidden sm:inline">Restart</span>
              </button>

              <button
                type="button"
                onClick={() => void handleSaveState()}
                disabled={stateBusy !== null}
                className="console-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-mono-tech text-[11px] font-extrabold uppercase cursor-pointer disabled:opacity-50 disabled:cursor-wait"
              >
                {stateBusy === 'saving' ? (
                  <RotateCw className="w-3.5 h-3.5 text-[#B5FF2A] animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5 text-[#B5FF2A]" />
                )}{' '}
                Save State
              </button>

              <button
                type="button"
                onClick={() => {
                  playSwitchClack(0.95);
                  stateInputRef.current?.click();
                }}
                disabled={stateBusy !== null}
                className="console-btn p-1.5 rounded-xl cursor-pointer disabled:opacity-50"
                title="Load a .state file from disk"
                aria-label="Load a .state file from disk"
              >
                <Upload className="w-3.5 h-3.5 text-[#22D3EE]" />
              </button>

              {savedState && canLoadSaved && (
                <div className="crt-well flex items-center gap-1.5 pl-1.5 pr-1.5 py-1 rounded-xl">
                  {savedState.thumbnailUrl && (
                    <img
                      src={savedState.thumbnailUrl}
                      alt="Saved state"
                      className="w-7 h-5 rounded object-cover border border-white/15"
                    />
                  )}
                  <button
                    type="button"
                    onClick={handleLoadState}
                    disabled={stateBusy !== null}
                    title={`Saved ${new Date(savedState.savedAt).toLocaleTimeString()}`}
                    className="console-btn-volt inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono-tech text-[10px] font-extrabold uppercase cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                  >
                    {stateBusy === 'loading' ? (
                      <RotateCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Upload className="w-3 h-3" />
                    )}{' '}
                    Load State
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadState}
                    className="console-btn p-1 rounded-lg cursor-pointer"
                    title="Download .state file"
                  >
                    <Download className="w-3 h-3 text-[#F5F4F0]" />
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handleEject}
                className="console-btn inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-mono-tech text-[11px] font-extrabold uppercase text-[#FF3B5C] hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" /> Eject
              </button>
            </>
          ) : null}

          <button
            type="button"
            onClick={() => {
              playSwitchClack(crtEnabled ? 0.9 : 1.15);
              setCrtEnabled((v) => !v);
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-mono-tech text-[11px] font-extrabold uppercase cursor-pointer ${
              crtEnabled
                ? 'console-btn border-[#22D3EE]/60 text-[#22D3EE] shadow-[0_0_16px_rgba(34,211,238,0.22)]'
                : 'console-btn text-white/55'
            }`}
            title="Toggle CRT Scanlines"
          >
            <Sparkles className="w-3.5 h-3.5" /> CRT
          </button>

          <button
            type="button"
            onClick={handleToggleMute}
            className="console-btn p-1.5 rounded-xl cursor-pointer"
            title={muted ? 'Unmute emulator' : 'Mute emulator'}
            aria-label={muted ? 'Unmute emulator' : 'Mute emulator'}
            aria-pressed={muted}
          >
            {muted ? (
              <VolumeX className="w-3.5 h-3.5 text-[#FF3B5C]" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-[#B5FF2A]" />
            )}
          </button>

          <button
            type="button"
            onClick={handleFullscreen}
            className="console-btn p-1.5 rounded-xl cursor-pointer"
            title="Fullscreen TV Mode"
            aria-label="Fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5 text-[#F5F4F0]" />
          </button>
        </div>
      </div>

      {/* Sony PVM Obsidian Monitor Frame */}
      <div className="pvm-housing rounded-[24px] p-3 flex flex-col flex-1 min-h-[430px] gap-2">
        {/* PVM Top Bezel Engraving */}
        <div className="flex items-center justify-between px-1.5">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-8 rounded-full smpte-bar inline-block" />
            <span className="font-mono-tech text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">
              RETRO WASM // CARTRIDGE BAY
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono-tech text-[10px] font-bold uppercase tracking-widest">
            <span
              className={`w-2 h-2 rounded-full ${
                status === 'running'
                  ? 'bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A]'
                  : status === 'paused'
                    ? 'bg-[#FFB800] shadow-[0_0_8px_#FFB800]'
                    : status === 'loading'
                      ? 'bg-[#22D3EE] animate-pulse'
                      : status === 'error'
                        ? 'bg-[#FF3B5C]'
                        : 'bg-white/25'
              }`}
            />
            <span className="text-white/55">
              {status === 'running'
                ? 'RUN'
                : status === 'paused'
                  ? 'HOLD'
                  : status === 'loading'
                    ? 'BOOT'
                    : status === 'error'
                      ? 'FAULT'
                      : 'BAY READY'}
            </span>
          </div>
        </div>

        {/* Recessed CRT Screen Stage */}
        <div
          ref={stageRef}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (!dragging) setDragging(true);
          }}
          onDragLeave={(e) => {
            // Ignore leave events fired when crossing into child elements.
            const next = e.relatedTarget as Node | null;
            if (next && e.currentTarget.contains(next)) return;
            setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void launchRomFile(file);
          }}
          className={`relative flex-1 min-h-[385px] crt-well hw-grid-bg rounded-[16px] overflow-hidden flex items-center justify-center transition ${
            dragging ? 'ring-2 ring-[#FF3B5C] border-[#FF3B5C]' : ''
          }`}
        >
          {crtEnabled && status === 'running' && (
            <div className="crt-scanlines absolute inset-0 z-10" />
          )}

          {/* Top-Loading Cartridge Bay Dropzone (Idle) */}
          {status === 'idle' && (
            <div className="w-full max-w-xl px-4 sm:px-5 py-6 text-center animate-spring-pop">
              <div
                className={`console-deck rounded-2xl overflow-hidden border transition relative ${
                  dragging
                    ? 'border-[#FF3B5C] ring-2 ring-[#FF3B5C]/45 scale-[1.01]'
                    : 'border-white/14'
                }`}
              >
                {/* SMPTE Top Accent Ribbon */}
                <div className="h-1.5 w-full smpte-bar" />

                <div className="p-6 sm:p-7">
                  {/* Molded Dark Metallic Cartridge Mouth */}
                  <div className="mx-auto mb-5 w-52 sm:w-60">
                    <div className="h-4 rounded-lg crt-well border border-white/12 flex items-center justify-center px-3 shadow-[inset_0_3px_10px_rgba(0,0,0,0.95)]">
                      <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-white/5 via-white/18 to-white/5" />
                    </div>
                  </div>

                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full crt-well border border-[#FFB800]/35 font-mono-tech text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#FFB800] mb-3">
                    <Disc3 className="w-3.5 h-3.5 text-[#FF3B5C]" />
                    TOP-LOADING CARTRIDGE BAY
                  </div>

                  <h3 className="font-brand text-xl sm:text-2xl font-extrabold text-[#F5F4F0] tracking-tight mb-2">
                    {dragging
                      ? 'Release Cartridge to Seat & Boot'
                      : 'Insert Retro ROM Cartridge'}
                  </h3>
                  <p className="text-xs sm:text-sm text-white/55 mb-5 leading-relaxed max-w-md mx-auto">
                    Drag &amp; drop a ROM file here or pick from disk. Auto-boots
                    the matching RetroArch WASM core and maps every paired phone.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      playSwitchClack(0.95);
                      fileInputRef.current?.click();
                    }}
                    className="console-btn-hot inline-flex items-center gap-2 px-6 py-3 rounded-xl font-mono-tech text-xs sm:text-sm font-extrabold uppercase tracking-wider cursor-pointer"
                  >
                    <FolderOpen className="w-4 h-4" />
                    SELECT ROM CARTRIDGE
                  </button>

                  {/* Interactive System Core Selector Chips */}
                  <div className="mt-6 pt-4 border-t border-white/10">
                    <div className="font-mono-tech text-[9px] font-bold uppercase tracking-[0.2em] text-white/40 mb-2.5">
                      SYSTEM CORE TARGET // CLICK TO OVERRIDE
                    </div>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          playSwitchClack(1.05);
                          setSelectedCore('auto');
                        }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono-tech text-[10px] font-extrabold uppercase tracking-wider cursor-pointer transition ${
                          selectedCore === 'auto'
                            ? 'bg-[#B5FF2A] text-[#07060B] shadow-[0_0_12px_rgba(181,255,42,0.35)]'
                            : 'crt-well text-white/60 hover:text-white hover:border-white/25'
                        }`}
                      >
                        AUTO
                      </button>

                      {CONSOLE_PROFILES.map((profile) => {
                        const isSelected = selectedCore === profile.core;
                        const chipLabel =
                          SHORT_SYSTEM_LABELS[profile.id] ??
                          profile.id.toUpperCase();
                        return (
                          <button
                            key={profile.id}
                            type="button"
                            onClick={() => {
                              playSwitchClack(1.05);
                              setSelectedCore(profile.core);
                            }}
                            title={`${profile.name} (${profile.extensions.join(', ')})`}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono-tech text-[10px] font-extrabold tracking-wider cursor-pointer transition ${
                              isSelected
                                ? 'bg-[#22D3EE] text-[#07060B] shadow-[0_0_14px_rgba(34,211,238,0.4)]'
                                : 'crt-well text-[#F5F4F0]/80 hover:text-white hover:border-white/25'
                            }`}
                          >
                            <span>{chipLabel}</span>
                            <span
                              className={`font-semibold ${
                                isSelected ? 'text-[#07060B]/70' : 'text-white/35'
                              }`}
                            >
                              {profile.extensions[0]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Gold PCB Edge-Connector Pins Strip Along Bottom Edge */}
                <div className="h-3.5 w-full cartridge-pins border-t border-black/80 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]" />
              </div>
            </div>
          )}

          {status === 'loading' && (
            <div className="text-center px-6 py-8">
              <div className="w-12 h-12 border-[3px] border-[#B5FF2A] border-t-[#FF3B5C] rounded-full animate-spin mx-auto mb-4" />
              <p className="font-mono-tech text-xs font-extrabold uppercase tracking-[0.22em] text-[#B5FF2A]">
                INITIALIZING WASM CORE…
              </p>
            </div>
          )}

          {status === 'error' && bootError && (
            <div
              role="alert"
              className="text-center w-full max-w-lg px-6 py-7 console-deck rounded-2xl mx-4 animate-spring-pop"
            >
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-mono-tech text-[10px] font-extrabold uppercase tracking-widest mb-3 ${
                  bootError.kind === 'detect'
                    ? 'bg-[#22D3EE]/15 border border-[#22D3EE]/50 text-[#67E8F9]'
                    : 'bg-[#FF3B5C]/20 border border-[#FF3B5C]/60 text-[#FF8FA3]'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {bootError.kind === 'detect'
                  ? 'SELECT SYSTEM CORE'
                  : bootError.kind === 'network'
                    ? 'CORE DOWNLOAD FAULT'
                    : 'CARTRIDGE BOOT FAULT'}
              </div>
              <p className="font-display text-lg sm:text-xl text-[#F5F4F0] font-extrabold mb-2">
                {bootError.title}
              </p>
              <p className="text-xs sm:text-sm text-white/65 mb-4 leading-relaxed">
                {bootError.detail}
              </p>
              {bootError.raw && (
                <p className="crt-well rounded-lg px-3 py-2 mb-4 font-mono-tech text-[10px] text-white/45 break-words text-left">
                  {bootError.raw}
                </p>
              )}

              {lastFileRef.current && bootError.kind !== 'empty' && (
                <div className="mb-5">
                  <div className="font-mono-tech text-[9px] font-bold uppercase tracking-[0.2em] text-white/40 mb-2">
                    {bootError.kind === 'network'
                      ? 'RETRY OR BOOT WITH ANOTHER CORE'
                      : 'BOOT WITH CORE'}
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {CONSOLE_PROFILES.map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        onClick={() => retryWithCore(profile.core)}
                        title={`${profile.name} (${profile.core})`}
                        className="crt-well inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono-tech text-[10px] font-extrabold tracking-wider text-[#F5F4F0]/85 hover:text-white hover:border-[#22D3EE]/60 cursor-pointer transition"
                      >
                        {SHORT_SYSTEM_LABELS[profile.id] ?? profile.id.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-2">
                {lastFileRef.current && bootError.kind === 'network' && (
                  <button
                    type="button"
                    onClick={() => {
                      const file = lastFileRef.current;
                      if (file) void launchRomFile(file);
                    }}
                    className="console-btn-hot inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-mono-tech text-xs font-extrabold uppercase cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" /> RETRY
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    playSwitchClack(0.95);
                    setBootError(null);
                    setStatus('idle');
                  }}
                  className="console-btn px-4 py-2 rounded-xl font-mono-tech text-xs font-extrabold uppercase cursor-pointer"
                >
                  RETURN TO BAY
                </button>
              </div>
            </div>
          )}

          {notice && (
            <div
              role="status"
              className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none console-deck px-3.5 py-1.5 rounded-full font-mono-tech text-[11px] font-extrabold uppercase tracking-wider animate-spring-pop ${
                notice.ok ? 'text-[#B5FF2A]' : 'text-[#FF8FA3]'
              }`}
            >
              {notice.text}
            </div>
          )}

          {romName && (status === 'running' || status === 'paused') && (
            <div className="absolute top-3 left-3 z-20 pointer-events-none flex items-center gap-2 console-deck px-3 py-1.5 rounded-xl">
              <span
                className={`w-2 h-2 rounded-full ${
                  status === 'running'
                    ? 'bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A]'
                    : 'bg-[#FFB800]'
                }`}
              />
              <span className="text-[11px] font-mono-tech font-bold text-[#F5F4F0]">
                {systemName} · {romName}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


