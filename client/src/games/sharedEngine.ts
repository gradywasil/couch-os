import { GAMEPAD_BUTTON, PLAYER_COLORS, PlayerInfo } from '@couch-emu/shared';

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

export interface PlayerInput {
  x: number;
  y: number;
  actionA: boolean; // South / R1 / Space / J / Enter
  actionB: boolean; // East / L1 / Shift / K
  actionX: boolean; // West / X / U / Q
  actionY: boolean; // North / Y / I / E
  start: boolean;
}

export interface GameLoopContext {
  ctx: CanvasRenderingContext2D;
  players: PlayerInfo[];
  botsEnabled: boolean;
  keys: Set<string>;
  pads: readonly (Gamepad | null)[];
  sound: GameAudio;
  vfx: VfxManager;
  rumble: (slot: number, durationMs?: number, intensity?: number) => void;
  frame: number;
}

export interface MiniGameEngine {
  step: (env: GameLoopContext) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity?: number;
  drag?: number;
  rot?: number;
  vrot?: number;
  rect?: boolean;
  glow?: boolean;
  streak?: boolean;
}

interface Shockwave {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  color: string;
  lineWidth: number;
}

interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

interface BoltSegment {
  points: Array<{ x: number; y: number }>;
  color: string;
  life: number;
}

interface Afterimage {
  x: number;
  y: number;
  r: number;
  color: string;
  life: number;
  maxLife: number;
}

const MAX_PARTICLES = 420;
const TAU = Math.PI * 2;
/** Canvas monospace stack — IBM Plex Mono is the face index.html loads. */
const MONO_FONT = '"IBM Plex Mono", ui-monospace, monospace';
const OSD_FONT = '"Jersey 10", "IBM Plex Mono", ui-monospace, monospace';
const MAX_GHOSTS = 96;

export class VfxManager {
  private particles: Particle[] = [];
  private waves: Shockwave[] = [];
  private texts: FloatingText[] = [];
  private bolts: BoltSegment[] = [];
  private ghosts: Afterimage[] = [];
  private shakeMag = 0;
  private shakeAngle = 0;
  private flashAlpha = 0;
  private flashColor = '#ffffff';
  private zoomPulse = 0;
  private chromaAlpha = 0;
  public hitstopFrames = 0;
  private recycleParticle = 0;
  private recycleGhost = 0;

  /** At capacity, overwrite an existing slot instead of shifting the array. */
  private addParticle(p: Particle) {
    if (this.particles.length >= MAX_PARTICLES) {
      this.particles[this.recycleParticle++ % MAX_PARTICLES] = p;
    } else {
      this.particles.push(p);
    }
  }

  shake(amount: number) {
    this.shakeMag = Math.min(24, Math.max(this.shakeMag, amount));
    this.zoomPulse = Math.max(this.zoomPulse, Math.min(0.04, amount * 0.0024));
    this.shakeAngle = (Math.random() - 0.5) * Math.min(0.018, amount * 0.0012);
    if (amount >= 6.5) {
      this.chromaAlpha = Math.max(
        this.chromaAlpha,
        Math.min(0.65, amount * 0.045),
      );
    }
  }

  hitstop(frames = 3) {
    this.hitstopFrames = Math.max(this.hitstopFrames, Math.min(6, frames));
  }

  flash(color = '#ffffff', alpha = 0.28) {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  afterimage(x: number, y: number, r: number, color: string, life = 11) {
    const g = { x, y, r, color, life, maxLife: life };
    if (this.ghosts.length >= MAX_GHOSTS) {
      this.ghosts[this.recycleGhost++ % MAX_GHOSTS] = g;
    } else {
      this.ghosts.push(g);
    }
  }

  burst(
    x: number,
    y: number,
    color: string,
    count = 14,
    speed = 5,
    size = 3.5,
    gravity = 0,
  ) {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
      const spd = speed * (0.42 + Math.random() * 0.96);
      const maxLife = 18 + Math.random() * 22;
      this.addParticle({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: maxLife,
        maxLife,
        size: size * (0.68 + Math.random() * 0.72),
        color: i % 5 === 0 ? '#ffffff' : color,
        gravity,
        drag: 0.945,
        glow: true,
        streak: spd > 3.6,
      });
    }
  }

