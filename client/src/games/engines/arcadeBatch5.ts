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

// 21. LASER TAG MAZE (Mirror Prism Splitters, Stealth Cloak, Charge Ring, Hitstop Tags!)
export function createLaserTagEngine(): MiniGameEngine {
  const walls = [
    { x: 215, y: 145, w: 28, h: 110 },
    { x: 215, y: 330, w: 28, h: 110 },
    { x: 717, y: 145, w: 28, h: 110 },
    { x: 717, y: 330, w: 28, h: 110 },
    { x: 420, y: 274, w: 120, h: 26 },
  ];

  const prisms = [
    { x: 350, y: 195, r: 22, flash: 0 },
    { x: 610, y: 375, r: 22, flash: 0 },
    { x: 610, y: 195, r: 22, flash: 0 },
    { x: 350, y: 375, r: 22, flash: 0 },
  ];

  const scores = [0, 0, 0, 0];
  const wins = [0, 0, 0, 0];
  const WIN_SCORE = 100;

  const makeBots = () =>
    [0, 1, 2, 3].map((i) => ({
      x: i % 2 === 0 ? 105 : GAME_WIDTH - 105,
      y: i < 2 ? 125 : GAME_HEIGHT - 90,
      angle: i % 2 === 0 ? 0 : Math.PI,
      cd: 0,
      invuln: 30,
      ammo: 4,
      ammoTimer: 0,
      cloak: 0,
      cloakCd: 0,
      prevA: false,
      prevB: false,
      // Bot unstick memory
      aiStuck: 0,
      aiSide: i % 2 === 0 ? 1 : -1,
      aiSideTimer: 0,
    }));

  let bots = makeBots();
  let lasers: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    owner: number;
    bounces: number;
    splitImmunity: number;
  }> = [];
  let banner = '';
  let freeze = 20;

  const hitsWall = (x: number, y: number, r: number) => {
    for (const w of walls) {
      if (x + r > w.x && x - r < w.x + w.w && y + r > w.y && y - r < w.y + w.h) return w;
    }
    return undefined;
  };

  // Line-of-sight sample test (walls only) so bots stop wasting shots into pillars
  const hasLos = (x0: number, y0: number, x1: number, y1: number) => {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(d / 14);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (hitsWall(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 3)) return false;
    }
    return true;
  };

  const resetMatch = () => {
    for (let i = 0; i < 4; i++) scores[i] = 0;
    bots = makeBots();
    lasers = [];
    banner = '';
    freeze = 20;
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      const maxS = Math.max(...scores);
      const leaderSlot = maxS > 0 ? scores.indexOf(maxS) : -1;

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetMatch();
      } else {
        for (const pr of prisms) {
          if (pr.flash > 0) pr.flash--;
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const b = bots[i];
          let mx = 0;
          let my = 0;
          let btnA = false;
          let btnB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            mx = inp.x;
            my = inp.y;
            btnA = inp.actionA;
            btnB = inp.actionB;
          } else {
            // Bot ignores cloaked rivals!
            let target = null as (typeof bots)[number] | null;
            let bestD = Infinity;
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled || bots[j].cloak > 0) continue;
              const d = Math.hypot(bots[j].x - b.x, bots[j].y - b.y);
              if (d < bestD) {
                bestD = d;
                target = bots[j];
              }
            }
            if (target) {
              const dx = target.x - b.x;
              const dy = target.y - b.y;
              const d = Math.hypot(dx, dy) || 1;
              const los = hasLos(b.x, b.y, target.x, target.y);
              // Close in when blocked/far, strafe at mid range instead of face-hugging
              const approach = !los || d > 230 ? 0.82 : d < 140 ? -0.35 : 0.1;
              mx = (dx / d) * approach + (-dy / d) * b.aiSide * 0.55;
              my = (dy / d) * approach + (dx / d) * b.aiSide * 0.55;
              if (--b.aiSideTimer <= 0) {
                b.aiSideTimer = 50 + Math.floor(Math.random() * 70);
                b.aiSide = Math.random() < 0.5 ? 1 : -1;
              }
              // Unstick: if pushing into a wall, commit to a sidestep for a moment
              if (b.aiStuck > 10) {
                mx = (-dy / d) * b.aiSide;
                my = (dx / d) * b.aiSide;
                if (b.aiStuck > 40) b.aiStuck = 0;
              }
              b.angle = Math.atan2(dy, dx);
              if (b.cd === 0 && b.ammo > 0 && los && Math.random() < 0.09) btnA = true;
              if (d < 160 && b.cloakCd === 0 && Math.random() < 0.02) btnB = true;
            } else {
              // Patrol center if everyone cloaked
              const ang = frame * 0.03 + i;
              mx = Math.cos(ang) * 0.6;
              my = Math.sin(ang) * 0.6;
            }
          }

          if (Math.hypot(mx, my) > 0.15) {
            if (active[i].isHuman) b.angle = Math.atan2(my, mx);
            const spd = b.cloak > 0 ? 4.8 : 4.2;
            const ox = b.x;
            const oy = b.y;
            const nx = Math.max(50, Math.min(GAME_WIDTH - 50, b.x + mx * spd));
            if (!hitsWall(nx, b.y, 16)) b.x = nx;
            const ny = Math.max(85, Math.min(GAME_HEIGHT - 50, b.y + my * spd));
            if (!hitsWall(b.x, ny, 16)) b.y = ny;
            if (!active[i].isHuman) {
              if (Math.hypot(b.x - ox, b.y - oy) < spd * 0.35) b.aiStuck++;
              else if (b.aiStuck > 0 && b.aiStuck <= 10) b.aiStuck--;
              else if (b.aiStuck > 10) b.aiStuck++;
            }
          }

          if (b.invuln > 0) b.invuln--;
          if (b.cd > 0) b.cd--;
          if (b.cloak > 0) b.cloak--;
          if (b.cloakCd > 0) b.cloakCd--;

          // Recharge laser ammo
          if (b.ammo < 4) {
            b.ammoTimer++;
            if (b.ammoTimer >= 36) {
              b.ammo++;
              b.ammoTimer = 0;
            }
          } else {
            b.ammoTimer = 0;
          }

          const tapA = btnA && !b.prevA;
          const tapB = btnB && !b.prevB;
          b.prevA = btnA;
          b.prevB = btnB;

          // B: Short Stealth Cloak
          if (tapB && b.cloakCd === 0) {
            b.cloak = 135;
            b.cloakCd = 230;
            vfx.ring(b.x, b.y, '#94a3b8', 42, 2);
            sound.sweep(620, 240, 0.14, 'sine', 0.08);
          }

          if (tapA && b.cd === 0 && b.ammo > 0) {
            b.ammo--;
            b.cloak = 0; // Firing breaks stealth!
            // Bots get slight aim error so they aren't laser-perfect
            const fa = b.angle + (active[i].isHuman ? 0 : (Math.random() - 0.5) * 0.16);
            lasers.push({
              x: b.x + Math.cos(fa) * 20,
              y: b.y + Math.sin(fa) * 20,
              vx: Math.cos(fa) * 10,
              vy: Math.sin(fa) * 10,
              owner: i,
              bounces: 2,
              splitImmunity: 0,
            });
            b.cd = 14;
            sound.beep(880 + i * 45, 0.04, 'square', 0.07);
            vfx.spark(b.x + Math.cos(fa) * 20, b.y + Math.sin(fa) * 20, Math.cos(fa) * 2.5, Math.sin(fa) * 2.5, active[i].color, 3);
          } else if (tapA && b.ammo === 0 && active[i].isHuman) {
            // Dry-fire click so players know they're out of charge
            sound.beep(160, 0.04, 'square', 0.05);
          }
        }

        const splitLasers: typeof lasers = [];
        lasers = lasers.filter((l) => {
          const prevX = l.x;
          const prevY = l.y;
          l.x += l.vx;
          l.y += l.vy;
          if (l.splitImmunity > 0) l.splitImmunity--;

          if (l.x < 36 || l.x > GAME_WIDTH - 36) {
            l.vx *= -1;
            l.x = Math.max(36, Math.min(GAME_WIDTH - 36, l.x));
            l.bounces--;
            vfx.spark(l.x, l.y, l.vx * 0.2, l.vy * 0.2, active[l.owner].color, 2.5);
          }
          if (l.y < 72 || l.y > GAME_HEIGHT - 36) {
            l.vy *= -1;
            l.y = Math.max(72, Math.min(GAME_HEIGHT - 36, l.y));
            l.bounces--;
            vfx.spark(l.x, l.y, l.vx * 0.2, l.vy * 0.2, active[l.owner].color, 2.5);
          }

          const w = hitsWall(l.x, l.y, 4);
          if (w) {
            // Reflect on the axis we actually entered through and back out of the wall
            // (old centre-ratio test picked the wrong axis on corners, trapping lasers inside
            // walls where they burned all bounces in consecutive frames).
            const wasInsideX = prevX + 4 > w.x && prevX - 4 < w.x + w.w;
            const wasInsideY = prevY + 4 > w.y && prevY - 4 < w.y + w.h;
            if (!wasInsideX) l.vx *= -1;
            if (!wasInsideY) l.vy *= -1;
            if (wasInsideX && wasInsideY) {
              l.vx *= -1;
              l.vy *= -1;
            }
            l.x = prevX;
            l.y = prevY;
            l.bounces--;
            vfx.burst(l.x, l.y, active[l.owner].color, 6, 3, 2);
          }

          // Mirror Prism Splitters!
          if (l.splitImmunity === 0) {
            for (const pr of prisms) {
              if (Math.hypot(l.x - pr.x, l.y - pr.y) < pr.r) {
                pr.flash = 10;
                const ang = Math.atan2(l.vy, l.vx);
                const spd = Math.hypot(l.vx, l.vy);
                const leftA = ang - 0.52;
                const rightA = ang + 0.52;
                splitLasers.push(
                  {
                    x: pr.x + Math.cos(leftA) * (pr.r + 4),
                    y: pr.y + Math.sin(leftA) * (pr.r + 4),
                    vx: Math.cos(leftA) * spd,
                    vy: Math.sin(leftA) * spd,
                    owner: l.owner,
                    bounces: Math.max(1, l.bounces),
                    splitImmunity: 14,
                  },
                  {
                    x: pr.x + Math.cos(rightA) * (pr.r + 4),
                    y: pr.y + Math.sin(rightA) * (pr.r + 4),
                    vx: Math.cos(rightA) * spd,
                    vy: Math.sin(rightA) * spd,
                    owner: l.owner,
                    bounces: Math.max(1, l.bounces),
                    splitImmunity: 14,
                  },
                );
                vfx.bolt(prevX, prevY, pr.x, pr.y, '#38bdf8');
                vfx.ring(pr.x, pr.y, '#38bdf8', 46, 2.5);
                sound.combo(2);
                return false;
              }
            }
          }

          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || i === l.owner || bots[i].invuln > 0) continue;
            if (Math.hypot(l.x - bots[i].x, l.y - bots[i].y) < 18) {
              scores[l.owner] += 15;
              bots[i].invuln = 60;
              bots[i].cloak = 0;
              vfx.hitstop(2);
              vfx.bolt(prevX, prevY, bots[i].x, bots[i].y, active[l.owner].color);
              vfx.burst(bots[i].x, bots[i].y, active[i].color, 22, 6.5);
              vfx.ring(bots[i].x, bots[i].y, active[l.owner].color, 64, 3);
              vfx.popup(bots[i].x, bots[i].y - 16, 'TAG +15!', active[l.owner].color, 14);
              vfx.shake(6);
              sound.pickup(140);
              sound.hit();
              rumble(i, 130, 0.8);
              rumble(l.owner, 50, 0.45);
              return false;
            }
          }
          return l.bounces >= 0;
        });

        if (splitLasers.length > 0 && lasers.length < 40) {
          lasers = lasers.concat(splitLasers);
        }

        const winner = [0, 1, 2, 3].find((i) => active[i].enabled && scores[i] >= WIN_SCORE);
        if (winner !== undefined) {
          wins[winner]++;
          banner = `${active[winner].name} LASER ACE!`;
          freeze = 95;
          sound.win();
          vfx.confetti(bots[winner].x, bots[winner].y, 44);
          vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 26);
          vfx.flash(active[winner].color, 0.24);
          rumble(winner, 220, 0.6);
          lasers = [];
        }
      }

      drawArcadeBackdrop(ctx, '#2ee59d');

      for (const w of walls) {
        ctx.fillStyle = '#192231';
        ctx.strokeStyle = 'rgba(46, 229, 157, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(w.x, w.y, w.w, w.h, 6);
        ctx.fill();
        ctx.stroke();
      }

      // Mirror Prism Pillars
      for (const pr of prisms) {
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.rotate(frame * 0.015);
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = pr.flash > 0 ? 28 : 14;
        ctx.fillStyle = pr.flash > 0 ? '#ffffff' : 'rgba(56, 189, 248, 0.26)';
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -pr.r);
        ctx.lineTo(pr.r, 0);
        ctx.lineTo(0, pr.r);
        ctx.lineTo(-pr.r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Lasers: additive wide glow pass + bright core (no per-bolt shadowBlur; up to 40 on screen)
      if (lasers.length > 0) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 11;
        for (const l of lasers) {
          ctx.strokeStyle = active[l.owner].color;
          ctx.beginPath();
          ctx.moveTo(l.x, l.y);
          ctx.lineTo(l.x - l.vx * 1.7, l.y - l.vy * 1.7);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.lineWidth = 4;
        for (const l of lasers) {
          ctx.strokeStyle = active[l.owner].color;
          ctx.beginPath();
          ctx.moveTo(l.x, l.y);
          ctx.lineTo(l.x - l.vx * 1.7, l.y - l.vy * 1.7);
          ctx.stroke();
        }
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const b = bots[i];
        if (b.invuln > 0 && Math.floor(b.invuln / 4) % 2 === 0) continue;
        ctx.save();
        if (b.cloak > 0) ctx.globalAlpha = 0.24;
        drawPlayerOrb(ctx, b.x, b.y, 16, active[i].color, i, {
          angle: b.angle,
          leader: i === leaderSlot && b.cloak === 0,
          cooldownPct: 1 - b.ammo / 4,
        });
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'REBOOTING LASER ARENA...', '#2ee59d');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderSlot,
          valueText: `${scores[i]}/${WIN_SCORE} · W${wins[i]}`,
        })),
        'FIRE PRISM LASER: A / SPACE   ·   STEALTH CLOAK: B / SHIFT',
      );
    },
  };
}

