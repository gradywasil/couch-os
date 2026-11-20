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

// 16. DODGEBALL BLITZ (Timed Catch & Counter-Throw, Charged Fireballs, Center Plasma Divider!)
export function createDodgeballEngine(): MiniGameEngine {
  const wins = [0, 0, 0, 0];
  const scores = [0, 0, 0, 0];

  const makePlayers = () =>
    [0, 1, 2, 3].map((i) => ({
      x: i % 2 === 0 ? 155 : GAME_WIDTH - 155,
      y: i < 2 ? 175 : 405,
      vx: 0,
      vy: 0,
      dirX: i % 2 === 0 ? 1 : -1,
      dirY: 0,
      alive: true,
      holding: -1,
      dashCd: 0,
      catchWindow: 0,
      catchCd: 0,
      charge: 0,
      prevA: false,
      prevB: false,
      flash: 0,
      // Bot reaction memory: which incoming ball it has judged, and whether it will try to catch it
      aiThreat: -1,
      aiCatch: false,
    }));

  const makeBalls = () =>
    [0, 1, 2, 3].map((idx) => ({
      x: GAME_WIDTH / 2 + (idx % 2 === 0 ? -24 : 24),
      y: 130 + idx * 85,
      vx: (idx % 2 === 0 ? -1 : 1) * 1.4,
      vy: (Math.random() - 0.5) * 1.2,
      owner: -1,
      hot: false,
      fireball: false,
      energized: false,
      carrier: -1,
      trailTimer: 0,
    }));

  let playersState = makePlayers();
  let balls = makeBalls();
  let banner = '';
  let freeze = 20;
  let dividerWarn = 0;

  const reset = () => {
    playersState = makePlayers();
    balls = makeBalls();
    banner = '';
    freeze = 20;
    dividerWarn = 0;
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
        dividerWarn = Math.max(0, dividerWarn - 0.05);

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !playersState[i].alive) continue;
          const p = playersState[i];
          let ix = 0;
          let iy = 0;
          let btnA = false;
          let btnB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            btnA = inp.actionA;
            btnB = inp.actionB;
          } else {
            // Smart AI: check incoming hot ball first to catch or dodge!
            const threat = balls.find(
              (b) =>
                b.hot &&
                b.owner !== i &&
                Math.hypot(b.x - p.x, b.y - p.y) < 135 &&
                (p.x - b.x) * b.vx + (p.y - b.y) * b.vy > 0,
            );
            if (!threat) p.aiThreat = -1;
            if (threat) {
              // Roll once per incoming throw whether this bot goes for the catch or just sidesteps,
              // so bots are beatable instead of parrying every single throw.
              const tIdx = balls.indexOf(threat);
              if (p.aiThreat !== tIdx) {
                p.aiThreat = tIdx;
                p.aiCatch = Math.random() < (threat.fireball ? 0.35 : 0.5);
              }
              const distThreat = Math.hypot(threat.x - p.x, threat.y - p.y);
              if (p.aiCatch && distThreat < 65 && p.catchCd === 0 && p.holding === -1) {
                btnB = true;
              } else {
                // Dodge perpendicular to ball velocity (pick the side we're already on)
                const bMag = Math.hypot(threat.vx, threat.vy) || 1;
                const side = (p.x - threat.x) * -threat.vy + (p.y - threat.y) * threat.vx >= 0 ? 1 : -1;
                ix = (-threat.vy / bMag) * side;
                iy = (threat.vx / bMag) * side;
                if (p.aiCatch && p.dashCd === 0 && distThreat < 95) btnB = true;
              }
            } else if (p.holding >= 0) {
              // Aim at nearest live opponent
              let target = null as (typeof playersState)[number] | null;
              let bestD = Infinity;
              for (let j = 0; j < 4; j++) {
                if (j === i || !active[j].enabled || !playersState[j].alive) continue;
                const d = Math.hypot(playersState[j].x - p.x, playersState[j].y - p.y);
                if (d < bestD) {
                  bestD = d;
                  target = playersState[j];
                }
              }
              if (target) {
                const dx = target.x - p.x;
                const dy = target.y - p.y;
                const d = Math.hypot(dx, dy) || 1;
                ix = (dx / d) * 0.65;
                iy = (dy / d) * 0.65;
                p.dirX = dx / d;
                p.dirY = dy / d;
                if (p.charge < 34 && d < 460) {
                  btnA = true;
                } else if (p.charge >= 34 || d < 220) {
                  btnA = false; // release fireball!
                }
              }
            } else {
              // Seek nearest loose non-hot ball
              let bestB = balls[0];
              let bestScore = Infinity;
              for (const b of balls) {
                if (b.carrier >= 0 || b.hot) continue;
                const d = Math.hypot(b.x - p.x, b.y - p.y);
                if (d < bestScore) {
                  bestScore = d;
                  bestB = b;
                }
              }
              if (bestB && !bestB.hot && bestB.carrier === -1) {
                const dx = bestB.x - p.x;
                const dy = bestB.y - p.y;
                const d = Math.hypot(dx, dy) || 1;
                ix = (dx / d) * 0.9;
                iy = (dy / d) * 0.9;
              }
            }
          }

          if (Math.hypot(ix, iy) > 0.15) {
            const m = Math.hypot(ix, iy);
            p.dirX = ix / m;
            p.dirY = iy / m;
          }

          if (p.dashCd > 0) p.dashCd--;
          if (p.catchWindow > 0) p.catchWindow--;
          if (p.catchCd > 0) p.catchCd--;
          if (p.flash > 0) p.flash--;

          const tapB = btnB && !p.prevB;
          if (tapB) {
            if (p.holding === -1 && p.catchCd === 0) {
              // Activate timed Catch & Parry window + minor dodge step
              p.catchWindow = 16;
              p.catchCd = 34;
              vfx.ring(p.x, p.y, '#38bdf8', 42, 2.5);
              sound.beep(640, 0.04, 'sine', 0.07);
            }
            if (p.dashCd === 0 && Math.hypot(ix, iy) > 0.1) {
              p.vx += ix * 9.5;
              p.vy += iy * 9.5;
              p.dashCd = 42;
              vfx.ring(p.x, p.y, active[i].color, 44, 2);
              vfx.afterimage(p.x, p.y, 19, active[i].color, 10);
              sound.dash();
            }
          }

          // Smooth movement with dash decay
          const speedBase = p.charge > 0 ? 2.6 : 4.4;
          p.vx = p.vx * 0.82 + ix * speedBase * 0.25;
          p.vy = p.vy * 0.82 + iy * speedBase * 0.25;
          p.x = Math.max(48, Math.min(GAME_WIDTH - 48, p.x + p.vx + ix * speedBase * 0.68));
          p.y = Math.max(82, Math.min(GAME_HEIGHT - 46, p.y + p.vy + iy * speedBase * 0.68));

          if (Math.hypot(p.vx, p.vy) > 4.8 && frame % 2 === 0) {
            vfx.afterimage(p.x, p.y, 18, active[i].color, 8);
          }

          // Center divider proximity warning glow
          if (Math.abs(p.x - GAME_WIDTH / 2) < 34) {
            dividerWarn = Math.max(dividerWarn, 1);
            if (frame % 12 === 0) {
              vfx.spark(GAME_WIDTH / 2, p.y, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, '#facc15', 2.5);
            }
          }

          // Charge & Release A to throw
          if (p.holding >= 0) {
            if (btnA) {
              p.charge = Math.min(40, p.charge + 1);
              if (p.charge === 30) {
                sound.pickup(240);
                vfx.ring(p.x, p.y, '#ff6b2b', 36, 2.5);
              }
            } else if (p.prevA || p.charge > 0) {
              const isFireball = p.charge >= 26;
              const b = balls[p.holding];
              b.carrier = -1;
              b.owner = i;
              b.hot = true;
              b.fireball = isFireball;
              b.energized = isFireball;
              const spd = isFireball ? 15.5 : 11.2;
              b.x = p.x + p.dirX * 26;
              b.y = p.y + p.dirY * 26;
              b.vx = p.dirX * spd;
              b.vy = p.dirY * spd;
              p.holding = -1;
              p.charge = 0;
              vfx.burst(b.x, b.y, isFireball ? '#ff6b2b' : active[i].color, isFireball ? 18 : 10, isFireball ? 6 : 4.5);
              if (isFireball) {
                vfx.ring(b.x, b.y, '#fde047', 48, 3);
                vfx.popup(p.x, p.y - 24, 'FIREBALL!', '#ff6b2b', 13);
                sound.noiseBurst(0.14, 1100, 0.14);
                vfx.shake(4);
              } else {
                sound.dash();
              }
              rumble(i, isFireball ? 90 : 40, isFireball ? 0.7 : 0.35);
            }
          } else {
            p.charge = 0;
          }

          p.prevA = btnA;
          p.prevB = btnB;
        }

        for (let bi = 0; bi < balls.length; bi++) {
          const b = balls[bi];
          if (b.carrier >= 0) {
            const c = playersState[b.carrier];
            b.x = c.x + c.dirX * 20;
            b.y = c.y + c.dirY * 20;
            continue;
          }

          const prevX = b.x;
          b.x += b.vx;
          b.y += b.vy;
          const drag = b.fireball ? 0.996 : 0.992;
          b.vx *= drag;
          b.vy *= drag;

          // Passing through center divider energizes hot throws!
          if (
            b.hot &&
            ((prevX < GAME_WIDTH / 2 && b.x >= GAME_WIDTH / 2) ||
              (prevX > GAME_WIDTH / 2 && b.x <= GAME_WIDTH / 2))
          ) {
            if (!b.energized) {
              b.energized = true;
              b.vx *= 1.12;
              b.vy *= 1.12;
              dividerWarn = 1;
              vfx.bolt(GAME_WIDTH / 2, b.y - 22, GAME_WIDTH / 2, b.y + 22, '#facc15');
              sound.beep(780, 0.05, 'triangle', 0.08);
            }
          }

          if (b.hot && frame % 2 === 0) {
            vfx.afterimage(b.x, b.y, b.fireball ? 13 : 10, b.fireball ? '#ff6b2b' : '#facc15', 7);
            if (b.fireball) {
              vfx.spark(b.x, b.y, -b.vx * 0.15 + (Math.random() - 0.5) * 2, -b.vy * 0.15 + (Math.random() - 0.5) * 2, '#fb923c', 3.5);
            }
          }

          if (Math.hypot(b.vx, b.vy) < 3.6) {
            b.hot = false;
            b.fireball = false;
            b.energized = false;
            b.owner = -1;
          }

          if (b.x < 42 || b.x > GAME_WIDTH - 42) {
            b.vx *= -0.85;
            b.x = Math.max(42, Math.min(GAME_WIDTH - 42, b.x));
            b.hot = false;
            b.fireball = false;
          }
          if (b.y < 76 || b.y > GAME_HEIGHT - 42) {
            b.vy *= -0.85;
            b.y = Math.max(76, Math.min(GAME_HEIGHT - 42, b.y));
            b.hot = false;
            b.fireball = false;
          }

          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || !playersState[i].alive) continue;
            const p = playersState[i];
            const hitR = p.catchWindow > 0 ? 40 : 28;
            if (Math.hypot(b.x - p.x, b.y - p.y) < hitR) {
              if (b.hot && b.owner !== i) {
                if (p.catchWindow > 0) {
                  // TIMED CATCH & INSTANT COUNTER-THROW!
                  const prevOwner = b.owner;
                  p.catchWindow = 0;
                  p.flash = 8;
                  scores[i] += 15;
                  vfx.hitstop(2);
                  vfx.ring(p.x, p.y, '#38bdf8', 75, 4);
                  vfx.burst(p.x, p.y, '#38bdf8', 18, 6);
                  vfx.popup(p.x, p.y - 22, '+15 CATCH!', '#38bdf8', 16);
                  sound.combo(3);
                  rumble(i, 95, 0.85);

                  // Counter-throw directly back toward attacker (or facing dir)
                  let tx = p.dirX;
                  let ty = p.dirY;
                  if (prevOwner >= 0 && playersState[prevOwner].alive) {
                    const dx = playersState[prevOwner].x - p.x;
                    const dy = playersState[prevOwner].y - p.y;
                    const dm = Math.hypot(dx, dy) || 1;
                    tx = dx / dm;
                    ty = dy / dm;
                  }
                  b.owner = i;
                  b.hot = true;
                  b.fireball = true;
                  b.energized = true;
                  b.x = p.x + tx * 28;
                  b.y = p.y + ty * 28;
                  b.vx = tx * 16.5;
                  b.vy = ty * 16.5;
                  vfx.bolt(p.x, p.y, b.x, b.y, '#38bdf8');
                  break;
                } else {
                  p.alive = false;
                  if (p.holding >= 0) {
                    balls[p.holding].carrier = -1;
                    balls[p.holding].vx = (Math.random() - 0.5) * 4;
                    balls[p.holding].vy = (Math.random() - 0.5) * 4;
                    p.holding = -1;
                  }
                  if (b.owner >= 0) {
                    scores[b.owner] += 25;
                    rumble(b.owner, 70, 0.55);
                  }
                  vfx.flash(active[i].color, 0.12);
                  b.hot = false;
                  b.fireball = false;
                  b.vx *= -0.4;
                  b.vy *= -0.4;
                  vfx.hitstop(3);
                  vfx.burst(p.x, p.y, active[i].color, 28, 7.5);
                  vfx.ring(p.x, p.y, '#ff6b2b', 80, 4);
                  vfx.popup(p.x, p.y - 16, 'SMASH OUT!', '#ff6b2b', 16);
                  vfx.shake(10);
                  sound.explosion();
                  rumble(i, 180, 0.95);
                  break;
                }
              } else if (!b.hot && p.holding === -1) {
                p.holding = bi;
                b.carrier = i;
                sound.pickup(60);
                break;
              }
            }
          }
        }

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && playersState[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          if (alive.length === 1) {
            wins[alive[0]]++;
            scores[alive[0]] += 30;
            banner = `${active[alive[0]].name} DODGE KING!`;
            sound.win();
            vfx.confetti(playersState[alive[0]].x, playersState[alive[0]].y, 42);
            vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 28);
            vfx.flash(active[alive[0]].color, 0.22);
            rumble(alive[0], 220, 0.6);
          } else {
            banner = 'DOUBLE KNOCKOUT!';
            sound.explosion();
          }
          freeze = 90;
        }
      }

      drawArcadeBackdrop(ctx, '#ff6b2b');

      // Center plasma divider warning glow
      ctx.save();
      const pulse = 0.28 + Math.sin(frame * 0.12) * 0.1 + dividerWarn * 0.45;
      ctx.strokeStyle = dividerWarn > 0.2 ? '#facc15' : '#ff6b2b';
      ctx.globalAlpha = Math.min(0.95, pulse);
      ctx.shadowColor = dividerWarn > 0.2 ? '#facc15' : '#ff6b2b';
      ctx.shadowBlur = 14 + dividerWarn * 14;
      ctx.lineWidth = 3 + dividerWarn * 3;
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      ctx.moveTo(GAME_WIDTH / 2, 70);
      ctx.lineTo(GAME_WIDTH / 2, GAME_HEIGHT - 34);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !playersState[i].alive) continue;
        const p = playersState[i];
        const aimAng = Math.atan2(p.dirY, p.dirX);
        drawPlayerOrb(ctx, p.x, p.y, 19, active[i].color, i, {
          angle: aimAng,
          leader: i === leaderSlot,
          shield: p.catchWindow > 0,
          flash: p.flash > 0,
          cooldownPct: p.dashCd / 42,
        });

        // Fireball charge arc
        if (p.charge > 0) {
          const pct = p.charge / 40;
          ctx.save();
          ctx.strokeStyle = p.charge >= 26 ? '#ff6b2b' : '#facc15';
          ctx.lineWidth = 4;
          ctx.shadowColor = ctx.strokeStyle;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
          ctx.stroke();
          ctx.restore();
        }
      }

      for (const b of balls) {
        ctx.save();
        const col = b.fireball
          ? '#ff6b2b'
          : b.hot && b.owner >= 0
            ? active[b.owner].color
            : '#facc15';
        ctx.shadowColor = col;
        ctx.shadowBlur = b.fireball ? 28 : b.hot ? 20 : 10;
        ctx.fillStyle = b.fireball ? '#fff7ed' : b.hot ? '#ffffff' : '#facc15';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.fireball ? 14 : 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = b.fireball ? 4 : 3;
        ctx.stroke();
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'RESETTING DODGEBALL COURT...', '#ff6b2b');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderSlot,
          valueText: `${playersState[i].alive ? `${scores[i]}pt` : 'OUT'} · W${wins[i]}`,
        })),
        'HOLD A: CHARGE FIREBALL   ·   TIMED B: CATCH & COUNTER / DASH',
      );
    },
  };
}