  confetti(x: number, y: number, count = 34) {
    const palette = [
      '#ff6b2b',
      '#2ee59d',
      '#38bdf8',
      '#facc15',
      '#fb7185',
      '#c084fc',
      '#ffffff',
    ];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.5;
      const spd = 3.6 + Math.random() * 7.6;
      const maxLife = 42 + Math.random() * 30;
      this.addParticle({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: maxLife,
        maxLife,
        size: 5 + Math.random() * 4,
        color: palette[i % palette.length],
        gravity: 0.16,
        drag: 0.972,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.38,
        rect: true,
      });
    }
  }

  bolt(x1: number, y1: number, x2: number, y2: number, color = '#38bdf8') {
    const pts: Array<{ x: number; y: number }> = [{ x: x1, y: y1 }];
    const steps = 7;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const jitter = Math.min(26, Math.max(8, dist * 0.12));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      pts.push({
        x: x1 + (x2 - x1) * t + (Math.random() - 0.5) * jitter,
        y: y1 + (y2 - y1) * t + (Math.random() - 0.5) * jitter,
      });
    }
    pts.push({ x: x2, y: y2 });
    this.bolts.push({ points: pts, color, life: 12 });
  }

  spark(x: number, y: number, vx: number, vy: number, color: string, size = 3) {
    this.addParticle({
      x,
      y,
      vx,
      vy,
      life: 16,
      maxLife: 16,
      size,
      color,
      drag: 0.93,
      glow: true,
      streak: Math.hypot(vx, vy) > 2.5,
    });
  }

  ring(x: number, y: number, color: string, maxR = 65, lineWidth = 3) {
    this.waves.push({
      x,
      y,
      r: 8,
      maxR,
      life: 1,
      color,
      lineWidth,
    });
  }

  popup(x: number, y: number, text: string, color = '#facc15', size = 14) {
    this.texts.push({
      x,
      y,
      vy: -1.55,
      text,
      color,
      life: 50,
      maxLife: 50,
      size,
    });
  }

  beginCamera(ctx: CanvasRenderingContext2D) {
    ctx.save();
    if (this.zoomPulse > 0.001 || Math.abs(this.shakeAngle) > 0.0004) {
      const s = 1 + this.zoomPulse;
      ctx.translate(GAME_WIDTH / 2, GAME_HEIGHT / 2);
      if (Math.abs(this.shakeAngle) > 0.0004) {
        ctx.rotate(this.shakeAngle);
        this.shakeAngle *= 0.72;
      }
      ctx.scale(s, s);
      ctx.translate(-GAME_WIDTH / 2, -GAME_HEIGHT / 2);
      this.zoomPulse *= 0.78;
    }
    if (this.shakeMag > 0.2) {
      const dx = (Math.random() - 0.5) * 2 * this.shakeMag;
      const dy = (Math.random() - 0.5) * 2 * this.shakeMag;
      ctx.translate(dx, dy);
    }
    this.shakeMag *= 0.81;
  }

  renderAndStep(ctx: CanvasRenderingContext2D) {
    // Additive neon afterimages
    if (this.ghosts.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      let w = 0;
      for (let i = 0; i < this.ghosts.length; i++) {
        const g = this.ghosts[i];
        g.life--;
        if (g.life <= 0) continue;
        this.ghosts[w++] = g;
        const pct = g.life / g.maxLife;
        ctx.globalAlpha = pct * 0.34;
        ctx.fillStyle = g.color;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r * (0.62 + pct * 0.38), 0, TAU);
        ctx.fill();
      }
      this.ghosts.length = w;
      ctx.restore();
    }

    // Double-ring shockwaves. A wide faint stroke under a thin bright one
    // reads as bloom without paying for shadowBlur.
    if (this.waves.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      let w = 0;
      for (let i = 0; i < this.waves.length; i++) {
        const wv = this.waves[i];
        wv.r += (wv.maxR - wv.r) * 0.24;
        wv.life -= 0.058;
        if (wv.life <= 0) continue;
        this.waves[w++] = wv;
        ctx.strokeStyle = wv.color;
        ctx.globalAlpha = wv.life * 0.28;
        ctx.lineWidth = Math.max(2, wv.lineWidth * wv.life * 3.2);
        ctx.beginPath();
        ctx.arc(wv.x, wv.y, wv.r, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = wv.life * 0.9;
        ctx.lineWidth = Math.max(0.8, wv.lineWidth * wv.life);
        ctx.stroke();

        if (wv.r > 16) {
          ctx.globalAlpha = wv.life * 0.45;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.max(0.6, wv.lineWidth * wv.life * 0.45);
          ctx.beginPath();
          ctx.arc(wv.x, wv.y, wv.r * 0.78, 0, TAU);
          ctx.stroke();
        }
      }
      this.waves.length = w;
      ctx.restore();
    }

    // Core + outer glow lightning bolts
    if (this.bolts.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      let w = 0;
      for (let i = 0; i < this.bolts.length; i++) {
        const b = this.bolts[i];
        b.life--;
        if (b.life <= 0) continue;
        this.bolts[w++] = b;
        const alpha = b.life / 12;
        ctx.beginPath();
        const pts = b.points;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
        ctx.strokeStyle = b.color;
        ctx.globalAlpha = alpha * 0.3;
        ctx.lineWidth = 11 * alpha;
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.85;
        ctx.lineWidth = 4.2 * alpha;
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6 * alpha;
        ctx.stroke();
      }
      this.bolts.length = w;
      ctx.restore();
    }

    // Particles, velocity-stretched sparks & confetti. Updated in place and
    // drawn without a save/restore per particle (hundreds per frame).
    if (this.particles.length > 0) {
      ctx.save();
      ctx.lineCap = 'round';
      let additive = false;
      let w = 0;
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const prevX = p.x;
        const prevY = p.y;
        p.x += p.vx;
        p.y += p.vy;
        if (p.gravity) p.vy += p.gravity;
        const drag = p.drag ?? 0.96;
        p.vx *= drag;
        p.vy *= drag;
        if (p.rot !== undefined && p.vrot !== undefined) p.rot += p.vrot;
        p.life -= 1;
        if (p.life <= 0) continue;
        this.particles[w++] = p;

        const alpha = p.life / p.maxLife;
        const wantAdditive = Boolean(p.glow);
        if (wantAdditive !== additive) {
          ctx.globalCompositeOperation = wantAdditive ? 'lighter' : 'source-over';
          additive = wantAdditive;
        }
        ctx.globalAlpha = alpha;
        if (p.rect) {
          const rot = p.rot ?? 0;
          const flutter = 0.55 + Math.abs(Math.sin(rot * 2)) * 0.45;
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          ctx.fillStyle = p.color;
          // Rotate about the particle without touching the shared transform stack.
          ctx.save();
          ctx.transform(cos, sin, -sin, cos, p.x, p.y);
          ctx.fillRect(
            -p.size / 2,
            (-p.size * flutter) / 3,
            p.size,
            (p.size * 2 * flutter) / 3,
          );
          ctx.restore();
          if (additive) ctx.globalCompositeOperation = 'lighter';
        } else if (p.streak && p.vx * p.vx + p.vy * p.vy > 3.24) {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1.2, p.size * (0.45 + alpha * 0.55));
          ctx.beginPath();
          ctx.moveTo(prevX - p.vx * 1.4, prevY - p.vy * 1.4);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.38 + alpha * 0.62), 0, TAU);
          ctx.fill();
        }
      }
      this.particles.length = w;
      ctx.restore();
    }

    // Kinetic score / status popups with elastic pop-in & crisp dark outline
    if (this.texts.length > 0) {
      let w = 0;
      for (let i = 0; i < this.texts.length; i++) {
        const t = this.texts[i];
        t.y += t.vy;
        t.vy *= 0.96;
        t.life -= 1;
        if (t.life <= 0) continue;
        this.texts[w++] = t;
        const age = t.maxLife - t.life;
        const popScale =
          age < 5
            ? 0.72 + (age / 5) * 0.52
            : age < 10
              ? 1.24 - ((age - 5) / 5) * 0.24
              : 1;
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.scale(popScale, popScale);
        ctx.globalAlpha = Math.min(1, t.life / 14);
        ctx.font = `800 ${t.size}px ${MONO_FONT}`;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(5, 7, 12, 0.92)';
        ctx.strokeText(t.text, 0, 0);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, 0, 0);
        ctx.restore();
      }
      this.texts.length = w;
    }

    // Chromatic edge flash on heavy hits
    if (this.chromaAlpha > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.chromaAlpha * 0.45;
      ctx.strokeStyle = '#ff6b2b';
      ctx.lineWidth = 9;
      ctx.strokeRect(4, 58, GAME_WIDTH - 8, GAME_HEIGHT - 62);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.strokeRect(10, 64, GAME_WIDTH - 20, GAME_HEIGHT - 74);
      ctx.restore();
      this.chromaAlpha *= 0.78;
    }

    if (this.flashAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = this.flashAlpha;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      ctx.restore();
      this.flashAlpha *= 0.78;
    }
  }

  endCamera(ctx: CanvasRenderingContext2D) {
    ctx.restore();
  }
}

