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

// 41. GHOST HUNT (Battery/Overheat, UV Stun Flash, Golden King Ghost & Dark Fog Vignette)
export function createGhostHuntEngine(): MiniGameEngine {
  const TARGET_SCORE = 1000;
  const scores = [0, 0, 0, 0];
  const wins = [0, 0, 0, 0];
  let banner = '';
  let bannerSub = '';
  let freeze = 20;

  const spawnHunter = (i: number) => ({
    x: i % 2 === 0 ? 180 : GAME_WIDTH - 180,
    y: i < 2 ? 170 : 410,
    angle: i % 2 === 0 ? 0 : Math.PI,
    cd: 0,
    uvCd: 0,
    battery: 100,
    prevA: false,
    prevB: false,
    botTarget: -1,
  });
  const hunters = [0, 1, 2, 3].map(spawnHunter);

  interface Ghost {
    x: number;
    y: number;
    vx: number;
    vy: number;
    revealed: number;
    stunned: number;
    king: boolean;
  }

  const spawnGhost = (king = false): Ghost => ({
    x: 130 + Math.random() * (GAME_WIDTH - 260),
    y: 110 + Math.random() * (GAME_HEIGHT - 180),
    vx: (Math.random() - 0.5) * (king ? 4.4 : 2.9),
    vy: (Math.random() - 0.5) * (king ? 4.4 : 2.9),
    revealed: 0,
    stunned: 0,
    king,
  });

  const ghosts: Ghost[] = [
    spawnGhost(false),
    spawnGhost(false),
    spawnGhost(false),
    spawnGhost(false),
    spawnGhost(false),
    spawnGhost(true),
  ];

  let batteries: Array<{ x: number; y: number; life: number }> = [
    { x: GAME_WIDTH / 2, y: 290, life: 450 },
  ];

  const resetMatch = () => {
    for (let i = 0; i < 4; i++) {
      scores[i] = 0;
      Object.assign(hunters[i], spawnHunter(i));
    }
    for (let gi = 0; gi < ghosts.length; gi++) Object.assign(ghosts[gi], spawnGhost(ghosts[gi].king));
    batteries = [{ x: GAME_WIDTH / 2, y: 290, life: 450 }];
    banner = '';
    bannerSub = '';
    freeze = 20;
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

      const playing = freeze === 0;
      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetMatch();
      }

      if (playing && frame % 175 === 0 && batteries.length < 3) {
        batteries.push({
          x: 130 + Math.random() * (GAME_WIDTH - 260),
          y: 115 + Math.random() * (GAME_HEIGHT - 190),
          life: 450,
        });
      }
      for (let bi = batteries.length - 1; bi >= 0; bi--) {
        if (--batteries[bi].life <= 0) batteries.splice(bi, 1);
      }

      for (const g of ghosts) {
        if (g.stunned > 0) {
          g.stunned--;
          g.revealed = Math.max(g.revealed, 4);
        } else {
          g.x += g.vx;
          g.y += g.vy;
          if (g.x < 64 || g.x > GAME_WIDTH - 64) g.vx *= -1;
          if (g.y < 96 || g.y > GAME_HEIGHT - 56) g.vy *= -1;
          if ((g.king || g.revealed > 0) && frame % 3 === 0) {
            vfx.afterimage(g.x, g.y, g.king ? 16 : 13, g.king ? '#facc15' : '#c084fc', 10);
          }
        }
        if (g.revealed > 0) g.revealed--;
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !playing) continue;
        const h = hunters[i];
        let ix = 0;
        let iy = 0;
        let zapBtn = false;
        let uvBtn = false;

        if (active[i].isHuman) {
          const inp = readPlayerInput(i, pads, keys);
          ix = inp.x;
          iy = inp.y;
          zapBtn = inp.actionA;
          uvBtn = inp.actionB;
        } else {
          // Bot: hunt the best nearby ghost (king worth a detour), refuel when low.
          // Previously every bot chased the king ghost in a single conga line.
          if (h.botTarget < 0 || frame % 45 === i * 11) {
            let best = 0;
            let bestScore = Infinity;
            for (let gi = 0; gi < ghosts.length; gi++) {
              const g = ghosts[gi];
              const sc = Math.hypot(g.x - h.x, g.y - h.y) - (g.king ? 120 : 0) - (g.stunned > 0 ? 80 : 0) + Math.random() * 90;
              if (sc < bestScore) {
                bestScore = sc;
                best = gi;
              }
            }
            h.botTarget = best;
          }
          let tx = ghosts[h.botTarget].x;
          let ty = ghosts[h.botTarget].y;
          if (h.battery < 30 && batteries.length > 0) {
            tx = batteries[0].x;
            ty = batteries[0].y;
          }
          const d = Math.hypot(tx - h.x, ty - h.y) || 1;
          ix = ((tx - h.x) / d) * 0.82;
          iy = ((ty - h.y) / d) * 0.82;
          const g = ghosts[h.botTarget];
          const gd = Math.hypot(g.x - h.x, g.y - h.y);
          if (gd < 150 && g.revealed > 0 && h.cd === 0 && h.battery >= 18 && Math.random() < 0.25) zapBtn = true;
          if (gd < 120 && h.uvCd === 0 && h.battery >= 35 && Math.random() < 0.04) uvBtn = true;
        }

        const trigA = zapBtn && !h.prevA;
        h.prevA = zapBtn;
        const trigB = uvBtn && !h.prevB;
        h.prevB = uvBtn;

        if (Math.hypot(ix, iy) > 0.15) h.angle = Math.atan2(iy, ix);
        h.x = Math.max(54, Math.min(GAME_WIDTH - 54, h.x + ix * 4.5));
        h.y = Math.max(88, Math.min(GAME_HEIGHT - 50, h.y + iy * 4.5));
        if (h.cd > 0) h.cd--;
        if (h.uvCd > 0) h.uvCd--;
        h.battery = Math.min(100, h.battery + 0.14);

        // Battery pickups
        for (let bi = batteries.length - 1; bi >= 0; bi--) {
          if (Math.hypot(h.x - batteries[bi].x, h.y - batteries[bi].y) < 26) {
            h.battery = Math.min(100, h.battery + 50);
            vfx.popup(batteries[bi].x, batteries[bi].y - 12, '+50 CHARGE!', '#2ee59d');
            vfx.ring(batteries[bi].x, batteries[bi].y, '#2ee59d', 36, 2);
            sound.pickup(120);
            buzz(i, 40, 0.3);
            batteries.splice(bi, 1);
          }
        }

        // Flashlight Cone Reveal
        const coneRange = h.battery > 10 ? 195 : 110;
        for (const g of ghosts) {
          const dx = g.x - h.x;
          const dy = g.y - h.y;
          const d = Math.hypot(dx, dy);
          if (d < coneRange) {
            const angDiff = Math.abs(
              Math.atan2(Math.sin(Math.atan2(dy, dx) - h.angle), Math.cos(Math.atan2(dy, dx) - h.angle)),
            );
            if (angDiff < 0.48) g.revealed = 18;
          }
        }

        // Pulsing UV Stun Flash (B)
        if (trigB && h.uvCd === 0 && h.battery >= 22) {
          h.uvCd = 110;
          h.battery -= 22;
          vfx.ring(h.x, h.y, '#c084fc', 150, 4);
          vfx.flash('#c084fc', 0.14);
          sound.combo(4);
          sound.sweep(1400, 400, 0.2, 'sine', 0.06);
          buzz(i, 60, 0.45);
          for (const g of ghosts) {
            if (Math.hypot(g.x - h.x, g.y - h.y) < 155) {
              g.stunned = 115;
              g.revealed = 115;
              vfx.popup(g.x, g.y - 16, 'UV STUN!', '#e9d5ff');
            }
          }
        }

        // Proton Zap (A)
        if (trigA && h.cd === 0 && h.battery >= 14) {
          h.cd = 24;
          h.battery -= 14;
          sound.dash();
          vfx.afterimage(h.x, h.y, 17, active[i].color, 10);
          let hitAny = false;
          for (const g of ghosts) {
            const d = Math.hypot(g.x - h.x, g.y - h.y);
            if (d < 165 && g.revealed > 0) {
              hitAny = true;
              const pts = g.king ? 50 : 25;
              scores[i] += pts;
              // Twin proton tether stream + plasma afterimages along the stream
              vfx.bolt(h.x, h.y, g.x, g.y, g.king ? '#facc15' : active[i].color);
              vfx.bolt(h.x, h.y, g.x, g.y, '#ffffff');
              for (let s = 1; s <= 4; s++) {
                const t = s / 5;
                vfx.afterimage(
                  h.x + (g.x - h.x) * t,
                  h.y + (g.y - h.y) * t,
                  g.king ? 9 : 7,
                  g.king ? '#facc15' : '#c084fc',
                  9,
                );
              }
              vfx.ring(g.x, g.y, g.king ? '#facc15' : active[i].color, g.king ? 88 : 54, g.king ? 4 : 2.8);
              vfx.burst(g.x, g.y, g.king ? '#facc15' : '#c084fc', g.king ? 30 : 16, g.king ? 7 : 6);
              vfx.popup(g.x, g.y - 16, g.king ? 'KING +50!' : 'ZAP +25!', g.king ? '#facc15' : active[i].color, g.king ? 17 : 14);
              if (g.king) {
                vfx.hitstop(4);
                vfx.shake(9);
                vfx.flash('#facc15', 0.22);
                vfx.confetti(g.x, g.y, 24);
                sound.explosion();
                sound.combo(12);
                buzz(i, 200, 0.95);
              } else {
                vfx.hitstop(2);
                vfx.shake(3);
                sound.pickup(i * 75);
                buzz(i, 90, 0.65);
              }

              // Respawn ghost
              const wasKing = g.king;
              const fresh = spawnGhost(wasKing);
              g.x = fresh.x;
              g.y = fresh.y;
              g.vx = fresh.vx;
              g.vy = fresh.vy;
              g.revealed = 0;
              g.stunned = 0;
              break;
            }
          }
          if (!hitAny) {
            const ex = h.x + Math.cos(h.angle) * 90;
            const ey = h.y + Math.sin(h.angle) * 90;
            vfx.bolt(h.x, h.y, ex, ey, 'rgba(192,132,252,0.55)');
            vfx.afterimage(h.x + Math.cos(h.angle) * 45, h.y + Math.sin(h.angle) * 45, 7, '#c084fc', 7);
          }
        }
      }

      // Match win
      if (playing) {
        let winner = -1;
        for (let i = 0; i < 4; i++) {
          if (active[i].enabled && scores[i] >= TARGET_SCORE && (winner < 0 || scores[i] > scores[winner])) winner = i;
        }
        if (winner >= 0) {
          wins[winner]++;
          banner = `${active[winner].name} GHOSTBUSTED!`;
          bannerSub = `FIRST TO ${TARGET_SCORE}PT · RE-HAUNTING THE MANOR...`;
          vfx.confetti(GAME_WIDTH / 2, 220, 44);
          vfx.confetti(hunters[winner].x, hunters[winner].y, 30);
          vfx.flash('#c084fc', 0.25);
          sound.win();
          buzz(winner, 260, 0.9);
          freeze = 120;
        }
      }

      drawArcadeBackdrop(ctx, '#c084fc');

      // Spooky Fog Vignette
      ctx.save();
      const fog = ctx.createRadialGradient(GAME_WIDTH / 2, 290, 90, GAME_WIDTH / 2, 290, 480);
      fog.addColorStop(0, 'rgba(5, 7, 12, 0.15)');
      fog.addColorStop(1, 'rgba(3, 4, 8, 0.72)');
      ctx.fillStyle = fog;
      ctx.fillRect(28, 64, GAME_WIDTH - 56, GAME_HEIGHT - 92);
      ctx.restore();

      // Battery Pickups
      for (const b of batteries) {
        ctx.save();
        ctx.shadowColor = '#2ee59d';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#065f46';
        ctx.strokeStyle = '#2ee59d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(b.x - 8, b.y - 11, 16, 22, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#a7f3d0';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('+', b.x, b.y + 4);
        ctx.restore();
      }

      // Flashlight Cones
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const h = hunters[i];
        const coneRange = h.battery > 10 ? 195 : 110;
        ctx.save();
        ctx.fillStyle = `${active[i].color}22`;
        ctx.beginPath();
        ctx.moveTo(h.x, h.y);
        ctx.arc(h.x, h.y, coneRange, h.angle - 0.45, h.angle + 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Ghosts + Spooky Glowing Eyes in the Fog
      for (const g of ghosts) {
        ctx.save();
        const alpha = g.revealed > 0 ? 0.95 : 0.12;
        ctx.globalAlpha = alpha;
        if (g.revealed > 0) {
          ctx.shadowColor = g.king ? '#facc15' : g.stunned > 0 ? '#38bdf8' : '#c084fc';
          ctx.shadowBlur = 18;
        }
        ctx.fillStyle = g.king ? '#fde047' : g.stunned > 0 ? '#7dd3fc' : '#e9d5ff';
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.king ? 19 : 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Spooky eyes always subtly visible in fog
        ctx.save();
        ctx.fillStyle = g.king ? '#fde047' : g.stunned > 0 ? '#38bdf8' : '#e879f9';
        ctx.globalAlpha = g.revealed > 0 ? 1 : 0.55;
        ctx.beginPath();
        ctx.arc(g.x - 5, g.y - 2, 2.5, 0, Math.PI * 2);
        ctx.arc(g.x + 5, g.y - 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Hunters + Battery Bar
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const h = hunters[i];
        drawPlayerOrb(ctx, h.x, h.y, 16, active[i].color, i, {
          angle: h.angle,
          leader: maxScore > 0 && scores[i] === maxScore,
          cooldownPct: h.uvCd / 110,
        });
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(h.x - 16, h.y + 20, 32, 4);
        ctx.fillStyle = h.battery > 30 ? '#2ee59d' : '#ef4444';
        ctx.fillRect(h.x - 16, h.y + 20, (32 * h.battery) / 100, 4);
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#c084fc');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: maxScore > 0 && scores[i] === maxScore,
          valueText: maxWins > 0 ? `${scores[i]}/${TARGET_SCORE} W${wins[i]}` : `${scores[i]}/${TARGET_SCORE}`,
        })),
        'SHINE BEAM: STICK / WASD · PROTON ZAP: A / SPACE · UV STUN FLASH: B / SHIFT',
      );
    },
  };
}