// 22. DRIFT RALLY (3-Tier Mini-Turbo Sparks, Tire Skid Ribbons, Apex Kerbs, 3-Lap GP!)
export function createDriftRallyEngine(): MiniGameEngine {
  const waypoints = [
    { x: 185, y: 145 },
    { x: 480, y: 120 },
    { x: 785, y: 155 },
    { x: 825, y: 315 },
    { x: 645, y: 435 },
    { x: 480, y: 338 },
    { x: 295, y: 440 },
    { x: 130, y: 335 },
  ];

  const makeRacers = () =>
    [0, 1, 2, 3].map((i) => ({
      x: 170,
      y: 128 + i * 11,
      angle: 0,
      speed: 0,
      wp: 1,
      lap: 1,
      driftCharge: 0,
      boostTimer: 0,
      // Per-race CPU pace/line variation — identical bots otherwise finished in the exact
      // same order every race (slot 2 won 22/22 in simulation).
      aiPace: 0.93 + Math.random() * 0.08,
      aiDriftAt: 0.3 + Math.random() * 0.2,
    }));

  const wins = [0, 0, 0, 0];
  const SKID_LIFE = 110;
  const MAX_SKIDS = 700;
  const SKID_BUCKETS = 4;
  let racers = makeRacers();
  let skids: Array<{ x1: number; y1: number; x2: number; y2: number; life: number }> = [];
  let banner = '';
  let freeze = 20;

  const reset = () => {
    racers = makeRacers();
    skids = [];
    banner = '';
    freeze = 20;
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      // Determine race leader
      let leaderSlot = 0;
      let bestProg = -1;
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const prog = racers[i].lap * 100 + racers[i].wp;
        if (prog > bestProg) {
          bestProg = prog;
          leaderSlot = i;
        }
      }

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const r = racers[i];
          let steer = 0;
          let gas = false;
          let drift = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            steer = inp.x;
            gas = inp.actionA || inp.y < -0.2 || Math.abs(inp.x) > 0.2;
            drift = inp.actionB;
          } else {
            const target = waypoints[r.wp];
            const desired = Math.atan2(target.y - r.y, target.x - r.x);
            let diff = desired - r.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            steer = Math.max(-1, Math.min(1, diff * 2.5));
            // Lift off on hairpins so the turning circle fits inside the waypoint radius
            // (at full boost the bot could orbit a checkpoint forever).
            gas = (Math.abs(diff) < 1.1 || r.speed < 3.2) && r.speed < 5.3 * r.aiPace + (r.boostTimer > 0 ? 4 : 0);
            drift = Math.abs(diff) > r.aiDriftAt;
          }

          if (r.boostTimer > 0) {
            r.boostTimer--;
            if (frame % 2 === 0) vfx.afterimage(r.x, r.y, 12, active[i].color, 9);
          }

          if (drift && Math.abs(steer) > 0.28 && r.speed > 2.2) {
            r.driftCharge++;
            const tierColor =
              r.driftCharge > 70 ? '#c084fc' : r.driftCharge > 40 ? '#ff6b2b' : '#38bdf8';
            if (frame % 2 === 0) {
              vfx.spark(
                r.x - Math.cos(r.angle) * 14,
                r.y - Math.sin(r.angle) * 14,
                -Math.cos(r.angle) * 2.4 + (Math.random() - 0.5) * 1.5,
                -Math.sin(r.angle) * 2.4 + (Math.random() - 0.5) * 1.5,
                tierColor,
                r.driftCharge > 70 ? 4 : 3,
              );
            }
            if (r.driftCharge === 20 || r.driftCharge === 42 || r.driftCharge === 72) {
              sound.combo(r.driftCharge > 70 ? 4 : r.driftCharge > 40 ? 2 : 1);
              vfx.ring(r.x, r.y, tierColor, 34, 2);
            }
          } else if (r.driftCharge >= 20) {
            // Release Mini-Turbo Tier!
            const tier = r.driftCharge > 70 ? 3 : r.driftCharge > 40 ? 2 : 1;
            const boostSpd = tier === 3 ? 8.8 : tier === 2 ? 7.6 : 6.6;
            const label = tier === 3 ? 'ULTRA TURBO!' : tier === 2 ? 'SUPER TURBO!' : 'MINI TURBO!';
            const col = tier === 3 ? '#c084fc' : tier === 2 ? '#ff6b2b' : '#38bdf8';
            r.speed = boostSpd;
            r.boostTimer = tier * 14;
            r.driftCharge = 0;
            vfx.ring(r.x, r.y, col, 48, 3);
            vfx.popup(r.x, r.y - 16, label, col, 12);
            sound.dash();
            rumble(i, 65, 0.55);
          } else {
            r.driftCharge = 0;
          }

          const prevX = r.x;
          const prevY = r.y;
          r.angle += steer * (drift ? 0.092 : 0.064);
          const maxBase = r.boostTimer > 0 ? 8.6 : 5.3;
          r.speed = gas
            ? Math.min(r.speed > maxBase ? r.speed * 0.99 : maxBase, r.speed + 0.24)
            : r.speed * 0.94;
          r.x = Math.max(54, Math.min(GAME_WIDTH - 54, r.x + Math.cos(r.angle) * r.speed));
          r.y = Math.max(85, Math.min(GAME_HEIGHT - 48, r.y + Math.sin(r.angle) * r.speed));

          // Tire skid ribbons when drifting (only while actually moving; capped pool)
          if (drift && Math.abs(steer) > 0.28 && r.speed > 1.5 && skids.length < MAX_SKIDS) {
            const rx = Math.cos(r.angle + Math.PI / 2) * 5;
            const ry = Math.sin(r.angle + Math.PI / 2) * 5;
            skids.push({ x1: prevX + rx, y1: prevY + ry, x2: r.x + rx, y2: r.y + ry, life: SKID_LIFE });
            skids.push({ x1: prevX - rx, y1: prevY - ry, x2: r.x - rx, y2: r.y - ry, life: SKID_LIFE });
          }

          const target = waypoints[r.wp];
          if (Math.hypot(r.x - target.x, r.y - target.y) < 76) {
            r.wp = (r.wp + 1) % waypoints.length;
            if (r.wp === 0) {
              r.lap++;
              if (r.lap > 3) {
                if (!banner) {
                  wins[i]++;
                  banner = `${active[i].name} GP CHAMPION!`;
                  freeze = 95;
                  sound.win();
                  vfx.popup(r.x, r.y - 16, 'FINISH!', '#ffffff', 16);
                  vfx.confetti(r.x, r.y, 48);
                  vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 26);
                  vfx.flash(active[i].color, 0.22);
                  vfx.shake(6);
                  rumble(i, 220, 0.6);
                }
              } else {
                sound.pickup(i * 60);
                const finalLap = r.lap === 3;
                vfx.popup(r.x, r.y - 16, finalLap ? 'FINAL LAP!' : `LAP ${r.lap}/3!`, finalLap ? '#fde047' : active[i].color, finalLap ? 15 : 13);
                vfx.ring(r.x, r.y, active[i].color, 50, 2.5);
                rumble(i, 60, 0.45);
              }
            }
          }
        }

        // In-place skid decay (was a .filter() realloc over up to ~1.2k segments per frame)
        let sw = 0;
        for (let k = 0; k < skids.length; k++) {
          const s = skids[k];
          if (--s.life > 0) skids[sw++] = s;
        }
        skids.length = sw;
      }

      drawArcadeBackdrop(ctx, '#facc15');

      // Track ribbon + red/white apex kerbs
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // Outer kerb border
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 94;
      ctx.beginPath();
      waypoints.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = '#f8fafc';
      ctx.setLineDash([16, 16]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Asphalt surface
      ctx.strokeStyle = '#1b2232';
      ctx.lineWidth = 82;
      ctx.stroke();

      // Center racing line
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.35)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([12, 12]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Start / Finish checkered gate at waypoint 0
      ctx.save();
      ctx.translate(waypoints[0].x, waypoints[0].y);
      for (let row = -3; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
          ctx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#0f172a';
          ctx.fillRect(col * 8 - 8, row * 12, 8, 12);
        }
      }
      ctx.restore();

      // Tire skid marks — batched into a few alpha buckets (one stroke per bucket instead of
      // one stroke + one rgba string per segment)
      if (skids.length > 0) {
        ctx.save();
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgb(10, 12, 18)';
        for (let bk = 0; bk < SKID_BUCKETS; bk++) {
          const lo = (bk / SKID_BUCKETS) * SKID_LIFE;
          const hi = ((bk + 1) / SKID_BUCKETS) * SKID_LIFE;
          ctx.globalAlpha = ((bk + 0.5) / SKID_BUCKETS) * 0.65;
          ctx.beginPath();
          for (const s of skids) {
            if (s.life <= lo || s.life > hi) continue;
            ctx.moveTo(s.x1, s.y1);
            ctx.lineTo(s.x2, s.y2);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const r = racers[i];
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.rotate(r.angle);
        ctx.shadowColor = active[i].color;
        ctx.shadowBlur = r.boostTimer > 0 ? 22 : 12;
        ctx.fillStyle = active[i].color;
        ctx.beginPath();
        ctx.roundRect(-14, -9, 28, 18, 5);
        ctx.fill();
        ctx.fillStyle = '#0b0d12';
        ctx.fillRect(-10, -7, 4, 14);
        ctx.fillStyle = '#fff';
        ctx.fillRect(6, -5, 5, 10);
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'STARTING NEXT 3-LAP GRAND PRIX...', '#facc15');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderSlot,
          valueText: `LAP ${Math.min(racers[i].lap, 3)}/3 · W${wins[i]}`,
        })),
        'STEER: LEFT/RIGHT   ·   GAS: A / UP   ·   HOLD DRIFT FOR 3-TIER TURBO: B / SHIFT',
      );
    },
  };
}

