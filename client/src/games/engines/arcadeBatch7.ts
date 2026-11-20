import {
  drawArcadeBackdrop,
  drawPlayerOrb,
  drawRoundBanner,
  drawTopScoreboard,
  GAME_HEIGHT,
  GAME_WIDTH,
  getSlotIdentity,
  MiniGameEngine,
  readPlayerInput,
} from '../sharedEngine';

// 31. LASER ROULETTE (Telegraphed Sweeper Beams, Safe Pods, Phase Dash & Gems)
export function createLaserRouletteEngine(): MiniGameEngine {
  const CX = GAME_WIDTH / 2;
  const CY = 290;
  const RADIUS = 196;
  const wins = [0, 0, 0, 0];

  interface Gem {
    x: number;
    y: number;
    kind: 'speed' | 'shield';
    life: number;
  }

  interface SafePod {
    x: number;
    y: number;
    r: number;
    life: number;
    maxLife: number;
  }

  interface Beam {
    angle: number;
    speed: number;
    charge: number; // >0 means telegraphing, 0 means active lethal beam
    double: boolean;
  }

  const makePlayers = (invuln: number) =>
    [0, 1, 2, 3].map((i) => ({
      x: CX + Math.cos((i * Math.PI) / 2) * 112,
      y: CY + Math.sin((i * Math.PI) / 2) * 112,
      vx: 0,
      vy: 0,
      angle: (i * Math.PI) / 2,
      alive: true,
      dashCd: 0,
      invuln,
      jumpZ: 0,
      speedTimer: 0,
      shield: false,
      prevA: false,
      // Bot brain: cached safe target + reaction timer
      botTx: CX,
      botTy: CY,
      botThink: i * 3,
    }));

  let playersPos = makePlayers(20);

  let beams: Beam[] = [{ angle: 0, speed: 0.021, charge: 45, double: false }];
  let gems: Gem[] = [];
  let pods: SafePod[] = [];
  let roundTime = 0;
  let escalateTier = 1;
  let banner = '';
  let bannerSub = '';
  let freeze = 25;
  let bestSoloTime = 0;

  // Perpendicular clearance of a point from every lethal beam line, optionally
  // predicted `ahead` frames into the future.
  const beamClearance = (px: number, py: number, ahead: number, maxCharge: number) => {
    let best = Infinity;
    const rx = px - CX;
    const ry = py - CY;
    for (const b of beams) {
      if (b.charge > maxCharge) continue;
      const moveFrames = Math.max(0, ahead - b.charge);
      const a = b.angle + b.speed * moveFrames;
      const lines = b.double ? 2 : 1;
      for (let l = 0; l < lines; l++) {
        const ang = a + l * (Math.PI / 2);
        const d = Math.abs(rx * -Math.sin(ang) + ry * Math.cos(ang));
        if (d < best) best = d;
      }
    }
    return best;
  };

  const spawnGem = () => {
    const ang = Math.random() * Math.PI * 2;
    const dist = 62 + Math.random() * (RADIUS - 92);
    gems.push({
      x: CX + Math.cos(ang) * dist,
      y: CY + Math.sin(ang) * dist,
      kind: Math.random() < 0.55 ? 'speed' : 'shield',
      life: 480,
    });
  };

  const spawnPod = () => {
    const ang = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * (RADIUS - 108);
    pods.push({
      x: CX + Math.cos(ang) * dist,
      y: CY + Math.sin(ang) * dist,
      r: 32,
      life: 240,
      maxLife: 240,
    });
  };

  const reset = () => {
    playersPos = makePlayers(30);
    beams = [{ angle: 0, speed: 0.021, charge: 50, double: false }];
    gems = [];
    pods = [];
    roundTime = 0;
    escalateTier = 1;
    banner = '';
    bannerSub = '';
    freeze = 25;
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (active[slot].isHuman) rumble(slot, ms, intensity);
      };

      const maxWins = Math.max(...wins);

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        roundTime++;

        // Escalate tiers with telegraphed new beams
        const newTier = 1 + Math.floor(roundTime / 420);
        if (newTier > escalateTier && beams.length < 3) {
          escalateTier = newTier;
          const reverse = escalateTier % 2 === 0 ? -1 : 1;
          beams.push({
            angle: beams[0].angle + Math.PI / 2,
            speed: reverse * (0.018 + escalateTier * 0.004),
            charge: 75,
            double: escalateTier >= 3,
          });
          vfx.popup(CX, CY - 45, `WAVE ${escalateTier}!`, '#facc15', 18);
          vfx.ring(CX, CY, '#ef4444', 120, 3);
          sound.combo(escalateTier + 2);
        }

        // Gradually accelerate active beams
        for (const b of beams) {
          if (b.charge > 0) {
            b.charge--;
            if (b.charge > 0 && b.charge % 15 === 0) sound.beep(620 + (75 - b.charge) * 6, 0.05, 'square', 0.05);
            if (b.charge === 0) {
              vfx.ring(CX, CY, '#ef4444', 90, 3);
              vfx.flash('#ef4444', 0.12);
              vfx.shake(3.5);
              sound.noiseBurst(0.14, 1400, 0.12);
              sound.sweep(180, 720, 0.18, 'sawtooth', 0.07);
              for (let s = 0; s < 4; s++) buzz(s, 60, 0.35);
            }
          } else {
            b.speed += Math.sign(b.speed) * 0.000018;
            const maxSpd = 0.056;
            if (Math.abs(b.speed) > maxSpd) b.speed = Math.sign(b.speed) * maxSpd;
            b.angle += b.speed;
          }
        }

        if (frame % 150 === 0 && gems.length < 3) spawnGem();
        if (frame % 230 === 0 && pods.length < 2) spawnPod();

        for (let gi = gems.length - 1; gi >= 0; gi--) {
          if (--gems[gi].life <= 0) gems.splice(gi, 1);
        }
        for (let pi = pods.length - 1; pi >= 0; pi--) {
          const pd = pods[pi];
          if (--pd.life <= 0) {
            vfx.ring(pd.x, pd.y, '#38bdf8', 42, 2);
            pods.splice(pi, 1);
          }
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !playersPos[i].alive) continue;
          const p = playersPos[i];
          let ix = 0;
          let iy = 0;
          let jumpBtn = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            jumpBtn = inp.actionA;
          } else {
            // Bot: periodically re-plan toward the spot with the most beam clearance
            // (predicted ~18 frames ahead), detouring for pods/gems, and phase-dodge
            // when a lethal line is about to sweep over it.
            if (--p.botThink <= 0) {
              p.botThink = 7 + Math.floor(Math.random() * 6);
              let bestScore = -Infinity;
              for (let k = 0; k < 16; k++) {
                const ang = (k / 16) * Math.PI * 2;
                const rad = k % 2 === 0 ? 125 : 80;
                const cx = CX + Math.cos(ang) * rad;
                const cy = CY + Math.sin(ang) * rad;
                const clear = Math.min(beamClearance(cx, cy, 0, 30), beamClearance(cx, cy, 18, 30));
                const travel = Math.hypot(cx - p.x, cy - p.y);
                const score = Math.min(clear, 90) - travel * 0.12 + Math.random() * 10;
                if (score > bestScore) {
                  bestScore = score;
                  p.botTx = cx;
                  p.botTy = cy;
                }
              }
              for (const pd of pods) {
                if (pd.life > 50 && Math.hypot(pd.x - p.x, pd.y - p.y) < 170) {
                  p.botTx = pd.x;
                  p.botTy = pd.y;
                }
              }
              for (const g of gems) {
                if (Math.hypot(g.x - p.x, g.y - p.y) < 130 && beamClearance(g.x, g.y, 10, 20) > 40) {
                  p.botTx = g.x;
                  p.botTy = g.y;
                }
              }
            }
            const d = Math.hypot(p.botTx - p.x, p.botTy - p.y);
            if (d > 6) {
              ix = ((p.botTx - p.x) / d) * 0.9;
              iy = ((p.botTy - p.y) / d) * 0.9;
            }
            if (p.dashCd === 0 && p.invuln === 0 && beamClearance(p.x, p.y, 5, 0) < 24 && Math.random() < 0.75) {
              jumpBtn = true;
            }
          }

          const trigA = jumpBtn && !p.prevA;
          p.prevA = jumpBtn;

          if (p.dashCd > 0) p.dashCd--;
          if (p.invuln > 0) p.invuln--;
          if (p.speedTimer > 0) p.speedTimer--;
          if (p.jumpZ > 0) p.jumpZ = Math.max(0, p.jumpZ - 0.8);

          if (trigA && p.dashCd === 0) {
            p.invuln = 20;
            p.dashCd = 46;
            p.jumpZ = 14;
            const dAng = Math.hypot(ix, iy) > 0.15 ? Math.atan2(iy, ix) : p.angle;
            p.vx += Math.cos(dAng) * 7.5;
            p.vy += Math.sin(dAng) * 7.5;
            vfx.ring(p.x, p.y, active[i].color, 52, 3);
            vfx.burst(p.x, p.y, active[i].color, 10, 4);
            sound.dash();
            buzz(i, 40, 0.35);
          }

          if (Math.hypot(ix, iy) > 0.15) p.angle = Math.atan2(iy, ix);
          const baseSpd = p.speedTimer > 0 ? 6.2 : 4.5;
          p.vx = p.vx * 0.8 + ix * baseSpd * 0.42;
          p.vy = p.vy * 0.8 + iy * baseSpd * 0.42;
          p.x += p.vx;
          p.y += p.vy;

          if (p.invuln > 0 || p.speedTimer > 0) {
            if (frame % 2 === 0) vfx.afterimage(p.x, p.y - p.jumpZ, 14, active[i].color, 8);
          }

          const dc = Math.hypot(p.x - CX, p.y - CY);
          if (dc > RADIUS - 16) {
            p.x = CX + ((p.x - CX) / dc) * (RADIUS - 16);
            p.y = CY + ((p.y - CY) / dc) * (RADIUS - 16);
          } else if (dc < 34) {
            p.x = CX + ((p.x - CX) / (dc || 1)) * 34;
            p.y = CY + ((p.y - CY) / (dc || 1)) * 34;
          }

          // Collect gems
          for (let gi = gems.length - 1; gi >= 0; gi--) {
            const g = gems[gi];
            if (Math.hypot(g.x - p.x, g.y - p.y) < 24) {
              if (g.kind === 'speed') {
                p.speedTimer = 240;
                vfx.popup(g.x, g.y - 12, 'TURBO!', '#2ee59d');
                sound.pickup(120);
              } else {
                p.shield = true;
                vfx.popup(g.x, g.y - 12, 'SHIELD!', '#38bdf8');
                sound.pickup(240);
              }
              vfx.ring(g.x, g.y, g.kind === 'speed' ? '#2ee59d' : '#38bdf8', 40, 2.5);
              gems.splice(gi, 1);
            }
          }

          // Safe pod protection check
          let inPod = false;
          for (const pd of pods) {
            if (Math.hypot(p.x - pd.x, p.y - pd.y) < pd.r - 4) {
              inPod = true;
              break;
            }
          }

          // Beam intersection check
          if (p.invuln === 0 && !inPod) {
            let hitBeam = false;
            if (beamClearance(p.x, p.y, 0, 0) < 13) hitBeam = true;

            if (hitBeam) {
              if (p.shield) {
                p.shield = false;
                p.invuln = 42;
                vfx.hitstop(2);
                vfx.burst(p.x, p.y, '#38bdf8', 18, 6);
                vfx.ring(p.x, p.y, '#38bdf8', 64, 3);
                vfx.popup(p.x, p.y - 18, 'SHIELD SAVED!', '#38bdf8');
                sound.noiseBurst(0.16, 1800, 0.14);
                buzz(i, 90, 0.6);
              } else {
                p.alive = false;
                vfx.hitstop(4);
                vfx.burst(p.x, p.y, active[i].color, 28, 7.5);
                vfx.burst(p.x, p.y, '#ffffff', 10, 4);
                vfx.ring(p.x, p.y, '#ef4444', 82, 4);
                vfx.popup(p.x, p.y - 20, 'LASERED!', '#fb7185', 16);
                vfx.flash('#ef4444', 0.18);
                vfx.shake(10);
                sound.explosion();
                buzz(i, 190, 0.95);
              }
            }
          }
        }

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && playersPos[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          const secs = roundTime / 60;
          if (alive.length === 1) {
            const w = alive[0];
            wins[w]++;
            banner = `${active[w].name} DODGED ALL!`;
            bannerSub = `LAST ORB STANDING · ${secs.toFixed(1)}s · SPINNING UP NEXT ROULETTE...`;
            vfx.confetti(playersPos[w].x, playersPos[w].y, 38);
            vfx.confetti(CX, CY - 60, 30);
            vfx.flash('#facc15', 0.2);
            sound.win();
            buzz(w, 220, 0.8);
          } else if (total === 1) {
            // Solo survival run: report time and personal best
            const isBest = secs > bestSoloTime;
            if (isBest) bestSoloTime = secs;
            banner = isBest ? `NEW BEST · ${secs.toFixed(1)}s!` : `SURVIVED ${secs.toFixed(1)}s`;
            bannerSub = `BEST ${bestSoloTime.toFixed(1)}s · SPINNING UP NEXT ROULETTE...`;
            if (isBest) {
              vfx.confetti(CX, CY - 60, 36);
              sound.win();
            }
          } else {
            banner = 'LASER SWEEP!';
            bannerSub = 'NOBODY SURVIVED · SPINNING UP NEXT ROULETTE...';
          }
          freeze = 95;
        }
      }

      let enabledCount = 0;
      for (const a of active) if (a.enabled) enabledCount++;
      const soloRun = enabledCount === 1;

      drawArcadeBackdrop(ctx, '#ef4444');

      // Arena ring & hazard ticks
      ctx.save();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CX, CY, RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(CX, CY, 112, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Safe-Zone Pods
      for (const pd of pods) {
        ctx.save();
        const pct = pd.life / pd.maxLife;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
        ctx.strokeStyle = pd.life < 60 && frame % 8 < 4 ? '#facc15' : '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pd.x, pd.y, pd.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pd.x, pd.y, pd.r - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
        ctx.stroke();
        ctx.fillStyle = '#bae6fd';
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SAFE', pd.x, pd.y + 3);
        ctx.restore();
      }

      // Gems
      for (const g of gems) {
        ctx.save();
        const col = g.kind === 'speed' ? '#2ee59d' : '#38bdf8';
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.fillStyle = col;
        ctx.translate(g.x, g.y + Math.sin(frame * 0.12) * 3);
        ctx.rotate(frame * 0.05);
        ctx.fillRect(-7, -7, 14, 14);
        ctx.restore();
      }

      // Sweeper Beams (Telegraph vs Active)
      const drawBeam = (ang: number, charging: boolean, chargeVal: number) => {
        ctx.save();
        const x1 = CX - Math.cos(ang) * RADIUS;
        const y1 = CY - Math.sin(ang) * RADIUS;
        const x2 = CX + Math.cos(ang) * RADIUS;
        const y2 = CY + Math.sin(ang) * RADIUS;
        if (charging) {
          ctx.setLineDash([8, 8]);
          ctx.strokeStyle = chargeVal % 8 < 4 ? '#facc15' : '#ef4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        } else {
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 20;
          ctx.strokeStyle = frame % 4 < 2 ? '#ef4444' : '#fda4af';
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
      };

      for (const b of beams) {
        drawBeam(b.angle, b.charge > 0, b.charge);
        if (b.double) drawBeam(b.angle + Math.PI / 2, b.charge > 0, b.charge);
      }

      // Center Emitter Core
      ctx.save();
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#7f1d1d';
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CX, CY, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`W${escalateTier}`, CX, CY + 4);
      ctx.restore();

      // Players
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !playersPos[i].alive) continue;
        const p = playersPos[i];
        if (p.jumpZ > 1) {
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + 8, 12, 6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        drawPlayerOrb(ctx, p.x, p.y - p.jumpZ, 15 + p.jumpZ * 0.15, active[i].color, i, {
          angle: p.angle,
          leader: maxWins > 0 && wins[i] === maxWins,
          shield: p.shield,
          flash: p.invuln > 0 && frame % 4 < 2,
          cooldownPct: p.dashCd / 46,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#ef4444');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: maxWins > 0 && wins[i] === maxWins,
          valueText:
            soloRun && playersPos[i].alive
              ? `${(roundTime / 60).toFixed(1)}s`
              : `${playersPos[i].alive ? 'ON' : 'KO'} · W${wins[i]}`,
        })),
        'ORBIT: STICK / WASD · PHASE DODGE: A / SPACE · GRAB PODS & GEMS',
      );
    },
  };
}