// 17. GRAVITY FLIP RUN (Parallax Cyber Tunnel, Coin Rings, Moving Laser Crushers!)
export function createGravityFlipEngine(): MiniGameEngine {
  const FLOOR_Y = GAME_HEIGHT - 54;
  const CEIL_Y = 82;
  const wins = [0, 0, 0, 0];
  const scores = [0, 0, 0, 0];

  const makeRunners = () =>
    [0, 1, 2, 3].map((i) => ({
      x: 165 + i * 30,
      y: FLOOR_Y - 16,
      vy: 0,
      gravDir: 1,
      alive: true,
      prevFlip: false,
      combo: 0,
    }));

  let runners = makeRunners();
  // Per-round bot reaction lookahead (in frames) so CPU runners vary in skill and can be outlasted
  let botLook = [30, 30, 30, 30];
  const rollBotLook = () => {
    botLook = [0, 1, 2, 3].map(() => 22 + Math.random() * 18);
  };
  rollBotLook();
  let hazards: Array<{
    x: number;
    y: number;
    baseY: number;
    w: number;
    h: number;
    moving: boolean;
    phase: number;
    amp: number;
    botMiss: number; // bitmask of CPU slots that misread this crusher
  }> = [];
  let coins: Array<{ x: number; y: number; collected: number; phase: number }> = [];
  let speed = 5.4;
  let scrollDist = 0;
  let banner = '';
  let freeze = 20;

  const reset = () => {
    runners = makeRunners();
    rollBotLook();
    hazards = [];
    coins = [];
    speed = 5.4;
    scrollDist = 0;
    banner = '';
    freeze = 20;
  };

  // Vertical extent a hazard can ever occupy (moving crushers sweep across their amplitude)
  const hazTop = (h: { y: number; baseY: number; moving: boolean; amp: number }) =>
    h.moving ? h.baseY + Math.min(0, h.amp) : h.y;
  const hazBottom = (h: { y: number; baseY: number; h: number; moving: boolean; amp: number }) =>
    (h.moving ? h.baseY + Math.max(0, h.amp) : h.y) + h.h;
  const REST_FLOOR = FLOOR_Y - 15;
  const REST_CEIL = CEIL_Y + 15;

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
        if (freeze === 0 && banner) reset();
      } else {
        speed = Math.min(10.4, speed + 0.0024);
        scrollDist += speed;

        if (frame % 38 === 0) {
          const onFloor = Math.random() < 0.5;
          const moving = Math.random() < 0.45;
          const h = moving ? 68 + Math.random() * 68 : 78 + Math.random() * 135;
          const baseY = onFloor ? FLOOR_Y - h : CEIL_Y;
          // CPUs occasionally misread a crusher (more often as speed climbs) so runs end and
          // humans can outlast them — previously bots survived indefinitely at max speed.
          let botMiss = 0;
          const missP = 0.025 + (speed - 5.4) * 0.012;
          for (let s = 0; s < 4; s++) if (Math.random() < missP) botMiss |= 1 << s;
          hazards.push({
            botMiss,
            x: GAME_WIDTH + 40,
            y: baseY,
            baseY,
            w: 26,
            h,
            moving,
            phase: Math.random() * Math.PI * 2,
            amp: moving ? (onFloor ? -56 : 56) : 0,
          });
        }

        if (frame % 54 === 0) {
          const arcY = CEIL_Y + 60 + Math.random() * (FLOOR_Y - CEIL_Y - 120);
          for (let c = 0; c < 3; c++) {
            coins.push({
              x: GAME_WIDTH + 40 + c * 36,
              y: arcY + Math.sin(c * 1.1) * 26,
              collected: 0,
              phase: c * 0.6,
            });
          }
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !runners[i].alive) continue;
          const r = runners[i];
          let flipInput = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            flipInput = inp.actionA || inp.actionB || Math.abs(inp.y) > 0.55;
          } else {
            // Bot judges the next crusher by where it will REST (floor/ceiling), not where it is
            // mid-flip — the old check re-flipped every other frame while in transit and suicided.
            const look = speed * botLook[i];
            let nextH: (typeof hazards)[number] | null = null;
            for (const h of hazards) {
              if (h.x + h.w > r.x - 14 && h.x < r.x + look) {
                nextH = h;
                break;
              }
            }
            if (nextH) {
              const myRest = r.gravDir > 0 ? REST_FLOOR : REST_CEIL;
              const otherRest = r.gravDir > 0 ? REST_CEIL : REST_FLOOR;
              const blocks = (y: number) => y + 16 > hazTop(nextH!) && y - 16 < hazBottom(nextH!);
              const misread = (nextH.botMiss & (1 << i)) !== 0;
              if (!misread && blocks(myRest) && !blocks(otherRest) && !r.prevFlip) flipInput = true;
            } else {
              const nearCoin = coins.find(
                (c) => (c.collected & (1 << i)) === 0 && c.x > r.x + 20 && c.x < r.x + 110,
              );
              if (nearCoin && !r.prevFlip) {
                const wantDir = nearCoin.y > r.y ? 1 : -1;
                if (wantDir !== r.gravDir && Math.abs(nearCoin.y - r.y) > 70) {
                  flipInput = true;
                }
              }
            }
          }

          // Edge-triggered A gravity flip!
          if (flipInput && !r.prevFlip) {
            r.gravDir *= -1;
            vfx.burst(r.x, r.y, active[i].color, 8, 3.8);
            vfx.ring(r.x, r.y, active[i].color, 34, 2);
            sound.beep(r.gravDir > 0 ? 340 : 640, 0.055, 'triangle', 0.09);
            rumble(i, 35, 0.3);
          }
          r.prevFlip = flipInput;

          r.vy += r.gravDir * 0.96;
          r.vy = Math.max(-13.5, Math.min(13.5, r.vy));
          r.y += r.vy;

          if (r.y > FLOOR_Y - 15) {
            r.y = FLOOR_Y - 15;
            r.vy = 0;
          } else if (r.y < CEIL_Y + 15) {
            r.y = CEIL_Y + 15;
            r.vy = 0;
          }

          // Afterimage ribbon while airborne or flipping
          if (Math.abs(r.vy) > 1.2 || frame % 3 === 0) {
            vfx.afterimage(r.x, r.y, 13, active[i].color, 9);
          }

          // Hybrid survival scoring
          if (frame % 18 === 0) {
            scores[i] += 2;
          }
        }

        // Coin rings
        coins = coins.filter((c) => {
          c.x -= speed;
          c.phase += 0.12;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || !runners[i].alive) continue;
            if ((c.collected & (1 << i)) !== 0) continue;
            const r = runners[i];
            if (Math.hypot(c.x - r.x, c.y - r.y) < 26) {
              c.collected |= 1 << i;
              r.combo++;
              const pts = 10 + Math.min(15, r.combo * 2);
              scores[i] += pts;
              vfx.burst(c.x, c.y, '#facc15', 10, 4.5);
              vfx.ring(c.x, c.y, '#fde047', 34, 2);
              vfx.popup(c.x, c.y - 16, `+${pts}`, '#facc15', 13);
              sound.combo(r.combo);
              rumble(i, 25, 0.25);
            }
          }
          return c.x > 20;
        });

        // Moving laser crushers
        hazards = hazards.filter((h) => {
          h.x -= speed;
          if (h.moving) {
            h.phase += 0.065;
            const offset = (Math.sin(h.phase) * 0.5 + 0.5) * h.amp;
            h.y = h.baseY + offset;
          }
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || !runners[i].alive) continue;
            const r = runners[i];
            if (r.x + 11 > h.x && r.x - 11 < h.x + h.w && r.y + 11 > h.y && r.y - 11 < h.y + h.h) {
              r.alive = false;
              r.combo = 0;
              vfx.hitstop(2);
              vfx.burst(r.x, r.y, active[i].color, 26, 7);
              vfx.ring(r.x, r.y, '#fb7185', 68, 3.5);
              vfx.popup(r.x, r.y - 16, 'CRUSHED!', '#fb7185', 14);
              vfx.shake(9);
              sound.explosion();
              rumble(i, 160, 0.9);
            }
          }
          return h.x + h.w > 20;
        });

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && runners[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          if (alive.length === 1) {
            wins[alive[0]]++;
            scores[alive[0]] += 35;
            banner = `${active[alive[0]].name} GRAVITY MASTER!`;
            sound.win();
            vfx.confetti(runners[alive[0]].x, runners[alive[0]].y, 40);
            vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 26);
            vfx.flash(active[alive[0]].color, 0.2);
            rumble(alive[0], 220, 0.6);
          } else {
            banner = total === 1 ? `RUN OVER · ${scores[0]} PTS` : 'LASER WIPEOUT!';
          }
          freeze = 90;
        }
      }

      drawArcadeBackdrop(ctx, '#38bdf8');

      // Parallax cyber tunnel background layers
      ctx.save();
      ctx.beginPath();
      ctx.rect(32, CEIL_Y, GAME_WIDTH - 64, FLOOR_Y - CEIL_Y);
      ctx.clip();

      // Far parallax pillars
      ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
      const farOff = (scrollDist * 0.3) % 160;
      for (let px = 32 - farOff; px < GAME_WIDTH; px += 160) {
        ctx.fillRect(px, CEIL_Y, 44, FLOOR_Y - CEIL_Y);
      }

      // Mid parallax chevrons
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.14)';
      ctx.lineWidth = 2;
      const midOff = (scrollDist * 0.65) % 120;
      for (let cx = 32 - midOff; cx < GAME_WIDTH + 60; cx += 120) {
        ctx.beginPath();
        ctx.moveTo(cx + 30, CEIL_Y + 20);
        ctx.lineTo(cx, (CEIL_Y + FLOOR_Y) / 2);
        ctx.lineTo(cx + 30, FLOOR_Y - 20);
        ctx.stroke();
      }
      ctx.restore();

      // Tunnel Ceiling & Floor rails
      ctx.fillStyle = '#182032';
      ctx.fillRect(28, CEIL_Y - 12, GAME_WIDTH - 56, 12);
      ctx.fillRect(28, FLOOR_Y, GAME_WIDTH - 56, 12);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(28, CEIL_Y);
      ctx.lineTo(GAME_WIDTH - 28, CEIL_Y);
      ctx.moveTo(28, FLOOR_Y);
      ctx.lineTo(GAME_WIDTH - 28, FLOOR_Y);
      ctx.stroke();

      // Coin rings — hidden once every live runner has grabbed it (previously only vanished when
      // all 4 slot bits were set, so with <4 players collected rings never disappeared).
      let liveMask = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && runners[i].alive) liveMask |= 1 << i;
      }
      ctx.save();
      ctx.lineWidth = 3.5;
      for (const c of coins) {
        if ((c.collected & liveMask) === liveMask) continue;
        const rx = 11 * (0.65 + 0.35 * Math.abs(Math.cos(c.phase)));
        // Cheap additive glow halo instead of per-coin shadowBlur
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rx, 11, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = c.collected !== 0 ? 0.55 : 1;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }
      ctx.restore();

      // Hazards / Moving Laser Crushers
      for (const h of hazards) {
        ctx.save();
        const col = h.moving ? '#ff6b2b' : '#fb7185';
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(h.x, h.y, h.w, h.h, 6);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(h.x + h.w / 2 - 2, h.y + 6, 4, Math.max(4, h.h - 12));
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !runners[i].alive) continue;
        const r = runners[i];
        drawPlayerOrb(ctx, r.x, r.y, 14, active[i].color, i, {
          angle: r.gravDir > 0 ? Math.PI * 0.15 : -Math.PI * 0.15,
          leader: i === leaderSlot,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'RESETTING GRAVITY CORRIDOR...', '#38bdf8');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderSlot,
          valueText: `${runners[i].alive ? `${scores[i]}pt` : 'KO'} · W${wins[i]}`,
        })),
        'EDGE-TAP A / B / SPACE: FLIP GRAVITY   ·   COLLECT GOLD RINGS!',
      );
    },
  };
}