// 23. METEOR BASKETBALL (3-Point Arc, Jump-Dunk Shatter Hitstop, Swish Net Ripple, Steal Dash!)
export function createMeteorBasketballEngine(): MiniGameEngine {
  const FLOOR = GAME_HEIGHT - 44;
  const hoopL = { x: 86, y: 230 };
  const hoopR = { x: GAME_WIDTH - 86, y: 230 };
  const THREE_PT_X_L = 335;
  const THREE_PT_X_R = GAME_WIDTH - 335;
  const WIN_PTS = 15;

  const teamScore = [0, 0];
  const teamWins = [0, 0];
  let netRippleL = 0;
  let netRippleR = 0;

  const makePlayers = () =>
    [0, 1, 2, 3].map((i) => ({
      x: i === 0 || i === 2 ? 250 + i * 35 : GAME_WIDTH - 250 - i * 35,
      y: FLOOR - 18,
      vx: 0,
      vy: 0,
      onGround: true,
      prevA: false,
      prevB: false,
      dashCd: 0,
    }));

  let playersPos = makePlayers();
  const ball = { x: GAME_WIDTH / 2, y: 170, vx: 0, vy: 0, lastTouch: -1, shotFromX: GAME_WIDTH / 2 };
  let banner = '';
  let freeze = 20;

  const resetPoint = () => {
    ball.x = GAME_WIDTH / 2;
    ball.y = 155;
    ball.vx = 0;
    ball.vy = 0;
    ball.lastTouch = -1;
  };

  const resetMatch = () => {
    teamScore[0] = 0;
    teamScore[1] = 0;
    playersPos = makePlayers();
    resetPoint();
    banner = '';
    freeze = 20;
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      if (netRippleL > 0) netRippleL *= 0.92;
      if (netRippleR > 0) netRippleR *= 0.92;

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetMatch();
      } else {
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const p = playersPos[i];
          let mx = 0;
          let btnA = false;
          let btnB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            mx = inp.x;
            btnA = inp.actionA || inp.y < -0.45;
            btnB = inp.actionB;
          } else {
            const isLeftTeam = i === 0 || i === 2;
            const targetHoop = isLeftTeam ? hoopR : hoopL;
            const attackDir = isLeftTeam ? 1 : -1;
            const dBall = Math.hypot(ball.x - p.x, ball.y - p.y);
            // Get on the far side of the ball so contacts knock it TOWARD the target hoop
            // (old bot just ran at the ball and frequently batted it into its own basket).
            const standX = ball.x - attackDir * 20;
            const dx = standX - p.x;
            mx = Math.abs(dx) > 6 ? Math.sign(dx) * 0.84 : 0;
            if (ball.y < p.y - 28 && Math.abs(ball.x - p.x) < 68 && p.onGround) btnA = true;
            const hoopDist = Math.abs(targetHoop.x - p.x);
            // Only pull the trigger from a sensible range; otherwise dribble forward
            if (dBall < 42 && hoopDist < 470 && (hoopDist > 140 || !p.onGround) && Math.random() < 0.35) {
              btnB = true;
            }
            if (dBall < 55 && Math.hypot(p.x - targetHoop.x, p.y - targetHoop.y) < 110 && p.onGround) {
              btnA = true;
            }
          }

          if (p.dashCd > 0) p.dashCd--;
          const tapA = btnA && !p.prevA;
          const tapB = btnB && !p.prevB;
          p.prevA = btnA;
          p.prevB = btnB;

          p.vx = (p.vx + mx * 0.94) * 0.85;
          p.vy += 0.54;

          if (tapA && p.onGround) {
            p.vy = -12.8;
            p.onGround = false;
            sound.beep(420, 0.05);
          }

          const dBall = Math.hypot(ball.x - p.x, ball.y - p.y);
          // Steal dash when pressing B away from ball
          if (tapB && dBall >= 42 && p.dashCd === 0) {
            const dir = Math.abs(mx) > 0.1 ? Math.sign(mx) : i === 0 || i === 2 ? 1 : -1;
            p.vx += dir * 10.5;
            p.dashCd = 38;
            vfx.afterimage(p.x, p.y, 18, active[i].color, 10);
            sound.dash();
          }

          p.x = Math.max(46, Math.min(GAME_WIDTH - 46, p.x + p.vx));
          p.y += p.vy;
          if (p.y >= FLOOR - 18) {
            p.y = FLOOR - 18;
            p.vy = 0;
            p.onGround = true;
          }

          const dAfter = Math.hypot(ball.x - p.x, ball.y - p.y);
          if (dAfter < 36) {
            const isLeftTeam = i === 0 || i === 2;
            const targetHoop = isLeftTeam ? hoopR : hoopL;
            ball.lastTouch = i;
            const nearHoop = Math.hypot(p.x - targetHoop.x, p.y - targetHoop.y) < 88;

            if (!p.onGround && nearHoop && (btnB || p.vy > -3)) {
              // METEOR DUNK SLAM!
              ball.x = targetHoop.x;
              ball.y = targetHoop.y - 6;
              ball.vx = 0;
              ball.vy = 9.5;
              ball.shotFromX = targetHoop.x;
              vfx.hitstop(3);
              vfx.burst(targetHoop.x, targetHoop.y, '#ff6b2b', 28, 7.5);
              vfx.ring(targetHoop.x, targetHoop.y, '#fde047', 90, 4);
              vfx.popup(targetHoop.x, targetHoop.y - 36, 'METEOR DUNK!', '#facc15', 18);
              vfx.shake(11);
              sound.explosion();
              rumble(i, 160, 0.95);
            } else if (btnB) {
              // Aimed ballistic arc shot. The old linear formula overshot wildly and slammed the
              // ceiling (e.g. vy≈-18 from mid-court → apex far above y=76), so jump shots were
              // essentially random. Solve for a flight time that lands on the rim, with a
              // distance-scaled error so long 3s are riskier than layups.
              const dx = targetHoop.x - ball.x;
              const dy = targetHoop.y - 4 - ball.y;
              const g = 0.36;
              let T = 34 + Math.abs(dx) * 0.05;
              // Discrete form matching the integrator (vy += g; y += vy)
              let vy = (dy - (g * T * (T + 1)) / 2) / T;
              // Keep the apex below the ceiling (y=76)
              const maxRise = Math.max(20, ball.y - 92);
              const vyCap = -Math.sqrt(2 * g * maxRise);
              if (vy < vyCap) {
                vy = vyCap;
                // Re-solve T for the capped launch (descending root)
                const disc = vy * vy + 2 * g * dy;
                T = disc > 0 ? (-vy + Math.sqrt(disc)) / g : T;
              }
              const err = Math.min(0.14, 0.02 + Math.abs(dx) * 0.00017);
              ball.shotFromX = p.x;
              ball.vx = (dx / Math.max(8, T)) * (1 + (Math.random() - 0.5) * 2 * err);
              ball.vy = vy;
              vfx.ring(ball.x, ball.y, active[i].color, 36, 2);
              sound.dash();
              rumble(i, 65, 0.55);
            } else {
              const nx = (ball.x - p.x) / (dAfter || 1);
              const ny = (ball.y - p.y) / (dAfter || 1);
              ball.vx = nx * 6.2 + p.vx * 0.78;
              ball.vy = Math.min(-5, ny * 7.2 + p.vy * 0.45);
              sound.hit();
              rumble(i, 45, 0.4);
            }
          }
        }

        ball.vy += 0.36;
        ball.x += ball.vx;
        ball.y += ball.vy;

        if (frame % 2 === 0 && Math.hypot(ball.vx, ball.vy) > 6) {
          vfx.afterimage(ball.x, ball.y, 12, '#fb923c', 7);
        }

        if (ball.x < 42 || ball.x > GAME_WIDTH - 42) {
          ball.vx *= -0.82;
          ball.x = Math.max(42, Math.min(GAME_WIDTH - 42, ball.x));
        }
        if (ball.y < 76) {
          ball.y = 76;
          ball.vy = Math.abs(ball.vy) * 0.8;
        }
        if (ball.y > FLOOR - 13) {
          ball.y = FLOOR - 13;
          ball.vy = -Math.abs(ball.vy) * 0.78;
          ball.vx *= 0.96;
        }

        // Score checks (3-pointer vs 2-pointer)
        if (Math.hypot(ball.x - hoopL.x, ball.y - hoopL.y) < 26 && ball.vy > 0) {
          const isThree = ball.shotFromX > THREE_PT_X_L;
          const pts = isThree ? 3 : 2;
          teamScore[1] += pts;
          netRippleL = 1;
          vfx.burst(hoopL.x, hoopL.y, '#fb7185', 26, 7);
          vfx.ring(hoopL.x, hoopL.y, '#fb7185', 88, 4);
          vfx.popup(GAME_WIDTH / 2, 210, `${isThree ? '3-PT ' : ''}SWISH! +${pts} RIGHT`, '#fb7185', 20);
          vfx.shake(8);
          vfx.hitstop(2);
          vfx.flash('#fb7185', 0.12);
          sound.combo(isThree ? 4 : 2);
          rumble(1, 90, 0.6);
          rumble(3, 90, 0.6);
          resetPoint();
        } else if (Math.hypot(ball.x - hoopR.x, ball.y - hoopR.y) < 26 && ball.vy > 0) {
          const isThree = ball.shotFromX < THREE_PT_X_R;
          const pts = isThree ? 3 : 2;
          teamScore[0] += pts;
          netRippleR = 1;
          vfx.burst(hoopR.x, hoopR.y, '#38bdf8', 26, 7);
          vfx.ring(hoopR.x, hoopR.y, '#38bdf8', 88, 4);
          vfx.popup(GAME_WIDTH / 2, 210, `${isThree ? '3-PT ' : ''}SWISH! +${pts} LEFT`, '#38bdf8', 20);
          vfx.shake(8);
          vfx.hitstop(2);
          vfx.flash('#38bdf8', 0.12);
          sound.combo(isThree ? 4 : 2);
          rumble(0, 90, 0.6);
          rumble(2, 90, 0.6);
          resetPoint();
        }

        if (teamScore[0] >= WIN_PTS || teamScore[1] >= WIN_PTS) {
          const leftWon = teamScore[0] >= WIN_PTS;
          teamWins[leftWon ? 0 : 1]++;
          banner = leftWon ? 'LEFT TEAM (P1+P3) WINS!' : 'RIGHT TEAM (P2+P4) WINS!';
          freeze = 95;
          sound.win();
          vfx.confetti(GAME_WIDTH / 2, 220, 52);
          vfx.confetti(leftWon ? hoopR.x : hoopL.x, (leftWon ? hoopR : hoopL).y, 30);
          vfx.flash(leftWon ? '#38bdf8' : '#fb7185', 0.25);
          rumble(leftWon ? 0 : 1, 220, 0.6);
          rumble(leftWon ? 2 : 3, 220, 0.6);
        }
      }

      drawArcadeBackdrop(ctx, '#ff6b2b');
      ctx.fillStyle = '#1d2434';
      ctx.fillRect(28, FLOOR, GAME_WIDTH - 56, 14);

      // 3-Point Arc markers on floor
      ctx.save();
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(THREE_PT_X_L, FLOOR);
      ctx.lineTo(THREE_PT_X_L, FLOOR + 14);
      ctx.moveTo(THREE_PT_X_R, FLOOR);
      ctx.lineTo(THREE_PT_X_R, FLOOR + 14);
      ctx.stroke();
      ctx.fillStyle = 'rgba(250, 204, 21, 0.7)';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('3PT LINE', THREE_PT_X_L, FLOOR - 6);
      ctx.fillText('3PT LINE', THREE_PT_X_R, FLOOR - 6);
      ctx.restore();

      // Hoops + Backboards + Rippling Nets
      [hoopL, hoopR].forEach((h, idx) => {
        const col = idx === 0 ? '#38bdf8' : '#fb7185';
        const rip = idx === 0 ? netRippleL : netRippleR;
        const bx = idx === 0 ? h.x - 26 : h.x + 26;
        // Backboard
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(bx, h.y - 42);
        ctx.lineTo(bx, h.y + 10);
        ctx.stroke();

        // Rippling net
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
        ctx.lineWidth = 1.5;
        for (let k = -2; k <= 2; k++) {
          const sway = Math.sin(frame * 0.35 + k) * rip * 14;
          ctx.beginPath();
          ctx.moveTo(h.x + k * 9, h.y);
          ctx.lineTo(h.x + k * 5 + sway, h.y + 30);
          ctx.stroke();
        }

        // Rim
        ctx.strokeStyle = col;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(h.x - 24, h.y);
        ctx.lineTo(h.x + 24, h.y);
        ctx.stroke();
      });

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const p = playersPos[i];
        drawPlayerOrb(ctx, p.x, p.y, 18, active[i].color, i, {
          cooldownPct: p.dashCd / 38,
        });
      }

      ctx.save();
      ctx.shadowColor = '#ff6b2b';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7c2d12';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'TIPPING OFF NEW MATCH...', '#ff6b2b');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          valueText:
            i === 0 || i === 2
              ? `L ${teamScore[0]}/${WIN_PTS} · TW${teamWins[0]}`
              : `R ${teamScore[1]}/${WIN_PTS} · TW${teamWins[1]}`,
        })),
        'RUN: LEFT/RIGHT   ·   JUMP / DUNK: A / SPACE   ·   SHOOT / STEAL DASH: B / SHIFT',
      );
    },
  };
}