// 32. PINBALL WIZARD 4P (Animated Dual Flippers, Slingshots, Bolts & Multi-Ball Fever)
export function createPinballWizardEngine(): MiniGameEngine {
  const LEFT_WALL = 152;
  const RIGHT_WALL = GAME_WIDTH - 152;
  const TOP_WALL = 72;
  const BOT_WALL = GAME_HEIGHT - 36;
  const CX = GAME_WIDTH / 2;
  const CY = (TOP_WALL + BOT_WALL) / 2;
  const TARGET_SCORE = 650;

  let scores = [0, 0, 0, 0];
  let combo = 0;
  let comboTimer = 0;
  let feverTimer = 0;
  let banner = '';
  let freeze = 20;
  const COMBO_WINDOW = 150;
  const FEVER_FRAMES = 420;

  const bumpers = [
    { x: CX, y: CY, r: 28, pts: 35, pulse: 0 },
    { x: CX - 78, y: CY - 56, r: 21, pts: 20, pulse: 0 },
    { x: CX + 78, y: CY - 56, r: 21, pts: 20, pulse: 0 },
    { x: CX - 78, y: CY + 56, r: 21, pts: 20, pulse: 0 },
    { x: CX + 78, y: CY + 56, r: 21, pts: 20, pulse: 0 },
  ];

  // Drop targets along inner perimeter corners
  const dropTargets = [
    { x: LEFT_WALL + 46, y: TOP_WALL + 32, lit: true, pulse: 0 },
    { x: RIGHT_WALL - 46, y: TOP_WALL + 32, lit: true, pulse: 0 },
    { x: LEFT_WALL + 46, y: BOT_WALL - 32, lit: true, pulse: 0 },
    { x: RIGHT_WALL - 46, y: BOT_WALL - 32, lit: true, pulse: 0 },
    { x: CX - 135, y: CY, lit: true, pulse: 0 },
    { x: CX + 135, y: CY, lit: true, pulse: 0 },
  ];

  // Corner slingshots
  const slingshots = [
    { x: LEFT_WALL + 22, y: TOP_WALL + 22, nx: 0.707, ny: 0.707, pulse: 0 },
    { x: RIGHT_WALL - 22, y: TOP_WALL + 22, nx: -0.707, ny: 0.707, pulse: 0 },
    { x: LEFT_WALL + 22, y: BOT_WALL - 22, nx: 0.707, ny: -0.707, pulse: 0 },
    { x: RIGHT_WALL - 22, y: BOT_WALL - 22, nx: -0.707, ny: -0.707, pulse: 0 },
  ];

  const paddles = [
    { x: CX, y: BOT_WALL - 14, horizontal: true, flip: 0, prevA: false },
    { x: CX, y: TOP_WALL + 14, horizontal: true, flip: 0, prevA: false },
    { x: LEFT_WALL + 14, y: CY, horizontal: false, flip: 0, prevA: false },
    { x: RIGHT_WALL - 14, y: CY, horizontal: false, flip: 0, prevA: false },
  ];

  interface PinBall {
    x: number;
    y: number;
    vx: number;
    vy: number;
    owner: number; // -1 = neutral (nobody has touched it yet)
    gold: boolean;
  }

  // Fresh balls start neutral so points never leak to empty/disabled slots.
  const freshBalls = (): PinBall[] => [
    { x: CX - 90, y: CY - 30, vx: 4.5, vy: 3.6, owner: -1, gold: false },
    { x: CX + 90, y: CY + 30, vx: -4.2, vy: -3.5, owner: -1, gold: false },
  ];
  let balls: PinBall[] = freshBalls();

  const resetMatch = () => {
    scores = [0, 0, 0, 0];
    combo = 0;
    comboTimer = 0;
    feverTimer = 0;
    banner = '';
    freeze = 20;
    dropTargets.forEach((d) => {
      d.lit = true;
      d.pulse = 0;
    });
    paddles[0].x = CX;
    paddles[1].x = CX;
    paddles[2].y = CY;
    paddles[3].y = CY;
    for (const p of paddles) p.flip = 0;
    balls = freshBalls();
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });
      const maxScore = Math.max(...scores);
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (slot >= 0 && active[slot].isHuman) rumble(slot, ms, intensity);
      };
      const ballColor = (b: PinBall) => (b.gold ? '#facc15' : b.owner >= 0 ? active[b.owner].color : '#e2e8f0');

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetMatch();
      } else {
        if (comboTimer > 0) {
          comboTimer--;
          if (comboTimer === 0) combo = 0;
        }
        if (feverTimer > 0) {
          feverTimer--;
          if (feverTimer === 0) {
            // Fever over: bonus gold balls fizzle out, the base pair keeps playing
            for (let bi = balls.length - 1; bi >= 0 && balls.length > 2; bi--) {
              const gb = balls[bi];
              if (!gb.gold) continue;
              vfx.burst(gb.x, gb.y, '#facc15', 12, 4);
              vfx.ring(gb.x, gb.y, '#facc15', 36, 2);
              balls.splice(bi, 1);
            }
            sound.sweep(880, 220, 0.25, 'triangle', 0.08);
          }
        }

        // Paddle control & dual flipper actuation
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const p = paddles[i];
          let mv = 0;
          let flipBtn = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            mv = p.horizontal ? inp.x : inp.y;
            flipBtn = inp.actionA;
          } else {
            // Track the nearest ball heading toward this paddle's wall (fallback: nearest)
            let targetBall = balls[0];
            let bestDist = Infinity;
            for (const b of balls) {
              const approaching = i === 0 ? b.vy > 0 : i === 1 ? b.vy < 0 : i === 2 ? b.vx < 0 : b.vx > 0;
              const d = Math.hypot(b.x - p.x, b.y - p.y) + (approaching ? 0 : 400);
              if (d < bestDist) {
                bestDist = d;
                targetBall = b;
              }
            }
            const coord = p.horizontal ? targetBall.x - p.x : targetBall.y - p.y;
            mv = Math.max(-1, Math.min(1, coord / 26)) * 0.82;
            if (bestDist < 64 && p.flip === 0 && Math.random() < 0.6) flipBtn = true;
          }

          if (flipBtn && !p.prevA && p.flip === 0) {
            p.flip = 14;
            sound.beep(390 + i * 35, 0.04, 'triangle', 0.08);
            buzz(i, 25, 0.25);
          }
          p.prevA = flipBtn;
          if (p.flip > 0) p.flip--;

          if (p.horizontal) {
            p.x = Math.max(LEFT_WALL + 72, Math.min(RIGHT_WALL - 72, p.x + mv * 8.4));
          } else {
            p.y = Math.max(TOP_WALL + 64, Math.min(BOT_WALL - 64, p.y + mv * 8.4));
          }
        }

        for (const bmp of bumpers) if (bmp.pulse > 0) bmp.pulse--;
        for (const sl of slingshots) if (sl.pulse > 0) sl.pulse--;
        for (const dt of dropTargets) if (dt.pulse > 0) dt.pulse--;

        for (const b of balls) {
          b.x += b.vx;
          b.y += b.vy;
          // Speed cap
          const spd = Math.hypot(b.vx, b.vy);
          if (spd > 10.5) {
            b.vx = (b.vx / spd) * 10.5;
            b.vy = (b.vy / spd) * 10.5;
          } else if (spd < 0.5) {
            b.vx = 3;
            b.vy = 3;
          } else if (spd < 4.2) {
            b.vx *= 1.03;
            b.vy *= 1.03;
          }
          // Prevent endless pure-horizontal / pure-vertical wall ping-pong loops
          if (Math.abs(b.vx) < 1.1) b.vx = b.vx < 0 ? -1.1 : 1.1;
          if (Math.abs(b.vy) < 1.1) b.vy = b.vy < 0 ? -1.1 : 1.1;

          if (frame % 2 === 0) {
            vfx.afterimage(b.x, b.y, b.gold ? 10 : 8, ballColor(b), 7);
          }

          if (b.x < LEFT_WALL + 10 || b.x > RIGHT_WALL - 10) {
            b.vx *= -1;
            b.x = Math.max(LEFT_WALL + 10, Math.min(RIGHT_WALL - 10, b.x));
          }
          if (b.y < TOP_WALL + 10 || b.y > BOT_WALL - 10) {
            b.vy *= -1;
            b.y = Math.max(TOP_WALL + 10, Math.min(BOT_WALL - 10, b.y));
          }

          // Paddle + Dual Flipper hit
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            const p = paddles[i];
            // Only collide while the ball is travelling INTO this paddle (no multi-frame re-hits)
            const incoming = i === 0 ? b.vy > 0 : i === 1 ? b.vy < 0 : i === 2 ? b.vx < 0 : b.vx > 0;
            const hit =
              incoming &&
              (p.horizontal
                ? Math.abs(b.x - p.x) < 62 && Math.abs(b.y - p.y) < 16
                : Math.abs(b.y - p.y) < 56 && Math.abs(b.x - p.x) < 16);
            if (hit) {
              const boost = p.flip > 6 ? 1.28 : 1.04;
              if (p.horizontal) {
                const offset = (b.x - p.x) / 52;
                b.vy = (i === 0 ? -1 : 1) * Math.max(5.5, Math.abs(b.vy) * boost);
                b.vx += offset * 3.6;
              } else {
                const offset = (b.y - p.y) / 48;
                b.vx = (i === 2 ? 1 : -1) * Math.max(5.5, Math.abs(b.vx) * boost);
                b.vy += offset * 3.6;
              }
              b.owner = i;
              vfx.burst(b.x, b.y, active[i].color, p.flip > 6 ? 14 : 7, 5);
              if (p.flip > 6) {
                vfx.ring(b.x, b.y, '#facc15', 44, 2.5);
                vfx.popup(b.x, b.y - 14, 'SNAP!', '#facc15', 12);
                vfx.shake(3);
                sound.hit();
              } else {
                sound.beep(540 + i * 40, 0.05);
              }
              buzz(i, 55, p.flip > 6 ? 0.75 : 0.4);
            }
          }

          // Corner Slingshots
          for (const sl of slingshots) {
            if (Math.hypot(b.x - sl.x, b.y - sl.y) < 28 && b.vx * sl.nx + b.vy * sl.ny < 0) {
              b.vx = sl.nx * 8.4;
              b.vy = sl.ny * 8.4;
              sl.pulse = 10;
              if (b.owner >= 0) scores[b.owner] += 10;
              vfx.spark(sl.x, sl.y, sl.nx * 4, sl.ny * 4, '#38bdf8', 3.5);
              sound.beep(780, 0.05, 'square', 0.07);
            }
          }

          // Drop Targets
          for (const dt of dropTargets) {
            if (dt.lit && Math.hypot(b.x - dt.x, b.y - dt.y) < 18) {
              dt.lit = false;
              dt.pulse = 14;
              const pts = b.gold ? 40 : 25;
              if (b.owner >= 0) scores[b.owner] += pts;
              vfx.burst(dt.x, dt.y, '#2ee59d', 12, 4.5);
              vfx.popup(dt.x, dt.y - 10, `DROP +${pts}`, '#2ee59d');
              sound.pickup(140);
              if (dropTargets.every((t) => !t.lit)) {
                if (b.owner >= 0) scores[b.owner] += 60;
                vfx.flash('#2ee59d', 0.14);
                buzz(b.owner, 120, 0.6);
                dropTargets.forEach((t) => (t.lit = true));
                vfx.popup(CX, CY - 90, 'ALL DROPS BANKED +60!', '#facc15', 16);
                sound.combo(6);
              }
            }
          }

          // Center Spin-Bumper Cluster with lightning bolts + Multi-Ball Fever!
          for (let bi = 0; bi < bumpers.length; bi++) {
            const bmp = bumpers[bi];
            const dx = b.x - bmp.x;
            const dy = b.y - bmp.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < bmp.r + 10) {
              const nx = dx / d;
              const ny = dy / d;
              b.x = bmp.x + nx * (bmp.r + 12);
              b.y = bmp.y + ny * (bmp.r + 12);
              b.vx = nx * 7.8;
              b.vy = ny * 7.8;
              bmp.pulse = 12;

              combo++;
              comboTimer = COMBO_WINDOW;
              const pts = bmp.pts * (b.gold ? 2 : 1);
              if (b.owner >= 0) scores[b.owner] += pts;
              const col = ballColor(b);
              const nextBmp = bumpers[(bi + 1) % bumpers.length];
              vfx.bolt(bmp.x, bmp.y, nextBmp.x, nextBmp.y, col);
              vfx.ring(bmp.x, bmp.y, col, 65, 3);
              vfx.popup(bmp.x, bmp.y - 16, `+${pts}${combo >= 3 ? ` x${combo}` : ''}`, col);
              vfx.shake(bi === 0 ? 4 : 2.5);
              sound.combo(combo);
              buzz(b.owner, 40, 0.4);

              if (combo % 5 === 0 && balls.length < 5) {
                feverTimer = FEVER_FRAMES;
                vfx.hitstop(2);
                vfx.flash('#facc15', 0.2);
                vfx.confetti(CX, CY, 22);
                vfx.popup(CX, CY - 70, 'MULTI-BALL FEVER!', '#facc15', 20);
                balls.push({
                  x: CX,
                  y: CY + (Math.random() < 0.5 ? -44 : 44),
                  vx: (Math.random() < 0.5 ? -1 : 1) * 5.6,
                  vy: (Math.random() - 0.5) * 6,
                  owner: b.owner,
                  gold: true,
                });
                sound.sweep(330, 1320, 0.3, 'square', 0.08);
                sound.combo(12);
              } else if (combo % 5 === 0) {
                feverTimer = FEVER_FRAMES;
                vfx.popup(CX, CY - 70, 'FEVER EXTENDED!', '#facc15', 16);
              }
            }
          }
        }

        // Check match winner
        const winner = [0, 1, 2, 3].find((i) => active[i].enabled && scores[i] >= TARGET_SCORE);
        if (winner !== undefined) {
          banner = `${active[winner].name} PINBALL WIZARD!`;
          vfx.confetti(CX, CY, 44);
          vfx.confetti(CX - 160, CY + 40, 24);
          vfx.confetti(CX + 160, CY + 40, 24);
          vfx.flash('#facc15', 0.25);
          vfx.shake(6);
          sound.win();
          buzz(winner, 260, 0.9);
          freeze = 110;
        }
      }

      drawArcadeBackdrop(ctx, '#facc15');

      // Table frame
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.strokeStyle = feverTimer > 0 && frame % 6 < 3 ? '#facc15' : 'rgba(250, 204, 21, 0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(LEFT_WALL, TOP_WALL, RIGHT_WALL - LEFT_WALL, BOT_WALL - TOP_WALL, 22);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Slingshot bumpers
      for (const sl of slingshots) {
        ctx.save();
        ctx.fillStyle = sl.pulse > 0 ? '#7dd3fc' : '#1e293b';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sl.x, sl.y, 16 + (sl.pulse > 0 ? 4 : 0), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Drop targets
      for (const dt of dropTargets) {
        ctx.save();
        ctx.fillStyle = dt.lit ? '#2ee59d' : '#1e293b';
        ctx.strokeStyle = dt.lit ? '#a7f3d0' : '#475569';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(dt.x - 10, dt.y - 6, 20, 12, 4);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Spin-bumper cluster
      for (let bi = 0; bi < bumpers.length; bi++) {
        const bmp = bumpers[bi];
        ctx.save();
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = bmp.pulse > 0 ? 28 : 12;
        ctx.fillStyle = bmp.pulse > 0 ? '#fde047' : '#1b2232';
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(bmp.x, bmp.y, bmp.r + (bmp.pulse > 0 ? 5 : 0), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Spinning core lines
        ctx.translate(bmp.x, bmp.y);
        ctx.rotate(frame * (bi === 0 ? 0.05 : -0.07));
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-bmp.r * 0.55, 0);
        ctx.lineTo(bmp.r * 0.55, 0);
        ctx.moveTo(0, -bmp.r * 0.55);
        ctx.lineTo(0, bmp.r * 0.55);
        ctx.stroke();
        ctx.restore();
      }

      // Dual Animated Flippers per Player Zone
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const p = paddles[i];
        const snap = p.flip > 0 ? Math.sin((p.flip / 14) * Math.PI) * 0.42 : 0;
        ctx.save();
        ctx.fillStyle = active[i].color;
        ctx.shadowColor = active[i].color;
        ctx.shadowBlur = p.flip > 0 ? 18 : 8;
        ctx.translate(p.x, p.y);
        if (!p.horizontal) ctx.rotate(Math.PI / 2);
        const dirSign = i === 0 || i === 3 ? -1 : 1;

        // Carriage core
        ctx.fillRect(-16, -5, 32, 10);

        // Left flipper wing
        ctx.save();
        ctx.translate(-52, 0);
        ctx.rotate(dirSign * (-0.18 + snap));
        ctx.beginPath();
        ctx.roundRect(0, -6, 38, 12, 6);
        ctx.fill();
        ctx.restore();

        // Right flipper wing
        ctx.save();
        ctx.translate(52, 0);
        ctx.rotate(-dirSign * (-0.18 + snap));
        ctx.beginPath();
        ctx.roundRect(-38, -6, 38, 12, 6);
        ctx.fill();
        ctx.restore();
        ctx.restore();
      }

      // Balls
      for (const b of balls) {
        const col = ballColor(b);
        ctx.save();
        // Cheap additive halo instead of shadowBlur
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(b.x, b.y, (b.gold ? 11 : 10) + 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = b.gold ? '#fde047' : '#ffffff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.gold ? 11 : 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }

      // Combo meter (decays if the bumper chain goes cold)
      if (combo >= 2 && comboTimer > 0) {
        const mx = LEFT_WALL / 2;
        const w = 100 * (comboTimer / COMBO_WINDOW);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        ctx.fillRect(mx - 50, CY + 14, 100, 6);
        ctx.fillStyle = combo % 5 >= 3 ? '#facc15' : '#fb923c';
        ctx.fillRect(mx - 50, CY + 14, w, 6);
        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 16px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`COMBO x${combo}`, mx, CY + 4);
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillText(`${5 - (combo % 5)} TO MULTI-BALL`, mx, CY + 34);
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, `FIRST TO ${TARGET_SCORE}PT · RESETTING TABLE...`, '#facc15');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: maxScore > 0 && scores[i] === maxScore,
          valueText: `${scores[i]}/${TARGET_SCORE}`,
        })),
        'SLIDE ZONE: STICK / WASD · SNAP DUAL FLIPPERS: A / SPACE · COMBO 5 = MULTI-BALL!',
      );
    },
  };
}

