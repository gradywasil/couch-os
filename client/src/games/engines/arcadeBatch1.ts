import {
  drawArcadeBackdrop,
  drawPlayerOrb,
  drawRoundBanner,
  drawTopScoreboard,
  GAME_HEIGHT,
  GAME_WIDTH,
  GameLoopContext,
  getSlotIdentity,
  MiniGameEngine,
  readPlayerInput,
} from '../sharedEngine';

// 1. NEON BUMPER ARENA (Magnet & Shockwave Crates, Star Streaks, Leader Crown, Bolt Arcs, Hitstop, 90s/400pt Match)
export function createNeonArenaEngine(): MiniGameEngine {
  const ARENA_L = 36;
  const ARENA_R = GAME_WIDTH - 36;
  const ARENA_T = 70;
  const ARENA_B = GAME_HEIGHT - 36;
  const TARGET_SCORE = 400;
  const MATCH_TICKS = 90 * 60;

  const spawns = [
    { x: GAME_WIDTH * 0.22, y: 165 },
    { x: GAME_WIDTH * 0.78, y: 165 },
    { x: GAME_WIDTH * 0.22, y: 405 },
    { x: GAME_WIDTH * 0.78, y: 405 },
  ];

  const orbs = spawns.map((sp, i) => ({
    x: sp.x,
    y: sp.y,
    vx: 0,
    vy: 0,
    angle: i % 2 === 0 ? 0 : Math.PI,
    radius: 20,
    score: 0,
    wins: 0,
    streak: 0,
    streakTimer: 0,
    dashCooldown: 0,
    dashFrames: 0,
    flashFrames: 0,
    magnetFrames: 0,
    prevAction: false,
    trail: [] as Array<{ x: number; y: number }>,
  }));

  const bumpers = [
    { x: GAME_WIDTH / 2, y: 288, r: 26, pulse: 0 },
    { x: 250, y: 288, r: 17, pulse: 0 },
    { x: GAME_WIDTH - 250, y: 288, r: 17, pulse: 0 },
  ];

  // Collected stars go dark for a beat (with an "incoming" telegraph) instead of
  // teleporting instantly — otherwise the points goal fell in ~4s of a 90s match.
  const STAR_RESPAWN = 110;
  const STREAK_WINDOW = 120;
  const stars = Array.from({ length: 5 }, (_, i) => ({
    x: 170 + i * 155,
    y: i % 2 === 0 ? 175 : 395,
    r: i === 0 ? 14 : 10,
    golden: i === 0,
    pulse: i * 1.1,
    active: true,
    respawn: 0,
  }));

  type CrateKind = 'magnet' | 'shockwave';
  let crate: { x: number; y: number; kind: CrateKind; active: boolean; pulse: number } = {
    x: GAME_WIDTH / 2,
    y: 155,
    kind: 'magnet',
    active: true,
    pulse: 0,
  };
  let crateRespawn = 0;
  let ticksLeft = MATCH_TICKS;
  let freeze = 20;
  let banner = '';
  let bannerSub = '';

  // Relocate a star to a random open spot (never inside a bumper)
  const relocateStar = (st: { x: number; y: number; r: number }) => {
    for (let tries = 0; tries < 12; tries++) {
      st.x = 85 + Math.random() * (GAME_WIDTH - 170);
      st.y = 95 + Math.random() * (GAME_HEIGHT - 165);
      let clear = true;
      for (const b of bumpers) {
        if (Math.hypot(st.x - b.x, st.y - b.y) < b.r + st.r + 18) {
          clear = false;
          break;
        }
      }
      if (clear) return;
    }
  };

  const resetMatch = () => {
    orbs.forEach((o, i) => {
      o.x = spawns[i].x;
      o.y = spawns[i].y;
      o.vx = 0;
      o.vy = 0;
      o.angle = i % 2 === 0 ? 0 : Math.PI;
      o.score = 0;
      o.streak = 0;
      o.streakTimer = 0;
      o.dashCooldown = 0;
      o.dashFrames = 0;
      o.flashFrames = 0;
      o.magnetFrames = 0;
      o.prevAction = false;
      o.trail = [];
    });
    ticksLeft = MATCH_TICKS;
    freeze = 20;
    banner = '';
    bannerSub = '';
    crate = { x: GAME_WIDTH / 2, y: 155, kind: 'magnet', active: true, pulse: 0 };
    crateRespawn = 0;
  };

  return {
    step(env: GameLoopContext) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetMatch();
      } else {
        ticksLeft = Math.max(0, ticksLeft - 1);

        // Final 5-second countdown ticks
        if (ticksLeft > 0 && ticksLeft <= 300 && ticksLeft % 60 === 0) {
          const sec = ticksLeft / 60;
          vfx.popup(GAME_WIDTH / 2, 124, `${sec}!`, sec <= 2 ? '#fb7185' : '#facc15', 22);
          sound.beep(sec <= 2 ? 880 : 660, 0.08, 'triangle', 0.12);
        }

        if (!crate.active) {
          crateRespawn--;
          if (crateRespawn <= 0) {
            crate.x = 120 + Math.random() * (GAME_WIDTH - 240);
            crate.y = 115 + Math.random() * (GAME_HEIGHT - 200);
            crate.kind = Math.random() < 0.55 ? 'magnet' : 'shockwave';
            crate.active = true;
            vfx.ring(crate.x, crate.y, crate.kind === 'magnet' ? '#38bdf8' : '#c084fc', 42, 2);
          }
        } else {
          crate.pulse += 0.1;
        }

        // Ambient electric bumper arcs
        if (frame % 28 === 0) {
          vfx.bolt(bumpers[1].x, bumpers[1].y, bumpers[0].x, bumpers[0].y, 'rgba(255,107,43,0.45)');
          vfx.bolt(bumpers[0].x, bumpers[0].y, bumpers[2].x, bumpers[2].y, 'rgba(255,107,43,0.45)');
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const orb = orbs[i];
          let ix = 0;
          let iy = 0;
          let actionPressed = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            actionPressed = inp.actionA || inp.actionB;
          } else {
            let bestTarget: { x: number; y: number } = { x: GAME_WIDTH / 2, y: 288 + (i - 1.5) * 50 };
            let bestScore = -Infinity;
            for (const st of stars) {
              if (!st.active) continue;
              const d = Math.hypot(st.x - orb.x, st.y - orb.y);
              const val = (st.golden ? 320 : 120) - d;
              if (val > bestScore) {
                bestScore = val;
                bestTarget = st;
              }
            }
            if (crate.active) {
              const dCrate = Math.hypot(crate.x - orb.x, crate.y - orb.y);
              if (220 - dCrate > bestScore) {
                bestTarget = crate;
              }
            }
            // Also slam nearby rival leader
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled) continue;
              const dRival = Math.hypot(orbs[j].x - orb.x, orbs[j].y - orb.y);
              if (dRival < 92 && orb.dashCooldown === 0 && Math.random() < 0.08) {
                bestTarget = orbs[j];
                actionPressed = true;
              }
            }
            const dx = bestTarget.x - orb.x;
            const dy = bestTarget.y - orb.y;
            const d = Math.hypot(dx, dy) || 1;
            ix = (dx / d) * 0.86;
            iy = (dy / d) * 0.86;
            if (d < 120 && orb.dashCooldown === 0 && Math.random() < 0.05) actionPressed = true;
          }

          const dashEdge = actionPressed && !orb.prevAction;
          orb.prevAction = actionPressed;

          const mag = Math.hypot(ix, iy);
          if (mag > 0.12) {
            orb.angle = Math.atan2(iy, ix);
          }
          if (orb.dashCooldown > 0) orb.dashCooldown--;
          if (orb.dashFrames > 0) orb.dashFrames--;
          if (orb.flashFrames > 0) orb.flashFrames--;
          if (orb.magnetFrames > 0) orb.magnetFrames--;
          if (orb.streakTimer > 0) {
            orb.streakTimer--;
            if (orb.streakTimer === 0) orb.streak = 0;
          }

          if (dashEdge && orb.dashCooldown === 0) {
            const dx = mag > 0.1 ? ix : Math.cos(orb.angle);
            const dy = mag > 0.1 ? iy : Math.sin(orb.angle);
            orb.vx += dx * 12.8;
            orb.vy += dy * 12.8;
            orb.dashCooldown = 36;
            orb.dashFrames = 13;
            vfx.ring(orb.x, orb.y, active[i].color, 56, 3);
            vfx.burst(orb.x, orb.y, active[i].color, 10, 4.8);
            sound.dash();
            rumble(i, 45, 0.45);
          }

          if (orb.dashFrames > 0) {
            vfx.afterimage(orb.x, orb.y, orb.radius, active[i].color, 9);
            vfx.spark(orb.x, orb.y, -orb.vx * 0.22, -orb.vy * 0.22, active[i].color, 4);
          }

          orb.vx = (orb.vx + ix * 0.72) * 0.91;
          orb.vy = (orb.vy + iy * 0.72) * 0.91;
          orb.x += orb.vx;
          orb.y += orb.vy;

          orb.trail.push({ x: orb.x, y: orb.y });
          if (orb.trail.length > 9) orb.trail.shift();

          if (orb.x < ARENA_L + orb.radius) {
            orb.x = ARENA_L + orb.radius;
            orb.vx = Math.abs(orb.vx) * 0.85;
          } else if (orb.x > ARENA_R - orb.radius) {
            orb.x = ARENA_R - orb.radius;
            orb.vx = -Math.abs(orb.vx) * 0.85;
          }
          if (orb.y < ARENA_T + orb.radius) {
            orb.y = ARENA_T + orb.radius;
            orb.vy = Math.abs(orb.vy) * 0.85;
          } else if (orb.y > ARENA_B - orb.radius) {
            orb.y = ARENA_B - orb.radius;
            orb.vy = -Math.abs(orb.vy) * 0.85;
          }

          // Magnet pull on stars
          if (orb.magnetFrames > 0) {
            for (const st of stars) {
              if (!st.active) continue;
              const dx = orb.x - st.x;
              const dy = orb.y - st.y;
              const d = Math.hypot(dx, dy);
              if (d > 1 && d < 185) {
                st.x += (dx / d) * 3.8;
                st.y += (dy / d) * 3.8;
                if (frame % 8 === 0) {
                  vfx.bolt(orb.x, orb.y, st.x, st.y, '#38bdf8');
                }
              }
            }
          }

          // Power-up Crate Pickup
          if (crate.active && Math.hypot(crate.x - orb.x, crate.y - orb.y) < orb.radius + 16) {
            crate.active = false;
            crateRespawn = 340;
            if (crate.kind === 'magnet') {
              orb.magnetFrames = 320;
              vfx.ring(orb.x, orb.y, '#38bdf8', 70, 3);
              vfx.popup(orb.x, orb.y - 16, 'MAGNET ON!', '#38bdf8', 14);
              sound.pickup(240);
            } else {
              // Shockwave blast pushes all nearby rivals away & steals/awards points
              vfx.ring(orb.x, orb.y, '#c084fc', 195, 5);
              vfx.burst(orb.x, orb.y, '#c084fc', 24, 7.5);
              vfx.shake(8);
              vfx.hitstop(2);
              sound.explosion();
              rumble(i, 110, 0.8);
              vfx.popup(orb.x, orb.y - 18, 'SHOCKWAVE!', '#c084fc', 16);
              for (let j = 0; j < 4; j++) {
                if (j === i || !active[j].enabled) continue;
                const rOrb = orbs[j];
                const dx = rOrb.x - orb.x;
                const dy = rOrb.y - orb.y;
                const d = Math.hypot(dx, dy) || 1;
                if (d < 220) {
                  rOrb.vx += (dx / d) * 15;
                  rOrb.vy += (dy / d) * 15;
                  rOrb.flashFrames = 12;
                  vfx.bolt(orb.x, orb.y, rOrb.x, rOrb.y, '#c084fc');
                  if (rOrb.score >= 10) {
                    rOrb.score -= 10;
                    orb.score += 10;
                    vfx.popup(rOrb.x, rOrb.y - 12, '-10 ZAP!', '#fb7185', 13);
                  }
                  rumble(j, 140, 0.9);
                }
              }
            }
          }

          // Pinball Bumpers with electric bolts
          for (const bmp of bumpers) {
            const dx = orb.x - bmp.x;
            const dy = orb.y - bmp.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0 && dist < orb.radius + bmp.r) {
              const nx = dx / dist;
              const ny = dy / dist;
              orb.x = bmp.x + nx * (orb.radius + bmp.r + 2);
              orb.y = bmp.y + ny * (orb.radius + bmp.r + 2);
              orb.vx = nx * 12;
              orb.vy = ny * 12;
              bmp.pulse = 14;
              vfx.ring(bmp.x, bmp.y, '#ff6b2b', 72, 3);
              vfx.bolt(bmp.x, bmp.y, orb.x, orb.y, '#facc15');
              vfx.shake(4);
              sound.beep(760, 0.06, 'triangle');
              rumble(i, 70, 0.6);
            }
          }
        }

        for (const bmp of bumpers) {
          if (bmp.pulse > 0) bmp.pulse--;
        }

        // Player-vs-Player Bumper Collisions
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled) continue;
            const a = orbs[i];
            const b = orbs[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const minD = a.radius + b.radius;
            if (dist > 0 && dist < minD) {
              const nx = dx / dist;
              const ny = dy / dist;
              const overlap = (minD - dist) / 2;
              a.x -= nx * overlap;
              a.y -= ny * overlap;
              b.x += nx * overlap;
              b.y += ny * overlap;
              const heavyA = a.dashFrames > 0;
              const heavyB = b.dashFrames > 0;
              const boostA = heavyA ? 2.25 : 1;
              const boostB = heavyB ? 2.25 : 1;
              a.vx -= nx * 6.8 * boostB;
              a.vy -= ny * 6.8 * boostB;
              b.vx += nx * 6.8 * boostA;
              b.vy += ny * 6.8 * boostA;
              a.flashFrames = 8;
              b.flashFrames = 8;
              const cx = (a.x + b.x) / 2;
              const cy = (a.y + b.y) / 2;
              vfx.burst(cx, cy, '#ffffff', 12, 6);
              vfx.ring(cx, cy, '#ff6b2b', 58, 2.5);
              if (heavyA !== heavyB) {
                const attacker = heavyA ? i : j;
                const victim = heavyA ? j : i;
                orbs[attacker].score += 10;
                orbs[victim].streak = 0;
                vfx.hitstop(2);
                vfx.shake(8);
                vfx.bolt(a.x, a.y, b.x, b.y, '#facc15');
                vfx.popup(cx, cy - 16, 'SLAM +10!', active[attacker].color, 16);
                vfx.burst(cx, cy, active[attacker].color, 16, 7);
                sound.explosion();
              } else if (heavyA && heavyB) {
                vfx.hitstop(2);
                vfx.shake(8);
                vfx.bolt(a.x, a.y, b.x, b.y, '#ffffff');
                vfx.popup(cx, cy - 16, 'CLASH!', '#facc15', 16);
                sound.hit();
              } else {
                sound.hit();
              }
              rumble(i, 90, 0.75);
              rumble(j, 90, 0.75);
            }
          }
        }

        // Stars Collection
        for (const star of stars) {
          star.pulse += 0.1;
          if (!star.active) {
            star.respawn--;
            if (star.respawn <= 0) {
              star.active = true;
              vfx.ring(star.x, star.y, star.golden ? '#ff6b2b' : '#facc15', 40, 2);
              vfx.burst(star.x, star.y, star.golden ? '#ff6b2b' : '#facc15', 6, 2.5);
            }
            continue;
          }
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            if (Math.hypot(star.x - orbs[i].x, star.y - orbs[i].y) < orbs[i].radius + star.r) {
              orbs[i].streak++;
              orbs[i].streakTimer = STREAK_WINDOW;
              const streakBonus = orbs[i].streak > 1 ? Math.min(15, (orbs[i].streak - 1) * 5) : 0;
              const pts = (star.golden ? 30 : 10) + streakBonus;
              orbs[i].score += pts;
              vfx.burst(star.x, star.y, star.golden ? '#ff6b2b' : '#facc15', star.golden ? 22 : 12, 5.5);
              vfx.ring(star.x, star.y, star.golden ? '#ff6b2b' : '#facc15', 54, 2.5);
              const label =
                orbs[i].streak >= 2
                  ? `+${pts} x${orbs[i].streak}!`
                  : star.golden
                    ? `+${pts} MEGA!`
                    : `+${pts}`;
              vfx.popup(star.x, star.y - 10, label, star.golden ? '#ff6b2b' : '#fde047', star.golden ? 16 : 14);
              if (star.golden) vfx.shake(4);
              if (orbs[i].streak >= 2 || star.golden) {
                sound.combo(orbs[i].streak + (star.golden ? 2 : 0));
              } else {
                sound.pickup(i * 65);
              }
              star.active = false;
              star.respawn = STAR_RESPAWN + Math.floor(Math.random() * 30);
              relocateStar(star);
              rumble(i, star.golden ? 70 : 35, star.golden ? 0.6 : 0.3);
              break;
            }
          }
        }

        // Match End Check (TARGET_SCORE pts or 90s)
        let matchLeader = -1;
        let topScore = 0;
        let tiedTop = false;
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          if (orbs[i].score > topScore) {
            topScore = orbs[i].score;
            matchLeader = i;
            tiedTop = false;
          } else if (orbs[i].score === topScore && matchLeader >= 0) {
            tiedTop = true;
          }
        }
        if ((topScore >= TARGET_SCORE || ticksLeft === 0) && !banner) {
          freeze = 135;
          if (matchLeader < 0 || (tiedTop && topScore < TARGET_SCORE)) {
            // Nobody scored or a dead-even tie at the buzzer
            banner = 'DRAW!';
            bannerSub = 'TIME UP — DEAD EVEN!';
            sound.sweep(520, 180, 0.3, 'triangle', 0.1);
          } else {
            const w = matchLeader;
            orbs[w].wins++;
            banner = `${active[w].name} WINS!`;
            bannerSub = topScore >= TARGET_SCORE ? `FIRST TO ${TARGET_SCORE} PTS!` : 'TIME UP — CHAMPION CROWNED!';
            sound.win();
            vfx.flash(active[w].color, 0.25);
            vfx.shake(6);
            vfx.ring(orbs[w].x, orbs[w].y, active[w].color, 120, 5);
            vfx.confetti(GAME_WIDTH / 2, 160, 48);
            vfx.confetti(orbs[w].x, orbs[w].y, 30);
            rumble(w, 260, 1);
          }
        }
      }

      // Compute Leader
      let leaderIdx = -1;
      let maxPts = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && orbs[i].score > maxPts) {
          maxPts = orbs[i].score;
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#ff6b2b');

      // Power-up Crate
      if (crate.active) {
        const cCol = crate.kind === 'magnet' ? '#38bdf8' : '#c084fc';
        ctx.save();
        ctx.translate(crate.x, crate.y);
        ctx.rotate(Math.sin(crate.pulse) * 0.14);
        ctx.shadowColor = cCol;
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#111827';
        ctx.strokeStyle = cCol;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(-14, -14, 28, 28, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = cCol;
        ctx.font = 'bold 13px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(crate.kind === 'magnet' ? 'M' : '⚡', 0, 5);
        ctx.restore();
      }

      // Pinball Bumpers
      for (const bmp of bumpers) {
        ctx.save();
        ctx.shadowColor = '#ff6b2b';
        ctx.shadowBlur = bmp.pulse > 0 ? 28 : 14;
        ctx.fillStyle = bmp.pulse > 0 ? '#ff6b2b' : '#1b202d';
        ctx.strokeStyle = '#ff6b2b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(bmp.x, bmp.y, bmp.r + (bmp.pulse > 0 ? 4 : 0), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bmp.x, bmp.y, bmp.r * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Stars (cheap additive halo instead of per-star shadowBlur)
      for (const star of stars) {
        if (!star.active) {
          // Incoming telegraph: a contracting dashed ring where the star will reappear
          const t = Math.max(0, Math.min(1, star.respawn / STAR_RESPAWN));
          if (t < 0.7) {
            ctx.save();
            ctx.globalAlpha = 0.25 + (0.7 - t) * 0.6;
            ctx.strokeStyle = star.golden ? '#ff6b2b' : '#facc15';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.r + t * 26, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
          continue;
        }
        const sr = star.r + Math.sin(star.pulse) * 2.5;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = star.golden ? '#ff6b2b' : '#facc15';
        ctx.beginPath();
        ctx.arc(star.x, star.y, sr * 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = star.golden ? '#ff8f5e' : '#fde047';
        ctx.beginPath();
        ctx.arc(star.x, star.y, sr, 0, Math.PI * 2);
        ctx.fill();
        if (star.golden) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }

      // Players
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const orb = orbs[i];
        const col = active[i].color;
        for (let t = 0; t < orb.trail.length; t++) {
          ctx.globalAlpha = ((t + 1) / orb.trail.length) * 0.22;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(orb.trail[t].x, orb.trail[t].y, orb.radius * (0.38 + (t / orb.trail.length) * 0.45), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        drawPlayerOrb(ctx, orb.x, orb.y, orb.radius, col, i, {
          angle: orb.angle,
          leader: i === leaderIdx,
          shield: orb.magnetFrames > 0,
          flash: orb.flashFrames > 0,
          cooldownPct: orb.dashCooldown / 36,
        });
      }

      // Timer & Target Pill
      ctx.save();
      ctx.fillStyle = 'rgba(11, 13, 18, 0.88)';
      ctx.strokeStyle = 'rgba(255, 107, 43, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(GAME_WIDTH / 2 - 74, 68, 148, 24, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ticksLeft < 600 ? '#fb7185' : '#facc15';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(ticksLeft / 60)}s · GOAL ${TARGET_SCORE}`, GAME_WIDTH / 2, 84);
      ctx.restore();

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#ff6b2b');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderIdx,
          valueText: `${orbs[i].score} · W${orbs[i].wins}`,
        })),
        `MOVE: STICK / WASD  ·  DASH SLAM: A / SPACE  ·  GOAL: ${TARGET_SCORE} PTS OR 90s`,
      );
    },
  };
}

