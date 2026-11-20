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

// 11. HOT POTATO (B Short-Range Bomb Pass + A Lunge Tag, 30f Immunity Halo, Speed Pads, Heartbeat Pulse, Hitstop & Confetti)
export function createHotPotatoEngine(): MiniGameEngine {
  const wins = [0, 0, 0, 0];
  let runners = [0, 1, 2, 3].map((i) => ({
    x: 200 + (i % 2) * 560,
    y: 170 + Math.floor(i / 2) * 210,
    angle: 0,
    alive: true,
    dashCd: 0,
    dashFrames: 0,
    speedBoost: 0,
    immunity: 0,
    prevA: false,
    prevB: false,
  }));

  const speedPads = [
    { x: GAME_WIDTH / 2, y: 155 },
    { x: GAME_WIDTH / 2, y: 420 },
    { x: 185, y: 288 },
    { x: GAME_WIDTH - 185, y: 288 },
  ];

  let bombHolder = 0;
  let thrownBomb: { x: number; y: number; vx: number; vy: number; thrower: number; life: number; returning: boolean } | null = null;
  let bombTimer = 540;
  let tagCooldown = 0;
  let banner = '';
  let freeze = 20;

  const resetRound = (activeMask: boolean[]) => {
    runners = [0, 1, 2, 3].map((i) => ({
      x: 200 + (i % 2) * 560,
      y: 170 + Math.floor(i / 2) * 210,
      angle: 0,
      alive: activeMask[i],
      dashCd: 0,
      dashFrames: 0,
      speedBoost: 0,
      immunity: 0,
      prevA: false,
      prevB: false,
    }));
    const valid = [0, 1, 2, 3].filter((i) => activeMask[i]);
    bombHolder = valid[Math.floor(Math.random() * valid.length)] ?? 0;
    thrownBomb = null;
    bombTimer = 540;
    tagCooldown = 30;
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

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetRound(active.map((a) => a.enabled));
      } else {
        // Ensure bombHolder points to an enabled alive runner (important when solo/P2+ only)
        if (!active[bombHolder]?.enabled || !runners[bombHolder]?.alive) {
          const fallback = [0, 1, 2, 3].find((idx) => active[idx].enabled && runners[idx].alive);
          if (fallback !== undefined) bombHolder = fallback;
        }
        bombTimer--;
        if (tagCooldown > 0) tagCooldown--;

        // Heartbeat ticking sound & danger pulse
        const urgent = bombTimer < 180;
        const beatInterval = bombTimer < 120 ? 10 : urgent ? 16 : bombTimer < 280 ? 22 : 34;
        if (bombTimer > 0 && bombTimer % beatInterval === 0) {
          sound.beep(urgent ? 960 : 620, 0.04, 'square', urgent ? 0.08 : 0.06);
          setTimeout(() => sound.beep(urgent ? 780 : 480, 0.04, 'square', 0.04), 65);
          if (!thrownBomb && runners[bombHolder]?.alive) {
            vfx.ring(runners[bombHolder].x, runners[bombHolder].y, urgent ? '#fb7185' : '#ef4444', urgent ? 68 : 52, urgent ? 3.2 : 2.5);
          }
        }
        if (frame % 4 === 0 && !thrownBomb && runners[bombHolder]?.alive) {
          vfx.spark(runners[bombHolder].x, runners[bombHolder].y - 18, (Math.random() - 0.5) * 3, -2.2, '#facc15', 3);
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !runners[i].alive) continue;
          const r = runners[i];
          let ix = 0, iy = 0, pressA = false, pressB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            pressA = inp.actionA;
            pressB = inp.actionB;
          } else {
            if (i === bombHolder && !thrownBomb) {
              // Chase nearest non-immune alive rival
              let target: (typeof runners)[0] | undefined;
              let bestD = Infinity;
              for (let j = 0; j < 4; j++) {
                if (j === i || !active[j].enabled || !runners[j].alive || runners[j].immunity > 0) continue;
                const d = Math.hypot(runners[j].x - r.x, runners[j].y - r.y);
                if (d < bestD) {
                  bestD = d;
                  target = runners[j];
                }
              }
              if (target) {
                const d = bestD || 1;
                ix = ((target.x - r.x) / d) * 0.92;
                iy = ((target.y - r.y) / d) * 0.92;
                if (d < 130 && tagCooldown === 0 && Math.random() < 0.05) pressB = true;
                else if (d < 110 && r.dashCd === 0 && Math.random() < 0.05) pressA = true;
              }
            } else {
              const bx = thrownBomb ? thrownBomb.x : runners[bombHolder].x;
              const by = thrownBomb ? thrownBomb.y : runners[bombHolder].y;
              const d = Math.hypot(r.x - bx, r.y - by) || 1;
              // Flee, but slide along walls instead of pinning into a corner
              let fx = (r.x - bx) / d;
              let fy = (r.y - by) / d;
              const margin = 120;
              if (r.x < 54 + margin) fx += (54 + margin - r.x) / margin;
              if (r.x > GAME_WIDTH - 54 - margin) fx -= (r.x - (GAME_WIDTH - 54 - margin)) / margin;
              if (r.y < 88 + margin) fy += (88 + margin - r.y) / margin;
              if (r.y > GAME_HEIGHT - 52 - margin) fy -= (r.y - (GAME_HEIGHT - 52 - margin)) / margin;
              // Add a tangential component (left/right of the threat per slot) to circle away
              const side = i % 2 === 0 ? 1 : -1;
              fx += (-(r.y - by) / d) * 0.45 * side;
              fy += ((r.x - bx) / d) * 0.45 * side;
              const fl = Math.hypot(fx, fy) || 1;
              const urgency = d < 220 ? 0.9 : 0.55;
              ix = (fx / fl) * urgency;
              iy = (fy / fl) * urgency;
              if (d < 90 && r.dashCd === 0 && Math.random() < 0.05) pressA = true;
            }
          }

          const dashEdge = pressA && !r.prevA;
          r.prevA = pressA;
          const throwEdge = pressB && !r.prevB;
          r.prevB = pressB;

          if (Math.hypot(ix, iy) > 0.15) {
            r.angle = Math.atan2(iy, ix);
          }

          if (r.dashCd > 0) r.dashCd--;
          if (r.dashFrames > 0) r.dashFrames--;
          if (r.speedBoost > 0) r.speedBoost--;
          if (r.immunity > 0) r.immunity--;

          if (dashEdge && r.dashCd === 0) {
            r.dashCd = 44;
            r.dashFrames = 11;
            vfx.burst(r.x, r.y, active[i].color, 8, 3.8);
            vfx.ring(r.x, r.y, active[i].color, 40, 2.2);
            sound.dash();
            rumble(i, 45, 0.45);
          }

          if (r.dashFrames > 0) {
            vfx.afterimage(r.x, r.y, 19, active[i].color, 9);
          } else if (r.speedBoost > 0 && frame % 2 === 0) {
            vfx.afterimage(r.x, r.y, 17, '#2ee59d', 8);
          }

          // B: Short-range bomb pass/throw when holding bomb
          if (throwEdge && i === bombHolder && !thrownBomb && tagCooldown === 0) {
            const ang = Math.hypot(ix, iy) > 0.15 ? Math.atan2(iy, ix) : r.angle;
            thrownBomb = {
              x: r.x + Math.cos(ang) * 24,
              y: r.y + Math.sin(ang) * 24,
              vx: Math.cos(ang) * 10.5,
              vy: Math.sin(ang) * 10.5,
              thrower: i,
              life: 18,
              returning: false,
            };
            sound.sweep(480, 860, 0.09, 'triangle', 0.09);
          }

          // Speed pads
          for (const pad of speedPads) {
            if (Math.hypot(r.x - pad.x, r.y - pad.y) < 24 && r.speedBoost < 30) {
              r.speedBoost = 45;
              vfx.ring(pad.x, pad.y, '#2ee59d', 44, 2.4);
              vfx.burst(pad.x, pad.y, '#2ee59d', 8, 4.2, 2.5);
              sound.pickup(140);
            }
          }

          const baseSpd = i === bombHolder && !thrownBomb ? 5.2 : 4.5;
          const speed = baseSpd + (r.dashFrames > 0 ? 5.2 : 0) + (r.speedBoost > 0 ? 2.1 : 0);
          r.x = Math.max(54, Math.min(GAME_WIDTH - 54, r.x + ix * speed));
          r.y = Math.max(88, Math.min(GAME_HEIGHT - 52, r.y + iy * speed));
        }

        // Thrown bomb flight
        if (thrownBomb) {
          const tb = thrownBomb;
          vfx.afterimage(tb.x, tb.y, 10, '#ef4444', 7);
          if (!tb.returning) {
            tb.x += tb.vx;
            tb.y += tb.vy;
            tb.life--;
            if (tb.life <= 0 || tb.x < 46 || tb.x > GAME_WIDTH - 46 || tb.y < 80 || tb.y > GAME_HEIGHT - 44) {
              tb.returning = true;
            }
          } else {
            const owner = runners[tb.thrower];
            const dx = owner.x - tb.x;
            const dy = owner.y - tb.y;
            const d = Math.hypot(dx, dy) || 1;
            tb.x += (dx / d) * 11;
            tb.y += (dy / d) * 11;
            if (d < 24) {
              thrownBomb = null;
            }
          }

          // Check catching a rival
          if (thrownBomb) {
            for (let j = 0; j < 4; j++) {
              if (j === tb.thrower || !active[j].enabled || !runners[j].alive || runners[j].immunity > 0) continue;
              if (Math.hypot(runners[j].x - tb.x, runners[j].y - tb.y) < 30) {
                const passer = runners[tb.thrower];
                passer.immunity = 30;
                bombHolder = j;
                tagCooldown = 30;
                thrownBomb = null;
                vfx.bolt(passer.x, passer.y, runners[j].x, runners[j].y, '#facc15');
                vfx.bolt(passer.x, passer.y, runners[j].x, runners[j].y, '#ef4444');
                vfx.ring(runners[j].x, runners[j].y, '#ef4444', 64, 3.2);
                vfx.burst(runners[j].x, runners[j].y, '#facc15', 14, 5.2);
                vfx.popup(runners[j].x, runners[j].y - 16, 'CAUGHT!', '#ef4444', 14);
                vfx.hitstop(2);
                vfx.shake(4);
                sound.hit();
                rumble(j, 110, 0.8);
                rumble(tb.thrower, 50, 0.4);
                break;
              }
            }
          }
        }

        // Melee contact tag
        if (!thrownBomb && tagCooldown === 0 && runners[bombHolder].alive) {
          for (let j = 0; j < 4; j++) {
            if (j === bombHolder || !active[j].enabled || !runners[j].alive || runners[j].immunity > 0) continue;
            if (Math.hypot(runners[j].x - runners[bombHolder].x, runners[j].y - runners[bombHolder].y) < 42) {
              const prev = runners[bombHolder];
              prev.immunity = 30;
              bombHolder = j;
              tagCooldown = 30;
              vfx.bolt(prev.x, prev.y, runners[j].x, runners[j].y, '#facc15');
              vfx.bolt(prev.x, prev.y, runners[j].x, runners[j].y, '#ef4444');
              vfx.ring(runners[j].x, runners[j].y, '#ef4444', 58, 3);
              vfx.burst(runners[j].x, runners[j].y, '#ef4444', 12, 4.8);
              vfx.popup(runners[j].x, runners[j].y - 16, 'TAGGED!', '#ef4444', 14);
              vfx.hitstop(2);
              vfx.shake(4);
              sound.hit();
              rumble(j, 100, 0.75);
              break;
            }
          }
        }

        // Blast!
        if (bombTimer <= 0) {
          thrownBomb = null;
          const victim = runners[bombHolder];
          victim.alive = false;
          vfx.hitstop(4);
          vfx.burst(victim.x, victim.y, '#ef4444', 34, 8.5);
          vfx.ring(victim.x, victim.y, '#facc15', 120, 5);
          vfx.popup(victim.x, victim.y - 20, 'KABOOM!', '#ef4444', 18);
          vfx.shake(15);
          vfx.flash('#ef4444', 0.28);
          sound.explosion();
          rumble(bombHolder, 240, 1);

          const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && runners[i].alive);
          const total = active.filter((a) => a.enabled).length;
          if (total > 1 && alive.length <= 1) {
            if (alive.length === 1) {
              const w = alive[0];
              wins[w]++;
              banner = `${active[w].name} SURVIVES!`;
              sound.win();
              vfx.ring(runners[w].x, runners[w].y, active[w].color, 130, 5);
              vfx.confetti(runners[w].x, runners[w].y, 48);
              vfx.confetti(GAME_WIDTH / 2, 150, 28);
              rumble(w, 260, 1);
            } else {
              banner = 'BOOM!';
            }
            freeze = 95;
          } else if (alive.length > 0) {
            // Re-arm on a random survivor (not always the lowest slot / P1)
            bombHolder = alive[Math.floor(Math.random() * alive.length)];
            bombTimer = 400;
            tagCooldown = 45;
            const nh = runners[bombHolder];
            vfx.popup(nh.x, nh.y - 30, 'NEW BOMB!', '#facc15', 15);
            vfx.ring(nh.x, nh.y, '#facc15', 70, 3);
            rumble(bombHolder, 120, 0.7);
          } else {
            banner = 'BOOM!';
            freeze = 75;
          }
        }
      }

      let leaderIdx = -1;
      let maxW = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && wins[i] > maxW) {
          maxW = wins[i];
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#fb7185');

      // Pulsing urgency heartbeat glow when bomb timer drops under 3 seconds
      if (bombTimer > 0 && bombTimer < 180 && freeze === 0) {
        const urgency = 1 - bombTimer / 180;
        const beat = Math.pow(Math.abs(Math.sin(frame * (0.18 + urgency * 0.22))), 2);
        const bx = thrownBomb ? thrownBomb.x : runners[bombHolder]?.x ?? GAME_WIDTH / 2;
        const by = thrownBomb ? thrownBomb.y : runners[bombHolder]?.y ?? GAME_HEIGHT / 2;
        ctx.save();
        const hbGrad = ctx.createRadialGradient(bx, by, 14, bx, by, 95 + beat * 55);
        hbGrad.addColorStop(0, `rgba(239, 68, 68, ${0.26 + beat * 0.34})`);
        hbGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = hbGrad;
        ctx.beginPath();
        ctx.arc(bx, by, 95 + beat * 55, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(251, 113, 133, ${0.18 + beat * 0.45})`;
        ctx.lineWidth = 4 + beat * 4;
        ctx.strokeRect(36, 70, GAME_WIDTH - 72, GAME_HEIGHT - 106);
        ctx.restore();
      }

      // Speed pads
      for (const pad of speedPads) {
        ctx.save();
        ctx.strokeStyle = '#2ee59d';
        ctx.fillStyle = 'rgba(46, 229, 157, 0.16)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#2ee59d';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⚡', pad.x, pad.y + 4);
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !runners[i].alive) continue;
        const r = runners[i];
        const hasBomb = i === bombHolder && !thrownBomb;

        if (hasBomb) {
          const dangerR = 28 + Math.sin(frame * (bombTimer < 180 ? 0.52 : 0.2)) * 6;
          ctx.save();
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = bombTimer < 180 ? 22 : 10;
          ctx.strokeStyle = bombTimer < 180 ? 'rgba(251, 113, 133, 0.92)' : 'rgba(239, 68, 68, 0.75)';
          ctx.lineWidth = bombTimer < 180 ? 4 : 3;
          ctx.beginPath();
          ctx.arc(r.x, r.y, dangerR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        drawPlayerOrb(ctx, r.x, r.y, 19, active[i].color, i, {
          angle: r.angle,
          leader: i === leaderIdx,
          shield: r.immunity > 0,
          flash: hasBomb && frame % 10 < 4,
          cooldownPct: r.dashCd / 44,
        });

        if (hasBomb) {
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${Math.ceil(bombTimer / 60)}s`, r.x, r.y - 26);
        }
      }

      if (thrownBomb) {
        ctx.save();
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(thrownBomb.x, thrownBomb.y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(thrownBomb.x, thrownBomb.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'ARMING NEXT PLASMA BOMB...', '#fb7185');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === bombHolder && runners[i].alive,
          valueText: `${i === bombHolder ? `${Math.ceil(bombTimer / 60)}s` : runners[i].alive ? 'SAFE' : 'OUT'} · W${wins[i]}`,
        })),
        'RUN: STICK / WASD  ·  LUNGE TAG: A / SPACE  ·  THROW BOMB: B / SHIFT',
      );
    },
  };
}