// 33. CANNON BARRAGE (Airship Mortar Duel, Wind Vane, Barricades & Parabolic ETA Shadows)
export function createCannonBarrageEngine(): MiniGameEngine {
  const wins = [0, 0, 0, 0];
  const DUMMY_COLOR = '#64748b';

  interface Airship {
    x: number;
    y: number;
    angle: number;
    hp: number;
    cd: number;
    charge: number;
    holdingA: boolean;
    dashCd: number;
    prevB: boolean;
    vx: number;
    vy: number;
    hitFlash: number;
    botAim: number; // bot: target charge for the current shot (-1 = idle)
    botTarget: number;
  }

  interface Mortar {
    sx: number;
    sy: number;
    tx: number;
    ty: number;
    t: number;
    dur: number;
    owner: number;
  }

  interface Barricade {
    x: number;
    y: number;
    w: number;
    h: number;
    hp: number;
    maxHp: number;
  }

  const ship = (x: number, y: number, angle: number): Airship => ({
    x,
    y,
    angle,
    hp: 3,
    cd: 0,
    charge: 0,
    holdingA: false,
    dashCd: 0,
    prevB: false,
    vx: 0,
    vy: 0,
    hitFlash: 0,
    botAim: -1,
    botTarget: -1,
  });

  const spawnShips = (): Airship[] => [
    ship(135, 155, 0.35),
    ship(GAME_WIDTH - 135, 155, Math.PI - 0.35),
    ship(135, 420, -0.35),
    ship(GAME_WIDTH - 135, 420, Math.PI + 0.35),
  ];

  const spawnBarricades = (): Barricade[] => [
    { x: GAME_WIDTH / 2 - 22, y: 185, w: 44, h: 44, hp: 3, maxHp: 3 },
    { x: GAME_WIDTH / 2 - 22, y: 345, w: 44, h: 44, hp: 3, maxHp: 3 },
    { x: 270, y: 266, w: 38, h: 48, hp: 3, maxHp: 3 },
    { x: GAME_WIDTH - 308, y: 266, w: 38, h: 48, hp: 3, maxHp: 3 },
  ];

  let ships = spawnShips();
  let barricades = spawnBarricades();
  let mortars: Mortar[] = [];
  let windAngle = Math.random() * Math.PI * 2;
  let windStrength = 0.9;
  let banner = '';
  let bannerSub = '';
  let freeze = 20;

  const reset = () => {
    ships = spawnShips();
    barricades = spawnBarricades();
    mortars = [];
    windAngle = Math.random() * Math.PI * 2;
    windStrength = 0.7 + Math.random() * 0.8;
    banner = '';
    bannerSub = '';
    freeze = 20;
  };

  // Push a circle (radius r) out of an axis-aligned box, including when its centre is inside.
  const pushOutOfBox = (s: { x: number; y: number }, bar: Barricade, r: number) => {
    const inside = s.x > bar.x && s.x < bar.x + bar.w && s.y > bar.y && s.y < bar.y + bar.h;
    if (inside) {
      const dl = s.x - bar.x;
      const dr = bar.x + bar.w - s.x;
      const dt = s.y - bar.y;
      const db = bar.y + bar.h - s.y;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) s.x = bar.x - r;
      else if (m === dr) s.x = bar.x + bar.w + r;
      else if (m === dt) s.y = bar.y - r;
      else s.y = bar.y + bar.h + r;
      return;
    }
    const cx = Math.max(bar.x, Math.min(bar.x + bar.w, s.x));
    const cy = Math.max(bar.y, Math.min(bar.y + bar.h, s.y));
    const dx = s.x - cx;
    const dy = s.y - cy;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < r) {
      s.x += (dx / d) * (r - d);
      s.y += (dy / d) * (r - d);
    }
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });
      let enabledCount = 0;
      for (const a of active) if (a.enabled) enabledCount++;
      // Solo with bots off: empty slots become drifting practice target airships
      const solo = enabledCount === 1;
      const live = [0, 1, 2, 3].map((i) => active[i].enabled || solo);
      const isDummy = (i: number) => solo && !active[i].enabled;
      const shipColor = (i: number) => (isDummy(i) ? DUMMY_COLOR : active[i].color);
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (active[slot].isHuman) rumble(slot, ms, intensity);
      };
      const maxWins = Math.max(...wins);

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        // Slowly shift wind vane
        windAngle += Math.sin(frame * 0.01) * 0.008;
        const windX = Math.cos(windAngle) * windStrength * 56;
        const windY = Math.sin(windAngle) * windStrength * 56;

        for (let i = 0; i < 4; i++) {
          if (!live[i] || ships[i].hp <= 0) continue;
          const s = ships[i];
          if (s.hitFlash > 0) s.hitFlash--;
          let ix = 0;
          let iy = 0;
          let fireHold = false;
          let dashBtn = false;
          let botAimAngle: number | null = null;

          if (isDummy(i)) {
            // Lazy drifting target drone
            ix = Math.cos(frame * 0.011 + i * 2.3) * 0.45;
            iy = Math.sin(frame * 0.017 + i * 1.7) * 0.45;
          } else if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            fireHold = inp.actionA;
            dashBtn = inp.actionB;
          } else {
            // Bot: pick the nearest live rival every so often, strafe, then plant
            // and lob a wind-compensated mortar with a little human-like error.
            const tgtValid = s.botTarget >= 0 && live[s.botTarget] && ships[s.botTarget].hp > 0;
            if (!tgtValid || frame % 90 === i * 20) {
              let best = -1;
              let bestD = Infinity;
              for (let j = 0; j < 4; j++) {
                if (j === i || !live[j] || ships[j].hp <= 0) continue;
                const d = Math.hypot(ships[j].x - s.x, ships[j].y - s.y) * (0.8 + Math.random() * 0.4);
                if (d < bestD) {
                  bestD = d;
                  best = j;
                }
              }
              s.botTarget = best;
            }
            const target = s.botTarget >= 0 ? ships[s.botTarget] : null;
            if (target) {
              // Partially lead the target by its drift over the shell's flight time
              const flight = 42 + Math.max(0, s.botAim) * 0.5;
              const aimTx = target.x + target.vx * flight * 0.45 - windX;
              const aimTy = target.y + target.vy * flight * 0.45 - windY;
              const dToTarget = Math.hypot(aimTx - s.x, aimTy - s.y);
              if (s.botAim < 0) {
                ix = Math.cos(frame * 0.03 + i * 1.7) * 0.75;
                iy = Math.sin(frame * 0.04 + i * 2.1) * 0.75;
                // Keep a comfortable firing distance
                if (dToTarget < 230) {
                  ix -= ((aimTx - s.x) / (dToTarget || 1)) * 0.5;
                  iy -= ((aimTy - s.y) / (dToTarget || 1)) * 0.5;
                }
                if (s.cd === 0 && Math.random() < 0.05) {
                  s.botAim = Math.min(40, Math.max(2, (dToTarget - 140) / 11 + (Math.random() - 0.5) * 5));
                }
              }
              if (s.botAim >= 0) {
                fireHold = s.charge < s.botAim;
                botAimAngle = Math.atan2(aimTy - s.y, aimTx - s.x) + (Math.random() - 0.5) * 0.12;
                if (!fireHold) s.botAim = -1;
              }
              // Boost away from incoming shells landing nearby
              if (s.dashCd === 0 && s.botAim < 0) {
                for (const m of mortars) {
                  if (m.owner !== i && m.dur - m.t < 22 && Math.hypot(m.tx - s.x, m.ty - s.y) < 50) {
                    dashBtn = Math.random() < 0.5;
                    const away = Math.atan2(s.y - m.ty, s.x - m.tx);
                    ix = Math.cos(away);
                    iy = Math.sin(away);
                    botAimAngle = away;
                    break;
                  }
                }
              }
            } else {
              s.botAim = -1;
            }
          }

          if (Math.hypot(ix, iy) > 0.15) {
            s.angle = Math.atan2(iy, ix);
          }
          if (botAimAngle !== null) s.angle = botAimAngle;

          const trigB = dashBtn && !s.prevB;
          s.prevB = dashBtn;
          if (s.dashCd > 0) s.dashCd--;
          if (s.cd > 0) s.cd--;

          if (trigB && s.dashCd === 0) {
            s.dashCd = 55;
            s.vx += Math.cos(s.angle) * 8.5;
            s.vy += Math.sin(s.angle) * 8.5;
            vfx.burst(s.x, s.y, active[i].color, 10, 4);
            vfx.afterimage(s.x, s.y, 20, active[i].color, 10);
            sound.dash();
            buzz(i, 40, 0.35);
          }

          // Move slower while charging mortar
          const spd = fireHold ? 1.8 : isDummy(i) ? 2.2 : 3.4;
          s.vx = s.vx * 0.82 + ix * spd * 0.4;
          s.vy = s.vy * 0.82 + iy * spd * 0.4;
          s.x = Math.max(58, Math.min(GAME_WIDTH - 58, s.x + s.vx));
          s.y = Math.max(94, Math.min(GAME_HEIGHT - 56, s.y + s.vy));

          // Collide with intact barricades (also ejects ships whose centre got inside)
          for (const bar of barricades) {
            if (bar.hp > 0) pushOutOfBox(s, bar, 22);
          }

          if (fireHold && s.cd === 0) {
            s.holdingA = true;
            s.charge = Math.min(42, s.charge + 1);
            if (active[i].isHuman && s.charge % 7 === 0 && s.charge < 42) {
              sound.beep(300 + s.charge * 14, 0.03, 'triangle', 0.04);
            }
          } else if (s.holdingA) {
            s.holdingA = false;
            const dist = 140 + s.charge * 11;
            const tx = Math.max(52, Math.min(GAME_WIDTH - 52, s.x + Math.cos(s.angle) * dist + windX));
            const ty = Math.max(88, Math.min(GAME_HEIGHT - 48, s.y + Math.sin(s.angle) * dist + windY));
            mortars.push({
              sx: s.x + Math.cos(s.angle) * 20,
              sy: s.y + Math.sin(s.angle) * 20,
              tx,
              ty,
              t: 0,
              dur: 42 + Math.floor(s.charge * 0.5),
              owner: i,
            });
            s.vx -= Math.cos(s.angle) * 2.2; // recoil
            s.vy -= Math.sin(s.angle) * 2.2;
            s.charge = 0;
            s.cd = 34;
            vfx.burst(s.x + Math.cos(s.angle) * 24, s.y + Math.sin(s.angle) * 24, '#ff6b2b', 9, 4);
            vfx.ring(s.x + Math.cos(s.angle) * 24, s.y + Math.sin(s.angle) * 24, '#fde047', 26, 2);
            sound.noiseBurst(0.12, 480, 0.14);
            sound.sweep(220, 90, 0.12, 'square', 0.06);
            buzz(i, 50, 0.45);
          }
        }

        for (let mi = mortars.length - 1; mi >= 0; mi--) {
          const m = mortars[mi];
          m.t++;
          const u = m.t / m.dur;
          const mx = m.sx + (m.tx - m.sx) * u;
          const my = m.sy + (m.ty - m.sy) * u;
          const z = Math.sin(u * Math.PI) * 95;
          let remove = false;

          // Check mid-air barricade block on low arc
          if (z < 26) {
            for (const bar of barricades) {
              if (bar.hp > 0 && mx >= bar.x && mx <= bar.x + bar.w && my >= bar.y && my <= bar.y + bar.h) {
                bar.hp--;
                vfx.burst(mx, my, '#94a3b8', 16, 5.5);
                vfx.ring(mx, my, '#ff6b2b', 50, 3);
                vfx.shake(3);
                if (bar.hp <= 0) vfx.popup(bar.x + bar.w / 2, bar.y - 8, 'COVER DOWN!', '#cbd5e1', 13);
                sound.noiseBurst(0.18, 600, 0.16);
                remove = true;
                break;
              }
            }
          }

          if (!remove && m.t >= m.dur) {
            remove = true;
            vfx.burst(m.tx, m.ty, '#ff6b2b', 26, 7);
            vfx.ring(m.tx, m.ty, '#fde047', 74, 4);
            sound.explosion();

            // Damage barricades in blast
            for (const bar of barricades) {
              if (bar.hp <= 0) continue;
              const bcx = bar.x + bar.w / 2;
              const bcy = bar.y + bar.h / 2;
              if (Math.hypot(m.tx - bcx, m.ty - bcy) < 62) {
                bar.hp = Math.max(0, bar.hp - 2);
                vfx.burst(bcx, bcy, '#cbd5e1', 14, 5);
              }
            }

            // Damage airships in blast
            let anyHit = false;
            let direct = false;
            for (let i = 0; i < 4; i++) {
              if (!live[i] || ships[i].hp <= 0) continue;
              const sh = ships[i];
              const dist = Math.hypot(m.tx - sh.x, m.ty - sh.y);
              if (dist < 56) {
                const dmg = dist < 28 ? 2 : 1;
                sh.hp = Math.max(0, sh.hp - dmg);
                sh.hitFlash = 14;
                anyHit = true;
                if (dmg === 2) direct = true;
                // Knock the ship away from the blast
                const kd = dist || 1;
                sh.vx += ((sh.x - m.tx) / kd) * 6;
                sh.vy += ((sh.y - m.ty) / kd) * 6;
                buzz(i, 160, 0.9);
                if (m.owner !== i) buzz(m.owner, 70, 0.5);
                if (sh.hp <= 0) {
                  // Airship destroyed
                  vfx.burst(sh.x, sh.y, shipColor(i), 32, 8);
                  vfx.burst(sh.x, sh.y, '#ffffff', 12, 5);
                  vfx.ring(sh.x, sh.y, '#ef4444', 96, 5);
                  vfx.popup(sh.x, sh.y - 24, m.owner === i ? 'SELF-SINK!' : 'SHOT DOWN!', '#fb7185', 17);
                  vfx.flash('#ff6b2b', 0.2);
                } else {
                  vfx.popup(sh.x, sh.y - 18, dmg === 2 ? 'DIRECT HIT!' : 'SPLASH!', '#ff6b2b');
                }
              }
            }
            if (anyHit) {
              vfx.hitstop(direct ? 4 : 3);
              vfx.shake(direct ? 11 : 8);
            } else {
              vfx.shake(4.5);
            }
          }
          if (remove) mortars.splice(mi, 1);
        }

        const alive = [0, 1, 2, 3].filter((i) => live[i] && ships[i].hp > 0);
        const total = live.filter(Boolean).length;
        // Solo: the round also ends when the player's own ship goes down
        const soloDead = solo && alive.every((k) => isDummy(k));
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0) || soloDead) {
          if (alive.length === 1 && !isDummy(alive[0])) {
            const w = alive[0];
            wins[w]++;
            banner = solo ? 'TARGETS CLEARED!' : `${active[w].name} SKY ADMIRAL!`;
            vfx.confetti(ships[w].x, ships[w].y, 34);
            vfx.confetti(GAME_WIDTH / 2, 200, 30);
            vfx.flash('#facc15', 0.2);
            sound.win();
            buzz(w, 240, 0.85);
          } else if (soloDead && alive.length > 0) {
            banner = 'SHOT DOWN!';
          } else {
            banner = 'BARRAGE DRAW!';
          }
          bannerSub = solo ? 'PRACTICE RANGE · RELOADING TARGET DRONES...' : 'RELOADING AIRSHIP MORTARS...';
          freeze = 95;
        }
      }

      drawArcadeBackdrop(ctx, '#ff6b2b');

      // Wind Vane Indicator inside top-center safe zone
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = 'rgba(255, 107, 43, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(GAME_WIDTH / 2 - 74, 72, 148, 30, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fdba74';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('WIND', GAME_WIDTH / 2 - 62, 91);
      ctx.save();
      ctx.translate(GAME_WIDTH / 2 + 24, 87);
      ctx.rotate(windAngle);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(14, 0);
      ctx.lineTo(7, -5);
      ctx.moveTo(14, 0);
      ctx.lineTo(7, 5);
      ctx.stroke();
      ctx.restore();
      ctx.restore();

      // Destructible cover barricades
      for (const bar of barricades) {
        if (bar.hp <= 0) continue;
        ctx.save();
        ctx.fillStyle = bar.hp === 3 ? '#334155' : bar.hp === 2 ? '#475569' : '#7f1d1d';
        ctx.strokeStyle = bar.hp === 1 ? '#fb7185' : '#94a3b8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(bar.x, bar.y, bar.w, bar.h, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Live charge reticles
      const windX = Math.cos(windAngle) * windStrength * 56;
      const windY = Math.sin(windAngle) * windStrength * 56;
      for (let i = 0; i < 4; i++) {
        if (!live[i] || ships[i].hp <= 0 || !ships[i].holdingA) continue;
        const s = ships[i];
        const dist = 140 + s.charge * 11;
        const rx = Math.max(52, Math.min(GAME_WIDTH - 52, s.x + Math.cos(s.angle) * dist + windX));
        const ry = Math.max(88, Math.min(GAME_HEIGHT - 48, s.y + Math.sin(s.angle) * dist + windY));
        ctx.save();
        ctx.strokeStyle = active[i].color;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rx, ry, 24 - (s.charge / 42) * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Mortar shadows, ETA shrinking rings, and elevated shells
      for (const m of mortars) {
        const u = m.t / m.dur;
        const mx = m.sx + (m.tx - m.sx) * u;
        const my = m.sy + (m.ty - m.sy) * u;
        const z = Math.sin(u * Math.PI) * 95;

        // Landing ETA pulsing target ellipse
        ctx.save();
        ctx.strokeStyle = frame % 4 < 2 ? '#ef4444' : '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(m.tx, m.ty, Math.max(6, (1 - u) * 34), Math.max(4, (1 - u) * 18), 0, 0, Math.PI * 2);
        ctx.stroke();

        // Ground shadow under flying shell
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.ellipse(mx, my, 10 - z * 0.04, 6 - z * 0.02, 0, 0, Math.PI * 2);
        ctx.fill();

        // Elevated shell with a cheap additive halo (no shadowBlur)
        const shellR = 7 + z * 0.04;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = shipColor(m.owner);
        ctx.beginPath();
        ctx.arc(mx, my - z, shellR + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(mx, my - z, shellR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Airships
      for (let i = 0; i < 4; i++) {
        if (!live[i] || ships[i].hp <= 0) continue;
        const s = ships[i];
        const col = s.hitFlash > 0 && frame % 4 < 2 ? '#ffffff' : shipColor(i);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(0, 0, 24, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-10, -7, 16, 14);
        ctx.fillStyle = isDummy(i) ? '#94a3b8' : '#ffffff';
        ctx.fillRect(10, -4, 18 + (s.holdingA ? s.charge * 0.15 : 0), 8);
        ctx.restore();

        // HP pips
        for (let h = 0; h < 3; h++) {
          ctx.fillStyle = h < s.hp ? '#2ee59d' : '#334155';
          ctx.fillRect(s.x - 14 + h * 10, s.y + 22, 8, 4);
        }
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#ff6b2b');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: isDummy(i) ? 'TARGET' : a.name,
          color: shipColor(i),
          active: live[i],
          highlight: !isDummy(i) && maxWins > 0 && wins[i] === maxWins,
          valueText: isDummy(i)
            ? `${ships[i].hp > 0 ? `HP${ships[i].hp}` : 'DOWN'}`
            : `${ships[i].hp > 0 ? `HP${ships[i].hp}` : 'KO'} · W${wins[i]}`,
        })),
        'AIM: STICK / WASD · HOLD & RELEASE A / SPACE: MORTAR · B: BOOST',
      );
    },
  };
}