// 2. HYPER PONG 4P (Curve Spin, Edge-Trigger Power Smash, Multi-Ball Fever, Goal Flash, First-to-7 Confetti)
export function createHyperPongEngine(): MiniGameEngine {
  const LEFT = 240;
  const RIGHT = 720;
  const TOP = 76;
  const BOTTOM = 502;
  const CX = (LEFT + RIGHT) / 2;
  const CY = (TOP + BOTTOM) / 2;
  const TARGET_POINTS = 7;

  const paddles = [
    { pos: CX, vel: 0, pts: 0, wins: 0, smashFrames: 0, smashCd: 0, prevA: false, goalFlash: 0 },
    { pos: CX, vel: 0, pts: 0, wins: 0, smashFrames: 0, smashCd: 0, prevA: false, goalFlash: 0 },
    { pos: CY, vel: 0, pts: 0, wins: 0, smashFrames: 0, smashCd: 0, prevA: false, goalFlash: 0 },
    { pos: CY, vel: 0, pts: 0, wins: 0, smashFrames: 0, smashCd: 0, prevA: false, goalFlash: 0 },
  ];

  const corners = [
    { x: LEFT, y: TOP, pulse: 0 },
    { x: RIGHT, y: TOP, pulse: 0 },
    { x: LEFT, y: BOTTOM, pulse: 0 },
    { x: RIGHT, y: BOTTOM, pulse: 0 },
  ];

  interface PongBall {
    x: number;
    y: number;
    vx: number;
    vy: number;
    spin: number;
    powered: boolean;
    lastHit: number;
    trail: Array<{ x: number; y: number }>;
  }

  let balls: PongBall[] = [];
  let rallyHits = 0;
  let multiBallTimer = 460;
  let roundFreeze = 34;
  let winnerText = '';

  const makeBall = (speed = 5.5): PongBall => {
    const angle = Math.random() * Math.PI * 2;
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    if (Math.abs(vx) < 2.4) vx = vx >= 0 ? 3.2 : -3.2;
    if (Math.abs(vy) < 2.4) vy = vy >= 0 ? 3.2 : -3.2;
    return { x: CX, y: CY, vx, vy, spin: 0, powered: false, lastHit: -1, trail: [] };
  };

  const resetPoint = (fullReset = false) => {
    balls = [makeBall(5.5)];
    rallyHits = 0;
    multiBallTimer = 460;
    roundFreeze = 30;
    if (fullReset) {
      paddles.forEach((p, idx) => {
        p.pts = 0;
        p.pos = idx < 2 ? CX : CY;
        p.vel = 0;
        p.smashFrames = 0;
        p.smashCd = 0;
        p.goalFlash = 0;
      });
      winnerText = '';
    }
  };
  resetPoint(true);

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      const padHalfH = 54;
      const padHalfV = 46;

      for (let i = 0; i < 4; i++) {
        if (paddles[i].goalFlash > 0) paddles[i].goalFlash--;
        if (!active[i].enabled) continue;
        const p = paddles[i];
        const horizontal = i < 2;
        let move = 0;
        let pressA = false;
        let sprint = false;

        if (active[i].isHuman) {
          const inp = readPlayerInput(i, pads, keys);
          move = horizontal ? inp.x : inp.y;
          // Registry: "Sprint: A / Space" — tapping A also fires the power smash,
          // holding A (or B) keeps the sprint slide going.
          pressA = inp.actionA;
          sprint = inp.actionA || inp.actionB;
        } else {
          // Track closest incoming ball
          let targetBall = balls[0];
          let bestDist = Infinity;
          for (const b of balls) {
            const dist = Math.hypot(b.x - (i === 2 ? LEFT : i === 3 ? RIGHT : p.pos), b.y - (i === 0 ? BOTTOM : i === 1 ? TOP : p.pos));
            if (dist < bestDist) {
              bestDist = dist;
              targetBall = b;
            }
          }
          const target = targetBall ? (horizontal ? targetBall.x : targetBall.y) : horizontal ? CX : CY;
          const diff = target - p.pos;
          move = Math.max(-1, Math.min(1, diff / 24)) * 0.9;
          if (bestDist < 58 && p.smashCd === 0 && Math.random() < 0.25) pressA = true;
        }

        const smashEdge = pressA && !p.prevA;
        p.prevA = pressA;
        if (p.smashFrames > 0) p.smashFrames--;
        if (p.smashCd > 0) p.smashCd--;
        if (smashEdge && p.smashCd === 0) {
          p.smashFrames = 14;
          p.smashCd = 34;
          sound.dash();
        }

        const prevPos = p.pos;
        const spd = sprint ? 11.2 : 8.0;
        p.pos += move * spd;
        if (horizontal) {
          p.pos = Math.max(LEFT + padHalfH + 16, Math.min(RIGHT - padHalfH - 16, p.pos));
        } else {
          p.pos = Math.max(TOP + padHalfV + 16, Math.min(BOTTOM - padHalfV - 16, p.pos));
        }
        p.vel = p.pos - prevPos;
      }

      for (const c of corners) {
        if (c.pulse > 0) c.pulse--;
      }

      if (roundFreeze > 0) {
        roundFreeze--;
        if (roundFreeze === 0 && winnerText) {
          resetPoint(true);
        }
      } else {
        multiBallTimer--;
        if (multiBallTimer <= 0 && balls.length < 3) {
          multiBallTimer = 420;
          balls.push(makeBall(5.8));
          vfx.ring(CX, CY, '#facc15', 95, 3.5);
          vfx.popup(CX, CY - 18, 'MULTI-BALL FEVER!', '#facc15', 16);
          sound.combo(3);
        }

        let pointScored = false;
        const r = 9;
        let activeCount = 0;
        for (let k = 0; k < 4; k++) if (active[k].enabled) activeCount++;
        // Solo practice: every return scores, a miss wipes the streak — first to 7 in a row wins
        const soloMode = activeCount === 1;

        for (let bIdx = balls.length - 1; bIdx >= 0; bIdx--) {
          const ball = balls[bIdx];
          let removed = false;

          // Apply curve spin perpendicular to velocity
          if (Math.abs(ball.spin) > 0.002) {
            const sp = ball.spin;
            ball.vx += -ball.vy * sp;
            ball.vy += ball.vx * sp;
            ball.spin *= 0.985;
            if (frame % 3 === 0) {
              vfx.spark(ball.x, ball.y, -ball.vx * 0.15, -ball.vy * 0.15, '#c084fc', 2.5);
            }
          }

          ball.x += ball.vx;
          ball.y += ball.vy;
          ball.trail.push({ x: ball.x, y: ball.y });
          if (ball.trail.length > (ball.powered ? 14 : 9)) ball.trail.shift();

          if (ball.powered && frame % 2 === 0) {
            vfx.spark(ball.x, ball.y, -ball.vx * 0.25, -ball.vy * 0.25, '#ff6b2b', 3.5);
          }

          // Corner bumpers
          for (const c of corners) {
            const dx = ball.x - c.x;
            const dy = ball.y - c.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < 26) {
              const nx = dx / d;
              const ny = dy / d;
              ball.x = c.x + nx * 27;
              ball.y = c.y + ny * 27;
              const spd = Math.max(6.5, Math.hypot(ball.vx, ball.vy));
              ball.vx = nx * spd;
              ball.vy = ny * spd;
              c.pulse = 14;
              vfx.ring(c.x, c.y, '#38bdf8', 46, 2.5);
              vfx.bolt(c.x, c.y, ball.x, ball.y, '#38bdf8');
              sound.beep(780, 0.04);
            }
          }

          const onBounce = (slot: number, paddleOffset: number) => {
            ball.lastHit = slot;
            rallyHits++;
            const p = paddles[slot];
            // Curve spin from paddle velocity + edge hit
            ball.spin = Math.max(-0.025, Math.min(0.025, p.vel * 0.0022 + paddleOffset * 0.0002));
            if (p.smashFrames > 0) {
              ball.powered = true;
              ball.vx *= 1.24;
              ball.vy *= 1.24;
              vfx.hitstop(2);
              vfx.shake(8);
              vfx.burst(ball.x, ball.y, '#ff6b2b', 18, 6.5);
              vfx.ring(ball.x, ball.y, '#ff6b2b', 65, 3.5);
              vfx.popup(ball.x, ball.y - 14, 'POWER SMASH!', '#ff6b2b', 15);
              sound.noiseBurst(0.14, 1500, 0.14);
              sound.combo(Math.min(8, rallyHits));
            } else {
              ball.powered = false;
              vfx.burst(ball.x, ball.y, active[slot].color, 10, 4.5);
              vfx.ring(ball.x, ball.y, active[slot].color, 40, 2);
              sound.beep(520 + slot * 65 + Math.min(200, rallyHits * 15), 0.06);
            }
            if (soloMode) {
              p.pts++;
              vfx.popup(ball.x, ball.y - 26, `STREAK ${p.pts}!`, active[slot].color, 13);
            }
            rumble(slot, 65, 0.6);
          };

          const onMiss = (missedSlot: number) => {
            removed = true;
            paddles[missedSlot].goalFlash = 24;
            const scorer = ball.lastHit;
            if (soloMode) {
              if (paddles[missedSlot].pts > 0) {
                vfx.popup(ball.x, ball.y - 14, 'STREAK LOST!', '#fb7185', 15);
              }
              paddles[missedSlot].pts = 0;
            } else if (scorer >= 0 && scorer !== missedSlot && active[scorer].enabled) {
              paddles[scorer].pts += ball.powered ? 2 : 1;
              vfx.popup(ball.x, ball.y - 14, `${active[scorer].name} +${ball.powered ? 2 : 1}!`, active[scorer].color, 15);
            } else {
              // Award 1 pt to all other active opponents
              for (let k = 0; k < 4; k++) {
                if (k !== missedSlot && active[k].enabled) paddles[k].pts += 1;
              }
              vfx.popup(ball.x, ball.y - 14, 'OPEN GOAL!', '#fb7185', 15);
            }
            vfx.burst(ball.x, ball.y, '#fb7185', 22, 6.5);
            vfx.ring(ball.x, ball.y, '#fb7185', 85, 4);
            vfx.shake(9);
            sound.explosion();
            rumble(missedSlot, 160, 0.95);
            balls.splice(bIdx, 1);
            pointScored = true;
          };

          // Bottom (P0)
          if (ball.y + r >= BOTTOM - 14 && ball.vy > 0) {
            if (active[0].enabled && Math.abs(ball.x - paddles[0].pos) <= padHalfH + r) {
              const offset = ball.x - paddles[0].pos;
              ball.vy = -Math.abs(ball.vy) * 1.04;
              ball.vx += offset * 0.085 + paddles[0].vel * 0.25;
              onBounce(0, offset);
            } else if (ball.y + r >= BOTTOM) {
              if (active[0].enabled) onMiss(0);
              else {
                ball.y = BOTTOM - r;
                ball.vy = -Math.abs(ball.vy);
              }
            }
          }
          // Top (P1)
          if (!removed && ball.y - r <= TOP + 14 && ball.vy < 0) {
            if (active[1].enabled && Math.abs(ball.x - paddles[1].pos) <= padHalfH + r) {
              const offset = ball.x - paddles[1].pos;
              ball.vy = Math.abs(ball.vy) * 1.04;
              ball.vx += offset * 0.085 + paddles[1].vel * 0.25;
              onBounce(1, offset);
            } else if (ball.y - r <= TOP) {
              if (active[1].enabled) onMiss(1);
              else {
                ball.y = TOP + r;
                ball.vy = Math.abs(ball.vy);
              }
            }
          }
          // Left (P2)
          if (!removed && ball.x - r <= LEFT + 14 && ball.vx < 0) {
            if (active[2].enabled && Math.abs(ball.y - paddles[2].pos) <= padHalfV + r) {
              const offset = ball.y - paddles[2].pos;
              ball.vx = Math.abs(ball.vx) * 1.04;
              ball.vy += offset * 0.085 + paddles[2].vel * 0.25;
              onBounce(2, offset);
            } else if (ball.x - r <= LEFT) {
              if (active[2].enabled) onMiss(2);
              else {
                ball.x = LEFT + r;
                ball.vx = Math.abs(ball.vx);
              }
            }
          }
          // Right (P3)
          if (!removed && ball.x + r >= RIGHT - 14 && ball.vx > 0) {
            if (active[3].enabled && Math.abs(ball.y - paddles[3].pos) <= padHalfV + r) {
              const offset = ball.y - paddles[3].pos;
              ball.vx = -Math.abs(ball.vx) * 1.04;
              ball.vy += offset * 0.085 + paddles[3].vel * 0.25;
              onBounce(3, offset);
            } else if (ball.x + r >= RIGHT) {
              if (active[3].enabled) onMiss(3);
              else {
                ball.x = RIGHT - r;
                ball.vx = -Math.abs(ball.vx);
              }
            }
          }
          // A missed ball was already spliced out — never let it trigger a second goal
          if (removed) continue;

          // Keep both axes moving so a ball can never stall bouncing between two empty walls
          const MIN_AXIS = 1.6;
          if (Math.abs(ball.vx) < MIN_AXIS) ball.vx = ball.vx >= 0 ? MIN_AXIS : -MIN_AXIS;
          if (Math.abs(ball.vy) < MIN_AXIS) ball.vy = ball.vy >= 0 ? MIN_AXIS : -MIN_AXIS;

          const spd = Math.hypot(ball.vx, ball.vy);
          const maxS = ball.powered ? 14.5 : 11.8;
          if (spd > maxS) {
            ball.vx = (ball.vx / spd) * maxS;
            ball.vy = (ball.vy / spd) * maxS;
          }
        }

        // Check first-to-7 victory
        let matchWinner = -1;
        for (let i = 0; i < 4; i++) {
          if (active[i].enabled && paddles[i].pts >= TARGET_POINTS) {
            if (matchWinner === -1 || paddles[i].pts > paddles[matchWinner].pts) {
              matchWinner = i;
            }
          }
        }

        if (matchWinner >= 0 && !winnerText) {
          paddles[matchWinner].wins++;
          winnerText = `${active[matchWinner].name} WINS!`;
          roundFreeze = 125;
          sound.win();
          vfx.flash(active[matchWinner].color, 0.28);
          vfx.shake(7);
          vfx.ring(CX, CY, active[matchWinner].color, 160, 5);
          vfx.confetti(CX, CY, 55);
          vfx.confetti(CX, TOP + 40, 30);
          rumble(matchWinner, 260, 1);
        } else if (pointScored && balls.length === 0) {
          resetPoint(false);
        }
      }

      // Leader
      let leaderIdx = -1;
      let maxPts = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && paddles[i].pts > maxPts) {
          maxPts = paddles[i].pts;
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#38bdf8');

      // Arena & live goal-line flashes
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
      ctx.lineWidth = 2;
      ctx.strokeRect(LEFT, TOP, RIGHT - LEFT, BOTTOM - TOP);

      const drawGoalLine = (x1: number, y1: number, x2: number, y2: number, flash: number, col: string) => {
        if (flash <= 0) return;
        ctx.save();
        ctx.strokeStyle = '#fb7185';
        ctx.shadowColor = col;
        ctx.shadowBlur = 22;
        ctx.lineWidth = 7;
        ctx.globalAlpha = Math.min(1, flash / 16);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
      };
      drawGoalLine(LEFT, BOTTOM, RIGHT, BOTTOM, paddles[0].goalFlash, active[0].color);
      drawGoalLine(LEFT, TOP, RIGHT, TOP, paddles[1].goalFlash, active[1].color);
      drawGoalLine(LEFT, TOP, LEFT, BOTTOM, paddles[2].goalFlash, active[2].color);
      drawGoalLine(RIGHT, TOP, RIGHT, BOTTOM, paddles[3].goalFlash, active[3].color);

      for (const c of corners) {
        ctx.save();
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = c.pulse > 0 ? 26 : 12;
        ctx.fillStyle = c.pulse > 0 ? '#ffffff' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 16 + (c.pulse > 0 ? 3 : 0), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(CX, CY, 62, 0, Math.PI * 2);
      ctx.stroke();

      const drawPaddle = (slot: number, x: number, y: number, w: number, h: number) => {
        const sm = paddles[slot].smashFrames > 0;
        ctx.save();
        ctx.fillStyle = sm ? '#ffffff' : active[slot].color;
        ctx.shadowColor = sm ? '#ff6b2b' : active[slot].color;
        ctx.shadowBlur = sm ? 26 : 16;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();
        if (sm) {
          ctx.strokeStyle = '#ff6b2b';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
        ctx.restore();
      };

      if (active[0].enabled) drawPaddle(0, paddles[0].pos - padHalfH, BOTTOM - 14 - (paddles[0].smashFrames > 0 ? 4 : 0), padHalfH * 2, 10);
      if (active[1].enabled) drawPaddle(1, paddles[1].pos - padHalfH, TOP + 4 + (paddles[1].smashFrames > 0 ? 4 : 0), padHalfH * 2, 10);
      if (active[2].enabled) drawPaddle(2, LEFT + 4 + (paddles[2].smashFrames > 0 ? 4 : 0), paddles[2].pos - padHalfV, 10, padHalfV * 2);
      if (active[3].enabled) drawPaddle(3, RIGHT - 14 - (paddles[3].smashFrames > 0 ? 4 : 0), paddles[3].pos - padHalfV, 10, padHalfV * 2);

      for (const ball of balls) {
        const bColor = ball.powered ? '#ff6b2b' : ball.lastHit >= 0 ? active[ball.lastHit].color : '#ffffff';
        ball.trail.forEach((pt, idx) => {
          ctx.globalAlpha = ((idx + 1) / ball.trail.length) * (ball.powered ? 0.48 : 0.28);
          ctx.fillStyle = bColor;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4 + idx * 0.45, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;

        ctx.save();
        ctx.shadowColor = bColor;
        ctx.shadowBlur = ball.powered ? 28 : 20;
        ctx.fillStyle = bColor;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (winnerText) {
        drawRoundBanner(
          ctx,
          winnerText,
          active.filter((a) => a.enabled).length === 1 ? '7-RETURN STREAK! NEXT MATCH...' : 'FIRST TO 7 VICTORY! NEXT MATCH...',
          '#38bdf8',
        );
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderIdx,
          valueText: `${paddles[i].pts}/${TARGET_POINTS} · W${paddles[i].wins}`,
        })),
        'SLIDE: STICK / WASD  ·  SPRINT: HOLD A / SPACE (TAP = POWER SMASH)',
      );
    },
  };
}

