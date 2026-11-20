import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActiveGameInfo,
  ControllerLayoutId,
  PlayerInfo,
} from '@couch-emu/shared';
import {
  ArrowLeft,
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock,
  Dices,
  Gamepad2,
  Grid2x2,
  Keyboard,
  ListMusic,
  Maximize2,
  Music,
  Pause,
  Play,
  QrCode,
  RotateCcw,
  Rows3,
  Search,
  Shuffle,
  Sparkles,
  Star,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { webAudioTap } from '../lib/audioTap';
import {
  playCartridgeEject,
  playCartridgeInsert,
  playConfirmPop,
  playRoulettePeg,
  playSwitchClack,
  playUiTick,
} from '../lib/uiSound';
import { CartridgeArtwork } from './CartridgeArt';
import { BootIntro, IntroBeat } from './BootIntro';
import {
  MINI_GAMES,
  MiniGameGenre,
  MiniGameMeta,
} from './miniGamesRegistry';
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  GameAudio,
  MiniGameEngine,
  VfxManager,
} from './sharedEngine';
import {
  createHyperPongEngine,
  createLaserCycleEngine,
  createMeteorDodgeEngine,
  createNeonArenaEngine,
  createSumoRingEngine,
} from './engines/arcadeBatch1';
import {
  createCoinRushEngine,
  createColorTurfEngine,
  createSpaceBlastersEngine,
  createTankDuelEngine,
  createTurboCircuitEngine,
} from './engines/arcadeBatch2';
import {
  createAirHockeyEngine,
  createBrickSmashEngine,
  createHotPotatoEngine,
  createQuickDrawEngine,
  createSnakeBattleEngine,
} from './engines/arcadeBatch3';
import {
  createAsteroidDogfightEngine,
  createCaptureCrownEngine,
  createDodgeballEngine,
  createFloorIsLavaEngine,
  createGravityFlipEngine,
} from './engines/arcadeBatch4';
import {
  createDriftRallyEngine,
  createIceBumperBashEngine,
  createLaserTagEngine,
  createMeteorBasketballEngine,
  createRhythmBeatdownEngine,
} from './engines/arcadeBatch5';
import {
  createBomberGridEngine,
  createBulletHellBossEngine,
  createKingOfHillEngine,
  createSoccerStrikerEngine,
  createTugOfWarEngine,
} from './engines/arcadeBatch6';
import {
  createCannonBarrageEngine,
  createLaserRouletteEngine,
  createNeonVolleysEngine,
  createPacChaseEngine,
  createPinballWizardEngine,
} from './engines/arcadeBatch7';
import {
  createAsteroidMinersEngine,
  createDemolitionDerbyEngine,
  createFlappySquadEngine,
  createGrappleSwingEngine,
  createSnowballFightEngine,
} from './engines/arcadeBatch8';
import {
  createConveyorChaosEngine,
  createCyberGolfEngine,
  createGhostHuntEngine,
  createHyperMemoryGridEngine,
  createTowerSiegeEngine,
} from './engines/arcadeBatch9';
import {
  createCrateDropperEngine,
  createJetpackJoustEngine,
  createMeteorTennisEngine,
  createSimonDuelEngine,
  createVortexSurvivalEngine,
} from './engines/arcadeBatch10';
import {
  createAsteroidBowlingEngine,
  createCyberRelayEngine,
  createMirrorBladesEngine,
  createOrbitalShieldEngine,
  createTreasureDiversEngine,
} from './engines/arcadeBatch11';
import {
  createGrandGauntletEngine,
  createLaserLimboEngine,
  createMagnetPullEngine,
  createMeteorStrikeCoopEngine,
  createNeonSnakePongEngine,
} from './engines/arcadeBatch12';

interface ArcadeHubProps {
  players: PlayerInfo[];
  onCanvasReady: (canvas: HTMLCanvasElement | null) => void;
  onLayoutSuggested: (layout: ControllerLayoutId) => void;
  onGameMetaChange: (activeGame: ActiveGameInfo) => void;
  onRumbleSlot?: (slot: number, durationMs: number, intensity: number) => void;
  onOpenPairing?: () => void;
  roomCode?: string;
}

type GenreFilter = MiniGameGenre | 'Favorites';
type DisplayMode = 'crisp' | 'crt' | 'lcd';
type LibraryViewMode = 'grid' | 'shelf';

const GENRE_FILTERS: { id: GenreFilter; label: string }[] = [
  { id: 'All', label: 'ALL 60' },
  { id: 'Favorites', label: 'FAVORITES' },
  { id: 'Party', label: 'PARTY' },
  { id: 'Action', label: 'ACTION' },
  { id: 'Racing', label: 'RACING' },
  { id: 'Sports', label: 'SPORTS' },
  { id: 'Survival', label: 'SURVIVAL' },
];

const DISPLAY_MODES: { id: DisplayMode; label: string }[] = [
  { id: 'crisp', label: 'CRISP' },
  { id: 'crt', label: 'CRT' },
  { id: 'lcd', label: 'LCD' },
];

const CONFETTI_PIECES = [
  { left: '6%', top: '8%', color: '#FF3B5C', delay: '0ms', w: 9, h: 6 },
  { left: '14%', top: '4%', color: '#FFB800', delay: '45ms', w: 7, h: 11 },
  { left: '22%', top: '12%', color: '#B5FF2A', delay: '80ms', w: 10, h: 6 },
  { left: '30%', top: '5%', color: '#22D3EE', delay: '20ms', w: 8, h: 8 },
  { left: '38%', top: '10%', color: '#FF3B5C', delay: '110ms', w: 6, h: 11 },
  { left: '46%', top: '3%', color: '#FFB800', delay: '60ms', w: 10, h: 7 },
  { left: '53%', top: '9%', color: '#B5FF2A', delay: '15ms', w: 8, h: 10 },
  { left: '60%', top: '5%', color: '#22D3EE', delay: '95ms', w: 9, h: 6 },
  { left: '68%', top: '11%', color: '#FF3B5C', delay: '40ms', w: 7, h: 10 },
  { left: '75%', top: '4%', color: '#FFB800', delay: '130ms', w: 10, h: 6 },
  { left: '82%', top: '10%', color: '#B5FF2A', delay: '70ms', w: 8, h: 8 },
  { left: '88%', top: '6%', color: '#22D3EE', delay: '25ms', w: 7, h: 11 },
  { left: '93%', top: '13%', color: '#FF3B5C', delay: '100ms', w: 9, h: 6 },
  { left: '50%', top: '14%', color: '#F5F4F0', delay: '55ms', w: 8, h: 8 },
] as const;

const MARQUEE_COLORS = ['#FFB800', '#FF3B5C', '#B5FF2A', '#22D3EE'] as const;

const FAVORITES_STORAGE_KEY = 'couch-emu-favorites';
const RECENT_STORAGE_KEY = 'couch-emu-recent';
const SETTINGS_STORAGE_KEY = 'couch-emu-stage-settings';
const FIXED_DT = 1000 / 60;
/** Max device pixels per game unit (2 → 1920×1080 backing store). */
const MAX_RENDER_SCALE = 2;
const BLOOM_W = 320;
const BLOOM_H = 180;

interface StageSettings {
  displayMode: DisplayMode;
  bloom: boolean;
  music: boolean;
  volume: number;
  bots: boolean;
}

const DEFAULT_SETTINGS: StageSettings = {
  displayMode: 'crt',
  bloom: true,
  music: true,
  volume: 0.85,
  bots: true,
};