// 34. NEON VOLLEYS 2V2 (Jump-Spike Hitstop, Net Ripple, Dust & Rally Combos)
export function createNeonVolleysEngine(): MiniGameEngine {
  const FLOOR = GAME_HEIGHT - 44;
  const NET_X = GAME_WIDTH / 2;
  const NET_TOP = FLOOR - 118;
  const WIN_POINTS = 7;

  let teamScore = [0, 0];
  let rally = 0;
  let netRipple = 0;
  let netRippleY = NET_TOP + 40;
  let banner = '';
  let freeze = 20;
  let serveTimer = 40; // ball hovers at the serve spot before dropping

  const playersPos = [
    { x: 170, y: FLOOR - 18, vx: 0, vy: 0, onGround: true, prevA: false, dashCd: 0, prevB: false, spikeGlow: 0 },
    { x: GAME_WIDTH - 170, y: FLOOR - 18, vx: 0, vy: 0, onGround: true, prevA: false, dashCd: 0, prevB: false, spikeGlow: 0 },
    { x: 325, y: FLOOR - 18, vx: 0, vy: 0, onGround: true, prevA: false, dashCd: 0, prevB: false, spikeGlow: 0 },
    { x: GAME_WIDTH - 325, y: FLOOR - 18, vx: 0, vy: 0, onGround: true, prevA: false, dashCd: 0, prevB: false, spikeGlow: 0 },
  ];

  const ball = { x: 250, y: 165, vx: 1.4, vy: 0, spiked: false };

  const serve = (toLeft: boolean) => {
    ball.x = toLeft ? 250 : GAME_WIDTH - 250;
    ball.y = 160;
    ball.vx = 0;
    ball.vy = 0;
    ball.spiked = false;
    rally = 0;
    serveTimer = 40;
  };

  const resetSet = () => {
    teamScore = [0, 0];
    banner = '';
    freeze = 20;
    serve(true);
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (active[slot].isHuman) rumble(slot, ms, intensity);
      };

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetSet();
      } else {
        if (netRipple > 0) netRipple *= 0.9;
        if (serveTimer > 0) {
          serveTimer--;
          if (serveTimer === 0) sound.beep(660, 0.06, 'sine', 0.07);
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const p = playersPos[i];
          const isLeft = i === 0 || i === 2;
          const minX = isLeft ? 48 : NET_X + 26;
          const maxX = isLeft ? NET_X - 26 : GAME_WIDTH - 48;

          let mx = 0;
          let jumpBtn = false;
          let diveBtn = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            mx = inp.x;
            jumpBtn = inp.actionA || inp.y < -0.45;
            diveBtn = inp.actionB;
          } else {
            const partnerIdx = i === 0 ? 2 : i === 2 ? 0 : i === 1 ? 3 : 1;
            const frontRole = i >= 2;
            const homeX = isLeft ? (frontRole ? 340 : 165) : frontRole ? GAME_WIDTH - 340 : GAME_WIDTH - 165;
            const ballOnSide = isLeft ? ball.x < NET_X + 20 : ball.x > NET_X - 20;
            const closer =
              Math.abs(ball.x - p.x) <= Math.abs(ball.x - playersPos[partnerIdx].x) + 15;
            const targetX = ballOnSide && closer ? ball.x : homeX;
            mx = Math.max(-1, Math.min(1, (targetX - p.x) / 22)) * 0.9;
            if (ballOnSide && ball.y < p.y - 20 && Math.abs(ball.x - p.x) < 55 && (p.onGround || Math.hypot(ball.x - p.x, ball.y - p.y) < 52)) {
              jumpBtn = true;
            }
          }

          const trigA = jumpBtn && !p.prevA;
          p.prevA = jumpBtn;
          const trigB = diveBtn && !p.prevB;
          p.prevB = diveBtn;

          if (p.dashCd > 0) p.dashCd--;
          if (p.spikeGlow > 0) p.spikeGlow--;

          p.vx = (p.vx + mx * 0.98) * 0.84;
          p.vy += 0.56;

          // Ground jump OR mid-air Spike Charge!
          if (trigA) {
            if (p.onGround) {
              p.vy = -12.8;
              p.onGround = false;
              for (let k = 0; k < 5; k++) {
                vfx.spark(p.x + (Math.random() - 0.5) * 16, FLOOR - 2, (Math.random() - 0.5) * 3, -Math.random() * 2, '#94a3b8', 2.5);
              }
              sound.beep(460, 0.05);
            } else {
              // Mid-air spike timing boost
              p.spikeGlow = 14;
              vfx.ring(p.x, p.y, '#facc15', 36, 2);
              sound.dash();
            }
          }

          // Quick Dive-Save Dash
          if (trigB && p.dashCd === 0 && Math.abs(mx) > 0.15) {
            p.dashCd = 42;
            p.vx += Math.sign(mx) * 10;
            vfx.afterimage(p.x, p.y, 18, active[i].color, 10);
            sound.dash();
          }

          p.x = Math.max(minX, Math.min(maxX, p.x + p.vx));
          p.y += p.vy;
          if (p.y >= FLOOR - 18) {
            if (!p.onGround) {
              for (let k = 0; k < 4; k++) {
                vfx.spark(p.x + (Math.random() - 0.5) * 14, FLOOR - 2, (Math.random() - 0.5) * 2.5, -Math.random() * 1.5, '#cbd5e1', 2);
              }
            }
            p.y = FLOOR - 18;
            p.vy = 0;
            p.onGround = true;
          }

          // Hit ball
          const d = Math.hypot(ball.x - p.x, ball.y - p.y);
          if (d > 0 && d < 36) {
            const nx = (ball.x - p.x) / d;
            const ny = (ball.y - p.y) / d;
            ball.x = p.x + nx * 38;
            ball.y = p.y + ny * 38;

            const isSpike = !p.onGround && (p.spikeGlow > 0 || jumpBtn) && p.y < FLOOR - 65;
            rally++;
            if (isSpike) {
              const dir = isLeft ? 1 : -1;
              ball.vx = dir * 11.4;
              ball.vy = 2.6;
              ball.spiked = true;
              vfx.hitstop(2);
              vfx.burst(ball.x, ball.y, '#ff6b2b', 18, 6);
              vfx.ring(ball.x, ball.y, '#facc15', 58, 3);
              vfx.popup(ball.x, ball.y - 18, 'SPIKE!', '#ff6b2b', 16);
              vfx.shake(6);
              sound.noiseBurst(0.1, 1600, 0.14);
              sound.hit();
              buzz(i, 100, 0.8);
            } else {
              ball.vx = nx * 7.6 + p.vx * 0.55;
              ball.vy = Math.min(-7.2, ny * 9.2);
              ball.spiked = false;
              vfx.burst(ball.x, ball.y, active[i].color, 10, 4.5);
              sound.combo(rally);
              buzz(i, 55, 0.45);
            }
            serveTimer = 0;

            if (rally >= 3) {
              vfx.popup(NET_X, 118, `${rally}x RALLY!`, '#2ee59d', 15);
            }
          }
        }

        if (serveTimer > 0) {
          // Hovering serve: gentle bob, no gravity yet
          ball.vx = 0;
          ball.vy = 0;
          ball.y = 160 + Math.sin(serveTimer * 0.25) * 4;
        } else {
          ball.vy += 0.29;
          ball.x += ball.vx;
          ball.y += ball.vy;
        }

        if (ball.spiked || Math.hypot(ball.vx, ball.vy) > 9) {
          if (frame % 2 === 0) {
            vfx.afterimage(ball.x, ball.y, 13, ball.spiked ? '#ff6b2b' : '#fde047', 8);
          }
        }

        if (ball.x < 42 || ball.x > GAME_WIDTH - 42) {
          ball.vx *= -0.85;
          ball.x = Math.max(42, Math.min(GAME_WIDTH - 42, ball.x));
        }
        if (ball.y < 74) {
          ball.y = 74;
          ball.vy = Math.abs(ball.vy);
        }

        // Net force-field collision + near-miss ripple
        if (Math.abs(ball.x - NET_X) < 30 && ball.y > NET_TOP - 22) {
          netRipple = Math.max(netRipple, 10);
          netRippleY = Math.max(NET_TOP, Math.min(FLOOR, ball.y));
        }
        if (Math.abs(ball.x - NET_X) < 16 && ball.y > NET_TOP - 12) {
          if (ball.y < NET_TOP + 12) {
            if (ball.vy > 0) {
              // Net-cord bounce: capped rebound + sideways kick so the ball can't
              // balance on the tape forever (previously it gained 2.2 speed every hop)
              ball.vy = -Math.min(8, Math.abs(ball.vy) * 0.75 + 1.5);
              const side = ball.x === NET_X ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(ball.x - NET_X);
              ball.vx = side * Math.max(1.6, Math.abs(ball.vx));
              netRipple = 16;
              sound.beep(320, 0.05, 'square', 0.07);
            }
          } else {
            ball.vx *= -0.9;
            ball.x = ball.x < NET_X ? NET_X - 17 : NET_X + 17;
            netRipple = 16;
            sound.beep(320, 0.05, 'square', 0.07);
          }
        }

        // Floor point scored
        if (ball.y >= FLOOR - 14) {
          const leftFault = ball.x < NET_X;
          if (leftFault) {
            teamScore[1]++;
            vfx.popup(GAME_WIDTH / 2, 220, 'RIGHT POINT!', '#fb7185', 22);
          } else {
            teamScore[0]++;
            vfx.popup(GAME_WIDTH / 2, 220, 'LEFT POINT!', '#38bdf8', 22);
          }
          const scorerLeft = !leftFault;
          vfx.burst(ball.x, FLOOR - 14, '#2ee59d', 24, 6.5);
          vfx.ring(ball.x, FLOOR - 14, '#2ee59d', 72, 3);
          vfx.flash(scorerLeft ? '#38bdf8' : '#fb7185', 0.12);
          vfx.shake(ball.spiked ? 10 : 7);
          vfx.hitstop(ball.spiked ? 4 : 2);
          sound.explosion();
          sound.combo(8);
          for (let s2 = 0; s2 < 4; s2++) {
            const onLeft = s2 === 0 || s2 === 2;
            if (onLeft === scorerLeft) buzz(s2, 90, 0.5);
            else buzz(s2, 160, 0.8);
          }

          if (teamScore[0] >= WIN_POINTS || teamScore[1] >= WIN_POINTS) {
            banner = teamScore[0] >= WIN_POINTS ? 'LEFT SQUAD WINS SET!' : 'RIGHT SQUAD WINS SET!';
            vfx.confetti(NET_X, 240, 45);
            vfx.confetti(scorerLeft ? GAME_WIDTH * 0.25 : GAME_WIDTH * 0.75, 260, 36);
            vfx.flash('#facc15', 0.22);
            sound.win();
            freeze = 110;
          } else {
            serve(!leftFault);
          }
        }
      }

      drawArcadeBackdrop(ctx, '#2ee59d');

      // Cyber sand court floor
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(28, FLOOR, GAME_WIDTH - 56, 14);
      ctx.strokeStyle = '#2ee59d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(28, FLOOR);
      ctx.lineTo(GAME_WIDTH - 28, FLOOR);
      ctx.stroke();

      // Force-field net with dynamic ripple
      ctx.save();
      ctx.shadowColor = '#2ee59d';
      ctx.shadowBlur = 14 + netRipple;
      ctx.strokeStyle = netRipple > 3 ? '#7dd3fc' : '#2ee59d';
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let ny = NET_TOP; ny <= FLOOR; ny += 8) {
        const distY = Math.abs(ny - netRippleY);
        const wave = Math.sin(frame * 0.6 + ny * 0.15) * netRipple * Math.max(0, 1 - distY / 70);
        if (ny === NET_TOP) ctx.moveTo(NET_X + wave, ny);
        else ctx.lineTo(NET_X + wave, ny);
      }
      ctx.stroke();
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(NET_X, NET_TOP, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Rally badge
      if (rally > 1) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(NET_X - 52, 74, 104, 24, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`RALLY x${rally}`, NET_X, 90);
      }

      // Players
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const p = playersPos[i];
        drawPlayerOrb(ctx, p.x, p.y, 18, active[i].color, i, {
          angle: i === 0 || i === 2 ? 0 : Math.PI,
          flash: p.spikeGlow > 0,
          cooldownPct: p.dashCd / 42,
        });
      }

      // Ball
      ctx.save();
      ctx.shadowColor = ball.spiked ? '#ff6b2b' : '#fde047';
      ctx.shadowBlur = ball.spiked ? 26 : 18;
      ctx.fillStyle = ball.spiked ? '#ff6b2b' : '#fde047';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, `FINAL ${teamScore[0]} - ${teamScore[1]} · STARTING NEXT VOLLEY SET...`, '#2ee59d');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: (i === 0 || i === 2) ? teamScore[0] > teamScore[1] : teamScore[1] > teamScore[0],
          valueText: i === 0 || i === 2 ? `TEAM L: ${teamScore[0]}` : `TEAM R: ${teamScore[1]}`,
        })),
        '2V2 NEON VOLLEY · JUMP / AIR-SPIKE: A / SPACE · DIVE-SAVE: B / SHIFT',
      );
    },
  };
}

