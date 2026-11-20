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
  ScorePillData,
} from '../sharedEngine';

// 56. LASER LIMBO (Jump LOW Beams, Duck HIGH Beams, Dodge WALL Scanners + Grab Coins!)
export function createLaserLimboEngine(): MiniGameEngine {
  const FLOOR_Y = 472;
  const LEFT = 56;
  const RIGHT = GAME_WIDTH - 56;
  const LOW_BEAM_Y = FLOOR_Y - 16;
  // Standing hitbox spans FLOOR_Y-32..FLOOR_Y, ducking FLOOR_Y-18..FLOOR_Y. The high beam
  // used to sit at FLOOR_Y-38 — above a standing runner's head — so it could never hit
  // anyone who simply stood still. FLOOR_Y-27 hits standing runners but clears a duck.
  const HIGH_BEAM_Y = FLOOR_Y - 27;

  const wins = [0, 0, 0, 0];
  const score = [0, 0, 0, 0];
  const coinStreak = [0, 0, 0, 0];
  const coinStreakTimer = [0, 0, 0, 0];
  let bannerTimer = 70;
  let bannerTitle = 'LASER LIMBO';
  let bannerSub = 'UP/A: JUMP LOW BEAM · DOWN/B: DUCK HIGH BEAM · DODGE WALLS!';
  let bannerColor = '#fb7185';
  let matchOver = false;
  // Freezes play between a round ending and resetRound(); prevents the end-of-round
  // check from re-awarding the same win during the banner's final frames.
  let roundOver = false;

  const prevA = [false, false, false, false];
  const prevDuck = [false, false, false, false];

  const runners = [0, 1, 2, 3].map((i) => ({
    x: 200 + i * 180,
    y: FLOOR_Y - 16,
    vy: 0,
    ducking: false,
    grounded: true,
    hp: 3,
    invuln: 0,
    flash: 0,
    facing: 1,
  }));

  type BeamKind = 'low' | 'high' | 'wall';
  interface Beam {
    kind: BeamKind;
    x: number;
    y: number;
    originX: number;
    vx: number;
    vy: number;
    warnTimer: number;
    activeTimer: number;
  }

  let beams: Beam[] = [];
  let spawnTimer = 60;
  let tempo = 0;

  let coins = Array.from({ length: 4 }, (_, k) => ({
    x: 180 + k * 200,
    y: FLOOR_Y - (k % 2 === 0 ? 32 : 76),
  }));

  function resetRound() {
    beams = [];
    spawnTimer = 55;
    tempo = 0;
    coinStreak.fill(0);
    coinStreakTimer.fill(0);
    for (let i = 0; i < 4; i++) {
      runners[i].x = 200 + i * 180;
      runners[i].y = FLOOR_Y - 16;
      runners[i].vy = 0;
      runners[i].ducking = false;
      runners[i].grounded = true;
      runners[i].hp = 3;
      runners[i].invuln = 30;
      runners[i].flash = 0;
      prevDuck[i] = false;
    }
  }

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      if (bannerTimer > 0) {
        bannerTimer--;
        if (bannerTimer === 0) {
          if (matchOver) {
            wins.fill(0);
            score.fill(0);
            matchOver = false;
          }
          if (roundOver) {
            roundOver = false;
            resetRound();
          }
        }
      }

      if (bannerTimer <= 10 && !matchOver && !roundOver) {
        tempo++;
        spawnTimer--;
        if (spawnTimer <= 0) {
          const r = Math.random();
          const spdScale = 1 + Math.min(1.1, tempo / 1400);
          if (r < 0.42) {
            // LOW beam (must jump!)
            const fromLeft = Math.random() < 0.5;
            const ox = fromLeft ? LEFT : RIGHT;
            beams.push({
              kind: 'low',
              x: ox,
              y: LOW_BEAM_Y,
              originX: ox,
              vx: (fromLeft ? 5.2 : -5.2) * spdScale,
              vy: 0,
              warnTimer: 36,
              activeTimer: 160,
            });
          } else if (r < 0.8) {
            // HIGH beam (must duck!)
            const fromLeft = Math.random() < 0.5;
            const ox = fromLeft ? LEFT : RIGHT;
            beams.push({
              kind: 'high',
              x: ox,
              y: HIGH_BEAM_Y,
              originX: ox,
              vx: (fromLeft ? 5.2 : -5.2) * spdScale,
              vy: 0,
              warnTimer: 36,
              activeTimer: 160,
            });
          } else {
            // WALL vertical scanner dropping down at a random column
            const wx = 120 + Math.random() * (GAME_WIDTH - 240);
            beams.push({
              kind: 'wall',
              x: wx,
              y: 84,
              originX: wx,
              vx: 0,
              vy: 4.4 * spdScale,
              warnTimer: 42,
              activeTimer: 120,
            });
          }
          sound.beep(480, 0.05, 'square', 0.06);
          spawnTimer = Math.max(38, 86 - Math.floor(tempo / 45));
        }

        // Update beams
        beams = beams.filter((b) => {
          if (b.warnTimer > 0) {
            b.warnTimer--;
            return true;
          }
          b.x += b.vx;
          b.y += b.vy;
          b.activeTimer--;
          if (frame % 2 === 0) {
            const bCol = b.kind === 'low' ? '#38bdf8' : b.kind === 'high' ? '#fb7185' : '#c084fc';
            vfx.afterimage(b.x, b.y, b.kind === 'wall' ? 11 : 8, bCol, 7);
          }
          return b.activeTimer > 0 && b.x >= LEFT - 30 && b.x <= RIGHT + 30 && b.y <= FLOOR_Y + 20;
        });

        // Update players
        for (let i = 0; i < 4; i++) {
          const r = runners[i];
          if (!active[i].enabled || r.hp <= 0) continue;
          if (r.invuln > 0) r.invuln--;
          if (r.flash > 0) r.flash--;
          if (coinStreakTimer[i] > 0) {
            coinStreakTimer[i]--;
            if (coinStreakTimer[i] === 0) coinStreak[i] = 0;
          }

          let ix = 0;
          let jump = false;
          let duck = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            jump = (inp.actionA && !prevA[i]) || inp.y < -0.55;
            duck = inp.actionB || inp.y > 0.55;
            prevA[i] = inp.actionA;
          } else {
            // Bot reacts to nearest incoming beam
            let threat: Beam | null = null;
            let bestDist = 9999;
            for (const b of beams) {
              const d = Math.abs(b.x - r.x);
              if (d < bestDist) {
                bestDist = d;
                threat = b;
              }
            }
            if (threat && bestDist < 130) {
              if (threat.kind === 'low' && r.grounded && bestDist < 85) jump = true;
              else if (threat.kind === 'high') duck = true;
              else if (threat.kind === 'wall' && Math.abs(threat.x - r.x) < 55) {
                ix = r.x < threat.x ? -0.95 : 0.95;
              }
            } else {
              // Seek coin
              const coin = coins[i % coins.length];
              if (coin) {
                const dx = coin.x - r.x;
                ix = Math.max(-0.8, Math.min(0.8, dx * 0.02));
                if (coin.y < FLOOR_Y - 50 && Math.abs(dx) < 30 && r.grounded) jump = true;
              }
            }
          }

          const wasDucking = prevDuck[i];
          r.ducking = duck && r.grounded;
          prevDuck[i] = r.ducking;
          const speed = r.ducking ? 2.4 : 4.6;
          r.x = Math.max(LEFT + 18, Math.min(RIGHT - 18, r.x + ix * speed));
          if (Math.abs(ix) > 0.1) r.facing = ix > 0 ? 1 : -1;

          // Slide-duck afterimage & floor sparks
          if (r.ducking && !wasDucking) {
            vfx.afterimage(r.x, r.y + 4, 13, active[i].color, 10);
            vfx.spark(r.x - r.facing * 8, FLOOR_Y - 2, -r.facing * 2.5, -1.2, active[i].color, 3);
            sound.dash();
          } else if (r.ducking && Math.abs(ix) > 0.2 && frame % 2 === 0) {
            vfx.afterimage(r.x, r.y + 3, 11, active[i].color, 8);
            vfx.spark(r.x - r.facing * 10, FLOOR_Y - 2, -r.facing * 1.8, -0.8, '#e2e8f0', 2.5);
          }

          if (jump && r.grounded) {
            r.vy = -10.2;
            r.grounded = false;
            r.ducking = false;
            sound.sweep(280, 560, 0.07, 'triangle', 0.07);
            vfx.afterimage(r.x, r.y, 15, active[i].color, 11);
            vfx.burst(r.x, FLOOR_Y, '#e2e8f0', 6, 2.5);
          }

          if (!r.grounded && frame % 2 === 0) {
            vfx.afterimage(r.x, r.y, 13, active[i].color, 9);
          }

          r.vy += 0.48;
          r.y += r.vy;
          const standOffset = r.ducking ? 9 : 16;
          if (r.y >= FLOOR_Y - standOffset) {
            r.y = FLOOR_Y - standOffset;
            r.vy = 0;
            r.grounded = true;
          }

          // Collect coins with combo streak escalation
          for (const c of coins) {
            if (Math.hypot(r.x - c.x, r.y - c.y) < 26) {
              coinStreak[i]++;
              coinStreakTimer[i] = 210;
              const streakBonus = Math.min(20, (coinStreak[i] - 1) * 5);
              const pts = 10 + streakBonus;
              score[i] += pts;
              sound.combo(Math.min(10, coinStreak[i]));
              vfx.burst(c.x, c.y, '#facc15', 10 + Math.min(8, coinStreak[i] * 2), 3.8);
              if (coinStreak[i] >= 2) {
                vfx.ring(c.x, c.y, '#facc15', 34 + coinStreak[i] * 4, 2.5);
                vfx.popup(c.x, c.y - 14, `+${pts} x${coinStreak[i]}!`, '#facc15', 14);
              } else {
                vfx.popup(c.x, c.y - 12, '+10', '#facc15', 13);
              }
              c.x = 100 + Math.random() * (GAME_WIDTH - 200);
              c.y = FLOOR_Y - (Math.random() < 0.5 ? 24 : 78);
            }
          }

          if (frame % 30 === 0) score[i] += 2;

          // Beam hit checks
          if (r.invuln === 0) {
            const playerTop = r.y - (r.ducking ? 9 : 16);
            const playerBot = r.y + (r.ducking ? 9 : 16);
            for (const b of beams) {
              if (b.warnTimer > 0) continue;
              let hit = false;
              if (b.kind === 'low' || b.kind === 'high') {
                if (Math.abs(r.x - b.x) < 18 && b.y >= playerTop && b.y <= playerBot) hit = true;
              } else if (b.kind === 'wall') {
                if (Math.abs(r.x - b.x) < 22 && Math.abs(r.y - b.y) < 22) hit = true;
              }
              if (hit) {
                r.hp--;
                r.invuln = 48;
                r.flash = 12;
                coinStreak[i] = 0;
                coinStreakTimer[i] = 0;
                sound.explosion();
                vfx.hitstop(2);
                vfx.shake(8);
                vfx.flash('#fb7185', 0.2);
                vfx.ring(r.x, r.y, '#fb7185', 56, 3.5);
                vfx.burst(r.x, r.y, '#fb7185', 18, 5.2);
                vfx.popup(r.x, r.y - 22, r.hp === 0 ? 'OUT!' : '-1 ♥', '#fb7185', 14);
                rumble(i, 150, 0.92);
                break;
              }
            }
          }
        }

        // Round end check (supports solo botsEnabled=false cleanly)
        const alive = [0, 1, 2, 3].filter((idx) => active[idx].enabled && runners[idx].hp > 0);
        const total = active.filter((a) => a.enabled).length;
        if (total > 1 && alive.length <= 1) {
          // Simultaneous last-two KO: higher score takes the round
          const rw =
            alive[0] ??
            [0, 1, 2, 3].filter((idx) => active[idx].enabled).sort((a, b) => score[b] - score[a])[0] ??
            0;
          roundOver = true;
          wins[rw]++;
          score[rw] += 30;
          sound.win();
          vfx.flash(active[rw].color, 0.25);
          vfx.confetti(GAME_WIDTH / 2, 220, 50);
          rumble(rw, 160, 0.7);
          if (wins[rw] >= 3) {
            vfx.confetti(180, 200, 40);
            vfx.confetti(GAME_WIDTH - 180, 200, 40);
            matchOver = true;
            bannerTitle = `${active[rw].name} IS LIMBO KING!`;
            bannerSub = `3 ROUND WINS · ${score[rw]} PTS`;
            bannerColor = active[rw].color;
            bannerTimer = 140;
          } else {
            bannerTitle = `${active[rw].name} SURVIVES!`;
            bannerSub = `ROUND WIN ${wins[rw]}/3`;
            bannerColor = active[rw].color;
            bannerTimer = 80;
          }
        } else if (total === 1 && alive.length === 0) {
          const soloIdx = active.findIndex((a) => a.enabled);
          const sIdx = soloIdx >= 0 ? soloIdx : 0;
          roundOver = true;
          matchOver = true;
          bannerTitle = 'LASER WIPEOUT!';
          bannerSub = `FINAL SCORE: ${score[sIdx]} PTS · RESTARTING...`;
          bannerColor = '#fb7185';
          bannerTimer = 110;
          sound.explosion();
        }
      }

      // Render
      drawArcadeBackdrop(ctx, '#fb7185');

      // Stage floor & emitter rails (left, right, top)
      ctx.save();
      ctx.fillStyle = 'rgba(251, 113, 133, 0.28)';
      ctx.fillRect(LEFT, FLOOR_Y, RIGHT - LEFT, 6);
      // Left, Right & Top Laser Emitter Rails
      ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(LEFT - 14, 78, 12, FLOOR_Y - 72);
      ctx.strokeRect(LEFT - 14, 78, 12, FLOOR_Y - 72);
      ctx.fillRect(RIGHT + 2, 78, 12, FLOOR_Y - 72);
      ctx.strokeRect(RIGHT + 2, 78, 12, FLOOR_Y - 72);
      ctx.fillRect(LEFT - 14, 72, RIGHT - LEFT + 28, 10);
      ctx.strokeRect(LEFT - 14, 72, RIGHT - LEFT + 28, 10);

      // Static mounted emitter pods along left/right rails (low & high lanes)
      for (const railX of [LEFT - 8, RIGHT + 8]) {
        for (const lane of [
          { y: LOW_BEAM_Y, col: '#38bdf8' },
          { y: HIGH_BEAM_Y, col: '#fb7185' },
        ]) {
          ctx.fillStyle = '#0f172a';
          ctx.strokeStyle = lane.col;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(railX, lane.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = lane.col;
          ctx.globalAlpha = 0.55 + Math.sin(frame * 0.12) * 0.25;
          ctx.beginPath();
          ctx.arc(railX, lane.y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();

      // Coins
      for (const c of coins) {
        ctx.save();
        ctx.fillStyle = '#facc15';
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Beams + active glowing emitter nodes
      for (const b of beams) {
        ctx.save();
        const color = b.kind === 'low' ? '#38bdf8' : b.kind === 'high' ? '#fb7185' : '#c084fc';
        const ex = b.kind === 'wall' ? b.originX : b.originX === LEFT ? LEFT - 6 : RIGHT + 6;
        const ey = b.kind === 'wall' ? 78 : b.y;
        // Glowing emitter node firing or charging on the rail (additive halo, no shadowBlur)
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = b.warnTimer > 0 ? '#facc15' : color;
        ctx.beginPath();
        ctx.arc(ex, ey, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = b.warnTimer > 0 ? '#facc15' : color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(ex, ey, b.warnTimer > 0 ? 9 + Math.sin(frame * 0.5) * 2 : 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
        ctx.fill();

        if (b.warnTimer > 0) {
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
          ctx.setLineDash([6, 6]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (b.kind === 'wall') {
            ctx.moveTo(b.x, 84);
            ctx.lineTo(b.x, FLOOR_Y);
          } else {
            ctx.moveTo(LEFT, b.y);
            ctx.lineTo(RIGHT, b.y);
          }
          ctx.stroke();

          ctx.fillStyle = '#facc15';
          ctx.font = '800 12px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          const label = b.kind === 'low' ? 'JUMP!' : b.kind === 'high' ? 'DUCK!' : 'DODGE!';
          ctx.fillText(label, b.kind === 'wall' ? b.x : b.x + (b.vx > 0 ? 36 : -36), b.kind === 'wall' ? 105 : b.y - 10);
        } else {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.kind === 'wall' ? 24 : 20, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          if (b.kind === 'wall') {
            ctx.fillRect(b.x - 16, b.y - 10, 32, 20);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(b.x - 12, b.y - 3, 24, 6);
          } else {
            ctx.beginPath();
            ctx.arc(b.x, b.y, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => wins[b] * 1000 + score[b] - (wins[a] * 1000 + score[a]))[0];

      for (let i = 0; i < 4; i++) {
        const r = runners[i];
        if (!active[i].enabled || r.hp <= 0) continue;
        ctx.save();
        if (r.invuln > 0 && Math.floor(frame / 3) % 2 === 0) ctx.globalAlpha = 0.5;
        if (r.ducking) {
          ctx.translate(r.x, r.y + 4);
          ctx.scale(1.25, 0.65);
          drawPlayerOrb(ctx, 0, 0, 15, active[i].color, i, {
            angle: r.facing === 1 ? 0 : Math.PI,
            leader: i === leaderIdx && (wins[i] > 0 || score[i] > 0),
            flash: r.flash > 0,
          });
        } else {
          drawPlayerOrb(ctx, r.x, r.y, 15, active[i].color, i, {
            angle: r.facing === 1 ? 0 : Math.PI,
            leader: i === leaderIdx && (wins[i] > 0 || score[i] > 0),
            flash: r.flash > 0,
          });
        }
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      const pills: ScorePillData[] = [0, 1, 2, 3].map((s) => ({
        slot: s,
        name: active[s].name,
        color: active[s].color,
        active: active[s].enabled,
        valueText: `★${wins[s]} · ${'♥'.repeat(Math.max(0, runners[s].hp))}`,
        highlight: s === leaderIdx && (wins[s] > 0 || score[s] > 0),
      }));
      drawTopScoreboard(ctx, pills, 'UP/A: JUMP · DOWN/B: DUCK · FIRST TO 3 ROUND WINS');

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 57. MAGNET PULL (Toggle Polarity: Attract Coins & Repel Rivals / Repel Bombs & Pull Rivals!)
export function createMagnetPullEngine(): MiniGameEngine {
  const TARGET_SCORE = 220;
  const ROUND_FRAMES = 45 * 60;
  const ARENA_L = 48;
  const ARENA_R = GAME_WIDTH - 48;
  const ARENA_T = 78;
  const ARENA_B = GAME_HEIGHT - 42;

  const scores = [0, 0, 0, 0];
  let roundTimer = ROUND_FRAMES;
  let bannerTimer = 70;
  let bannerTitle = 'MAGNET PULL';
  let bannerSub = 'A: ATTRACT COINS + REPEL RIVALS · B: REPEL BOMBS + PULL RIVALS!';
  let bannerColor = '#38bdf8';
  let matchOver = false;

  const mags = [0, 1, 2, 3].map((i) => ({
    x: i % 2 === 0 ? 190 : GAME_WIDTH - 190,
    y: i < 2 ? 170 : 400,
    vx: 0,
    vy: 0,
    mode: 'idle' as 'idle' | 'attract' | 'repel',
    flash: 0,
    angle: 0,
  }));

  interface Item {
    x: number;
    y: number;
    vx: number;
    vy: number;
    kind: 'coin' | 'bomb';
  }
  let items: Item[] = [];

  function spawnItems() {
    const coins = items.filter((it) => it.kind === 'coin').length;
    const bombs = items.filter((it) => it.kind === 'bomb').length;
    if (coins < 9) {
      items.push({
        x: 110 + Math.random() * (GAME_WIDTH - 220),
        y: 110 + Math.random() * (GAME_HEIGHT - 190),
        vx: (Math.random() - 0.5) * 1.6,
        vy: (Math.random() - 0.5) * 1.6,
        kind: 'coin',
      });
    }
    if (bombs < 4) {
      items.push({
        x: 120 + Math.random() * (GAME_WIDTH - 240),
        y: 120 + Math.random() * (GAME_HEIGHT - 210),
        vx: (Math.random() - 0.5) * 2.2,
        vy: (Math.random() - 0.5) * 2.2,
        kind: 'bomb',
      });
    }
  }

  function resetAll() {
    scores.fill(0);
    roundTimer = ROUND_FRAMES;
    items = [];
    for (let i = 0; i < 4; i++) {
      mags[i].x = i % 2 === 0 ? 190 : GAME_WIDTH - 190;
      mags[i].y = i < 2 ? 170 : 400;
      mags[i].vx = 0;
      mags[i].vy = 0;
      mags[i].mode = 'idle';
    }
  }

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      if (bannerTimer > 0) {
        bannerTimer--;
        if (bannerTimer === 0 && matchOver) {
          matchOver = false;
          resetAll();
        }
      }

      spawnItems();

      if (bannerTimer <= 10 && !matchOver) {
        roundTimer = Math.max(0, roundTimer - 1);

        // Players
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const m = mags[i];
          if (m.flash > 0) m.flash--;

          let ix = 0;
          let iy = 0;
          let mode: 'idle' | 'attract' | 'repel' = 'idle';

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            if (inp.actionA) mode = 'attract';
            else if (inp.actionB) mode = 'repel';
          } else {
            // Bot: find nearest bomb vs coin
            let nearestBomb: Item | null = null;
            let bombD = 9999;
            let nearestCoin: Item | null = null;
            let coinD = 9999;
            for (const it of items) {
              const d = Math.hypot(it.x - m.x, it.y - m.y);
              if (it.kind === 'bomb' && d < bombD) {
                bombD = d;
                nearestBomb = it;
              } else if (it.kind === 'coin' && d < coinD) {
                coinD = d;
                nearestCoin = it;
              }
            }
            if (nearestBomb && bombD < 95) {
              mode = 'repel';
              const d = bombD || 1;
              ix = ((m.x - nearestBomb.x) / d) * 0.85;
              iy = ((m.y - nearestBomb.y) / d) * 0.85;
            } else if (nearestCoin) {
              const d = coinD || 1;
              ix = ((nearestCoin.x - m.x) / d) * 0.85;
              iy = ((nearestCoin.y - m.y) / d) * 0.85;
              if (coinD < 155) mode = 'attract';
            }
          }

          m.mode = mode;
          if (Math.hypot(ix, iy) > 0.15) m.angle = Math.atan2(iy, ix);
          m.vx = m.vx * 0.8 + ix * 0.9;
          m.vy = m.vy * 0.8 + iy * 0.9;
          m.x = Math.max(ARENA_L + 18, Math.min(ARENA_R - 18, m.x + m.vx));
          m.y = Math.max(ARENA_T + 18, Math.min(ARENA_B - 18, m.y + m.vy));

          if (Math.hypot(m.vx, m.vy) > 5.2 && frame % 2 === 0) {
            vfx.afterimage(m.x, m.y, 16, active[i].color, 8);
          }

          // Magnetic forces on items & rivals
          if (m.mode !== 'idle') {
            for (const it of items) {
              const dx = m.x - it.x;
              const dy = m.y - it.y;
              const d = Math.hypot(dx, dy);
              if (d > 5 && d < 170) {
                const strength = (1 - d / 170) * 0.55;
                if (m.mode === 'attract' && it.kind === 'coin') {
                  it.vx += (dx / d) * strength;
                  it.vy += (dy / d) * strength;
                  if (frame % 9 === 0) vfx.bolt(m.x, m.y, it.x, it.y, '#38bdf8');
                } else if (m.mode === 'repel' && it.kind === 'bomb') {
                  it.vx -= (dx / d) * strength * 1.4;
                  it.vy -= (dy / d) * strength * 1.4;
                  if (frame % 9 === 0) vfx.bolt(m.x, m.y, it.x, it.y, '#e879f9');
                }
              }
            }

            // Affect rival players!
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled) continue;
              const r = mags[j];
              const dx = m.x - r.x;
              const dy = m.y - r.y;
              const d = Math.hypot(dx, dy);
              if (d > 10 && d < 165) {
                const push = (1 - d / 165) * 0.42;
                if (m.mode === 'attract') {
                  // Attract mode repels rivals!
                  r.vx -= (dx / d) * push;
                  r.vy -= (dy / d) * push;
                } else if (m.mode === 'repel') {
                  // Repel mode pulls rivals!
                  r.vx += (dx / d) * push;
                  r.vy += (dy / d) * push;
                }
              }
            }
          }
        }

        // Update items & pickups
        items = items.filter((it) => {
          it.x += it.vx;
          it.y += it.vy;
          it.vx *= 0.96;
          it.vy *= 0.96;

          if (Math.hypot(it.vx, it.vy) > 3.2 && frame % 2 === 0) {
            vfx.afterimage(
              it.x,
              it.y,
              it.kind === 'coin' ? 9 : 11,
              it.kind === 'coin' ? '#facc15' : '#e879f9',
              8,
            );
          }

          if (it.x < ARENA_L + 12) { it.x = ARENA_L + 12; it.vx = Math.abs(it.vx); }
          if (it.x > ARENA_R - 12) { it.x = ARENA_R - 12; it.vx = -Math.abs(it.vx); }
          if (it.y < ARENA_T + 12) { it.y = ARENA_T + 12; it.vy = Math.abs(it.vy); }
          if (it.y > ARENA_B - 12) { it.y = ARENA_B - 12; it.vy = -Math.abs(it.vy); }

          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            const m = mags[i];
            if (Math.hypot(m.x - it.x, m.y - it.y) < 26) {
              if (it.kind === 'coin') {
                if (matchOver) return false;
                scores[i] += 15;
                sound.pickup(100);
                vfx.burst(it.x, it.y, '#facc15', 10, 4);
                vfx.popup(it.x, it.y - 12, '+15', '#facc15', 13);
                rumble(i, 30, 0.3);
                if (scores[i] >= TARGET_SCORE) {
                  finishMatch(i);
                }
              } else {
                scores[i] = Math.max(0, scores[i] - 25);
                m.flash = 12;
                const ang = Math.atan2(m.y - it.y, m.x - it.x);
                m.vx = Math.cos(ang) * 9.5;
                m.vy = Math.sin(ang) * 9.5;
                sound.explosion();
                vfx.hitstop(2);
                vfx.shake(9);
                vfx.flash('#fb7185', 0.22);
                vfx.ring(it.x, it.y, '#fb7185', 82, 4);
                vfx.burst(it.x, it.y, '#fb7185', 22, 6);
                vfx.popup(m.x, m.y - 20, 'BOOM -25', '#fb7185', 14);
                rumble(i, 160, 0.95);
              }
              return false;
            }
          }
          return true;
        });

        if (!matchOver && roundTimer <= 0) {
          const winner = [0, 1, 2, 3]
            .filter((idx) => active[idx].enabled)
            .sort((a, b) => scores[b] - scores[a])[0] ?? 0;
          finishMatch(winner);
        }
      }

      function finishMatch(winner: number) {
        if (matchOver) return; // several coins can land on the same frame
        matchOver = true;
        bannerTitle = `${active[winner].name} IS MAGNET ACE!`;
        bannerSub = `FINAL SCORE: ${scores[winner]} PTS`;
        bannerColor = active[winner].color;
        bannerTimer = 140;
        sound.win();
        vfx.flash(active[winner].color, 0.3);
        vfx.confetti(GAME_WIDTH / 2, 220, 65);
        vfx.confetti(mags[winner].x, mags[winner].y, 30);
        rumble(winner, 200, 0.85);
      }

      // Render
      drawArcadeBackdrop(ctx, '#38bdf8');

      // Rich animated concentric magnetic polarity waves (+ cyan attract / - magenta repel)
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const m = mags[i];
        if (m.mode !== 'idle') {
          const isAttract = m.mode === 'attract';
          const col = isAttract ? '#38bdf8' : '#e879f9';
          const maxR = 168;
          ctx.save();
          // Radial translucent polarity glow
          const grad = ctx.createRadialGradient(m.x, m.y, 18, m.x, m.y, maxR);
          grad.addColorStop(0, isAttract ? 'rgba(56, 189, 248, 0.26)' : 'rgba(232, 121, 249, 0.26)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(m.x, m.y, maxR, 0, Math.PI * 2);
          ctx.fill();

          // Rotating outer polarity boundary
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1.8;
          ctx.setLineDash([8, 8]);
          ctx.lineDashOffset = frame * (isAttract ? 1.8 : -1.8);
          ctx.beginPath();
          ctx.arc(m.x, m.y, maxR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);

          // 4 animated concentric polarity waves
          const phase = (frame * (isAttract ? -0.045 : 0.045)) % 1;
          for (let rIdx = 0; rIdx < 4; rIdx++) {
            const t = (rIdx / 4 + phase + 1) % 1;
            const rad = 26 + t * (maxR - 26);
            // (no shadowBlur here: blurred strokes on 170px circles x4 magnets were the
            // single most expensive thing in this scene)
            ctx.strokeStyle = col;
            ctx.globalAlpha = Math.sin(t * Math.PI) * 0.65;
            ctx.lineWidth = isAttract ? 2.6 - t * 1.1 : 1.5 + t * 1.4;
            ctx.beginPath();
            ctx.arc(m.x, m.y, rad, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Crisp polarity emblem (+ / -)
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = '#0f172a';
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(m.x, m.y - 26, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = col;
          ctx.font = '900 13px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(isAttract ? '+' : '−', m.x, m.y - 21.5);
          ctx.restore();
        }
      }

      // Items
      for (const it of items) {
        ctx.save();
        // Additive halo per item instead of shadowBlur
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = it.kind === 'coin' ? '#facc15' : '#fb7185';
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.kind === 'coin' ? 17 : 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        if (it.kind === 'coin') {
          ctx.fillStyle = '#facc15';
          ctx.beginPath();
          ctx.arc(it.x, it.y, 9, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = '#fb7185';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(it.x, it.y, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fb7185';
          ctx.font = '800 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('!', it.x, it.y + 4);
        }
        ctx.restore();
      }

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => scores[b] - scores[a])[0];

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const m = mags[i];
        drawPlayerOrb(ctx, m.x, m.y, 16, active[i].color, i, {
          angle: m.angle,
          leader: i === leaderIdx && scores[i] > 0,
          flash: m.flash > 0,
          shield: m.mode !== 'idle',
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      const pills: ScorePillData[] = [0, 1, 2, 3].map((s) => ({
        slot: s,
        name: active[s].name,
        color: active[s].color,
        active: active[s].enabled,
        valueText: `${scores[s]}/${TARGET_SCORE}`,
        highlight: s === leaderIdx && scores[s] > 0,
      }));
      drawTopScoreboard(
        ctx,
        pills,
        `TIME ${Math.ceil(roundTimer / 60)}s · A: ATTRACT COINS · B: REPEL BOMBS`,
      );

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 58. NEON SNAKE PONG (4-Wall Snake Paddles Deflecting 2 Energy Balls!)
export function createNeonSnakePongEngine(): MiniGameEngine {
  const LEFT = 130;
  const RIGHT = GAME_WIDTH - 130;
  const TOP = 86;
  const BOTTOM = GAME_HEIGHT - 44;
  const MID_X = (LEFT + RIGHT) / 2;
  const MID_Y = (TOP + BOTTOM) / 2;
  const ROUND_FRAMES = 50 * 60;

  // Slot 0 = Left wall, Slot 1 = Right wall, Slot 2 = Top wall, Slot 3 = Bottom wall
  const scores = [0, 0, 0, 0];
  let roundTimer = ROUND_FRAMES;
  let bannerTimer = 70;
  let bannerTitle = 'NEON SNAKE PONG';
  let bannerSub = 'STEER SNAKE PADDLE · GRAB ORBS TO GROW LONGER · DEFEND YOUR WALL!';
  let bannerColor = '#2ee59d';
  let matchOver = false;

  const snakes = [0, 1, 2, 3].map((i) => {
    const startX = i === 0 ? LEFT + 26 : i === 1 ? RIGHT - 26 : MID_X;
    const startY = i === 2 ? TOP + 24 : i === 3 ? BOTTOM - 24 : MID_Y;
    return {
      headX: startX,
      headY: startY,
      length: 6,
      trail: Array.from({ length: 14 }, () => ({ x: startX, y: startY })),
      flash: 0,
    };
  });

  const balls = [0, 1].map((idx) => ({
    x: MID_X + (idx === 0 ? -40 : 40),
    y: MID_Y,
    vx: idx === 0 ? 4.4 : -4.4,
    vy: idx === 0 ? 3.2 : -3.2,
    lastHit: -1,
    rally: 0,
    hitCd: 0,
  }));

  let growOrb = { x: MID_X, y: MID_Y, active: true };
  // Per-bot interception error (re-rolled on every deflect) so CPU snakes are beatable
  const botAimErr = [0, 0, 0, 0];

  // Relaunch from center on a diagonal-ish heading (never near-axis, which used to let a
  // ball shuttle between two walls forever without reaching the others)
  function launchBall(b: (typeof balls)[number], speed: number) {
    const quadrant = Math.floor(Math.random() * 4);
    const ang = Math.PI / 4 + quadrant * (Math.PI / 2) + (Math.random() - 0.5) * 0.7;
    b.x = MID_X;
    b.y = MID_Y;
    b.vx = Math.cos(ang) * speed;
    b.vy = Math.sin(ang) * speed;
    b.lastHit = -1;
    b.rally = 0;
    b.hitCd = 0;
  }

  function resetAll() {
    scores.fill(0);
    roundTimer = ROUND_FRAMES;
    for (let i = 0; i < 4; i++) {
      const startX = i === 0 ? LEFT + 26 : i === 1 ? RIGHT - 26 : MID_X;
      const startY = i === 2 ? TOP + 24 : i === 3 ? BOTTOM - 24 : MID_Y;
      snakes[i].headX = startX;
      snakes[i].headY = startY;
      snakes[i].length = 6;
      snakes[i].trail = Array.from({ length: 14 }, () => ({ x: startX, y: startY }));
    }
    balls[0] = { x: MID_X - 40, y: MID_Y, vx: 4.4, vy: 3.2, lastHit: -1, rally: 0, hitCd: 0 };
    balls[1] = { x: MID_X + 40, y: MID_Y, vx: -4.4, vy: -3.2, lastHit: -1, rally: 0, hitCd: 0 };
  }

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      if (bannerTimer > 0) {
        bannerTimer--;
        if (bannerTimer === 0 && matchOver) {
          matchOver = false;
          resetAll();
        }
      }

      if (bannerTimer <= 10 && !matchOver) {
        roundTimer = Math.max(0, roundTimer - 1);

        // Move snakes along their wall lane
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const sn = snakes[i];
          if (sn.flash > 0) sn.flash--;

          const isVert = i < 2;
          let ix = 0;
          let iy = 0;
          let boost = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            boost = inp.actionA;
          } else {
            // Bot tracks nearest approaching ball
            let targetBall = balls[0];
            let bestScore = -9999;
            for (const b of balls) {
              const approaching =
                (i === 0 && b.vx < 0) ||
                (i === 1 && b.vx > 0) ||
                (i === 2 && b.vy < 0) ||
                (i === 3 && b.vy > 0);
              const d = Math.hypot(b.x - sn.headX, b.y - sn.headY);
              const val = (approaching ? 300 : 0) - d;
              if (val > bestScore) {
                bestScore = val;
                targetBall = b;
              }
            }
            if (isVert) {
              iy = Math.max(-0.95, Math.min(0.95, (targetBall.y + botAimErr[i] - sn.headY) * 0.04));
              ix = ((i === 0 ? LEFT + 30 : RIGHT - 30) - sn.headX) * 0.05;
            } else {
              ix = Math.max(-0.95, Math.min(0.95, (targetBall.x + botAimErr[i] - sn.headX) * 0.04));
              iy = ((i === 2 ? TOP + 28 : BOTTOM - 28) - sn.headY) * 0.05;
            }
          }

          const spd = boost ? 7.2 : 5.0;
          sn.headX += ix * spd;
          sn.headY += iy * spd;

          if (boost && Math.hypot(ix, iy) > 0.15 && frame % 2 === 0) {
            vfx.afterimage(sn.headX, sn.headY, 13, active[i].color, 8);
          }

          // Keep each snake within its defensive border zone
          if (i === 0) {
            sn.headX = Math.max(LEFT + 14, Math.min(LEFT + 95, sn.headX));
            sn.headY = Math.max(TOP + 16, Math.min(BOTTOM - 16, sn.headY));
          } else if (i === 1) {
            sn.headX = Math.max(RIGHT - 95, Math.min(RIGHT - 14, sn.headX));
            sn.headY = Math.max(TOP + 16, Math.min(BOTTOM - 16, sn.headY));
          } else if (i === 2) {
            sn.headX = Math.max(LEFT + 16, Math.min(RIGHT - 16, sn.headX));
            sn.headY = Math.max(TOP + 14, Math.min(TOP + 80, sn.headY));
          } else {
            sn.headX = Math.max(LEFT + 16, Math.min(RIGHT - 16, sn.headX));
            sn.headY = Math.max(BOTTOM - 80, Math.min(BOTTOM - 14, sn.headY));
          }

          // Update trail segments smoothly
          sn.trail[0].x = sn.headX;
          sn.trail[0].y = sn.headY;
          for (let seg = 1; seg < sn.trail.length; seg++) {
            const prev = sn.trail[seg - 1];
            const cur = sn.trail[seg];
            const dx = prev.x - cur.x;
            const dy = prev.y - cur.y;
            const d = Math.hypot(dx, dy);
            if (d > 11) {
              cur.x += (dx / d) * (d - 11);
              cur.y += (dy / d) * (d - 11);
            }
          }
        }

        // Update energy balls
        for (const b of balls) {
          if (b.hitCd > 0) b.hitCd--;
          b.x += b.vx;
          b.y += b.vy;
          const ballSpeed = Math.hypot(b.vx, b.vy);
          const ballCol = b.lastHit >= 0 ? active[b.lastHit].color : '#38bdf8';

          if (frame % 2 === 0) {
            vfx.spark(b.x, b.y, 0, 0, ballCol, 3);
            if (ballSpeed > 5.6) {
              vfx.afterimage(b.x, b.y, 9.5, ballCol, 9);
            }
          }

          // Check snake segment deflection. A ball only deflects while heading toward that
          // snake's wall and not within a short cooldown — previously a ball skimming along a
          // snake re-triggered every frame, farming rally points and speed-ups.
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || b.hitCd > 0) continue;
            const approaching =
              (i === 0 && b.vx < 0) || (i === 1 && b.vx > 0) || (i === 2 && b.vy < 0) || (i === 3 && b.vy > 0);
            if (!approaching) continue;
            const sn = snakes[i];
            const activeSegs = Math.min(sn.trail.length, sn.length);
            let deflected = false;
            for (let sIdx = 0; sIdx < activeSegs; sIdx++) {
              const seg = sn.trail[sIdx];
              if (Math.hypot(b.x - seg.x, b.y - seg.y) < 19) {
                // Reflect, guaranteeing a real outward component so it can't skim the snake
                if (i === 0) b.vx = Math.max(2.6, Math.abs(b.vx) * 1.05);
                else if (i === 1) b.vx = -Math.max(2.6, Math.abs(b.vx) * 1.05);
                else if (i === 2) b.vy = Math.max(2.6, Math.abs(b.vy) * 1.05);
                else b.vy = -Math.max(2.6, Math.abs(b.vy) * 1.05);
                // Snake-paddle english: where it hits along the body nudges the angle
                if (i < 2) b.vy += Math.max(-1.8, Math.min(1.8, (b.y - seg.y) * 0.08));
                else b.vx += Math.max(-1.8, Math.min(1.8, (b.x - seg.x) * 0.08));
                b.hitCd = 8;
                for (let k = 0; k < 4; k++) botAimErr[k] = (Math.random() - 0.5) * 34;

                // Clamp max ball speed
                const spd = Math.hypot(b.vx, b.vy);
                if (spd > 8.5) {
                  b.vx = (b.vx / spd) * 8.5;
                  b.vy = (b.vy / spd) * 8.5;
                }

                b.x += b.vx * 1.5;
                b.y += b.vy * 1.5;
                b.lastHit = i;
                b.rally++;
                sn.flash = 6;
                const rallyPts = 10 + Math.min(15, (b.rally - 1) * 2);
                scores[i] += rallyPts;
                sound.combo(Math.min(10, b.rally));
                vfx.bolt(seg.x, seg.y, b.x, b.y, active[i].color);
                if (sIdx > 0) {
                  vfx.bolt(sn.trail[0].x, sn.trail[0].y, seg.x, seg.y, '#ffffff');
                }
                vfx.ring(seg.x, seg.y, active[i].color, 44, 3);
                vfx.burst(seg.x, seg.y, active[i].color, 12, 4.4);
                vfx.popup(
                  seg.x,
                  seg.y - 16,
                  b.rally >= 2 ? `RALLY x${b.rally} +${rallyPts}` : `DEFLECT +${rallyPts}`,
                  active[i].color,
                  b.rally >= 3 ? 14 : 12,
                );
                rumble(i, 55, 0.5);
                deflected = true;
                break;
              }
            }
            if (deflected) break;
          }

          // Check wall goals / bounces
          const hitWall = (wallSlot: number) => {
            if (active[wallSlot].enabled) {
              scores[wallSlot] = Math.max(0, scores[wallSlot] - 10);
              if (b.lastHit >= 0 && b.lastHit !== wallSlot) {
                scores[b.lastHit] += 25;
                vfx.popup(b.x, b.y - 18, `GOAL +25!`, active[b.lastHit].color, 15);
                rumble(b.lastHit, 80, 0.55);
              } else {
                vfx.popup(b.x, b.y - 18, '-10', '#fb7185', 14);
              }
              sound.explosion();
              vfx.hitstop(2);
              vfx.shake(8);
              vfx.flash('#fb7185', 0.2);
              vfx.ring(b.x, b.y, '#fb7185', 75, 4);
              vfx.burst(b.x, b.y, '#fb7185', 18, 5.5);
              rumble(wallSlot, 150, 0.9);
              launchBall(b, 4.5);
            } else {
              sound.beep(320, 0.04, 'triangle', 0.05);
            }
          };

          if (b.x < LEFT + 8) {
            b.x = LEFT + 8;
            b.vx = Math.abs(b.vx);
            hitWall(0);
          } else if (b.x > RIGHT - 8) {
            b.x = RIGHT - 8;
            b.vx = -Math.abs(b.vx);
            hitWall(1);
          } else if (b.y < TOP + 8) {
            b.y = TOP + 8;
            b.vy = Math.abs(b.vy);
            hitWall(2);
          } else if (b.y > BOTTOM - 8) {
            b.y = BOTTOM - 8;
            b.vy = -Math.abs(b.vy);
            hitWall(3);
          }

          // Ball hits growth orb in center to extend last hitter's snake!
          if (growOrb.active && Math.hypot(b.x - growOrb.x, b.y - growOrb.y) < 22) {
            if (b.lastHit >= 0) {
              snakes[b.lastHit].length = Math.min(14, snakes[b.lastHit].length + 2);
              scores[b.lastHit] += 15;
              sound.pickup(140);
              vfx.ring(growOrb.x, growOrb.y, '#facc15', 46, 2.5);
              vfx.popup(growOrb.x, growOrb.y - 14, 'SNAKE GROW +15!', active[b.lastHit].color, 13);
            }
            growOrb.x = LEFT + 140 + Math.random() * (RIGHT - LEFT - 280);
            growOrb.y = TOP + 100 + Math.random() * (BOTTOM - TOP - 200);
          }
        }

        if (roundTimer <= 0) {
          const winner = [0, 1, 2, 3]
            .filter((idx) => active[idx].enabled)
            .sort((a, b) => scores[b] - scores[a])[0] ?? 0;
          matchOver = true;
          bannerTitle = `${active[winner].name} IS SNAKE PONG PRO!`;
          bannerSub = `FINAL SCORE: ${scores[winner]} PTS`;
          bannerColor = active[winner].color;
          bannerTimer = 140;
          sound.win();
          vfx.flash(active[winner].color, 0.3);
          vfx.confetti(MID_X, MID_Y, 65);
          vfx.confetti(snakes[winner].headX, snakes[winner].headY, 30);
          rumble(winner, 200, 0.85);
        }
      }

      // Render
      drawArcadeBackdrop(ctx, '#2ee59d');

      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
      ctx.strokeStyle = 'rgba(46, 229, 157, 0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(LEFT, TOP, RIGHT - LEFT, BOTTOM - TOP, 12);
      ctx.fill();
      ctx.stroke();

      // Side goal glow lines
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        ctx.strokeStyle = active[i].color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        if (i === 0) { ctx.moveTo(LEFT, TOP + 16); ctx.lineTo(LEFT, BOTTOM - 16); }
        if (i === 1) { ctx.moveTo(RIGHT, TOP + 16); ctx.lineTo(RIGHT, BOTTOM - 16); }
        if (i === 2) { ctx.moveTo(LEFT + 16, TOP); ctx.lineTo(RIGHT - 16, TOP); }
        if (i === 3) { ctx.moveTo(LEFT + 16, BOTTOM); ctx.lineTo(RIGHT - 16, BOTTOM); }
        ctx.stroke();
      }
      ctx.restore();

      const maxRally = Math.max(balls[0].rally, balls[1].rally);
      if (maxRally >= 3) {
        ctx.save();
        ctx.globalAlpha = 0.28 + Math.sin(frame * 0.25) * 0.08;
        ctx.fillStyle = '#facc15';
        ctx.font = '900 28px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`RALLY x${maxRally}`, MID_X, MID_Y + 10);
        ctx.restore();
      }

      // Growth orb
      if (growOrb.active) {
        ctx.save();
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(growOrb.x, growOrb.y, 10 + Math.sin(frame * 0.14) * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => scores[b] - scores[a])[0];

      // Snakes
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const sn = snakes[i];
        const count = Math.min(sn.trail.length, sn.length);
        for (let sIdx = count - 1; sIdx >= 1; sIdx--) {
          const seg = sn.trail[sIdx];
          const rad = 11 - (sIdx / count) * 4;
          ctx.save();
          ctx.fillStyle = sn.flash > 0 ? '#ffffff' : active[i].color;
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(seg.x, seg.y, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        drawPlayerOrb(ctx, sn.headX, sn.headY, 13, active[i].color, i, {
          leader: i === leaderIdx && scores[i] > 0,
          flash: sn.flash > 0,
        });
      }

      // Energy balls
      for (const b of balls) {
        ctx.save();
        const col = b.lastHit >= 0 ? active[b.lastHit].color : '#38bdf8';
        ctx.shadowColor = col;
        ctx.shadowBlur = 18;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 9.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      const pills: ScorePillData[] = [0, 1, 2, 3].map((s) => ({
        slot: s,
        name: active[s].name,
        color: active[s].color,
        active: active[s].enabled,
        valueText: `${scores[s]} PTS`,
        highlight: s === leaderIdx && scores[s] > 0,
      }));
      drawTopScoreboard(
        ctx,
        pills,
        `TIME ${Math.ceil(roundTimer / 60)}s · STEER SNAKE PADDLE · A: SPEED BOOST`,
      );

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 59. METEOR STRIKE CO-OP (Defend 4 City Shield Generators with Plasma Turrets & EMP!)
export function createMeteorStrikeCoopEngine(): MiniGameEngine {
  const ROUND_FRAMES = 55 * 60;
  const scores = [0, 0, 0, 0];
  const killChain = [0, 0, 0, 0];
  const killChainTimer = [0, 0, 0, 0];
  let roundTimer = ROUND_FRAMES;
  let bannerTimer = 75;
  let bannerTitle = 'METEOR STRIKE CO-OP';
  let bannerSub = 'STICK: MOVE & AIM · A: RAPID FIRE · B: EMP SHOCKWAVE · SAVE THE CITY!';
  let bannerColor = '#ff6b2b';
  let matchOver = false;
  const prevB = [false, false, false, false];

  const generators = [0, 1, 2, 3].map((i) => ({
    x: 165 + i * 210,
    y: 472,
    hp: 100,
    flash: 0,
  }));

  const turrets = [0, 1, 2, 3].map((i) => ({
    x: 165 + i * 210,
    y: 405,
    aimAngle: -Math.PI / 2,
    fireCd: 0,
    empCd: 0,
    flash: 0,
  }));

  interface Bullet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    owner: number;
    color: string;
  }

  interface Meteor {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    hp: number;
    maxHp: number;
    boss: boolean;
  }

  interface EmpWave {
    x: number;
    y: number;
    r: number;
    maxR: number;
    color: string;
  }

  let bullets: Bullet[] = [];
  let meteors: Meteor[] = [];
  let empWaves: EmpWave[] = [];
  let spawnTimer = 35;

  function resetAll() {
    scores.fill(0);
    killChain.fill(0);
    killChainTimer.fill(0);
    roundTimer = ROUND_FRAMES;
    bullets = [];
    meteors = [];
    empWaves = [];
    spawnTimer = 30;
    for (let i = 0; i < 4; i++) {
      generators[i].hp = 100;
      generators[i].flash = 0;
      turrets[i].x = 165 + i * 210;
      turrets[i].y = 405;
      turrets[i].aimAngle = -Math.PI / 2;
      turrets[i].fireCd = 0;
      turrets[i].empCd = 0;
    }
  }

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      if (bannerTimer > 0) {
        bannerTimer--;
        if (bannerTimer === 0 && matchOver) {
          matchOver = false;
          resetAll();
        }
      }

      const awardMeteorKill = (owner: number, m: Meteor, isEmp: boolean) => {
        killChain[owner]++;
        killChainTimer[owner] = 150;
        const chainBonus = Math.min(20, (killChain[owner] - 1) * 5);
        const basePts = m.boss ? (isEmp ? 50 : 60) : 15;
        const totalPts = basePts + chainBonus;
        scores[owner] += totalPts;
        sound.combo(Math.min(10, killChain[owner]));
        vfx.burst(m.x, m.y, m.boss ? '#facc15' : '#ff6b2b', m.boss ? 28 : 14, m.boss ? 6.5 : 5);
        const label =
          killChain[owner] >= 3
            ? `${isEmp ? 'EMP ' : ''}+${totalPts} x${killChain[owner]}!`
            : `${isEmp ? 'EMP ' : ''}+${totalPts}`;
        vfx.popup(m.x, m.y, label, m.boss ? '#facc15' : active[owner].color, m.boss ? 17 : 13);
        if (m.boss) {
          sound.explosion();
          vfx.hitstop(3);
          vfx.shake(10);
          vfx.flash('#facc15', 0.24);
          vfx.ring(m.x, m.y, '#facc15', 96, 4.5);
          vfx.ring(m.x, m.y, '#ffffff', 62, 2.5);
          for (let p = 0; p < 4; p++) {
            if (active[p].enabled) rumble(p, 150, 0.88);
          }
        } else {
          sound.explosion();
        }
      };

      if (bannerTimer <= 10 && !matchOver) {
        roundTimer = Math.max(0, roundTimer - 1);
        const progress = 1 - roundTimer / ROUND_FRAMES;

        // Step expanding EMP waves & leave glowing afterimage nodes along the shockwave rim
        empWaves = empWaves.filter((w) => {
          w.r += 11;
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2 + w.r * 0.02;
            vfx.afterimage(w.x + Math.cos(ang) * w.r, w.y + Math.sin(ang) * w.r, 8, w.color, 7);
          }
          return w.r < w.maxR;
        });

        // Spawn meteors & periodic Boss Comets
        spawnTimer--;
        if (spawnTimer <= 0) {
          const isBoss = Math.random() < 0.14 + progress * 0.12;
          // Pick a random surviving generator (it used to always pick the leftmost alive one,
          // so every meteor in the wave converged on a single target)
          const aliveGens = generators.filter((g) => g.hp > 0);
          const targetGen =
            aliveGens[Math.floor(Math.random() * aliveGens.length)] ?? generators[0];
          const mx = 75 + Math.random() * (GAME_WIDTH - 150);
          const tx = targetGen.x + (Math.random() - 0.5) * 140;
          const ang = Math.atan2(470 - 80, tx - mx);
          const spd = (isBoss ? 1.35 : 2.1) + progress * 1.4;
          meteors.push({
            x: mx,
            y: 80,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            r: isBoss ? 28 : 15,
            hp: isBoss ? 6 : 2,
            maxHp: isBoss ? 6 : 2,
            boss: isBoss,
          });
          // Fewer defenders (e.g. solo with bots off) -> proportionally slower meteor rain
          let crew = 0;
          for (let p = 0; p < 4; p++) if (active[p].enabled) crew++;
          const crewScale = Math.sqrt(4 / Math.max(1, crew));
          spawnTimer = Math.round(Math.max(18, 44 - Math.floor(progress * 22)) * crewScale);
        }

        // Players move & fire
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const t = turrets[i];
          if (t.fireCd > 0) t.fireCd--;
          if (t.empCd > 0) t.empCd--;
          if (t.flash > 0) t.flash--;
          if (killChainTimer[i] > 0) {
            killChainTimer[i]--;
            if (killChainTimer[i] === 0) killChain[i] = 0;
          }

          let ix = 0;
          let iy = 0;
          let fire = false;
          let emp = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            fire = inp.actionA;
            emp = inp.actionB && !prevB[i];
            prevB[i] = inp.actionB;
          } else {
            // Bot defends its own sector first: lowest meteor, weighted by horizontal
            // distance so the four turrets spread out instead of all chasing one rock
            let lowest: Meteor | null = null;
            let bestVal = -1e9;
            for (const m of meteors) {
              const val = m.y - Math.abs(m.x - generators[i].x) * 0.45 + (m.boss ? 40 : 0);
              if (val > bestVal) {
                bestVal = val;
                lowest = m;
              }
            }
            if (lowest) {
              const targetX = lowest.x;
              ix = Math.max(-0.85, Math.min(0.85, (targetX - t.x) * 0.02));
              iy = Math.max(-0.5, Math.min(0.5, (385 - t.y) * 0.02));
              t.aimAngle = Math.atan2(lowest.y - t.y, lowest.x - t.x);
              if (t.fireCd === 0) fire = true;
              if (lowest.y > 350 && Math.hypot(lowest.x - t.x, lowest.y - t.y) < 130 && t.empCd === 0) {
                emp = true;
              }
            }
          }

          t.x = Math.max(54, Math.min(GAME_WIDTH - 54, t.x + ix * 4.6));
          t.y = Math.max(190, Math.min(435, t.y + iy * 3.8));
          if (active[i].isHuman && Math.hypot(ix, iy) > 0.15) {
            t.aimAngle = Math.atan2(iy, ix);
            // Bias slightly upward if holding straight horizontal
            if (iy > 0.5) t.aimAngle = Math.atan2(iy, ix);
          }

          if (fire && t.fireCd === 0) {
            t.fireCd = 10;
            const aim = active[i].isHuman && Math.hypot(ix, iy) < 0.2 ? -Math.PI / 2 : t.aimAngle;
            bullets.push({
              x: t.x + Math.cos(aim) * 18,
              y: t.y + Math.sin(aim) * 18,
              vx: Math.cos(aim) * 10.5,
              vy: Math.sin(aim) * 10.5,
              owner: i,
              color: active[i].color,
            });
            sound.beep(720, 0.03, 'triangle', 0.04);
            vfx.spark(t.x + Math.cos(aim) * 20, t.y + Math.sin(aim) * 20, Math.cos(aim) * 2, Math.sin(aim) * 2, '#ffffff', 2.5);
          }

          if (emp && t.empCd === 0) {
            t.empCd = 180;
            sound.explosion();
            vfx.hitstop(2);
            vfx.shake(7);
            vfx.flash('#38bdf8', 0.2);
            vfx.ring(t.x, t.y, '#38bdf8', 165, 4.5);
            vfx.ring(t.x, t.y, '#ffffff', 110, 2.5);
            vfx.burst(t.x, t.y, '#38bdf8', 20, 5.5);
            empWaves.push({ x: t.x, y: t.y, r: 24, maxR: 168, color: '#38bdf8' });
            rumble(i, 110, 0.78);
            for (let mi = meteors.length - 1; mi >= 0; mi--) {
              const m = meteors[mi];
              if (Math.hypot(m.x - t.x, m.y - t.y) < 165) {
                m.hp -= 3;
                vfx.bolt(t.x, t.y, m.x, m.y, '#38bdf8');
                if (m.hp <= 0) {
                  awardMeteorKill(i, m, true);
                  meteors.splice(mi, 1);
                }
              }
            }
          }
        }

        // Update bullets
        bullets = bullets.filter((b) => {
          b.x += b.vx;
          b.y += b.vy;
          for (let mi = meteors.length - 1; mi >= 0; mi--) {
            const m = meteors[mi];
            if (Math.hypot(b.x - m.x, b.y - m.y) < m.r + 6) {
              m.hp--;
              vfx.spark(b.x, b.y, 0, 0, b.color, 3.5);
              if (m.hp <= 0) {
                awardMeteorKill(b.owner, m, false);
                meteors.splice(mi, 1);
              } else {
                sound.hit();
              }
              return false;
            }
          }
          return b.x > 30 && b.x < GAME_WIDTH - 30 && b.y > 70 && b.y < 490;
        });

        // Update meteors
        meteors = meteors.filter((m) => {
          m.x += m.vx;
          m.y += m.vy;
          if (m.boss && frame % 2 === 0) {
            vfx.afterimage(m.x, m.y, m.r * 0.92, frame % 4 === 0 ? '#facc15' : '#ff6b2b', 11);
          }
          if (frame % 3 === 0) {
            vfx.spark(m.x, m.y - m.r * 0.5, (Math.random() - 0.5) * 1.2, -1.5, m.boss ? '#facc15' : '#ff6b2b', m.boss ? 4 : 3);
          }

          if (m.y >= 460) {
            // Impact nearest generator!
            let nearest = generators[0];
            let bestD = 9999;
            for (const g of generators) {
              const d = Math.abs(g.x - m.x);
              if (d < bestD) {
                bestD = d;
                nearest = g;
              }
            }
            if (bestD < 110 && nearest.hp > 0) {
              const dmg = m.boss ? 35 : 18;
              nearest.hp = Math.max(0, nearest.hp - dmg);
              nearest.flash = 14;
              vfx.ring(nearest.x, nearest.y - 12, '#fb7185', 75, 3.5);
              vfx.popup(nearest.x, nearest.y - 70, `SHIELD -${dmg}`, '#fb7185', 13);
              if (nearest.hp === 0) {
                // Generator destroyed
                vfx.hitstop(4);
                vfx.flash('#fb7185', 0.3);
                vfx.ring(nearest.x, nearest.y, '#fb7185', 140, 5);
                vfx.burst(nearest.x, nearest.y - 10, '#facc15', 30, 7, 4, 0.18);
                vfx.popup(nearest.x, nearest.y - 92, 'GENERATOR DOWN!', '#fb7185', 16);
              }
              for (let p = 0; p < 4; p++) {
                if (active[p].enabled) rumble(p, nearest.hp === 0 ? 220 : 110, nearest.hp === 0 ? 1 : 0.7);
              }
            }
            sound.explosion();
            vfx.shake(8);
            vfx.burst(m.x, m.y, '#fb7185', 18, 5);
            return false;
          }
          return true;
        });

        const totalCityHp = generators.reduce((acc, g) => acc + g.hp, 0);
        if (totalCityHp <= 0) {
          matchOver = true;
          bannerTitle = 'CITY SHIELDS DESTROYED!';
          bannerSub = `SURVIVED ${Math.floor((ROUND_FRAMES - roundTimer) / 60)}s · TRY AGAIN!`;
          bannerColor = '#fb7185';
          bannerTimer = 130;
          sound.explosion();
          vfx.shake(14);
          vfx.flash('#fb7185', 0.4);
        } else if (roundTimer <= 0) {
          const mvp = [0, 1, 2, 3]
            .filter((idx) => active[idx].enabled)
            .sort((a, b) => scores[b] - scores[a])[0] ?? 0;
          matchOver = true;
          bannerTitle = 'CITY SAVED! CO-OP VICTORY!';
          bannerSub = `MVP: ${active[mvp].name} (${scores[mvp]} PTS)`;
          bannerColor = '#2ee59d';
          bannerTimer = 140;
          sound.win();
          vfx.flash('#2ee59d', 0.3);
          vfx.confetti(GAME_WIDTH / 2, 220, 75);
          vfx.confetti(180, 260, 35);
          vfx.confetti(GAME_WIDTH - 180, 260, 35);
          for (let p = 0; p < 4; p++) {
            if (active[p].enabled) rumble(p, 200, 0.8);
          }
        }
      }

      // Render
      drawArcadeBackdrop(ctx, '#ff6b2b');

      // City Shield Generators + Glowing Dome Shield Arcs along bottom
      for (const g of generators) {
        if (g.flash > 0) g.flash--;
        ctx.save();
        if (g.hp > 0) {
          const hpRatio = g.hp / 100;
          const domeCol =
            g.flash > 0 ? '#ffffff' : g.hp > 60 ? '#2ee59d' : g.hp > 30 ? '#facc15' : '#fb7185';
          const domeR = 58;
          const pulse = 0.85 + Math.sin(frame * 0.1 + g.x * 0.01) * 0.15;
          const domeGrad = ctx.createRadialGradient(g.x, g.y - 4, 8, g.x, g.y - 4, domeR);
          domeGrad.addColorStop(0, 'rgba(56, 189, 248, 0.03)');
          domeGrad.addColorStop(
            1,
            g.flash > 0
              ? 'rgba(255, 255, 255, 0.42)'
              : g.hp > 60
                ? 'rgba(46, 229, 157, 0.24)'
                : g.hp > 30
                  ? 'rgba(250, 204, 21, 0.24)'
                  : 'rgba(251, 113, 133, 0.30)',
          );
          ctx.fillStyle = domeGrad;
          ctx.beginPath();
          ctx.arc(g.x, g.y - 4, domeR, Math.PI, 0);
          ctx.closePath();
          ctx.fill();

          // Outer glowing shield arc
          ctx.shadowColor = domeCol;
          ctx.shadowBlur = g.flash > 0 ? 22 : 14;
          ctx.strokeStyle = domeCol;
          ctx.globalAlpha = (0.35 + hpRatio * 0.55) * pulse;
          ctx.lineWidth = g.flash > 0 ? 4 : 3;
          ctx.beginPath();
          ctx.arc(g.x, g.y - 4, domeR, Math.PI, 0);
          ctx.stroke();

          // Inner dashed energy rib arc
          ctx.shadowBlur = 0;
          ctx.lineWidth = 1.4;
          ctx.globalAlpha = 0.32 * hpRatio;
          ctx.setLineDash([7, 7]);
          ctx.lineDashOffset = -frame * 0.6;
          ctx.beginPath();
          ctx.arc(g.x, g.y - 4, domeR - 10, Math.PI + 0.15, -0.15);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }

        ctx.fillStyle = g.hp > 0 ? (g.flash > 0 ? '#ffffff' : '#1e293b') : '#0f172a';
        ctx.strokeStyle = g.hp > 35 ? '#2ee59d' : g.hp > 0 ? '#facc15' : '#475569';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(g.x - 42, g.y - 12, 84, 24, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = g.hp > 35 ? '#2ee59d' : '#fb7185';
        ctx.fillRect(g.x - 36, g.y - 4, (72 * g.hp) / 100, 8);
        ctx.restore();
      }

      // Active EMP shockwaves
      for (const w of empWaves) {
        ctx.save();
        ctx.shadowColor = w.color;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = w.color;
        ctx.globalAlpha = Math.max(0, 1 - w.r / w.maxR) * 0.85;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Meteors
      for (const m of meteors) {
        ctx.save();
        if (m.boss) {
          // Hero element: keep the real glow
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 22;
        } else {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = '#ff6b2b';
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.r + 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = m.boss ? '#7c2d12' : '#451a03';
        ctx.strokeStyle = m.boss ? '#facc15' : '#ff6b2b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (m.boss) {
          ctx.fillStyle = '#facc15';
          ctx.font = '800 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${m.hp}`, m.x, m.y + 4);
        }
        ctx.restore();
      }

      // Bullets
      // Bullets: one additive pass, no per-bullet shadowBlur / save-restore
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const b of bullets) {
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => scores[b] - scores[a])[0];

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const t = turrets[i];
        drawPlayerOrb(ctx, t.x, t.y, 15, active[i].color, i, {
          angle: t.aimAngle,
          leader: i === leaderIdx && scores[i] > 0,
          flash: t.flash > 0,
          cooldownPct: t.empCd / 180,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      const cityPct = Math.round(generators.reduce((a, g) => a + g.hp, 0) / 4);
      const pills: ScorePillData[] = [0, 1, 2, 3].map((s) => ({
        slot: s,
        name: active[s].name,
        color: active[s].color,
        active: active[s].enabled,
        valueText: `${scores[s]} PTS`,
        highlight: s === leaderIdx && scores[s] > 0,
      }));
      drawTopScoreboard(
        ctx,
        pills,
        `WAVE TIME ${Math.ceil(roundTimer / 60)}s · CITY SHIELDS ${cityPct}% · A: FIRE · B: EMP`,
      );

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 60. GRAND FINALE GAUNTLET (4 Rapid 15s Morphing Micro-Rounds!)
export function createGrandGauntletEngine(): MiniGameEngine {
  const STAGE_FRAMES = 15 * 60;
  const CX = GAME_WIDTH / 2;
  const CY = 288;

  type Stage = 0 | 1 | 2 | 3; // 0: Coin Frenzy, 1: Dodge Lasers, 2: Bumper Brawl, 3: Crown Hold
  const STAGE_NAMES = [
    'STAGE 1: COIN FRENZY!',
    'STAGE 2: LASER SPIN!',
    'STAGE 3: BUMPER BRAWL!',
    'STAGE 4: CROWN HOLD!',
  ];
  const STAGE_COLORS = ['#facc15', '#fb7185', '#ff6b2b', '#2ee59d'];

  const scores = [0, 0, 0, 0];
  let stage: Stage = 0;
  let stageTimer = STAGE_FRAMES;
  let bannerTimer = 70;
  let bannerTitle = STAGE_NAMES[0];
  let bannerSub = '4x15s MICRO-ROUNDS · A: DASH BURST · GRAND CHAMPION CROWNED!';
  let bannerColor = STAGE_COLORS[0];
  let matchOver = false;
  let transitionFanfareTimer = 0;
  let finaleConfettiTimer = 0;
  const prevA = [false, false, false, false];

  const fighters = [0, 1, 2, 3].map((i) => ({
    x: i % 2 === 0 ? 220 : GAME_WIDTH - 220,
    y: i < 2 ? 175 : 395,
    vx: 0,
    vy: 0,
    dashCd: 0,
    invuln: 0,
    flash: 0,
    angle: 0,
    ringOut: 0,
  }));

  let coins: Array<{ x: number; y: number; gold: boolean }> = [];
  let laserAngle = 0;
  // Laser arms now reach past the arena corners (they were 260px, so camping at the left
  // or right edge made Stage 2 risk-free). Dashing grants brief i-frames to cut through.
  const LASER_LEN = 520;
  const DASH_IFRAMES = 14;
  let crown = { x: CX, y: CY, holder: -1 };
  let crownLock = 0; // frames before the crown can change hands again
  // Bots only dash through ~70% of laser passes, rolled once per approach
  const botLaserDodge = [true, true, true, true];
  const botLaserPrevD = [Math.PI, Math.PI, Math.PI, Math.PI];

  function resetStage(newStage: Stage) {
    stage = newStage;
    stageTimer = STAGE_FRAMES;
    coins = [];
    crown = { x: CX, y: CY, holder: -1 };
    crownLock = 0;
    if (newStage === 1) laserAngle = 0; // start horizontal, clear of the spawn points
    for (let i = 0; i < 4; i++) {
      if (newStage === 2) {
        // Spawn INSIDE the 195px brawl ring. The old corner spawns sat ~243px from center,
        // so every fighter was instantly rung out (-15) the moment Stage 3 began.
        fighters[i].x = CX + (i % 2 === 0 ? -95 : 95);
        fighters[i].y = CY + (i < 2 ? -70 : 70);
      } else {
        fighters[i].x = i % 2 === 0 ? 260 : GAME_WIDTH - 260;
        fighters[i].y = i < 2 ? 185 : 385;
      }
      fighters[i].vx = 0;
      fighters[i].vy = 0;
      fighters[i].invuln = 30;
      fighters[i].ringOut = 0;
      botLaserPrevD[i] = Math.PI;
    }
    bannerTitle = STAGE_NAMES[newStage];
    bannerSub =
      newStage === 0
        ? 'GRAB CASCADE COINS!'
        : newStage === 1
          ? 'DODGE THE SWEEPING LASER · DASH THROUGH IT!'
          : newStage === 2
            ? 'RAM RIVALS OUT OF THE RING!'
            : 'STEAL & HOLD THE CROWN!';
    bannerColor = STAGE_COLORS[newStage];
    bannerTimer = 55;
  }

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      // Multi-note fanfare chimes during dramatic stage morphs
      if (transitionFanfareTimer > 0) {
        transitionFanfareTimer--;
        if (transitionFanfareTimer === 16) {
          sound.combo(stage + 5);
          vfx.ring(CX, CY, STAGE_COLORS[stage], 210, 3.5);
        } else if (transitionFanfareTimer === 6) {
          sound.combo(stage + 7);
          vfx.ring(CX, CY, '#ffffff', 130, 2.5);
        }
      }

      // Sustained championship confetti fireworks during finale victory banner
      if (finaleConfettiTimer > 0) {
        finaleConfettiTimer--;
        if (finaleConfettiTimer % 20 === 0) {
          const cx = 140 + Math.random() * (GAME_WIDTH - 280);
          const cy = 120 + Math.random() * 240;
          vfx.confetti(cx, cy, 32);
          vfx.ring(cx, cy, STAGE_COLORS[Math.floor(Math.random() * 4)], 85, 3);
          sound.combo(6 + (finaleConfettiTimer % 4));
        }
      }

      if (bannerTimer > 0) {
        bannerTimer--;
        if (bannerTimer === 0 && matchOver) {
          scores.fill(0);
          matchOver = false;
          finaleConfettiTimer = 0;
          resetStage(0);
        }
      }

      if (bannerTimer <= 10 && !matchOver) {
        stageTimer--;

        // Final 3-second morph countdown chimes
        if (stageTimer === 180 || stageTimer === 120 || stageTimer === 60) {
          sound.beep(stageTimer === 60 ? 880 : 620, 0.06, 'triangle', 0.07);
          vfx.ring(CX, CY, STAGE_COLORS[stage], 145, 2.5);
        }

        // Stage-specific world logic
        if (stage === 0) {
          while (coins.length < 10) {
            coins.push({
              x: 90 + Math.random() * (GAME_WIDTH - 180),
              y: 100 + Math.random() * (GAME_HEIGHT - 170),
              gold: Math.random() < 0.25,
            });
          }
        } else if (stage === 1) {
          laserAngle += 0.026;
        } else if (stage === 3 && crownLock > 0) {
          crownLock--;
        }

        const ringRadius = stage === 2 ? 195 : 999;

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const f = fighters[i];
          if (f.dashCd > 0) f.dashCd--;
          if (f.invuln > 0) f.invuln--;
          if (f.flash > 0) f.flash--;

          if (f.ringOut > 0) {
            f.ringOut--;
            if (f.ringOut === 0) {
              f.x = CX + (Math.random() - 0.5) * 140;
              f.y = CY + (Math.random() - 0.5) * 110;
              f.vx = 0;
              f.vy = 0;
              f.invuln = 35;
              vfx.ring(f.x, f.y, active[i].color, 36, 2);
            }
            continue;
          }

          let ix = 0;
          let iy = 0;
          let dash = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            dash = inp.actionA && !prevA[i];
            prevA[i] = inp.actionA;
          } else {
            if (stage === 0 && coins.length > 0) {
              // Best nearby coin (gold weighted)
              let target = coins[0];
              let bestVal = -1e9;
              for (const c of coins) {
                const val = (c.gold ? 60 : 0) - Math.hypot(c.x - f.x, c.y - f.y);
                if (val > bestVal) {
                  bestVal = val;
                  target = c;
                }
              }
              const d = Math.hypot(target.x - f.x, target.y - f.y) || 1;
              ix = ((target.x - f.x) / d) * 0.9;
              iy = ((target.y - f.y) / d) * 0.9;
            } else if (stage === 1) {
              // Orbit with the sweep at ~210px (slightly slower than the laser, so it
              // eventually catches up), and usually dash through when it arrives
              const ang = Math.atan2(f.y - CY, f.x - CX);
              const rad = Math.hypot(f.x - CX, f.y - CY);
              const radial = Math.max(-0.5, Math.min(0.5, (210 - rad) * 0.01));
              ix = -Math.sin(ang) * 0.85 + Math.cos(ang) * radial;
              iy = Math.cos(ang) * 0.85 + Math.sin(ang) * radial;
              const dAhead = (((ang - laserAngle) % Math.PI) + Math.PI) % Math.PI;
              if (dAhead > botLaserPrevD[i] + 1) botLaserDodge[i] = Math.random() < 0.7; // new pass
              botLaserPrevD[i] = dAhead;
              if (dAhead < 0.16 && f.dashCd === 0 && f.invuln === 0 && botLaserDodge[i]) dash = true;
            } else if (stage === 2) {
              let rival: (typeof fighters)[number] | undefined;
              let rivalD = 1e9;
              for (let j = 0; j < 4; j++) {
                if (j === i || !active[j].enabled || fighters[j].ringOut > 0) continue;
                const dj = Math.hypot(fighters[j].x - f.x, fighters[j].y - f.y);
                if (dj < rivalD) {
                  rivalD = dj;
                  rival = fighters[j];
                }
              }
              if (Math.hypot(f.x - CX, f.y - CY) > 130) {
                const ang = Math.atan2(CY - f.y, CX - f.x);
                ix = Math.cos(ang) * 0.9;
                iy = Math.sin(ang) * 0.9;
              } else if (rival) {
                const d = Math.hypot(rival.x - f.x, rival.y - f.y) || 1;
                ix = ((rival.x - f.x) / d) * 0.9;
                iy = ((rival.y - f.y) / d) * 0.9;
                if (d < 85 && f.dashCd === 0) dash = true;
              }
            } else if (stage === 3) {
              if (crown.holder === i) {
                const away = Math.atan2(f.y - CY, f.x - CX) + 0.8;
                ix = Math.cos(away) * 0.85;
                iy = Math.sin(away) * 0.85;
              } else {
                const tx = crown.holder >= 0 ? fighters[crown.holder].x : crown.x;
                const ty = crown.holder >= 0 ? fighters[crown.holder].y : crown.y;
                const d = Math.hypot(tx - f.x, ty - f.y) || 1;
                ix = ((tx - f.x) / d) * 0.9;
                iy = ((ty - f.y) / d) * 0.9;
                if (d < 95 && f.dashCd === 0) dash = true;
              }
            }
          }

          if (Math.hypot(ix, iy) > 0.15) f.angle = Math.atan2(iy, ix);

          if (dash && f.dashCd === 0) {
            f.vx += Math.cos(f.angle) * 8.5;
            f.vy += Math.sin(f.angle) * 8.5;
            f.dashCd = 38;
            f.invuln = Math.max(f.invuln, DASH_IFRAMES);
            sound.dash();
            vfx.afterimage(f.x, f.y, 17, active[i].color, 11);
            vfx.ring(f.x, f.y, active[i].color, 40, 2.5);
            vfx.burst(f.x, f.y, active[i].color, 10, 4);
          }
          if (f.dashCd > 24 || (Math.hypot(f.vx, f.vy) > 5.8 && frame % 2 === 0)) {
            vfx.afterimage(f.x, f.y, 15, active[i].color, 9);
          }

          f.vx = f.vx * 0.82 + ix * 0.92;
          f.vy = f.vy * 0.82 + iy * 0.92;
          f.x = Math.max(50, Math.min(GAME_WIDTH - 50, f.x + f.vx));
          f.y = Math.max(82, Math.min(GAME_HEIGHT - 44, f.y + f.vy));

          // Stage 0: Collect coins
          if (stage === 0) {
            for (let ci = coins.length - 1; ci >= 0; ci--) {
              const c = coins[ci];
              if (Math.hypot(f.x - c.x, f.y - c.y) < 26) {
                const pts = c.gold ? 25 : 10;
                scores[i] += pts;
                coins.splice(ci, 1);
                sound.pickup(c.gold ? 180 : 0);
                vfx.burst(c.x, c.y, '#facc15', 10, 4);
                vfx.popup(c.x, c.y - 12, `+${pts}`, '#facc15', 13);
              }
            }
          }

          // Stage 1: Dodge 2 spinning laser arms
          if (stage === 1) {
            if (frame % 20 === 0) scores[i] += 4;
            if (f.invuln === 0) {
              for (let arm = 0; arm < 2; arm++) {
                const ang = laserAngle + arm * Math.PI;
                const lx = CX + Math.cos(ang) * LASER_LEN;
                const ly = CY + Math.sin(ang) * LASER_LEN;
                const l2 = (lx - CX) ** 2 + (ly - CY) ** 2;
                const t = Math.max(0, Math.min(1, ((f.x - CX) * (lx - CX) + (f.y - CY) * (ly - CY)) / l2));
                const d = Math.hypot(f.x - (CX + t * (lx - CX)), f.y - (CY + t * (ly - CY)));
                if (d < 18) {
                  f.invuln = 45;
                  f.flash = 10;
                  scores[i] = Math.max(0, scores[i] - 15);
                  // knock the fighter off the beam so it doesn't sit inside it
                  f.vx += Math.cos(ang + Math.PI / 2) * 5;
                  f.vy += Math.sin(ang + Math.PI / 2) * 5;
                  sound.explosion();
                  vfx.hitstop(2);
                  vfx.shake(7);
                  vfx.burst(f.x, f.y, '#fb7185', 14, 4.5);
                  vfx.popup(f.x, f.y - 18, '-15', '#fb7185', 14);
                  rumble(i, 120, 0.8);
                }
              }
            }
          }

          // Stage 2: Ring-out check (+ survival pts for staying inside the ring)
          if (stage === 2) {
            if (Math.hypot(f.x - CX, f.y - CY) > ringRadius) {
              f.ringOut = 50;
              scores[i] = Math.max(0, scores[i] - 15);
              sound.explosion();
              vfx.hitstop(2);
              vfx.shake(8);
              vfx.burst(f.x, f.y, active[i].color, 18, 5);
              vfx.popup(f.x, f.y - 18, 'RING OUT -15', '#fb7185', 14);
              rumble(i, 130, 0.85);
            } else if (frame % 30 === 0) {
              scores[i] += 3;
            }
          }

          // Stage 3: Crown hold
          if (stage === 3) {
            if (crown.holder === -1 && Math.hypot(f.x - crown.x, f.y - crown.y) < 28) {
              crown.holder = i;
              crownLock = 30;
              sound.pickup(200);
              vfx.ring(f.x, f.y, '#facc15', 42, 3);
              vfx.popup(f.x, f.y - 40, 'CROWN!', '#facc15', 14);
              rumble(i, 80, 0.6);
            }
            if (crown.holder === i) {
              crown.x = f.x;
              crown.y = f.y - 24;
              if (frame % 15 === 0) {
                scores[i] += 5;
                vfx.spark(f.x, f.y - 24, 0, -1, '#facc15', 3);
              }
            }
          }
        }

        // Player-to-player bumps (strong in Stage 2 & Crown Steal in Stage 3)
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || fighters[i].ringOut > 0) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled || fighters[j].ringOut > 0) continue;
            const a = fighters[i];
            const b = fighters[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < 32) {
              const nx = dx / d;
              const ny = dy / d;
              // Separate the pair so one bump can't re-trigger (and re-score) every frame
              const overlap = 32 - d;
              a.x -= nx * overlap * 0.5;
              a.y -= ny * overlap * 0.5;
              b.x += nx * overlap * 0.5;
              b.y += ny * overlap * 0.5;
              const bounce = stage === 2 ? 7.5 : 4.5;
              a.vx -= nx * bounce;
              a.vy -= ny * bounce;
              b.vx += nx * bounce;
              b.vy += ny * bounce;
              a.flash = 6;
              b.flash = 6;
              if (stage === 2) {
                scores[i] += 5;
                scores[j] += 5;
              }
              if (stage === 3 && crownLock === 0) {
                let thief = -1;
                if (crown.holder === i && b.dashCd > 20) thief = j;
                else if (crown.holder === j && a.dashCd > 20) thief = i;
                if (thief >= 0) {
                  const victim = crown.holder;
                  crown.holder = thief;
                  crownLock = 30;
                  const tf = fighters[thief];
                  sound.pickup(260);
                  vfx.hitstop(3);
                  vfx.shake(6);
                  vfx.ring(tf.x, tf.y, '#facc15', 55, 3.5);
                  vfx.burst(tf.x, tf.y - 24, '#facc15', 14, 4.5);
                  vfx.popup(tf.x, tf.y - 44, 'CROWN STOLEN!', active[thief].color, 15);
                  rumble(thief, 100, 0.7);
                  rumble(victim, 140, 0.85);
                }
              }
              sound.hit();
              vfx.ring((a.x + b.x) / 2, (a.y + b.y) / 2, '#facc15', 34, 2);
              rumble(i, 60, 0.5);
              rumble(j, 60, 0.5);
            }
          }
        }

        if (stageTimer <= 0) {
          if (stage < 3) {
            const nextStage = (stage + 1) as Stage;
            const nextCol = STAGE_COLORS[nextStage];
            sound.combo(stage + 3);
            transitionFanfareTimer = 24;
            vfx.flash(nextCol, 0.34);
            vfx.shake(7);
            vfx.ring(CX, CY, nextCol, 320, 5);
            vfx.ring(CX, CY, '#ffffff', 190, 3);
            vfx.burst(CX, CY, nextCol, 28, 7);
            for (let p = 0; p < 4; p++) {
              if (active[p].enabled) rumble(p, 90, 0.55);
            }
            resetStage(nextStage);
          } else {
            const champ = [0, 1, 2, 3]
              .filter((idx) => active[idx].enabled)
              .sort((a, b) => scores[b] - scores[a])[0] ?? 0;
            matchOver = true;
            bannerTitle = `${active[champ].name} IS GRAND CHAMPION!`;
            bannerSub = `FINAL GAUNTLET SCORE: ${scores[champ]} PTS`;
            bannerColor = active[champ].color;
            bannerTimer = 160;
            finaleConfettiTimer = 135;
            sound.win();
            sound.combo(10);
            vfx.flash(active[champ].color, 0.35);
            vfx.shake(8);
            vfx.ring(CX, CY, '#facc15', 340, 5);
            vfx.ring(CX, CY, active[champ].color, 220, 4);
            vfx.confetti(CX, CY, 95);
            vfx.confetti(180, 210, 45);
            vfx.confetti(GAME_WIDTH - 180, 210, 45);
            vfx.confetti(fighters[champ].x, fighters[champ].y, 50);
            rumble(champ, 220, 0.9);
          }
        }
      }

      // Render
      drawArcadeBackdrop(ctx, STAGE_COLORS[stage]);

      if (stage === 0) {
        ctx.save();
        for (const c of coins) {
          const r = c.gold ? 10 : 7.5;
          ctx.fillStyle = c.gold ? '#facc15' : '#2ee59d';
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.22;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (stage === 1) {
        for (let arm = 0; arm < 2; arm++) {
          const ang = laserAngle + arm * Math.PI;
          ctx.save();
          ctx.strokeStyle = '#fb7185';
          ctx.shadowColor = '#fb7185';
          ctx.shadowBlur = 18;
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(CX, CY);
          ctx.lineTo(CX + Math.cos(ang) * LASER_LEN, CY + Math.sin(ang) * LASER_LEN);
          ctx.stroke();
          ctx.restore();
        }
      } else if (stage === 2) {
        ctx.save();
        ctx.strokeStyle = '#ff6b2b';
        ctx.shadowColor = '#ff6b2b';
        ctx.shadowBlur = 16;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(CX, CY, 195, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (stage === 3) {
        ctx.save();
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#facc15';
        ctx.font = '800 20px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('♛', crown.x, crown.y + 6);
        ctx.restore();
      }

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => scores[b] - scores[a])[0];

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || fighters[i].ringOut > 0) continue;
        const f = fighters[i];
        ctx.save();
        // Show laser i-frames (spawn / dash / post-hit) as a flicker during the laser stage
        if (stage === 1 && f.invuln > 0 && Math.floor(frame / 3) % 2 === 0) ctx.globalAlpha = 0.55;
        drawPlayerOrb(ctx, f.x, f.y, 16, active[i].color, i, {
          angle: f.angle,
          leader: i === leaderIdx && scores[i] > 0,
          flash: f.flash > 0,
          cooldownPct: f.dashCd / 38,
        });
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      const pills: ScorePillData[] = [0, 1, 2, 3].map((s) => ({
        slot: s,
        name: active[s].name,
        color: active[s].color,
        active: active[s].enabled,
        valueText: `${scores[s]} PTS`,
        highlight: s === leaderIdx && scores[s] > 0,
      }));
      drawTopScoreboard(
        ctx,
        pills,
        `${STAGE_NAMES[stage]} (${Math.ceil(stageTimer / 60)}s) · A: DASH BURST`,
      );

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}