// 3. LASER CYCLE (Shield & EMP Pickups, Flood-Fill + 3-Step Lookahead AI, Grazing Bolts, Hitstop & Confetti)
export function createLaserCycleEngine(): MiniGameEngine {
  const CELL = 8;
  const COLS = Math.floor((GAME_WIDTH - 80) / CELL);
  const ROWS = Math.floor((GAME_HEIGHT - 104) / CELL);
  const OX = 40;
  const OY = 72;

  const scores = [0, 0, 0, 0];
  const grid = new Int8Array(COLS * ROWS);
  type Bike = {
    x: number;
    y: number;
    dx: number;
    dy: number;
    // Direction of the last actual grid step — turns are validated against this so a
    // quick double-tap between steps can never reverse a bike into its own trail.
    mdx: number;
    mdy: number;
    alive: boolean;
    boost: boolean;
    shield: number;
    slowed: number;
    grazeCd: number;
  };
  let bikes: Bike[] = [];
  type CyclePickup = { x: number; y: number; kind: 'shield' | 'emp'; pulse: number };
  let pickups: CyclePickup[] = [];
  let freezeFrames = 24;
  let banner = '';
  let bannerSub = '';
  let roundTicks = 0;
  const makeBike = (x: number, y: number, dx: number): Bike => ({
    x,
    y,
    dx,
    dy: 0,
    mdx: dx,
    mdy: 0,
    alive: true,
    boost: false,
    shield: 0,
    slowed: 0,
    grazeCd: 0,
  });

  const spawnPickup = () => {
    for (let tries = 0; tries < 25; tries++) {
      const x = 6 + Math.floor(Math.random() * (COLS - 12));
      const y = 6 + Math.floor(Math.random() * (ROWS - 12));
      if (grid[y * COLS + x] === -1) {
        pickups.push({ x, y, kind: Math.random() < 0.55 ? 'shield' : 'emp', pulse: 0 });
        break;
      }
    }
  };

  const spawnRound = () => {
    grid.fill(-1);
    bikes = [
      makeBike(16, 14, 1),
      makeBike(COLS - 17, ROWS - 15, -1),
      makeBike(COLS - 17, 14, -1),
      makeBike(16, ROWS - 15, 1),
    ];
    pickups = [];
    spawnPickup();
    spawnPickup();
    banner = '';
    bannerSub = '';
    roundTicks = 0;
    freezeFrames = 60;
  };
  spawnRound();
  // The console's boot intro already counted the first round in.
  freezeFrames = 0;

  const isBlocked = (tx: number, ty: number) =>
    tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS || grid[ty * COLS + tx] !== -1;

  // Bounded flood-fill reachable open space count — allocation-free (stamp array + typed queue)
  const seenStamp = new Int32Array(COLS * ROWS);
  const floodQueue = new Int32Array(COLS * ROWS);
  let stamp = 0;
  const floodSpace = (sx: number, sy: number, limit = 65): number => {
    if (isBlocked(sx, sy)) return 0;
    stamp++;
    let head = 0;
    let tail = 0;
    const startKey = sy * COLS + sx;
    seenStamp[startKey] = stamp;
    floodQueue[tail++] = startKey;
    let count = 1;
    while (head < tail && count < limit) {
      const key = floodQueue[head++];
      const cx = key % COLS;
      const cy = (key - cx) / COLS;
      for (let d = 0; d < 4; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (isBlocked(nx, ny)) continue;
        const nKey = ny * COLS + nx;
        if (seenStamp[nKey] === stamp) continue;
        seenStamp[nKey] = stamp;
        floodQueue[tail++] = nKey;
        count++;
      }
    }
    return count;
  };

  const derez = (
    i: number,
    cellX: number,
    cellY: number,
    color: string,
    env: GameLoopContext,
    label = 'DEREZZED!',
  ) => {
    const { vfx, sound, rumble } = env;
    bikes[i].alive = false;
    const px = OX + cellX * CELL + CELL / 2;
    const py = OY + cellY * CELL + CELL / 2;
    vfx.hitstop(3);
    vfx.burst(px, py, color, 28, 7);
    vfx.burst(px, py, '#ffffff', 10, 4);
    vfx.ring(px, py, color, 85, 3.5);
    vfx.popup(px, py - 14, label, color, 15);
    vfx.shake(9);
    sound.explosion();
    rumble(i, 165, 0.9);
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      if (freezeFrames > 0) {
        freezeFrames--;
        if (freezeFrames === 0) {
          if (banner) {
            spawnRound();
          } else {
            // Light-cycles launch
            vfx.popup(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'GO!', '#2ee59d', 26);
            vfx.ring(GAME_WIDTH / 2, GAME_HEIGHT / 2, '#2ee59d', 140, 4);
            sound.sweep(330, 990, 0.18, 'sawtooth', 0.09);
          }
        } else if (!banner && freezeFrames % 20 === 0) {
          sound.beep(520, 0.06, 'triangle', 0.08);
        }
      } else {
        roundTicks++;
        if (frame % 180 === 0 && pickups.length < 4) {
          spawnPickup();
        }
        for (const pk of pickups) pk.pulse += 0.1;

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !bikes[i].alive) continue;
          const b = bikes[i];
          if (b.slowed > 0) b.slowed--;
          if (b.grazeCd > 0) b.grazeCd--;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            if (Math.abs(inp.x) > Math.abs(inp.y) && Math.abs(inp.x) > 0.35) {
              const ndx = inp.x > 0 ? 1 : -1;
              if (ndx !== -b.mdx) {
                b.dx = ndx;
                b.dy = 0;
              }
            } else if (Math.abs(inp.y) > Math.abs(inp.x) && Math.abs(inp.y) > 0.35) {
              const ndy = inp.y > 0 ? 1 : -1;
              if (ndy !== -b.mdy) {
                b.dx = 0;
                b.dy = ndy;
              }
            }
            b.boost = inp.actionA;
          } else {
            // 3-step lookahead + flood-fill AI (relative to the last committed step)
            let bestDx = b.mdx;
            let bestDy = b.mdy;
            let bestVal = -Infinity;
            for (let c = 0; c < 3; c++) {
              const ddx = c === 0 ? b.mdx : c === 1 ? b.mdy : -b.mdy;
              const ddy = c === 0 ? b.mdy : c === 1 ? -b.mdx : b.mdx;
              let clear3 = 0;
              for (let s = 1; s <= 3; s++) {
                if (!isBlocked(b.x + ddx * s, b.y + ddy * s)) clear3++;
                else break;
              }
              if (clear3 === 0) continue;
              const space = floodSpace(b.x + ddx, b.y + ddy, 60);
              let pickupBonus = 0;
              for (const pk of pickups) {
                const distNow = Math.hypot(pk.x - b.x, pk.y - b.y);
                const distNext = Math.hypot(pk.x - (b.x + ddx), pk.y - (b.y + ddy));
                if (distNext < distNow && distNow < 26) pickupBonus += 14;
              }
              const straightBias = c === 0 ? 5 : 0;
              const score = space * 2 + clear3 * 12 + pickupBonus + straightBias + Math.random() * 2;
              if (score > bestVal) {
                bestVal = score;
                bestDx = ddx;
                bestDy = ddy;
              }
            }
            b.dx = bestDx;
            b.dy = bestDy;
            b.boost = !isBlocked(b.x + b.dx * 4, b.y + b.dy * 4) && Math.random() < 0.25;
          }
        }

        let anyBoost = false;
        for (let i = 0; i < 4; i++) {
          if (active[i].enabled && bikes[i].alive && bikes[i].boost) anyBoost = true;
        }
        const shouldStep = frame % 3 === 0 || (frame % 2 === 0 && anyBoost);
        if (shouldStep) {
          // Cells that bike heads moved into this tick — used to resolve head-on collisions fairly
          const movedHeads: number[] = [-1, -1, -1, -1];
          for (let i = 0; i < 4; i++) {
            const b = bikes[i];
            if (!active[i].enabled || !b.alive) continue;
            if (!b.boost && frame % 3 !== 0) continue;
            if (b.slowed > 0 && frame % 6 !== 0) continue;

            grid[b.y * COLS + b.x] = i;
            const nx = b.x + b.dx;
            const ny = b.y + b.dy;

            const outOfBounds = nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS;
            const hitTrail = !outOfBounds && grid[ny * COLS + nx] !== -1;

            if (outOfBounds || hitTrail) {
              if (b.shield > 0) {
                b.shield--;
                const px = OX + b.x * CELL + CELL / 2;
                const py = OY + b.y * CELL + CELL / 2;
                vfx.hitstop(2);
                vfx.ring(px, py, '#38bdf8', 58, 3);
                vfx.burst(px, py, '#38bdf8', 16, 5);
                vfx.popup(px, py - 12, 'SHIELD SAVE!', '#38bdf8', 13);
                sound.hit();
                rumble(i, 90, 0.6);
                if (outOfBounds) {
                  // Turn along an in-bounds perpendicular without advancing this tick
                  const lx = b.dy;
                  const ly = -b.dx;
                  const lIn = b.x + lx >= 0 && b.x + lx < COLS && b.y + ly >= 0 && b.y + ly < ROWS;
                  const lOpen = !isBlocked(b.x + lx, b.y + ly);
                  const rOpen = !isBlocked(b.x - lx, b.y - ly);
                  const useLeft = lOpen || (!rOpen && lIn);
                  b.dx = useLeft ? lx : -lx;
                  b.dy = useLeft ? ly : -ly;
                  b.mdx = b.dx;
                  b.mdy = b.dy;
                } else {
                  // Shatter 3x3 hole through trail
                  for (let ry = -1; ry <= 1; ry++) {
                    for (let rx = -1; rx <= 1; rx++) {
                      const gx = nx + rx;
                      const gy = ny + ry;
                      if (gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS) {
                        grid[gy * COLS + gx] = -1;
                      }
                    }
                  }
                  b.x = nx;
                  b.y = ny;
                  b.mdx = b.dx;
                  b.mdy = b.dy;
                  grid[b.y * COLS + b.x] = i;
                  movedHeads[i] = b.y * COLS + b.x;
                }
                continue;
              }

              derez(i, nx, ny, active[i].color, env);
              // Head-on: if we slammed into the head another bike just moved into, both derez
              if (hitTrail) {
                const key = ny * COLS + nx;
                for (let j = 0; j < 4; j++) {
                  if (j === i || movedHeads[j] !== key || !bikes[j].alive) continue;
                  if (bikes[j].shield > 0) {
                    bikes[j].shield--;
                    continue;
                  }
                  derez(j, nx, ny, active[j].color, env, 'HEAD-ON!');
                }
              }
            } else {
              b.x = nx;
              b.y = ny;
              b.mdx = b.dx;
              b.mdy = b.dy;
              grid[b.y * COLS + b.x] = i;
              movedHeads[i] = b.y * COLS + b.x;
              const px = OX + b.x * CELL + CELL / 2;
              const py = OY + b.y * CELL + CELL / 2;

              if (b.boost) {
                vfx.afterimage(px, py, CELL * 0.85, active[i].color, 8);
                vfx.spark(px, py, -b.dx * 2.2, -b.dy * 2.2, active[i].color, 3);
              }

              // Close-call grazing spark/bolt next to enemy trails
              if (b.grazeCd === 0) {
                for (let d = 0; d < 4; d++) {
                  const ax = b.x + (d === 0 ? 1 : d === 1 ? -1 : 0);
                  const ay = b.y + (d === 2 ? 1 : d === 3 ? -1 : 0);
                  if (ax >= 0 && ax < COLS && ay >= 0 && ay < ROWS) {
                    const owner = grid[ay * COLS + ax];
                    if (owner >= 0 && owner !== i) {
                      vfx.bolt(px, py, OX + ax * CELL + CELL / 2, OY + ay * CELL + CELL / 2, '#facc15');
                      b.grazeCd = 16;
                      sound.beep(1120, 0.03, 'triangle', 0.05);
                      break;
                    }
                  }
                }
              }

              // Pickup collection
              for (let pIdx = pickups.length - 1; pIdx >= 0; pIdx--) {
                const pk = pickups[pIdx];
                if (Math.abs(pk.x - b.x) <= 1 && Math.abs(pk.y - b.y) <= 1) {
                  if (pk.kind === 'shield') {
                    b.shield = 1;
                    vfx.ring(px, py, '#38bdf8', 55, 3);
                    vfx.popup(px, py - 12, 'SHIELD!', '#38bdf8', 13);
                    sound.pickup(180);
                    rumble(i, 50, 0.4);
                  } else {
                    // EMP Pulse clears trails around bike & zaps nearby rivals
                    vfx.ring(px, py, '#c084fc', 110, 4);
                    vfx.popup(px, py - 12, 'EMP PULSE!', '#c084fc', 14);
                    vfx.shake(4);
                    sound.combo(4);
                    rumble(i, 70, 0.55);
                    for (let ry = -6; ry <= 6; ry++) {
                      for (let rx = -6; rx <= 6; rx++) {
                        if (rx * rx + ry * ry <= 36) {
                          const gx = b.x + rx;
                          const gy = b.y + ry;
                          if (gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS && grid[gy * COLS + gx] !== i) {
                            grid[gy * COLS + gx] = -1;
                          }
                        }
                      }
                    }
                    for (let j = 0; j < 4; j++) {
                      if (j !== i && active[j].enabled && bikes[j].alive) {
                        bikes[j].slowed = 45;
                        vfx.bolt(px, py, OX + bikes[j].x * CELL, OY + bikes[j].y * CELL, '#c084fc');
                        rumble(j, 80, 0.5);
                      }
                    }
                  }
                  pickups.splice(pIdx, 1);
                }
              }
            }
          }

          let aliveCount = 0;
          let lastAlive = -1;
          let totalActive = 0;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            totalActive++;
            if (bikes[i].alive) {
              aliveCount++;
              lastAlive = i;
            }
          }
          if ((totalActive > 1 && aliveCount <= 1) || (totalActive === 1 && aliveCount === 0)) {
            if (totalActive === 1) {
              const secs = (roundTicks / 60).toFixed(1);
              const soloIdx = Math.max(0, active.findIndex((a) => a.enabled));
              banner = `${active[soloIdx].name} DEREZZED`;
              bannerSub = `SURVIVED ${secs}s · NEW GRID INITIALIZING...`;
            } else if (aliveCount === 1) {
              const w = lastAlive;
              scores[w]++;
              banner = `${active[w].name} SURVIVES!`;
              bannerSub = 'LAST RIDER ON THE GRID · NEW GRID INITIALIZING...';
              sound.win();
              vfx.flash(active[w].color, 0.22);
              const wx = OX + bikes[w].x * CELL;
              const wy = OY + bikes[w].y * CELL;
              vfx.ring(wx, wy, active[w].color, 130, 5);
              vfx.confetti(wx, wy, 40);
              vfx.confetti(GAME_WIDTH / 2, 150, 30);
              rumble(w, 260, 1);
            } else {
              banner = 'DOUBLE CRASH!';
              bannerSub = 'NOBODY WALKS AWAY · NEW GRID INITIALIZING...';
            }
            freezeFrames = 85;
          }
        }
      }

      drawArcadeBackdrop(ctx, '#2ee59d');

      ctx.strokeStyle = 'rgba(46, 229, 157, 0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(OX - 2, OY - 2, COLS * CELL + 4, ROWS * CELL + 4);

      // Batched per-owner trail pass (one fillStyle change per rider instead of per cell)
      const cellCount = COLS * ROWS;
      for (let owner = 0; owner < 4; owner++) {
        ctx.fillStyle = active[owner].color;
        for (let k = 0; k < cellCount; k++) {
          if (grid[k] !== owner) continue;
          const c = k % COLS;
          const r = (k - c) / COLS;
          ctx.fillRect(OX + c * CELL + 1, OY + r * CELL + 1, CELL - 2, CELL - 2);
        }
      }

      for (const pk of pickups) {
        const px = OX + pk.x * CELL + CELL / 2;
        const py = OY + pk.y * CELL + CELL / 2;
        const col = pk.kind === 'shield' ? '#38bdf8' : '#c084fc';
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 16;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px, py, 7 + Math.sin(pk.pulse) * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !bikes[i].alive) continue;
        const b = bikes[i];
        const px = OX + b.x * CELL;
        const py = OY + b.y * CELL;
        ctx.save();
        ctx.shadowColor = active[i].color;
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(px, py, CELL, CELL);
        if (b.shield > 0) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(px + CELL / 2, py + CELL / 2, 10, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub || 'NEW GRID INITIALIZING...', '#2ee59d');
      } else if (freezeFrames > 0) {
        ctx.save();
        ctx.fillStyle = '#2ee59d';
        ctx.font = '800 30px "Bricolage Grotesque", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(frame * 0.15));
        ctx.fillText(`GET READY · ${Math.ceil(freezeFrames / 20)}`, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10);
        ctx.restore();
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          valueText: `${bikes[i].alive ? 'ON' : 'KO'} · W${scores[i]}`,
        })),
        'TURN: D-PAD / STICK / WASD  ·  TURBO: A / SPACE  ·  BLUE: SHIELD  ·  PURPLE: EMP',
      );
    },
  };
}