// 12. AIR HOCKEY (2v2 Faceoff Ring, A Power-Slap Boost, Power-Puck Modifiers Big/Hyper/Multi, Goal Flash, Hitstop & Confetti)
export function createAirHockeyEngine(): MiniGameEngine {
  const LEFT = 70;
  const RIGHT = GAME_WIDTH - 70;
  const TOP = 80;
  const BOTTOM = 496;
  const CY = (TOP + BOTTOM) / 2;
  const GOAL_HALF = 76;
  const TARGET_GOALS = 7;

  const mallets = [
    { x: 180, y: CY - 50, vx: 0, vy: 0, slapFrames: 0, slapCd: 0, prevA: false },
    { x: GAME_WIDTH - 180, y: CY - 50, vx: 0, vy: 0, slapFrames: 0, slapCd: 0, prevA: false },
    { x: 240, y: CY + 60, vx: 0, vy: 0, slapFrames: 0, slapCd: 0, prevA: false },
    { x: GAME_WIDTH - 240, y: CY + 60, vx: 0, vy: 0, slapFrames: 0, slapCd: 0, prevA: false },
  ];

  type Puck = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    hyper: boolean;
    lastTeam: number;
    rally: number;
    trail: Array<{ x: number; y: number }>;
  };
  let pucks: Puck[] = [];
  const teamScore = [0, 0];
  let modTimer = 380;
  let activeMod = '';
  let goalFlashL = 0;
  let goalFlashR = 0;
  let banner = '';
  let freeze = 20;

  const makePuck = (r = 13, hyper = false): Puck => ({
    x: GAME_WIDTH / 2,
    y: CY,
    vx: (Math.random() < 0.5 ? -1 : 1) * (hyper ? 6.5 : 4.8),
    vy: (Math.random() - 0.5) * 4.2,
    r,
    hyper,
    lastTeam: -1,
    rally: 0,
    trail: [],
  });

  const resetMatch = (full = false) => {
    pucks = [makePuck()];
    activeMod = '';
    modTimer = 380;
    if (full) {
      teamScore[0] = 0;
      teamScore[1] = 0;
      banner = '';
    }
    freeze = 20;
  };
  resetMatch(true);

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      if (goalFlashL > 0) goalFlashL--;
      if (goalFlashR > 0) goalFlashR--;

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetMatch(true);
      } else {
        modTimer--;
        if (modTimer <= 0) {
          modTimer = 460;
          const pick = Math.floor(Math.random() * 3);
          if (pick === 0) {
            activeMod = 'BIG PUCK!';
            pucks.forEach((p) => (p.r = 21));
            vfx.popup(GAME_WIDTH / 2, 118, 'BIG PUCK!', '#facc15', 16);
          } else if (pick === 1) {
            activeMod = 'HYPER PUCK!';
            pucks.forEach((p) => {
              p.hyper = true;
              p.vx *= 1.3;
              p.vy *= 1.3;
            });
            vfx.popup(GAME_WIDTH / 2, 118, 'HYPER PUCK!', '#ff6b2b', 16);
          } else if (pucks.length < 2) {
            activeMod = 'MULTI-PUCK!';
            pucks.push(makePuck(12, false));
            vfx.popup(GAME_WIDTH / 2, 118, 'MULTI-PUCK!', '#38bdf8', 16);
          }
          sound.combo(3);
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const m = mallets[i];
          const isLeftTeam = i === 0 || i === 2;
          const minX = isLeftTeam ? LEFT + 24 : GAME_WIDTH / 2 + 24;
          const maxX = isLeftTeam ? GAME_WIDTH / 2 - 24 : RIGHT - 24;

          let ix = 0, iy = 0, pressA = false;
          // Bots track the puck nearest their own goal
          let targetPuck: Puck | undefined;
          let bestThreat = Infinity;
          for (const pk of pucks) {
            const threat = isLeftTeam ? pk.x : GAME_WIDTH - pk.x;
            if (threat < bestThreat) {
              bestThreat = threat;
              targetPuck = pk;
            }
          }

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            pressA = inp.actionA;
          } else if (targetPuck) {
            const tp = targetPuck;
            const ownGoalX = isLeftTeam ? LEFT : RIGHT;
            const attackDir = isLeftTeam ? 1 : -1;
            const puckOnOurSide = isLeftTeam ? tp.x < GAME_WIDTH / 2 : tp.x > GAME_WIDTH / 2;
            // Two bots on a team split roles: whoever is closer to the puck attacks, the other guards the goal
            const mate = i < 2 ? i + 2 : i - 2;
            const mateActive = active[mate].enabled;
            const myD = Math.hypot(tp.x - m.x, tp.y - m.y);
            const mateD = mateActive ? Math.hypot(tp.x - mallets[mate].x, tp.y - mallets[mate].y) : Infinity;
            const attacker = !mateActive || myD < mateD || (myD === mateD && i < mate);
            let gx: number;
            let gy: number;
            if (attacker && puckOnOurSide) {
              // Get behind the puck (goal side) so we strike it toward the rival net
              const behind = isLeftTeam ? m.x < tp.x - 6 : m.x > tp.x + 6;
              if (behind) {
                gx = tp.x - attackDir * 10;
                gy = tp.y + (CY - tp.y) * 0.08;
              } else {
                gx = tp.x - attackDir * 46;
                gy = tp.y + (m.y < tp.y ? -36 : 36);
              }
            } else {
              // Guard the goal mouth, shadowing the puck's height
              gx = ownGoalX + attackDir * (attacker ? 115 : 62);
              gy = Math.max(CY - GOAL_HALF + 10, Math.min(CY + GOAL_HALF - 10, tp.y));
            }
            const dx = gx - m.x;
            const dy = gy - m.y;
            const d = Math.hypot(dx, dy) || 1;
            const ease = Math.min(1, d / 24);
            ix = (dx / d) * 0.84 * ease;
            iy = (dy / d) * 0.84 * ease;
            if (myD < 50 && m.slapCd === 0 && puckOnOurSide && Math.random() < 0.35) pressA = true;
          }

          const slapEdge = pressA && !m.prevA;
          m.prevA = pressA;
          if (m.slapFrames > 0) m.slapFrames--;
          if (m.slapCd > 0) m.slapCd--;
          if (slapEdge && m.slapCd === 0) {
            m.slapFrames = 12;
            m.slapCd = 32;
            vfx.ring(m.x, m.y, active[i].color, 44, 2.5);
            sound.dash();
          }

          const prevX = m.x;
          const prevY = m.y;
          const spd = m.slapFrames > 0 ? 9.8 : 6.9;
          m.x = Math.max(minX, Math.min(maxX, m.x + ix * spd));
          m.y = Math.max(TOP + 24, Math.min(BOTTOM - 24, m.y + iy * spd));
          m.vx = m.x - prevX;
          m.vy = m.y - prevY;
        }

        for (let pIdx = pucks.length - 1; pIdx >= 0; pIdx--) {
          const puck = pucks[pIdx];
          puck.x += puck.vx;
          puck.y += puck.vy;
          puck.vx *= 0.996;
          puck.vy *= 0.996;
          puck.trail.push({ x: puck.x, y: puck.y });
          if (puck.trail.length > (puck.hyper ? 13 : 9)) puck.trail.shift();

          const curSpd = Math.hypot(puck.vx, puck.vy);
          if (curSpd > 8.0 || puck.hyper) {
            vfx.afterimage(puck.x, puck.y, puck.r * 0.95, puck.hyper ? '#ff6b2b' : '#fde047', 9);
            if (curSpd > 10.5 && frame % 2 === 0) {
              vfx.spark(puck.x, puck.y, -puck.vx * 0.25, -puck.vy * 0.25, '#ffffff', 2.8);
            }
          }

          if (puck.y < TOP + puck.r) {
            puck.y = TOP + puck.r;
            puck.vy = Math.abs(puck.vy);
            vfx.burst(puck.x, TOP, '#2ee59d', 6, 3.2, 2.2);
            sound.hit();
          } else if (puck.y > BOTTOM - puck.r) {
            puck.y = BOTTOM - puck.r;
            puck.vy = -Math.abs(puck.vy);
            vfx.burst(puck.x, BOTTOM, '#2ee59d', 6, 3.2, 2.2);
            sound.hit();
          }

          const inGoalMouth = Math.abs(puck.y - CY) < GOAL_HALF;
          if (puck.x < LEFT + puck.r) {
            if (inGoalMouth) {
              teamScore[1]++;
              goalFlashL = 28;
              vfx.hitstop(2);
              vfx.bolt(LEFT, CY - GOAL_HALF, LEFT, CY + GOAL_HALF, '#fb7185');
              vfx.bolt(LEFT, puck.y, LEFT + 115, puck.y + (Math.random() - 0.5) * 70, '#fde047');
              vfx.burst(LEFT, puck.y, '#fb7185', 32, 8);
              vfx.ring(LEFT, puck.y, '#fb7185', 105, 4.5);
              vfx.ring(LEFT, puck.y, '#ffffff', 58, 2.5);
              vfx.flash('#fb7185', 0.2);
              vfx.confetti(LEFT + 40, puck.y, 28);
              vfx.popup(GAME_WIDTH / 2, CY - 20, 'RIGHT TEAM GOAL!', '#fb7185', 20);
              vfx.shake(10);
              sound.win();
              rumble(1, 120, 0.7);
              rumble(3, 120, 0.7);
              rumble(0, 160, 0.9);
              rumble(2, 160, 0.9);
              pucks.splice(pIdx, 1);
              if (teamScore[1] >= TARGET_GOALS && !banner) {
                banner = 'RIGHT TEAM WINS!';
                freeze = 130;
                vfx.flash('#fb7185', 0.3);
                vfx.confetti(GAME_WIDTH / 2, 180, 50);
                vfx.confetti(RIGHT - 120, CY, 30);
                rumble(1, 260, 1);
                rumble(3, 260, 1);
              } else if (pucks.length === 0 && !banner) {
                resetMatch(false);
              }
              continue;
            } else {
              puck.x = LEFT + puck.r;
              puck.vx = Math.abs(puck.vx);
              sound.hit();
            }
          } else if (puck.x > RIGHT - puck.r) {
            if (inGoalMouth) {
              teamScore[0]++;
              goalFlashR = 28;
              vfx.hitstop(2);
              vfx.bolt(RIGHT, CY - GOAL_HALF, RIGHT, CY + GOAL_HALF, '#38bdf8');
              vfx.bolt(RIGHT, puck.y, RIGHT - 115, puck.y + (Math.random() - 0.5) * 70, '#fde047');
              vfx.burst(RIGHT, puck.y, '#38bdf8', 32, 8);
              vfx.ring(RIGHT, puck.y, '#38bdf8', 105, 4.5);
              vfx.ring(RIGHT, puck.y, '#ffffff', 58, 2.5);
              vfx.flash('#38bdf8', 0.2);
              vfx.confetti(RIGHT - 40, puck.y, 28);
              vfx.popup(GAME_WIDTH / 2, CY - 20, 'LEFT TEAM GOAL!', '#38bdf8', 20);
              vfx.shake(10);
              sound.win();
              rumble(0, 120, 0.7);
              rumble(2, 120, 0.7);
              rumble(1, 160, 0.9);
              rumble(3, 160, 0.9);
              pucks.splice(pIdx, 1);
              if (teamScore[0] >= TARGET_GOALS && !banner) {
                banner = 'LEFT TEAM WINS!';
                freeze = 130;
                vfx.flash('#38bdf8', 0.3);
                vfx.confetti(GAME_WIDTH / 2, 180, 50);
                vfx.confetti(LEFT + 120, CY, 30);
                rumble(0, 260, 1);
                rumble(2, 260, 1);
              } else if (pucks.length === 0 && !banner) {
                resetMatch(false);
              }
              continue;
            } else {
              puck.x = RIGHT - puck.r;
              puck.vx = -Math.abs(puck.vx);
              sound.hit();
            }
          }

          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            const m = mallets[i];
            const dx = puck.x - m.x;
            const dy = puck.y - m.y;
            const d = Math.hypot(dx, dy);
            const minD = 21 + puck.r;
            if (d > 0 && d < minD) {
              const nx = dx / d;
              const ny = dy / d;
              puck.x = m.x + nx * (minD + 1);
              puck.y = m.y + ny * (minD + 1);
              const isSlap = m.slapFrames > 0;
              const hitForce = (isSlap ? 11.4 : 7.8) * (puck.hyper ? 1.2 : 1);
              puck.vx = nx * hitForce + m.vx * 0.9;
              puck.vy = ny * hitForce + m.vy * 0.9;

              const hitTeam = i === 0 || i === 2 ? 0 : 1;
              if (puck.lastTeam !== hitTeam) {
                puck.lastTeam = hitTeam;
                puck.rally = Math.min(14, puck.rally + 1);
              }

              vfx.burst(puck.x, puck.y, active[i].color, isSlap ? 18 : 11, 5.2);
              vfx.ring(puck.x, puck.y, isSlap ? '#ff6b2b' : active[i].color, isSlap ? 60 : 42, isSlap ? 3.5 : 2.4);
              if (isSlap) {
                vfx.hitstop(2);
                sound.noiseBurst(0.11, 1400, 0.12);
                vfx.shake(6);
              }
              if (puck.rally >= 2) {
                sound.combo(puck.rally);
                if (puck.rally >= 3) {
                  vfx.popup(puck.x, puck.y - 18, `RALLY x${puck.rally}!`, active[i].color, 13);
                }
              } else if (!isSlap) {
                sound.beep(580, 0.05);
              }
              rumble(i, 70, isSlap ? 0.85 : 0.55);
            }
          }

          // Mallet pushes can shove the puck past a rail — keep it on the table
          puck.y = Math.max(TOP + puck.r, Math.min(BOTTOM - puck.r, puck.y));
          if (Math.abs(puck.y - CY) >= GOAL_HALF) {
            puck.x = Math.max(LEFT + puck.r, Math.min(RIGHT - puck.r, puck.x));
          }

          const spd = Math.hypot(puck.vx, puck.vy);
          const cap = puck.hyper ? 15.5 : 13;
          if (spd > cap) {
            puck.vx = (puck.vx / spd) * cap;
            puck.vy = (puck.vy / spd) * cap;
          } else if (spd < 2.4) {
            // Air-table never lets the puck die (also keeps solo / short-handed games moving)
            if (spd < 0.05) {
              puck.vx = puck.x < GAME_WIDTH / 2 ? 2.4 : -2.4;
              puck.vy = 0;
            } else {
              puck.vx = (puck.vx / spd) * 2.4;
              puck.vy = (puck.vy / spd) * 2.4;
            }
          }
          // Avoid endless vertical rail-to-rail ping-pong
          if (Math.abs(puck.vx) < 1.2) puck.vx = puck.vx >= 0 ? 1.2 : -1.2;
        }
      }

      drawArcadeBackdrop(ctx, '#2ee59d');

      // Table markings & glowing center faceoff ring
      ctx.strokeStyle = 'rgba(46, 229, 157, 0.45)';
      ctx.lineWidth = 3;
      ctx.strokeRect(LEFT, TOP, RIGHT - LEFT, BOTTOM - TOP);
      ctx.beginPath();
      ctx.moveTo(GAME_WIDTH / 2, TOP);
      ctx.lineTo(GAME_WIDTH / 2, BOTTOM);
      ctx.stroke();

      ctx.save();
      ctx.strokeStyle = 'rgba(46, 229, 157, 0.55)';
      ctx.shadowColor = '#2ee59d';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(GAME_WIDTH / 2, CY, 56, 0, Math.PI * 2);
      ctx.stroke();
      // Goal creases
      ctx.beginPath();
      ctx.arc(LEFT, CY, GOAL_HALF, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(RIGHT, CY, GOAL_HALF, Math.PI / 2, -Math.PI / 2);
      ctx.stroke();
      ctx.restore();

      // Goal lines + Goal Net Flash
      ctx.save();
      ctx.strokeStyle = goalFlashL > 0 ? '#ffffff' : '#ff6b2b';
      ctx.shadowColor = '#fb7185';
      ctx.shadowBlur = goalFlashL > 0 ? 28 : 8;
      ctx.lineWidth = goalFlashL > 0 ? 10 : 6;
      ctx.beginPath();
      ctx.moveTo(LEFT, CY - GOAL_HALF);
      ctx.lineTo(LEFT, CY + GOAL_HALF);
      ctx.stroke();

      ctx.strokeStyle = goalFlashR > 0 ? '#ffffff' : '#ff6b2b';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = goalFlashR > 0 ? 28 : 8;
      ctx.lineWidth = goalFlashR > 0 ? 10 : 6;
      ctx.beginPath();
      ctx.moveTo(RIGHT, CY - GOAL_HALF);
      ctx.lineTo(RIGHT, CY + GOAL_HALF);
      ctx.stroke();
      ctx.restore();

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const m = mallets[i];
        const slap = m.slapFrames > 0;
        ctx.save();
        ctx.shadowColor = slap ? '#ff6b2b' : active[i].color;
        ctx.shadowBlur = slap ? 26 : 16;
        ctx.fillStyle = slap ? '#ffffff' : active[i].color;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 21, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }

      for (const puck of pucks) {
        const pCol = puck.hyper ? '#ff6b2b' : '#fde047';
        puck.trail.forEach((pt, idx) => {
          ctx.globalAlpha = ((idx + 1) / puck.trail.length) * (puck.hyper ? 0.45 : 0.28);
          ctx.fillStyle = pCol;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, (puck.r * 0.5) + idx * 0.5, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;

        ctx.save();
        ctx.shadowColor = pCol;
        ctx.shadowBlur = 18;
        ctx.fillStyle = pCol;
        ctx.beginPath();
        ctx.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (activeMod && frame % 90 < 70) {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.75)';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(activeMod, GAME_WIDTH / 2, TOP + 16);
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'FIRST TO 7 GOALS! NEXT MATCH...', '#2ee59d');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === 0 || i === 2 ? teamScore[0] > teamScore[1] : teamScore[1] > teamScore[0],
          valueText: i === 0 || i === 2 ? `TEAM L: ${teamScore[0]}/${TARGET_GOALS}` : `TEAM R: ${teamScore[1]}/${TARGET_GOALS}`,
        })),
        '2V2 RINK (P1+P3 VS P2+P4)  ·  GLIDE: STICK / WASD  ·  POWER SLAP: A / SPACE',
      );
    },
  };
}