/* ==========================================================================
   AUDIO — one AudioContext shared by every game. Creating a context per game
   leaks hardware voices on some browsers, starts "suspended" outside a user
   gesture, and strands the /tv audio tap on a dead context after a game
   switch. Each GameAudio owns only a gain bus into the shared compressor.
   ========================================================================== */

interface SharedAudio {
  ctx: AudioContext;
  bus: DynamicsCompressorNode;
  noise: AudioBuffer;
}

let sharedAudio: SharedAudio | null = null;

function getSharedAudio(): SharedAudio | null {
  if (sharedAudio && sharedAudio.ctx.state !== 'closed') return sharedAudio;
  try {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const bus = ctx.createDynamicsCompressor();
    bus.threshold.value = -14;
    bus.knee.value = 18;
    bus.ratio.value = 6;
    bus.attack.value = 0.003;
    bus.release.value = 0.14;
    bus.connect(ctx.destination);

    // One second of white noise, reused by every noise-based sound.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    sharedAudio = { ctx, bus, noise };
    return sharedAudio;
  } catch {
    return null;
  }
}

/** Minor-key progressions (scale degrees as semitone offsets from the root). */
const PROGRESSIONS: number[][] = [
  [0, -4, 3, -2], // i – VI – III – VII
  [0, 3, -2, -4], // i – III – VII – VI
  [0, -2, -4, -5], // i – VII – VI – v
  [0, 5, -4, -2], // i – iv – VI – VII
];
const ARP_SHAPES: number[][] = [
  [0, 7, 12, 15, 12, 7, 3, 7],
  [0, 3, 7, 12, 7, 3, 7, 10],
  [12, 7, 3, 0, 3, 7, 10, 15],
  [0, 12, 7, 15, 3, 12, 7, 10],
];

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class GameAudio {
  private bus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private disposed = false;
  private seed = 0;
  public muted = false;
  public volume = 0.85;
  public musicEnabled = false;

  private ensureCtx(): { ctx: AudioContext; out: AudioNode } | null {
    if (this.disposed || this.muted || this.volume <= 0.01) return null;
    const shared = getSharedAudio();
    if (!shared) return null;
    const { ctx } = shared;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = this.volume;
      this.bus.connect(shared.bus);
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    return { ctx, out: this.bus };
  }

  /** Small random detune so repeated SFX don't sound machine-gunned. */
  private vary(freq: number, amount = 0.04): number {
    return freq * (1 + (Math.random() * 2 - 1) * amount);
  }

  /** Picks the soundtrack's key, tempo and arpeggio from a per-game seed. */
  setMusicSeed(seed: number) {
    this.seed = Math.abs(Math.floor(seed)) % 997;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    const shared = sharedAudio;
    if (shared && this.bus) {
      this.bus.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        shared.ctx.currentTime,
        0.02,
      );
    }
  }

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (enabled && this.musicTimer === null && typeof window !== 'undefined') {
      this.nextNoteTime = 0;
      // Lookahead scheduler: a coarse JS timer queues notes slightly ahead on
      // the audio clock, so timing stays tight even when the main thread is busy.
      this.musicTimer = window.setInterval(() => this.scheduleMusic(), 25);
    } else if (!enabled && this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
      if (this.musicBus && sharedAudio) {
        const now = sharedAudio.ctx.currentTime;
        this.musicBus.gain.cancelScheduledValues(now);
        this.musicBus.gain.setTargetAtTime(0, now, 0.05);
        const old = this.musicBus;
        this.musicBus = null;
        window.setTimeout(() => old.disconnect(), 400);
      }
    }
  }

  private scheduleMusic() {
    if (!this.musicEnabled || this.muted || this.volume <= 0.01) return;
    const nodes = this.ensureCtx();
    if (!nodes || nodes.ctx.state !== 'running') return;
    const { ctx, out } = nodes;
    if (!this.musicBus) {
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.9;
      this.musicBus.connect(out);
    }
    const bpm = 112 + (this.seed % 5) * 5;
    const sixteenth = 60 / bpm / 4;
    const root = 45 + (this.seed % 7); // A2..D#3
    const prog = PROGRESSIONS[this.seed % PROGRESSIONS.length];
    const arp = ARP_SHAPES[(this.seed >> 2) % ARP_SHAPES.length];

    if (this.nextNoteTime < ctx.currentTime) {
      this.nextNoteTime = ctx.currentTime + 0.05;
    }
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      const t = this.nextNoteTime;
      const step = this.musicStep++;
      const s16 = step % 16;
      const bar = Math.floor(step / 16);
      const chordRoot = root + prog[bar % prog.length];
      const section = Math.floor(bar / 4) % 4; // 0 intro, 1-3 full

      // Four-on-the-floor kick with sidechain pump on the music bus
      if (s16 % 4 === 0) {
        this.kick(ctx, this.musicBus, t);
        const g = this.musicBus.gain;
        g.setValueAtTime(0.55, t);
        g.linearRampToValueAtTime(0.9, t + sixteenth * 2.5);
      }
      // Clap on 2 and 4
      if (section > 0 && (s16 === 4 || s16 === 12)) {
        this.noiseHit(ctx, this.musicBus, t, 0.09, 'bandpass', 1500, 0.08);
      }
      // Off-beat hats
      if (s16 % 2 === 1 || (section > 1 && s16 % 4 === 2)) {
        this.noiseHit(
          ctx,
          this.musicBus,
          t,
          0.03,
          'highpass',
          7000,
          s16 % 4 === 2 ? 0.035 : 0.022,
        );
      }
      // Rolling eighth-note bass
      if (s16 % 2 === 0) {
        const n = chordRoot - 12 + (s16 % 8 === 6 ? 12 : 0);
        this.synth(ctx, this.musicBus, t, midiHz(n), sixteenth * 1.7, 'sawtooth', 0.05, 520);
      }
      // Arpeggio over the chord
      if (section > 0 || bar % 2 === 1) {
        const n = chordRoot + 12 + arp[s16 % arp.length];
        this.synth(ctx, this.musicBus, t, midiHz(n), sixteenth * 0.9, 'square', 0.014, 2600);
      }
      // Pad swell at the top of each bar
      if (s16 === 0 && section > 0) {
        for (const iv of [0, 3, 7]) {
          this.synth(ctx, this.musicBus, t, midiHz(chordRoot + 12 + iv), sixteenth * 15, 'triangle', 0.012, 1800, true);
        }
      }
      this.nextNoteTime += sixteenth;
    }
  }

  private kick(ctx: AudioContext, out: AudioNode, t: number) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + 0.21);
  }

  private noiseHit(
    ctx: AudioContext,
    out: AudioNode,
    t: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    vol: number,
  ) {
    const shared = sharedAudio;
    if (!shared) return;
    const src = ctx.createBufferSource();
    src.buffer = shared.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.01);
  }

  private synth(
    ctx: AudioContext,
    out: AudioNode,
    t: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    cutoff: number,
    slowAttack = false,
  ) {
    const osc = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.3), t + dur);
    if (slowAttack) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
    } else {
      g.gain.setValueAtTime(vol, t);
    }
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    osc.connect(f);
    f.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  beep(freq: number, dur = 0.08, type: OscillatorType = 'triangle', vol = 0.1) {
    const nodes = this.ensureCtx();
    if (!nodes) return;
    const { ctx, out } = nodes;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.01);
    } catch {
      // ignore
    }
  }

  sweep(
    startFreq: number,
    endFreq: number,
    dur = 0.15,
    type: OscillatorType = 'sawtooth',
    vol = 0.1,
  ) {
    const nodes = this.ensureCtx();
    if (!nodes) return;
    const { ctx, out } = nodes;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, startFreq), t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(25, endFreq), t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.01);
    } catch {
      // ignore
    }
  }

  noiseBurst(dur = 0.18, filterFreq = 850, vol = 0.14) {
    const nodes = this.ensureCtx();
    if (!nodes) return;
    try {
      this.noiseHit(nodes.ctx, nodes.out, nodes.ctx.currentTime, dur, 'lowpass', filterFreq, vol);
    } catch {
      // ignore
    }
  }

  combo(step = 1) {
    const base = 440 * Math.pow(1.06, Math.min(18, step));
    this.sweep(base, base * 1.5, 0.12, 'triangle', 0.11);
    this.beep(base * 2, 0.07, 'sine', 0.05);
  }

  pickup(pitchOffset = 0) {
    const f = this.vary(580 + pitchOffset, 0.03);
    this.sweep(f, f * 1.86, 0.1, 'sine', 0.1);
    this.beep(f * 2, 0.06, 'triangle', 0.05);
  }

  hit() {
    const f = this.vary(240, 0.08);
    this.sweep(f, f * 0.3, 0.09, 'square', 0.1);
    this.sweep(f * 0.54, 44, 0.09, 'sine', 0.11);
    this.noiseBurst(0.065, this.vary(1350, 0.15), 0.075);
  }

  dash() {
    const f = this.vary(340, 0.06);
    this.sweep(f, f * 2.4, 0.085, 'sawtooth', 0.07);
    this.noiseBurst(0.055, 2200, 0.045);
  }

  explosion() {
    const f = this.vary(190, 0.08);
    this.sweep(f, 32, 0.3, 'sawtooth', 0.14);
    this.sweep(96, 26, 0.28, 'sine', 0.16);
    this.noiseBurst(0.26, this.vary(680, 0.12), 0.17);
  }

  win() {
    const nodes = this.ensureCtx();
    if (!nodes) return;
    // Scheduled on the audio clock so the fanfare can't smear under load.
    const { ctx, out } = nodes;
    const t = ctx.currentTime;
    const notes: Array<[number, number, number]> = [
      [523.25, 0, 0.1],
      [659.25, 0.07, 0.1],
      [783.99, 0.145, 0.12],
      [1046.5, 0.225, 0.32],
    ];
    for (const [f, at, dur] of notes) {
      this.synth(ctx, out, t + at, f, dur, 'triangle', 0.12, 6000);
      this.synth(ctx, out, t + at, f * 1.005, dur, 'square', 0.025, 3200);
    }
    this.synth(ctx, out, t + 0.225, 261.63, 0.4, 'sawtooth', 0.05, 1400);
  }

  dispose() {
    this.disposed = true;
    if (this.musicTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    const shared = sharedAudio;
    const bus = this.bus;
    this.bus = null;
    this.musicBus = null;
    if (bus && shared) {
      // Fade rather than click, then detach this game's bus from the mixer.
      bus.gain.cancelScheduledValues(shared.ctx.currentTime);
      bus.gain.setTargetAtTime(0, shared.ctx.currentTime, 0.03);
      window.setTimeout(() => bus.disconnect(), 300);
    }
  }
}

