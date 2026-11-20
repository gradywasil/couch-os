/**
 * SUPER COUCH MK-II — Tactile Console UI Sound Engine
 * Pure Web Audio mechanical switches, cartridge clack-insert chimes,
 * eject springs, and roulette peg clicks. Zero external audio assets.
 */

const STORAGE_KEY = 'couch-emu-ui-sfx';

let sharedCtx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
let uiSfxEnabled = loadInitialEnabled();

function loadInitialEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export function isUiSfxEnabled(): boolean {
  return uiSfxEnabled;
}

export function setUiSfxEnabled(enabled: boolean): void {
  uiSfxEnabled = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // ignore storage errors
  }
}

let resumePending = false;

function getCtx(): AudioContext | null {
  if (!uiSfxEnabled || typeof window === 'undefined') return null;
  try {
    if (!sharedCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return null;
      sharedCtx = new Ctx();
    }
    if (sharedCtx.state === 'suspended' && !resumePending) {
      // Hover ticks fire constantly; only one resume() in flight at a time.
      resumePending = true;
      void sharedCtx
        .resume()
        .catch(() => {})
        .finally(() => {
          resumePending = false;
        });
    }
    return sharedCtx.state === 'running' ? sharedCtx : null;
  } catch {
    return null;
  }
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.max(1, Math.floor(ctx.sampleRate * 0.03));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
  }
  noiseBuf = buf;
  return buf;
}

/** Subtle 3.5ms mechanical detent tick on hover or filter skim */
export function playUiTick(pitch = 1): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1100 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(420 * pitch, now + 0.012);
    gain.gain.setValueAtTime(0.025, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.014);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.016);
  } catch {
    // ignore
  }
}

/** Crisp two-layer mechanical Cherry-style keycap clack + molded housing thock */
export function playSwitchClack(pitch = 1): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const p = Math.max(0.65, Math.min(1.5, pitch));

    // Tactile plastic snap
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2400 * p, now);
    bp.Q.setValueAtTime(2.6, now);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.009);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.011);

    // Molded ABS housing body thock
    const body = ctx.createOscillator();
    const bg = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(210 * p, now);
    body.frequency.exponentialRampToValueAtTime(84, now + 0.028);
    bg.gain.setValueAtTime(0.095, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.032);
    body.connect(bg);
    bg.connect(ctx.destination);
    body.start(now);
    body.stop(now + 0.035);
  } catch {
    // ignore
  }
}

/** Heavy cartridge slot CLACK-LATCH + warm retro hi-fi 3-note boot arpeggio */
export function playCartridgeInsert(): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;

    // 1. Mechanical plastic slot seat thump
    const thump = ctx.createOscillator();
    const tg = ctx.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(160, now);
    thump.frequency.exponentialRampToValueAtTime(52, now + 0.055);
    tg.gain.setValueAtTime(0.14, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    thump.connect(tg);
    tg.connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.065);

    // 2. Latch snap 38ms later
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1900, now + 0.035);
    bp.Q.setValueAtTime(2.0, now + 0.035);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.09, now + 0.035);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.052);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(ctx.destination);
    src.start(now + 0.035);
    src.stop(now + 0.055);

    // 3. Bright Famicom-inspired boot triad (E5 -> G#5 -> B5)
    const notes = [659.25, 830.61, 987.77];
    notes.forEach((freq, i) => {
      const t = now + 0.075 + i * 0.052;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i === 2 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.075, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + (i === 2 ? 0.24 : 0.11));
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  } catch {
    // ignore
  }
}

/** Spring-loaded cartridge eject pop */
export function playCartridgeEject(): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(170, now + 0.09);
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch {
    // ignore
  }
}

/** Mechanical prize-wheel peg clack + fanfare lock chord */
export function playRoulettePeg(step: number, isFinal = false): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    if (!isFinal) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(340 + step * 22, now);
      osc.frequency.exponentialRampToValueAtTime(180 + step * 10, now + 0.04);
      g.gain.setValueAtTime(0.065, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
      return;
    }

    // Jackpot lock chord (C5 + E5 + G5 + C6)
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const t = now + i * 0.032;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.075, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  } catch {
    // ignore
  }
}

/** Crisp double-chirp confirmation (copy room code, favorite star, buzz) */
export function playConfirmPop(positive = true): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const freqs = positive ? [587.33, 880] : [440, 311.13];
    freqs.forEach((f, i) => {
      const t = now + i * 0.045;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.085);
    });
  } catch {
    // ignore
  }
}