// 24. RHYTHM BEATDOWN (4-Lane Directional/Button Highway, Equalizer Bars, Fever Chorus!)
export function createRhythmBeatdownEngine(): MiniGameEngine {
  const TARGET_Y = 445;
  const LABELS = ['←', '↓', '↑', '→'];
  const LANE_COLORS = ['#38bdf8', '#2ee59d', '#facc15', '#fb7185'];
  const ROUND_FRAMES = 45 * 60;

  const wins = [0, 0, 0, 0];
  let scores = [0, 0, 0, 0];
  let combos = [0, 0, 0, 0];
  let prevLane = [
    [false, false, false, false],
    [false, false, false, false],
    [false, false, false, false],
    [false, false, false, false],
  ];
  // hit: bitmask of players who already scored this note (a note can only be hit once per
  // player — previously mashing a lane re-scored the same note every frame it was in window).
  // judged: bitmask of players for whom the note has been resolved (hit or missed).
  // botOff: per-slot pixel offset at which a CPU will press (NaN = CPU whiffs this note).
  let notes: Array<{ lane: number; y: number; hit: number; judged: number; botOff: number[] }> = [];
  let timer = ROUND_FRAMES;
  let wasFever = false;
  const makeBotOffsets = () =>
    [0, 1, 2, 3].map(() => (Math.random() < 0.14 ? NaN : (Math.random() - 0.5) * 2 * 26));
  let banner = '';
  let freeze = 20;

  const reset = () => {
    scores = [0, 0, 0, 0];
    combos = [0, 0, 0, 0];
    notes = [];
    timer = ROUND_FRAMES;
    banner = '';
    freeze = 20;
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      const maxS = Math.max(...scores);
      const leaderSlot = maxS > 0 ? scores.indexOf(maxS) : -1;

      // Fever chorus every 15 seconds for 7 seconds
      const fever = (timer % 900) < 420 && timer < ROUND_FRAMES - 180;
      const noteSpeed = fever ? 5.8 : 4.4;
      const spawnRate = fever ? 19 : 26;

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        timer--;
        if (frame % spawnRate === 0) {
          const lane = Math.floor(Math.random() * 4);
          notes.push({ lane, y: 78, hit: 0, judged: 0, botOff: makeBotOffsets() });
          if (fever && Math.random() < 0.25) {
            notes.push({ lane: (lane + 2) % 4, y: 78, hit: 0, judged: 0, botOff: makeBotOffsets() });
          }
        }

        if (fever && !wasFever) {
          vfx.flash('#fde047', 0.14);
          vfx.popup(GAME_WIDTH / 2, 120, 'FEVER CHORUS!', '#fde047', 22);
          sound.sweep(330, 990, 0.3, 'triangle', 0.1);
        }
        wasFever = fever;

        // Move notes; a note that slides past the hit window un-hit breaks that player's combo
        for (let ni = notes.length - 1; ni >= 0; ni--) {
          const n = notes[ni];
          n.y += noteSpeed;
          if (n.y > TARGET_Y + 38) {
            for (let i = 0; i < 4; i++) {
              const bit = 1 << i;
              if (!active[i].enabled || n.judged & bit) continue;
              n.judged |= bit;
              if (combos[i] >= 5) {
                vfx.popup(150 + i * 220, TARGET_Y - 24, 'COMBO BREAK', '#fb7185', 11);
                sound.beep(180, 0.06, 'square', 0.05);
              }
              combos[i] = 0;
            }
          }
          if (n.y > GAME_HEIGHT - 22) {
            notes.splice(ni, 1);
          }
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const baseLx = 150 + i * 220;
          const laneHits = [false, false, false, false];

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            const cur = [
              inp.x < -0.55 || inp.actionX,
              inp.y > 0.55 || inp.actionA,
              inp.y < -0.55 || inp.actionY,
              inp.x > 0.55 || inp.actionB,
            ];
            for (let l = 0; l < 4; l++) {
              if (cur[l] && !prevLane[i][l]) laneHits[l] = true;
              prevLane[i][l] = cur[l];
            }
          } else {
            // CPU presses when the note reaches its pre-rolled timing offset (some early, some
            // late, some missed) — old bots only ever pressed inside the PERFECT window.
            const bit = 1 << i;
            for (const n of notes) {
              if (n.judged & bit) continue;
              const off = n.botOff[i];
              if (Number.isNaN(off)) continue;
              if (n.y >= TARGET_Y + off) laneHits[n.lane] = true;
            }
          }

          const myBit = 1 << i;
          for (let l = 0; l < 4; l++) {
            if (!laneHits[l]) continue;
            const subX = baseLx - 45 + l * 30;
            // Closest unjudged note in this lane within the window
            let match: (typeof notes)[number] | null = null;
            let bestDist = 38;
            for (const n of notes) {
              if (n.lane !== l || n.judged & myBit) continue;
              const dd = Math.abs(n.y - TARGET_Y);
              if (dd < bestDist) {
                bestDist = dd;
                match = n;
              }
            }
            if (match) {
              match.hit |= myBit;
              match.judged |= myBit;
              const dist = Math.abs(match.y - TARGET_Y);
              const perfect = dist < 16;
              combos[i]++;
              const mult = fever ? 2 : 1;
              const basePts = perfect ? 30 : 15;
              const pts = (basePts + Math.min(20, combos[i])) * mult;
              scores[i] += pts;
              vfx.burst(subX, TARGET_Y, LANE_COLORS[l], perfect ? 16 : 9, 5);
              vfx.ring(subX, TARGET_Y, perfect ? '#2ee59d' : '#facc15', 42, 3);
              vfx.popup(
                baseLx,
                TARGET_Y - 28,
                perfect ? `PERFECT +${pts}` : `GREAT +${pts}`,
                perfect ? '#2ee59d' : '#facc15',
                13,
              );
              sound.combo(Math.min(14, combos[i]));
              rumble(i, perfect ? 40 : 30, perfect ? 0.4 : 0.3);
              if (combos[i] > 0 && combos[i] % 10 === 0) {
                vfx.ring(baseLx, TARGET_Y, '#fde047', 90, 3.5);
                vfx.popup(baseLx, TARGET_Y - 54, `${combos[i]} COMBO!`, '#fde047', 16);
                vfx.shake(3);
                rumble(i, 80, 0.55);
              }
            } else {
              combos[i] = 0;
              vfx.popup(baseLx, TARGET_Y - 24, 'MISS', '#fb7185', 12);
              sound.hit();
            }
          }

          // Combo multiplier flames
          if (combos[i] >= 5 && frame % 3 === 0) {
            vfx.spark(
              baseLx + (Math.random() - 0.5) * 90,
              TARGET_Y + 8,
              0,
              -2.2,
              fever ? '#fde047' : '#ff6b2b',
              3.5,
            );
          }
        }

        if (timer <= 0) {
          let best = 0;
          for (let i = 1; i < 4; i++) {
            if (active[i].enabled && scores[i] > scores[best]) best = i;
          }
          let tied = false;
          for (let i = 0; i < 4; i++) {
            if (i !== best && active[i].enabled && scores[i] === scores[best]) tied = true;
          }
          freeze = 100;
          if (tied) {
            banner = 'DEAD HEAT — DRAW!';
            sound.explosion();
          } else {
            wins[best]++;
            banner = `${active[best].name} BEAT CHAMPION!`;
            sound.win();
            vfx.confetti(150 + best * 220, 260, 50);
            vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 26);
            vfx.flash(active[best].color, 0.25);
            rumble(best, 220, 0.6);
          }
        }
      }

      drawArcadeBackdrop(ctx, fever ? '#facc15' : '#c084fc');

      // Pulsing audio equalizer bars behind track!
      ctx.save();
      for (let b = 0; b < 24; b++) {
        const bx = 54 + b * 36;
        const beat = Math.abs(Math.sin(frame * (fever ? 0.22 : 0.14) + b * 0.55));
        const bh = 40 + beat * (fever ? 190 : 120);
        ctx.fillStyle = fever ? 'rgba(250, 204, 21, 0.14)' : 'rgba(192, 132, 252, 0.11)';
        ctx.fillRect(bx, GAME_HEIGHT - 34 - bh, 24, bh);
      }
      ctx.restore();

      if (fever) {
        ctx.save();
        ctx.fillStyle = '#fde047';
        ctx.font = '800 13px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('★ FEVER CHORUS 2X SCORE ★', GAME_WIDTH / 2, 78);
        ctx.restore();
      }

      // Draw 4 player highways (each with 4 directional/button sublanes)
      for (let i = 0; i < 4; i++) {
        const lx = 150 + i * 220;
        ctx.fillStyle = i === leaderSlot ? 'rgba(250, 204, 21, 0.05)' : 'rgba(255,255,255,0.03)';
        ctx.fillRect(lx - 66, 72, 132, GAME_HEIGHT - 106);

        for (let l = 0; l < 4; l++) {
          const sx = lx - 45 + l * 30;
          ctx.strokeStyle = active[i].enabled ? `${LANE_COLORS[l]}88` : 'rgba(255,255,255,0.1)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(sx, TARGET_Y, 12, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = 'rgba(243,242,237,0.55)';
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(LABELS[l], sx, TARGET_Y + 24);
        }
      }

      // Notes: additive halo pass + solid core (no shadowBlur × notes × 4 highways).
      // A note a player already hit disappears from that player's highway.
      if (notes.length > 0) {
        ctx.save();
        for (let pass = 0; pass < 2; pass++) {
          ctx.globalCompositeOperation = pass === 0 ? 'lighter' : 'source-over';
          ctx.globalAlpha = pass === 0 ? 0.3 : 1;
          const rad = pass === 0 ? 16 : 10;
          for (const n of notes) {
            ctx.fillStyle = LANE_COLORS[n.lane];
            for (let i = 0; i < 4; i++) {
              if (!active[i].enabled || n.hit & (1 << i)) continue;
              const sx = 150 + i * 220 - 45 + n.lane * 30;
              ctx.beginPath();
              ctx.arc(sx, n.y, rad, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'LOADING NEXT TRACK...', '#c084fc');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderSlot,
          valueText: `${scores[i]}pt · ${combos[i]}x · W${wins[i]}`,
        })),
        `TIME ${Math.ceil(timer / 60)}s   ·   HIT LANE: ←/X   ↓/A   ↑/Y   →/B`,
      );
    },
  };
}