// 4. SUMO RING (Hold-A Mega Bull Rush, Rotating Cracked Hazard Tiles, Dizzy Stun Stars, Edge Flash, Hitstop)
export function createSumoRingEngine(): MiniGameEngine {
  const CX = GAME_WIDTH / 2;
  const CY = 288;
  const scores = [0, 0, 0, 0];
  let ringRadius = 198;
  let roundFreeze = 26;
  let banner = '';
  let tileAngle = 0;

  const bots = Array.from({ length: 4 }, (_, i) => ({
    x: CX + Math.cos((i * Math.PI) / 2) * 90,
    y: CY + Math.sin((i * Math.PI) / 2) * 90,
    vx: 0,
    vy: 0,
    angle: (i * Math.PI) / 2 + Math.PI,
    alive: true,
    chargeCd: 0,
    chargeHold: 0,
    rushFrames: 0,
    rushMult: 1,
    stunFrames: 0,
    flashFrames: 0,
    wasHoldingA: false,
    // Per-bot personality so CPU wrestlers don't replay identical rounds
    botHold: 10 + Math.floor(Math.random() * 26),
    botOrbit: Math.random() < 0.5 ? 1 : -1,
  }));

  const resetRound = () => {
    ringRadius = 198;
    banner = '';
    roundFreeze = 24;
    tileAngle = 0;
    bots.forEach((b, i) => {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      b.x = CX + Math.cos(a) * 95;
      b.y = CY + Math.sin(a) * 95;
      b.vx = 0;
      b.vy = 0;
      b.angle = a + Math.PI;
      b.alive = true;
      b.chargeCd = 0;
      b.chargeHold = 0;
      b.rushFrames = 0;
      b.rushMult = 1;
      b.stunFrames = 0;
      b.flashFrames = 0;
      b.wasHoldingA = false;
      b.botHold = 10 + Math.floor(Math.random() * 26);
      b.botOrbit = Math.random() < 0.5 ? 1 : -1;
    });
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      let edgeDanger = false;

      if (roundFreeze > 0) {
        roundFreeze--;
        if (roundFreeze === 0 && banner) resetRound();
      } else {
        ringRadius = Math.max(82, ringRadius - 0.13);
        tileAngle += 0.008;

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !bots[i].alive) continue;
          const b = bots[i];
          let ix = 0;
          let iy = 0;
          let holdA = false;

          if (b.stunFrames > 0) b.stunFrames--;
          if (b.flashFrames > 0) b.flashFrames--;
          if (b.rushFrames > 0) b.rushFrames--;
          if (b.chargeCd > 0) b.chargeCd--;

          if (b.stunFrames === 0) {
            if (active[i].isHuman) {
              const inp = readPlayerInput(i, pads, keys);
              ix = inp.x;
              iy = inp.y;
              holdA = inp.actionA;
            } else {
              const distC = Math.hypot(b.x - CX, b.y - CY);
              if (distC > ringRadius - 42) {
                ix = (CX - b.x) / (distC || 1);
                iy = (CY - b.y) / (distC || 1);
                holdA = false;
              } else {
                // Hunt the nearest live rival (not always the same slot)
                let target: (typeof bots)[0] | undefined;
                let bestD = Infinity;
                for (let j = 0; j < 4; j++) {
                  if (j === i || !active[j].enabled || !bots[j].alive) continue;
                  const dj = Math.hypot(bots[j].x - b.x, bots[j].y - b.y);
                  if (dj < bestD) {
                    bestD = dj;
                    target = bots[j];
                  }
                }
                if (target) {
                  const d = Math.hypot(target.x - b.x, target.y - b.y) || 1;
                  // Circle-in on the target (flank) rather than a dead-straight approach
                  const flank = d > 120 ? 0.35 * b.botOrbit : 0;
                  const tx = (target.x - b.x) / d;
                  const ty = (target.y - b.y) / d;
                  ix = (tx - ty * flank) * 0.85;
                  iy = (ty + tx * flank) * 0.85;
                  if (d < 115 && b.chargeCd === 0 && b.chargeHold < b.botHold) {
                    holdA = true;
                  }
                  if (b.chargeHold === 0 && Math.random() < 0.01) b.botOrbit = -b.botOrbit;
                }
              }
            }
          }

          if (Math.hypot(ix, iy) > 0.15) {
            b.angle = Math.atan2(iy, ix);
          }

          // Hold-A to charge Mega Bull Rush, release to launch!
          if (b.stunFrames > 0) {
            // Getting stunned fizzles a held charge instead of auto-launching it
            if (b.chargeHold > 0) {
              b.chargeHold = 0;
              vfx.popup(b.x, b.y - 30, 'FIZZLE', '#94a3b8', 11);
            }
            holdA = false;
          } else if (holdA && b.chargeCd === 0) {
            b.chargeHold = Math.min(45, b.chargeHold + 1);
            if (b.chargeHold % 6 === 0) {
              vfx.spark(b.x + (Math.random() - 0.5) * 28, b.y + (Math.random() - 0.5) * 28, 0, -1, '#facc15', 3);
            }
          } else if (b.wasHoldingA && !holdA && b.chargeHold > 0 && b.chargeCd === 0) {
            const chargeRatio = b.chargeHold / 45;
            const power = 9.5 + chargeRatio * 9.5;
            b.vx += Math.cos(b.angle) * power;
            b.vy += Math.sin(b.angle) * power;
            b.rushMult = 1 + chargeRatio * 1.35;
            b.rushFrames = 16;
            b.chargeCd = 44;
            b.chargeHold = 0;
            vfx.ring(b.x, b.y, chargeRatio > 0.6 ? '#facc15' : active[i].color, 58, 3.5);
            vfx.burst(b.x, b.y, active[i].color, 10, 4.5);
            if (chargeRatio > 0.85) {
              vfx.shake(3);
              vfx.popup(b.x, b.y - 30, 'MEGA RUSH!', '#facc15', 13);
            }
            sound.dash();
            rumble(i, 65, 0.4 + chargeRatio * 0.4);
          } else if (!holdA) {
            b.chargeHold = 0;
          }
          b.wasHoldingA = holdA;

          if (b.rushFrames > 0) {
            vfx.afterimage(b.x, b.y, 22, active[i].color, 8);
          }

          const moveScale = b.chargeHold > 0 ? 0.28 : 0.58;
          b.vx = (b.vx + ix * moveScale) * 0.92;
          b.vy = (b.vy + iy * moveScale) * 0.92;
          b.x += b.vx;
          b.y += b.vy;

          // Cracked hazard floor tile check (3 rotating hot cracked zones)
          const distCenter = Math.hypot(b.x - CX, b.y - CY);
          if (distCenter > 24 && distCenter < ringRadius - 12) {
            const pAng = Math.atan2(b.y - CY, b.x - CX);
            for (let t = 0; t < 3; t++) {
              const tAng = tileAngle + (t * Math.PI * 2) / 3;
              let diff = Math.abs(pAng - tAng);
              while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
              if (diff < 0.24 && distCenter > ringRadius * 0.4 && distCenter < ringRadius * 0.85) {
                // Cracked magma fissure nudges outwards & sparks
                b.vx += Math.cos(pAng) * 0.24;
                b.vy += Math.sin(pAng) * 0.24;
                if (frame % 6 === 0) {
                  vfx.spark(b.x, b.y, (Math.random() - 0.5) * 2, -1.5, '#fb7185', 2.5);
                }
              }
            }
          }

          if (distCenter > ringRadius - 26) edgeDanger = true;

          if (distCenter > ringRadius + 10) {
            b.alive = false;
            vfx.hitstop(3);
            vfx.burst(b.x, b.y, active[i].color, 28, 7.5);
            vfx.ring(b.x, b.y, '#fb7185', 85, 4);
            vfx.popup(b.x, b.y - 16, 'RING OUT!', '#fb7185', 16);
            vfx.shake(11);
            sound.explosion();
            rumble(i, 190, 0.95);
          }
        }

        // Collisions
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !bots[i].alive) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled || !bots[j].alive) continue;
            const a = bots[i];
            const b = bots[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0 && dist < 44) {
              const nx = dx / dist;
              const ny = dy / dist;
              const overlap = (44 - dist) / 2;
              a.x -= nx * overlap;
              a.y -= ny * overlap;
              b.x += nx * overlap;
              b.y += ny * overlap;
              const multA = a.rushFrames > 0 ? a.rushMult : 1;
              const multB = b.rushFrames > 0 ? b.rushMult : 1;
              a.vx -= nx * 7.6 * multB;
              a.vy -= ny * 7.6 * multB;
              b.vx += nx * 7.6 * multA;
              b.vy += ny * 7.6 * multA;
              a.flashFrames = 8;
              b.flashFrames = 8;
              const cx = (a.x + b.x) / 2;
              const cy = (a.y + b.y) / 2;
              vfx.burst(cx, cy, '#ffffff', 12, 5.5);
              vfx.ring(cx, cy, '#fb7185', 50, 2.5);
              if (multB > 1.4) {
                a.stunFrames = 32;
                vfx.popup(a.x, a.y - 24, 'STUNNED!', '#facc15', 14);
              }
              if (multA > 1.4) {
                b.stunFrames = 32;
                vfx.popup(b.x, b.y - 24, 'STUNNED!', '#facc15', 14);
              }
              if (multA > 1.4 || multB > 1.4) {
                vfx.hitstop(2);
                vfx.shake(8);
                vfx.bolt(a.x, a.y, b.x, b.y, '#facc15');
              } else {
                vfx.shake(4);
              }
              sound.hit();
              rumble(i, 85, 0.7);
              rumble(j, 85, 0.7);
            }
          }
        }

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && bots[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          if (alive.length === 1) {
            const w = alive[0];
            scores[w]++;
            banner = `${active[w].name} YOKOZUNA!`;
            sound.win();
            vfx.flash(active[w].color, 0.24);
            vfx.ring(bots[w].x, bots[w].y, active[w].color, 130, 5);
            vfx.confetti(CX, CY, 42);
            vfx.confetti(bots[w].x, bots[w].y, 24);
            rumble(w, 260, 1);
          } else {
            banner = total === 1 ? 'RING OUT!' : 'RING OUT DRAW!';
          }
          roundFreeze = 90;
        }
      }

      let leaderIdx = -1;
      let maxWins = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && scores[i] > maxWins) {
          maxWins = scores[i];
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#fb7185');

      // Sumo Ring + Edge Danger Flash
      const dangerFlash = (edgeDanger || ringRadius < 110) && Math.floor(frame / 6) % 2 === 0;
      ctx.save();
      ctx.fillStyle = '#181c26';
      ctx.strokeStyle = dangerFlash ? '#facc15' : '#fb7185';
      ctx.lineWidth = dangerFlash ? 6 : 4;
      ctx.shadowColor = dangerFlash ? '#facc15' : '#fb7185';
      ctx.shadowBlur = dangerFlash ? 30 : 22;
      ctx.beginPath();
      ctx.arc(CX, CY, ringRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Rotating Cracked Hazard Floor Tiles
      ctx.save();
      for (let t = 0; t < 3; t++) {
        const a0 = tileAngle + (t * Math.PI * 2) / 3;
        ctx.fillStyle = 'rgba(251, 113, 133, 0.16)';
        ctx.strokeStyle = 'rgba(251, 113, 133, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(CX, CY, ringRadius * 0.85, a0 - 0.24, a0 + 0.24);
        ctx.arc(CX, CY, ringRadius * 0.4, a0 + 0.24, a0 - 0.24, true);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(CX, CY, ringRadius * 0.4, 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !bots[i].alive) continue;
        const b = bots[i];
        if (b.chargeHold > 0) {
          ctx.save();
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 28 + Math.sin(frame * 0.4) * 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (b.chargeHold / 45));
          ctx.stroke();
          ctx.restore();
        }
        drawPlayerOrb(ctx, b.x, b.y, 21, active[i].color, i, {
          angle: b.angle,
          leader: i === leaderIdx,
          flash: b.flashFrames > 0 || b.rushFrames > 0,
          cooldownPct: b.chargeCd / 44,
        });
        // Dizzy Stun Stars
        if (b.stunFrames > 0) {
          for (let s = 0; s < 3; s++) {
            const sa = frame * 0.22 + (s * Math.PI * 2) / 3;
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.arc(b.x + Math.cos(sa) * 16, b.y - 24 + Math.sin(sa) * 5, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'RESETTING DOJO...', '#fb7185');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderIdx,
          valueText: `${bots[i].alive ? 'IN' : 'OUT'} · W${scores[i]}`,
        })),
        'PUSH: STICK / WASD  ·  HOLD A / SPACE TO CHARGE MEGA BULL RUSH, RELEASE TO LAUNCH!',
      );
    },
  };
}