function loadStageSettings(): StageSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StageSettings>;
    return {
      displayMode: DISPLAY_MODES.some((m) => m.id === parsed.displayMode)
        ? (parsed.displayMode as DisplayMode)
        : DEFAULT_SETTINGS.displayMode,
      bloom: typeof parsed.bloom === 'boolean' ? parsed.bloom : DEFAULT_SETTINGS.bloom,
      music: typeof parsed.music === 'boolean' ? parsed.music : DEFAULT_SETTINGS.music,
      volume:
        typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : DEFAULT_SETTINGS.volume,
      bots: typeof parsed.bots === 'boolean' ? parsed.bots : DEFAULT_SETTINGS.bots,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Stable small hash so each cartridge gets its own soundtrack key/tempo. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function loadStoredIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function formatPadTag(layout: ControllerLayoutId): string {
  switch (layout) {
    case 'dualstick':
      return 'PRO PAD';
    case 'genesis':
      return '6-BTN PAD';
    default:
      return `${layout.toUpperCase()} PAD`;
  }
}

function parseControlLegend(
  controls: string,
): { action: string; keys: string }[] {
  return controls
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((segment) => {
      const idx = segment.indexOf(':');
      if (idx === -1) {
        return { action: 'INPUT', keys: segment };
      }
      return {
        action: segment.slice(0, idx).trim(),
        keys: segment.slice(idx + 1).trim(),
      };
    });
}

function estimateGridColumns(): number {
  if (typeof window === 'undefined') return 5;
  const w = window.innerWidth;
  if (w >= 1536) return 6;
  if (w >= 1280) return 5;
  if (w >= 1024) return 4;
  if (w >= 640) return 3;
  return 2;
}

function createEngineById(id: string): MiniGameEngine {
  switch (id) {
    case 'neon-arena':
      return createNeonArenaEngine();
    case 'hyper-pong':
      return createHyperPongEngine();
    case 'laser-cycle':
      return createLaserCycleEngine();
    case 'sumo-ring':
      return createSumoRingEngine();
    case 'meteor-dodge':
      return createMeteorDodgeEngine();
    case 'turbo-circuit':
      return createTurboCircuitEngine();
    case 'coin-rush':
      return createCoinRushEngine();
    case 'tank-duel':
      return createTankDuelEngine();
    case 'space-blasters':
      return createSpaceBlastersEngine();
    case 'color-turf':
      return createColorTurfEngine();
    case 'hot-potato':
      return createHotPotatoEngine();
    case 'air-hockey':
      return createAirHockeyEngine();
    case 'snake-battle':
      return createSnakeBattleEngine();
    case 'quick-draw':
      return createQuickDrawEngine();
    case 'brick-smash':
      return createBrickSmashEngine();
    case 'dodgeball-blitz':
      return createDodgeballEngine();
    case 'gravity-flip':
      return createGravityFlipEngine();
    case 'asteroid-dogfight':
      return createAsteroidDogfightEngine();
    case 'floor-is-lava':
      return createFloorIsLavaEngine();
    case 'capture-crown':
      return createCaptureCrownEngine();
    case 'laser-tag':
      return createLaserTagEngine();
    case 'drift-rally':
      return createDriftRallyEngine();
    case 'meteor-basketball':
      return createMeteorBasketballEngine();
    case 'rhythm-beatdown':
      return createRhythmBeatdownEngine();
    case 'ice-bumper-bash':
      return createIceBumperBashEngine();
    case 'bomber-grid':
      return createBomberGridEngine();
    case 'tug-of-war':
      return createTugOfWarEngine();
    case 'bullet-hell-boss':
      return createBulletHellBossEngine();
    case 'soccer-striker':
      return createSoccerStrikerEngine();
    case 'king-of-hill':
      return createKingOfHillEngine();
    case 'laser-roulette':
      return createLaserRouletteEngine();
    case 'pinball-wizard':
      return createPinballWizardEngine();
    case 'cannon-barrage':
      return createCannonBarrageEngine();
    case 'neon-volleys':
      return createNeonVolleysEngine();
    case 'pac-chase':
      return createPacChaseEngine();
    case 'asteroid-miners':
      return createAsteroidMinersEngine();
    case 'demolition-derby':
      return createDemolitionDerbyEngine();
    case 'grapple-swing':
      return createGrappleSwingEngine();
    case 'flappy-squad':
      return createFlappySquadEngine();
    case 'snowball-fight':
      return createSnowballFightEngine();
    case 'ghost-hunt':
      return createGhostHuntEngine();
    case 'conveyor-chaos':
      return createConveyorChaosEngine();
    case 'cyber-golf':
      return createCyberGolfEngine();
    case 'tower-siege':
      return createTowerSiegeEngine();
    case 'hyper-memory-grid':
      return createHyperMemoryGridEngine();
    case 'meteor-tennis':
      return createMeteorTennisEngine();
    case 'vortex-survival':
      return createVortexSurvivalEngine();
    case 'jetpack-joust':
      return createJetpackJoustEngine();
    case 'crate-dropper':
      return createCrateDropperEngine();
    case 'simon-duel':
      return createSimonDuelEngine();
    case 'orbital-shield':
      return createOrbitalShieldEngine();
    case 'cyber-relay':
      return createCyberRelayEngine();
    case 'treasure-divers':
      return createTreasureDiversEngine();
    case 'mirror-blades':
      return createMirrorBladesEngine();
    case 'asteroid-bowling':
      return createAsteroidBowlingEngine();
    case 'laser-limbo':
      return createLaserLimboEngine();
    case 'magnet-pull':
      return createMagnetPullEngine();
    case 'neon-snake-pong':
      return createNeonSnakePongEngine();
    case 'meteor-strike-coop':
      return createMeteorStrikeCoopEngine();
    case 'grand-gauntlet':
      return createGrandGauntletEngine();
    default:
      return createNeonArenaEngine();
  }
}

const ArcadeHubImpl: React.FC<ArcadeHubProps> = ({
  players,
  onCanvasReady,
  onLayoutSuggested,
  onGameMetaChange,
  onRumbleSlot,
  onOpenPairing,
  roomCode,
}) => {
  const [view, setView] = useState<'vault' | 'play'>('vault');
  const [selectedId, setSelectedId] = useState<string>(MINI_GAMES[0].id);
  const [focusedId, setFocusedId] = useState<string>(MINI_GAMES[0].id);
  const [genre, setGenre] = useState<GenreFilter>('All');
  const [query, setQuery] = useState('');
  const [libraryView, setLibraryView] = useState<LibraryViewMode>('grid');
  const [initialSettings] = useState(loadStageSettings);
  const [botsEnabled, setBotsEnabled] = useState(initialSettings.bots);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    initialSettings.displayMode,
  );
  const [bloomEnabled, setBloomEnabled] = useState(initialSettings.bloom);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(initialSettings.volume);
  const [musicEnabled, setMusicEnabled] = useState(initialSettings.music);
  const [intro, setIntro] = useState<{ key: number; full: boolean } | null>(
    null,
  );
  const [paused, setPaused] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);

  // Favorites & Recently Played
  const [favorites, setFavorites] = useState<string[]>(() =>
    loadStoredIds(FAVORITES_STORAGE_KEY),
  );
  const [recentIds, setRecentIds] = useState<string[]>(() =>
    loadStoredIds(RECENT_STORAGE_KEY),
  );

  // Party Roulette Modal & 5-Game Playlist Queue
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [rouletteSpinning, setRouletteSpinning] = useState(false);
  const [roulettePool, setRoulettePool] = useState<MiniGameMeta[]>([]);
  const [rouletteIndex, setRouletteIndex] = useState(0);
  const [rouletteStep, setRouletteStep] = useState(0);
  const [jackpotNonce, setJackpotNonce] = useState(0);
  const [partyQueue, setPartyQueue] = useState<MiniGameMeta[]>([]);
  const [partyIndex, setPartyIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bloomCanvasRef = useRef<HTMLCanvasElement>(null);
  /** True while the boot intro holds the simulation on its first frame. */
  const holdRef = useRef(false);
  /** Launches show the full title card; in-game restarts only count down. */
  const fullIntroRef = useRef(true);
  const bloomRef = useRef(bloomEnabled);
  bloomRef.current = bloomEnabled;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const soundRef = useRef<GameAudio | null>(null);
  const rouletteTimersRef = useRef<number[]>([]);
  const lastHoverTickRef = useRef<number>(0);
  const lastVaultInputRef = useRef<number>(performance.now());
  const [attractMode, setAttractMode] = useState(false);

  const playersRef = useRef(players);
  playersRef.current = players;
  const botsRef = useRef(botsEnabled);
  botsRef.current = botsEnabled;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const musicEnabledRef = useRef(musicEnabled);
  musicEnabledRef.current = musicEnabled;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onRumbleSlotRef = useRef(onRumbleSlot);
  onRumbleSlotRef.current = onRumbleSlot;

  const activeGame = useMemo(
    () => MINI_GAMES.find((g) => g.id === selectedId) ?? MINI_GAMES[0],
    [selectedId],
  );

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const recentGames = useMemo(
    () =>
      recentIds
        .map((id) => MINI_GAMES.find((g) => g.id === id))
        .filter((g): g is MiniGameMeta => Boolean(g))
        .slice(0, 8),
    [recentIds],
  );

  const filteredGames = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MINI_GAMES.filter((g) => {
      const genreOk =
        genre === 'All'
          ? true
          : genre === 'Favorites'
            ? favoriteSet.has(g.id)
            : g.genre === genre;
      const queryOk =
        !q ||
        g.title.toLowerCase().includes(q) ||
        g.tagline.toLowerCase().includes(q) ||
        g.genre.toLowerCase().includes(q) ||
        g.number.includes(q);
      return genreOk && queryOk;
    });
  }, [genre, query, favoriteSet]);

  const focusedGame = useMemo(
    () =>
      filteredGames.find((g) => g.id === focusedId) ??
      filteredGames[0] ??
      MINI_GAMES[0],
    [filteredGames, focusedId],
  );

  const focusedControls = useMemo(
    () => parseControlLegend(focusedGame.controls),
    [focusedGame.controls],
  );

  // Keep focusedId synced when filters narrow the list
  useEffect(() => {
    if (
      filteredGames.length > 0 &&
      !filteredGames.some((g) => g.id === focusedId)
    ) {
      setFocusedId(filteredGames[0].id);
    }
  }, [filteredGames, focusedId]);

  const activePlayersLabel = useMemo(() => {
    const humanCount = Math.max(1, Math.min(4, players.length || 1));
    if (!botsEnabled) {
      return `${humanCount}P LOCAL`;
    }
    const cpuCount = Math.max(0, 4 - humanCount);
    return cpuCount > 0 ? `${humanCount}P + ${cpuCount} CPU` : '4P FULL COUCH';
  }, [players.length, botsEnabled]);

  const handleFocusTile = useCallback((id: string, withSound = true) => {
    setFocusedId((prev) => {
      if (prev === id) return prev;
      if (withSound) {
        const now = performance.now();
        if (now - lastHoverTickRef.current >= 65) {
          lastHoverTickRef.current = now;
          playUiTick(1.0);
        }
      }
      return id;
    });
  }, []);

  const toggleFavorite = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFavorites((prev) => {
      const exists = prev.includes(id);
      playConfirmPop(!exists);
      const next = exists ? prev.filter((x) => x !== id) : [id, ...prev];
      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const recordRecent = useCallback((id: string) => {
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8);
      try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const launchGame = useCallback(
    (game: MiniGameMeta, keepPartyQueue = false) => {
      playCartridgeInsert();
      if (!keepPartyQueue) {
        setPartyQueue([]);
        setPartyIndex(0);
      }
      recordRecent(game.id);
      setSelectedId(game.id);
      setFocusedId(game.id);
      setPaused(false);
      setView('play');
      fullIntroRef.current = true;
      setResetNonce((n) => n + 1);
    },
    [recordRecent],
  );

  const ejectToVault = useCallback(() => {
    playCartridgeEject();
    setPaused(false);
    setView('vault');
  }, []);

  const stepCycle = useCallback(
    (delta: number) => {
      const idx = MINI_GAMES.findIndex((g) => g.id === selectedId);
      const nextIdx = (idx + delta + MINI_GAMES.length) % MINI_GAMES.length;
      launchGame(MINI_GAMES[nextIdx]);
    },
    [selectedId, launchGame],
  );

  const launchRandom = useCallback(() => {
    const pool = MINI_GAMES.filter((g) => g.id !== selectedId);
    const pick =
      pool[Math.floor(Math.random() * pool.length)] ?? MINI_GAMES[0];
    launchGame(pick);
  }, [selectedId, launchGame]);

  const clearRouletteTimers = useCallback(() => {
    for (const tid of rouletteTimersRef.current) {
      window.clearTimeout(tid);
    }
    rouletteTimersRef.current = [];
  }, []);

  const startRouletteSpin = useCallback(() => {
    clearRouletteTimers();
    playSwitchClack(1.12);
    const shuffled = [...MINI_GAMES].sort(() => Math.random() - 0.5);
    const picks = shuffled.slice(0, 12);
    setRoulettePool(picks);
    setRouletteIndex(0);
    setRouletteStep(0);
    setRouletteOpen(true);
    setRouletteSpinning(true);

    const totalSteps = 18;
    let elapsed = 0;
    for (let step = 1; step <= totalSteps; step++) {
      const delay = 55 + Math.pow(step / totalSteps, 2.2) * 210;
      elapsed += delay;
      const isFinal = step === totalSteps;
      const targetIdx = isFinal ? picks.length - 1 : step % picks.length;
      const tid = window.setTimeout(() => {
        setRouletteIndex(targetIdx);
        setRouletteStep(step);
        if (!mutedRef.current) {
          playRoulettePeg(step, isFinal);
        }
        if (isFinal) {
          setRouletteSpinning(false);
          setJackpotNonce((n) => n + 1);
        }
      }, elapsed);
      rouletteTimersRef.current.push(tid);
    }
  }, [clearRouletteTimers]);

  const startPartyPlaylist = useCallback(
    (firstGame?: MiniGameMeta) => {
      clearRouletteTimers();
      const shuffled = [...MINI_GAMES]
        .filter((g) => !firstGame || g.id !== firstGame.id)
        .sort(() => Math.random() - 0.5);
      const playlist = firstGame
        ? [firstGame, ...shuffled.slice(0, 4)]
        : shuffled.slice(0, 5);
      setPartyQueue(playlist);
      setPartyIndex(0);
      setRouletteOpen(false);
      setRouletteSpinning(false);
      launchGame(playlist[0], true);
    },
    [clearRouletteTimers, launchGame],
  );

  const advancePartyPlaylist = useCallback(() => {
    if (partyQueue.length === 0) return;
    const nextIdx = (partyIndex + 1) % partyQueue.length;
    setPartyIndex(nextIdx);
    launchGame(partyQueue[nextIdx], true);
  }, [partyQueue, partyIndex, launchGame]);

  const moveFocusByDelta = useCallback(
    (delta: number) => {
      if (filteredGames.length === 0) return;
      const currentIdx = filteredGames.findIndex(
        (g) => g.id === focusedGame.id,
      );
      const safeIdx = currentIdx === -1 ? 0 : currentIdx;
      const nextIdx = Math.max(
        0,
        Math.min(filteredGames.length - 1, safeIdx + delta),
      );
      if (nextIdx === safeIdx) return;
      const nextGame = filteredGames[nextIdx];
      playUiTick(1.0);
      setFocusedId(nextGame.id);
      const el = tileRefs.current[nextGame.id];
      el?.scrollIntoView({
        block: 'nearest',
        inline: 'center',
        behavior: 'smooth',
      });
    },
    [filteredGames, focusedGame.id],
  );

  // Attract mode: an idle vault on the TV slowly tours the cartridge library,
  // like an arcade cabinet waiting for quarters. Any input hands control back.
  useEffect(() => {
    if (view !== 'vault' || rouletteOpen) {
      setAttractMode(false);
      return;
    }
    const IDLE_MS = 45_000;
    const CYCLE_MS = 6_500;
    lastVaultInputRef.current = performance.now();
    let lastCycle = 0;
    const markInput = () => {
      lastVaultInputRef.current = performance.now();
      setAttractMode(false);
    };
    window.addEventListener('pointermove', markInput, { passive: true });
    window.addEventListener('pointerdown', markInput, { passive: true });
    window.addEventListener('keydown', markInput);
    window.addEventListener('wheel', markInput, { passive: true });
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (now - lastVaultInputRef.current < IDLE_MS) return;
      setAttractMode(true);
      if (now - lastCycle < CYCLE_MS) return;
      lastCycle = now;
      setFocusedId((prev) => {
        let next = prev;
        while (next === prev && MINI_GAMES.length > 1) {
          next = MINI_GAMES[Math.floor(Math.random() * MINI_GAMES.length)].id;
        }
        return next;
      });
    }, 500);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointermove', markInput);
      window.removeEventListener('pointerdown', markInput);
      window.removeEventListener('keydown', markInput);
      window.removeEventListener('wheel', markInput);
    };
  }, [view, rouletteOpen]);

  // Keyboard Console Navigation in Vault View
  useEffect(() => {
    if (view !== 'vault') return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inInput =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (rouletteOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          playSwitchClack(0.85);
          clearRouletteTimers();
          setRouletteOpen(false);
          setRouletteSpinning(false);
        }
        return;
      }

      if (inInput) {
        if (e.key === 'Escape') {
          setQuery('');
          searchInputRef.current?.blur();
        }
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveFocusByDelta(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveFocusByDelta(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveFocusByDelta(libraryView === 'grid' ? estimateGridColumns() : 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocusByDelta(libraryView === 'grid' ? -estimateGridColumns() : -1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        // Don't hijack button clicks when a specific toolbar button has focus
        if (target && target.tagName === 'BUTTON') return;
        e.preventDefault();
        if (focusedGame) {
          launchGame(focusedGame);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    view,
    rouletteOpen,
    libraryView,
    focusedGame,
    moveFocusByDelta,
    launchGame,
    clearRouletteTimers,
  ]);

  // Couch Gamepad Navigation in Vault View (D-Pad / Left Stick + A to Boot)
  useEffect(() => {
    if (view !== 'vault' || rouletteOpen) return;

    let rafId = 0;
    let lastMoveAt = 0;
    let prevConfirm = false;

    const pollPad = (now: number) => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let dirX = 0;
      let dirY = 0;
      let confirmPressed = false;

      for (const pad of pads) {
        if (!pad) continue;
        const ax = pad.axes[0] ?? 0;
        const ay = pad.axes[1] ?? 0;
        if (ax < -0.55 || pad.buttons[14]?.pressed) dirX = -1;
        else if (ax > 0.55 || pad.buttons[15]?.pressed) dirX = 1;
        if (ay < -0.55 || pad.buttons[12]?.pressed) dirY = -1;
        else if (ay > 0.55 || pad.buttons[13]?.pressed) dirY = 1;
        if (pad.buttons[0]?.pressed) confirmPressed = true;
      }

      if (dirX !== 0 || dirY !== 0 || confirmPressed) {
        lastVaultInputRef.current = performance.now();
      }

      if ((dirX !== 0 || dirY !== 0) && now - lastMoveAt > 170) {
        lastMoveAt = now;
        if (dirX !== 0) {
          moveFocusByDelta(dirX);
        } else if (dirY !== 0) {
          moveFocusByDelta(
            libraryView === 'grid' ? dirY * estimateGridColumns() : dirY,
          );
        }
      }

      if (confirmPressed && !prevConfirm && focusedGame) {
        launchGame(focusedGame);
      }
      prevConfirm = confirmPressed;

      rafId = requestAnimationFrame(pollPad);
    };

    rafId = requestAnimationFrame(pollPad);
    return () => cancelAnimationFrame(rafId);
  }, [view, rouletteOpen, libraryView, focusedGame, moveFocusByDelta, launchGame]);

  useEffect(() => {
    webAudioTap.install();
    return () => {
      clearRouletteTimers();
    };
  }, [clearRouletteTimers]);

  useEffect(() => {
    try {
      const settings: StageSettings = {
        displayMode,
        bloom: bloomEnabled,
        music: musicEnabled,
        volume,
        bots: botsEnabled,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Private mode / storage disabled: settings just won't persist.
    }
  }, [displayMode, bloomEnabled, musicEnabled, volume, botsEnabled]);

  // Sync volume, mute, and synth BGM immediately into live GameAudio instance
  useEffect(() => {
    const sound = soundRef.current;
    if (!sound) return;
    sound.muted = muted;
    sound.setVolume(volume);
    sound.setMusicEnabled(musicEnabled && !paused);
  }, [muted, volume, musicEnabled, paused]);

  useEffect(() => {
    if (view === 'vault') {
      onCanvasReady(null);
      onGameMetaChange({
        mode: 'lobby',
        title: '60-Game Arcade Vault',
        systemName: 'COUCH·OS',
        controls: 'Browse & launch any of 60 arcade cartridges',
        accent: '#FF3B5C',
      });
      return;
    }

    onLayoutSuggested(activeGame.layout);
    onGameMetaChange({
      mode: 'webgame',
      title: activeGame.title,
      systemName: 'COUCH·OS',
      controls: activeGame.controls,
      accent: activeGame.accent,
    });

    const canvas = canvasRef.current;
    if (!canvas) return;
    onCanvasReady(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sound = new GameAudio();
    sound.setMusicSeed(hashId(activeGame.id));
    sound.muted = mutedRef.current;
    sound.setVolume(volumeRef.current);
    sound.setMusicEnabled(musicEnabledRef.current && !pausedRef.current);
    soundRef.current = sound;

    const vfx = new VfxManager();
    const engine = createEngineById(activeGame.id);

    // Boot sequence: a fresh cartridge gets the full title card, a restart
    // just the countdown. The first frame renders behind the overlay.
    holdRef.current = true;
    setIntro({ key: performance.now(), full: fullIntroRef.current });

    // HiDPI: size the backing store to the on-screen size (capped) and draw
    // in game units through a scale transform, so TVs and retina panels get
    // crisp vector edges instead of an upscaled 960×540 bitmap.
    let renderScale = 1;
    const applyCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const fit = Math.min(rect.width / GAME_WIDTH, rect.height / GAME_HEIGHT);
      const next = Math.max(
        1,
        Math.min(MAX_RENDER_SCALE, Math.round(fit * dpr * 4) / 4 || 1),
      );
      if (next === renderScale && canvas.width === Math.round(GAME_WIDTH * next)) {
        return;
      }
      renderScale = next;
      canvas.width = Math.round(GAME_WIDTH * next);
      canvas.height = Math.round(GAME_HEIGHT * next);
      ctx.imageSmoothingQuality = 'high';
      needsRedraw = true;
    };
    let needsRedraw = true;
    const resizeObserver = new ResizeObserver(applyCanvasSize);
    resizeObserver.observe(canvas);
    applyCanvasSize();

    const bloomCanvas = bloomCanvasRef.current;
    const bloomCtx = bloomCanvas?.getContext('2d') ?? null;
    if (bloomCtx) {
      // Crush darks before the CSS blur so only bright neon blooms.
      bloomCtx.filter = 'brightness(1.05) contrast(2.1) saturate(1.2)';
    }
    const renderBloom = () => {
      if (!bloomCtx || !bloomRef.current) return;
      bloomCtx.clearRect(0, 0, BLOOM_W, BLOOM_H);
      bloomCtx.drawImage(canvas, 0, 0, BLOOM_W, BLOOM_H);
    };
    const lastRumbleAt: Record<number, number> = {};

    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput =
        tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

      if (!inInput && (e.key === 'Escape' || e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        keys.clear();
        playSwitchClack(0.95);
        setPaused((prev) => !prev);
        return;
      }

      if (
        !inInput &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)
      ) {
        e.preventDefault();
      }
      keys.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
    };
    const onWindowBlur = () => {
      keys.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    let frame = 0;
    let rafId = 0;
    let lastTime = performance.now();
    let accumulator = 0;

    const stepEngine = (pads: readonly (Gamepad | null)[]) => {
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      engine.step({
        ctx,
        players: playersRef.current,
        botsEnabled: botsRef.current,
        keys,
        pads,
        sound,
        vfx,
        rumble: (slot, durationMs = 80, intensity = 0.7) => {
          const pad = pads[slot];
          const isVirtualPhone = pad?.id?.startsWith(
            'CouchEmu Phone Controller',
          );

          if (pad && !isVirtualPhone) {
            void pad.vibrationActuator
              ?.playEffect('dual-rumble', {
                duration: durationMs,
                strongMagnitude: intensity,
              })
              .catch(() => {});
          }

          const t = performance.now();
          const prev = lastRumbleAt[slot] ?? 0;
          if (t - prev >= 90) {
            lastRumbleAt[slot] = t;
            if (onRumbleSlotRef.current) {
              onRumbleSlotRef.current(slot, durationMs, intensity);
            } else if (isVirtualPhone) {
              void pad?.vibrationActuator
                ?.playEffect('dual-rumble', {
                  duration: durationMs,
                  strongMagnitude: intensity,
                })
                .catch(() => {});
            }
          }
        },
        frame,
      });
    };

    const loop = (now: number) => {
      const rawDt = now - lastTime;
      lastTime = now;

      // Intro hold / pause: keep the current frame on screen without
      // advancing play. A resize clears the backing store, so redraw once
      // (a single silent tick) when that happens.
      if (pausedRef.current || holdRef.current) {
        accumulator = 0;
        if (needsRedraw) {
          needsRedraw = false;
          sound.muted = true;
          stepEngine(navigator.getGamepads ? navigator.getGamepads() : []);
          sound.muted = mutedRef.current;
          renderBloom();
        }
        rafId = requestAnimationFrame(loop);
        return;
      }
      needsRedraw = false;

      const dt = Math.min(50, Math.max(0, rawDt));
      accumulator += dt;

      let steps = 0;
      let rendered = false;
      while (accumulator >= FIXED_DT && steps < 3) {
        accumulator -= FIXED_DT;
        steps++;

        if (vfx.hitstopFrames > 0) {
          vfx.hitstopFrames--;
          continue;
        }

        frame++;
        sound.muted = mutedRef.current;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        stepEngine(pads);
        rendered = true;
      }
      if (rendered) renderBloom();

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      holdRef.current = false;
      setIntro(null);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      sound.dispose();
      soundRef.current = null;
      onCanvasReady(null);
    };
  }, [
    view,
    activeGame,
    resetNonce,
    onCanvasReady,
    onLayoutSuggested,
    onGameMetaChange,
  ]);

  const handleIntroBeat = useCallback((beat: IntroBeat) => {
    const sound = soundRef.current;
    if (!sound) return;
    if (beat === 'card') {
      sound.sweep(180, 720, 0.5, 'sawtooth', 0.05);
    } else if (beat === 'go') {
      sound.sweep(523, 1568, 0.28, 'square', 0.09);
      sound.beep(1046.5, 0.32, 'triangle', 0.12);
      sound.noiseBurst(0.25, 4200, 0.05);
    } else {
      sound.beep(beat === 1 ? 784 : 659, 0.14, 'square', 0.08);
      sound.beep(beat === 1 ? 392 : 329.6, 0.14, 'triangle', 0.06);
    }
  }, []);

  const handleIntroGo = useCallback(() => {
    holdRef.current = false;
  }, []);

  const handleIntroDone = useCallback(() => {
    setIntro(null);
  }, []);

  const currentRouletteGame =
    roulettePool[rouletteIndex] ?? roulettePool[0] ?? MINI_GAMES[0];

  const scrollShelf = (delta: number) => {
    playSwitchClack(delta > 0 ? 1.04 : 0.96);
    shelfRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  /* ==========================================================================
     VAULT VIEW — LIVING-ROOM CINEMA CONSOLE HOME (HERO SPOTLIGHT + COVER WALL)
     ========================================================================== */
  if (view === 'vault') {
    const isFocusedFav = favoriteSet.has(focusedGame.id);
    const isLastPlayed = recentIds[0] === focusedGame.id;

    const renderChannelTile = (game: MiniGameMeta, extraClass = '') => {
      const tuned = game.id === focusedGame.id;
      const isFav = favoriteSet.has(game.id);
      return (
        <div
          key={game.id}
          ref={(el) => {
            tileRefs.current[game.id] = el;
          }}
          role="button"
          tabIndex={0}
          aria-label={`Channel ${game.number}: ${game.title}`}
          data-tuned={tuned}
          onMouseEnter={() => handleFocusTile(game.id)}
          onFocus={() => handleFocusTile(game.id, false)}
          onClick={() => launchGame(game)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              launchGame(game);
            }
          }}
          className={`ch-tile group ${extraClass}`}
          style={{ ['--ch-accent' as string]: game.accent }}
        >
          <div className="ch-screen">
            <div className="ch-picture">
              <CartridgeArtwork game={game} variant="tile" bare />
            </div>
            <div className="tv-scan" aria-hidden="true" />
            {tuned && (
              <div key={`snow-${game.id}`} className="tv-static" aria-hidden="true" />
            )}
            <div className="absolute top-2 left-2 z-30">
              <span className="ch-badge">{game.number}</span>
            </div>
            <button
              type="button"
              onClick={(e) => toggleFavorite(game.id, e)}
              title={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
              aria-label={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
              className={`absolute top-2 right-2 z-30 p-1.5 rounded-md border transition cursor-pointer ${
                isFav
                  ? 'bg-[#FFB800] border-[#FFB800] text-[#07060B]'
                  : 'bg-black/60 border-white/15 text-white/70 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[#FFB800]'
              }`}
            >
              <Star className={`w-3 h-3 ${isFav ? 'fill-current' : ''}`} />
            </button>
            {tuned && (
              <span className="absolute bottom-2 right-2 z-30 font-osd text-[15px] leading-none px-1.5 py-1 rounded bg-black/70 text-white">
                ▶ PLAY
              </span>
            )}
          </div>
          <div className="px-0.5 min-w-0">
            <h3
              className={`font-display font-extrabold text-[14px] leading-tight truncate transition-colors ${
                tuned ? 'text-white' : 'text-white/70 group-hover:text-white'
              }`}
            >
              {game.title}
            </h3>
            <div className="mt-1 font-mono-tech text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/35 truncate">
              <span style={{ color: tuned ? game.accent : undefined }}>{game.genre}</span>
              {' · '}
              {formatPadTag(game.layout)}
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="relative flex-1 w-full flex flex-col">
        {/* Ambient spill from the set onto the living-room wall */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-14 h-[680px] z-0 transition-[background] duration-700"
          style={{
            background: `radial-gradient(ellipse 60% 55% at 62% 30%, ${focusedGame.accent}2E 0%, ${focusedGame.accent}10 42%, transparent 72%)`,
          }}
        />

        {attractMode && (
          <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
            <div className="hw-lcd flex items-center gap-3 px-4 py-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF3B5C] tv-blink shadow-[0_0_10px_#FF3B5C]" />
              <span className="font-osd text-[20px] leading-none text-[#B5FF2A] osd-glow">
                CHANNEL SURFING · PRESS ANY BUTTON
              </span>
            </div>
          </div>
        )}

        {/* ====================================================================
            NOW SHOWING: the focused channel on the big set
           ==================================================================== */}
        <section className="relative z-10 w-full max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-10 pt-6 sm:pt-8">
          <div className="tv-tube lg:h-[clamp(420px,58vh,620px)]">
            {/* Picture (right-anchored on desktop, on top on phones) */}
            <div
              key={`pic-${focusedGame.id}`}
              onClick={() => launchGame(focusedGame)}
              aria-hidden="true"
              className="tv-tune group relative w-full aspect-[16/10] lg:absolute lg:inset-y-0 lg:right-0 lg:w-auto lg:h-full cursor-pointer"
            >
              <CartridgeArtwork game={focusedGame} variant="hero" bare />
              <div className="lg:hidden absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#030306] to-transparent" />
            </div>

            {/* Picture falls off into the dark side of the tube */}
            <div
              aria-hidden="true"
              className="hidden lg:block absolute inset-0 z-10 pointer-events-none"
              style={{
                background:
                  'linear-gradient(90deg, #030306 0%, #030306 38%, rgba(3,3,6,0.8) 50%, rgba(3,3,6,0.2) 68%, transparent 82%), linear-gradient(0deg, rgba(3,3,6,0.85) 0%, transparent 38%)',
              }}
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 z-[11] pointer-events-none transition-[background] duration-500"
              style={{
                background: `radial-gradient(ellipse 55% 70% at 8% 100%, ${focusedGame.accent}30, transparent 70%)`,
              }}
            />

            <div className="tv-scan" aria-hidden="true" />
            <div key={`snow-${focusedGame.id}`} className="tv-static" aria-hidden="true" />
            <div className="tv-glass" aria-hidden="true" />

            {/* OSD: channel number + live bug */}
            <div className="pointer-events-none absolute top-0 inset-x-0 z-[28] flex items-start justify-between gap-4 p-4 sm:p-6 lg:p-8">
              <div key={`osd-${focusedGame.id}`} className="tv-osd-in flex items-end gap-3">
                <div className="font-osd text-[#B5FF2A] osd-glow leading-[0.78] flex items-start">
                  <span className="text-[20px] sm:text-[24px] mr-1 mt-1">CH</span>
                  <span className="text-[60px] sm:text-[88px]">{focusedGame.number}</span>
                </div>
                <div className="font-osd text-[17px] sm:text-[20px] leading-[1.05] pb-1 text-white/85 osd-glow">
                  {focusedGame.genre.toUpperCase()}
                  <br />
                  <span className="text-white/45">
                    1–4P · {formatPadTag(focusedGame.layout)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 font-osd text-[16px] sm:text-[19px] leading-none">
                <span className="flex items-center gap-2 text-white/85">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF3B5C] tv-blink shadow-[0_0_10px_#FF3B5C]" />
                  LIVE ON THE COUCH
                </span>
                {isLastPlayed && (
                  <span className="text-[#B5FF2A]/80 osd-glow">LAST WATCHED</span>
                )}
              </div>
            </div>

            {/* Lower third */}
            <div className="relative lg:absolute lg:left-0 lg:bottom-0 z-[28] w-full lg:w-[60%] lg:max-w-[880px] px-5 pb-6 pt-1 sm:px-7 sm:pb-7 lg:p-10 space-y-4">
              <div className="space-y-2.5">
                <h1
                  key={`title-${focusedGame.id}`}
                  className="animate-spring-pop font-brand font-extrabold text-white leading-[0.9] tracking-tight text-[clamp(2.3rem,5vw,4.6rem)]"
                  style={{ textShadow: `0 0 44px ${focusedGame.accent}66` }}
                >
                  {focusedGame.title}
                </h1>
                <p className="text-sm sm:text-[15px] text-white/68 max-w-xl leading-relaxed line-clamp-2">
                  {focusedGame.tagline}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {focusedControls.map((ctrl, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-2 h-8 pl-2.5 pr-1 rounded-md bg-black/45 border border-white/10"
                  >
                    <span className="font-mono-tech text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/45">
                      {ctrl.action}
                    </span>
                    <span className="font-osd text-[16px] leading-[22px] px-1.5 rounded bg-white/[0.08] border border-white/10 text-white">
                      {ctrl.keys}
                    </span>
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => launchGame(focusedGame)}
                  className="group/play inline-flex items-center gap-3 h-12 pl-5 pr-2 rounded-xl font-brand text-[15px] font-extrabold tracking-wide text-[#07060B] cursor-pointer transition-transform duration-100 hover:-translate-y-0.5 active:translate-y-[3px]"
                  style={{
                    backgroundColor: focusedGame.accent,
                    boxShadow: `inset 0 1.5px 0 rgba(255,255,255,0.55), inset 0 -2px 0 rgba(0,0,0,0.18), 0 4px 0 color-mix(in srgb, ${focusedGame.accent} 40%, #000), 0 18px 40px -12px ${focusedGame.accent}`,
                  }}
                >
                  <Play className="w-4 h-4 fill-current shrink-0" />
                  PLAY CH {focusedGame.number}
                  <span className="font-osd text-[15px] font-normal leading-none px-1.5 py-1 rounded-md bg-black/15">
                    ENTER
                  </span>
                </button>

                <button
                  type="button"
                  onClick={startRouletteSpin}
                  className="hw-chip h-12 px-4 rounded-xl text-[11px]"
                >
                  <Dices className="w-4 h-4 text-[#B5FF2A]" />
                  ROULETTE
                </button>
                <button
                  type="button"
                  onClick={() => startPartyPlaylist()}
                  className="hw-chip h-12 px-4 rounded-xl text-[11px]"
                >
                  <ListMusic className="w-4 h-4 text-[#FF3B5C]" />
                  5-GAME MIX
                </button>
                <button
                  type="button"
                  onClick={(e) => toggleFavorite(focusedGame.id, e)}
                  title={isFocusedFav ? 'Remove from Favorites' : 'Pin to Favorites'}
                  aria-pressed={isFocusedFav}
                  data-on={isFocusedFav}
                  className="hw-chip hw-chip-icon h-12 w-12 rounded-xl"
                  style={{ ['--chip-on' as string]: '#FFB800' }}
                >
                  <Star className={`w-4 h-4 ${isFocusedFav ? 'fill-current' : ''}`} />
                </button>
              </div>
            </div>

            {/* Tuning dial: every channel as a tick, click to tune */}
            <div className="hidden lg:flex absolute right-8 bottom-7 z-[28] flex-col items-end gap-2">
              <div className="flex items-end gap-[3px] h-7" role="group" aria-label="Tuning dial">
                {MINI_GAMES.map((g, i) => {
                  const tuned = g.id === focusedGame.id;
                  const inGuide = filteredGames.includes(g);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      tabIndex={-1}
                      title={`CH ${g.number} · ${g.title}`}
                      onMouseEnter={() => inGuide && handleFocusTile(g.id)}
                      onClick={() => (inGuide ? handleFocusTile(g.id) : undefined)}
                      className="w-[3px] rounded-full cursor-pointer transition-all duration-150"
                      style={{
                        height: tuned ? 28 : i % 5 === 0 ? 14 : 8,
                        backgroundColor: tuned
                          ? g.accent
                          : inGuide
                            ? 'rgba(255,255,255,0.32)'
                            : 'rgba(255,255,255,0.09)',
                        boxShadow: tuned ? `0 0 10px ${g.accent}` : 'none',
                      }}
                    />
                  );
                })}
              </div>
              <div className="font-osd text-[15px] leading-none text-white/40 flex items-center gap-4">
                <span>◀ ▶ TUNE</span>
                <span>ENTER PLAY</span>
                <span>/ SEARCH</span>
              </div>
            </div>
          </div>
        </section>

        {/* ====================================================================
            CHANNEL GUIDE
           ==================================================================== */}
        <section className="relative z-10 flex-1 w-full max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-10 pt-10 pb-12 flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-white/[0.08]">
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-x-6 min-w-0 max-w-full">
              <h2 className="font-osd text-[30px] leading-none text-white pb-1 sm:pb-2.5 shrink-0">
                CHANNEL GUIDE
              </h2>
              <div className="flex items-end gap-5 overflow-x-auto no-scrollbar min-w-0 max-w-full">
                {GENRE_FILTERS.map((g, idx) => {
                  const isFav = g.id === 'Favorites';
                  const active = genre === g.id;
                  const count =
                    g.id === 'All'
                      ? MINI_GAMES.length
                      : isFav
                        ? favorites.length
                        : MINI_GAMES.filter((m) => m.genre === g.id).length;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        playSwitchClack(0.9 + idx * 0.04);
                        setGenre(g.id);
                      }}
                      className="guide-tab"
                      style={{ ['--tab-accent' as string]: isFav ? '#FFB800' : '#B5FF2A' }}
                    >
                      {isFav && (
                        <Star className="w-3 h-3 self-center fill-[#FFB800] text-[#FFB800]" />
                      )}
                      {g.id === 'All' ? 'ALL' : g.label}
                      <span className="guide-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 pb-2 ml-auto">
              <div className="relative w-52 sm:w-64">
                <Search className="w-3.5 h-3.5 text-white/35 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tune by name or channel…"
                  className="w-full h-[30px] rounded-[7px] bg-[#050409] border border-white/[0.09] shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)] focus:border-[#B5FF2A]/50 pl-8 pr-10 font-mono-tech text-xs text-white placeholder:text-white/30 focus:outline-none transition"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      playSwitchClack(0.85);
                      setQuery('');
                    }}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 font-osd text-[14px] leading-none px-1.5 py-0.5 rounded bg-white/[0.07] text-white/40">
                    /
                  </kbd>
                )}
              </div>

              <div className="hw-seg">
                <button
                  type="button"
                  aria-pressed={libraryView === 'grid'}
                  onClick={() => {
                    playSwitchClack(1.0);
                    setLibraryView('grid');
                  }}
                  title="Monitor wall"
                >
                  <Grid2x2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">WALL</span>
                </button>
                <button
                  type="button"
                  aria-pressed={libraryView === 'shelf'}
                  onClick={() => {
                    playSwitchClack(1.06);
                    setLibraryView('shelf');
                  }}
                  title="Single row"
                >
                  <Rows3 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">ROW</span>
                </button>
              </div>
            </div>
          </div>

          {/* Last watched */}
          {recentGames.length > 0 && !query.trim() && genre === 'All' && (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <span className="font-osd text-[17px] leading-none text-white/40 shrink-0 pr-1">
                LAST WATCHED
              </span>
              {recentGames.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  onMouseEnter={() => handleFocusTile(game.id)}
                  onClick={() => launchGame(game)}
                  className="hw-chip shrink-0 normal-case tracking-normal"
                >
                  <span
                    className="font-osd text-[16px] leading-none"
                    style={{ color: game.accent }}
                  >
                    {game.number}
                  </span>
                  <span className="font-display text-xs font-bold text-white/85">
                    {game.title}
                  </span>
                </button>
              ))}
            </div>
          )}

          {filteredGames.length === 0 ? (
            /* NO SIGNAL */
            <div className="tv-tube mx-auto my-4 w-full max-w-xl aspect-[16/9] flex flex-col items-center justify-center gap-3 text-center">
              <div className="tv-static" style={{ animation: 'none', opacity: 0.3 }} aria-hidden="true" />
              <div className="tv-scan" aria-hidden="true" />
              <div className="tv-glass" aria-hidden="true" />
              <div className="relative z-[28] font-osd text-[44px] leading-none text-white osd-glow">
                NO SIGNAL
              </div>
              <p className="relative z-[28] font-mono-tech text-[11px] text-white/55 max-w-xs">
                {genre === 'Favorites'
                  ? 'Star a channel to keep your couch-night staples here.'
                  : 'Nothing on that frequency. Try another name or channel number.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  playSwitchClack(1.0);
                  setGenre('All');
                  setQuery('');
                }}
                className="relative z-[28] hw-chip mt-1"
                data-on="true"
              >
                <span className="hw-led" /> BACK TO ALL 60
              </button>
            </div>
          ) : libraryView === 'shelf' ? (
            <div className="relative py-2">
              <button
                type="button"
                onClick={() => scrollShelf(-560)}
                aria-label="Scroll left"
                className="hidden sm:flex hw-chip hw-chip-icon w-10 h-10 rounded-full bg-[#07060B]/90 absolute -left-2 top-[38%] -translate-y-1/2 z-20"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div
                ref={shelfRef}
                className="flex items-start gap-5 overflow-x-auto snap-x snap-mandatory no-scrollbar pt-3 pb-4 px-2"
              >
                {filteredGames.map((game) =>
                  renderChannelTile(game, 'snap-center shrink-0 w-[260px] sm:w-[300px]'),
                )}
              </div>
              <button
                type="button"
                onClick={() => scrollShelf(560)}
                aria-label="Scroll right"
                className="hidden sm:flex hw-chip hw-chip-icon w-10 h-10 rounded-full bg-[#07060B]/90 absolute -right-2 top-[38%] -translate-y-1/2 z-20"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-4 sm:gap-x-5 gap-y-6 pt-2">
              {filteredGames.map((game) => renderChannelTile(game))}
            </div>
          )}
        </section>

        {/* ====================================================================
            DARK NEON PARTY ROULETTE WHEEL MODAL
           ==================================================================== */}
        {rouletteOpen && (
          <div className="fixed inset-0 z-50 bg-black/78 backdrop-blur-md flex items-center justify-center p-4">
            <div className="w-full max-w-lg console-deck rounded-[26px] overflow-hidden relative animate-spring-pop border border-white/15">
              {/* Top Animated Neon Marquee Chase Bulbs */}
              <div className="bg-[#07060B] px-4 py-2.5 flex items-center justify-between gap-1.5 border-b border-white/10">
                {Array.from({ length: 12 }).map((_, i) => {
                  const color = MARQUEE_COLORS[i % MARQUEE_COLORS.length];
                  const lit = rouletteSpinning
                    ? (i + rouletteStep) % 3 === 0
                    : true;
                  return (
                    <span
                      key={i}
                      className="w-2.5 h-2.5 rounded-full transition-all duration-100"
                      style={{
                        backgroundColor: lit ? color : 'rgba(255,255,255,0.12)',
                        boxShadow: lit ? `0 0 12px ${color}` : 'none',
                        transform: lit ? 'scale(1.18)' : 'scale(0.85)',
                      }}
                    />
                  );
                })}
              </div>

              <div className="p-5 relative overflow-hidden">
                {/* 14 Confetti Burst Pieces when Jackpot Locks In */}
                {!rouletteSpinning && roulettePool.length > 0 && (
                  <div
                    key={jackpotNonce}
                    className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
                    aria-hidden="true"
                  >
                    {CONFETTI_PIECES.map((piece, i) => (
                      <span
                        key={i}
                        className="animate-confetti absolute rounded-[2px]"
                        style={{
                          left: piece.left,
                          top: piece.top,
                          width: piece.w,
                          height: piece.h,
                          backgroundColor: piece.color,
                          animationDelay: piece.delay,
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Modal Header */}
                <div className="flex items-center justify-between gap-3 mb-4 relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#B5FF2A]/16 border border-[#B5FF2A]/45 flex items-center justify-center text-[#B5FF2A]">
                      <Dices
                        className={`w-5 h-5 ${
                          rouletteSpinning ? 'animate-spin' : ''
                        }`}
                      />
                    </div>
                    <div>
                      <h3 className="font-brand text-lg font-extrabold leading-tight text-white">
                        PARTY ROULETTE
                      </h3>
                      <p className="font-mono-tech text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/55">
                        {rouletteSpinning
                          ? 'SPINNING 60-GAME VAULT…'
                          : '★ JACKPOT LOCKED IN!'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      playSwitchClack(0.85);
                      clearRouletteTimers();
                      setRouletteOpen(false);
                      setRouletteSpinning(false);
                    }}
                    className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.14] border border-white/12 text-white/75 hover:text-white cursor-pointer transition"
                    aria-label="Close Party Roulette"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Highlighted Neon Cover-Art Reveal Stage */}
                <div
                  key={!rouletteSpinning ? `locked-${jackpotNonce}` : 'spin'}
                  className={`rounded-2xl overflow-hidden border-2 bg-[#0B0A12] mb-4 relative z-10 ${
                    !rouletteSpinning ? 'animate-jackpot-bounce' : ''
                  }`}
                  style={{
                    borderColor: `${currentRouletteGame.accent}99`,
                    boxShadow: `0 20px 44px -16px ${currentRouletteGame.accent}66`,
                  }}
                >
                  <div className="aspect-[16/9] w-full relative">
                    <CartridgeArtwork
                      game={currentRouletteGame}
                      variant="hero"
                    />
                    <div className="pointer-events-none absolute top-3 right-3 font-mono-tech text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-[#07060B]/80 backdrop-blur-md border border-white/15 text-[#B5FF2A]">
                      #{currentRouletteGame.number} ·{' '}
                      {currentRouletteGame.genre.toUpperCase()}
                    </div>
                  </div>
                  <div className="p-4 border-t border-white/10">
                    <h4 className="font-brand text-xl font-extrabold text-white leading-tight">
                      {currentRouletteGame.title}
                    </h4>
                    <p className="text-xs text-white/65 mt-1 leading-snug">
                      {currentRouletteGame.tagline}
                    </p>
                  </div>
                </div>

                {/* 12-Segment Glowing LED Chase Meter */}
                <div className="crt-well rounded-xl p-2 grid grid-cols-12 gap-1.5 mb-4 relative z-10">
                  {roulettePool.map((g, idx) => {
                    const active = idx === rouletteIndex;
                    return (
                      <div
                        key={g.id}
                        className="h-2.5 rounded-sm transition-all duration-100"
                        style={{
                          backgroundColor: active
                            ? g.accent
                            : 'rgba(255,255,255,0.1)',
                          transform: active ? 'scaleY(1.25)' : 'scaleY(1)',
                          boxShadow: active ? `0 0 12px ${g.accent}` : 'none',
                        }}
                      />
                    );
                  })}
                </div>

                {/* Modal Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 relative z-10">
                  <button
                    type="button"
                    disabled={rouletteSpinning}
                    onClick={startRouletteSpin}
                    className="console-btn inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-mono-tech text-xs font-extrabold disabled:opacity-45 cursor-pointer"
                  >
                    <Shuffle className="w-3.5 h-3.5" /> RE-SPIN
                  </button>
                  <button
                    type="button"
                    disabled={rouletteSpinning}
                    onClick={() => startPartyPlaylist(currentRouletteGame)}
                    className="console-btn-volt inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-mono-tech text-xs font-extrabold disabled:opacity-45 cursor-pointer"
                  >
                    <ListMusic className="w-3.5 h-3.5" /> 5-GAME MIX
                  </button>
                  <button
                    type="button"
                    disabled={rouletteSpinning}
                    onClick={() => {
                      setRouletteOpen(false);
                      launchGame(currentRouletteGame);
                    }}
                    className="console-btn-hot inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-mono-tech text-xs font-extrabold disabled:opacity-45 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" /> PLAY NOW
                  </button>
                </div>
              </div>

              {/* Bottom Animated Neon Marquee Chase Bulbs */}
              <div className="bg-[#07060B] px-4 py-2.5 flex items-center justify-between gap-1.5 border-t border-white/10">
                {Array.from({ length: 12 }).map((_, i) => {
                  const color = MARQUEE_COLORS[(i + 1) % MARQUEE_COLORS.length];
                  const lit = rouletteSpinning
                    ? (11 - i + rouletteStep) % 3 === 0
                    : true;
                  return (
                    <span
                      key={i}
                      className="w-2.5 h-2.5 rounded-full transition-all duration-100"
                      style={{
                        backgroundColor: lit ? color : 'rgba(255,255,255,0.12)',
                        boxShadow: lit ? `0 0 12px ${color}` : 'none',
                        transform: lit ? 'scale(1.18)' : 'scale(0.85)',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ==========================================================================
     FULL-BLEED GAMEPLAY STAGE — SLIM FLOATING TELEMETRY + MAXIMIZED ARCADE VIEW
     ========================================================================== */
  return (
    <div className="flex-1 w-full flex flex-col min-h-[calc(100vh-3.5rem)] bg-[#06050A]">
      {/* Stage bar: channel readout on the left, set controls on the right */}
      <div className="min-h-12 px-3 sm:px-5 py-1.5 bg-[#07060B]/92 backdrop-blur-xl border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button type="button" onClick={ejectToVault} className="hw-chip">
            <ArrowLeft className="w-3.5 h-3.5" />
            GUIDE
          </button>

          <div className="hw-lcd inline-flex items-center h-[30px] px-1">
            <button
              type="button"
              onClick={() => stepCycle(-1)}
              className="p-1 rounded text-white/55 hover:text-white cursor-pointer transition"
              title="Previous channel"
              aria-label="Previous channel"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-osd text-[20px] leading-none text-[#B5FF2A] osd-glow">
              CH {activeGame.number}
            </span>
            <button
              type="button"
              onClick={() => stepCycle(1)}
              className="p-1 rounded text-white/55 hover:text-white cursor-pointer transition"
              title="Next channel"
              aria-label="Next channel"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <span
            className="font-brand text-[15px] font-extrabold text-white truncate px-1"
            style={{ textShadow: `0 0 24px ${activeGame.accent}88` }}
          >
            {activeGame.title}
          </span>

          {partyQueue.length > 0 && (
            <button
              type="button"
              onClick={advancePartyPlaylist}
              className="hw-chip"
              data-on="true"
              title="Next game in the 5-Game Mix"
            >
              <ListMusic className="w-3.5 h-3.5" />
              MIX {partyIndex + 1}/{partyQueue.length} · NEXT ▸
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="hidden 2xl:flex items-center gap-1 pr-1">
            {[0, 1, 2, 3].map((slot) => {
              const p = players.find((x) => x.slot === slot);
              return (
                <span
                  key={slot}
                  className="font-osd text-[15px] leading-none px-1.5 py-[3px] rounded"
                  style={
                    p
                      ? { backgroundColor: p.color, color: '#07060B' }
                      : { backgroundColor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)' }
                  }
                >
                  P{slot + 1}
                </span>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              playSwitchClack(botsEnabled ? 0.88 : 1.08);
              setBotsEnabled((v) => !v);
            }}
            data-on={botsEnabled}
            aria-pressed={botsEnabled}
            className="hw-chip"
            title="Toggle CPU bots"
          >
            <span className="hw-led" />
            BOTS
          </button>

          <div className="hw-seg">
            {DISPLAY_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={displayMode === m.id}
                onClick={() => {
                  playSwitchClack(1.0);
                  setDisplayMode(m.id);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              playSwitchClack(bloomEnabled ? 0.88 : 1.12);
              setBloomEnabled((v) => !v);
            }}
            data-on={bloomEnabled}
            aria-pressed={bloomEnabled}
            className="hw-chip"
            style={{ ['--chip-on' as string]: '#22D3EE' }}
            title="Toggle neon glow"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden md:inline">GLOW</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playSwitchClack(musicEnabled ? 0.88 : 1.12);
              setMusicEnabled((v) => !v);
            }}
            data-on={musicEnabled}
            aria-pressed={musicEnabled}
            className="hw-chip"
            style={{ ['--chip-on' as string]: '#FFB800' }}
            title="Toggle soundtrack"
          >
            <Music className="w-3.5 h-3.5" />
            <span className="hidden md:inline">BGM</span>
          </button>

          <div className="hw-lcd inline-flex items-center gap-2 h-[30px] px-2.5">
            <button
              type="button"
              onClick={() => {
                playSwitchClack(0.92);
                setMuted((m) => !m);
              }}
              className="cursor-pointer"
              title={muted ? 'Unmute' : 'Mute'}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted || volume <= 0.01 ? (
                <VolumeX className="w-3.5 h-3.5 text-[#FF3B5C]" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-[#B5FF2A]" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const nextVol = parseFloat(e.target.value);
                setVolume(nextVol);
                if (nextVol > 0 && muted) setMuted(false);
              }}
              aria-label="Master Volume"
              className="w-16 accent-[#B5FF2A] h-1 cursor-pointer"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              playSwitchClack(0.95);
              setPaused((p) => !p);
            }}
            data-on={paused}
            className="hw-chip"
            style={{ ['--chip-on' as string]: '#FF3B5C' }}
            title="Pause (Esc or P)"
          >
            <Pause className="w-3.5 h-3.5" />
            {paused ? 'PAUSED' : 'PAUSE'}
          </button>

          <button
            type="button"
            onClick={() => {
              playCartridgeInsert();
              setPaused(false);
              fullIntroRef.current = false;
              setResetNonce((n) => n + 1);
            }}
            className="hw-chip hw-chip-icon"
            title="Restart Game"
            aria-label="Restart Game"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={launchRandom}
            className="hw-chip hw-chip-icon"
            title="Random Game"
            aria-label="Random Game"
          >
            <Shuffle className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              playSwitchClack(1.05);
              containerRef.current?.requestFullscreen?.().catch(() => {});
            }}
            className="hw-chip hw-chip-icon"
            title="Fullscreen"
            aria-label="Fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Maximized Centered PVM Cinema Canvas Stage */}
      <div className="flex-1 w-full flex flex-col items-center justify-center p-2 sm:p-3.5 min-h-0">
        <div
          ref={containerRef}
          className="pvm-housing relative w-full max-w-[1520px] h-[calc(100vh-8.25rem)] min-h-[360px] rounded-[22px] p-1.5 sm:p-2 flex items-center justify-center overflow-hidden"
        >
          <div className="crt-well relative w-full h-full rounded-[16px] overflow-hidden flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={GAME_WIDTH}
              height={GAME_HEIGHT}
              className="w-full h-full object-contain block"
            />
            <canvas
              ref={bloomCanvasRef}
              width={BLOOM_W}
              height={BLOOM_H}
              aria-hidden="true"
              className="stage-bloom"
              style={{ display: bloomEnabled ? 'block' : 'none' }}
            />
            {intro && (
              <BootIntro
                key={intro.key}
                game={activeGame}
                players={players}
                botsEnabled={botsEnabled}
                full={intro.full}
                onBeat={handleIntroBeat}
                onGo={handleIntroGo}
                onDone={handleIntroDone}
              />
            )}
            {displayMode === 'crt' && (
              <div className="crt-scanlines absolute inset-0" />
            )}
            {displayMode === 'lcd' && (
              <div className="lcd-pixel-grid absolute inset-0" />
            )}

            {/* Dark Frosted Console Pause Menu OSD */}
            {paused && (
              <div className="absolute inset-0 z-20 bg-[#05040A]/80 backdrop-blur-md flex items-center justify-center p-4">
                <div className="w-full max-w-md console-deck rounded-[24px] overflow-hidden animate-spring-pop border border-white/15">
                  <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-2 bg-white/[0.03]">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{
                          backgroundColor: activeGame.accent,
                          boxShadow: `0 0 10px ${activeGame.accent}`,
                        }}
                      />
                      <span className="font-osd text-[24px] leading-none text-white osd-glow">
                        PAUSE
                      </span>
                    </div>
                    <span className="font-osd text-[20px] leading-none text-[#B5FF2A] osd-glow">
                      CH {activeGame.number}
                    </span>
                  </div>

                  <div className="p-5 space-y-4">
                    <CartridgeArtwork game={activeGame} variant="compact" />

                    <div>
                      <h3 className="font-brand text-xl font-extrabold text-white leading-tight">
                        {activeGame.title}
                      </h3>
                      <p className="text-xs text-white/60 mt-1 leading-snug">
                        {activeGame.tagline}
                      </p>
                    </div>

                    {/* Controls + Audio + Display OSD Well */}
                    <div className="crt-well rounded-xl p-3.5 space-y-2.5 text-[11px]">
                      <div className="flex items-center gap-2 text-[#B5FF2A]">
                        <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-mono-tech font-bold">
                          {activeGame.controls}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-white/55">
                        <Keyboard className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" />
                        <span className="font-mono-tech text-[10px]">
                          WASD / ARROWS · SPACE/J (A) · SHIFT/K (B) · ESC/P
                          RESUME
                        </span>
                      </div>

                      {/* Inline Volume & Synth BGM */}
                      <div className="pt-2.5 border-t border-white/10 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1">
                          <button
                            type="button"
                            onClick={() => {
                              playSwitchClack(0.92);
                              setMuted((m) => !m);
                            }}
                            className="cursor-pointer"
                            title={muted ? 'Unmute Audio' : 'Mute Audio'}
                          >
                            {muted || volume <= 0.01 ? (
                              <VolumeX className="w-3.5 h-3.5 text-[#FF3B5C]" />
                            ) : (
                              <Volume2 className="w-3.5 h-3.5 text-[#B5FF2A]" />
                            )}
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={muted ? 0 : volume}
                            onChange={(e) => {
                              const nextVol = parseFloat(e.target.value);
                              setVolume(nextVol);
                              if (nextVol > 0 && muted) setMuted(false);
                            }}
                            aria-label="Pause Menu Master Volume"
                            className="flex-1 accent-[#FF3B5C] h-1.5 bg-white/15 rounded-lg cursor-pointer"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            playSwitchClack(1.05);
                            setMusicEnabled((v) => !v);
                          }}
                          className={`px-2.5 py-1 rounded-lg border font-mono-tech text-[10px] font-extrabold cursor-pointer transition ${
                            musicEnabled
                              ? 'bg-[#FFB800]/20 text-[#FFB800] border-[#FFB800]/50'
                              : 'bg-white/[0.05] text-white/60 border-white/12'
                          }`}
                        >
                          BGM: {musicEnabled ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      {/* Inline Display Mode Switcher */}
                      <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2">
                        <span className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-white/50">
                          DISPLAY FILTER
                        </span>
                        <div className="inline-flex items-center gap-1">
                          {DISPLAY_MODES.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                playSwitchClack(1.0);
                                setDisplayMode(m.id);
                              }}
                              className={`px-2 py-0.5 rounded-md font-mono-tech text-[10px] font-extrabold cursor-pointer transition ${
                                displayMode === m.id
                                  ? 'bg-[#F5F4F0] text-[#07060B]'
                                  : 'bg-white/[0.06] text-white/55 hover:text-white'
                              }`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Pause Menu Action Buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          playSwitchClack(1.1);
                          setPaused(false);
                        }}
                        className="console-btn-hot col-span-2 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl font-mono-tech font-extrabold text-xs tracking-wider cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" /> RESUME GAME
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          playCartridgeInsert();
                          setPaused(false);
                          fullIntroRef.current = false;
              setResetNonce((n) => n + 1);
                        }}
                        className="console-btn inline-flex items-center justify-center gap-1.5 py-2 rounded-xl font-mono-tech text-[11px] font-extrabold cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> RESTART
                      </button>
                      <button
                        type="button"
                        onClick={launchRandom}
                        className="console-btn inline-flex items-center justify-center gap-1.5 py-2 rounded-xl font-mono-tech text-[11px] font-extrabold cursor-pointer"
                      >
                        <Shuffle className="w-3.5 h-3.5 text-[#22D3EE]" />{' '}
                        RANDOM
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          partyQueue.length > 0
                            ? advancePartyPlaylist()
                            : stepCycle(1)
                        }
                        className="console-btn-volt inline-flex items-center justify-center gap-1.5 py-2 rounded-xl font-mono-tech text-[11px] font-extrabold cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                        {partyQueue.length > 0
                          ? `NEXT (${((partyIndex + 1) % partyQueue.length) + 1}/${partyQueue.length})`
                          : 'NEXT GAME'}
                      </button>
                      <button
                        type="button"
                        onClick={ejectToVault}
                        className="console-btn inline-flex items-center justify-center gap-1.5 py-2 rounded-xl font-mono-tech text-[11px] font-extrabold cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" /> VAULT
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* OSD footer */}
        <div className="w-full max-w-[1520px] pt-2.5 px-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 font-osd text-[16px] leading-none text-white/55 truncate">
            <span style={{ color: activeGame.accent }}>▶</span>
            <span className="truncate">{activeGame.controls.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-4 shrink-0 font-osd text-[16px] leading-none">
            <span className="text-[#22D3EE]">{activePlayersLabel}</span>
            <span className="hidden md:inline text-white/40">ESC / P PAUSE</span>
            <span className="flex items-center gap-1.5 text-[#B5FF2A] osd-glow">
              <span className="w-2 h-2 rounded-full bg-[#B5FF2A] shadow-[0_0_8px_#B5FF2A]" />
              60HZ
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Memoized so host-level UI state (player activity LEDs, pairing drawer, toasts)
 * never re-renders the game stage while people are playing.
 */
export const ArcadeHub = React.memo(ArcadeHubImpl);