export function readPlayerInput(
  slot: number,
  pads: readonly (Gamepad | null)[],
  keys: Set<string>,
): PlayerInput {
  const pad = pads[slot];
  let x = 0;
  let y = 0;
  let actionA = false;
  let actionB = false;
  let actionX = false;
  let actionY = false;
  let start = false;

  if (pad && pad.connected) {
    if (Math.abs(pad.axes[0] ?? 0) > 0.14) x = pad.axes[0];
    if (Math.abs(pad.axes[1] ?? 0) > 0.14) y = pad.axes[1];
    if (pad.buttons[GAMEPAD_BUTTON.DPAD_LEFT]?.pressed) x = -1;
    if (pad.buttons[GAMEPAD_BUTTON.DPAD_RIGHT]?.pressed) x = 1;
    if (pad.buttons[GAMEPAD_BUTTON.DPAD_UP]?.pressed) y = -1;
    if (pad.buttons[GAMEPAD_BUTTON.DPAD_DOWN]?.pressed) y = 1;
    actionA = Boolean(
      pad.buttons[GAMEPAD_BUTTON.SOUTH]?.pressed ||
        pad.buttons[GAMEPAD_BUTTON.R1]?.pressed,
    );
    actionB = Boolean(
      pad.buttons[GAMEPAD_BUTTON.EAST]?.pressed ||
        pad.buttons[GAMEPAD_BUTTON.L1]?.pressed,
    );
    actionX = Boolean(pad.buttons[GAMEPAD_BUTTON.WEST]?.pressed);
    actionY = Boolean(pad.buttons[GAMEPAD_BUTTON.NORTH]?.pressed);
    start = Boolean(pad.buttons[GAMEPAD_BUTTON.START]?.pressed);
  }

  // Always allow local keyboard fallback/merge for Slot 0 so P1 never loses keyboard control
  if (slot === 0) {
    let kx = 0;
    let ky = 0;
    if (keys.has('arrowleft') || keys.has('a')) kx -= 1;
    if (keys.has('arrowright') || keys.has('d')) kx += 1;
    if (keys.has('arrowup') || keys.has('w')) ky -= 1;
    if (keys.has('arrowdown') || keys.has('s')) ky += 1;
    if (kx !== 0) x = kx;
    if (ky !== 0) y = ky;
    actionA = actionA || keys.has(' ') || keys.has('j') || keys.has('enter');
    actionB = actionB || keys.has('shift') || keys.has('k');
    actionX = actionX || keys.has('u') || keys.has('q');
    actionY = actionY || keys.has('i') || keys.has('e');
    start = start || keys.has('enter');
  }

  const mag = Math.hypot(x, y);
  if (mag > 1) {
    x /= mag;
    y /= mag;
  }

  return { x, y, actionA, actionB, actionX, actionY, start };
}