// 13. SNAKE BATTLE (Hold-A Turbo Sprint Burning Tail Orbs, Mega Golden Apples +3, Rounded Segmented Bodies + Eyes, Smart AI)
export function createSnakeBattleEngine(): MiniGameEngine {
  const CELL = 16;
  const COLS = 54;
  const ROWS = 26;
  const OX = (GAME_WIDTH - COLS * CELL) / 2;
  const OY = 80;

  const wins = [0, 0, 0, 0];
  type Snake = {
    body: Array<{ x: number; y: number }>;
    dx: number;
    dy: number;
    // Direction of the last committed step — reversal checks use this so a fast
    // double-turn between steps can't fold the head back into the neck.
    mdx: number;
    mdy: number;
    alive: boolean;
    grow: number;
    sprint: boolean;
    sprintTick: number;
  };
  let snakes: Snake[] = [];
  let food = { x: 27, y: 13 };
  let megaApple: { x: number; y: number; active: boolean; timer: number } = { x: 14, y: 13, active: false, timer: 240 };
  let bonusOrbs: Array<{ x: number; y: number; color: string }> = [];
  const MAX_BONUS_ORBS = 48;
  let banner = '';
  let freeze = 20;

  const makeSnake = (hx: number, hy: number, dx: number): Snake => ({
    body: [
      { x: hx, y: hy },
      { x: hx - dx, y: hy },
      { x: hx - dx * 2, y: hy },
    ],
    dx,
    dy: 0,
    mdx: dx,
    mdy: 0,
    alive: true,
    grow: 0,
    sprint: false,
    sprintTick: 0,
  });

  // Occupancy grid (snake index or -1), rebuilt each simulated frame — O(1) collision checks
  const occ = new Int8Array(COLS * ROWS);
  const rebuildOcc = (active: Array<{ enabled: boolean }>) => {
    occ.fill(-1);
    for (let j = 0; j < 4; j++) {
      if (!active[j].enabled || !snakes[j].alive) continue;
      for (const seg of snakes[j].body) occ[seg.y * COLS + seg.x] = j;
    }
  };
  const isCellBlocked = (tx: number, ty: number) =>
    tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS || occ[ty * COLS + tx] !== -1;

  const freeCell = (margin: number) => {
    for (let tries = 0; tries < 40; tries++) {
      const x = margin + Math.floor(Math.random() * (COLS - margin * 2));
      const y = margin + Math.floor(Math.random() * (ROWS - margin * 2));
      if (occ[y * COLS + x] === -1 && !(x === food.x && y === food.y)) return { x, y };
    }
    return { x: margin + Math.floor(Math.random() * (COLS - margin * 2)), y: margin + Math.floor(Math.random() * (ROWS - margin * 2)) };
  };

  // Allocation-free bounded flood fill for the bot's space check
  const seenStamp = new Int32Array(COLS * ROWS);
  const floodQueue = new Int32Array(COLS * ROWS);
  let stamp = 0;
  const floodSpace = (sx: number, sy: number, limit: number) => {
    if (isCellBlocked(sx, sy)) return 0;
    stamp++;
    let head = 0;
    let tail = 0;
    seenStamp[sy * COLS + sx] = stamp;
    floodQueue[tail++] = sy * COLS + sx;
    let count = 1;
    while (head < tail && count < limit) {
      const key = floodQueue[head++];
      const cx = key % COLS;
      const cy = (key - cx) / COLS;
      for (let d = 0; d < 4; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (isCellBlocked(nx, ny)) continue;
        const nk = ny * COLS + nx;
        if (seenStamp[nk] === stamp) continue;
        seenStamp[nk] = stamp;
        floodQueue[tail++] = nk;
        count++;
      }
    }
    return count;
  };

  const reset = () => {
    snakes = [
      makeSnake(8, 6, 1),
      makeSnake(COLS - 9, ROWS - 7, -1),
      makeSnake(COLS - 9, 6, -1),
      makeSnake(8, ROWS - 7, 1),
    ];
    food = { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
    megaApple = { x: 14, y: 13, active: false, timer: 240 };
    bonusOrbs = [];
    banner = '';
    freeze = 20;
  };
  reset();

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
        rebuildOcc(active);

        if (!megaApple.active) {
          megaApple.timer--;
          if (megaApple.timer <= 0) {
            const c = freeCell(3);
            megaApple.x = c.x;
            megaApple.y = c.y;
            megaApple.active = true;
            vfx.ring(OX + megaApple.x * CELL + CELL / 2, OY + megaApple.y * CELL + CELL / 2, '#ff6b2b', 45, 2.5);
            sound.beep(880, 0.06, 'triangle', 0.06);
          }
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !snakes[i].alive) continue;
          const s = snakes[i];
          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            if (Math.abs(inp.x) > Math.abs(inp.y) && Math.abs(inp.x) > 0.35) {
              const ndx = inp.x > 0 ? 1 : -1;
              if (ndx !== -s.mdx) {
                s.dx = ndx;
                s.dy = 0;
              }
            } else if (Math.abs(inp.y) > Math.abs(inp.x) && Math.abs(inp.y) > 0.35) {
              const ndy = inp.y > 0 ? 1 : -1;
              if (ndy !== -s.mdy) {
                s.dx = 0;
                s.dy = ndy;
              }
            }
            s.sprint = inp.actionA && s.body.length > 3;
          } else {
            // Hazard-avoiding AI: goal-seeking weighted by reachable space (flood fill)
            const h = s.body[0];
            const target = megaApple.active ? megaApple : food;
            let bestDx = s.mdx;
            let bestDy = s.mdy;
            let bestVal = -Infinity;
            const need = Math.min(90, s.body.length + 12);
            for (let c = 0; c < 3; c++) {
              const ddx = c === 0 ? s.mdx : c === 1 ? s.mdy : -s.mdy;
              const ddy = c === 0 ? s.mdy : c === 1 ? -s.mdx : s.mdx;
              const nx = h.x + ddx;
              const ny = h.y + ddy;
              if (isCellBlocked(nx, ny)) continue;
              const space = floodSpace(nx, ny, need);
              const trapped = space < need ? (need - space) * 4 : 0;
              const step2Clear = !isCellBlocked(nx + ddx, ny + ddy) ? 15 : 0;
              const distGoal = Math.abs(target.x - nx) + Math.abs(target.y - ny);
              const val = 100 - distGoal + step2Clear - trapped + (c === 0 ? 2 : 0) + Math.random();
              if (val > bestVal) {
                bestVal = val;
                bestDx = ddx;
                bestDy = ddy;
              }
            }
            s.dx = bestDx;
            s.dy = bestDy;
            s.sprint = s.body.length > 7 && !isCellBlocked(h.x + s.dx * 2, h.y + s.dy * 2) && Math.random() < 0.12;
          }
        }

        const movedHeads = [-1, -1, -1, -1];
        // Rotate processing order each frame so no slot always moves (and eats) first
        for (let k = 0; k < 4; k++) {
          const i = (k + frame) % 4;
          if (!active[i].enabled || !snakes[i].alive) continue;
          const s = snakes[i];
          if (s.sprint && frame % 2 === 0) {
            const head = s.body[0];
            vfx.afterimage(OX + head.x * CELL + CELL / 2, OY + head.y * CELL + CELL / 2, CELL * 0.52, active[i].color, 10);
          }
          const stepRate = s.sprint ? 3 : 6;
          if (frame % stepRate !== 0) continue;

          const nx = s.body[0].x + s.dx;
          const ny = s.body[0].y + s.dy;
          const tailSeg = s.body[s.body.length - 1];
          // Our own tail slides out of the way this step unless we're growing
          const intoOwnTail = s.grow === 0 && tailSeg.x === nx && tailSeg.y === ny;

          if (isCellBlocked(nx, ny) && !intoOwnTail) {
            const key = nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS ? ny * COLS + nx : -1;
            const owner = key >= 0 ? occ[key] : -1;
            const slicer = owner >= 0 && owner !== i ? owner : -1;
            s.alive = false;
            for (const seg of s.body) {
              if (occ[seg.y * COLS + seg.x] === i) occ[seg.y * COLS + seg.x] = -1;
            }
            const px = OX + nx * CELL + CELL / 2;
            const py = OY + ny * CELL + CELL / 2;
            vfx.hitstop(2);
            vfx.burst(px, py, active[i].color, 26, 6.8);
            vfx.ring(px, py, slicer >= 0 ? active[slicer].color : active[i].color, 72, 3.4);
            // Shatter the body into sparks along its length
            for (let k = 0; k < s.body.length; k += 3) {
              const seg = s.body[k];
              vfx.spark(OX + seg.x * CELL + CELL / 2, OY + seg.y * CELL + CELL / 2, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, active[i].color, 3.5);
            }
            if (slicer >= 0 && movedHeads[slicer] === key) {
              // Head-on collision: both serpents go down
              const o = snakes[slicer];
              o.alive = false;
              for (const seg of o.body) {
                if (occ[seg.y * COLS + seg.x] === slicer) occ[seg.y * COLS + seg.x] = -1;
              }
              vfx.burst(px, py, active[slicer].color, 22, 6.5);
              vfx.popup(px, py - 16, 'HEAD-ON!', '#facc15', 15);
              rumble(slicer, 150, 0.85);
            } else if (slicer >= 0) {
              vfx.popup(px, py - 16, `SLICED BY ${active[slicer].name}!`, active[slicer].color, 14);
              rumble(slicer, 90, 0.65);
            }
            vfx.shake(8);
            sound.explosion();
            rumble(i, 150, 0.85);
          } else {
            s.body.unshift({ x: nx, y: ny });
            s.mdx = s.dx;
            s.mdy = s.dy;
            movedHeads[i] = ny * COLS + nx;

            if (nx === food.x && ny === food.y) {
              s.grow += 2;
              const fx = OX + food.x * CELL + CELL / 2;
              const fy = OY + food.y * CELL + CELL / 2;
              vfx.burst(fx, fy, '#fde047', 12, 4.5);
              vfx.popup(fx, fy - 12, '+2 LEN', '#fde047', 13);
              sound.pickup(i * 55);
              rumble(i, 40, 0.35);
              food = freeCell(2);
            }

            if (megaApple.active && nx === megaApple.x && ny === megaApple.y) {
              s.grow += 3;
              megaApple.active = false;
              megaApple.timer = 260;
              const mx = OX + nx * CELL + CELL / 2;
              const my = OY + ny * CELL + CELL / 2;
              vfx.burst(mx, my, '#ff6b2b', 20, 6);
              vfx.ring(mx, my, '#facc15', 60, 3);
              vfx.popup(mx, my - 14, '+3 MEGA APPLE!', '#ff6b2b', 15);
              vfx.shake(3);
              sound.combo(4);
              rumble(i, 70, 0.55);
            }

            for (let oIdx = 0; oIdx < bonusOrbs.length; oIdx++) {
              const o = bonusOrbs[oIdx];
              if (o.x === nx && o.y === ny) {
                s.grow += 1;
                bonusOrbs.splice(oIdx, 1);
                sound.pickup(200);
                break;
              }
            }

            if (s.grow > 0) {
              s.grow--;
            } else {
              const tail = s.body.pop();
              if (tail && occ[tail.y * COLS + tail.x] === i) occ[tail.y * COLS + tail.x] = -1;
              if (s.sprint && s.body.length > 3) {
                s.sprintTick++;
                if (s.sprintTick % 4 === 0 && tail) {
                  const burnt = s.body.pop();
                  if (burnt && occ[burnt.y * COLS + burnt.x] === i) occ[burnt.y * COLS + burnt.x] = -1;
                  if (bonusOrbs.length >= MAX_BONUS_ORBS) bonusOrbs.shift();
                  bonusOrbs.push({ x: tail.x, y: tail.y, color: active[i].color });
                  vfx.spark(OX + tail.x * CELL + CELL / 2, OY + tail.y * CELL + CELL / 2, 0, 0, active[i].color, 3);
                }
              }
            }
            occ[ny * COLS + nx] = i;
          }
        }

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && snakes[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          if (alive.length === 1) {
            const w = alive[0];
            wins[w]++;
            banner = `${active[w].name} APEX VIPER!`;
            sound.win();
            vfx.flash(active[w].color, 0.22);
            const hx = OX + snakes[w].body[0].x * CELL + CELL / 2;
            const hy = OY + snakes[w].body[0].y * CELL + CELL / 2;
            vfx.ring(hx, hy, active[w].color, 130, 5);
            vfx.confetti(hx, hy, 40);
            vfx.confetti(GAME_WIDTH / 2, 150, 28);
            rumble(w, 260, 1);
          } else {
            banner = 'CRASH!';
          }
          freeze = 85;
        }
      }

      let leaderIdx = -1;
      let maxLen = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && snakes[i].alive && snakes[i].body.length > maxLen) {
          maxLen = snakes[i].body.length;
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#4ade80');
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
      ctx.strokeRect(OX, OY, COLS * CELL, ROWS * CELL);

      // Normal Apple
      ctx.save();
      ctx.shadowColor = '#facc15';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(OX + food.x * CELL + CELL / 2, OY + food.y * CELL + CELL / 2, CELL * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Mega Golden Apple
      if (megaApple.active) {
        ctx.save();
        ctx.shadowColor = '#ff6b2b';
        ctx.shadowBlur = 22;
        ctx.fillStyle = '#ff6b2b';
        ctx.beginPath();
        ctx.arc(
          OX + megaApple.x * CELL + CELL / 2,
          OY + megaApple.y * CELL + CELL / 2,
          CELL * 0.56 + Math.sin(frame * 0.2) * 1.5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // Bonus Orbs
      for (const orb of bonusOrbs) {
        ctx.fillStyle = orb.color;
        ctx.beginPath();
        ctx.arc(OX + orb.x * CELL + CELL / 2, OY + orb.y * CELL + CELL / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Smooth rounded segmented snakes with crisp glowing eyes & forked tongue flicker
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !snakes[i].alive) continue;
        const s = snakes[i];
        for (let idx = s.body.length - 1; idx >= 0; idx--) {
          const seg = s.body[idx];
          const cx = OX + seg.x * CELL + CELL / 2;
          const cy = OY + seg.y * CELL + CELL / 2;
          const rad = idx === 0 ? CELL * 0.48 : CELL * 0.42;
          if (idx === 0) {
            // Only the head gets a (single) shadowBlur glow
            ctx.save();
            ctx.shadowColor = active[i].color;
            ctx.shadowBlur = s.sprint ? 22 : 14;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(cx, cy, rad, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          } else {
            ctx.fillStyle = active[i].color;
            ctx.beginPath();
            ctx.arc(cx, cy, rad, 0, Math.PI * 2);
            ctx.fill();
          }

          if (idx === 0) {
            // Animated forked tongue flicker
            const flicker = (frame + i * 11) % 34;
            if (flicker < 11 || s.sprint) {
              const tLen = s.sprint ? 9.5 : 7.5;
              const baseX = cx + s.dx * (rad - 1);
              const baseY = cy + s.dy * (rad - 1);
              const tipX = baseX + s.dx * tLen;
              const tipY = baseY + s.dy * tLen;
              const px = -s.dy * 3;
              const py = s.dx * 3;
              ctx.save();
              ctx.strokeStyle = '#fb7185';
              ctx.shadowColor = '#fb7185';
              ctx.shadowBlur = 8;
              ctx.lineWidth = 1.8;
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(baseX, baseY);
              ctx.lineTo(tipX, tipY);
              ctx.lineTo(tipX + s.dx * 2.5 + px, tipY + s.dy * 2.5 + py);
              ctx.moveTo(tipX, tipY);
              ctx.lineTo(tipX + s.dx * 2.5 - px, tipY + s.dy * 2.5 - py);
              ctx.stroke();
              ctx.restore();
            }

            // Crisp glowing eyes
            const ex1 = cx + s.dx * 3 - s.dy * 3.6;
            const ey1 = cy + s.dy * 3 + s.dx * 3.6;
            const ex2 = cx + s.dx * 3 + s.dy * 3.6;
            const ey2 = cy + s.dy * 3 - s.dx * 3.6;
            ctx.save();
            ctx.shadowColor = '#facc15';
            ctx.shadowBlur = 6;
            ctx.fillStyle = s.sprint ? '#fde047' : '#ffffff';
            ctx.beginPath();
            ctx.arc(ex1, ey1, 2.7, 0, Math.PI * 2);
            ctx.arc(ex2, ey2, 2.7, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#0b0d12';
            ctx.beginPath();
            ctx.arc(ex1 + s.dx * 0.9, ey1 + s.dy * 0.9, 1.4, 0, Math.PI * 2);
            ctx.arc(ex2 + s.dx * 0.9, ey2 + s.dy * 0.9, 1.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'SPAWNING NEW SERPENTS...', '#4ade80');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderIdx,
          valueText: `LEN ${snakes[i].body.length} · W${wins[i]}`,
        })),
        'STEER: D-PAD / STICK / WASD  ·  HOLD A / SPACE: TURBO SPRINT (BURNS TAIL ORBS)',
      );
    },
  };
}

// 14. QUICK DRAW (Cyber-Western Sunset + Tumbleweeds, Multi-Beat Fakeouts, ms Readout, Cowboy Hats & Laser Beams, Hitstop & Confetti)
export function createQuickDrawEngine(): MiniGameEngine {
  type Phase = 'ready' | 'wait' | 'draw' | 'result';
  let phase: Phase = 'ready';
  let timer = 50;
  let fakeFlash = 0;
  let fakeLabel = 'WAIT...';
  const wins = [0, 0, 0, 0];
  const locked = [false, false, false, false];
  const reactionMs = [0, 0, 0, 0];
  const prevPressed = [false, false, false, false];
  // Reaction time is measured in simulation frames (pause/hitch-safe), not wall-clock
  let drawFrames = 0;
  // Per-round bot reaction targets so CPU outlaws are beatable but not predictable
  const botReactMs = [0, 0, 0, 0];
  let winnerIdx = -1;
  let winnerText = '';

  const tumbleweeds = [
    { x: 100, y: 430, r: 16, rot: 0, spd: 1.6 },
    { x: 640, y: 455, r: 12, rot: 1, spd: 2.1 },
  ];

  const startRound = () => {
    phase = 'wait';
    timer = 95 + Math.floor(Math.random() * 140);
    fakeFlash = 0;
    locked.fill(false);
    reactionMs.fill(0);
    for (let i = 0; i < 4; i++) botReactMs[i] = 245 + Math.random() * 240;
    drawFrames = 0;
    winnerIdx = -1;
    winnerText = '';
  };

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      for (const tw of tumbleweeds) {
        tw.x += tw.spd;
        tw.rot += 0.08;
        if (tw.x > GAME_WIDTH - 40) tw.x = 40;
      }

      const pressEdges = [0, 1, 2, 3].map((i) => {
        if (!active[i].enabled || !active[i].isHuman) return false;
        const inp = readPlayerInput(i, pads, keys);
        const down = inp.actionA || inp.actionB;
        const edge = down && !prevPressed[i];
        prevPressed[i] = down;
        return edge;
      });

      timer--;
      if (phase === 'ready' && timer <= 0) {
        startRound();
      } else if (phase === 'wait') {
        if ((timer === 65 || timer === 34) && Math.random() < 0.45) {
          fakeFlash = 16;
          fakeLabel = Math.random() < 0.5 ? 'HOLD IT...!' : 'FAKE BEEP!';
          sound.beep(310, 0.05, 'square', 0.08);
          // CPU outlaws occasionally get spooked by fakeouts too
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || active[i].isHuman || locked[i]) continue;
            if (Math.random() < 0.1) {
              locked[i] = true;
              const cx = 150 + i * 220;
              vfx.burst(cx, 320, '#fb7185', 14, 5);
              vfx.popup(cx, 240, 'FLINCHED!', '#fb7185', 15);
              sound.hit();
            }
          }
        }
        if (fakeFlash > 0) fakeFlash--;

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || locked[i] || !active[i].isHuman) continue;
          if (pressEdges[i]) {
            locked[i] = true;
            const cx = 150 + i * 220;
            vfx.burst(cx, 320, '#fb7185', 14, 5);
            vfx.popup(cx, 240, 'FLINCHED!', '#fb7185', 15);
            sound.hit();
            rumble(i, 120, 0.7);
          }
        }

        let anyStanding = false;
        let anyEnabled = false;
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          anyEnabled = true;
          if (!locked[i]) anyStanding = true;
        }
        if (anyEnabled && !anyStanding) {
          // Everybody flinched — no point waiting out the timer
          winnerText = 'EVERYONE FLINCHED!';
          phase = 'result';
          timer = 90;
          sound.sweep(400, 120, 0.3, 'sawtooth', 0.09);
          vfx.shake(4);
        } else if (timer <= 0) {
          phase = 'draw';
          drawFrames = 0;
          timer = 150;
          vfx.flash('#2ee59d', 0.24);
          sound.beep(1040, 0.14, 'square');
        }
      } else if (phase === 'draw') {
        drawFrames++;
        const elapsed = Math.round((drawFrames * 1000) / 60);
        // Collect everyone who fired this frame, then break same-frame ties at random
        let shooter = -1;
        let shooters = 0;
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || locked[i]) continue;
          const fired = active[i].isHuman ? pressEdges[i] : elapsed >= botReactMs[i];
          if (fired) {
            shooters++;
            if (Math.random() < 1 / shooters) shooter = i;
          }
        }
        if (shooter >= 0) {
          const i = shooter;
          reactionMs[i] = elapsed;
          wins[i]++;
          winnerIdx = i;
          winnerText = `${active[i].name} WINS (${elapsed}ms)!`;
          phase = 'result';
          timer = 110;
          const cx = 150 + i * 220;
          vfx.hitstop(3);
          vfx.bolt(cx, 325, cx, 78, '#2ee59d');
          vfx.bolt(cx, 325, cx, 78, '#facc15');
          vfx.burst(cx, 310, active[i].color, 30, 7.8);
          vfx.burst(cx, 82, '#2ee59d', 18, 6);
          vfx.ring(cx, 310, '#facc15', 96, 4);
          vfx.flash(active[i].color, 0.24);
          vfx.confetti(cx, 250, 42);
          vfx.shake(9.5);
          sound.win();
          rumble(i, 150, 0.95);
        }
        if (timer <= 0 && phase === 'draw') {
          winnerText = 'NO ONE DREW!';
          phase = 'result';
          timer = 80;
        }
      } else if (phase === 'result' && timer <= 0) {
        startRound();
      }

      let leaderIdx = -1;
      let maxW = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && wins[i] > maxW) {
          maxW = wins[i];
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#facc15');

      // Cyber-Western Sunset Gradient inside arena
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(30, 66, GAME_WIDTH - 60, GAME_HEIGHT - 96, 14);
      ctx.clip();

      const sky = ctx.createLinearGradient(0, 66, 0, GAME_HEIGHT - 30);
      sky.addColorStop(0, '#1e1b4b');
      sky.addColorStop(0.55, '#7c2d12');
      sky.addColorStop(1, '#111827');
      ctx.fillStyle = sky;
      ctx.fillRect(30, 66, GAME_WIDTH - 60, GAME_HEIGHT - 96);

      // Synthwave Sun
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(GAME_WIDTH / 2, 260, 74, 0, Math.PI * 2);
      ctx.fill();

      // Ground mesa silhouette
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(30, 365, GAME_WIDTH - 60, 140);

      // Drifting tumbleweeds & wind dust
      for (const tw of tumbleweeds) {
        ctx.save();
        ctx.translate(tw.x, tw.y);
        ctx.rotate(tw.rot);
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, tw.r, 0, Math.PI * 2);
        ctx.moveTo(-tw.r, 0);
        ctx.lineTo(tw.r, 0);
        ctx.moveTo(0, -tw.r);
        ctx.lineTo(0, tw.r);
        ctx.stroke();
        ctx.restore();
      }

      // Dramatic tension spotlight dimming before DRAW!
      if (phase === 'wait') {
        const tension = Math.min(1, Math.max(0.25, 1 - timer / 180));
        ctx.fillStyle = `rgba(4, 6, 14, ${0.28 + tension * 0.44})`;
        ctx.fillRect(30, 66, GAME_WIDTH - 60, GAME_HEIGHT - 96);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || locked[i]) continue;
          const cx = 150 + i * 220;
          const coneGrad = ctx.createLinearGradient(cx, 66, cx, 395);
          coneGrad.addColorStop(0, 'rgba(250, 204, 21, 0.04)');
          coneGrad.addColorStop(0.75, `${active[i].color}26`);
          coneGrad.addColorStop(1, 'rgba(250, 204, 21, 0)');
          ctx.fillStyle = coneGrad;
          ctx.beginPath();
          ctx.moveTo(cx - 22, 66);
          ctx.lineTo(cx + 22, 66);
          ctx.lineTo(cx + 68 - tension * 18, 410);
          ctx.lineTo(cx - 68 + tension * 18, 410);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();

      // Outlaws
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const cx = 150 + i * 220;
        const cy = 335;

        // Winner glowing laser tracer beam
        if (phase === 'result' && winnerIdx === i) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = active[i].color;
          ctx.shadowColor = '#2ee59d';
          ctx.shadowBlur = 26;
          ctx.lineWidth = 11;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 10);
          ctx.lineTo(cx, 76);
          ctx.stroke();

          ctx.strokeStyle = '#ffffff';
          ctx.shadowBlur = 12;
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 10);
          ctx.lineTo(cx, 76);
          ctx.stroke();

          // Muzzle flare star
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(cx, cy - 16, 10 + (timer % 4), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        drawPlayerOrb(ctx, cx, cy, 28, locked[i] ? '#475569' : active[i].color, i, {
          leader: i === leaderIdx,
          flash: winnerIdx === i && frame % 8 < 4,
          label: `P${i + 1}`,
        });

        // Outlaw Cowboy Hat
        ctx.save();
        ctx.fillStyle = locked[i] ? '#334155' : '#1e293b';
        ctx.strokeStyle = active[i].color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 26, 32, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.roundRect(cx - 16, cy - 42, 32, 18, 5);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = locked[i] ? '#fb7185' : '#f3f2ed';
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          locked[i] ? 'FLINCH!' : reactionMs[i] ? `${reactionMs[i]}ms` : 'READY',
          cx,
          cy + 48,
        );
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (phase === 'wait') {
        drawRoundBanner(
          ctx,
          fakeFlash > 0 ? fakeLabel : 'STEADY...',
          'WAIT FOR THE GREEN SIGNAL — DO NOT FLINCH!',
          fakeFlash > 0 ? '#fb7185' : '#94a3b8',
        );
      } else if (phase === 'draw') {
        drawRoundBanner(ctx, 'DRAW!!', 'SLAM A / B / SPACE NOW!', '#2ee59d');
      } else if (phase === 'result') {
        drawRoundBanner(ctx, winnerText, 'NEXT STANDOFF STARTING...', '#facc15');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderIdx,
          valueText: `WINS: ${wins[i]}`,
        })),
        'WAIT FOR GREEN SIGNAL, THEN SLAM A / B / SPACE!',
      );
    },
  };
}