// 18. ASTEROID DOGFIGHT (Warp-Ring Screen Wrap, Multi-Tier Split Rocks, Shield & Triple-Spread!)
export function createAsteroidDogfightEngine(): MiniGameEngine {
  const scores = [0, 0, 0, 0];
  const wins = [0, 0, 0, 0];
  const WIN_SCORE = 150;

  const makeShips = () =>
    [0, 1, 2, 3].map((i) => ({
      x: i % 2 === 0 ? 150 : GAME_WIDTH - 150,
      y: i < 2 ? 160 : 410,
      vx: 0,
      vy: 0,
      angle: i % 2 === 0 ? 0 : Math.PI,
      cd: 0,
      invuln: 45,
      shield: false,
      tripleTimer: 0,
      brakeCd: 0,
      prevB: false,
    }));

  const makeRocks = () =>
    Array.from({ length: 5 }, (_, i) => ({
      x: 240 + (i % 3) * 240,
      y: i < 3 ? 190 : 385,
      vx: (Math.random() - 0.5) * 2.2,
      vy: (Math.random() - 0.5) * 2.2,
      r: 28,
      tier: 3,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.04,
    }));

  let ships = makeShips();
  let rocks = makeRocks();
  let bullets: Array<{ x: number; y: number; vx: number; vy: number; owner: number; life: number }> = [];
  let pickups: Array<{ x: number; y: number; type: 'shield' | 'triple'; life: number }> = [];
  let banner = '';
  let freeze = 20;

  const resetMatch = () => {
    for (let i = 0; i < 4; i++) scores[i] = 0;
    ships = makeShips();
    rocks = makeRocks();
    bullets = [];
    pickups = [];
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
        // Replenish rocks if low
        if (rocks.length < 4 && frame % 90 === 0) {
          const rx = Math.random() < 0.5 ? 80 : GAME_WIDTH - 80;
          const ry = 130 + Math.random() * 310;
          rocks.push({
            x: rx,
            y: ry,
            vx: (rx < GAME_WIDTH / 2 ? 1 : -1) * (1.2 + Math.random()),
            vy: (Math.random() - 0.5) * 2,
            r: 28,
            tier: 3,
            rot: 0,
            vrot: 0.03,
          });
          vfx.ring(rx, ry, '#c084fc', 55, 3);
        }

        // Spawn occasional pickup
        if (pickups.length < 2 && frame % 260 === 120) {
          pickups.push({
            x: 160 + Math.random() * (GAME_WIDTH - 320),
            y: 120 + Math.random() * (GAME_HEIGHT - 220),
            type: Math.random() < 0.5 ? 'shield' : 'triple',
            life: 600,
          });
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const s = ships[i];
          let thrust = false;
          let fire = false;
          let btnB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            if (Math.hypot(inp.x, inp.y) > 0.25) {
              const desired = Math.atan2(inp.y, inp.x);
              let diff = desired - s.angle;
              while (diff > Math.PI) diff -= Math.PI * 2;
              while (diff < -Math.PI) diff += Math.PI * 2;
              s.angle += Math.max(-0.15, Math.min(0.15, diff));
              thrust = true;
            }
            fire = inp.actionA;
            btnB = inp.actionB;
          } else {
            // Bot seeks pickups when nearby or dogfights closest rival
            const nearPk = pickups[0];
            if (nearPk && Math.hypot(nearPk.x - s.x, nearPk.y - s.y) < 180) {
              const desired = Math.atan2(nearPk.y - s.y, nearPk.x - s.x);
              let diff = desired - s.angle;
              while (diff > Math.PI) diff -= Math.PI * 2;
              while (diff < -Math.PI) diff += Math.PI * 2;
              s.angle += Math.max(-0.1, Math.min(0.1, diff));
              thrust = true;
            } else {
              let target = null as (typeof ships)[number] | null;
              let bestD = Infinity;
              for (let j = 0; j < 4; j++) {
                if (j === i || !active[j].enabled) continue;
                const d = Math.hypot(ships[j].x - s.x, ships[j].y - s.y);
                if (d < bestD) {
                  bestD = d;
                  target = ships[j];
                }
              }
              if (target) {
                const desired = Math.atan2(target.y - s.y, target.x - s.x);
                let diff = desired - s.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                s.angle += Math.max(-0.09, Math.min(0.09, diff));
                thrust = bestD > 160;
                fire = Math.abs(diff) < 0.3 && Math.random() < 0.12;
                if (bestD < 120 && Math.hypot(s.vx, s.vy) > 3.5 && s.brakeCd === 0) btnB = true;
              }
              // Opportunistic rock shots: bots previously never scored off asteroids at all
              if (!fire && s.cd === 0) {
                const ca = Math.cos(s.angle);
                const sa = Math.sin(s.angle);
                for (const r of rocks) {
                  const dx = r.x - s.x;
                  const dy = r.y - s.y;
                  const along = dx * ca + dy * sa;
                  if (along > 0 && along < 320 && Math.abs(-dx * sa + dy * ca) < r.r + 4) {
                    fire = Math.random() < 0.2;
                    break;
                  }
                }
              }
            }
          }

          if (s.brakeCd > 0) s.brakeCd--;
          const tapB = btnB && !s.prevB;
          if (tapB && s.brakeCd === 0) {
            if (thrust) {
              // Hyper-boost surge
              s.vx += Math.cos(s.angle) * 6.5;
              s.vy += Math.sin(s.angle) * 6.5;
              s.brakeCd = 42;
              vfx.ring(s.x, s.y, '#c084fc', 46, 2.5);
              vfx.afterimage(s.x, s.y, 14, active[i].color, 12);
              sound.dash();
            } else {
              // Hyper-brake instant stop
              s.vx *= 0.1;
              s.vy *= 0.1;
              s.brakeCd = 34;
              vfx.ring(s.x, s.y, '#38bdf8', 38, 2);
              sound.beep(260, 0.06, 'sine', 0.09);
            }
          }
          s.prevB = btnB;

          if (thrust) {
            s.vx += Math.cos(s.angle) * 0.3;
            s.vy += Math.sin(s.angle) * 0.3;
            if (frame % 2 === 0) {
              vfx.spark(
                s.x - Math.cos(s.angle) * 14,
                s.y - Math.sin(s.angle) * 14,
                -Math.cos(s.angle) * 2.5,
                -Math.sin(s.angle) * 2.5,
                '#ff6b2b',
                3,
              );
            }
          }

          if (Math.hypot(s.vx, s.vy) > 5.5 && frame % 2 === 0) {
            vfx.afterimage(s.x, s.y, 12, active[i].color, 8);
          }

          s.vx *= 0.965;
          s.vy *= 0.965;
          s.x += s.vx;
          s.y += s.vy;

          // Screen-wrap warp rings!
          let wrapped = false;
          const oldX = s.x;
          const oldY = s.y;
          if (s.x < 38) {
            s.x = GAME_WIDTH - 40;
            wrapped = true;
          } else if (s.x > GAME_WIDTH - 38) {
            s.x = 40;
            wrapped = true;
          }
          if (s.y < 74) {
            s.y = GAME_HEIGHT - 40;
            wrapped = true;
          } else if (s.y > GAME_HEIGHT - 38) {
            s.y = 76;
            wrapped = true;
          }
          if (wrapped) {
            vfx.ring(oldX, oldY, '#c084fc', 36, 2);
            vfx.ring(s.x, s.y, '#38bdf8', 36, 2);
            sound.beep(520, 0.05, 'sine', 0.05);
          }

          if (s.invuln > 0) s.invuln--;
          if (s.tripleTimer > 0) s.tripleTimer--;
          if (s.cd > 0) s.cd--;
          if (fire && s.cd === 0) {
            const offsets = s.tripleTimer > 0 ? [-0.22, 0, 0.22] : [0];
            for (const off of offsets) {
              const a = s.angle + off;
              bullets.push({
                x: s.x + Math.cos(a) * 20,
                y: s.y + Math.sin(a) * 20,
                vx: Math.cos(a) * 9.2 + s.vx * 0.25,
                vy: Math.sin(a) * 9.2 + s.vy * 0.25,
                owner: i,
                life: 58,
              });
            }
            s.cd = s.tripleTimer > 0 ? 13 : 15;
            sound.beep(720 + i * 45, 0.04, 'triangle', 0.07);
            vfx.spark(
              s.x + Math.cos(s.angle) * 20,
              s.y + Math.sin(s.angle) * 20,
              Math.cos(s.angle) * 3,
              Math.sin(s.angle) * 3,
              '#ffffff',
              2.5,
            );
          }

          // Pickup collision (in-place, no per-ship array realloc)
          for (let pi = pickups.length - 1; pi >= 0; pi--) {
            const pk = pickups[pi];
            if (Math.hypot(pk.x - s.x, pk.y - s.y) < 26) {
              if (pk.type === 'shield') s.shield = true;
              else s.tripleTimer = 420;
              vfx.ring(s.x, s.y, pk.type === 'shield' ? '#38bdf8' : '#facc15', 52, 3);
              vfx.popup(s.x, s.y - 18, pk.type === 'shield' ? 'SHIELD!' : 'TRIPLE SPREAD!', '#facc15', 13);
              sound.pickup(140);
              rumble(i, 50, 0.4);
              pickups.splice(pi, 1);
            }
          }
        }

        for (let pi = pickups.length - 1; pi >= 0; pi--) {
          if (--pickups[pi].life <= 0) pickups.splice(pi, 1);
        }

        // Asteroids move & wrap + collide with ships
        for (const r of rocks) {
          r.x += r.vx;
          r.y += r.vy;
          r.rot += r.vrot;
          if (r.x < 38) r.x = GAME_WIDTH - 40;
          if (r.x > GAME_WIDTH - 38) r.x = 40;
          if (r.y < 74) r.y = GAME_HEIGHT - 40;
          if (r.y > GAME_HEIGHT - 38) r.y = 76;

          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || ships[i].invuln > 0) continue;
            const s = ships[i];
            if (Math.hypot(s.x - r.x, s.y - r.y) < r.r + 13) {
              if (s.shield) {
                s.shield = false;
                s.invuln = 35;
                vfx.ring(s.x, s.y, '#38bdf8', 58, 3);
                sound.hit();
              } else {
                s.invuln = 55;
                s.vx = -s.vx * 0.8 + (s.x - r.x) * 0.15;
                s.vy = -s.vy * 0.8 + (s.y - r.y) * 0.15;
                vfx.burst(s.x, s.y, '#fb7185', 14, 5);
                vfx.shake(6);
                sound.hit();
                rumble(i, 120, 0.7);
              }
            }
          }
        }

        const nextRocks: typeof rocks = [];
        const deadRockIdx = new Set<number>();

        bullets = bullets.filter((b) => {
          b.x += b.vx;
          b.y += b.vy;
          b.life--;
          // Wrap bullets too!
          if (b.x < 36) b.x = GAME_WIDTH - 38;
          else if (b.x > GAME_WIDTH - 36) b.x = 38;
          if (b.y < 72) b.y = GAME_HEIGHT - 38;
          else if (b.y > GAME_HEIGHT - 36) b.y = 74;

          for (let ri = 0; ri < rocks.length; ri++) {
            if (deadRockIdx.has(ri)) continue;
            const r = rocks[ri];
            if (Math.hypot(b.x - r.x, b.y - r.y) < r.r + 3) {
              deadRockIdx.add(ri);
              const pts = r.tier === 3 ? 6 : r.tier === 2 ? 8 : 12;
              scores[b.owner] += pts;
              vfx.burst(r.x, r.y, '#94a3b8', 12 + r.tier * 4, 4.5);
              vfx.popup(r.x, r.y - 10, `+${pts}`, '#cbd5e1', 12);
              sound.noiseBurst(0.1, 700, 0.1);
              if (r.tier > 1) {
                vfx.hitstop(1);
                const newTier = r.tier - 1;
                const newR = newTier === 2 ? 18 : 11;
                for (let k = 0; k < 2; k++) {
                  const ang = Math.atan2(b.vy, b.vx) + (k === 0 ? 0.7 : -0.7);
                  nextRocks.push({
                    x: r.x + Math.cos(ang) * 10,
                    y: r.y + Math.sin(ang) * 10,
                    vx: Math.cos(ang) * (2.1 + Math.random()),
                    vy: Math.sin(ang) * (2.1 + Math.random()),
                    r: newR,
                    tier: newTier,
                    rot: 0,
                    vrot: (Math.random() - 0.5) * 0.08,
                  });
                }
              } else {
                vfx.hitstop(2);
                vfx.ring(r.x, r.y, '#facc15', 42, 2.5);
                if (Math.random() < 0.35 && pickups.length < 3) {
                  pickups.push({
                    x: r.x,
                    y: r.y,
                    type: Math.random() < 0.5 ? 'shield' : 'triple',
                    life: 540,
                  });
                }
              }
              return false;
            }
          }

          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || i === b.owner || ships[i].invuln > 0) continue;
            if (Math.hypot(b.x - ships[i].x, b.y - ships[i].y) < 19) {
              if (ships[i].shield) {
                ships[i].shield = false;
                ships[i].invuln = 30;
                vfx.ring(ships[i].x, ships[i].y, '#38bdf8', 58, 3);
                vfx.popup(ships[i].x, ships[i].y - 18, 'SHIELD BREAK!', '#38bdf8', 12);
                sound.hit();
                return false;
              }
              scores[b.owner] += 25;
              ships[i].invuln = 65;
              vfx.hitstop(3);
              vfx.burst(ships[i].x, ships[i].y, active[i].color, 26, 7);
              vfx.ring(ships[i].x, ships[i].y, active[b.owner].color, 72, 3.5);
              vfx.popup(ships[i].x, ships[i].y - 16, 'SHATTER +25!', active[b.owner].color, 15);
              vfx.shake(9);
              sound.explosion();
              rumble(i, 160, 0.9);
              rumble(b.owner, 60, 0.5);
              return false;
            }
          }
          return b.life > 0;
        });

        if (deadRockIdx.size > 0 || nextRocks.length > 0) {
          rocks = rocks.filter((_, idx) => !deadRockIdx.has(idx)).concat(nextRocks);
        }

        const winner = [0, 1, 2, 3].find((i) => active[i].enabled && scores[i] >= WIN_SCORE);
        if (winner !== undefined) {
          wins[winner]++;
          banner = `${active[winner].name} ACE PILOT!`;
          freeze = 95;
          sound.win();
          vfx.confetti(ships[winner].x, ships[winner].y, 45);
          vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 26);
          vfx.flash(active[winner].color, 0.24);
          rumble(winner, 220, 0.6);
        }
      }

      drawArcadeBackdrop(ctx, '#c084fc');

      // Edge warp portal indicators
      ctx.save();
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.35)';
      ctx.setLineDash([10, 14]);
      ctx.lineWidth = 2;
      ctx.strokeRect(36, 72, GAME_WIDTH - 72, GAME_HEIGHT - 110);
      ctx.setLineDash([]);
      ctx.restore();

      // Pickups
      for (const pk of pickups) {
        const col = pk.type === 'shield' ? '#38bdf8' : '#facc15';
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(pk.type === 'shield' ? 'S' : '3X', pk.x, pk.y + 4);
        ctx.restore();
      }

      // Multi-tier Asteroids
      for (const r of rocks) {
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.rotate(r.rot);
        ctx.fillStyle = '#1f2937';
        ctx.strokeStyle = r.tier === 3 ? '#c084fc' : r.tier === 2 ? '#94a3b8' : '#facc15';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const sides = 7;
        for (let k = 0; k < sides; k++) {
          const a = (k / sides) * Math.PI * 2;
          const rad = r.r * (k % 2 === 0 ? 1 : 0.8);
          if (k === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
          else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Bullets: additive halo + core instead of per-bullet shadowBlur (dozens on screen)
      if (bullets.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.3;
        for (const b of bullets) {
          ctx.fillStyle = active[b.owner].color;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        for (const b of bullets) {
          ctx.fillStyle = active[b.owner].color;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const s = ships[i];
        if (s.invuln > 0 && Math.floor(s.invuln / 4) % 2 === 0) continue;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.shadowColor = active[i].color;
        ctx.shadowBlur = 18;
        ctx.fillStyle = active[i].color;
        ctx.beginPath();
        ctx.moveTo(19, 0);
        ctx.lineTo(-13, -12);
        ctx.lineTo(-7, 0);
        ctx.lineTo(-13, 12);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        if (s.shield) {
          ctx.save();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 23, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'WARPING NEW SECTOR...', '#c084fc');
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
        'STEER & THRUST: STICK / WASD   ·   FIRE: A   ·   BOOST / BRAKE: B',
      );
    },
  };
}

// 19. FLOOR IS LAVA (Cracking Hex/Cyber Tiles, Bubbling Magma, Meteor Shadows, Jump/Shove Dash!)
export function createFloorIsLavaEngine(): MiniGameEngine {
  const COLS = 12;
  const ROWS = 7;
  const TW = 64;
  const TH = 56;
  const OX = (GAME_WIDTH - COLS * TW) / 2;
  const OY = 84;

  const wins = [0, 0, 0, 0];
  const tiles = new Int16Array(COLS * ROWS); // 110 = solid, 1..70 = amber->crack, <=0 = magma
  let meteors: Array<{ col: number; row: number; timer: number; maxTimer: number }> = [];
  let embers: Array<{ x: number; y: number; vy: number; life: number; r: number }> = [];

  const makeWalkers = () =>
    [0, 1, 2, 3].map((i) => ({
      x: OX + (i % 2 === 0 ? 2 : COLS - 3) * TW + TW / 2,
      y: OY + (i < 2 ? 1 : ROWS - 2) * TH + TH / 2,
      vx: 0,
      vy: 0,
      alive: true,
      jumpAir: 0,
      jumpCd: 0,
      prevA: false,
      dirX: i % 2 === 0 ? 1 : -1,
      dirY: 0,
      // Bot target cache (re-planned every few frames)
      aiTx: 0,
      aiTy: 0,
      aiThink: 0,
    }));

  let walkers = makeWalkers();
  let banner = '';
  let freeze = 20;
  let roundFrames = 0;

  const reset = () => {
    tiles.fill(110);
    meteors = [];
    walkers = makeWalkers();
    banner = '';
    freeze = 20;
    roundFrames = 0;
  };
  reset();

  const tileAt = (x: number, y: number) => {
    const c = Math.floor((x - OX) / TW);
    const r = Math.floor((y - OY) / TH);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return 0;
    return tiles[r * COLS + c];
  };

  // Does a straight walk from (x0,y0) to (x1,y1) cross magma / nearly-collapsed tiles?
  const pathCrossesMagma = (x0: number, y0: number, x1: number, y1: number) => {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(d / 18);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (tileAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) <= 8) return true;
    }
    return false;
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

      // Rising magma embers ambient
      if (frame % 3 === 0) {
        embers.push({
          x: OX + Math.random() * COLS * TW,
          y: OY + Math.random() * ROWS * TH,
          vy: -0.6 - Math.random() * 1.1,
          life: 40 + Math.random() * 20,
          r: 1.8 + Math.random() * 2.5,
        });
      }
      embers = embers.filter((e) => {
        e.y += e.vy;
        e.life--;
        return e.life > 0;
      });

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        // Periodic random tile decay
        if (frame % 22 === 0) {
          const rIdx = Math.floor(Math.random() * tiles.length);
          if (tiles[rIdx] === 110) tiles[rIdx] = 68;
        }

        roundFrames++;
        // Meteor cluster danger shadows! (escalates per ROUND, not per global frame counter)
        if (frame % 135 === 45) {
          const count = 2 + (roundFrames > 400 ? 1 : 0) + (roundFrames > 1500 ? 1 : 0);
          for (let m = 0; m < count; m++) {
            const c = Math.floor(Math.random() * COLS);
            const r = Math.floor(Math.random() * ROWS);
            if (tiles[r * COLS + c] > 0) {
              meteors.push({ col: c, row: r, timer: 68, maxTimer: 68 });
            }
          }
          sound.beep(280, 0.08, 'sawtooth', 0.06);
        }

        meteors = meteors.filter((m) => {
          m.timer--;
          if (m.timer <= 0) {
            const mx = OX + m.col * TW + TW / 2;
            const my = OY + m.row * TH + TH / 2;
            tiles[m.row * COLS + m.col] = 0;
            vfx.burst(mx, my, '#ff6b2b', 22, 6.5, 4, 0.1);
            vfx.ring(mx, my, '#facc15', 55, 3);
            vfx.shake(7);
            sound.noiseBurst(0.16, 650, 0.14);
            for (let i = 0; i < 4; i++) {
              if (!active[i].enabled || !walkers[i].alive || walkers[i].jumpAir > 0) continue;
              const w = walkers[i];
              const d = Math.hypot(w.x - mx, w.y - my);
              if (d < 44) {
                w.vx += ((w.x - mx) / (d || 1)) * 9;
                w.vy += ((w.y - my) / (d || 1)) * 9;
                rumble(i, 120, 0.8);
              }
            }
            return false;
          }
          return true;
        });

        for (let k = 0; k < tiles.length; k++) {
          if (tiles[k] > 0 && tiles[k] < 110) {
            tiles[k]--;
            if (tiles[k] === 0) {
              const c = k % COLS;
              const r = Math.floor(k / COLS);
              vfx.burst(OX + c * TW + TW / 2, OY + r * TH + TH / 2, '#fb923c', 10, 4);
            }
          }
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !walkers[i].alive) continue;
          const w = walkers[i];
          let ix = 0;
          let iy = 0;
          let btnA = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            btnA = inp.actionA;
          } else {
            // Re-plan every 8 frames; prefer solid tiles reachable WITHOUT walking over magma
            // (old AI beelined across lava and melted itself).
            if (w.aiThink <= 0 || tileAt(w.aiTx, w.aiTy) <= 30) {
              w.aiThink = 8;
              let bestX = w.x;
              let bestY = w.y;
              let bestScore = -9999;
              for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                  const st = tiles[r * COLS + c];
                  if (st <= 12) continue;
                  let hasMeteor = false;
                  for (const m of meteors) {
                    if (m.col === c && m.row === r) {
                      hasMeteor = true;
                      break;
                    }
                  }
                  if (hasMeteor) continue;
                  const tx = OX + c * TW + TW / 2;
                  const ty = OY + r * TH + TH / 2;
                  const dist = Math.hypot(tx - w.x, ty - w.y);
                  let sc = st * 2.2 - dist;
                  if (sc <= bestScore) continue;
                  if (dist > 40 && pathCrossesMagma(w.x, w.y, tx, ty)) sc -= w.jumpCd === 0 && dist < 150 ? 40 : 160;
                  if (sc > bestScore) {
                    bestScore = sc;
                    bestX = tx;
                    bestY = ty;
                  }
                }
              }
              w.aiTx = bestX;
              w.aiTy = bestY;
            }
            w.aiThink--;
            const d = Math.hypot(w.aiTx - w.x, w.aiTy - w.y) || 1;
            const speedMul = d < 10 ? d / 10 : 1;
            ix = ((w.aiTx - w.x) / d) * 0.88 * speedMul;
            iy = ((w.aiTy - w.y) / d) * 0.88 * speedMul;
            const curC = Math.floor((w.x - OX) / TW);
            const curR = Math.floor((w.y - OY) / TH);
            const curTile = tileAt(w.x, w.y);
            let onMeteor = false;
            for (const m of meteors) {
              if (m.col === curC && m.row === curR && m.timer < 30) onMeteor = true;
            }
            // Hop over magma directly ahead, or off a tile about to collapse / be struck
            const aheadTile = tileAt(w.x + (ix / 0.88) * 30, w.y + (iy / 0.88) * 30);
            if ((curTile < 24 || onMeteor || (aheadTile <= 0 && d > 30)) && w.jumpCd === 0) {
              btnA = true;
            }
          }

          if (Math.hypot(ix, iy) > 0.15) {
            const m = Math.hypot(ix, iy);
            w.dirX = ix / m;
            w.dirY = iy / m;
          }

          if (w.jumpCd > 0) w.jumpCd--;
          const tapA = btnA && !w.prevA;
          w.prevA = btnA;

          if (tapA && w.jumpCd === 0) {
            w.jumpAir = 18;
            w.jumpCd = 42;
            const dirM = Math.hypot(ix, iy) > 0.1 ? { x: ix, y: iy } : { x: w.dirX, y: w.dirY };
            w.vx += dirM.x * 7.8;
            w.vy += dirM.y * 7.8;
            vfx.ring(w.x, w.y, active[i].color, 40, 2.5);
            sound.dash();
          }

          if (w.jumpAir > 0) {
            w.jumpAir--;
            vfx.afterimage(w.x, w.y, 16, active[i].color, 8);
            if (w.jumpAir === 0) {
              // Landing shove impact!
              vfx.ring(w.x, w.y, '#facc15', 52, 2.5);
              sound.hit();
              for (let j = 0; j < 4; j++) {
                if (j === i || !active[j].enabled || !walkers[j].alive) continue;
                const o = walkers[j];
                const d = Math.hypot(o.x - w.x, o.y - w.y);
                if (d > 0 && d < 64) {
                  o.vx += ((o.x - w.x) / d) * 9.5;
                  o.vy += ((o.y - w.y) / d) * 9.5;
                  vfx.popup(o.x, o.y - 16, 'SHOVE!', '#facc15', 12);
                  vfx.burst((o.x + w.x) / 2, (o.y + w.y) / 2, '#facc15', 10, 4.5);
                  vfx.hitstop(2);
                  vfx.shake(4);
                  rumble(j, 90, 0.7);
                  rumble(i, 50, 0.45);
                }
              }
            }
          }

          w.vx = w.vx * 0.84 + ix * 1.1;
          w.vy = w.vy * 0.84 + iy * 1.1;
          w.x = Math.max(OX + 12, Math.min(OX + COLS * TW - 12, w.x + w.vx));
          w.y = Math.max(OY + 12, Math.min(OY + ROWS * TH - 12, w.y + w.vy));

          const col = Math.floor((w.x - OX) / TW);
          const row = Math.floor((w.y - OY) / TH);
          const idx = row * COLS + col;
          if (idx >= 0 && idx < tiles.length && w.jumpAir === 0) {
            if (tiles[idx] === 110) tiles[idx] = 66;
            if (tiles[idx] <= 0) {
              w.alive = false;
              vfx.hitstop(2);
              vfx.burst(w.x, w.y, '#ff6b2b', 28, 7.5);
              vfx.ring(w.x, w.y, '#ef4444', 78, 4);
              vfx.popup(w.x, w.y - 16, 'MELTED!', '#ff6b2b', 16);
              vfx.shake(10);
              sound.explosion();
              rumble(i, 180, 0.95);
            }
          }
        }

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && walkers[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          if (alive.length === 1) {
            wins[alive[0]]++;
            banner = `${active[alive[0]].name} LAVA SURVIVOR!`;
            sound.win();
            vfx.confetti(walkers[alive[0]].x, walkers[alive[0]].y, 44);
            vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 26);
            vfx.flash(active[alive[0]].color, 0.22);
            rumble(alive[0], 220, 0.6);
          } else {
            banner =
              total === 1 ? `SURVIVED ${(roundFrames / 60).toFixed(1)}s` : 'EVERYONE MELTED!';
          }
          freeze = 90;
        }
      }

      drawArcadeBackdrop(ctx, '#ff6b2b');

      // Bubbling magma pool underneath grid
      ctx.save();
      ctx.fillStyle = '#450a0a';
      ctx.beginPath();
      ctx.roundRect(OX - 8, OY - 8, COLS * TW + 16, ROWS * TH + 16, 12);
      ctx.fill();
      for (const e of embers) {
        ctx.fillStyle = e.life > 20 ? '#fb923c' : '#fde047';
        ctx.globalAlpha = Math.min(0.7, e.life / 35);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Platforms (flash amber -> crack -> plunge)
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const st = tiles[r * COLS + c];
          const x = OX + c * TW;
          const y = OY + r * TH;
          if (st <= 0) {
            ctx.fillStyle = `rgba(239, 68, 68, ${0.14 + Math.sin(frame * 0.08 + r + c) * 0.07})`;
            ctx.beginPath();
            ctx.roundRect(x + 4, y + 4, TW - 8, TH - 8, 8);
            ctx.fill();
          } else {
            // Deterministic tremble (was Math.random per render → noisy flicker, even during banners)
            const shakeAmt = st < 36 ? 1.2 * (1 - st / 36) + 0.5 : 0;
            const jx = shakeAmt ? Math.sin(frame * 1.9 + c * 2.3 + r) * shakeAmt : 0;
            const jy = shakeAmt ? Math.cos(frame * 2.3 + r * 1.7 + c) * shakeAmt : 0;
            const flashAmber = st < 110 && st > 36 && Math.floor(st / 6) % 2 === 0;
            ctx.fillStyle = st === 110 ? '#1d2434' : flashAmber ? '#d97706' : st > 34 ? '#92400e' : '#b91c1c';
            ctx.strokeStyle = st === 110 ? 'rgba(255,255,255,0.14)' : '#fb923c';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(x + 3 + jx, y + 3 + jy, TW - 6, TH - 6, 9);
            ctx.fill();
            ctx.stroke();

            if (st < 65) {
              ctx.strokeStyle = '#fde047';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(x + 12 + jx, y + 10 + jy);
              ctx.lineTo(x + TW / 2 + jx, y + TH / 2 + jy);
              ctx.lineTo(x + TW - 14 + jx, y + TH - 12 + jy);
              if (st < 32) {
                ctx.moveTo(x + TW - 12 + jx, y + 12 + jy);
                ctx.lineTo(x + TW / 2 + jx, y + TH / 2 + jy);
                ctx.lineTo(x + 14 + jx, y + TH - 10 + jy);
              }
              ctx.stroke();
            }
          }
        }
      }

      // Meteor danger shadows
      for (const m of meteors) {
        const mx = OX + m.col * TW + TW / 2;
        const my = OY + m.row * TH + TH / 2;
        const pct = 1 - m.timer / m.maxTimer;
        ctx.save();
        ctx.fillStyle = `rgba(239, 68, 68, ${0.22 + pct * 0.45})`;
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(mx, my, 24 * (0.4 + pct * 0.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !walkers[i].alive) continue;
        const w = walkers[i];
        const hopScale = w.jumpAir > 0 ? 1 + Math.sin((w.jumpAir / 18) * Math.PI) * 0.42 : 1;
        if (w.jumpAir > 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.42)';
          ctx.beginPath();
          ctx.ellipse(w.x, w.y + 10, 14, 7, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        drawPlayerOrb(ctx, w.x, w.y - (hopScale - 1) * 18, 16 * hopScale, active[i].color, i, {
          angle: Math.atan2(w.dirY, w.dirX),
          leader: i === leaderSlot,
          cooldownPct: w.jumpCd / 42,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'COOLING NEW PLATFORM GRID...', '#ff6b2b');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderSlot,
          valueText: `${walkers[i].alive ? 'SAFE' : 'LAVA'} · W${wins[i]}`,
        })),
        `KEEP MOVING: STICK / WASD   ·   JUMP & SHOVE DASH: A / SPACE   ·   ${(roundFrames / 60).toFixed(0)}s`,
      );
    },
  };
}