// 5. METEOR DODGE (Splitter Asteroids w/ Heat Craters, Time-Slow & Shield Orbs, Phase-Blink + Invuln, Thrusters, Waves)
export function createMeteorDodgeEngine(): MiniGameEngine {
  const scores = [0, 0, 0, 0];
  let ships: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    angle: number;
    alive: boolean;
    shield: number;
    blinkCd: number;
    invuln: number;
    prevBlink: boolean;
    aiX: number;
    aiY: number;
  }> = [];

  type Meteor = { x: number; y: number; vx: number; vy: number; r: number; kind: 'normal' | 'splitter' | 'shard'; rot: number; age: number };
  let meteors: Meteor[] = [];
  let orbPickup = { x: GAME_WIDTH / 2, y: 288, kind: 'shield' as 'shield' | 'slow', active: true, respawn: 0 };
  let slowFrames = 0;
  let wave = 1;
  let waveTick = 0;
  let banner = '';
  let freeze = 20;

  const reset = () => {
    ships = [0, 1, 2, 3].map((i) => ({
      x: GAME_WIDTH * (0.32 + i * 0.12),
      y: 295,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      alive: true,
      shield: 0,
      blinkCd: 0,
      invuln: 30,
      prevBlink: false,
      aiX: 0,
      aiY: 0,
    }));
    meteors = [];
    orbPickup = { x: GAME_WIDTH / 2, y: 288, kind: 'shield', active: true, respawn: 0 };
    slowFrames = 0;
    wave = 1;
    waveTick = 0;
    banner = '';
    freeze = 20;
  };
  reset();

  const spawnShards = (m: Meteor, vfx: GameLoopContext['vfx']) => {
    const baseAngle = Math.atan2(m.vy, m.vx);
    const spd = Math.hypot(m.vx, m.vy) * 1.45;
    [-0.55, 0.55].forEach((offset) => {
      meteors.push({
        x: m.x,
        y: m.y,
        vx: Math.cos(baseAngle + offset) * spd,
        vy: Math.sin(baseAngle + offset) * spd,
        r: 9,
        kind: 'shard',
        rot: Math.random() * Math.PI * 2,
        age: 0,
      });
    });
    vfx.burst(m.x, m.y, '#fb923c', 12, 4.5);
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        waveTick++;
        if (waveTick % 600 === 0) {
          wave++;
          vfx.popup(GAME_WIDTH / 2, 130, `WAVE ${wave}!`, '#facc15', 18);
          sound.combo(wave);
        }
        if (slowFrames > 0) slowFrames--;

        if (!orbPickup.active) {
          orbPickup.respawn--;
          if (orbPickup.respawn <= 0) {
            orbPickup.x = 100 + Math.random() * (GAME_WIDTH - 200);
            orbPickup.y = 110 + Math.random() * (GAME_HEIGHT - 190);
            orbPickup.kind = Math.random() < 0.55 ? 'shield' : 'slow';
            orbPickup.active = true;
          }
        }

        const spawnEvery = Math.max(8, 16 - wave * 2);
        const maxMeteors = Math.min(38, 22 + wave * 3);
        if (frame % spawnEvery === 0 && meteors.length < maxMeteors) {
          const edge = Math.floor(Math.random() * 4);
          let x = 0, y = 0, vx = 0, vy = 0;
          const spd = 2.4 + wave * 0.28 + Math.random() * 2.4;
          if (edge === 0) {
            x = 40 + Math.random() * (GAME_WIDTH - 80);
            y = 72;
            vx = (Math.random() - 0.5) * 2.5;
            vy = spd;
          } else if (edge === 1) {
            x = GAME_WIDTH - 36;
            y = 80 + Math.random() * (GAME_HEIGHT - 120);
            vx = -spd;
            vy = (Math.random() - 0.5) * 2.5;
          } else if (edge === 2) {
            x = 40 + Math.random() * (GAME_WIDTH - 80);
            y = GAME_HEIGHT - 38;
            vx = (Math.random() - 0.5) * 2.5;
            vy = -spd;
          } else {
            x = 36;
            y = 80 + Math.random() * (GAME_HEIGHT - 120);
            vx = spd;
            vy = (Math.random() - 0.5) * 2.5;
          }
          const isSplitter = Math.random() < 0.25 + wave * 0.03;
          meteors.push({
            x,
            y,
            vx,
            vy,
            r: isSplitter ? 21 : 10 + Math.random() * 5,
            kind: isSplitter ? 'splitter' : 'normal',
            rot: Math.random() * Math.PI * 2,
            age: 0,
          });
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !ships[i].alive) continue;
          const s = ships[i];
          let ix = 0, iy = 0, blinkPressed = false;
          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            blinkPressed = inp.actionA || inp.actionB;
          } else if ((frame + i * 2) % 4 !== 0) {
            // Human-ish reaction time: bots only re-think their steering every 4th frame
            ix = s.aiX;
            iy = s.aiY;
          } else {
            // Sum repulsion from meteors' predicted positions + soft wall avoidance
            let rx = 0;
            let ry = 0;
            let best = Infinity;
            for (const m of meteors) {
              const px = m.x + m.vx * 8;
              const py = m.y + m.vy * 8;
              const d = Math.hypot(px - s.x, py - s.y);
              const dNow = Math.hypot(m.x - s.x, m.y - s.y) - m.r;
              if (dNow < best) best = dNow;
              if (d < 150) {
                const w = (150 - d) / 150;
                rx += ((s.x - px) / (d || 1)) * w * w * 2.2;
                ry += ((s.y - py) / (d || 1)) * w * w * 2.2;
              }
            }
            // Spread out: bots repel each other so they never stack into one blob
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled || !ships[j].alive) continue;
              const ox = s.x - ships[j].x;
              const oy = s.y - ships[j].y;
              const od = Math.hypot(ox, oy);
              if (od < 90) {
                rx += (ox / (od || 1)) * ((90 - od) / 90) * 0.9;
                ry += (oy / (od || 1)) * ((90 - od) / 90) * 0.9;
              }
            }
            if (s.x < 110) rx += (110 - s.x) / 80;
            if (s.x > GAME_WIDTH - 110) rx -= (s.x - (GAME_WIDTH - 110)) / 80;
            if (s.y < 140) ry += (140 - s.y) / 80;
            if (s.y > GAME_HEIGHT - 100) ry -= (s.y - (GAME_HEIGHT - 100)) / 80;
            const rMag = Math.hypot(rx, ry);
            if (rMag > 0.25) {
              ix = rx / Math.max(1, rMag);
              iy = ry / Math.max(1, rMag);
              if (best < 26 && s.blinkCd === 0 && s.invuln === 0 && Math.random() < 0.7) blinkPressed = true;
            } else if (orbPickup.active) {
              const dx = orbPickup.x - s.x;
              const dy = orbPickup.y - s.y;
              const d = Math.hypot(dx, dy) || 1;
              ix = (dx / d) * 0.7;
              iy = (dy / d) * 0.7;
            } else {
              // Drift back to a per-slot home lane
              ix = (GAME_WIDTH * (0.26 + i * 0.16) - s.x) * 0.01;
              iy = (290 - s.y) * 0.01;
            }
            s.aiX = ix;
            s.aiY = iy;
          }

          const blinkEdge = blinkPressed && !s.prevBlink;
          s.prevBlink = blinkPressed;

          if (s.blinkCd > 0) s.blinkCd--;
          if (s.shield > 0) s.shield--;
          if (s.invuln > 0) s.invuln--;

          if (Math.hypot(ix, iy) > 0.12) {
            s.angle = Math.atan2(iy, ix);
          }

          if (blinkEdge && s.blinkCd === 0) {
            const bx = Math.hypot(ix, iy) > 0.1 ? ix : Math.cos(s.angle);
            const by = Math.hypot(ix, iy) > 0.1 ? iy : Math.sin(s.angle);
            for (let step = 0; step < 3; step++) {
              vfx.afterimage(s.x + bx * step * 22, s.y + by * step * 22, 13, active[i].color, 11);
            }
            vfx.ring(s.x, s.y, active[i].color, 44, 2.5);
            s.x = Math.max(46, Math.min(GAME_WIDTH - 46, s.x + bx * 72));
            s.y = Math.max(82, Math.min(GAME_HEIGHT - 46, s.y + by * 72));
            vfx.ring(s.x, s.y, '#ffffff', 32, 2);
            s.blinkCd = 44;
            s.invuln = 14;
            sound.dash();
            rumble(i, 40, 0.35);
          }

          s.vx = (s.vx + ix * 0.78) * 0.88;
          s.vy = (s.vy + iy * 0.78) * 0.88;
          s.x = Math.max(46, Math.min(GAME_WIDTH - 46, s.x + s.vx));
          s.y = Math.max(82, Math.min(GAME_HEIGHT - 46, s.y + s.vy));

          if (frame % 30 === 0) scores[i] += 1;

          if (orbPickup.active && Math.hypot(s.x - orbPickup.x, s.y - orbPickup.y) < 28) {
            orbPickup.active = false;
            orbPickup.respawn = 230;
            if (orbPickup.kind === 'shield') {
              s.shield = 280;
              vfx.ring(orbPickup.x, orbPickup.y, '#38bdf8', 58, 3);
              vfx.popup(orbPickup.x, orbPickup.y - 12, 'SHIELD ON!', '#38bdf8', 14);
              sound.pickup(140);
            } else {
              slowFrames = 240;
              vfx.ring(orbPickup.x, orbPickup.y, '#c084fc', 80, 3);
              vfx.ring(GAME_WIDTH / 2, GAME_HEIGHT / 2, '#c084fc', 420, 3);
              vfx.popup(orbPickup.x, orbPickup.y - 12, 'TIME SLOW!', '#c084fc', 15);
              sound.sweep(900, 160, 0.4, 'sine', 0.1);
              sound.combo(4);
            }
            rumble(i, 60, 0.45);
          }
        }

        const timeScale = slowFrames > 0 ? 0.38 : 1;
        // In-place compaction (no per-frame array allocation); shards pushed mid-loop are
        // appended past the read cursor and still processed this frame.
        let keep = 0;
        for (let mIdx = 0; mIdx < meteors.length; mIdx++) {
          const m = meteors[mIdx];
          m.x += m.vx * timeScale;
          m.y += m.vy * timeScale;
          m.rot += 0.04 * timeScale;
          m.age++;

          // Staggered fire-trail sparks (~1 in 6 meteors per frame) to stay under the particle cap
          if ((frame + mIdx) % 6 === 0) {
            vfx.spark(m.x, m.y, -m.vx * 0.25, -m.vy * 0.25, m.kind === 'shard' ? '#facc15' : '#fb923c', 2.5);
          }

          // Splitter asteroids crack open mid-flight
          if (m.kind === 'splitter' && m.age === 95) {
            spawnShards(m, vfx);
            sound.hit();
            continue;
          }

          let destroyed = false;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || !ships[i].alive || ships[i].invuln > 0) continue;
            if (Math.hypot(m.x - ships[i].x, m.y - ships[i].y) < m.r + 12) {
              if (ships[i].shield > 0) {
                ships[i].shield = 0;
                vfx.burst(m.x, m.y, '#38bdf8', 18, 5.5);
                vfx.ring(ships[i].x, ships[i].y, '#38bdf8', 60, 3);
                vfx.shake(5);
                sound.hit();
                if (m.kind === 'splitter') spawnShards(m, vfx);
                destroyed = true;
                break;
              }
              ships[i].alive = false;
              vfx.hitstop(3);
              vfx.burst(ships[i].x, ships[i].y, active[i].color, 26, 7);
              vfx.ring(ships[i].x, ships[i].y, '#ff6b2b', 75, 3.5);
              vfx.popup(ships[i].x, ships[i].y - 18, 'KO!', '#ff6b2b', 16);
              vfx.shake(10);
              sound.explosion();
              rumble(i, 170, 0.9);
            }
          }
          if (!destroyed && m.x > 16 && m.x < GAME_WIDTH - 16 && m.y > 60 && m.y < GAME_HEIGHT - 16) {
            meteors[keep++] = m;
          }
        }
        meteors.length = keep;

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && ships[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          if (alive.length === 1) {
            const w = alive[0];
            scores[w] += 15;
            banner = `${active[w].name} SURVIVED!`;
            sound.win();
            vfx.flash(active[w].color, 0.22);
            vfx.popup(ships[w].x, ships[w].y - 24, '+15 SURVIVOR!', '#facc15', 16);
            vfx.ring(ships[w].x, ships[w].y, active[w].color, 120, 5);
            vfx.confetti(ships[w].x, ships[w].y, 36);
            vfx.confetti(GAME_WIDTH / 2, 150, 28);
            rumble(w, 260, 1);
          } else {
            banner = 'ALL SHIPS DESTROYED!';
          }
          freeze = 85;
        }
      }

      let meteorLeader = -1;
      let meteorTop = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && scores[i] > meteorTop) {
          meteorTop = scores[i];
          meteorLeader = i;
        }
      }

      drawArcadeBackdrop(ctx, slowFrames > 0 ? '#c084fc' : '#facc15');

      // Time-Slow tint
      if (slowFrames > 0) {
        ctx.fillStyle = 'rgba(192, 132, 252, 0.07)';
        ctx.fillRect(32, 68, GAME_WIDTH - 64, GAME_HEIGHT - 102);
      }

      if (orbPickup.active) {
        const col = orbPickup.kind === 'shield' ? '#38bdf8' : '#c084fc';
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(orbPickup.x, orbPickup.y, 13 + Math.sin(frame * 0.14) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(orbPickup.kind === 'shield' ? 'SHD' : 'SLO', orbPickup.x, orbPickup.y + 4);
        ctx.restore();
      }

      // Cheap additive heat halos in one pass (replaces per-meteor shadowBlur)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.2;
      for (const m of meteors) {
        ctx.fillStyle = m.kind === 'shard' ? '#facc15' : '#ff6b2b';
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * (m.kind === 'splitter' ? 1.9 : 1.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      for (const m of meteors) {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.rot);
        ctx.fillStyle = m.kind === 'shard' ? '#fde047' : m.kind === 'splitter' ? '#ea580c' : '#fb923c';
        ctx.beginPath();
        const sides = m.kind === 'shard' ? 5 : 7;
        for (let k = 0; k < sides; k++) {
          const a = (k * Math.PI * 2) / sides;
          const rad = m.r * (k % 2 === 0 ? 1 : 0.78);
          if (k === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
          else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.fill();
        if (m.kind === 'splitter') {
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(-m.r * 0.25, -m.r * 0.2, m.r * 0.24, 0, Math.PI * 2);
          ctx.arc(m.r * 0.3, m.r * 0.25, m.r * 0.18, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !ships[i].alive) continue;
        const s = ships[i];
        // Thruster flame behind movement angle
        if (Math.hypot(s.vx, s.vy) > 0.6) {
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(s.angle + Math.PI);
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.moveTo(12, -5);
          ctx.lineTo(22 + (Math.sin(frame * 0.9 + i * 2) * 0.5 + 0.5) * 7, 0);
          ctx.lineTo(12, 5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        drawPlayerOrb(ctx, s.x, s.y, 14, active[i].color, i, {
          angle: s.angle,
          shield: s.shield > 0,
          flash: s.invuln > 0 && frame % 4 < 2,
          cooldownPct: s.blinkCd / 44,
        });
      }

      // Wave Indicator Pill
      ctx.save();
      ctx.fillStyle = 'rgba(11, 13, 18, 0.85)';
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(GAME_WIDTH / 2 - 58, 68, 116, 22, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`WAVE ${wave}${slowFrames > 0 ? ' · SLOW' : ''}`, GAME_WIDTH / 2, 83);
      ctx.restore();

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'LAUNCHING NEXT STORM...', '#facc15');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === meteorLeader,
          valueText: `${ships[i].alive ? 'OK' : 'KO'} · ${scores[i]}pt`,
        })),
        'THRUST: STICK / WASD  ·  PHASE BLINK (INVULN): A / B / SPACE',
      );
    },
  };
}