export function getSlotIdentity(slot: number, players: PlayerInfo[]) {
  const found = players.find((p) => p.slot === slot);
  if (found) {
    return {
      name: found.name,
      color: found.color,
      isHuman: true,
    };
  }
  return {
    name: slot === 0 ? 'P1 (Keys)' : `CPU ${slot + 1}`,
    color: PLAYER_COLORS[slot],
    isHuman: slot === 0,
  };
}

/**
 * Draw a glossy 3D arcade player orb with soft ground shadow, specular highlight,
 * glowing cyber-visor with twin LED eyes, floating golden leader crown,
 * rotating energy shield ring, and radial cooldown meter.
 */
export function drawPlayerOrb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  slot: number,
  opts?: {
    angle?: number;
    leader?: boolean;
    shield?: boolean;
    flash?: boolean;
    cooldownPct?: number; // 0 = ready, 1 = full cd
    label?: string;
  },
) {
  const t = performance.now() * 0.003;
  ctx.save();

  // Soft grounded contact shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 0.85, radius * 0.86, radius * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rotating golden leader halo + mini crown chevron above
  if (opts?.leader) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 0.8);
    ctx.strokeStyle = '#facc15';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, radius + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Floating 3-point crown
    const cy = y - radius - 11 + Math.sin(t * 2.2) * 2;
    ctx.save();
    ctx.fillStyle = '#facc15';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x - 7, cy + 4);
    ctx.lineTo(x - 8, cy - 3);
    ctx.lineTo(x - 3, cy + 0.5);
    ctx.lineTo(x, cy - 5);
    ctx.lineTo(x + 3, cy + 0.5);
    ctx.lineTo(x + 8, cy - 3);
    ctx.lineTo(x + 7, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Cooldown radial progress ring
  if (opts?.cooldownPct && opts.cooldownPct > 0.01) {
    const pct = Math.max(0, Math.min(1, 1 - opts.cooldownPct));
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, radius + 4.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(
      x,
      y,
      radius + 4.5,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * pct,
    );
    ctx.stroke();
  }

  // Glossy 3D sphere gradient body
  ctx.shadowColor = opts?.flash ? '#ffffff' : color;
  ctx.shadowBlur = opts?.flash ? 28 : 16;
  const grad = ctx.createRadialGradient(
    x - radius * 0.34,
    y - radius * 0.34,
    radius * 0.12,
    x,
    y,
    radius,
  );
  if (opts?.flash) {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.7, '#ffffff');
    grad.addColorStop(1, color);
  } else {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.26, color);
    grad.addColorStop(1, color);
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Inner dark vignette rim for physical depth
  ctx.shadowBlur = 0;
  const shade = ctx.createRadialGradient(
    x - radius * 0.25,
    y - radius * 0.25,
    radius * 0.45,
    x,
    y,
    radius,
  );
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(5,7,14,0.38)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Crisp bright rim border
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.stroke();

  // Gloss specular pill top-left
  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  ctx.beginPath();
  ctx.ellipse(
    x - radius * 0.3,
    y - radius * 0.36,
    radius * 0.28,
    radius * 0.14,
    -Math.PI / 5,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Rotating energy shield bubble
  if (opts?.shield) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-t * 1.4);
    ctx.strokeStyle = '#38bdf8';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 6.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.arc(0, 0, radius + 9.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Expressive directional cyber-visor with twin glowing LED eyes OR crisp P-label
  if (opts?.angle !== undefined) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(opts.angle);
    const vx = radius * 0.34;
    const vw = Math.max(6, radius * 0.42);
    const vh = Math.max(9, radius * 0.72);
    ctx.fillStyle = '#07090e';
    ctx.beginPath();
    ctx.roundRect(vx - vw * 0.45, -vh / 2, vw, vh, vw * 0.45);
    ctx.fill();
    // Twin bright LED optics inside visor
    ctx.fillStyle = '#f8fafc';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 4;
    const eyeR = Math.max(1.5, radius * 0.1);
    ctx.beginPath();
    ctx.arc(vx + vw * 0.12, -vh * 0.2, eyeR, 0, Math.PI * 2);
    ctx.arc(vx + vw * 0.12, vh * 0.2, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fillStyle = '#07090e';
    ctx.font = `800 ${Math.max(9, Math.round(radius * 0.54))}px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts?.label ?? `P${slot + 1}`, x, y + 1);
  }
  ctx.restore();
}

/* ==========================================================================
   BACKDROP — the static parts (gradient, floor grid, glowing bezel) are
   rasterized once per accent/resolution into layers, so each frame is three
   drawImage calls instead of dozens of strokes plus an 18px shadowBlur.
   ========================================================================== */

// Arena backdrop. Drawn as vectors every frame on purpose: an earlier version
// cached the layers in off-screen canvases, but those live in CPU memory and
// drawImage() re-uploaded ~25 MB/frame to the GPU (60 fps -> ~18 fps on an M2
// at 2x). A few gradients and two cached Path2Ds are far cheaper for the GPU.
let gridPath: Path2D | null = null;
let gridDots: Path2D | null = null;
let bezelPath: Path2D | null = null;
let cornerPath: Path2D | null = null;

function backdropPaths() {
  if (gridPath && gridDots && bezelPath && cornerPath) {
    return { gridPath, gridDots, bezelPath, cornerPath };
  }
  gridPath = new Path2D();
  for (let gx = 48; gx < GAME_WIDTH - 24; gx += 48) {
    gridPath.moveTo(gx, 66);
    gridPath.lineTo(gx, GAME_HEIGHT - 28);
  }
  for (let gy = 84; gy < GAME_HEIGHT - 28; gy += 48) {
    gridPath.moveTo(28, gy);
    gridPath.lineTo(GAME_WIDTH - 28, gy);
  }
  gridDots = new Path2D();
  for (let gx = 48; gx < GAME_WIDTH - 24; gx += 96) {
    for (let gy = 84; gy < GAME_HEIGHT - 28; gy += 96) gridDots.rect(gx - 1, gy - 1, 2, 2);
  }
  bezelPath = new Path2D();
  bezelPath.roundRect(28, 64, GAME_WIDTH - 56, GAME_HEIGHT - 92, 16);

  const x1 = 28;
  const y1 = 64;
  const x2 = GAME_WIDTH - 28;
  const y2 = GAME_HEIGHT - 28;
  const br = 20;
  const c = new Path2D();
  c.moveTo(x1, y1 + br);
  c.lineTo(x1, y1 + 10);
  c.quadraticCurveTo(x1, y1, x1 + 10, y1);
  c.lineTo(x1 + br, y1);
  c.moveTo(x2 - br, y1);
  c.lineTo(x2 - 10, y1);
  c.quadraticCurveTo(x2, y1, x2, y1 + 10);
  c.lineTo(x2, y1 + br);
  c.moveTo(x1, y2 - br);
  c.lineTo(x1, y2 - 10);
  c.quadraticCurveTo(x1, y2, x1 + 10, y2);
  c.lineTo(x1 + br, y2);
  c.moveTo(x2 - br, y2);
  c.lineTo(x2 - 10, y2);
  c.quadraticCurveTo(x2, y2, x2, y2 - 10);
  c.lineTo(x2, y2 - br);
  cornerPath = c;
  return { gridPath, gridDots, bezelPath, cornerPath };
}

export function drawArcadeBackdrop(
  ctx: CanvasRenderingContext2D,
  accent = '#ff6b2b',
) {
  const now = performance.now() * 0.001;
  const P = backdropPaths();

  ctx.save();
  const bg = ctx.createRadialGradient(
    GAME_WIDTH / 2,
    GAME_HEIGHT / 2,
    40,
    GAME_WIDTH / 2,
    GAME_HEIGHT / 2,
    GAME_WIDTH * 0.74,
  );
  bg.addColorStop(0, '#141c2f');
  bg.addColorStop(0.65, '#0a0e18');
  bg.addColorStop(1, '#05070c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  ctx.stroke(P.gridPath);
  ctx.fillStyle = 'rgba(255,255,255,0.075)';
  ctx.fill(P.gridDots);

  // Breathing colour spots
  ctx.globalAlpha = 0.085 + Math.sin(now * 1.3) * 0.02;
  const spotA = ctx.createRadialGradient(120, 120, 10, 120, 120, 320);
  spotA.addColorStop(0, accent);
  spotA.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = spotA;
  ctx.fillRect(0, 54, 440, 386);
  const spotB = ctx.createRadialGradient(GAME_WIDTH - 120, GAME_HEIGHT - 80, 10, GAME_WIDTH - 120, GAME_HEIGHT - 80, 300);
  spotB.addColorStop(0, '#38bdf8');
  spotB.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = spotB;
  ctx.fillRect(GAME_WIDTH - 420, GAME_HEIGHT - 380, 420, 380);

  // Slow diagonal light sweep gliding across the arena floor
  const sweepX = ((now * 90) % (GAME_WIDTH + 600)) - 300;
  const sweep = ctx.createLinearGradient(sweepX - 160, 0, sweepX + 160, GAME_HEIGHT);
  sweep.addColorStop(0, 'rgba(255,255,255,0)');
  sweep.addColorStop(0.5, 'rgba(255,255,255,0.028)');
  sweep.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = sweep;
  ctx.fillRect(28, 64, GAME_WIDTH - 56, GAME_HEIGHT - 92);

  // Glowing bezel: wide faint strokes fake the blur halo without shadowBlur
  const pulse = Math.sin(now * 2.1) * 0.08 + 0.3;
  ctx.strokeStyle = accent;
  ctx.lineJoin = 'round';
  ctx.globalAlpha = pulse * 0.18;
  ctx.lineWidth = 14;
  ctx.stroke(P.bezelPath);
  ctx.globalAlpha = pulse * 0.35;
  ctx.lineWidth = 7;
  ctx.stroke(P.bezelPath);
  ctx.globalAlpha = pulse;
  ctx.lineWidth = 2.5;
  ctx.stroke(P.bezelPath);
  ctx.lineWidth = 3;
  ctx.stroke(P.cornerPath);
  ctx.restore();
}

export interface ScorePillData {
  slot: number;
  name: string;
  color: string;
  active: boolean;
  valueText: string;
  highlight?: boolean;
}

interface ScoreAnimState {
  values: string[];
  lead: number[];
  popAt: number[];
}
const scoreAnim = new WeakMap<CanvasRenderingContext2D, ScoreAnimState>();

function leadingNumber(text: string): number {
  const m = /-?\d+(\.\d+)?/.exec(text);
  return m ? parseFloat(m[0]) : Number.NaN;
}

const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function drawTopScoreboard(
  ctx: CanvasRenderingContext2D,
  pills: ScorePillData[],
  footerHint: string,
) {
  const now = performance.now();
  let anim = scoreAnim.get(ctx);
  if (!anim) {
    anim = { values: [], lead: [], popAt: [] };
    scoreAnim.set(ctx, anim);
  }

  ctx.save();
  // OSD strip: near-black with faint raster lines
  ctx.fillStyle = 'rgba(5, 4, 9, 0.96)';
  ctx.fillRect(0, 0, GAME_WIDTH, 55);
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 1; y < 55; y += 3) ctx.fillRect(0, y, GAME_WIDTH, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 55, GAME_WIDTH, 1);

  const W = 218;
  const H = 37;
  const Y = 9;
  const BLOCK = 34;

  for (let i = 0; i < pills.length; i++) {
    const p = pills[i];
    const bx = 24 + i * 234;
    const lead = p.highlight && p.active;

    // Score-change detection: pop when the leading number goes up (so
    // countdown timers in valueText don't constantly trigger it).
    const prev = anim.values[i];
    if (prev !== undefined && prev !== p.valueText && p.active) {
      const n = leadingNumber(p.valueText);
      const was = anim.lead[i];
      if (!Number.isNaN(n) && !Number.isNaN(was) ? n > was : now - (anim.popAt[i] ?? 0) > 500) {
        anim.popAt[i] = now;
      }
    }
    anim.values[i] = p.valueText;
    anim.lead[i] = leadingNumber(p.valueText);
    const popT = Math.min(1, (now - (anim.popAt[i] ?? -1e9)) / 380);
    const popping = popT < 1;

    // Panel
    ctx.save();
    if (lead) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = p.active ? (lead ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)') : 'rgba(255,255,255,0.012)';
    ctx.strokeStyle = lead ? p.color : p.active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)';
    ctx.lineWidth = lead ? 1.6 : 1;
    ctx.beginPath();
    ctx.roundRect(bx + 0.5, Y + 0.5, W - 1, H - 1, 5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Port block: P# on a solid player-colour tab
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx + 3, Y + 3, BLOCK, H - 6, 3);
    if (p.active) {
      ctx.fillStyle = withAlpha(p.color, lead ? 0.26 : 0.16);
      ctx.fill();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = lead ? 12 : 6;
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.setLineDash([3, 3]);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.fillStyle = p.active ? '#ffffff' : 'rgba(255,255,255,0.3)';
    if (p.active) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
    }
    ctx.font = `20px ${OSD_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`P${p.slot + 1}`, bx + 3 + BLOCK / 2, Y + H / 2 + 1);
    ctx.restore();

    if (popping) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - popT) * 0.35;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(bx, Y, W, H, 5);
      ctx.fill();
      ctx.restore();
    }

    if (lead) {
      // Leader sheen sliding across the panel
      const k = ((now / 1600 + i * 0.13) % 1) * 1.6 - 0.3;
      const sx = bx + k * W;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(bx, Y, W, H, 5);
      ctx.clip();
      const sheen = ctx.createLinearGradient(sx - 30, 0, sx + 30, 0);
      sheen.addColorStop(0, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0.12)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(bx, Y, W, H);
      ctx.restore();
    }

    // Value (right) first, so the name can be fitted into what's left
    const value = p.active ? p.valueText : 'OPEN';
    ctx.font = `21px ${OSD_FONT}`;
    const valueW = ctx.measureText(value).width;

    const nameX = bx + BLOCK + 11;
    const maxName = W - BLOCK - 11 - valueW - 20;
    ctx.font = '700 12px "DM Sans", system-ui, sans-serif';
    let name = p.active ? `${lead ? '★ ' : ''}${p.name}` : '';
    while (name.length > 1 && ctx.measureText(name).width > maxName) {
      name = name.slice(0, -2) + '…';
    }
    ctx.fillStyle = p.active ? (lead ? '#ffffff' : 'rgba(246,243,235,0.82)') : 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, nameX, Y + H / 2 + 0.5);

    ctx.save();
    const sc = popping ? 1 + (1 - easeOutBack(popT)) * -0.6 + (1 - popT) * 0.35 : 1;
    ctx.translate(bx + W - 10, Y + H / 2 + 1);
    ctx.scale(Math.max(0.8, sc), Math.max(0.8, sc));
    const valueColor = popping ? '#ffffff' : !p.active ? 'rgba(255,255,255,0.22)' : lead ? '#ffb800' : '#b5ff2a';
    ctx.fillStyle = valueColor;
    if (p.active) {
      ctx.shadowColor = valueColor;
      ctx.shadowBlur = 8;
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `21px ${OSD_FONT}`;
    ctx.fillText(value, 0, 0);
    ctx.restore();
  }

  // Footer hint as a TV caption line
  ctx.fillStyle = 'rgba(5, 4, 9, 0.9)';
  ctx.fillRect(0, GAME_HEIGHT - 22, GAME_WIDTH, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(0, GAME_HEIGHT - 22, GAME_WIDTH, 1);
  ctx.fillStyle = 'rgba(246, 243, 235, 0.62)';
  ctx.font = `16px ${OSD_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(footerHint.toUpperCase(), GAME_WIDTH / 2, GAME_HEIGHT - 10.5);
  ctx.restore();
}

/** #rgb / #rrggbb / rgb() -> rgba() with the given alpha (falls back to white). */
function withAlpha(color: string, a: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const rgb = /^rgba?\(([^,]+),([^,]+),([^,)]+)/i.exec(color);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]}, ${a})`;
  return `rgba(255, 255, 255, ${a})`;
}