// 20. CAPTURE THE CROWN (Corner Boost Pads, Shockwave Tackle, Crown Beam Pillar!)
export function createCaptureCrownEngine(): MiniGameEngine {
  const scores = [0, 0, 0, 0];
  const wins = [0, 0, 0, 0];
  const WIN_SCORE = 100;

  const boostPads = [
    { x: 96, y: 122, dx: 1, dy: 0.7 },
    { x: GAME_WIDTH - 96, y: 122, dx: -1, dy: 0.7 },
    { x: 96, y: GAME_HEIGHT - 86, dx: 1, dy: -0.7 },
    { x: GAME_WIDTH - 96, y: GAME_HEIGHT - 86, dx: -1, dy: -0.7 },
  ];

  const makeRacers = () =>
    [0, 1, 2, 3].map((i) => ({
      x: i % 2 === 0 ? 180 : GAME_WIDTH - 180,
      y: i < 2 ? 175 : 405,
      vx: 0,
      vy: 0,
      dashCd: 0,
      shockCd: 0,
      stun: 0,
      padCd: 0,
      prevA: false,
      prevB: false,
      dirX: i % 2 === 0 ? 1 : -1,
      dirY: 0,
    }));

  let racers = makeRacers();
  const crown = { x: GAME_WIDTH / 2, y: 292, vx: 0, vy: 0, holder: -1, grabCd: 0 };
  let banner = '';
  let freeze = 20;

  const resetMatch = () => {
    for (let i = 0; i < 4; i++) scores[i] = 0;
    racers = makeRacers();
    crown.x = GAME_WIDTH / 2;
    crown.y = 292;
    crown.vx = 0;
    crown.vy = 0;
    crown.holder = -1;
    crown.grabCd = 0;
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
        if (crown.grabCd > 0) crown.grabCd--;

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const r = racers[i];
          if (r.stun > 0) {
            r.stun--;
            r.vx *= 0.88;
            r.vy *= 0.88;
            r.x = Math.max(54, Math.min(GAME_WIDTH - 54, r.x + r.vx));
            r.y = Math.max(88, Math.min(GAME_HEIGHT - 50, r.y + r.vy));
            continue;
          }

          let ix = 0;
          let iy = 0;
          let btnA = false;
          let btnB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            btnA = inp.actionA;
            btnB = inp.actionB;
          } else {
            if (crown.holder === i) {
              // Evade NEAREST chaser (was: first enabled slot, often someone across the map)
              let chaser: (typeof racers)[number] | null = null;
              let chaseD = Infinity;
              for (let j = 0; j < 4; j++) {
                if (j === i || !active[j].enabled) continue;
                const dj = Math.hypot(racers[j].x - r.x, racers[j].y - r.y);
                if (dj < chaseD) {
                  chaseD = dj;
                  chaser = racers[j];
                }
              }
              const ang = frame * 0.045 + i * 1.4;
              if (chaser) {
                const dx = r.x - chaser.x;
                const dy = r.y - chaser.y;
                const d = Math.hypot(dx, dy) || 1;
                ix = (dx / d) * 0.65 + Math.cos(ang) * 0.35;
                iy = (dy / d) * 0.65 + Math.sin(ang) * 0.35;
                if (d < 70 && r.shockCd === 0) btnB = true;
              } else {
                ix = Math.cos(ang) * 0.85;
                iy = Math.sin(ang) * 0.85;
              }
            } else {
              const tx = crown.holder >= 0 ? racers[crown.holder].x : crown.x;
              const ty = crown.holder >= 0 ? racers[crown.holder].y : crown.y;
              const d = Math.hypot(tx - r.x, ty - r.y) || 1;
              ix = ((tx - r.x) / d) * 0.88;
              iy = ((ty - r.y) / d) * 0.88;
              if (d < 95 && r.dashCd === 0) btnA = true;
              if (crown.holder >= 0 && d < 78 && r.shockCd === 0) btnB = true;
            }
          }

          if (Math.hypot(ix, iy) > 0.15) {
            const m = Math.hypot(ix, iy);
            r.dirX = ix / m;
            r.dirY = iy / m;
          }

          if (r.dashCd > 0) r.dashCd--;
          if (r.shockCd > 0) r.shockCd--;
          if (r.padCd > 0) r.padCd--;

          const tapA = btnA && !r.prevA;
          const tapB = btnB && !r.prevB;
          r.prevA = btnA;
          r.prevB = btnB;

          if (tapA && r.dashCd === 0 && Math.hypot(ix, iy) > 0.1) {
            r.vx += ix * 11.5;
            r.vy += iy * 11.5;
            r.dashCd = 40;
            vfx.ring(r.x, r.y, active[i].color, 46, 2.5);
            vfx.afterimage(r.x, r.y, 19, active[i].color, 10);
            sound.dash();
          }

          // B: Shockwave Tackle that blasts crown away!
          if (tapB && r.shockCd === 0) {
            r.shockCd = 75;
            vfx.ring(r.x, r.y, '#38bdf8', 95, 4);
            sound.noiseBurst(0.14, 950, 0.14);
            rumble(i, 70, 0.6);
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled) continue;
              const o = racers[j];
              const d = Math.hypot(o.x - r.x, o.y - r.y);
              if (d > 0 && d < 96) {
                const nx = (o.x - r.x) / d;
                const ny = (o.y - r.y) / d;
                o.vx += nx * 13;
                o.vy += ny * 13;
                o.stun = 20;
                vfx.bolt(r.x, r.y, o.x, o.y, '#38bdf8');
                rumble(j, 140, 0.85);
                if (crown.holder === j && crown.grabCd === 0) {
                  crown.holder = -1;
                  crown.grabCd = 24;
                  crown.x = o.x;
                  crown.y = o.y - 14;
                  crown.vx = nx * 8.5 + (Math.random() - 0.5) * 3;
                  crown.vy = ny * 8.5 + (Math.random() - 0.5) * 3;
                  vfx.hitstop(2);
                  vfx.burst(o.x, o.y, '#facc15', 18, 6);
                  vfx.popup(o.x, o.y - 20, 'CROWN BLASTED!', '#facc15', 14);
                  sound.explosion();
                }
              }
            }
          }

          const speedCap = crown.holder === i ? 0.6 : 0.72;
          r.vx = (r.vx + ix * speedCap) * 0.9;
          r.vy = (r.vy + iy * speedCap) * 0.9;
          r.x = Math.max(54, Math.min(GAME_WIDTH - 54, r.x + r.vx));
          r.y = Math.max(88, Math.min(GAME_HEIGHT - 50, r.y + r.vy));

          if (Math.hypot(r.vx, r.vy) > 6 && frame % 2 === 0) {
            vfx.afterimage(r.x, r.y, 18, active[i].color, 8);
          }

          // Corner speed-boost chevron pads
          for (const pad of boostPads) {
            if (r.padCd === 0 && Math.hypot(r.x - pad.x, r.y - pad.y) < 32) {
              r.vx += pad.dx * 11;
              r.vy += pad.dy * 11;
              r.padCd = 28;
              vfx.ring(pad.x, pad.y, '#2ee59d', 54, 3);
              vfx.afterimage(r.x, r.y, 20, '#2ee59d', 12);
              sound.dash();
            }
          }

          if (crown.holder === -1 && crown.grabCd === 0 && Math.hypot(r.x - crown.x, r.y - crown.y) < 32) {
            crown.holder = i;
            crown.vx = 0;
            crown.vy = 0;
            vfx.ring(r.x, r.y, '#facc15', 62, 3);
            vfx.popup(r.x, r.y - 20, 'CROWNED!', '#facc15', 14);
            vfx.burst(r.x, r.y - 20, '#fde047', 12, 4.5);
            sound.pickup(120);
            rumble(i, 60, 0.5);
          }
        }

        // Steal on collision with hitstop
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled) continue;
            const a = racers[i];
            const b = racers[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0 && dist < 40) {
              const nx = dx / dist;
              const ny = dy / dist;
              a.vx -= nx * 6.5;
              a.vy -= ny * 6.5;
              b.vx += nx * 6.5;
              b.vy += ny * 6.5;
              if (crown.holder === i && crown.grabCd === 0) {
                crown.holder = j;
                crown.grabCd = 30;
                a.stun = 18;
                vfx.hitstop(2);
                vfx.burst(b.x, b.y, '#facc15', 18, 6);
                vfx.popup(b.x, b.y - 18, 'STOLEN!', '#facc15', 14);
                vfx.shake(5);
                sound.hit();
                rumble(i, 120, 0.8);
                rumble(j, 60, 0.5);
              } else if (crown.holder === j && crown.grabCd === 0) {
                crown.holder = i;
                crown.grabCd = 30;
                b.stun = 18;
                vfx.hitstop(2);
                vfx.burst(a.x, a.y, '#facc15', 18, 6);
                vfx.popup(a.x, a.y - 18, 'STOLEN!', '#facc15', 14);
                vfx.shake(5);
                sound.hit();
                rumble(j, 120, 0.8);
                rumble(i, 60, 0.5);
              }
            }
          }
        }

        if (crown.holder >= 0) {
          const h = racers[crown.holder];
          crown.x = h.x;
          crown.y = h.y - 26;
          if (frame % 3 === 0) {
            vfx.spark(
              h.x + (Math.random() - 0.5) * 20,
              h.y - 20,
              (Math.random() - 0.5) * 1.2,
              -1.4,
              '#fde047',
              2.8,
            );
          }
          if (frame % 12 === 0) {
            scores[crown.holder] += 2;
            if (scores[crown.holder] >= WIN_SCORE) {
              wins[crown.holder]++;
              banner = `${active[crown.holder].name} CROWN MONARCH!`;
              freeze = 95;
              sound.win();
              vfx.confetti(h.x, h.y, 46);
              vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 26);
              vfx.flash('#facc15', 0.25);
              rumble(crown.holder, 220, 0.6);
            } else if (scores[crown.holder] >= WIN_SCORE - 20) {
              // Final-stretch tension tick
              sound.beep(880 + (scores[crown.holder] - (WIN_SCORE - 20)) * 20, 0.04, 'square', 0.05);
              vfx.ring(h.x, h.y - 26, '#fde047', 30, 2);
            }
          }
        } else {
          crown.x += crown.vx;
          crown.y += crown.vy;
          crown.vx *= 0.94;
          crown.vy *= 0.94;
          if (crown.x < 60 || crown.x > GAME_WIDTH - 60) crown.vx *= -0.8;
          if (crown.y < 92 || crown.y > GAME_HEIGHT - 56) crown.vy *= -0.8;
          crown.x = Math.max(60, Math.min(GAME_WIDTH - 60, crown.x));
          crown.y = Math.max(92, Math.min(GAME_HEIGHT - 56, crown.y));
        }
      }

      drawArcadeBackdrop(ctx, '#facc15');

      // Corner speed-boost chevron pads
      for (const pad of boostPads) {
        ctx.save();
        ctx.translate(pad.x, pad.y);
        ctx.rotate(Math.atan2(pad.dy, pad.dx));
        const glow = 0.55 + Math.sin(frame * 0.14) * 0.25;
        ctx.strokeStyle = `rgba(46, 229, 157, ${glow})`;
        ctx.lineWidth = 3.5;
        for (let k = -1; k <= 1; k++) {
          const ox = k * 9;
          ctx.beginPath();
          ctx.moveTo(ox - 6, -12);
          ctx.lineTo(ox + 6, 0);
          ctx.lineTo(ox - 6, 12);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Glowing crown beam pillar on bearer (or loose crown)
      ctx.save();
      const grad = ctx.createLinearGradient(crown.x, 68, crown.x, crown.y + 30);
      grad.addColorStop(0, 'rgba(250, 204, 21, 0)');
      grad.addColorStop(0.5, 'rgba(250, 204, 21, 0.22)');
      grad.addColorStop(1, 'rgba(250, 204, 21, 0.04)');
      ctx.fillStyle = grad;
      ctx.fillRect(crown.x - 24, 68, 48, crown.y - 38);
      ctx.restore();

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const r = racers[i];
        drawPlayerOrb(ctx, r.x, r.y, 19, active[i].color, i, {
          angle: Math.atan2(r.dirY, r.dirX),
          leader: i === leaderSlot || crown.holder === i,
          cooldownPct: r.shockCd / 75,
        });
      }

      // Draw Crown
      ctx.save();
      ctx.shadowColor = '#facc15';
      ctx.shadowBlur = 22;
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.moveTo(crown.x - 13, crown.y + 7);
      ctx.lineTo(crown.x - 15, crown.y - 7);
      ctx.lineTo(crown.x - 5, crown.y);
      ctx.lineTo(crown.x, crown.y - 10);
      ctx.lineTo(crown.x + 5, crown.y);
      ctx.lineTo(crown.x + 15, crown.y - 7);
      ctx.lineTo(crown.x + 13, crown.y + 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'RESETTING CROWN ARENA...', '#facc15');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: crown.holder === i,
          valueText: `${scores[i]}/${WIN_SCORE} · W${wins[i]}`,
        })),
        'DASH: A / SPACE   ·   SHOCKWAVE TACKLE: B / SHIFT   ·   HIT CORNER PADS!',
      );
    },
  };
}