// 42. CONVEYOR CHAOS (Multi-Directional Belts, Crusher Pistons, Shove Dash & Bonus Gears)
export function createConveyorChaosEngine(): MiniGameEngine {
  const wins = [0, 0, 0, 0];

  interface Piston {
    x: number;
    y: number;
    w: number;
    h: number;
    phase: number;
    slammed: boolean;
  }

  interface Gear {
    x: number;
    y: number;
    life: number;
  }

  let workers = [0, 1, 2, 3].map((i) => ({
    x: 240 + i * 150,
    y: 280,
    vx: 0,
    vy: 0,
    angle: 0,
    alive: true,
    dashCd: 0,
    prevA: false,
    gears: 0,
  }));

  const pistons: Piston[] = [
    { x: 250, y: 120, w: 72, h: 72, phase: 0, slammed: false },
    { x: GAME_WIDTH - 322, y: 120, w: 72, h: 72, phase: 95, slammed: false },
    { x: GAME_WIDTH / 2 - 36, y: 250, w: 72, h: 72, phase: 45, slammed: false },
    { x: 250, y: 382, w: 72, h: 72, phase: 140, slammed: false },
    { x: GAME_WIDTH - 322, y: 382, w: 72, h: 72, phase: 60, slammed: false },
  ];

  let gears: Gear[] = [{ x: GAME_WIDTH / 2, y: 160, life: 420 }];
  let banner = '';
  let bannerSub = '';
  let freeze = 20;
  let roundTime = 0;
  let bumpSfxCd = 0;
  let bestSoloTime = 0;

  const BELTS = [
    { y: 86, h: 132, dir: -1 },
    { y: 222, h: 132, dir: 1 },
    { y: 358, h: 134, dir: -1 },
  ];

  const reset = () => {
    workers = [0, 1, 2, 3].map((i) => ({
      x: 240 + i * 150,
      y: 280,
      vx: 0,
      vy: 0,
      angle: 0,
      alive: true,
      dashCd: 0,
      prevA: false,
      gears: 0,
    }));
    gears = [{ x: GAME_WIDTH / 2, y: 160, life: 420 }];
    banner = '';
    bannerSub = '';
    freeze = 20;
    roundTime = 0;
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });
      const maxWins = Math.max(...wins);
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (active[slot].isHuman) rumble(slot, ms, intensity);
      };

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        roundTime++;
        if (bumpSfxCd > 0) bumpSfxCd--;
        if (frame % 150 === 0 && gears.length < 3) {
          gears.push({
            x: 160 + Math.random() * (GAME_WIDTH - 320),
            y: 115 + Math.random() * (GAME_HEIGHT - 190),
            life: 400,
          });
        }
        for (let gi = gears.length - 1; gi >= 0; gi--) {
          if (--gears[gi].life <= 0) gears.splice(gi, 1);
        }

        // Overtime: after 30s the belts steadily speed up so stalemates always resolve
        const overtime = Math.min(1.6, Math.max(0, roundTime - 1800) / 2400);
        if (roundTime === 1800) {
          vfx.popup(GAME_WIDTH / 2, 120, 'OVERTIME · BELTS SPEEDING UP!', '#fb7185', 18);
          vfx.flash('#ef4444', 0.12);
          sound.sweep(200, 600, 0.4, 'sawtooth', 0.08);
        }
        const beltSpeed = (2.6 + Math.sin(frame * 0.02) * 1.2) * (1 + overtime * 0.35);

        // Piston cycle: 0..130 idle, 130..175 warning, 175..195 active slam!
        for (const pt of pistons) {
          const cyc = (frame + pt.phase) % 210;
          if (cyc === 175 && !pt.slammed) {
            pt.slammed = true;
            const pcx = pt.x + pt.w / 2;
            const pcy = pt.y + pt.h / 2;
            vfx.shake(6.5);
            vfx.ring(pcx, pcy, '#facc15', 66, 3.2);
            vfx.burst(pcx, pcy, '#ff6b2b', 12, 5.2);
            // Metallic sparks flying outward from all 4 hydraulic crusher corners
            const corners = [
              { x: pt.x, y: pt.y, dx: -1, dy: -1 },
              { x: pt.x + pt.w, y: pt.y, dx: 1, dy: -1 },
              { x: pt.x, y: pt.y + pt.h, dx: -1, dy: 1 },
              { x: pt.x + pt.w, y: pt.y + pt.h, dx: 1, dy: 1 },
            ];
            for (const c of corners) {
              for (let s = 0; s < 3; s++) {
                vfx.spark(
                  c.x,
                  c.y,
                  c.dx * (3.2 + Math.random() * 3.8) + (Math.random() - 0.5) * 2,
                  c.dy * (3.2 + Math.random() * 3.8) + (Math.random() - 0.5) * 2,
                  s === 0 ? '#ffffff' : '#facc15',
                  3.2,
                );
              }
            }
            sound.noiseBurst(0.14, 520, 0.14);
          } else if (cyc < 175) {
            pt.slammed = false;
          }
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !workers[i].alive) continue;
          const w = workers[i];
          let ix = 0;
          let iy = 0;
          let dashBtn = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            dashBtn = inp.actionA;
          } else {
            // Smart bot: avoid warning pistons & laser borders, grab gears
            let targetX = GAME_WIDTH / 2;
            let targetY = 288 + Math.sin(frame * 0.03 + i) * 70;
            if (gears.length > 0) {
              targetX = gears[0].x;
              targetY = gears[0].y;
            }
            for (const pt of pistons) {
              const cyc = (frame + pt.phase) % 210;
              if (cyc >= 120 && Math.hypot(w.x - (pt.x + pt.w / 2), w.y - (pt.y + pt.h / 2)) < 85) {
                targetX = w.x + (w.x < pt.x + pt.w / 2 ? -90 : 90);
                targetY = w.y + (w.y < pt.y + pt.h / 2 ? -90 : 90);
              }
            }
            // Keep target points away from the saw walls
            targetX = Math.max(170, Math.min(GAME_WIDTH - 170, targetX));
            let d = Math.hypot(targetX - w.x, targetY - w.y) || 1;
            ix = ((targetX - w.x) / d) * 0.88;
            iy = ((targetY - w.y) / d) * 0.88;
            if (w.dashCd === 0 && (w.x < 130 || w.x > GAME_WIDTH - 130)) dashBtn = true;
            // Opportunistic shove: dash into a rival who's drifting near the saws
            if (w.dashCd === 0 && !dashBtn) {
              for (let j = 0; j < 4; j++) {
                if (j === i || !active[j].enabled || !workers[j].alive) continue;
                const o = workers[j];
                d = Math.hypot(o.x - w.x, o.y - w.y);
                const nearSaw = o.x < 200 || o.x > GAME_WIDTH - 200;
                const pushesOut = o.x < GAME_WIDTH / 2 ? o.x < w.x : o.x > w.x;
                if (d < 95 && nearSaw && pushesOut && Math.random() < 0.15) {
                  ix = (o.x - w.x) / d;
                  iy = (o.y - w.y) / d;
                  dashBtn = true;
                  break;
                }
              }
            }
          }

          const trigA = dashBtn && !w.prevA;
          w.prevA = dashBtn;

          if (Math.hypot(ix, iy) > 0.15) w.angle = Math.atan2(iy, ix);
          if (w.dashCd > 0) w.dashCd--;

          if (trigA && w.dashCd === 0) {
            const dAng = Math.hypot(ix, iy) > 0.1 ? Math.atan2(iy, ix) : w.angle;
            w.vx += Math.cos(dAng) * 9.5;
            w.vy += Math.sin(dAng) * 9.5;
            w.dashCd = 44;
            vfx.afterimage(w.x, w.y, 18, active[i].color, 11);
            vfx.ring(w.x, w.y, active[i].color, 46, 2.6);
            vfx.burst(w.x, w.y, active[i].color, 8, 4.2, 2.5);
            sound.dash();
            buzz(i, 45, 0.45);
          }

          if (Math.hypot(w.vx, w.vy) > 4.6) {
            vfx.afterimage(w.x, w.y, 17, active[i].color, 9);
          }

          // 3 horizontal belts: top (<218) left, middle (218..354) right, bottom (>354) left
          const beltDir = w.y < 218 ? -beltSpeed : w.y < 354 ? beltSpeed : -beltSpeed;
          w.vx = (w.vx + ix * 0.78) * 0.88 + beltDir * 0.16;
          w.vy = (w.vy + iy * 0.78) * 0.88;
          w.x += w.vx;
          w.y = Math.max(94, Math.min(GAME_HEIGHT - 52, w.y + w.vy));

          // Gear pickups
          for (let gi = gears.length - 1; gi >= 0; gi--) {
            if (Math.hypot(w.x - gears[gi].x, w.y - gears[gi].y) < 26) {
              w.gears++;
              w.dashCd = 0;
              vfx.popup(gears[gi].x, gears[gi].y - 12, 'GEAR!', '#facc15');
              vfx.ring(gears[gi].x, gears[gi].y, '#facc15', 38, 2);
              sound.combo(w.gears);
              buzz(i, 35, 0.3);
              gears.splice(gi, 1);
            }
          }

          // Crusher piston kill
          let crushed = false;
          for (const pt of pistons) {
            const cyc = (frame + pt.phase) % 210;
            if (cyc >= 175 && cyc < 194) {
              if (w.x > pt.x + 4 && w.x < pt.x + pt.w - 4 && w.y > pt.y + 4 && w.y < pt.y + pt.h - 4) {
                crushed = true;
                break;
              }
            }
          }

          if (crushed || w.x < 78 || w.x > GAME_WIDTH - 78) {
            w.alive = false;
            vfx.hitstop(4);
            vfx.burst(w.x, w.y, '#ef4444', 28, 7.5);
            vfx.burst(w.x, w.y, active[i].color, 14, 5);
            vfx.ring(w.x, w.y, '#ef4444', 78, 3.6);
            vfx.popup(w.x, w.y - 18, crushed ? 'CRUSHED!' : 'SHREDDED!', '#fb7185', 15);
            vfx.flash('#ef4444', 0.16);
            vfx.shake(10);
            sound.explosion();
            buzz(i, 200, 1);
          }
        }

        // Player-to-player shove collisions
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !workers[i].alive) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled || !workers[j].alive) continue;
            const a = workers[i];
            const b = workers[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < 34) {
              const nx = dx / d;
              const ny = dy / d;
              // Separate overlapping bodies so a contact resolves in one frame instead of
              // re-triggering (and re-playing the hit sound) every frame
              const overlap = (34 - d) / 2;
              a.x -= nx * overlap;
              a.y -= ny * overlap;
              b.x += nx * overlap;
              b.y += ny * overlap;
              const aFast = Math.hypot(a.vx, a.vy) > 5.5;
              const bFast = Math.hypot(b.vx, b.vy) > 5.5;
              const push = aFast || bFast ? 6.2 : 4.5;
              a.vx -= nx * push;
              a.vy -= ny * push;
              b.vx += nx * push;
              b.vy += ny * push;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              if (aFast || bFast) {
                vfx.burst(mx, my, '#facc15', 12, 4.5, 2.6);
                vfx.afterimage(a.x, a.y, 17, active[i].color, 9);
                vfx.afterimage(b.x, b.y, 17, active[j].color, 9);
                vfx.ring(mx, my, '#ffffff', 42, 2.5);
                vfx.shake(4);
                vfx.hitstop(2);
                buzz(i, 70, 0.65);
                buzz(j, 70, 0.65);
                sound.hit();
              } else if (bumpSfxCd === 0) {
                vfx.burst(mx, my, '#facc15', 6, 4.5, 2.6);
                sound.beep(240, 0.04, 'square', 0.05);
                bumpSfxCd = 8;
              }
            }
          }
        }

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && workers[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          const secs = roundTime / 60;
          if (alive.length === 1) {
            const w = alive[0];
            wins[w]++;
            banner = `${active[w].name} SURVIVED BELTS!`;
            bannerSub = `LAST WORKER STANDING · ${secs.toFixed(1)}s · RESTARTING CONVEYORS...`;
            vfx.confetti(workers[w].x, workers[w].y, 34);
            vfx.confetti(GAME_WIDTH / 2, 200, 30);
            vfx.flash('#facc15', 0.2);
            sound.win();
            buzz(w, 240, 0.85);
          } else if (total === 1) {
            const isBest = secs > bestSoloTime;
            if (isBest) bestSoloTime = secs;
            banner = isBest ? `NEW BEST · ${secs.toFixed(1)}s!` : `SURVIVED ${secs.toFixed(1)}s`;
            bannerSub = `BEST ${bestSoloTime.toFixed(1)}s · RESTARTING CONVEYORS...`;
            if (isBest) {
              vfx.confetti(GAME_WIDTH / 2, 200, 34);
              sound.win();
            }
          } else {
            banner = 'SHREDDED!';
            bannerSub = 'NOBODY SURVIVED · RESTARTING CONVEYORS...';
          }
          freeze = 100;
        }
      }

      drawArcadeBackdrop(ctx, '#ff6b2b');

      // 3 Animated Conveyor Belts with Chevrons
      for (const bl of BELTS) {
        ctx.fillStyle = '#181e2b';
        ctx.fillRect(68, bl.y, GAME_WIDTH - 136, bl.h);
        ctx.strokeStyle = 'rgba(255, 107, 43, 0.25)';
        ctx.strokeRect(68, bl.y, GAME_WIDTH - 136, bl.h);

        ctx.save();
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.22)';
        ctx.lineWidth = 3;
        const offset = ((frame * 2.5 * bl.dir) % 60 + 60) % 60;
        for (let cx = 80 + offset; cx < GAME_WIDTH - 90; cx += 60) {
          const midY = bl.y + bl.h / 2;
          ctx.beginPath();
          ctx.moveTo(cx - 10 * bl.dir, midY - 18);
          ctx.lineTo(cx + 10 * bl.dir, midY);
          ctx.lineTo(cx - 10 * bl.dir, midY + 18);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Crusher Pistons
      for (const pt of pistons) {
        const cyc = (frame + pt.phase) % 210;
        const warn = cyc >= 130 && cyc < 175;
        const activeSlam = cyc >= 175 && cyc < 194;
        ctx.save();
        ctx.fillStyle = activeSlam
          ? 'rgba(239, 68, 68, 0.88)'
          : warn && frame % 8 < 4
            ? 'rgba(250, 204, 21, 0.38)'
            : 'rgba(15, 23, 42, 0.5)';
        ctx.strokeStyle = activeSlam ? '#ffffff' : warn ? '#facc15' : '#475569';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(pt.x, pt.y, pt.w, pt.h, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = activeSlam ? '#fff' : '#facc15';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(activeSlam ? 'CRUSH!' : warn ? 'WARN!' : 'PRESS', pt.x + pt.w / 2, pt.y + pt.h / 2 + 4);
        ctx.restore();
      }

      // Laser saw borders
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(42, 86, 24, GAME_HEIGHT - 132);
      ctx.fillRect(GAME_WIDTH - 66, 86, 24, GAME_HEIGHT - 132);

      // Golden Gears
      for (const g of gears) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(frame * 0.06);
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#fde047';
        ctx.fillRect(-9, -9, 18, 18);
        ctx.restore();
      }

      // Workers
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !workers[i].alive) continue;
        const w = workers[i];
        drawPlayerOrb(ctx, w.x, w.y, 17, active[i].color, i, {
          angle: w.angle,
          leader: maxWins > 0 && wins[i] === maxWins,
          cooldownPct: w.dashCd / 44,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#ff6b2b');
      }

      // Round clock
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.beginPath();
      ctx.roundRect(GAME_WIDTH / 2 - 44, 60, 88, 22, 7);
      ctx.fill();
      ctx.fillStyle = roundTime >= 1800 && frame % 20 < 10 ? '#fb7185' : '#fdba74';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${(roundTime / 60).toFixed(1)}s`, GAME_WIDTH / 2, 75);

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: maxWins > 0 && wins[i] === maxWins,
          valueText: `${workers[i].alive ? 'ON' : 'KO'} · W${wins[i]}`,
        })),
        'FIGHT BELTS & CRUSHERS: STICK / WASD · SHOVE DASH: A / SPACE',
      );
    },
  };
}

// 43. CYBER GOLF 4P (Rotating Multi-Hole Courses, Bumpers, Sand, Boost Strips & Power Meter)
export function createCyberGolfEngine(): MiniGameEngine {
  interface Bumper {
    x: number;
    y: number;
    r: number;
    pulse: number;
  }
  interface ZoneRect {
    x: number;
    y: number;
    w: number;
    h: number;
    kind: 'sand' | 'boost';
    vx?: number;
    vy?: number;
  }
  interface CourseHole {
    par: number;
    hole: { x: number; y: number };
    bumpers: Bumper[];
    zones: ZoneRect[];
  }

  const courses: CourseHole[] = [
    {
      par: 3,
      hole: { x: GAME_WIDTH - 135, y: 290 },
      bumpers: [
        { x: 460, y: 215, r: 24, pulse: 0 },
        { x: 460, y: 365, r: 24, pulse: 0 },
        { x: 640, y: 290, r: 28, pulse: 0 },
      ],
      zones: [
        { x: 260, y: 245, w: 120, h: 90, kind: 'boost', vx: 0.45, vy: 0 },
        { x: 560, y: 120, w: 140, h: 80, kind: 'sand' },
      ],
    },
    {
      par: 4,
      hole: { x: GAME_WIDTH - 140, y: 150 },
      bumpers: [
        { x: 360, y: 285, r: 26, pulse: 0 },
        { x: 560, y: 220, r: 26, pulse: 0 },
        { x: 560, y: 375, r: 26, pulse: 0 },
      ],
      zones: [
        { x: 380, y: 115, w: 130, h: 75, kind: 'sand' },
        { x: 420, y: 385, w: 140, h: 70, kind: 'boost', vx: 0.4, vy: -0.25 },
      ],
    },
    {
      par: 3,
      hole: { x: GAME_WIDTH - 145, y: 410 },
      bumpers: [
        { x: 420, y: 175, r: 24, pulse: 0 },
        { x: 420, y: 405, r: 24, pulse: 0 },
        { x: 650, y: 290, r: 30, pulse: 0 },
      ],
      zones: [
        { x: 240, y: 140, w: 110, h: 90, kind: 'boost', vx: 0.45, vy: 0.12 },
        { x: 500, y: 250, w: 110, h: 110, kind: 'sand' },
      ],
    },
  ];

  const scores = [0, 0, 0, 0];
  const wins = [0, 0, 0, 0];
  const HOLES_PER_MATCH = 3;
  let holesPlayed = 0;
  let matchOver = false;
  let bannerSub = '';
  let courseIdx = 0;
  let hole = { ...courses[0].hole };
  let bumpers: Bumper[] = courses[0].bumpers.map((b) => ({ ...b }));
  let zones: ZoneRect[] = courses[0].zones.map((z) => ({ ...z }));

  let balls = [0, 1, 2, 3].map((i) => ({
    x: 120,
    y: 165 + i * 75,
    vx: 0,
    vy: 0,
    sunk: false,
    aimAngle: 0,
    power: 0,
    charging: false,
    strokes: 0,
    bankCombo: 0,
  }));
  let banner = '';
  let freeze = 20;

  const loadHole = (idx: number) => {
    courseIdx = idx % courses.length;
    const c = courses[courseIdx];
    hole = { ...c.hole };
    bumpers = c.bumpers.map((b) => ({ ...b }));
    zones = c.zones.map((z) => ({ ...z }));
    balls.forEach((b, i) => {
      b.x = 115;
      b.y = 165 + i * 75;
      b.vx = 0;
      b.vy = 0;
      b.sunk = false;
      b.power = 0;
      b.charging = false;
      b.strokes = 0;
      b.bankCombo = 0;
      b.aimAngle = Math.atan2(hole.y - b.y, hole.x - b.x);
    });
    banner = '';
    bannerSub = '';
    freeze = 20;
  };
  loadHole(0);

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });
      const maxScore = Math.max(...scores);
      const maxWins = Math.max(...wins);
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (active[slot].isHuman) rumble(slot, ms, intensity);
      };

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) {
          if (matchOver) {
            // New match: fresh scorecards, back to hole 1
            matchOver = false;
            holesPlayed = 0;
            for (let i = 0; i < 4; i++) scores[i] = 0;
            loadHole(0);
          } else if (holesPlayed >= HOLES_PER_MATCH) {
            // Final hole done: crown the match champion
            let best = -1;
            let tie = false;
            for (let i = 0; i < 4; i++) {
              if (!active[i].enabled) continue;
              if (best < 0 || scores[i] > scores[best]) {
                best = i;
                tie = false;
              } else if (scores[i] === scores[best]) {
                tie = true;
              }
            }
            matchOver = true;
            if (best >= 0 && !tie) {
              wins[best]++;
              banner = `${active[best].name} CYBER GOLF CHAMP!`;
              buzz(best, 260, 0.9);
            } else {
              banner = 'ALL SQUARE · SHARED TROPHY!';
            }
            bannerSub = `${HOLES_PER_MATCH}-HOLE TOTAL ${best >= 0 ? scores[best] : 0}PT · NEW ROUND TEEING OFF...`;
            vfx.confetti(GAME_WIDTH / 2, 220, 50);
            vfx.confetti(GAME_WIDTH * 0.25, 260, 28);
            vfx.confetti(GAME_WIDTH * 0.75, 260, 28);
            vfx.flash('#facc15', 0.25);
            sound.win();
            freeze = 140;
          } else {
            loadHole(courseIdx + 1);
          }
        }
      } else {
        for (const bmp of bumpers) if (bmp.pulse > 0) bmp.pulse--;

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || balls[i].sunk) continue;
          const b = balls[i];
          const moving = Math.hypot(b.vx, b.vy) > 0.3;

          if (!moving) {
            b.bankCombo = 0;
            if (active[i].isHuman) {
              const inp = readPlayerInput(i, pads, keys);
              if (Math.hypot(inp.x, inp.y) > 0.2) {
                b.aimAngle = Math.atan2(inp.y, inp.x);
              }
              if (inp.actionA) {
                b.charging = true;
                const before = b.power;
                b.power = Math.min(100, b.power + 2.8);
                if (Math.floor(before / 20) !== Math.floor(b.power / 20)) {
                  sound.beep(300 + b.power * 6, 0.03, 'triangle', 0.05);
                }
              } else if (b.charging) {
                b.charging = false;
                const pwr = b.power;
                const spd = 4.5 + (pwr / 100) * 9.5;
                b.vx = Math.cos(b.aimAngle) * spd;
                b.vy = Math.sin(b.aimAngle) * spd;
                b.power = 0;
                b.strokes++;
                if (pwr >= 60) {
                  vfx.afterimage(b.x, b.y, 13, active[i].color, 11);
                  vfx.ring(b.x, b.y, active[i].color, 44, 2.5);
                  vfx.burst(b.x, b.y, active[i].color, 8, 4.2, 2.5);
                  buzz(i, 60, 0.55);
                }
                sound.beep(520 + pwr * 2, 0.05);
                sound.noiseBurst(0.04, 3000, 0.05);
              }
            } else if (Math.random() < 0.045) {
              const dist = Math.hypot(hole.x - b.x, hole.y - b.y);
              const ang = Math.atan2(hole.y - b.y, hole.x - b.x) + (Math.random() - 0.5) * 0.2;
              const spd = Math.min(13, Math.max(6, dist * 0.025));
              b.vx = Math.cos(ang) * spd;
              b.vy = Math.sin(ang) * spd;
              b.strokes++;
              if (spd >= 9.5) vfx.afterimage(b.x, b.y, 12, active[i].color, 10);
              sound.beep(520, 0.05);
            }
          }

          b.x += b.vx;
          b.y += b.vy;

          // Sand slow vs Boost strip
          let friction = 0.968;
          for (const z of zones) {
            if (b.x >= z.x && b.x <= z.x + z.w && b.y >= z.y && b.y <= z.y + z.h) {
              if (z.kind === 'sand') {
                friction = 0.86;
              } else {
                b.vx += z.vx ?? 0.4;
                b.vy += z.vy ?? 0;
                if (frame % 3 === 0) vfx.afterimage(b.x, b.y, 10, '#38bdf8', 7);
              }
            }
          }
          b.vx *= friction;
          b.vy *= friction;

          if (Math.hypot(b.vx, b.vy) > 4.8 && frame % 2 === 0) {
            vfx.afterimage(b.x, b.y, 11, active[i].color, 9);
          }

          if (b.x < 46 || b.x > GAME_WIDTH - 46) {
            b.vx *= -0.85;
            b.x = Math.max(46, Math.min(GAME_WIDTH - 46, b.x));
            b.bankCombo = Math.min(12, b.bankCombo + 1);
            vfx.ring(b.x, b.y, active[i].color, 28, 2);
            if (b.bankCombo >= 2) {
              sound.combo(b.bankCombo);
              vfx.popup(b.x, b.y - 14, `BANK x${b.bankCombo}!`, '#38bdf8', 12);
            } else {
              sound.beep(320, 0.03);
            }
          }
          if (b.y < 80 || b.y > GAME_HEIGHT - 44) {
            b.vy *= -0.85;
            b.y = Math.max(80, Math.min(GAME_HEIGHT - 44, b.y));
            b.bankCombo = Math.min(12, b.bankCombo + 1);
            vfx.ring(b.x, b.y, active[i].color, 28, 2);
            if (b.bankCombo >= 2) {
              sound.combo(b.bankCombo);
              vfx.popup(b.x, b.y - 14, `BANK x${b.bankCombo}!`, '#38bdf8', 12);
            } else {
              sound.beep(320, 0.03);
            }
          }

          // Bumper pegs with electric bolt + ring & consecutive bank combo
          for (const bmp of bumpers) {
            const dx = b.x - bmp.x;
            const dy = b.y - bmp.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < bmp.r + 11) {
              const nx = dx / d;
              const ny = dy / d;
              b.x = bmp.x + nx * (bmp.r + 12);
              b.y = bmp.y + ny * (bmp.r + 12);
              const curSpd = Math.max(6.8, Math.hypot(b.vx, b.vy));
              b.vx = nx * curSpd;
              b.vy = ny * curSpd;
              bmp.pulse = 12;
              b.bankCombo = Math.min(14, b.bankCombo + 1);
              vfx.bolt(bmp.x, bmp.y, b.x, b.y, '#facc15');
              vfx.ring(bmp.x, bmp.y, '#facc15', 54, 3);
              vfx.burst(b.x, b.y, '#fde047', 10, 4.5, 2.5);
              if (b.bankCombo >= 2) {
                vfx.popup(bmp.x, bmp.y - bmp.r - 8, `BOUNCE x${b.bankCombo}!`, '#facc15', 13);
              }
              sound.combo(Math.max(2, b.bankCombo + 1));
              buzz(i, 55, 0.5);
            }
          }

          // Cup drop
          if (Math.hypot(b.x - hole.x, b.y - hole.y) < 22) {
            b.sunk = true;
            const isAce = b.strokes === 1;
            const parBonus = isAce ? 65 : Math.max(15, 45 - b.strokes * 8);
            scores[i] += parBonus;
            vfx.hitstop(isAce ? 3 : 2);
            vfx.confetti(hole.x, hole.y, isAce ? 72 : 34);
            vfx.ring(hole.x, hole.y, isAce ? '#facc15' : active[i].color, isAce ? 115 : 78, 4.5);
            if (isAce) {
              vfx.ring(hole.x, hole.y, '#ffffff', 72, 3);
              vfx.flash('#facc15', 0.25);
              vfx.popup(hole.x, hole.y - 26, 'HOLE IN ONE!!', '#facc15', 20);
              vfx.shake(8);
              buzz(i, 170, 0.9);
            } else {
              vfx.shake(4);
              buzz(i, 110, 0.6);
            }
            holesPlayed++;
            banner = isAce
              ? `${active[i].name} HOLE-IN-ONE! +${parBonus}`
              : `${active[i].name} SUNK IT! +${parBonus}`;
            bannerSub =
              holesPlayed >= HOLES_PER_MATCH
                ? 'FINAL HOLE COMPLETE · TALLYING SCORECARDS...'
                : `HOLE ${holesPlayed}/${HOLES_PER_MATCH} · LOADING NEXT CYBER HOLE...`;
            freeze = 90;
            sound.win();
            break;
          }
        }
      }

      drawArcadeBackdrop(ctx, '#2ee59d');

      // Course Header Badge
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = '#2ee59d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(GAME_WIDTH / 2 - 86, 70, 172, 26, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#a7f3d0';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        `HOLE ${Math.min(HOLES_PER_MATCH, holesPlayed + 1)}/${HOLES_PER_MATCH} · PAR ${courses[courseIdx].par}`,
        GAME_WIDTH / 2,
        87,
      );

      // Zones (Sand & Boost Strips)
      for (const z of zones) {
        ctx.save();
        if (z.kind === 'sand') {
          ctx.fillStyle = 'rgba(250, 204, 21, 0.18)';
          ctx.strokeStyle = '#eab308';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.roundRect(z.x, z.y, z.w, z.h, 12);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fde047';
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('SAND', z.x + z.w / 2, z.y + z.h / 2 + 4);
        } else {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
          ctx.strokeStyle = '#38bdf8';
          ctx.beginPath();
          ctx.roundRect(z.x, z.y, z.w, z.h, 10);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#7dd3fc';
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('BOOST >>', z.x + z.w / 2, z.y + z.h / 2 + 4);
        }
        ctx.restore();
      }

      // Bumpers
      for (const bmp of bumpers) {
        ctx.save();
        ctx.fillStyle = bmp.pulse > 0 ? '#fde047' : '#1e293b';
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(bmp.x, bmp.y, bmp.r + (bmp.pulse > 0 ? 4 : 0), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Green Cup
      ctx.save();
      ctx.fillStyle = '#064e3b';
      ctx.strokeStyle = '#2ee59d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.fillRect(hole.x - 1, hole.y - 34, 2, 34);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(hole.x + 1, hole.y - 34, 14, 10);
      ctx.restore();

      // Golf Balls + Glowing Dotted Trajectory Preview + Power Meter
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || balls[i].sunk) continue;
        const b = balls[i];
        if (Math.hypot(b.vx, b.vy) <= 0.3) {
          ctx.save();
          const totalLen = 54 + b.power * 1.15;
          const dotCount = Math.max(5, Math.floor(totalLen / 13));
          let px = b.x;
          let py = b.y;
          let dx = Math.cos(b.aimAngle) * 13;
          let dy = Math.sin(b.aimAngle) * 13;
          const shift = (frame * 0.45) % 13;
          px += Math.cos(b.aimAngle) * shift;
          py += Math.sin(b.aimAngle) * shift;
          for (let dIdx = 0; dIdx < dotCount; dIdx++) {
            px += dx;
            py += dy;
            if (px < 46 || px > GAME_WIDTH - 46) {
              dx *= -1;
              px = Math.max(46, Math.min(GAME_WIDTH - 46, px));
            }
            if (py < 80 || py > GAME_HEIGHT - 44) {
              dy *= -1;
              py = Math.max(80, Math.min(GAME_HEIGHT - 44, py));
            }
            const t = 1 - dIdx / dotCount;
            ctx.globalAlpha = 0.25 + t * 0.7;
            ctx.fillStyle = b.power > 75 && dIdx % 2 === 0 ? '#fde047' : active[i].color;
            ctx.beginPath();
            ctx.arc(px, py, 1.8 + t * 2.1, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          if (b.charging) {
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(b.x - 18, b.y + 16, 36, 5);
            ctx.fillStyle = b.power > 75 ? '#ef4444' : '#2ee59d';
            ctx.fillRect(b.x - 18, b.y + 16, (36 * b.power) / 100, 5);
          }
        }
        drawPlayerOrb(ctx, b.x, b.y, 11, active[i].color, i, {
          leader: maxScore > 0 && scores[i] === maxScore,
          label: `${b.strokes}`,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#2ee59d');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: maxScore > 0 && scores[i] === maxScore,
          valueText: maxWins > 0 ? `${scores[i]}pt S${balls[i].strokes} W${wins[i]}` : `${scores[i]}pt · S${balls[i].strokes}`,
        })),
        'AIM: STICK / WASD · HOLD & RELEASE A / SPACE TO PUTT!',
      );
    },
  };
}

// 44. TOWER SIEGE (Turret Overdrive, Repair Wrenches, 3 Enemy Waves & Boss Hitstop)
export function createTowerSiegeEngine(): MiniGameEngine {
  const CX = GAME_WIDTH / 2;
  const CY = 292;
  const MAX_CORE_HP = 12;
  const scores = [0, 0, 0, 0];
  const wins = [0, 0, 0, 0];

  let coreHp = MAX_CORE_HP;
  let kills = 0;
  let banner = '';
  let bannerSub = '';
  let freeze = 30;
  let coreHitFlash = 0;
  let announcedWave = 1;

  interface Enemy {
    x: number;
    y: number;
    vx: number;
    vy: number;
    hp: number;
    maxHp: number;
    kind: 'swarmer' | 'splitter' | 'heavy';
    r: number;
  }

  interface Wrench {
    x: number;
    y: number;
    life: number;
  }

  const spawnDefender = (i: number) => ({
    x: CX + Math.cos((i * Math.PI) / 2) * 85,
    y: CY + Math.sin((i * Math.PI) / 2) * 85,
    angle: (i * Math.PI) / 2,
    cd: 0,
    overdrive: 0,
    overdriveCd: 0,
    prevB: false,
  });
  const defenders = [0, 1, 2, 3].map(spawnDefender);

  let enemies: Enemy[] = [];
  let shots: Array<{ x: number; y: number; vx: number; vy: number; owner: number; overdrive: boolean }> = [];
  let wrenches: Wrench[] = [];

  const spawnEnemy = (kind: Enemy['kind'], x?: number, y?: number) => {
    const ang = Math.random() * Math.PI * 2;
    const ex = x ?? CX + Math.cos(ang) * 430;
    const ey = y ?? CY + Math.sin(ang) * 210;
    const d = Math.hypot(CX - ex, CY - ey) || 1;
    // Drones get faster each wave so even a perfect squad is eventually overrun
    const waveNow = 1 + Math.floor(kills / 14);
    const spdMul = 1 + Math.min(1.2, (waveNow - 1) * 0.07);
    const spd = (kind === 'swarmer' ? 1.85 : kind === 'splitter' ? 1.3 : 0.95) * spdMul;
    enemies.push({
      x: ex,
      y: ey,
      vx: ((CX - ex) / d) * spd,
      vy: ((CY - ey) / d) * spd,
      hp: kind === 'heavy' ? 5 : kind === 'splitter' ? 2 : 1,
      maxHp: kind === 'heavy' ? 5 : kind === 'splitter' ? 2 : 1,
      kind,
      r: kind === 'heavy' ? 20 : kind === 'splitter' ? 14 : 10,
    });
  };

  const resetRun = () => {
    for (let i = 0; i < 4; i++) {
      scores[i] = 0;
      Object.assign(defenders[i], spawnDefender(i));
    }
    coreHp = MAX_CORE_HP;
    kills = 0;
    enemies = [];
    shots = [];
    wrenches = [];
    banner = '';
    bannerSub = '';
    freeze = 30;
    announcedWave = 1;
  };

  const killPts = (e: Enemy) => (e.kind === 'heavy' ? 60 : e.kind === 'splitter' ? 25 : 15);

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
      if (coreHitFlash > 0) coreHitFlash--;

      // Destroy an enemy (shared by blaster + overdrive lightning so kills are counted once)
      const destroyEnemy = (ei: number, killer: number) => {
        const e = enemies[ei];
        kills++;
        scores[killer] += killPts(e);
        vfx.burst(e.x, e.y, e.kind === 'heavy' ? '#c084fc' : active[killer].color, e.kind === 'heavy' ? 24 : 14, 6);
        if (e.kind === 'heavy') {
          vfx.hitstop(3);
          vfx.ring(e.x, e.y, '#facc15', 84, 4);
          vfx.ring(e.x, e.y, '#c084fc', 54, 2.5);
          vfx.confetti(e.x, e.y, 22);
          vfx.popup(e.x, e.y - 16, 'SHIELD SHATTER +60!', '#facc15', 16);
          vfx.shake(7.5);
          sound.explosion();
          buzz(killer, 165, 0.9);
        } else if (e.kind === 'splitter') {
          vfx.ring(e.x, e.y, '#fb923c', 34, 2);
          sound.pickup(120);
          buzz(killer, 40, 0.3);
        } else {
          sound.pickup(80);
        }
        enemies.splice(ei, 1);
        if (e.kind === 'splitter') {
          spawnEnemy('swarmer', e.x - 14, e.y - 10);
          spawnEnemy('swarmer', e.x + 14, e.y + 10);
        }
      };

      vfx.beginCamera(ctx);

      const playing = freeze === 0;
      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetRun();
      }

      const wave = 1 + Math.floor(kills / 14);
      if (playing && frame % Math.max(10, Math.round(34 - wave * 2.5)) === 0) {
        // Later waves arrive in growing packs
        const pack = 1 + Math.floor((wave - 1) / 6);
        for (let k = 0; k < pack && enemies.length < 40; k++) {
          const roll = Math.random();
          if (wave >= 3 && roll < Math.min(0.3, 0.12 + wave * 0.02)) spawnEnemy('heavy');
          else if (wave >= 2 && roll < 0.45) spawnEnemy('splitter');
          else spawnEnemy('swarmer');
        }
      }
      if (playing && wave > announcedWave) {
        announcedWave = wave;
        const surge = wave > 1 && (wave - 1) % 6 === 0;
        vfx.popup(CX, CY - 62, surge ? `WAVE ${wave} · SWARM SURGE!` : `WAVE ${wave}`, surge ? '#fb7185' : '#fde047', surge ? 18 : 15);
        vfx.ring(CX, CY, surge ? '#fb7185' : '#fde047', 120, 3);
        sound.sweep(220, 660, 0.25, 'triangle', 0.07);
      }

      if (playing && frame % 240 === 0 && wrenches.length < 2 && coreHp < MAX_CORE_HP) {
        const ang = Math.random() * Math.PI * 2;
        wrenches.push({
          x: CX + Math.cos(ang) * 145,
          y: CY + Math.sin(ang) * 115,
          life: 480,
        });
      }
      for (let wi = wrenches.length - 1; wi >= 0; wi--) {
        if (--wrenches[wi].life <= 0) wrenches.splice(wi, 1);
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !playing) continue;
        const d = defenders[i];
        let ix = 0;
        let iy = 0;
        let fire = false;
        let odBtn = false;
        let botAim: number | null = null;

        if (active[i].isHuman) {
          const inp = readPlayerInput(i, pads, keys);
          ix = inp.x;
          iy = inp.y;
          fire = inp.actionA;
          odBtn = inp.actionB;
        } else {
          // Bot: hold a guard post in its own quadrant around the core (instead of
          // wandering off to the arena edge), grab wrenches when the core is hurting,
          // and shoot the enemy that is closest to breaching the core.
          let gx = CX + Math.cos((i * Math.PI) / 2 + 0.6 * Math.sin(frame * 0.01 + i)) * 105;
          let gy = CY + Math.sin((i * Math.PI) / 2 + 0.6 * Math.sin(frame * 0.01 + i)) * 95;
          if (wrenches.length > 0 && coreHp <= 8) {
            gx = wrenches[0].x;
            gy = wrenches[0].y;
          }
          const gd = Math.hypot(gx - d.x, gy - d.y);
          if (gd > 8) {
            ix = ((gx - d.x) / gd) * 0.72;
            iy = ((gy - d.y) / gd) * 0.72;
          }
          let threat: Enemy | null = null;
          let threatScore = Infinity;
          for (const e of enemies) {
            const sc = Math.hypot(e.x - CX, e.y - CY) * 0.7 + Math.hypot(e.x - d.x, e.y - d.y) * 0.5;
            if (sc < threatScore) {
              threatScore = sc;
              threat = e;
            }
          }
          if (threat) {
            const td = Math.hypot(threat.x - d.x, threat.y - d.y);
            const lead = td / 9.6;
            botAim = Math.atan2(threat.y + threat.vy * lead - d.y, threat.x + threat.vx * lead - d.x) + (Math.random() - 0.5) * 0.3;
            if (d.cd === 0 && td < 380 && Math.random() < 0.3) fire = true;
            if (d.overdriveCd === 0 && enemies.length >= 8 && Math.random() < 0.05) odBtn = true;
          }
        }

        const trigB = odBtn && !d.prevB;
        d.prevB = odBtn;

        if (Math.hypot(ix, iy) > 0.15) d.angle = Math.atan2(iy, ix);
        if (botAim !== null) d.angle = botAim;
        d.x = Math.max(54, Math.min(GAME_WIDTH - 54, d.x + ix * 4.5));
        d.y = Math.max(88, Math.min(GAME_HEIGHT - 50, d.y + iy * 4.5));

        if (d.cd > 0) d.cd--;
        if (d.overdriveCd > 0) d.overdriveCd--;
        if (d.overdrive > 0) {
          d.overdrive--;
          if (frame % 3 === 0) {
            vfx.afterimage(d.x, d.y, 15, '#38bdf8', 8);
          }
        }

        if (trigB && d.overdriveCd === 0) {
          d.overdrive = 150;
          d.overdriveCd = 300;
          vfx.ring(d.x, d.y, '#38bdf8', 70, 3);
          vfx.popup(d.x, d.y - 16, 'OVERDRIVE!', '#38bdf8');
          vfx.flash('#38bdf8', 0.1);
          sound.combo(5);
          sound.sweep(300, 1200, 0.25, 'sawtooth', 0.06);
          buzz(i, 90, 0.6);
        }

        // Repair wrenches
        for (let wi = wrenches.length - 1; wi >= 0; wi--) {
          if (Math.hypot(d.x - wrenches[wi].x, d.y - wrenches[wi].y) < 26) {
            coreHp = Math.min(MAX_CORE_HP, coreHp + 3);
            scores[i] += 25;
            vfx.ring(CX, CY, '#2ee59d', 68, 3);
            vfx.popup(CX, CY - 36, 'CORE +3 HP!', '#2ee59d');
            sound.pickup(180);
            buzz(i, 60, 0.4);
            wrenches.splice(wi, 1);
          }
        }

        // Overdrive auto-lightning turret arcs
        if (d.overdrive > 0 && frame % 12 === 0 && enemies.length > 0) {
          let closestIdx = -1;
          let closestDist = 175;
          enemies.forEach((e, ei) => {
            const dist = Math.hypot(e.x - d.x, e.y - d.y);
            if (dist < closestDist) {
              closestDist = dist;
              closestIdx = ei;
            }
          });
          if (closestIdx >= 0) {
            const e = enemies[closestIdx];
            vfx.bolt(d.x, d.y, e.x, e.y, '#38bdf8');
            vfx.afterimage((d.x + e.x) / 2, (d.y + e.y) / 2, 7, '#38bdf8', 7);
            e.hp--;
            // Remove immediately: previously a lightning-killed enemy lingered until the
            // end of the frame and a blaster shot could "kill" it again (double score).
            if (e.hp <= 0) destroyEnemy(closestIdx, i);
            sound.beep(880, 0.03, 'sawtooth', 0.06);
          }
        }

        if (fire && d.cd === 0) {
          const isOD = d.overdrive > 0;
          shots.push({
            x: d.x + Math.cos(d.angle) * 18,
            y: d.y + Math.sin(d.angle) * 18,
            vx: Math.cos(d.angle) * (isOD ? 11.2 : 9.6),
            vy: Math.sin(d.angle) * (isOD ? 11.2 : 9.6),
            owner: i,
            overdrive: isOD,
          });
          d.cd = isOD ? 6 : 11;
          sound.beep(isOD ? 840 : 720, 0.03);
        }
      }

      let write = 0;
      for (let si = 0; si < shots.length; si++) {
        const s = shots[si];
        s.x += s.vx;
        s.y += s.vy;
        if (s.overdrive) {
          vfx.afterimage(s.x, s.y, 5.2, '#38bdf8', 7);
        }
        let keep = s.x > 30 && s.x < GAME_WIDTH - 30 && s.y > 68 && s.y < GAME_HEIGHT - 30;
        if (keep) {
          for (let ei = enemies.length - 1; ei >= 0; ei--) {
            const e = enemies[ei];
            if (Math.hypot(s.x - e.x, s.y - e.y) < e.r + 6) {
              e.hp--;
              vfx.burst(s.x, s.y, active[s.owner].color, 6, 3.5);
              if (e.hp <= 0) destroyEnemy(ei, s.owner);
              else sound.hit();
              keep = false;
              break;
            }
          }
        }
        if (keep) shots[write++] = s;
      }
      shots.length = write;

      // Enemy movement & core collisions
      if (playing) {
        for (let ei = enemies.length - 1; ei >= 0; ei--) {
          const e = enemies[ei];
          e.x += e.vx;
          e.y += e.vy;
          if (Math.hypot(e.x - CX, e.y - CY) < 34) {
            coreHp = Math.max(0, coreHp - 1);
            coreHitFlash = 12;
            vfx.ring(CX, CY, '#fb7185', 74, 3);
            vfx.burst(e.x, e.y, '#fb7185', 12, 4.5);
            vfx.flash('#ef4444', 0.1);
            vfx.shake(7);
            sound.hit();
            for (let pi = 0; pi < 4; pi++) buzz(pi, 100, 0.6);
            enemies.splice(ei, 1);
          }
        }

        if (coreHp <= 0) {
          // Core breached: the run ends, the top scorer is crowned MVP
          let mvp = -1;
          for (let i = 0; i < 4; i++) {
            if (active[i].enabled && (mvp < 0 || scores[i] > scores[mvp])) mvp = i;
          }
          if (mvp >= 0 && scores[mvp] > 0) wins[mvp]++;
          banner = 'CORE BREACHED!';
          bannerSub =
            mvp >= 0
              ? `MVP ${active[mvp].name} · ${scores[mvp]}PT · ${kills} KILLS · WAVE ${wave} · REBOOTING...`
              : 'REBOOTING CORE...';
          vfx.hitstop(6);
          vfx.burst(CX, CY, '#fb7185', 40, 9);
          vfx.burst(CX, CY, '#ffffff', 16, 6);
          vfx.ring(CX, CY, '#ef4444', 160, 6);
          vfx.flash('#ef4444', 0.35);
          vfx.shake(16);
          sound.explosion();
          for (let pi = 0; pi < 4; pi++) buzz(pi, 300, 1);
          if (mvp >= 0) {
            vfx.confetti(defenders[mvp].x, defenders[mvp].y, 34);
            sound.win();
          }
          enemies.length = 0;
          shots.length = 0;
          freeze = 150;
        }
      }

      drawArcadeBackdrop(ctx, '#38bdf8');

      // Crisp Core HP Shield Ring around the central tower
      const hpRatio = Math.max(0, coreHp / MAX_CORE_HP);
      const shieldCol = hpRatio > 0.5 ? '#38bdf8' : hpRatio > 0.25 ? '#facc15' : '#fb7185';
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(CX, CY, 39, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowColor = shieldCol;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = shieldCol;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(CX, CY, 39, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio);
      ctx.stroke();

      // Rotating hexagonal outer shield ticks
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.arc(CX, CY, 46, frame * 0.02, frame * 0.02 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Core Tower
      ctx.save();
      ctx.shadowColor = shieldCol;
      ctx.shadowBlur = 22;
      ctx.fillStyle = coreHitFlash > 0 && frame % 4 < 2 ? '#fecdd3' : '#0284c7';
      ctx.beginPath();
      ctx.arc(CX, CY, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#bae6fd';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`HP:${coreHp}`, CX, CY + 2);
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillText(`W${wave}`, CX, CY + 14);

      // Repair Wrenches
      for (const w of wrenches) {
        ctx.save();
        ctx.shadowColor = '#2ee59d';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#2ee59d';
        ctx.beginPath();
        ctx.arc(w.x, w.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#052e16';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('+', w.x, w.y + 4);
        ctx.restore();
      }

      // Enemies
      for (const e of enemies) {
        ctx.save();
        ctx.fillStyle = e.kind === 'heavy' ? '#a855f7' : e.kind === 'splitter' ? '#fb923c' : '#fb7185';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
        if (e.kind === 'heavy') {
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
        ctx.restore();
      }

      for (const s of shots) {
        ctx.fillStyle = active[s.owner].color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const d = defenders[i];
        drawPlayerOrb(ctx, d.x, d.y, 15, active[i].color, i, {
          angle: d.angle,
          leader: maxScore > 0 && scores[i] === maxScore,
          shield: d.overdrive > 0,
          cooldownPct: d.overdriveCd / 300,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#fb7185');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: maxScore > 0 && scores[i] === maxScore,
          valueText: maxWins > 0 ? `${scores[i]}pt · MVP${wins[i]}` : `${scores[i]}pt`,
        })),
        'MOVE & AIM: STICK / WASD · TURBO BLASTER: A / SPACE · TURRET OVERDRIVE: B / SHIFT',
      );
    },
  };
}

// 45. HYPER MEMORY GRID (Escalating 4->6->9 Tiles, Decoy Blink, Musical Notes & Speed Bonus)
export function createHyperMemoryGridEngine(): MiniGameEngine {
  const wins = [0, 0, 0, 0];
  const bonusPts = [0, 0, 0, 0];

  const PALETTE = [
    { color: '#38bdf8', label: 'BLUE' },
    { color: '#fb7185', label: 'ROSE' },
    { color: '#4ade80', label: 'MINT' },
    { color: '#facc15', label: 'GOLD' },
    { color: '#c084fc', label: 'PLUM' },
    { color: '#fb923c', label: 'TANG' },
    { color: '#2dd4bf', label: 'TEAL' },
    { color: '#f472b6', label: 'PINK' },
    { color: '#a3e635', label: 'LIME' },
  ];

  interface TileZone {
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    label: string;
  }

  let roundNum = 1;
  let zones: TileZone[] = [];
  let targetIdx = 0;
  let decoyIdx = 1;
  let decoyBlink = 0;
  let phaseTimer = 170;
  let phaseMax = 170;
  let dropped = false;
  let banner = '';
  let fastestAwarded = false;

  const makeWalker = (i: number) => ({
    x: 420 + i * 36,
    y: 288,
    vx: 0,
    vy: 0,
    angle: 0,
    alive: true,
    dashCd: 0,
    prevA: false,
    botFooled: false, // bot believed the decoy this round
    botReact: 0, // bot reaction delay (frames) after the real target is revealed
  });
  let walkers = [0, 1, 2, 3].map(makeWalker);
  let revealAge = 0;
  let bannerSub = '';

  const buildGrid = (count: number): TileZone[] => {
    const cols = count === 4 ? 2 : 3;
    const rows = count === 9 ? 3 : 2;
    const gridW = 680;
    const gridH = 340;
    const gap = 14;
    const w = (gridW - gap * (cols - 1)) / cols;
    const h = (gridH - gap * (rows - 1)) / rows;
    const ox = (GAME_WIDTH - gridW) / 2;
    const oy = 122;
    const out: TileZone[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const p = PALETTE[idx % PALETTE.length];
        out.push({
          x: ox + c * (w + gap),
          y: oy + r * (h + gap),
          w,
          h,
          color: p.color,
          label: p.label,
        });
      }
    }
    return out;
  };

  const nextRound = (full = false) => {
    if (full) {
      roundNum = 1;
      walkers = [0, 1, 2, 3].map(makeWalker);
    } else {
      roundNum++;
    }
    // Bots get fooled by the decoy more often (and react slower) as rounds escalate,
    // otherwise all-bot lobbies survived forever and the match never ended.
    for (const w of walkers) {
      w.botFooled = Math.random() < Math.min(0.4, 0.03 + roundNum * 0.035);
      w.botReact = 4 + Math.floor(Math.random() * (10 + roundNum * 2));
    }
    revealAge = 0;
    const tileCount = roundNum >= 4 ? 9 : roundNum >= 2 ? 6 : 4;
    zones = buildGrid(tileCount);
    targetIdx = Math.floor(Math.random() * zones.length);
    decoyIdx = (targetIdx + 1 + Math.floor(Math.random() * (zones.length - 1))) % zones.length;
    decoyBlink = 32;
    phaseMax = Math.max(84, 168 - roundNum * 9);
    phaseTimer = phaseMax;
    dropped = false;
    banner = '';
    bannerSub = '';
    fastestAwarded = false;
  };
  nextRound(true);

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });
      const maxWins = Math.max(...wins);
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (active[slot].isHuman) rumble(slot, ms, intensity);
      };

      vfx.beginCamera(ctx);

      phaseTimer--;
      if (decoyBlink <= 10) revealAge++;
      if (decoyBlink > 0) {
        decoyBlink--;
        if (decoyBlink === 30) {
          const dz = zones[decoyIdx];
          sound.combo((decoyIdx % 6) + 1);
          vfx.ring(dz.x + dz.w / 2, dz.y + dz.h / 2, dz.color, Math.min(dz.w, dz.h) * 0.65, 3);
        }
        if (decoyBlink === 18) {
          const dz = zones[decoyIdx];
          sound.combo((decoyIdx % 6) + 2);
          vfx.ring(dz.x + dz.w / 2, dz.y + dz.h / 2, dz.color, Math.min(dz.w, dz.h) * 0.72, 2.5);
        }
        if (decoyBlink === 10) {
          const tz = zones[targetIdx];
          sound.combo((targetIdx % 6) + 4);
          vfx.ring(tz.x + tz.w / 2, tz.y + tz.h / 2, tz.color, Math.min(tz.w, tz.h) * 0.85, 4);
          vfx.burst(tz.x + tz.w / 2, tz.y + tz.h / 2, tz.color, 12, 4.2);
        }
        if (decoyBlink === 1) {
          const tz = zones[targetIdx];
          sound.combo((targetIdx % 6) + 6);
          vfx.ring(tz.x + tz.w / 2, tz.y + tz.h / 2, '#ffffff', Math.min(tz.w, tz.h) * 0.6, 2.5);
        }
      }

      if (!dropped) {
        const safe = zones[targetIdx];
        if (phaseTimer === 60 || phaseTimer === 30) {
          sound.combo(phaseTimer === 30 ? 7 : 5);
          vfx.ring(safe.x + safe.w / 2, safe.y + safe.h / 2, safe.color, Math.min(safe.w, safe.h) * 0.68, 2.5);
        }
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !walkers[i].alive) continue;
          const w = walkers[i];
          let ix = 0;
          let iy = 0;
          let dashBtn = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            dashBtn = inp.actionA;
          } else {
            // Bot drifts toward the decoy while it blinks, then (after a reaction delay,
            // longer if it was fooled) sprints to the safe panel.
            const delay = w.botFooled ? w.botReact + 26 : w.botReact;
            const dest = decoyBlink > 10 || revealAge < delay ? zones[decoyIdx] : safe;
            const tx = dest.x + dest.w / 2;
            const ty = dest.y + dest.h / 2;
            const d = Math.hypot(tx - w.x, ty - w.y) || 1;
            if (d > 12) {
              ix = ((tx - w.x) / d) * 0.88;
              iy = ((ty - w.y) / d) * 0.88;
            }
            if (d > 140 && w.dashCd === 0 && dest === safe && Math.random() < 0.3) dashBtn = true;
          }

          const trigA = dashBtn && !w.prevA;
          w.prevA = dashBtn;
          if (w.dashCd > 0) w.dashCd--;

          if (Math.hypot(ix, iy) > 0.15) w.angle = Math.atan2(iy, ix);
          if (trigA && w.dashCd === 0) {
            const dAng = Math.hypot(ix, iy) > 0.1 ? Math.atan2(iy, ix) : w.angle;
            w.vx += Math.cos(dAng) * 9.2;
            w.vy += Math.sin(dAng) * 9.2;
            w.dashCd = 45;
            vfx.afterimage(w.x, w.y, 17, active[i].color, 11);
            vfx.burst(w.x, w.y, active[i].color, 8, 3.6);
            vfx.ring(w.x, w.y, active[i].color, 40, 2.5);
            sound.dash();
            buzz(i, 40, 0.35);
          }

          if (w.dashCd > 30 || (Math.hypot(w.vx, w.vy) > 4.4 && frame % 2 === 0)) {
            vfx.afterimage(w.x, w.y, 15, active[i].color, 9);
          }

          w.vx = w.vx * 0.8 + ix * 5.1 * 0.42;
          w.vy = w.vy * 0.8 + iy * 5.1 * 0.42;
          w.x = Math.max(60, Math.min(GAME_WIDTH - 60, w.x + w.vx));
          w.y = Math.max(96, Math.min(GAME_HEIGHT - 54, w.y + w.vy));

          // Speed bonus for first accurate arrival after decoy resolves
          if (
            !fastestAwarded &&
            decoyBlink === 0 &&
            w.x >= safe.x &&
            w.x <= safe.x + safe.w &&
            w.y >= safe.y &&
            w.y <= safe.y + safe.h
          ) {
            fastestAwarded = true;
            bonusPts[i] += 20;
            vfx.popup(w.x, w.y - 18, 'FAST +20!', '#facc15');
            vfx.ring(w.x, w.y, '#facc15', 38, 2.5);
            sound.combo(8);
            buzz(i, 50, 0.4);
          }
        }

        if (phaseTimer <= 0) {
          dropped = true;
          phaseTimer = 65;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || !walkers[i].alive) continue;
            const w = walkers[i];
            const inside =
              w.x >= safe.x && w.x <= safe.x + safe.w && w.y >= safe.y && w.y <= safe.y + safe.h;
            if (!inside) {
              w.alive = false;
              vfx.burst(w.x, w.y, '#ef4444', 22, 6.5);
              vfx.burst(w.x, w.y, active[i].color, 12, 4);
              vfx.ring(w.x, w.y, '#ef4444', 60, 3);
              vfx.popup(w.x, w.y - 20, 'FELL!', '#fb7185', 16);
              buzz(i, 200, 0.95);
            } else {
              bonusPts[i] += 10;
              buzz(i, 50, 0.35);
            }
          }
          vfx.ring(safe.x + safe.w / 2, safe.y + safe.h / 2, safe.color, Math.max(safe.w, safe.h) * 0.8, 4);
          vfx.flash(safe.color, 0.12);
          vfx.hitstop(3);
          vfx.shake(8);
          sound.explosion();

          const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && walkers[i].alive);
          const total = active.filter((a) => a.enabled).length;
          if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
            if (alive.length === 1) {
              const w = alive[0];
              wins[w]++;
              banner = `${active[w].name} MEMORY MASTER!`;
              bannerSub = `LAST ONE STANDING · ROUND ${roundNum} · RESETTING MEMORY GRID...`;
              vfx.confetti(walkers[w].x, walkers[w].y, 38);
              vfx.confetti(GAME_WIDTH / 2, 200, 30);
              vfx.flash('#facc15', 0.2);
              sound.win();
              buzz(w, 240, 0.85);
            } else {
              banner = total === 1 ? `SURVIVED ${roundNum - 1} ROUNDS!` : 'EVERYONE DROPPED!';
              bannerSub = 'RESETTING MEMORY GRID...';
            }
            phaseTimer = 100;
          } else {
            vfx.confetti(safe.x + safe.w / 2, safe.y + safe.h / 2, 18);
          }
        }
      } else if (phaseTimer <= 0) {
        nextRound(Boolean(banner));
      }

      const shownIdx = decoyBlink > 10 ? decoyIdx : targetIdx;
      drawArcadeBackdrop(ctx, zones[shownIdx].color);

      zones.forEach((z, idx) => {
        if (dropped && idx !== targetIdx) return;
        const isHighlighted = idx === shownIdx && frame % 12 < 6;
        ctx.save();
        if (idx === shownIdx) {
          ctx.shadowColor = z.color;
          ctx.shadowBlur = isHighlighted ? 20 : 10;
        }
        ctx.fillStyle = isHighlighted ? `${z.color}48` : `${z.color}20`;
        ctx.strokeStyle = z.color;
        ctx.lineWidth = idx === shownIdx ? 4 : 2.5;
        ctx.beginPath();
        ctx.roundRect(z.x, z.y, z.w, z.h, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = z.color;
        ctx.font = 'bold 15px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(z.label, z.x + z.w / 2, z.y + z.h / 2 + 5);
        ctx.restore();
      });

      // Glowing circular countdown progress ring on the arena floor
      if (!dropped) {
        const pct = Math.max(0, Math.min(1, phaseTimer / Math.max(1, phaseMax)));
        const urgent = phaseTimer <= 45;
        const ringCol = urgent ? (frame % 8 < 4 ? '#fb7185' : '#facc15') : zones[shownIdx].color;
        const floorCx = GAME_WIDTH / 2;
        const floorCy = 292;
        const ringR = 132 + (urgent ? Math.sin(frame * 0.45) * 4 : 0);
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(floorCx, floorCy, ringR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowColor = ringCol;
        ctx.shadowBlur = urgent ? 22 : 14;
        ctx.strokeStyle = ringCol;
        ctx.globalAlpha = urgent ? 0.85 : 0.58;
        ctx.lineWidth = urgent ? 7 : 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(floorCx, floorCy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !walkers[i].alive) continue;
        const w = walkers[i];
        drawPlayerOrb(ctx, w.x, w.y, 16, active[i].color, i, {
          angle: w.angle,
          leader: maxWins > 0 && wins[i] === maxWins,
          cooldownPct: w.dashCd / 45,
        });
      }

      if (!dropped) {
        ctx.fillStyle = zones[shownIdx].color;
        ctx.font = '800 18px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        const promptText =
          decoyBlink > 10
            ? `WATCH OUT — DECOY BLINK...`
            : `RUSH TO ${zones[targetIdx].label}! (${Math.ceil(phaseTimer / 60)}s)`;
        ctx.fillText(promptText, GAME_WIDTH / 2, 98);
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
          highlight: maxWins > 0 && wins[i] === maxWins,
          valueText: `${walkers[i].alive ? 'SAFE' : 'FELL'} · W${wins[i]} (${bonusPts[i]})`,
        })),
        'RUN TO SAFE PANEL AFTER DECOY BLINK: STICK / WASD · DASH: A / SPACE',
      );
    },
  };
}