interface BannerAnimState {
  title: string;
  start: number;
  last: number;
}
const bannerAnim = new WeakMap<CanvasRenderingContext2D, BannerAnimState>();

/**
 * Round / match banner. Stateless for callers (draw it every frame while it
 * should show); entrance animation restarts whenever the title changes or the
 * banner reappears after being hidden.
 */
export function drawRoundBanner(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
  color = '#ff3b1d',
) {
  const now = performance.now();
  let st = bannerAnim.get(ctx);
  if (!st || st.title !== title || now - st.last > 250) {
    st = { title, start: now, last: now };
    bannerAnim.set(ctx, st);
  }
  st.last = now;
  const age = now - st.start;
  const tIn = Math.min(1, age / 420);
  const scale = 0.55 + easeOutBack(tIn) * 0.45;
  const subAlpha = Math.max(0, Math.min(1, (age - 160) / 220));

  const bw = 500;
  const bh = 122;
  const cx = GAME_WIDTH / 2;
  const cy = GAME_HEIGHT / 2;

  ctx.save();
  ctx.globalAlpha = Math.min(1, tIn * 2.2);
  ctx.fillStyle = 'rgba(8, 10, 14, 0.48)';
  ctx.fillRect(0, 56, GAME_WIDTH, GAME_HEIGHT - 78);

  // Speed lines streaking behind the card on entry
  if (tIn < 1) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const y = cy - 70 + i * 17.5;
      const len = 120 + ((i * 53) % 140);
      const x = cx + (i % 2 ? 1 : -1) * (GAME_WIDTH * (1 - tIn) * 0.6 + 120);
      ctx.globalAlpha = (1 - tIn) * 0.55;
      ctx.beginPath();
      ctx.moveTo(x - len / 2, y);
      ctx.lineTo(x + len / 2, y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.globalAlpha = Math.min(1, tIn * 2.2);

  const bx = -bw / 2;
  const by = -bh / 2;

  // Broadcast card: squared, near-black, accent rail on the left
  ctx.shadowColor = color;
  ctx.shadowBlur = 34;
  ctx.fillStyle = 'rgba(5, 4, 9, 0.96)';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 6);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 6);
  ctx.clip();

  // Raster lines
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = by + 1; y < by + bh; y += 3) ctx.fillRect(bx, y, bw, 1);

  // Accent wash from the left rail
  const wash = ctx.createLinearGradient(bx, 0, bx + bw * 0.6, 0);
  wash.addColorStop(0, withAlpha(color, 0.33));
  wash.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = wash;
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = color;
  ctx.fillRect(bx, by, 8, bh);

  // Snow bursts on entry, like a channel cutting in
  if (age < 260) {
    const a = 1 - age / 260;
    for (let i = 0; i < 14; i++) {
      const yy = by + ((i * 37 + Math.floor(age / 30) * 53) % bh);
      ctx.fillStyle = `rgba(255,255,255,${(0.08 + ((i * 7) % 5) * 0.04) * a})`;
      ctx.fillRect(bx, yy, bw, 1 + (i % 3));
    }
  }

  // Sheen sweeping across every couple of seconds
  const k = ((age / 2200) % 1) * 2 - 0.5;
  const sx = bx + k * bw;
  const sheen = ctx.createLinearGradient(sx - 60, by, sx + 60, by + bh);
  sheen.addColorStop(0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();

  // Top rail extending out on entry
  const barW = bw * Math.min(1, age / 300);
  ctx.fillStyle = color;
  ctx.fillRect(-barW / 2, by - 1, barW, 3);

  // Title
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 30px Syne, "Bricolage Grotesque", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let shown = title;
  while (shown.length > 4 && ctx.measureText(shown).width > bw - 48) shown = shown.slice(0, -2) + '…';
  ctx.fillText(shown, 4, -4);

  // Subtitle as an OSD caption
  ctx.shadowBlur = 8;
  ctx.globalAlpha *= subAlpha;
  ctx.fillStyle = color;
  ctx.font = `20px ${OSD_FONT}`;
  ctx.fillText(subtitle.toUpperCase(), 4, 30 + (1 - subAlpha) * 6);
  ctx.restore();
}