// 15. BRICK SMASH (4-Paddle Breakout, TNT Chain Explosions, Multi-Ball, Wide & Magnet Drops, 3-HP Cracked Bricks, Combo Pitch, Stage Winners)
export function createBrickSmashEngine(): MiniGameEngine {
  const scores = [0, 0, 0, 0];
  const streaks = [0, 0, 0, 0];
  const wins = [0, 0, 0, 0];
  const BALL_R = 8;
  const paddles = [
    { x: 180, w: 116, wideTimer: 0, magTimer: 0 },
    { x: 390, w: 116, wideTimer: 0, magTimer: 0 },
    { x: 570, w: 116, wideTimer: 0, magTimer: 0 },
    { x: 780, w: 116, wideTimer: 0, magTimer: 0 },
  ];

  type Brick = { x: number; y: number; w: number; h: number; hp: number; maxHp: number; color: string; kind: 'normal' | 'tnt' | 'multiball' };
  const bricks: Brick[] = [];

  const spawnBricks = () => {
    bricks.length = 0;
    const colors = ['#ff6b2b', '#facc15', '#2ee59d', '#38bdf8'];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 11; c++) {
        const isTnt = (r === 1 && (c === 2 || c === 8)) || (r === 2 && c === 5);
        const isMulti = r === 2 && (c === 1 || c === 9);
        const maxHp = r === 0 ? 3 : 1;
        bricks.push({
          x: 78 + c * 74,
          y: 86 + r * 30,
          w: 66,
          h: 20,
          hp: maxHp,
          maxHp,
          color: isTnt ? '#ef4444' : isMulti ? '#38bdf8' : colors[r],
          kind: isTnt ? 'tnt' : isMulti ? 'multiball' : 'normal',
        });
      }
    }
  };
  spawnBricks();

  // owner -1 = neutral ball: scores for nobody until a paddle claims it
  type Ball = { x: number; y: number; vx: number; vy: number; owner: number };
  const makeStartBalls = (): Ball[] => [
    { x: GAME_WIDTH / 2 - 80, y: 340, vx: 3.6, vy: -4.4, owner: -1 },
    { x: GAME_WIDTH / 2 + 80, y: 340, vx: -3.4, vy: -4.6, owner: -1 },
  ];
  let balls: Ball[] = makeStartBalls();
  let drops: Array<{ x: number; y: number; vy: number; kind: 'wide' | 'magnet' }> = [];
  let freeze = 30;
  let banner = '';
  let bannerSub = '';

  const resetStage = () => {
    spawnBricks();
    balls = makeStartBalls();
    drops = [];
    for (let i = 0; i < 4; i++) {
      scores[i] = 0;
      streaks[i] = 0;
      paddles[i].wideTimer = 0;
      paddles[i].magTimer = 0;
    }
    banner = '';
    bannerSub = '';
    freeze = 30;
  };

  const ballColor = (owner: number, active: Array<{ color: string }>) => (owner >= 0 ? active[owner].color : '#e2e8f0');

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      // Paddles stay live during freezes so players can line up the serve
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const p = paddles[i];
        if (freeze === 0) {
          if (p.wideTimer > 0) p.wideTimer--;
          if (p.magTimer > 0) p.magTimer--;
        }
        p.w = p.wideTimer > 0 ? 174 : 116;

        let mx = 0;
        let boost = false;
        if (active[i].isHuman) {
          const inp = readPlayerInput(i, pads, keys);
          mx = inp.x;
          boost = inp.actionA;
        } else {
          // Each bot guards a home zone: prefer falling balls near our lane, otherwise drift home.
          // (Without zones every bot converged on the same ball and slot order decided every hit.)
          const homeX = 180 + i * 200;
          let bestBall: Ball | undefined;
          let bestD = Infinity;
          for (const b of balls) {
            if (b.vy <= 0) continue;
            const d = Math.abs(b.x - homeX) * 0.8 + Math.abs(b.x - p.x) * 0.3 + (474 - b.y) * 0.6;
            if (d < bestD) {
              bestD = d;
              bestBall = b;
            }
          }
          if (!bestBall) {
            mx = Math.max(-1, Math.min(1, (homeX - p.x) / 60)) * 0.6;
          } else {
            // Lead the ball slightly to where it will cross the paddle line
            const t = bestBall.vy > 0 ? Math.min(40, (474 - bestBall.y) / bestBall.vy) : 0;
            const aimX = bestBall.x + bestBall.vx * t * 0.5;
            const diff = aimX - p.x;
            mx = Math.max(-1, Math.min(1, diff / 34)) * 0.88;
            boost = Math.abs(diff) > 120 && bestBall.vy > 0;
          }
        }
        p.x = Math.max(85, Math.min(GAME_WIDTH - 85, p.x + mx * (boost ? 9.8 : 6.8)));
      }

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetStage();
      } else {
        // Drops
        let keepD = 0;
        for (let dIdx = 0; dIdx < drops.length; dIdx++) {
          const d = drops[dIdx];
          d.y += d.vy;
          let caught = false;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            const p = paddles[i];
            if (p.magTimer > 0 && Math.abs(d.x - p.x) < 160 && d.y > 260) {
              d.x += Math.sign(p.x - d.x) * 2.4;
            }
            if (d.y >= 462 && d.y <= 490 && Math.abs(d.x - p.x) <= p.w / 2 + 12) {
              if (d.kind === 'wide') {
                p.wideTimer = 420;
                vfx.popup(p.x, 450, 'WIDE PADDLE!', '#2ee59d', 14);
              } else {
                p.magTimer = 420;
                vfx.popup(p.x, 450, 'MAGNET!', '#c084fc', 14);
              }
              vfx.ring(p.x, 474, '#2ee59d', 52, 2.5);
              sound.pickup(220);
              rumble(i, 60, 0.45);
              caught = true;
              break;
            }
          }
          if (!caught && d.y < GAME_HEIGHT - 30) drops[keepD++] = d;
        }
        drops.length = keepD;

        const destroyBrick = (br: Brick, owner: number) => {
          const idx = bricks.indexOf(br);
          if (idx < 0) return;
          bricks.splice(idx, 1);
          const cx = br.x + br.w / 2;
          const cy = br.y + br.h / 2;
          vfx.burst(cx, cy, br.color, 14, 5.2);
          if (owner >= 0) {
            streaks[owner]++;
            const comboBonus = streaks[owner] >= 3 ? Math.min(20, (streaks[owner] - 2) * 5) : 0;
            const pts = (br.kind === 'tnt' ? 20 : br.maxHp > 1 ? 25 : 10) + comboBonus;
            scores[owner] += pts;
            vfx.popup(
              cx,
              br.y,
              streaks[owner] >= 3 ? `+${pts} x${streaks[owner]}` : `+${pts}`,
              active[owner].color,
              streaks[owner] >= 3 ? 14 : 12,
            );
            sound.combo(Math.min(16, streaks[owner]));
          } else {
            sound.beep(620, 0.05, 'triangle', 0.07);
          }

          if (br.kind === 'multiball' && balls.length < 6) {
            balls.push({
              x: cx,
              y: cy,
              vx: (Math.random() < 0.5 ? -1 : 1) * 4.2,
              vy: 4.6,
              owner,
            });
            vfx.ring(cx, cy, '#38bdf8', 58, 3);
            vfx.popup(cx, br.y - 16, 'MULTI-BALL!', '#38bdf8', 15);
          } else if (br.kind === 'tnt') {
            vfx.hitstop(2);
            vfx.ring(cx, cy, '#ef4444', 118, 4.5);
            vfx.ring(cx, cy, '#facc15', 68, 2.5);
            vfx.burst(cx, cy, '#facc15', 24, 7.5);
            vfx.shake(9);
            sound.explosion();
            if (owner >= 0) rumble(owner, 120, 0.85);
            // Chain explosion: snapshot neighbours first, then detonate (safe even if a
            // neighbour is itself TNT and recursively removes more bricks)
            const neighbours: Brick[] = [];
            for (const nb of bricks) {
              if (Math.hypot(nb.x + nb.w / 2 - cx, nb.y + nb.h / 2 - cy) < 96) neighbours.push(nb);
            }
            for (const nb of neighbours) {
              vfx.bolt(cx, cy, nb.x + nb.w / 2, nb.y + nb.h / 2, '#facc15');
              destroyBrick(nb, owner);
            }
          } else if (Math.random() < 0.16) {
            drops.push({
              x: cx,
              y: cy,
              vy: 2.2,
              kind: Math.random() < 0.55 ? 'wide' : 'magnet',
            });
          }
        };

        for (const b of balls) {
          // Gentle magnet curve toward owning paddle if magnet active
          if (b.owner >= 0 && active[b.owner].enabled && paddles[b.owner].magTimer > 0 && b.vy > 0 && b.y > 260) {
            b.vx += Math.sign(paddles[b.owner].x - b.x) * 0.12;
          }

          const preX = b.x;
          const preY = b.y;
          b.x += b.vx;
          b.y += b.vy;
          const ballSpd = Math.hypot(b.vx, b.vy);
          if (ballSpd > 5.4 && frame % 2 === 0) {
            vfx.afterimage(b.x, b.y, 7.5, ballColor(b.owner, active), 8);
          }
          if (b.x < 40 || b.x > GAME_WIDTH - 40) {
            b.vx = b.x < 40 ? Math.abs(b.vx) : -Math.abs(b.vx);
            b.x = Math.max(40, Math.min(GAME_WIDTH - 40, b.x));
          }
          if (b.y < 72) {
            b.y = 72;
            b.vy = Math.abs(b.vy);
          }
          if (b.y > GAME_HEIGHT - 24) {
            // Missed: the ball drops its owner and re-serves as a neutral ball
            if (b.owner >= 0) {
              streaks[b.owner] = 0;
              vfx.popup(b.x, GAME_HEIGHT - 52, 'MISS!', '#fb7185', 13);
              rumble(b.owner, 90, 0.5);
            }
            vfx.ring(b.x, GAME_HEIGHT - 30, '#fb7185', 40, 2.5);
            sound.sweep(380, 140, 0.16, 'triangle', 0.08);
            b.owner = -1;
            b.x = Math.max(120, Math.min(GAME_WIDTH - 120, b.x));
            b.y = 320;
            b.vy = -4.4;
            vfx.ring(b.x, b.y, '#e2e8f0', 36, 2);
          }

          if (b.vy > 0 && b.y >= 466 && b.y <= 488) {
            // Overlapping paddles: the one most centred under the ball wins (not the lowest slot)
            let hitter = -1;
            let bestOff = Infinity;
            for (let i = 0; i < 4; i++) {
              if (!active[i].enabled) continue;
              const off = Math.abs(b.x - paddles[i].x);
              if (off <= paddles[i].w / 2 + 8 && off < bestOff) {
                bestOff = off;
                hitter = i;
              }
            }
            if (hitter >= 0) {
              const i = hitter;
              b.vy = -Math.min(7.2, Math.abs(b.vy) * 1.04);
              b.vx = Math.max(-7.4, Math.min(7.4, (b.x - paddles[i].x) * 0.105));
              // Never let a dead-centre hit go perfectly vertical forever
              if (Math.abs(b.vx) < 0.8) b.vx = b.vx >= 0 ? 0.8 : -0.8;
              const claimed = b.owner !== i;
              b.owner = i;
              streaks[i] = 0;
              vfx.burst(b.x, 474, active[i].color, 8, 3.8);
              vfx.ring(b.x, 474, active[i].color, claimed ? 48 : 34, 2);
              sound.beep(520 + i * 50, 0.05);
              rumble(i, 50, 0.45);
            }
          }

          for (let idx = bricks.length - 1; idx >= 0; idx--) {
            const br = bricks[idx];
            const left = br.x - BALL_R;
            const right = br.x + br.w + BALL_R;
            const top = br.y - BALL_R;
            const bottom = br.y + br.h + BALL_R;
            if (b.x >= left && b.x <= right && b.y >= top && b.y <= bottom) {
              // Resolve on the axis we entered from so side hits don't drill through armour
              const wasInX = preX >= left && preX <= right;
              const wasInY = preY >= top && preY <= bottom;
              if (wasInX && !wasInY) {
                b.vy = -b.vy;
                b.y = b.vy > 0 ? bottom + 0.5 : top - 0.5;
              } else if (wasInY && !wasInX) {
                b.vx = -b.vx;
                b.x = b.vx > 0 ? right + 0.5 : left - 0.5;
              } else {
                b.vx = -b.vx;
                b.vy = -b.vy;
                b.x = preX;
                b.y = preY;
              }
              br.hp--;
              if (br.hp <= 0) {
                destroyBrick(br, b.owner);
              } else {
                if (b.owner >= 0) scores[b.owner] += 5;
                vfx.burst(br.x + br.w / 2, br.y + br.h / 2, '#ffffff', 8, 3.8);
                vfx.ring(br.x + br.w / 2, br.y + br.h / 2, '#ffffff', 28, 2);
                vfx.shake(2);
                sound.hit();
              }
              break;
            }
          }
        }

        if (bricks.length === 0 && !banner) {
          let w = -1;
          let tied = false;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            if (w < 0 || scores[i] > scores[w]) {
              w = i;
              tied = false;
            } else if (scores[i] === scores[w]) {
              tied = true;
            }
          }
          freeze = 150;
          vfx.flash('#38bdf8', 0.24);
          vfx.confetti(GAME_WIDTH / 2, 200, 48);
          if (w < 0 || tied) {
            banner = 'STAGE CLEAR — TIE!';
            bannerSub = 'DEAD-EVEN SCORES · REBUILDING WALL...';
            sound.win();
          } else {
            wins[w]++;
            banner = `${active[w].name} WINS THE STAGE!`;
            bannerSub = `${scores[w]} PTS · REBUILDING WALL...`;
            sound.win();
            vfx.shake(6);
            vfx.ring(paddles[w].x, 474, active[w].color, 140, 5);
            vfx.confetti(paddles[w].x, 440, 30);
            rumble(w, 260, 1);
          }
        }
      }

      let leaderIdx = -1;
      let maxPts = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && scores[i] > maxPts) {
          maxPts = scores[i];
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#38bdf8');

      for (const br of bricks) {
        ctx.save();
        ctx.fillStyle = br.color;
        ctx.beginPath();
        ctx.roundRect(br.x, br.y, br.w, br.h, 5);
        ctx.fill();

        if (br.maxHp > 1) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
          // Crisp corner armor rivets
          ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
          ctx.fillRect(br.x + 4, br.y + 4, 2.5, 2.5);
          ctx.fillRect(br.x + br.w - 6.5, br.y + 4, 2.5, 2.5);
          ctx.fillRect(br.x + 4, br.y + br.h - 6.5, 2.5, 2.5);
          ctx.fillRect(br.x + br.w - 6.5, br.y + br.h - 6.5, 2.5, 2.5);

          // Crisp layered crack lines on damaged armored bricks
          if (br.hp < br.maxHp) {
            const drawCrack = (offsetX: number, stroke: string, lw: number) => {
              ctx.strokeStyle = stroke;
              ctx.lineWidth = lw;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.beginPath();
              ctx.moveTo(br.x + 15 + offsetX, br.y + 2);
              ctx.lineTo(br.x + 23 + offsetX, br.y + 9);
              ctx.lineTo(br.x + 18 + offsetX, br.y + 13);
              ctx.lineTo(br.x + 25 + offsetX, br.y + 18);
              ctx.moveTo(br.x + 23 + offsetX, br.y + 9);
              ctx.lineTo(br.x + 31 + offsetX, br.y + 11);
              if (br.hp === 1) {
                ctx.moveTo(br.x + 49 + offsetX, br.y + 2);
                ctx.lineTo(br.x + 41 + offsetX, br.y + 9);
                ctx.lineTo(br.x + 47 + offsetX, br.y + 14);
                ctx.lineTo(br.x + 39 + offsetX, br.y + 18);
                ctx.moveTo(br.x + 41 + offsetX, br.y + 9);
                ctx.lineTo(br.x + 33 + offsetX, br.y + 12);
              }
              ctx.stroke();
            };
            drawCrack(1, 'rgba(255, 255, 255, 0.65)', 2.4);
            drawCrack(0, '#090b10', 2);
          }
        }

        if (br.kind === 'tnt' || br.kind === 'multiball') {
          ctx.fillStyle = '#0b0d12';
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(br.kind === 'tnt' ? 'TNT' : '+BALL', br.x + br.w / 2, br.y + 14);
        }
        ctx.restore();
      }

      for (const d of drops) {
        ctx.save();
        ctx.fillStyle = d.kind === 'wide' ? '#2ee59d' : '#c084fc';
        ctx.beginPath();
        ctx.roundRect(d.x - 16, d.y - 8, 32, 16, 6);
        ctx.fill();
        ctx.fillStyle = '#0b0d12';
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(d.kind === 'wide' ? 'WIDE' : 'MAG', d.x, d.y + 3);
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const p = paddles[i];
        ctx.save();
        ctx.shadowColor = active[i].color;
        ctx.shadowBlur = p.magTimer > 0 ? 22 : 14;
        ctx.fillStyle = active[i].color;
        ctx.beginPath();
        ctx.roundRect(p.x - p.w / 2, 474, p.w, 12, 6);
        ctx.fill();
        if (p.magTimer > 0) {
          ctx.strokeStyle = '#c084fc';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
      }

      for (const b of balls) {
        const bc = ballColor(b.owner, active);
        ctx.save();
        ctx.shadowColor = bc;
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
        ctx.fill();
        if (b.owner >= 0) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = bc;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#38bdf8');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderIdx,
          valueText: `${scores[i]}pt · W${wins[i]}`,
        })),
        'SLIDE: LEFT/RIGHT  ·  SPRINT: A / SPACE  ·  CLAIM BALLS WITH YOUR PADDLE · TOP SCORE WINS THE STAGE',
      );
    },
  };
}