// 35. PAC-CHASE MAZE (Corridor Maze, Warp Tunnels, Corner Buffering & Blue Vulnerable Rivals)
export function createPacChaseEngine(): MiniGameEngine {
  const COLS = 19;
  const ROWS = 10;
  const TILE = 42;
  const OX = (GAME_WIDTH - COLS * TILE) / 2; // 81
  const OY = 76; // 76..496 inside safe zone
  const CHOMP_PTS = 40;
  const POWER_FRAMES = 300;

  // 1 = Wall, 0 = Pellet, 2 = Power Pellet, 3 = Empty/Spawn
  const MAZE_TEMPLATE = [
    '1111111111111111111',
    '1200000001000000021',
    '1011011101011101101',
    '1000000000000000001',
    '0011010113110101100',
    '1000010003000100001',
    '1011011101011101101',
    '1001000000000001001',
    '1200010111110100021',
    '1111111111111111111',
  ];

  const scores = [0, 0, 0, 0];
  const wins = [0, 0, 0, 0];
  let grid: number[][] = [];
  let pelletsLeft = 0;
  let comboStep = 0;
  let comboDecay = 0;
  let banner = '';
  let bannerSub = '';
  let freeze = 30;
  let mazeNum = 1;

  const isWall = (c: number, r: number) => {
    if (r < 0 || r >= ROWS) return true;
    if (c < 0 || c >= COLS) return r !== 4; // Row 4 has warp tunnels!
    return grid[r][c] === 1;
  };

  const resetGrid = () => {
    grid = MAZE_TEMPLATE.map((row) => row.split('').map((ch) => Number(ch)));
    pelletsLeft = 0;
    for (const row of grid) for (const cell of row) if (cell === 0 || cell === 2) pelletsLeft++;
  };
  resetGrid();

  // Spawn on open lanes (the old corner spawns sat ON the four power cores, so every
  // core was eaten in the first frame and nobody could ever be chomped).
  const spawns = [
    { c: 4, r: 3, dir: 2 },
    { c: COLS - 5, r: 3, dir: 0 },
    { c: 4, r: ROWS - 3, dir: 2 },
    { c: COLS - 5, r: ROWS - 3, dir: 0 },
  ];

  // Directions: 0=R, 1=D, 2=L, 3=U
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];

  const chasers = spawns.map((sp) => ({
    x: OX + sp.c * TILE + TILE / 2,
    y: OY + sp.r * TILE + TILE / 2,
    dir: sp.dir,
    nextDir: sp.dir,
    powerTimer: 0,
    scaredTimer: 0,
    respawnInvuln: 0,
  }));

  const resetChasers = () => {
    chasers.forEach((c, i) => {
      const sp = spawns[i];
      c.x = OX + sp.c * TILE + TILE / 2;
      c.y = OY + sp.r * TILE + TILE / 2;
      c.dir = sp.dir;
      c.nextDir = sp.dir;
      c.powerTimer = 0;
      c.scaredTimer = 0;
      c.respawnInvuln = 0;
    });
  };

  // BFS scratch buffers (reused every call: no per-frame allocation)
  const bfsFirst = new Int8Array(ROWS * COLS);
  const bfsSeen = new Uint8Array(ROWS * COLS);
  const bfsQueue = new Int16Array(ROWS * COLS);

  // Returns the first-step direction toward the nearest pellet (power pellets
  // count as a bit closer), or -1 if none reachable. Ignores warp tunnels.
  const bfsPelletDir = (col: number, row: number, avoidDir: number) => {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return -1;
    bfsSeen.fill(0);
    let head = 0;
    let tail = 0;
    const start = row * COLS + col;
    bfsSeen[start] = 1;
    // Rotate neighbour order randomly so equal-distance ties don't all bias one way
    const rot = Math.floor(Math.random() * 4);
    for (let k = 0; k < 4; k++) {
      const d = (k + rot) % 4;
      if (d === avoidDir) continue;
      const nc = col + DX[d];
      const nr = row + DY[d];
      if (nc < 0 || nc >= COLS || isWall(nc, nr)) continue;
      const idx = nr * COLS + nc;
      bfsSeen[idx] = 1;
      bfsFirst[idx] = d;
      bfsQueue[tail++] = idx;
    }
    while (head < tail) {
      const idx = bfsQueue[head++];
      const r = Math.floor(idx / COLS);
      const c = idx - r * COLS;
      const cell = grid[r][c];
      if (cell === 0 || cell === 2) return bfsFirst[idx];
      for (let k = 0; k < 4; k++) {
        const d = (k + rot) % 4;
        const nc = c + DX[d];
        const nr = r + DY[d];
        if (nc < 0 || nc >= COLS || isWall(nc, nr)) continue;
        const nidx = nr * COLS + nc;
        if (bfsSeen[nidx]) continue;
        bfsSeen[nidx] = 1;
        bfsFirst[nidx] = bfsFirst[idx];
        bfsQueue[tail++] = nidx;
      }
    }
    return -1;
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (active[slot].isHuman) rumble(slot, ms, intensity);
      };
      const maxScore = Math.max(...scores);
      const maxWins = Math.max(...wins);

      vfx.beginCamera(ctx);

      if (comboDecay > 0) comboDecay--;
      else comboStep = 0;

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) {
          banner = '';
          bannerSub = '';
          for (let i = 0; i < 4; i++) scores[i] = 0;
          mazeNum++;
          resetGrid();
          resetChasers();
        }
      } else {
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const c = chasers[i];
          if (c.powerTimer > 0) c.powerTimer--;
          if (c.scaredTimer > 0) c.scaredTimer--;
          if (c.respawnInvuln > 0) c.respawnInvuln--;

          // Determine desired direction
          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            if (Math.abs(inp.x) > Math.abs(inp.y) && Math.abs(inp.x) > 0.35) {
              c.nextDir = inp.x > 0 ? 0 : 2;
            } else if (Math.abs(inp.y) > 0.35) {
              c.nextDir = inp.y > 0 ? 1 : 3;
            }
          } else {
            // Bot: at intersections, weigh BFS route to nearest pellet, chasing scared
            // rivals while powered, and fleeing powered rivals while scared.
            const col = Math.round((c.x - OX - TILE / 2) / TILE);
            const row = Math.round((c.y - OY - TILE / 2) / TILE);
            const cx = OX + col * TILE + TILE / 2;
            const cy = OY + row * TILE + TILE / 2;
            if (Math.hypot(c.x - cx, c.y - cy) < 4) {
              const rev = (c.dir + 2) % 4;
              const pelletDir = bfsPelletDir(col, row, rev);
              let bestDir = c.dir;
              let bestVal = -Infinity;
              let anyValid = false;
              for (let d = 0; d < 4; d++) {
                if (isWall(col + DX[d], row + DY[d])) continue;
                anyValid = true;
                const nc = col + DX[d];
                const nr = row + DY[d];
                const ncx = OX + nc * TILE + TILE / 2;
                const ncy = OY + nr * TILE + TILE / 2;
                let val = Math.random() * 2.5;
                if (d === rev) val -= 6;
                if (d === pelletDir) val += 9;
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] === 2) val += 8;
                for (let j = 0; j < 4; j++) {
                  if (j === i || !active[j].enabled) continue;
                  const o = chasers[j];
                  const distNow = Math.hypot(cx - o.x, cy - o.y);
                  const distAfter = Math.hypot(ncx - o.x, ncy - o.y);
                  if (c.powerTimer > 0 && o.scaredTimer > 0 && o.respawnInvuln === 0 && distNow < 300) {
                    val += (distNow - distAfter) * 0.35; // close in
                  } else if (c.scaredTimer > 0 && o.powerTimer > 0 && distNow < 220) {
                    val += (distAfter - distNow) * 0.45; // run away
                  }
                }
                if (val > bestVal) {
                  bestVal = val;
                  bestDir = d;
                }
              }
              if (anyValid) c.nextDir = bestDir;
            }
          }

          const spd = c.powerTimer > 0 ? 3.8 : c.scaredTimer > 0 ? 2.6 : 3.2;
          const col = Math.round((c.x - OX - TILE / 2) / TILE);
          const row = Math.round((c.y - OY - TILE / 2) / TILE);
          const tileCx = OX + col * TILE + TILE / 2;
          const tileCy = OY + row * TILE + TILE / 2;

          if (c.nextDir === (c.dir + 2) % 4) {
            // Instant reversal is always allowed (classic arcade feel)
            c.dir = c.nextDir;
          } else if (c.nextDir !== c.dir && !isWall(col + DX[c.nextDir], row + DY[c.nextDir])) {
            // Corner buffering: snap onto tile center if close enough and nextDir is open
            if (Math.hypot(c.x - tileCx, c.y - tileCy) < 8) {
              c.x = tileCx;
              c.y = tileCy;
              c.dir = c.nextDir;
            }
          }

          // Move along current direction if no wall ahead
          const nx = c.x + DX[c.dir] * spd;
          const ny = c.y + DY[c.dir] * spd;
          const aheadCol = Math.round((nx + DX[c.dir] * 14 - OX - TILE / 2) / TILE);
          const aheadRow = Math.round((ny + DY[c.dir] * 14 - OY - TILE / 2) / TILE);
          if (!isWall(aheadCol, aheadRow)) {
            c.x = nx;
            c.y = ny;
          } else {
            c.x = tileCx;
            c.y = tileCy;
          }

          // Left / Right Warp Tunnel on row 4
          if (c.x < OX - 12) {
            c.x = OX + COLS * TILE + 8;
            vfx.ring(c.x, c.y, active[i].color, 36, 2);
            sound.dash();
          } else if (c.x > OX + COLS * TILE + 12) {
            c.x = OX - 8;
            vfx.ring(c.x, c.y, active[i].color, 36, 2);
            sound.dash();
          }

          if (c.powerTimer > 0 && frame % 3 === 0) {
            vfx.afterimage(c.x, c.y, 16, '#facc15', 7);
          }
          if (c.powerTimer === 60) sound.sweep(660, 330, 0.2, 'triangle', 0.06);

          // Eat pellets
          const curC = Math.round((c.x - OX - TILE / 2) / TILE);
          const curR = Math.round((c.y - OY - TILE / 2) / TILE);
          if (curR >= 0 && curR < ROWS && curC >= 0 && curC < COLS) {
            const cell = grid[curR][curC];
            if (cell === 0 || cell === 2) {
              grid[curR][curC] = 3;
              pelletsLeft--;
              const pcx = OX + curC * TILE + TILE / 2;
              const pcy = OY + curR * TILE + TILE / 2;
              if (cell === 2) {
                scores[i] += 30;
                c.powerTimer = POWER_FRAMES;
                c.scaredTimer = 0;
                for (let j = 0; j < 4; j++) {
                  if (j !== i && active[j].enabled && chasers[j].powerTimer === 0) {
                    chasers[j].scaredTimer = POWER_FRAMES;
                    buzz(j, 80, 0.4);
                  }
                }
                vfx.ring(pcx, pcy, '#facc15', 70, 3.5);
                vfx.burst(pcx, pcy, '#ff6b2b', 14, 5);
                vfx.popup(pcx, pcy - 12, 'POWER CHOMP!', '#facc15', 15);
                vfx.flash('#2563eb', 0.12);
                vfx.shake(3);
                sound.pickup(200);
                sound.sweep(200, 900, 0.25, 'square', 0.06);
                buzz(i, 110, 0.6);
              } else {
                scores[i] += 5;
                comboStep++;
                comboDecay = 32;
                sound.combo(comboStep % 12);
                if (comboStep % 3 === 0) vfx.spark(pcx, pcy, (Math.random() - 0.5) * 2, -1.5, '#fde047', 2);
              }
            }
          }
        }

        // Chomp scared rivals
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || chasers[i].powerTimer === 0) continue;
          for (let j = 0; j < 4; j++) {
            if (i === j || !active[j].enabled || chasers[j].scaredTimer === 0 || chasers[j].respawnInvuln > 0) continue;
            if (Math.hypot(chasers[i].x - chasers[j].x, chasers[i].y - chasers[j].y) < 30) {
              scores[i] += CHOMP_PTS;
              vfx.hitstop(4);
              vfx.burst(chasers[j].x, chasers[j].y, '#38bdf8', 22, 6.5);
              vfx.ring(chasers[j].x, chasers[j].y, active[i].color, 70, 4);
              vfx.popup(chasers[j].x, chasers[j].y - 16, `CHOMP +${CHOMP_PTS}!`, '#facc15', 16);
              vfx.shake(8);
              sound.explosion();
              buzz(j, 150, 0.85);
              buzz(i, 120, 0.7);
              // Respawn at center pen
              chasers[j].x = OX + 9 * TILE + TILE / 2;
              chasers[j].y = OY + 4 * TILE + TILE / 2;
              chasers[j].scaredTimer = 0;
              chasers[j].respawnInvuln = 60;
              vfx.ring(chasers[j].x, chasers[j].y, '#ffffff', 40, 2);
            }
          }
        }

        // Maze cleared: highest score takes the round
        if (pelletsLeft <= 0) {
          let best = -1;
          let bestScore = -1;
          let tie = false;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            if (scores[i] > bestScore) {
              bestScore = scores[i];
              best = i;
              tie = false;
            } else if (scores[i] === bestScore) {
              tie = true;
            }
          }
          if (best >= 0 && !tie) {
            wins[best]++;
            banner = `${active[best].name} MAZE MUNCHER!`;
            buzz(best, 240, 0.85);
          } else {
            banner = 'MAZE CLEARED · TIE!';
          }
          bannerSub = `TOP SCORE ${bestScore}PT · LOADING MAZE ${mazeNum + 1}...`;
          vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 44);
          vfx.confetti(GAME_WIDTH * 0.25, 240, 24);
          vfx.confetti(GAME_WIDTH * 0.75, 240, 24);
          vfx.flash('#facc15', 0.22);
          sound.win();
          freeze = 120;
        }
      }

      drawArcadeBackdrop(ctx, '#facc15');

      // Draw maze walls in one batched path, then pellets in one batched path
      ctx.fillStyle = '#172554';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c] === 1) ctx.roundRect(OX + c * TILE + 3, OY + r * TILE + 3, TILE - 6, TILE - 6, 7);
        }
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c] === 0) {
            const px = OX + c * TILE + TILE / 2;
            const py = OY + r * TILE + TILE / 2;
            ctx.moveTo(px + 3.5, py);
            ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          }
        }
      }
      ctx.fill();

      const pulse = 7 + Math.sin(frame * 0.2) * 2.5;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c] !== 2) continue;
          const px = OX + c * TILE + TILE / 2;
          const py = OY + r * TILE + TILE / 2;
          ctx.save();
          ctx.shadowColor = '#ff6b2b';
          ctx.shadowBlur = 14;
          ctx.fillStyle = '#ff6b2b';
          ctx.beginPath();
          ctx.arc(px, py, pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Draw Warp Tunnel Arrows
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('«WARP', OX - 24, OY + 4 * TILE + 25);
      ctx.fillText('WARP»', OX + COLS * TILE + 24, OY + 4 * TILE + 25);

      // Draw Chasers
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const c = chasers[i];
        const dirAng = (c.dir * Math.PI) / 2;
        const isScared = c.scaredTimer > 0;
        const scaredFlash = isScared && c.scaredTimer < 90 && frame % 10 < 5;
        const col = isScared ? (scaredFlash ? '#f8fafc' : '#2563eb') : active[i].color;

        drawPlayerOrb(ctx, c.x, c.y, c.powerTimer > 0 ? 17 : 15, col, i, {
          angle: dirAng,
          leader: maxScore > 0 && scores[i] === maxScore,
          shield: c.powerTimer > 0,
          flash: c.respawnInvuln > 0 && frame % 6 < 3,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#facc15');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: chasers[i].powerTimer > 0 || (maxScore > 0 && scores[i] === maxScore),
          valueText: maxWins > 0 ? `${scores[i]}pt · W${wins[i]}` : `${scores[i]}pt`,
        })),
        `RUN: STICK / D-PAD / WASD · WARP TUNNELS · POWER CORES TURN RIVALS BLUE · ${pelletsLeft} LEFT`,
      );
    },
  };
}