// 25. ICE BUMPER BASH (Cracking Ice Holes, Sliding Pinball Pucks, Power-Slide Slam, Hitstop Plunge!)
export function createIceBumperBashEngine(): MiniGameEngine {
  const CX = GAME_WIDTH / 2;
  const CY = 294;
  const RX = 335;
  const RY = 195;
  const wins = [0, 0, 0, 0];

  const makeSkaters = () =>
    [0, 1, 2, 3].map((i) => ({
      x: CX + (i % 2 === 0 ? -155 : 155),
      y: CY + (i < 2 ? -80 : 80),
      vx: 0,
      vy: 0,
      alive: true,
      dashCd: 0,
      prevA: false,
      dirX: i % 2 === 0 ? 1 : -1,
      dirY: 0,
    }));

  const makeHoles = () => [
    { x: CX, y: CY, r: 34, state: 'crack' as 'crack' | 'open', timer: 160 },
    { x: CX - 130, y: CY - 55, r: 28, state: 'crack' as 'crack' | 'open', timer: 260 },
    { x: CX + 130, y: CY + 55, r: 28, state: 'crack' as 'crack' | 'open', timer: 340 },
  ];

  const makePucks = () => [
    { x: CX - 80, y: CY + 70, vx: 4.2, vy: -3.1, r: 16 },
    { x: CX + 80, y: CY - 70, vx: -3.8, vy: 3.4, r: 16 },
  ];

  let skaters = makeSkaters();
  let holes = makeHoles();
  let pucks = makePucks();
  let banner = '';
  let freeze = 20;

  const reset = () => {
    skaters = makeSkaters();
    holes = makeHoles();
    pucks = makePucks();
    banner = '';
    freeze = 20;
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      const maxW = Math.max(...wins);
      const leaderSlot = maxW > 0 ? wins.indexOf(maxW) : -1;

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        // Update cracking ice holes
        for (const h of holes) {
          h.timer--;
          if (h.timer <= 0) {
            if (h.state === 'crack') {
              h.state = 'open';
              h.timer = 260;
              vfx.burst(h.x, h.y, '#7dd3fc', 16, 4.5);
              vfx.ring(h.x, h.y, '#38bdf8', h.r + 24, 3);
              sound.noiseBurst(0.14, 1200, 0.12);
            } else {
              h.state = 'crack';
              h.timer = 220;
            }
          }
        }

        // Update sliding pinball hazard pucks
        for (const pk of pucks) {
          pk.x += pk.vx;
          pk.y += pk.vy;
          const norm = ((pk.x - CX) / (RX - pk.r)) ** 2 + ((pk.y - CY) / (RY - pk.r)) ** 2;
          if (norm > 1) {
            const nx = (pk.x - CX) / (RX * RX);
            const ny = (pk.y - CY) / (RY * RY);
            const nm = Math.hypot(nx, ny) || 1;
            const ux = nx / nm;
            const uy = ny / nm;
            const dot = pk.vx * ux + pk.vy * uy;
            pk.vx -= 2 * dot * ux;
            pk.vy -= 2 * dot * uy;
            pk.x = CX + (pk.x - CX) * 0.96;
            pk.y = CY + (pk.y - CY) * 0.96;
            sound.beep(520, 0.04, 'triangle', 0.06);
          }
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !skaters[i].alive) continue;
          const s = skaters[i];
          let ix = 0;
          let iy = 0;
          let btnA = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            btnA = inp.actionA;
          } else {
            // Judge danger from where momentum will carry us (ice!), and check holes BEFORE
            // retreating to centre — the old AI fled the rim straight into the open centre hole.
            const px = s.x + s.vx * 14;
            const py = s.y + s.vy * 14;
            const edgeDanger = ((px - CX) / RX) ** 2 + ((py - CY) / RY) ** 2 > 0.6;
            let nearHole: (typeof holes)[number] | null = null;
            for (const h of holes) {
              const warn = h.state === 'open' || (h.state === 'crack' && h.timer < 40);
              if (warn && Math.hypot(px - h.x, py - h.y) < h.r + 42) {
                nearHole = h;
                break;
              }
            }
            if (nearHole) {
              const d = Math.hypot(s.x - nearHole.x, s.y - nearHole.y) || 1;
              ix = (s.x - nearHole.x) / d;
              iy = (s.y - nearHole.y) / d;
              if (edgeDanger) {
                // Blend toward centre but slide tangentially around the hole
                const cd = Math.hypot(CX - s.x, CY - s.y) || 1;
                ix = ix * 0.6 + ((CX - s.x) / cd) * 0.4;
                iy = iy * 0.6 + ((CY - s.y) / cd) * 0.4;
              }
            } else if (edgeDanger) {
              const d = Math.hypot(CX - s.x, CY - s.y) || 1;
              ix = (CX - s.x) / d - s.vx * 0.08;
              iy = (CY - s.y) / d - s.vy * 0.08;
            } else {
              // Hunt the NEAREST rival, preferring ones already close to the rim
              let target: (typeof skaters)[number] | null = null;
              let bestScore = Infinity;
              for (let j = 0; j < 4; j++) {
                const o = skaters[j];
                if (j === i || !active[j].enabled || !o.alive) continue;
                const rim = ((o.x - CX) / RX) ** 2 + ((o.y - CY) / RY) ** 2;
                const sc = Math.hypot(o.x - s.x, o.y - s.y) - rim * 120;
                if (sc < bestScore) {
                  bestScore = sc;
                  target = o;
                }
              }
              if (target) {
                const d = Math.hypot(target.x - s.x, target.y - s.y) || 1;
                ix = ((target.x - s.x) / d) * 0.8 - s.vx * 0.05;
                iy = ((target.y - s.y) / d) * 0.8 - s.vy * 0.05;
                if (d < 95 && s.dashCd === 0 && Math.random() < 0.12) btnA = true;
              }
            }
          }

          if (Math.hypot(ix, iy) > 0.15) {
            const m = Math.hypot(ix, iy);
            s.dirX = ix / m;
            s.dirY = iy / m;
          }

          if (s.dashCd > 0) s.dashCd--;
          const tapA = btnA && !s.prevA;
          s.prevA = btnA;

          if (tapA && s.dashCd === 0) {
            const dx = Math.hypot(ix, iy) > 0.1 ? ix : s.dirX;
            const dy = Math.hypot(ix, iy) > 0.1 ? iy : s.dirY;
            s.vx += dx * 8.4;
            s.vy += dy * 8.4;
            s.dashCd = 40;
            vfx.ring(s.x, s.y, '#7dd3fc', 48, 3);
            vfx.afterimage(s.x, s.y, 20, '#bae6fd', 12);
            sound.dash();
          }

          // Slippery ice friction (0.985)
          s.vx = (s.vx + ix * 0.29) * 0.985;
          s.vy = (s.vy + iy * 0.29) * 0.985;
          s.x += s.vx;
          s.y += s.vy;

          if (Math.hypot(s.vx, s.vy) > 4.6 && frame % 2 === 0) {
            vfx.afterimage(s.x, s.y, 18, active[i].color, 8);
          }

          // Pinball hazard puck collision
          for (const pk of pucks) {
            const dp = Math.hypot(s.x - pk.x, s.y - pk.y);
            if (dp > 0 && dp < 20 + pk.r) {
              const nx = (s.x - pk.x) / dp;
              const ny = (s.y - pk.y) / dp;
              s.vx = nx * 9.2;
              s.vy = ny * 9.2;
              // Separate so the puck doesn't re-trigger next frame
              s.x = pk.x + nx * (21 + pk.r);
              s.y = pk.y + ny * (21 + pk.r);
              pk.vx = -nx * 5;
              pk.vy = -ny * 5;
              vfx.ring(pk.x, pk.y, '#38bdf8', 55, 3);
              vfx.burst(pk.x + nx * pk.r, pk.y + ny * pk.r, '#ff6b2b', 10, 4.5);
              vfx.hitstop(1);
              vfx.shake(4);
              sound.hit();
              rumble(i, 95, 0.75);
            }
          }

          // Plunge into open ice hole or off rink edge!
          const fellHole = holes.find((h) => h.state === 'open' && Math.hypot(s.x - h.x, s.y - h.y) < h.r - 4);
          const offEdge = ((s.x - CX) / RX) ** 2 + ((s.y - CY) / RY) ** 2 > 1.04;
          if (fellHole || offEdge) {
            s.alive = false;
            vfx.hitstop(2);
            vfx.burst(s.x, s.y, '#7dd3fc', 28, 7);
            vfx.ring(s.x, s.y, '#38bdf8', 75, 4);
            vfx.popup(s.x, s.y - 16, fellHole ? 'FROZEN PLUNGE!' : 'SLIPPED OFF!', '#38bdf8', 15);
            vfx.shake(10);
            sound.explosion();
            rumble(i, 170, 0.95);
          }
        }

        // Skater vs Skater slams
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !skaters[i].alive) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled || !skaters[j].alive) continue;
            const a = skaters[i];
            const b = skaters[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0 && dist < 42) {
              const nx = dx / dist;
              const ny = dy / dist;
              // Only resolve if approaching — otherwise overlapping skaters re-collided every
              // frame (sound/rumble/particle spam and compounding impulses)
              const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
              // Positional separation so they never stay interpenetrated
              const push = (42 - dist) / 2;
              a.x -= nx * push;
              a.y -= ny * push;
              b.x += nx * push;
              b.y += ny * push;
              if (closing > 0) {
                const aSpd = Math.hypot(a.vx, a.vy);
                const bSpd = Math.hypot(b.vx, b.vy);
                const force = 5.5 + Math.max(aSpd, bSpd) * 0.45;
                a.vx -= nx * force;
                a.vy -= ny * force;
                b.vx += nx * force;
                b.vy += ny * force;
                const mx2 = (a.x + b.x) / 2;
                const my2 = (a.y + b.y) / 2;
                vfx.burst(mx2, my2, '#e0f2fe', 12, 5);
                sound.hit();
                if (force > 8.5) {
                  vfx.hitstop(2);
                  vfx.shake(5);
                  vfx.ring(mx2, my2, '#bae6fd', 50, 2.5);
                }
                rumble(i, 70, 0.65);
                rumble(j, 70, 0.65);
              }
            }
          }
        }

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && skaters[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          if (alive.length === 1) {
            wins[alive[0]]++;
            banner = `${active[alive[0]].name} ICE KING!`;
            sound.win();
            vfx.confetti(skaters[alive[0]].x, skaters[alive[0]].y, 44);
            vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 26);
            vfx.flash('#38bdf8', 0.22);
            rumble(alive[0], 220, 0.6);
          } else {
            banner = 'RINK CLEARED!';
          }
          freeze = 90;
        }
      }

      drawArcadeBackdrop(ctx, '#38bdf8');

      // Ice Rink
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(CX, CY, RX, RY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Cracking / Open ice holes
      for (const h of holes) {
        if (h.state === 'open') {
          ctx.fillStyle = '#07111e';
          ctx.strokeStyle = '#bae6fd';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (h.timer < 90) {
          ctx.strokeStyle = h.timer < 40 && Math.floor(frame / 4) % 2 === 0 ? '#facc15' : '#bae6fd';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            ctx.moveTo(h.x, h.y);
            ctx.lineTo(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r);
          }
          ctx.stroke();
        }
      }

      // Pinball hazard pucks
      for (const pk of pucks) {
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#ff6b2b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, pk.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !skaters[i].alive) continue;
        const s = skaters[i];
        drawPlayerOrb(ctx, s.x, s.y, 20, active[i].color, i, {
          angle: Math.atan2(s.dirY, s.dirX),
          leader: i === leaderSlot,
          cooldownPct: s.dashCd / 40,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'FREEZING NEW RINK...', '#38bdf8');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderSlot,
          valueText: `${skaters[i].alive ? 'ON' : 'OUT'} · W${wins[i]}`,
        })),
        'SLIDE ON ICE: STICK / WASD   ·   POWER-SLIDE SLAM: A / SPACE',
      );
    },
  };
}
