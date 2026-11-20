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

// 6. TURBO CIRCUIT (Apex Kerbs, Oil Slicks, Slipstream Draft Sparks, Chevron Boost Pads, Skid Marks, Lap Splits, Confetti)
export function createTurboCircuitEngine(): MiniGameEngine {
  const CX = GAME_WIDTH / 2;
  const CY = 288;
  const RX_OUT = 385;
  const RY_OUT = 184;
  const RX_IN = 215;
  const RY_IN = 78;
  const TOTAL_LAPS = 5;

  const boostPads = [
    { x: CX, y: CY - 132, ang: Math.PI },
    { x: CX - 298, y: CY, ang: Math.PI / 2 },
    { x: CX + 298, y: CY, ang: -Math.PI / 2 },
  ];

  const oilSlicks = [
    { x: CX - 165, y: CY - 114, r: 22 },
    { x: CX + 175, y: CY + 114, r: 22 },
  ];

  const karts = [0, 1, 2, 3].map((i) => ({
    x: CX - 40 - i * 26,
    y: CY + 122 + (i % 2 === 0 ? -16 : 16),
    angle: 0,
    speed: 0,
    lap: 1,
    checkpoint: false,
    boost: 0,
    boostCd: 0,
    spinOut: 0,
    bumpCd: 0,
    prevB: false,
    wins: 0,
  }));

  const skids: Array<{ x1: number; y1: number; x2: number; y2: number; life: number }> = [];
  let winnerBanner = '';
  const COUNTDOWN = 120;
  // First race starts on the console's boot-intro GO; later races get the lights.
  let freeze = 0;

  const resetRace = () => {
    karts.forEach((k, i) => {
      k.x = CX - 40 - i * 26;
      k.y = CY + 122 + (i % 2 === 0 ? -16 : 16);
      k.angle = 0;
      k.speed = 0;
      k.lap = 1;
      k.checkpoint = false;
      k.boost = 0;
      k.boostCd = 0;
      k.spinOut = 0;
      k.bumpCd = 0;
      k.prevB = false;
    });
    skids.length = 0;
    winnerBanner = '';
    freeze = COUNTDOWN;
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
        if (freeze === 0) {
          if (winnerBanner) {
            resetRace();
          } else {
            // Lights out — GO!
            vfx.popup(GAME_WIDTH / 2, CY - 10, 'GO!', '#2ee59d', 30);
            vfx.ring(GAME_WIDTH / 2, CY, '#2ee59d', 170, 5);
            vfx.flash('#2ee59d', 0.12);
            sound.sweep(440, 1320, 0.22, 'square', 0.1);
            for (let i = 0; i < 4; i++) if (active[i].enabled) rumble(i, 90, 0.6);
          }
        } else if (!winnerBanner && (freeze + 1) % 40 === 0) {
          sound.beep(440, 0.1, 'square', 0.09);
        }
      } else {
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const k = karts[i];
          let steer = 0;
          let accel = false;
          let pressB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            steer = inp.x;
            accel = inp.actionA || inp.y < -0.25 || Math.abs(inp.x) > 0.2;
            pressB = inp.actionB;
          } else {
            const theta = Math.atan2((k.y - CY) / 132, (k.x - CX) / 300);
            const targetTheta = theta - 0.26;
            const tx = CX + Math.cos(targetTheta) * (300 + (i - 1.5) * 14);
            const ty = CY + Math.sin(targetTheta) * (132 + (i - 1.5) * 10);
            const desired = Math.atan2(ty - k.y, tx - k.x);
            let diff = desired - k.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            steer = Math.max(-1, Math.min(1, diff * 2.4));
            accel = true;
            if (k.boostCd === 0 && Math.abs(diff) < 0.25 && Math.random() < 0.03) pressB = true;
          }

          const boostEdge = pressB && !k.prevB;
          k.prevB = pressB;

          if (k.boost > 0) k.boost--;
          if (k.boostCd > 0) k.boostCd--;
          if (k.spinOut > 0) k.spinOut--;
          if (k.bumpCd > 0) k.bumpCd--;

          if (boostEdge && k.boostCd === 0) {
            k.boost = 44;
            k.boostCd = 95;
            sound.dash();
            vfx.ring(k.x, k.y, active[i].color, 48, 2.8);
            vfx.burst(k.x - Math.cos(k.angle) * 12, k.y - Math.sin(k.angle) * 12, active[i].color, 10, 4.5, 2.8);
            rumble(i, 60, 0.45);
          }

          // Chevron boost pads
          for (const pad of boostPads) {
            if (Math.hypot(k.x - pad.x, k.y - pad.y) < 26 && k.boost < 28) {
              k.boost = 38;
              k.speed = 7.6;
              vfx.burst(pad.x, pad.y, '#2ee59d', 12, 5);
              vfx.ring(pad.x, pad.y, '#2ee59d', 46, 2.5);
              vfx.popup(k.x, k.y - 12, 'TURBO!', '#2ee59d', 12);
              sound.pickup(160);
              rumble(i, 55, 0.4);
            }
          }

          // Oil slick puddles
          for (const oil of oilSlicks) {
            if (Math.hypot(k.x - oil.x, k.y - oil.y) < oil.r && k.spinOut === 0) {
              k.spinOut = 26;
              k.speed *= 0.72;
              vfx.popup(k.x, k.y - 14, 'OIL SLIP!', '#c084fc', 12);
              sound.sweep(420, 180, 0.16, 'sawtooth', 0.08);
              rumble(i, 90, 0.55);
            }
          }

          // Slipstream draft check behind rivals
          let drafting = false;
          for (let j = 0; j < 4; j++) {
            if (j === i || !active[j].enabled) continue;
            const other = karts[j];
            const dx = other.x - k.x;
            const dy = other.y - k.y;
            const d = Math.hypot(dx, dy);
            if (d > 26 && d < 115) {
              const angTo = Math.atan2(dy, dx);
              let diff = Math.abs(angTo - k.angle);
              while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
              if (diff < 0.35 && other.speed > 3.2) {
                drafting = true;
                break;
              }
            }
          }

          if (k.spinOut > 0) {
            k.angle += 0.24;
          } else {
            k.angle += steer * 0.068;
          }

          const maxSpd = k.boost > 12 ? 7.5 : drafting ? 5.9 : 4.85;
          if (accel) k.speed = Math.min(maxSpd, k.speed + (drafting ? 0.28 : 0.21));
          else k.speed *= 0.94;

          const prevX = k.x;
          const prevY = k.y;
          k.x += Math.cos(k.angle) * k.speed;
          k.y += Math.sin(k.angle) * k.speed;

          // Tire skid marks on hard drift or oil slip
          if ((Math.abs(steer) > 0.65 || k.spinOut > 0) && k.speed > 2.8) {
            skids.push({ x1: prevX, y1: prevY, x2: k.x, y2: k.y, life: 45 });
            if (skids.length > 180) skids.shift();
          }

          if (drafting && frame % 2 === 0) {
            vfx.spark(
              k.x + (Math.random() - 0.5) * 14,
              k.y + (Math.random() - 0.5) * 14,
              -Math.cos(k.angle) * 2.4,
              -Math.sin(k.angle) * 2.4,
              '#38bdf8',
              2.5,
            );
          }

          // Nitro / Boost-Pad afterimage & glowing speed-line particles
          if (k.boost > 10) {
            if (frame % 2 === 0) {
              vfx.afterimage(k.x, k.y, 13, active[i].color, 10);
            }
            const side = (frame % 2 === 0 ? 1 : -1) * (8 + Math.random() * 6);
            const px = -Math.sin(k.angle) * side;
            const py = Math.cos(k.angle) * side;
            vfx.spark(
              k.x - Math.cos(k.angle) * 14 + px,
              k.y - Math.sin(k.angle) * 14 + py,
              -Math.cos(k.angle) * 5.2,
              -Math.sin(k.angle) * 5.2,
              frame % 4 < 2 ? '#2ee59d' : '#ffffff',
              3.2,
            );
          } else if (Math.abs(steer) > 0.65 && frame % 2 === 0) {
            vfx.spark(
              k.x - Math.cos(k.angle) * 14,
              k.y - Math.sin(k.angle) * 14,
              -Math.cos(k.angle) * 1.6,
              -Math.sin(k.angle) * 1.6,
              '#facc15',
              3,
            );
          }

          const normOut = ((k.x - CX) / RX_OUT) ** 2 + ((k.y - CY) / RY_OUT) ** 2;
          const normIn = ((k.x - CX) / RX_IN) ** 2 + ((k.y - CY) / RY_IN) ** 2;
          if (normOut > 1 || normIn < 1) {
            k.speed *= 0.72;
            if (normOut > 1) {
              const s = 1 / Math.sqrt(normOut);
              k.x = CX + (k.x - CX) * s;
              k.y = CY + (k.y - CY) * s;
            } else {
              const s = 1 / Math.sqrt(normIn || 0.01);
              k.x = CX + (k.x - CX) * s;
              k.y = CY + (k.y - CY) * s;
            }
            // Barrier scrape sparks (throttled)
            if (frame % 3 === 0 && k.speed > 1.5) {
              const sx = (k.x - CX) * (normOut > 1 ? 1 : -1);
              const sy = (k.y - CY) * (normOut > 1 ? 1 : -1);
              const sl = Math.hypot(sx, sy) || 1;
              vfx.spark(k.x + (sx / sl) * 9, k.y + (sy / sl) * 9, -Math.cos(k.angle) * 2.6, -Math.sin(k.angle) * 2.6, '#facc15', 2.6);
            }
            rumble(i, 45, 0.35);
          }

          if (k.y < CY - 55 && Math.abs(k.x - CX) < 65) {
            k.checkpoint = true;
          }
          if (k.checkpoint && k.y > CY + 55 && k.x >= CX - 14 && k.x <= CX + 30) {
            k.checkpoint = false;
            k.lap++;
            sound.combo(k.lap);
            const lapLabel =
              k.lap > TOTAL_LAPS ? 'FINISH!' : k.lap === TOTAL_LAPS ? 'FINAL LAP!' : `LAP ${k.lap}!`;
            vfx.popup(k.x, k.y - 16, lapLabel, active[i].color, 15);
            if (k.lap === TOTAL_LAPS) {
              vfx.ring(k.x, k.y, '#facc15', 60, 3);
              rumble(i, 70, 0.5);
            }
            if (k.lap > TOTAL_LAPS && !winnerBanner) {
              k.wins++;
              winnerBanner = `${active[i].name} WINS GP!`;
              freeze = 130;
              sound.win();
              vfx.flash(active[i].color, 0.25);
              vfx.shake(6);
              vfx.ring(k.x, k.y, active[i].color, 140, 5);
              vfx.confetti(CX, CY + 120, 50);
              vfx.confetti(CX, CY - 120, 30);
              rumble(i, 260, 1);
            }
          }
        }

        // Kart-to-kart slam bumps
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled) continue;
            const a = karts[i];
            const b = karts[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d > 0.01 && d < 24) {
              const nx = dx / d;
              const ny = dy / d;
              const overlap = (24 - d) * 0.65;
              a.x -= nx * overlap;
              a.y -= ny * overlap;
              b.x += nx * overlap;
              b.y += ny * overlap;
              if (a.bumpCd === 0 && b.bumpCd === 0 && (a.speed > 3.2 || b.speed > 3.2)) {
                a.bumpCd = 18;
                b.bumpCd = 18;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                if (a.boost > b.boost) {
                  b.speed *= 0.65;
                  vfx.popup(mx, my - 14, 'SLAM!', active[i].color, 13);
                } else if (b.boost > a.boost) {
                  a.speed *= 0.65;
                  vfx.popup(mx, my - 14, 'SLAM!', active[j].color, 13);
                } else {
                  a.speed *= 0.85;
                  b.speed *= 0.85;
                }
                vfx.hitstop(2);
                vfx.shake(5.5);
                vfx.burst(mx, my, '#facc15', 14, 5.2, 3);
                vfx.ring(mx, my, '#ffffff', 38, 2.5);
                sound.hit();
                rumble(i, 75, 0.65);
                rumble(j, 75, 0.65);
              }
            }
          }
        }
      }

      // Compute race leader
      let leaderIdx = -1;
      let bestProgress = -1;
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const k = karts[i];
        const ang = Math.atan2((k.y - CY) / RY_IN, (k.x - CX) / RX_IN);
        const prog = k.lap * 10 + (k.checkpoint ? 5 : 0) + ((Math.PI - ang) / (Math.PI * 2));
        if (prog > bestProgress) {
          bestProgress = prog;
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#ff6b2b');

      // Track surface + Red/White Apex Kerbs
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.ellipse(CX, CY, RX_OUT + 2, RY_OUT + 2, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([16, 16]);
      ctx.beginPath();
      ctx.ellipse(CX, CY, RX_OUT + 2, RY_OUT + 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#151923';
      ctx.beginPath();
      ctx.ellipse(CX, CY, RX_OUT, RY_OUT, 0, 0, Math.PI * 2);
      ctx.fill();

      // Inner kerb
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(CX, CY, RX_IN - 2, RY_IN - 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([12, 12]);
      ctx.beginPath();
      ctx.ellipse(CX, CY, RX_IN - 2, RY_IN - 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#090b10';
      ctx.beginPath();
      ctx.ellipse(CX, CY, RX_IN - 4, RY_IN - 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Checkered Finish Line with crisp animated shimmer
      const squares = 8;
      const lineH = (RY_OUT - RY_IN) / squares;
      const shimmerPos = ((frame * 0.06) % (squares + 4)) - 2;
      for (let s = 0; s < squares; s++) {
        ctx.fillStyle = s % 2 === 0 ? '#ffffff' : '#0b0d12';
        ctx.fillRect(CX - 6, CY + RY_IN + s * lineH, 6, lineH);
        ctx.fillStyle = s % 2 === 1 ? '#ffffff' : '#0b0d12';
        ctx.fillRect(CX, CY + RY_IN + s * lineH, 6, lineH);
        const dist = Math.abs(s - shimmerPos);
        if (dist < 1.6) {
          ctx.fillStyle = `rgba(250, 204, 21, ${(1 - dist / 1.6) * 0.65})`;
          ctx.fillRect(CX - 7, CY + RY_IN + s * lineH, 14, lineH);
        }
      }
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(CX - 7, CY + RY_IN, 14, RY_OUT - RY_IN);
      ctx.restore();

      // Tire Skid Marks
      for (let idx = skids.length - 1; idx >= 0; idx--) {
        const sk = skids[idx];
        sk.life--;
        if (sk.life <= 0) {
          skids.splice(idx, 1);
          continue;
        }
        ctx.strokeStyle = `rgba(15, 18, 26, ${(sk.life / 45) * 0.8})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(sk.x1, sk.y1);
        ctx.lineTo(sk.x2, sk.y2);
        ctx.stroke();
      }

      // Oil Slicks
      for (const oil of oilSlicks) {
        ctx.save();
        ctx.fillStyle = '#0f0a1a';
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(oil.x, oil.y, oil.r, oil.r * 0.72, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Animated Chevron Boost Pads
      for (const pad of boostPads) {
        ctx.save();
        ctx.translate(pad.x, pad.y);
        ctx.rotate(pad.ang);
        ctx.shadowColor = '#2ee59d';
        ctx.shadowBlur = 12;
        ctx.fillStyle = 'rgba(46, 229, 157, 0.22)';
        ctx.strokeStyle = '#2ee59d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-18, -14, 36, 28, 6);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = frame % 20 < 10 ? '#2ee59d' : '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-6, -8);
        ctx.lineTo(2, 0);
        ctx.lineTo(-6, 8);
        ctx.moveTo(4, -8);
        ctx.lineTo(12, 0);
        ctx.lineTo(4, 8);
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const k = karts[i];
        ctx.save();
        ctx.translate(k.x, k.y);
        ctx.rotate(k.angle);
        ctx.shadowColor = active[i].color;
        ctx.shadowBlur = k.boost > 12 ? 22 : 12;
        ctx.fillStyle = active[i].color;
        ctx.beginPath();
        ctx.roundRect(-14, -9, 28, 18, 5);
        ctx.fill();
        ctx.fillStyle = '#0b0d12';
        ctx.fillRect(-10, -10, 6, 3);
        ctx.fillRect(-10, 7, 6, 3);
        ctx.fillRect(5, -10, 6, 3);
        ctx.fillRect(5, 7, 6, 3);
        ctx.fillStyle = '#fff';
        ctx.fillRect(4, -5, 6, 10);
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (winnerBanner) {
        drawRoundBanner(ctx, winnerBanner, 'PREPARING NEXT GRAND PRIX...', '#ff6b2b');
      } else if (freeze > 0) {
        // Starting-light countdown 3-2-1
        const n = Math.ceil(freeze / 40);
        const t = (freeze % 40) / 40;
        ctx.save();
        ctx.translate(GAME_WIDTH / 2, CY);
        ctx.scale(1 + t * 0.35, 1 + t * 0.35);
        ctx.globalAlpha = 0.35 + (1 - t) * 0.65;
        ctx.fillStyle = n === 1 ? '#facc15' : '#ff6b2b';
        ctx.font = '900 64px "Bricolage Grotesque", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(5, 7, 12, 0.9)';
        ctx.strokeText(String(n), 0, 0);
        ctx.fillText(String(n), 0, 0);
        ctx.restore();
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderIdx,
          valueText: `LAP ${Math.min(karts[i].lap, TOTAL_LAPS)}/${TOTAL_LAPS} · W${karts[i].wins}`,
        })),
        'STEER: LEFT/RIGHT  ·  GAS: A / UP / W  ·  TURBO BOOST: B / SHIFT',
      );
    },
  };
}

// 7. COIN RUSH (Double-Jump + B Ground Slam Shockwave, Moving Bounce Pads, +25 Mega Gems, Stomp Hitstop & Combo)
export function createCoinRushEngine(): MiniGameEngine {
  const TARGET_SCORE = 250;
  const platforms = [
    { x: 40, y: 486, w: 880, h: 16 },
    { x: 110, y: 382, w: 220, h: 14 },
    { x: 630, y: 382, w: 220, h: 14 },
    { x: 350, y: 296, w: 260, h: 14 },
    { x: 130, y: 202, w: 190, h: 14 },
    { x: 640, y: 202, w: 190, h: 14 },
  ];

  const bouncePads = [
    { baseX: 250, x: 250, y: 478, range: 110, speed: 0.03, phase: 0 },
    { baseX: 710, x: 710, y: 478, range: 110, speed: 0.03, phase: Math.PI },
  ];

  const runners = [0, 1, 2, 3].map((i) => ({
    x: 160 + i * 200,
    y: 440,
    vx: 0,
    vy: 0,
    onGround: false,
    jumpsLeft: 2,
    slamming: false,
    doubleJumpTrail: 0,
    stompCombo: 0,
    coinStreak: 0,
    coinStreakTimer: 0,
    score: 0,
    wins: 0,
    prevJump: false,
    prevB: false,
    // Brief post-stomp immunity so one runner can't bounce-farm another forever
    stompImmune: 0,
  }));

  // Collected coins re-materialise after a short delay (telegraphed) rather than
  // instantly — instant respawns let a runner hit 250 in ~6 seconds.
  const COIN_RESPAWN = 80;
  const coins = Array.from({ length: 6 }, (_, i) => ({
    x: 150 + i * 132,
    y: i % 2 === 0 ? 165 : 260,
    pulse: i,
    mega: i === 0,
    active: true,
    respawn: 0,
  }));

  let banner = '';
  let freeze = 20;

  const moveCoin = (c: { x: number; y: number }) => {
    const plat = platforms[Math.floor(Math.random() * platforms.length)];
    c.x = plat.x + 25 + Math.random() * (plat.w - 50);
    c.y = plat.y - 26;
  };

  const resetMatch = () => {
    runners.forEach((r, i) => {
      r.x = 160 + i * 200;
      r.y = 440;
      r.vx = 0;
      r.vy = 0;
      r.onGround = false;
      r.jumpsLeft = 2;
      r.slamming = false;
      r.doubleJumpTrail = 0;
      r.stompCombo = 0;
      r.coinStreak = 0;
      r.coinStreakTimer = 0;
      r.score = 0;
      r.stompImmune = 0;
    });
    coins.forEach((c) => {
      moveCoin(c);
      c.active = true;
      c.respawn = 0;
    });
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
        if (freeze === 0 && banner) resetMatch();
      } else {
        for (const bp of bouncePads) {
          bp.x = bp.baseX + Math.sin(frame * bp.speed + bp.phase) * bp.range;
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const r = runners[i];
          if (r.coinStreakTimer > 0) {
            r.coinStreakTimer--;
            if (r.coinStreakTimer === 0) r.coinStreak = 0;
          }
          if (r.doubleJumpTrail > 0) r.doubleJumpTrail--;
          if (r.stompImmune > 0) r.stompImmune--;
          let mx = 0;
          let jumpHeld = false;
          let pressB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            mx = inp.x;
            jumpHeld = inp.actionA || inp.y < -0.45;
            pressB = inp.actionB;
          } else {
            let target: { x: number; y: number } = { x: GAME_WIDTH / 2 + (i - 1.5) * 120, y: 470 };
            let best = Infinity;
            for (const c of coins) {
              if (!c.active) continue;
              const d = Math.hypot(c.x - r.x, c.y - r.y) - (c.mega ? 140 : 0);
              if (d < best) {
                best = d;
                target = c;
              }
            }
            mx = Math.sign(target.x - r.x) * 0.88;
            // Platforms are one-way: when the target is below us, walk off the nearest ledge
            let ledge: (typeof platforms)[0] | undefined;
            if (r.onGround && target.y > r.y + 30) {
              for (let pi = 1; pi < platforms.length; pi++) {
                const pl = platforms[pi];
                if (Math.abs(r.y + 16 - pl.y) < 3 && r.x >= pl.x - 10 && r.x <= pl.x + pl.w + 10) ledge = pl;
              }
            }
            if (ledge) {
              const leftEdge = ledge.x - 16;
              const rightEdge = ledge.x + ledge.w + 16;
              const goLeft = leftEdge > 56 && (rightEdge > GAME_WIDTH - 56 || Math.abs(r.x - leftEdge) < Math.abs(r.x - rightEdge));
              mx = goLeft ? -0.95 : 0.95;
            } else if (target.y < r.y - 24 && r.jumpsLeft > 0 && Math.random() < 0.08) {
              jumpHeld = true;
            }
            // Slam if above a rival
            for (let j = 0; j < 4; j++) {
              if (j !== i && active[j].enabled && !r.onGround && Math.abs(runners[j].x - r.x) < 42 && runners[j].y > r.y + 20) {
                pressB = true;
              }
            }
          }

          const jumpEdge = jumpHeld && !r.prevJump;
          r.prevJump = jumpHeld;
          const bEdge = pressB && !r.prevB;
          r.prevB = pressB;

          r.vx = (r.vx + mx * 0.96) * 0.84;
          // Gravity with a terminal velocity so slams stay readable and never tunnel
          r.vy = Math.min(r.slamming ? 22 : 15, r.vy + (r.slamming ? 1.45 : 0.52));

          // Double Jump
          if (jumpEdge && r.jumpsLeft > 0) {
            const isDouble = r.jumpsLeft === 1;
            r.vy = r.jumpsLeft === 2 ? -12.2 : -10.8;
            r.onGround = false;
            r.slamming = false;
            r.jumpsLeft--;
            if (isDouble) r.doubleJumpTrail = 16;
            vfx.burst(r.x, r.y + 14, active[i].color, isDouble ? 11 : 7, 3.8, 2.6);
            vfx.ring(r.x, r.y + 12, active[i].color, isDouble ? 42 : 34, 2.2);
            sound.beep(isDouble ? 640 + i * 40 : 480 + i * 40, 0.05);
          }

          // Ground Slam
          if (bEdge && !r.onGround && !r.slamming) {
            r.slamming = true;
            r.vy = 14;
            sound.dash();
          }

          if (r.slamming) {
            vfx.afterimage(r.x, r.y, 15, active[i].color, 8);
          } else if (r.doubleJumpTrail > 0 && frame % 2 === 0) {
            vfx.afterimage(r.x, r.y, 13, active[i].color, 9);
          }

          const prevBottom = r.y + 16;
          r.x = Math.max(56, Math.min(GAME_WIDTH - 56, r.x + r.vx));
          r.y += r.vy;
          r.onGround = false;

          if (r.vy >= 0) {
            for (const p of platforms) {
              if (r.x >= p.x - 10 && r.x <= p.x + p.w + 10) {
                if (prevBottom <= p.y + 8 && r.y + 16 >= p.y) {
                  r.y = p.y - 16;
                  r.vy = 0;
                  r.onGround = true;
                  r.jumpsLeft = 2;
                  r.stompCombo = 0;

                  if (r.slamming) {
                    r.slamming = false;
                    vfx.ring(r.x, r.y + 12, active[i].color, 115, 4);
                    vfx.burst(r.x, r.y + 12, active[i].color, 16, 5.5);
                    vfx.shake(7.5);
                    sound.noiseBurst(0.14, 700, 0.14);
                    rumble(i, 95, 0.7);
                    // Knock nearby rivals off platforms & drop coins with shockwave bolt arcs!
                    let slammedAny = false;
                    for (let j = 0; j < 4; j++) {
                      if (j === i || !active[j].enabled) continue;
                      const other = runners[j];
                      const d = Math.hypot(other.x - r.x, other.y - r.y);
                      if (d < 135) {
                        slammedAny = true;
                        const dir = Math.sign(other.x - r.x) || 1;
                        other.vx += dir * 10;
                        other.vy = -8.5;
                        other.onGround = false;
                        vfx.bolt(r.x, r.y + 8, other.x, other.y, active[i].color);
                        vfx.ring(other.x, other.y, '#fb7185', 44, 2.5);
                        if (other.score >= 5) {
                          other.score -= 5;
                          r.score += 5;
                          vfx.popup(other.x, other.y - 18, 'SLAMMED -5!', '#fb7185', 13);
                        }
                        rumble(j, 110, 0.85);
                      }
                    }
                    if (slammedAny) {
                      vfx.hitstop(2);
                    }
                  }
                  break;
                }
              }
            }
          }

          // Moving neon bounce pads
          for (const bp of bouncePads) {
            if (Math.abs(r.x - bp.x) < 34 && Math.abs(r.y + 16 - bp.y) < 16 && r.vy >= 0) {
              r.vy = -16.2;
              r.onGround = false;
              r.jumpsLeft = 1;
              r.slamming = false;
              r.doubleJumpTrail = 14;
              vfx.ring(bp.x, bp.y, '#2ee59d', 48, 3);
              sound.sweep(360, 880, 0.12, 'triangle', 0.1);
            }
          }
        }

        // Head-stomp collisions
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          for (let j = 0; j < 4; j++) {
            if (i === j || !active[j].enabled) continue;
            const a = runners[i];
            const b = runners[j];
            if (b.stompImmune === 0 && a.vy > 1 && Math.abs(a.x - b.x) < 28 && a.y < b.y - 12 && b.y - a.y < 34) {
              a.vy = -10.5;
              a.jumpsLeft = 1;
              a.stompCombo++;
              b.stompImmune = 50;
              // Knock the victim sideways so the stomper doesn't land straight back on them
              b.vx += (b.x >= a.x ? 1 : -1) * 6;
              const steal = Math.min(b.score, 5 + (a.stompCombo - 1) * 5);
              b.score -= steal;
              a.score += 5 + (a.stompCombo - 1) * 5;
              vfx.hitstop(2);
              vfx.burst(b.x, b.y, '#fb7185', 16, 5.5);
              vfx.ring(b.x, b.y, active[i].color, 55, 3);
              vfx.popup(b.x, b.y - 18, `STOMP +${5 + (a.stompCombo - 1) * 5}!`, active[i].color, 15);
              vfx.shake(7);
              sound.combo(a.stompCombo + 1);
              rumble(j, 120, 0.85);
              rumble(i, 60, 0.5);
            }
          }
        }

        // Coin & Mega Gem collection with escalating streak combo
        for (const c of coins) {
          c.pulse += 0.1;
          if (!c.active) {
            c.respawn--;
            if (c.respawn <= 0) {
              c.active = true;
              vfx.ring(c.x, c.y, c.mega ? '#ff6b2b' : '#facc15', 34, 2);
            }
            continue;
          }
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            if (Math.hypot(c.x - runners[i].x, c.y - runners[i].y) < 28) {
              const r = runners[i];
              r.coinStreak = r.coinStreakTimer > 0 ? Math.min(12, r.coinStreak + 1) : 1;
              r.coinStreakTimer = 120;
              const streakBonus = r.coinStreak >= 3 ? Math.min(10, (r.coinStreak - 2) * 5) : 0;
              const pts = (c.mega ? 25 : 10) + streakBonus;
              r.score += pts;
              vfx.burst(c.x, c.y, c.mega ? '#ff6b2b' : '#fde047', c.mega ? 22 : 11, 5.2);
              if (r.coinStreak >= 2 || c.mega) {
                vfx.ring(c.x, c.y, c.mega ? '#ff6b2b' : '#facc15', c.mega ? 54 : 38, 2.5);
              }
              const label = c.mega
                ? `+${pts} GEM!`
                : r.coinStreak >= 2
                  ? `+${pts} x${r.coinStreak}`
                  : `+${pts}`;
              vfx.popup(c.x, c.y - 12, label, c.mega ? '#ff6b2b' : '#fde047', c.mega ? 16 : r.coinStreak >= 3 ? 15 : 13);
              if (c.mega || r.coinStreak >= 2) {
                sound.combo(c.mega ? Math.max(4, r.coinStreak + 2) : r.coinStreak);
              } else {
                sound.pickup(i * 65);
              }
              rumble(i, c.mega ? 70 : 30, c.mega ? 0.6 : 0.3);
              moveCoin(c);
              c.active = false;
              c.respawn = COIN_RESPAWN + Math.floor(Math.random() * 40);
              break;
            }
          }
        }

        // First-to-250 victory
        // First-to-250: if two cross on the same frame, the higher score takes it
        let coinWinner = -1;
        for (let i = 0; i < 4; i++) {
          if (active[i].enabled && runners[i].score >= TARGET_SCORE) {
            if (coinWinner < 0 || runners[i].score > runners[coinWinner].score) coinWinner = i;
          }
        }
        if (coinWinner >= 0 && !banner) {
          const i = coinWinner;
          runners[i].wins++;
          banner = `${active[i].name} WINS!`;
          freeze = 125;
          sound.win();
          vfx.flash(active[i].color, 0.25);
          vfx.shake(6);
          vfx.ring(runners[i].x, runners[i].y, active[i].color, 130, 5);
          vfx.confetti(runners[i].x, runners[i].y, 48);
          vfx.confetti(GAME_WIDTH / 2, 120, 30);
          rumble(i, 260, 1);
        }
      }

      let leaderIdx = -1;
      let topPts = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && runners[i].score > topPts) {
          topPts = runners[i].score;
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#facc15');

      // Platforms with crisp drop shadows
      for (const p of platforms) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.roundRect(p.x + 4, p.y + 6, p.w, p.h, 6);
        ctx.fill();

        ctx.fillStyle = '#1f2636';
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(p.x, p.y, p.w, p.h, 6);
        ctx.fill();
        ctx.stroke();
      }

      // Moving Bounce Pads
      for (const bp of bouncePads) {
        ctx.save();
        ctx.shadowColor = '#2ee59d';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#2ee59d';
        ctx.beginPath();
        ctx.roundRect(bp.x - 26, bp.y - 4, 52, 8, 4);
        ctx.fill();
        ctx.restore();
      }

      // Coins & +25 Mega Diamond Gems
      for (const c of coins) {
        if (!c.active) {
          // Re-materialise telegraph
          const t = Math.max(0, Math.min(1, c.respawn / COIN_RESPAWN));
          if (t < 0.6) {
            ctx.save();
            ctx.globalAlpha = 0.2 + (0.6 - t) * 0.7;
            ctx.strokeStyle = c.mega ? '#ff6b2b' : '#facc15';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.arc(c.x, c.y, 8 + t * 22, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
          continue;
        }
        const cy = c.y + Math.sin(c.pulse) * 3.5;
        ctx.save();
        ctx.shadowColor = c.mega ? '#ff6b2b' : '#facc15';
        ctx.shadowBlur = c.mega ? 22 : 14;
        if (c.mega) {
          ctx.translate(c.x, cy);
          ctx.rotate(c.pulse * 0.4);
          ctx.fillStyle = '#ff6b2b';
          ctx.beginPath();
          ctx.moveTo(0, -14);
          ctx.lineTo(12, 0);
          ctx.lineTo(0, 14);
          ctx.lineTo(-12, 0);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(c.x, cy, 10, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const r = runners[i];
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(r.x, r.y + 17, 13, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        if (i === leaderIdx) {
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(r.x, r.y, 23, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.shadowColor = active[i].color;
        ctx.shadowBlur = r.slamming ? 26 : 16;
        if (r.stompImmune > 0 && frame % 6 < 3) ctx.globalAlpha = 0.45;
        ctx.fillStyle = r.slamming ? '#ffffff' : active[i].color;
        ctx.beginPath();
        ctx.roundRect(r.x - 14, r.y - 16, 28, 32, 8);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#0b0d12';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`P${i + 1}`, r.x, r.y + 4);
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, `FIRST TO ${TARGET_SCORE} PTS! NEXT ROUND...`, '#facc15');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderIdx,
          valueText: `${runners[i].score} · W${runners[i].wins}`,
        })),
        'RUN: LEFT/RIGHT  ·  DOUBLE JUMP: A / SPACE  ·  GROUND SLAM: B / SHIFT',
      );
    },
  };
}

// 8. TANK DUEL (Destructible Cover Crates, Triple-Spread & Proximity Mines, Recoil & Laser Preview, Smart Bank-Shot AI, Hitstop)
export function createTankDuelEngine(): MiniGameEngine {
  const walls = [
    { x: 230, y: 170, w: 34, h: 190 },
    { x: 696, y: 170, w: 34, h: 190 },
    { x: 420, y: 136, w: 120, h: 30 },
    { x: 420, y: 382, w: 120, h: 30 },
  ];

  const scores = [0, 0, 0, 0];
  let tanks = [0, 1, 2, 3].map((i) => ({
    x: i % 2 === 0 ? 110 : GAME_WIDTH - 110,
    y: i < 2 ? 140 : GAME_HEIGHT - 100,
    angle: i % 2 === 0 ? 0 : Math.PI,
    alive: true,
    cd: 0,
    recoil: 0,
    spreadAmmo: 0,
    mines: 1,
    prevA: false,
    prevB: false,
    aimOffset: 0,
    navX: 0,
    navY: 0,
    navTimer: 0,
    seeFrames: 0,
  }));

  type Crate = { x: number; y: number; w: number; h: number; hp: number };
  type Pickup = { x: number; y: number; kind: 'spread' | 'mine'; pulse: number };
  type Mine = { x: number; y: number; owner: number; armFrames: number };
  let crates: Crate[] = [];
  let pickups: Pickup[] = [];
  let mines: Mine[] = [];
  // age: frames since fired — a fresh shell can't hit its own tank (point-blank wall shots)
  let shells: Array<{ x: number; y: number; vx: number; vy: number; owner: number; bounces: number; age: number }> = [];
  let banner = '';
  let freeze = 20;
  // Stalemate backstop: a round that drags past this ends as a draw
  const ROUND_TICKS = 60 * 60;
  let roundTicks = 0;

  const spawnCrates = () => {
    crates = [
      { x: 330, y: 268, w: 32, h: 32, hp: 2 },
      { x: 598, y: 268, w: 32, h: 32, hp: 2 },
      { x: 464, y: 204, w: 32, h: 32, hp: 2 },
      { x: 464, y: 318, w: 32, h: 32, hp: 2 },
      { x: 120, y: 268, w: 32, h: 32, hp: 2 },
      { x: 808, y: 268, w: 32, h: 32, hp: 2 },
    ];
  };

  const resetRound = () => {
    tanks = [0, 1, 2, 3].map((i) => ({
      x: i % 2 === 0 ? 110 : GAME_WIDTH - 110,
      y: i < 2 ? 140 : GAME_HEIGHT - 100,
      angle: i % 2 === 0 ? 0 : Math.PI,
      alive: true,
      cd: 20,
      recoil: 0,
      spreadAmmo: 0,
      mines: 1,
      prevA: false,
      prevB: false,
      aimOffset: 0,
      navX: 0,
      navY: 0,
      navTimer: 0,
      seeFrames: 0,
    }));
    shells = [];
    pickups = [];
    mines = [];
    spawnCrates();
    banner = '';
    freeze = 20;
    roundTicks = 0;
  };
  spawnCrates();

  const hitsRect = (x: number, y: number, r: number, rect: { x: number; y: number; w: number; h: number }) =>
    x + r > rect.x && x - r < rect.x + rect.w && y + r > rect.y && y - r < rect.y + rect.h;

  const hitsObstacle = (x: number, y: number, r: number) =>
    walls.find((w) => hitsRect(x, y, r, w)) || crates.find((c) => hitsRect(x, y, r, c));

  const hasLineOfSight = (x1: number, y1: number, x2: number, y2: number): boolean => {
    const steps = 16;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      if (hitsObstacle(px, py, 4)) return false;
    }
    return true;
  };

  const traceBouncePreview = (sx: number, sy: number, ang: number) => {
    const pts: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];
    let x = sx;
    let y = sy;
    let vx = Math.cos(ang) * 7;
    let vy = Math.sin(ang) * 7;
    let bounced = false;
    for (let step = 0; step < 34; step++) {
      x += vx;
      y += vy;
      if (x < 36 || x > GAME_WIDTH - 36) {
        pts.push({ x, y });
        if (bounced) break;
        vx *= -1;
        bounced = true;
      } else if (y < 72 || y > GAME_HEIGHT - 36) {
        pts.push({ x, y });
        if (bounced) break;
        vy *= -1;
        bounced = true;
      } else {
        const obs = hitsObstacle(x, y, 4);
        if (obs) {
          pts.push({ x, y });
          if (bounced) break;
          if (Math.abs(x - (obs.x + obs.w / 2)) / obs.w > Math.abs(y - (obs.y + obs.h / 2)) / obs.h) vx *= -1;
          else vy *= -1;
          bounced = true;
        }
      }
    }
    pts.push({ x, y });
    return pts;
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
        if (freeze === 0 && banner) resetRound();
      } else {
        for (const pk of pickups) pk.pulse += 0.1;

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !tanks[i].alive) continue;
          const t = tanks[i];
          let mx = 0, my = 0, pressA = false, pressB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            mx = inp.x;
            my = inp.y;
            pressA = inp.actionA;
            pressB = inp.actionB;
          } else {
            // Smart bot: find closest alive target, check LOS or aim toward target/crate
            let target: (typeof tanks)[0] | undefined;
            let bestDist = Infinity;
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled || !tanks[j].alive) continue;
              const d = Math.hypot(tanks[j].x - t.x, tanks[j].y - t.y);
              if (d < bestDist) {
                bestDist = d;
                target = tanks[j];
              }
            }
            if (target) {
              const dx = target.x - t.x;
              const dy = target.y - t.y;
              const d = Math.hypot(dx, dy) || 1;
              const clear = hasLineOfSight(t.x, t.y, target.x, target.y);
              t.seeFrames = clear ? t.seeFrames + 1 : 0;
              if (clear) {
                // Human-like aim: turret slews at a limited rate with a slowly drifting error
                t.aimOffset = Math.max(-0.16, Math.min(0.16, t.aimOffset + (Math.random() - 0.5) * 0.05));
                const desired = Math.atan2(dy, dx) + t.aimOffset;
                let diff = desired - t.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                t.angle += Math.max(-0.11, Math.min(0.11, diff));
                mx = Math.cos(t.angle) * 0.45;
                my = Math.sin(t.angle) * 0.45;
                // ~0.3s reaction time after acquiring a target, then a modest trigger rate
                if (t.cd === 0 && t.seeFrames > 18 && Math.abs(diff) < 0.14 && Math.random() < 0.07) pressA = true;
              } else {
                // No line of sight: navigate to a sampled waypoint that can see the target
                t.navTimer--;
                if (t.navTimer <= 0 || Math.hypot(t.navX - t.x, t.navY - t.y) < 14) {
                  let bestCost = Infinity;
                  t.navX = t.x;
                  t.navY = t.y;
                  for (let k = 0; k < 14; k++) {
                    const px = 70 + Math.random() * (GAME_WIDTH - 140);
                    const py = 100 + Math.random() * (GAME_HEIGHT - 170);
                    if (hitsObstacle(px, py, 22)) continue;
                    const sees = hasLineOfSight(px, py, target.x, target.y);
                    const reach = hasLineOfSight(t.x, t.y, px, py);
                    const cost = Math.hypot(px - t.x, py - t.y) + (sees ? 0 : 900) + (reach ? 0 : 400);
                    if (cost < bestCost) {
                      bestCost = cost;
                      t.navX = px;
                      t.navY = py;
                    }
                  }
                  t.navTimer = 80;
                }
                const nx = t.navX - t.x;
                const ny = t.navY - t.y;
                const nd = Math.hypot(nx, ny) || 1;
                mx = (nx / nd) * 0.85;
                my = (ny / nd) * 0.85;
                if (t.cd === 0 && Math.random() < 0.02) pressA = true;
              }
              if (t.mines > 0 && bestDist < 120 && Math.random() < 0.02) pressB = true;
            }
          }

          const fireEdge = pressA && !t.prevA;
          t.prevA = pressA;
          const mineEdge = pressB && !t.prevB;
          t.prevB = pressB;

          if (t.recoil > 0) t.recoil *= 0.8;
          if (t.cd > 0) t.cd--;

          if (Math.hypot(mx, my) > 0.15) {
            t.angle = Math.atan2(my, mx);
            const nx = Math.max(54, Math.min(GAME_WIDTH - 54, t.x + mx * 3.1));
            if (!hitsObstacle(nx, t.y, 17)) t.x = nx;
            const ny = Math.max(88, Math.min(GAME_HEIGHT - 54, t.y + my * 3.1));
            if (!hitsObstacle(t.x, ny, 17)) t.y = ny;
          }

          // Collect pickups
          for (let pIdx = pickups.length - 1; pIdx >= 0; pIdx--) {
            const pk = pickups[pIdx];
            if (Math.hypot(pk.x - t.x, pk.y - t.y) < 26) {
              if (pk.kind === 'spread') {
                t.spreadAmmo += 3;
                vfx.popup(t.x, t.y - 16, 'TRIPLE SPREAD!', '#facc15', 13);
              } else {
                t.mines += 2;
                vfx.popup(t.x, t.y - 16, '+2 MINES!', '#c084fc', 13);
              }
              sound.pickup(140);
              pickups.splice(pIdx, 1);
            }
          }

          // Drop proximity mine
          if (mineEdge && t.mines > 0) {
            t.mines--;
            mines.push({ x: t.x, y: t.y, owner: i, armFrames: 36 });
            sound.beep(360, 0.06, 'sine');
          }

          // Fire shell(s) with recoil, muzzle flash ring & casing sparks
          if (fireEdge && t.cd === 0) {
            const angles = t.spreadAmmo > 0 ? [t.angle - 0.22, t.angle, t.angle + 0.22] : [t.angle];
            if (t.spreadAmmo > 0) t.spreadAmmo--;
            for (const a of angles) {
              const sx = t.x + Math.cos(a) * 24;
              const sy = t.y + Math.sin(a) * 24;
              shells.push({
                x: sx,
                y: sy,
                vx: Math.cos(a) * 7.0,
                vy: Math.sin(a) * 7.0,
                owner: i,
                bounces: 2,
                age: 0,
              });
            }
            t.cd = 28;
            t.recoil = 7;
            const muzzleX = t.x + Math.cos(t.angle) * 24;
            const muzzleY = t.y + Math.sin(t.angle) * 24;
            // Shell casing spark ejecting sideways
            vfx.spark(
              t.x,
              t.y,
              Math.cos(t.angle + Math.PI / 2) * 3.2,
              Math.sin(t.angle + Math.PI / 2) * 3.2,
              '#facc15',
              3,
            );
            vfx.ring(muzzleX, muzzleY, '#facc15', 28, 2.6);
            vfx.burst(muzzleX, muzzleY, active[i].color, 8, 4.0, 2.5);
            sound.beep(290 + i * 40, 0.06, 'square');
            rumble(i, 50, 0.45);
          }
        }

        // Keep tanks from stacking on top of each other
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !tanks[i].alive) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled || !tanks[j].alive) continue;
            const a = tanks[i];
            const b = tanks[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d > 0.01 && d < 34) {
              const push = (34 - d) / 2;
              const nx = dx / d;
              const ny = dy / d;
              const ax = Math.max(54, Math.min(GAME_WIDTH - 54, a.x - nx * push));
              const ay = Math.max(88, Math.min(GAME_HEIGHT - 54, a.y - ny * push));
              const bx = Math.max(54, Math.min(GAME_WIDTH - 54, b.x + nx * push));
              const by = Math.max(88, Math.min(GAME_HEIGHT - 54, b.y + ny * push));
              if (!hitsObstacle(ax, ay, 17)) {
                a.x = ax;
                a.y = ay;
              }
              if (!hitsObstacle(bx, by, 17)) {
                b.x = bx;
                b.y = by;
              }
            }
          }
        }

        // Proximity Mines
        for (let mIdx = mines.length - 1; mIdx >= 0; mIdx--) {
          const m = mines[mIdx];
          if (m.armFrames > 0) {
            m.armFrames--;
            continue;
          }
          let detonated = false;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || !tanks[i].alive || i === m.owner) continue;
            if (Math.hypot(m.x - tanks[i].x, m.y - tanks[i].y) < 34) {
              tanks[i].alive = false;
              scores[m.owner]++;
              detonated = true;
              vfx.hitstop(3);
              vfx.burst(m.x, m.y, '#c084fc', 30, 8);
              vfx.ring(m.x, m.y, '#c084fc', 90, 4);
              vfx.popup(tanks[i].x, tanks[i].y - 18, 'MINED!', '#c084fc', 16);
              vfx.shake(12);
              sound.explosion();
              rumble(i, 190, 0.95);
              rumble(m.owner, 120, 0.7);
              break;
            }
          }
          if (detonated) mines.splice(mIdx, 1);
        }

        // Shells
        shells = shells.filter((s) => {
          s.age++;
          const preX = s.x;
          const preY = s.y;
          s.x += s.vx;
          s.y += s.vy;
          if (frame % 2 === 0 || s.bounces < 2) {
            vfx.afterimage(s.x, s.y, s.bounces < 2 ? 5.2 : 4.2, active[s.owner].color, 8);
          }
          let bounced = false;
          if (s.x < 36 || s.x > GAME_WIDTH - 36) {
            s.vx *= -1;
            s.x = Math.max(36, Math.min(GAME_WIDTH - 36, s.x));
            s.bounces--;
            bounced = true;
          }
          if (s.y < 72 || s.y > GAME_HEIGHT - 36) {
            s.vy *= -1;
            s.y = Math.max(72, Math.min(GAME_HEIGHT - 36, s.y));
            s.bounces--;
            bounced = true;
          }

          // Check crate hit first
          for (let cIdx = crates.length - 1; cIdx >= 0; cIdx--) {
            const c = crates[cIdx];
            if (hitsRect(s.x, s.y, 5, c)) {
              c.hp--;
              vfx.burst(c.x + c.w / 2, c.y + c.h / 2, '#facc15', 10, 4.5);
              sound.hit();
              if (c.hp <= 0) {
                crates.splice(cIdx, 1);
                pickups.push({
                  x: c.x + c.w / 2,
                  y: c.y + c.h / 2,
                  kind: Math.random() < 0.55 ? 'spread' : 'mine',
                  pulse: 0,
                });
              }
              return false;
            }
          }

          const w = walls.find((wl) => hitsRect(s.x, s.y, 5, wl));
          if (w) {
            // Reflect on the axis we actually entered from, and back out of the wall
            const hitX = hitsRect(s.x, preY, 5, w);
            const hitY = hitsRect(preX, s.y, 5, w);
            if (hitX && !hitY) s.vx *= -1;
            else if (hitY && !hitX) s.vy *= -1;
            else {
              s.vx *= -1;
              s.vy *= -1;
            }
            s.x = preX;
            s.y = preY;
            s.bounces--;
            bounced = true;
          }
          if (bounced) {
            vfx.ring(s.x, s.y, active[s.owner].color, 22, 2);
            vfx.burst(s.x, s.y, active[s.owner].color, 6, 3.4, 2.2);
            sound.beep(660, 0.03);
          }

          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || !tanks[i].alive) continue;
            if (i === s.owner && s.age < 14) continue;
            if (Math.hypot(s.x - tanks[i].x, s.y - tanks[i].y) < 20) {
              tanks[i].alive = false;
              if (s.owner !== i) {
                scores[s.owner]++;
                vfx.popup(tanks[i].x, tanks[i].y - 34, `+1 ${active[s.owner].name}`, active[s.owner].color, 12);
              }
              vfx.hitstop(3);
              vfx.burst(tanks[i].x, tanks[i].y, active[i].color, 28, 7.5);
              vfx.ring(tanks[i].x, tanks[i].y, '#4ade80', 84, 4);
              vfx.popup(tanks[i].x, tanks[i].y - 16, 'BOOM!', '#ff6b2b', 16);
              vfx.shake(11);
              sound.explosion();
              rumble(i, 180, 0.95);
              if (s.owner !== i) rumble(s.owner, 120, 0.7);
              return false;
            }
          }
          return s.bounces >= 0;
        });

        roundTicks++;
        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && tanks[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if (total > 1 && alive.length > 1 && roundTicks === ROUND_TICKS - 600) {
          vfx.popup(GAME_WIDTH / 2, 120, '10 SECONDS LEFT!', '#facc15', 18);
          sound.beep(660, 0.12, 'triangle', 0.1);
        }
        if (total > 1 && alive.length > 1 && roundTicks >= ROUND_TICKS) {
          banner = 'STALEMATE — DRAW!';
          sound.sweep(520, 180, 0.3, 'triangle', 0.1);
          freeze = 85;
        } else if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          if (alive.length === 1) {
            const w = alive[0];
            scores[w]++;
            banner = `${active[w].name} VICTORY!`;
            sound.win();
            vfx.flash(active[w].color, 0.24);
            vfx.ring(tanks[w].x, tanks[w].y, active[w].color, 130, 5);
            vfx.confetti(tanks[w].x, tanks[w].y, 40);
            vfx.confetti(GAME_WIDTH / 2, 140, 28);
            rumble(w, 260, 1);
          } else {
            banner = 'MUTUAL DESTRUCTION!';
          }
          freeze = 85;
        }
      }

      let leaderIdx = -1;
      let maxS = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && scores[i] > maxS) {
          maxS = scores[i];
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#4ade80');

      for (const w of walls) {
        ctx.fillStyle = '#1b222f';
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(w.x, w.y, w.w, w.h, 6);
        ctx.fill();
        ctx.stroke();
      }

      // Destructible Crates
      for (const c of crates) {
        ctx.save();
        ctx.fillStyle = c.hp === 2 ? '#78350f' : '#9a3412';
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(c.x, c.y, c.w, c.h, 5);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c.x + 4, c.y + 4);
        ctx.lineTo(c.x + c.w - 4, c.y + c.h - 4);
        ctx.moveTo(c.x + c.w - 4, c.y + 4);
        ctx.lineTo(c.x + 4, c.y + c.h - 4);
        ctx.stroke();
        ctx.restore();
      }

      // Pickups
      for (const pk of pickups) {
        const col = pk.kind === 'spread' ? '#facc15' : '#c084fc';
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 16;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 10 + Math.sin(pk.pulse) * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0b0d12';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(pk.kind === 'spread' ? '3X' : 'M', pk.x, pk.y + 3.5);
        ctx.restore();
      }

      // Mines
      for (const m of mines) {
        ctx.save();
        ctx.fillStyle = m.armFrames > 0 ? '#64748b' : frame % 12 < 6 ? '#c084fc' : '#ef4444';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // Laser bounce trail previews & crisp glowing barrel sight dots for alive tanks
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !tanks[i].alive) continue;
        const t = tanks[i];
        const pts = traceBouncePreview(t.x + Math.cos(t.angle) * 20, t.y + Math.sin(t.angle) * 20, t.angle);
        ctx.save();
        ctx.strokeStyle = active[i].color;
        ctx.globalAlpha = 0.24;
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        pts.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        ctx.stroke();
        ctx.setLineDash([]);

        // Laser sight dots extending slightly from tank barrel
        for (let dot = 1; dot <= 4; dot++) {
          const dist = 24 + dot * 13 + ((frame * 0.6) % 13);
          const dx = t.x + Math.cos(t.angle) * dist;
          const dy = t.y + Math.sin(t.angle) * dist;
          if (hitsObstacle(dx, dy, 3) || dx < 36 || dx > GAME_WIDTH - 36 || dy < 72 || dy > GAME_HEIGHT - 36) break;
          ctx.globalAlpha = 0.85 - dot * 0.14;
          ctx.fillStyle = dot === 1 ? '#ffffff' : active[i].color;
          ctx.beginPath();
          ctx.arc(dx, dy, 2.6 - dot * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Shells: additive colour halo + white-hot core (no per-shell shadowBlur)
      if (shells.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        for (const s of shells) {
          ctx.fillStyle = active[s.owner].color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        ctx.fillStyle = '#fff';
        for (const s of shells) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !tanks[i].alive) continue;
        const t = tanks[i];
        ctx.save();
        ctx.translate(t.x - Math.cos(t.angle) * t.recoil * 0.35, t.y - Math.sin(t.angle) * t.recoil * 0.35);
        ctx.rotate(t.angle);
        ctx.shadowColor = active[i].color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = active[i].color;
        ctx.beginPath();
        ctx.roundRect(-15, -14, 30, 28, 5);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(6 - t.recoil * 0.5, -3, 18, 6);
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'DEPLOYING NEXT SQUAD...', '#4ade80');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderIdx,
          valueText: `${tanks[i].alive ? 'OK' : 'KO'} · ${scores[i]}pt`,
        })),
        'DRIVE & AIM: STICK / WASD  ·  FIRE: A / SPACE  ·  DROP MINE: B / SHIFT',
      );
    },
  };
}

// 9. SPACE BLASTERS (Parallax Starfield + Nebula, Zig-Zag Interceptors, Cruisers, Mini-Boss Saucer, Homing & Spread, Overdrive, 75s Match)
export function createSpaceBlastersEngine(): MiniGameEngine {
  const MATCH_TICKS = 75 * 60;
  const SPREAD_CD = 26;
  const makePilot = (i: number) => ({
    x: 180 + i * 200,
    y: GAME_HEIGHT - 64,
    score: 0,
    cd: 0,
    spreadCd: 0,
    prevB: false,
    weapon: 'laser' as 'laser' | 'spread' | 'homing',
    weaponTimer: 0,
    overdrive: 0,
    overdriveActive: 0,
    killStreak: 0,
    killStreakTimer: 0,
  });
  const pilots = [0, 1, 2, 3].map(makePilot);
  const wins = [0, 0, 0, 0];

  const bgStars = Array.from({ length: 65 }, (_, i) => ({
    x: Math.random() * GAME_WIDTH,
    y: 68 + Math.random() * (GAME_HEIGHT - 102),
    layer: i % 3,
    spd: 0.45 + (i % 3) * 0.9,
  }));

  type Bullet = { x: number; y: number; vx: number; vy: number; owner: number; homing: boolean; powered: boolean };
  type Alien = { x: number; y: number; vx: number; vy: number; hp: number; maxHp: number; kind: 'interceptor' | 'cruiser' | 'saucer'; phase: number; shieldFlash: number };
  type PowerOrb = { x: number; y: number; vy: number; kind: 'spread' | 'homing' };

  const bullets: Bullet[] = [];
  const aliens: Alien[] = [];
  const drops: PowerOrb[] = [];
  let saucerCd = 420;
  let ticksLeft = MATCH_TICKS;
  let freeze = 40;
  let banner = '';
  let bannerSub = '';

  const resetMatch = () => {
    for (let i = 0; i < 4; i++) Object.assign(pilots[i], makePilot(i));
    bullets.length = 0;
    aliens.length = 0;
    drops.length = 0;
    saucerCd = 420;
    ticksLeft = MATCH_TICKS;
    banner = '';
    bannerSub = '';
    freeze = 40;
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
        if (freeze === 0 && banner) resetMatch();
      } else {
        ticksLeft = Math.max(0, ticksLeft - 1);
        if (ticksLeft > 0 && ticksLeft <= 300 && ticksLeft % 60 === 0) {
          const sec = ticksLeft / 60;
          vfx.popup(GAME_WIDTH / 2, 150, `${sec}!`, sec <= 2 ? '#fb7185' : '#facc15', 22);
          sound.beep(sec <= 2 ? 880 : 660, 0.08, 'triangle', 0.12);
        }

        // Spawn waves
        if (frame % 24 === 0 && aliens.length < 22) {
          const isCruiser = Math.random() < 0.25;
          aliens.push({
            x: 70 + Math.random() * (GAME_WIDTH - 140),
            y: 78,
            vx: (Math.random() - 0.5) * 2.8,
            vy: isCruiser ? 0.72 : 1.35 + Math.random() * 0.9,
            hp: isCruiser ? 4 : 1,
            maxHp: isCruiser ? 4 : 1,
            kind: isCruiser ? 'cruiser' : 'interceptor',
            phase: Math.random() * Math.PI * 2,
            shieldFlash: 0,
          });
        }

        saucerCd--;
        if (saucerCd <= 0 && !aliens.some((a) => a.kind === 'saucer')) {
          saucerCd = 650;
          aliens.push({
            x: 80,
            y: 102,
            vx: 2.3,
            vy: 0,
            hp: 14,
            maxHp: 14,
            kind: 'saucer',
            phase: 0,
            shieldFlash: 0,
          });
          vfx.popup(GAME_WIDTH / 2, 128, 'BOSS SAUCER INBOUND!', '#fb7185', 16);
          sound.sweep(220, 620, 0.25, 'sawtooth', 0.1);
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const p = pilots[i];
          if (p.killStreakTimer > 0) {
            p.killStreakTimer--;
            if (p.killStreakTimer === 0) p.killStreak = 0;
          }
          let mx = 0;
          let fire = false;
          let pressB = false;
          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            mx = inp.x;
            fire = inp.actionA;
            pressB = inp.actionB;
          } else {
            // Track a low drop first, otherwise the boss / lowest alien
            const targetDrop = drops[0];
            if (targetDrop && targetDrop.y > 260) {
              mx = Math.sign(targetDrop.x - p.x) * 0.85;
            } else {
              // Each bot works its own lane (urgency = how low the alien is, minus lane distance)
              // so CPU pilots don't all stack on one alien and let slot order decide every kill
              const laneX = 180 + i * 200;
              let target: Alien | undefined;
              let bestVal = -Infinity;
              for (const a of aliens) {
                const val = (a.kind === 'saucer' ? 260 : a.kind === 'cruiser' ? 60 : 0) + a.y - Math.abs(a.x - laneX) * 0.8;
                if (val > bestVal) {
                  bestVal = val;
                  target = a;
                }
              }
              mx = target ? Math.max(-1, Math.min(1, (target.x - p.x) / 30)) * 0.85 : 0;
              fire = Boolean(target && Math.abs(target.x - p.x) < 55);
              pressB = Boolean(
                target && target.kind !== 'interceptor' && Math.abs(target.x - p.x) < 80 && Math.random() < 0.15,
              );
            }
            if (p.overdrive >= 100) pressB = !p.prevB;
          }

          // B: Overdrive when the meter is full, otherwise a triple-spread volley
          const bEdge = pressB && !p.prevB;
          p.prevB = pressB;
          if (p.spreadCd > 0) p.spreadCd--;
          if (bEdge && p.overdrive >= 100) {
            p.overdrive = 0;
            p.overdriveActive = 220;
            vfx.ring(p.x, p.y, active[i].color, 72, 3);
            vfx.ring(p.x, p.y, '#facc15', 120, 4);
            vfx.popup(p.x, p.y - 22, 'OVERDRIVE!', '#facc15', 14);
            vfx.flash('#facc15', 0.1);
            sound.combo(6);
            rumble(i, 120, 0.8);
          } else if (bEdge && p.spreadCd === 0 && p.overdriveActive === 0) {
            for (let k = -1; k <= 1; k++) {
              bullets.push({ x: p.x, y: p.y - 16, vx: k * 2.1, vy: -9.5, owner: i, homing: false, powered: true });
            }
            p.spreadCd = SPREAD_CD;
            vfx.afterimage(p.x, p.y - 10, 12, active[i].color, 7);
            sound.beep(520 + i * 40, 0.06, 'square', 0.06);
            rumble(i, 35, 0.3);
          }

          if (p.weaponTimer > 0) {
            p.weaponTimer--;
            if (p.weaponTimer === 0) p.weapon = 'laser';
          }
          if (p.overdriveActive > 0) {
            p.overdriveActive--;
            if (frame % 3 === 0) {
              vfx.afterimage(p.x, p.y, 14, '#facc15', 8);
            }
          }

          p.x = Math.max(58, Math.min(GAME_WIDTH - 58, p.x + mx * (p.overdriveActive > 0 ? 8.2 : 6.6)));
          if (p.cd > 0) p.cd--;

          if ((fire || p.overdriveActive > 0) && p.cd === 0) {
            const isOD = p.overdriveActive > 0;
            if (p.weapon === 'spread' || isOD) {
              for (let k = -1; k <= 1; k++) {
                bullets.push({ x: p.x, y: p.y - 16, vx: k * 2.1, vy: -9.5, owner: i, homing: false, powered: true });
              }
              vfx.afterimage(p.x, p.y - 10, 12, isOD ? '#facc15' : active[i].color, 7);
              p.cd = isOD ? 8 : 14;
            } else if (p.weapon === 'homing') {
              bullets.push({ x: p.x - 8, y: p.y - 16, vx: -1, vy: -8.5, owner: i, homing: true, powered: true });
              bullets.push({ x: p.x + 8, y: p.y - 16, vx: 1, vy: -8.5, owner: i, homing: true, powered: true });
              p.cd = 14;
            } else {
              bullets.push({ x: p.x, y: p.y - 16, vx: 0, vy: -10.5, owner: i, homing: false, powered: false });
              p.cd = 9;
            }
            sound.beep(680 + i * 40, 0.04, 'triangle', 0.06);
          }
        }

        // Drops (in-place compaction)
        let keepD = 0;
        for (let dIdx = 0; dIdx < drops.length; dIdx++) {
          const d = drops[dIdx];
          d.y += d.vy;
          let taken = false;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            if (Math.hypot(d.x - pilots[i].x, d.y - pilots[i].y) < 26) {
              pilots[i].weapon = d.kind;
              pilots[i].weaponTimer = 360;
              vfx.ring(pilots[i].x, pilots[i].y, '#2ee59d', 48, 2.5);
              vfx.popup(pilots[i].x, pilots[i].y - 18, d.kind === 'spread' ? 'TRIPLE SPREAD!' : 'HOMING MISSILES!', '#2ee59d', 13);
              sound.pickup(200);
              rumble(i, 50, 0.4);
              taken = true;
              break;
            }
          }
          if (!taken && d.y < GAME_HEIGHT - 34) drops[keepD++] = d;
        }
        drops.length = keepD;

        // Bullets (in-place compaction)
        let keepB = 0;
        for (let bIdx = 0; bIdx < bullets.length; bIdx++) {
          const b = bullets[bIdx];
          if (b.homing && aliens.length > 0) {
            let nearest = aliens[0];
            let best = Infinity;
            for (const a of aliens) {
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              if (d < best) {
                best = d;
                nearest = a;
              }
            }
            const ang = Math.atan2(nearest.y - b.y, nearest.x - b.x);
            b.vx = b.vx * 0.85 + Math.cos(ang) * 9.5 * 0.15;
            b.vy = b.vy * 0.85 + Math.sin(ang) * 9.5 * 0.15;
            if ((frame + bIdx) % 2 === 0) vfx.spark(b.x, b.y, -b.vx * 0.2, -b.vy * 0.2, '#facc15', 2);
          }

          b.x += b.vx;
          b.y += b.vy;
          if (b.powered && (frame + bIdx) % 3 === 0) {
            vfx.afterimage(b.x, b.y, 4.5, b.homing ? '#facc15' : active[b.owner].color, 7);
          }
          let hit = false;
          for (let aIdx = aliens.length - 1; aIdx >= 0; aIdx--) {
            const a = aliens[aIdx];
            const hitR = a.kind === 'saucer' ? 30 : a.kind === 'cruiser' ? 21 : 14;
            if (Math.hypot(b.x - a.x, b.y - a.y) < hitR) {
              a.hp--;
              const ownerPilot = pilots[b.owner];
              ownerPilot.overdrive = Math.min(100, ownerPilot.overdrive + 6);
              if (a.hp <= 0) {
                ownerPilot.killStreak = ownerPilot.killStreakTimer > 0 ? Math.min(14, ownerPilot.killStreak + 1) : 1;
                ownerPilot.killStreakTimer = 95;
                const chainBonus = ownerPilot.killStreak >= 3 ? Math.min(20, (ownerPilot.killStreak - 2) * 5) : 0;
                const pts = (a.kind === 'saucer' ? 120 : a.kind === 'cruiser' ? 35 : 10) + chainBonus;
                ownerPilot.score += pts;
                const wasFull = ownerPilot.overdrive >= 100;
                ownerPilot.overdrive = Math.min(100, ownerPilot.overdrive + (a.kind === 'saucer' ? 40 : 12));
                if (!wasFull && ownerPilot.overdrive >= 100) {
                  vfx.popup(ownerPilot.x, ownerPilot.y - 30, 'OVERDRIVE READY (B)', '#facc15', 12);
                  sound.beep(1320, 0.08, 'triangle', 0.07);
                }
                const col = a.kind === 'saucer' ? '#fb7185' : a.kind === 'cruiser' ? '#ff6b2b' : '#c084fc';
                vfx.burst(a.x, a.y, col, a.kind === 'saucer' ? 36 : 16, 6.5);
                vfx.ring(a.x, a.y, col, a.kind === 'saucer' ? 95 : 44, 3);
                const popText =
                  a.kind === 'saucer'
                    ? `+${pts} BOSS!`
                    : ownerPilot.killStreak >= 3
                      ? `+${pts} x${ownerPilot.killStreak}`
                      : `+${pts}`;
                vfx.popup(a.x, a.y - 12, popText, active[b.owner].color, a.kind === 'saucer' ? 18 : ownerPilot.killStreak >= 3 ? 15 : 13);
                if (a.kind === 'saucer') {
                  vfx.hitstop(3);
                  vfx.shake(10);
                  vfx.flash('#fb7185', 0.16);
                  vfx.confetti(a.x, a.y, 40);
                  sound.explosion();
                  sound.win();
                  rumble(b.owner, 200, 1);
                } else if (a.kind === 'cruiser') {
                  vfx.shake(4);
                  sound.explosion();
                  if (ownerPilot.killStreak >= 2) sound.combo(ownerPilot.killStreak);
                  if (Math.random() < 0.55) {
                    drops.push({ x: a.x, y: a.y, vy: 1.8, kind: Math.random() < 0.5 ? 'spread' : 'homing' });
                  }
                  rumble(b.owner, 90, 0.65);
                } else {
                  if (ownerPilot.killStreak >= 2) {
                    sound.combo(ownerPilot.killStreak);
                  } else {
                    sound.pickup(180);
                  }
                  if (Math.random() < 0.08) {
                    drops.push({ x: a.x, y: a.y, vy: 1.8, kind: Math.random() < 0.5 ? 'spread' : 'homing' });
                  }
                  rumble(b.owner, 45, 0.4);
                }
                aliens.splice(aIdx, 1);
              } else {
                a.shieldFlash = 8;
                if (a.kind === 'cruiser') {
                  // Distinct metallic shield-hit sparks on armored cruisers
                  vfx.ring(b.x, b.y, '#38bdf8', 26, 2.2);
                  for (let sp = 0; sp < 5; sp++) {
                    const ang = Math.atan2(b.y - a.y, b.x - a.x) + (Math.random() - 0.5) * 1.4;
                    const spd = 2.8 + Math.random() * 3.4;
                    vfx.spark(b.x, b.y, Math.cos(ang) * spd, Math.sin(ang) * spd, sp % 2 === 0 ? '#38bdf8' : '#ffffff', 2.8);
                  }
                  sound.beep(980, 0.035, 'square', 0.07);
                } else {
                  vfx.burst(b.x, b.y, active[b.owner].color, 6, 3.2, 2.2);
                  sound.hit();
                }
              }
              hit = true;
              break;
            }
          }
          if (!hit && b.y > 62 && b.x > 34 && b.x < GAME_WIDTH - 34) bullets[keepB++] = b;
        }
        bullets.length = keepB;

        // Aliens movement (in-place compaction, hard side bounds so wobblers can't get stuck)
        let keepA = 0;
        for (let aIdx = 0; aIdx < aliens.length; aIdx++) {
          const a = aliens[aIdx];
          a.phase += 0.08;
          if (a.shieldFlash > 0) a.shieldFlash--;
          if (a.kind === 'interceptor') {
            a.x += a.vx + Math.sin(a.phase) * 2.2;
          } else {
            a.x += a.vx;
          }
          a.y += a.vy;
          if (a.x < 54) {
            a.x = 54;
            a.vx = Math.abs(a.vx);
          } else if (a.x > GAME_WIDTH - 54) {
            a.x = GAME_WIDTH - 54;
            a.vx = -Math.abs(a.vx);
          }
          if (a.y < GAME_HEIGHT - 38) aliens[keepA++] = a;
        }
        aliens.length = keepA;

        if (ticksLeft === 0 && !banner) {
          let w = -1;
          let tied = false;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            if (w < 0 || pilots[i].score > pilots[w].score) {
              w = i;
              tied = false;
            } else if (pilots[i].score === pilots[w].score) {
              tied = true;
            }
          }
          freeze = 150;
          if (w < 0 || tied) {
            banner = 'DRAW!';
            bannerSub = 'DEAD-EVEN SCORES · NEXT SORTIE...';
            sound.sweep(520, 180, 0.3, 'triangle', 0.1);
          } else {
            wins[w]++;
            banner = `${active[w].name} ACE PILOT!`;
            bannerSub = `${pilots[w].score} PTS · NEXT SORTIE...`;
            sound.win();
            vfx.flash(active[w].color, 0.25);
            vfx.shake(6);
            vfx.ring(pilots[w].x, pilots[w].y, active[w].color, 140, 5);
            vfx.confetti(GAME_WIDTH / 2, 150, 50);
            vfx.confetti(pilots[w].x, pilots[w].y - 20, 30);
            rumble(w, 260, 1);
          }
        }
      }

      let leaderIdx = -1;
      let maxS = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && pilots[i].score > maxS) {
          maxS = pilots[i].score;
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#38bdf8');

      // Nebula glow
      const neb = ctx.createRadialGradient(GAME_WIDTH * 0.35, 220, 20, GAME_WIDTH * 0.35, 220, 240);
      neb.addColorStop(0, 'rgba(192, 132, 252, 0.14)');
      neb.addColorStop(1, 'rgba(192, 132, 252, 0)');
      ctx.fillStyle = neb;
      ctx.fillRect(30, 68, GAME_WIDTH - 60, GAME_HEIGHT - 102);

      // 3-layer parallax starfield (batched by layer)
      for (let layer = 0; layer < 3; layer++) {
        ctx.fillStyle = layer === 2 ? 'rgba(255,255,255,0.6)' : layer === 1 ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.22)';
        const sz = layer === 2 ? 2.6 : 1.6;
        for (const st of bgStars) {
          if (st.layer !== layer) continue;
          st.y += st.spd;
          if (st.y > GAME_HEIGHT - 34) st.y = 68;
          ctx.fillRect(st.x, st.y, sz, sz);
        }
      }

      // Weapon drops
      for (const d of drops) {
        ctx.save();
        ctx.shadowColor = '#2ee59d';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#2ee59d';
        ctx.beginPath();
        ctx.arc(d.x, d.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0b0d12';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(d.kind === 'spread' ? '3X' : 'H', d.x, d.y + 3.5);
        ctx.restore();
      }

      // Alien glow halos in one additive pass (replaces per-alien shadowBlur)
      if (aliens.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18;
        for (const a of aliens) {
          if (a.kind === 'saucer') continue;
          ctx.fillStyle = a.kind === 'cruiser' ? (a.shieldFlash > 0 ? '#38bdf8' : '#ff6b2b') : '#c084fc';
          ctx.beginPath();
          ctx.arc(a.x, a.y, a.kind === 'cruiser' ? 30 : 20, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Aliens
      for (const a of aliens) {
        ctx.save();
        ctx.translate(a.x, a.y);
        if (a.kind === 'saucer') {
          ctx.shadowColor = '#fb7185';
          ctx.shadowBlur = 22;
          ctx.fillStyle = a.shieldFlash > 0 ? '#ffffff' : '#fb7185';
          ctx.beginPath();
          ctx.ellipse(0, 0, 30, 12, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(0, -5, 11, Math.PI, 0);
          ctx.fill();
          // Boss HP bar
          const hpRatio = Math.max(0, a.hp / a.maxHp);
          const hpCol = hpRatio > 0.5 ? '#2ee59d' : hpRatio > 0.25 ? '#facc15' : '#fb7185';
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(10,12,20,0.85)';
          ctx.beginPath();
          ctx.roundRect(-28, -24, 56, 7, 3);
          ctx.fill();
          ctx.fillStyle = hpCol;
          ctx.beginPath();
          ctx.roundRect(-27, -23, Math.max(2, 54 * hpRatio), 5, 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.65)';
          ctx.lineWidth = 1;
          ctx.strokeRect(-28, -24, 56, 7);
        } else if (a.kind === 'cruiser') {
          ctx.fillStyle = a.shieldFlash > 0 ? '#ffb38a' : '#ff6b2b';
          ctx.beginPath();
          ctx.roundRect(-18, -14, 36, 28, 6);
          ctx.fill();
          if (a.shieldFlash > 0) {
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.8;
            ctx.beginPath();
            ctx.roundRect(-21, -17, 42, 34, 8);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(-14, -20, 28, 4);
          ctx.fillStyle = '#facc15';
          ctx.fillRect(-14, -20, 28 * (a.hp / a.maxHp), 4);
        } else {
          ctx.fillStyle = '#c084fc';
          ctx.beginPath();
          ctx.moveTo(0, 13);
          ctx.lineTo(-12, -10);
          ctx.lineTo(12, -10);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // Bullets: additive streak glow + solid core, no shadowBlur
      if (bullets.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.3;
        for (const b of bullets) {
          ctx.fillStyle = b.homing ? '#facc15' : active[b.owner].color;
          ctx.fillRect(b.x - 5, b.y - 10, 10, 20);
        }
        ctx.restore();
        for (const b of bullets) {
          ctx.fillStyle = b.homing ? '#facc15' : active[b.owner].color;
          ctx.fillRect(b.x - 2.5, b.y - 7, 5, 14);
        }
      }

      // Player Jets with Thruster Plumes & Overdrive Bar
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const p = pilots[i];
        ctx.save();
        // Thruster plume (deterministic flicker)
        ctx.fillStyle = p.overdriveActive > 0 ? '#facc15' : '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y + 12);
        ctx.lineTo(p.x, p.y + 20 + (Math.sin(frame * 0.9 + i * 1.7) * 0.5 + 0.5) * 8);
        ctx.lineTo(p.x + 5, p.y + 12);
        ctx.closePath();
        ctx.fill();

        ctx.shadowColor = active[i].color;
        ctx.shadowBlur = p.overdriveActive > 0 ? 26 : 16;
        ctx.fillStyle = active[i].color;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 18);
        ctx.lineTo(p.x - 16, p.y + 12);
        ctx.lineTo(p.x - 5, p.y + 8);
        ctx.lineTo(p.x + 5, p.y + 8);
        ctx.lineTo(p.x + 16, p.y + 12);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y - 3, 4, 0, Math.PI * 2);
        ctx.fill();

        // Overdrive meter bar below ship (pulses when ready)
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(p.x - 16, p.y + 16, 32, 3);
        const ready = p.overdrive >= 100 && p.overdriveActive === 0;
        ctx.fillStyle = ready ? (frame % 20 < 10 ? '#facc15' : '#ffffff') : '#2ee59d';
        ctx.fillRect(p.x - 16, p.y + 16, 32 * (p.overdriveActive > 0 ? p.overdriveActive / 220 : p.overdrive / 100), 3);
        ctx.restore();
      }

      // Match timer pill
      ctx.save();
      ctx.fillStyle = 'rgba(11, 13, 18, 0.88)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(GAME_WIDTH / 2 - 40, 68, 80, 22, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ticksLeft < 600 ? '#fb7185' : '#38bdf8';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(ticksLeft / 60)}s`, GAME_WIDTH / 2, 83);
      ctx.restore();

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
          valueText: `${pilots[i].score}${pilots[i].overdrive >= 100 ? ' ⚡' : ''} · W${wins[i]}`,
        })),
        'PILOT: STICK / WASD  ·  LASER: A / SPACE  ·  SPREAD: B / SHIFT (FULL METER = OVERDRIVE)',
      );
    },
  };
}

// 10. COLOR TURF (Smooth Roller Trails, A Paint Bomb Lob + B Splat Shockwave, Live Territory Bar, Golden Frenzy Bucket, 45s Confetti)
export function createColorTurfEngine(): MiniGameEngine {
  const CELL = 24;
  const COLS = 36;
  const ROWS = 18;
  const OX = (GAME_WIDTH - COLS * CELL) / 2;
  const OY = 74;

  const grid = new Int8Array(COLS * ROWS);
  grid.fill(-1);

  const makePainter = (i: number) => ({
    x: i % 2 === 0 ? OX + 60 : OX + COLS * CELL - 60,
    y: i < 2 ? OY + 60 : OY + ROWS * CELL - 60,
    angle: 0,
    bombCd: 0,
    splatCd: 0,
    dashFrames: 0,
    frenzyFrames: 0,
    prevA: false,
    prevB: false,
    // Bot navigation target (cell centre) + retarget timer
    tx: GAME_WIDTH / 2,
    ty: OY + (ROWS * CELL) / 2,
    retarget: 0,
  });
  let painters = [0, 1, 2, 3].map(makePainter);
  const counts = [0, 0, 0, 0];
  const recount = () => {
    counts[0] = counts[1] = counts[2] = counts[3] = 0;
    for (let k = 0; k < grid.length; k++) {
      const v = grid[k];
      if (v >= 0) counts[v]++;
    }
  };
  const ownerAt = (x: number, y: number) => {
    const c = Math.floor((x - OX) / CELL);
    const r = Math.floor((y - OY) / CELL);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -2;
    return grid[r * COLS + c];
  };

  type Bomb = { x: number; y: number; vx: number; vy: number; life: number; owner: number };
  let bombs: Bomb[] = [];
  let bucket = { x: GAME_WIDTH / 2, y: OY + (ROWS * CELL) / 2, active: true, respawn: 0 };
  let ticksLeft = 45 * 60;
  let winner = '';
  let freeze = 0;

  const reset = () => {
    grid.fill(-1);
    painters = [0, 1, 2, 3].map(makePainter);
    bombs = [];
    bucket = { x: GAME_WIDTH / 2, y: OY + (ROWS * CELL) / 2, active: true, respawn: 0 };
    ticksLeft = 45 * 60;
    winner = '';
    freeze = 0;
  };

  const paintRadius = (cx: number, cy: number, cellRad: number, owner: number) => {
    const col = Math.floor((cx - OX) / CELL);
    const row = Math.floor((cy - OY) / CELL);
    for (let dr = -cellRad; dr <= cellRad; dr++) {
      for (let dc = -cellRad; dc <= cellRad; dc++) {
        if (Math.abs(dr) + Math.abs(dc) > cellRad + 1) continue;
        const rr = row + dr;
        const cc = col + dc;
        if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) {
          grid[rr * COLS + cc] = owner;
        }
      }
    }
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
        if (freeze === 0) reset();
      } else {
        ticksLeft = Math.max(0, ticksLeft - 1);

        // Dramatic final-5-second countdown pulse tick
        if (ticksLeft > 0 && ticksLeft <= 300 && ticksLeft % 60 === 0) {
          const sec = ticksLeft / 60;
          vfx.popup(GAME_WIDTH / 2, 136, `${sec}!`, sec <= 2 ? '#fb7185' : '#facc15', 22);
          vfx.ring(GAME_WIDTH / 2, 128, sec <= 2 ? '#fb7185' : '#facc15', 90, 3);
          sound.beep(sec <= 2 ? 880 : 660, 0.08, 'triangle', 0.12);
        }

        if (!bucket.active) {
          bucket.respawn--;
          if (bucket.respawn <= 0) {
            bucket.x = OX + 60 + Math.random() * (COLS * CELL - 120);
            bucket.y = OY + 60 + Math.random() * (ROWS * CELL - 120);
            bucket.active = true;
          }
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const p = painters[i];
          let ix = 0, iy = 0, pressA = false, pressB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            pressA = inp.actionA;
            pressB = inp.actionB;
          } else {
            // Turf-aware bot: steer toward promising unpainted / rival cells, grab nearby buckets
            p.retarget--;
            if (p.retarget <= 0 || Math.hypot(p.tx - p.x, p.ty - p.y) < 18) {
              let bestVal = -Infinity;
              for (let s = 0; s < 14; s++) {
                const c = Math.floor(Math.random() * COLS);
                const r = Math.floor(Math.random() * ROWS);
                const owner = grid[r * COLS + c];
                const cx = OX + c * CELL + CELL / 2;
                const cy = OY + r * CELL + CELL / 2;
                const val =
                  (owner === i ? -60 : owner === -1 ? 30 : 42) - Math.hypot(cx - p.x, cy - p.y) * 0.09 + Math.random() * 6;
                if (val > bestVal) {
                  bestVal = val;
                  p.tx = cx;
                  p.ty = cy;
                }
              }
              p.retarget = 50 + Math.floor(Math.random() * 30);
            }
            let gx = p.tx;
            let gy = p.ty;
            if (bucket.active && Math.hypot(bucket.x - p.x, bucket.y - p.y) < 240) {
              gx = bucket.x;
              gy = bucket.y;
            }
            const dx = gx - p.x;
            const dy = gy - p.y;
            const d = Math.hypot(dx, dy) || 1;
            ix = (dx / d) * 0.92;
            iy = (dy / d) * 0.92;
            // Lob a bomb when its landing zone (~170px ahead) isn't ours yet
            if (p.bombCd === 0 && Math.random() < 0.08) {
              const lo = ownerAt(p.x + Math.cos(p.angle) * 170, p.y + Math.sin(p.angle) * 170);
              if (lo !== i && lo !== -2) pressA = true;
            }
            if (p.splatCd === 0 && ownerAt(p.x, p.y) !== i && Math.random() < 0.03) pressB = true;
          }

          const bombEdge = pressA && !p.prevA;
          p.prevA = pressA;
          const splatEdge = pressB && !p.prevB;
          p.prevB = pressB;

          if (Math.hypot(ix, iy) > 0.15) {
            p.angle = Math.atan2(iy, ix);
          }

          if (p.bombCd > 0) p.bombCd--;
          if (p.splatCd > 0) p.splatCd--;
          if (p.dashFrames > 0) p.dashFrames--;
          if (p.frenzyFrames > 0) p.frenzyFrames--;

          const spd = p.dashFrames > 0 ? 8.8 : p.frenzyFrames > 0 ? 6.5 : 5.1;
          const moveX = p.dashFrames > 0 ? Math.cos(p.angle) : ix;
          const moveY = p.dashFrames > 0 ? Math.sin(p.angle) : iy;
          p.x = Math.max(OX + 12, Math.min(OX + COLS * CELL - 12, p.x + moveX * spd));
          p.y = Math.max(OY + 12, Math.min(OY + ROWS * CELL - 12, p.y + moveY * spd));

          if (p.dashFrames > 0 || (p.frenzyFrames > 0 && frame % 2 === 0 && Math.hypot(ix, iy) > 0.2)) {
            vfx.afterimage(p.x, p.y, 15, p.frenzyFrames > 0 ? '#facc15' : active[i].color, 10);
          }

          // Golden Paint-Frenzy Bucket
          if (bucket.active && Math.hypot(p.x - bucket.x, p.y - bucket.y) < 26) {
            bucket.active = false;
            bucket.respawn = 320;
            p.frenzyFrames = 240;
            vfx.ring(bucket.x, bucket.y, '#facc15', 70, 3);
            vfx.burst(bucket.x, bucket.y, '#facc15', 18, 5.5);
            vfx.popup(bucket.x, bucket.y - 14, 'PAINT FRENZY!', '#facc15', 15);
            sound.combo(4);
            rumble(i, 80, 0.6);
          }

          // A: Lob Paint Bomb forward
          if (bombEdge && p.bombCd === 0) {
            p.bombCd = 65;
            bombs.push({
              x: p.x,
              y: p.y,
              vx: Math.cos(p.angle) * 7.2,
              vy: Math.sin(p.angle) * 7.2,
              life: 24,
              owner: i,
            });
            sound.dash();
          }

          // B: Paint Dash + Radial Splat Shockwave
          if (splatEdge && p.splatCd === 0) {
            p.splatCd = 80;
            p.dashFrames = 10;
            paintRadius(p.x, p.y, 2, i);
            vfx.afterimage(p.x, p.y, 17, active[i].color, 11);
            vfx.ring(p.x, p.y, active[i].color, 76, 3.5);
            vfx.burst(p.x, p.y, active[i].color, 18, 5.5);
            vfx.shake(4);
            sound.explosion();
            rumble(i, 70, 0.55);
          }

          // Continuous smooth roller trail
          paintRadius(p.x, p.y, p.frenzyFrames > 0 || p.dashFrames > 0 ? 1 : 0, i);
        }

        // Paint bombs in flight
        for (let bIdx = bombs.length - 1; bIdx >= 0; bIdx--) {
          const b = bombs[bIdx];
          b.x = Math.max(OX + 12, Math.min(OX + COLS * CELL - 12, b.x + b.vx));
          b.y = Math.max(OY + 12, Math.min(OY + ROWS * CELL - 12, b.y + b.vy));
          if (frame % 2 === 0) {
            vfx.afterimage(b.x, b.y, 6, active[b.owner].color, 8);
          }
          b.life--;
          if (b.life <= 0) {
            paintRadius(b.x, b.y, 2, b.owner);
            vfx.ring(b.x, b.y, active[b.owner].color, 92, 4.5);
            vfx.ring(b.x, b.y, '#ffffff', 52, 2.5);
            vfx.burst(b.x, b.y, active[b.owner].color, 24, 6.5, 4);
            vfx.shake(4.5);
            sound.hit();
            rumble(b.owner, 65, 0.5);
            bombs.splice(bIdx, 1);
          }
        }

        if (ticksLeft === 0) {
          recount();
          let bestIdx = -1;
          let tied = false;
          for (let idx = 0; idx < 4; idx++) {
            if (!active[idx].enabled) continue;
            if (bestIdx < 0 || counts[idx] > counts[bestIdx]) {
              bestIdx = idx;
              tied = false;
            } else if (counts[idx] === counts[bestIdx]) {
              tied = true;
            }
          }
          freeze = 130;
          if (bestIdx < 0 || tied) {
            winner = 'TURF WAR TIE!';
            sound.sweep(520, 180, 0.3, 'triangle', 0.1);
          } else {
            winner = `${active[bestIdx].name} WINS (${counts[bestIdx]} TILES)`;
            sound.win();
            vfx.flash(active[bestIdx].color, 0.25);
            vfx.shake(6);
            vfx.ring(painters[bestIdx].x, painters[bestIdx].y, active[bestIdx].color, 140, 5);
            vfx.confetti(GAME_WIDTH / 2, 180, 55);
            vfx.confetti(painters[bestIdx].x, painters[bestIdx].y, 26);
            rumble(bestIdx, 260, 1);
          }
        }
      }

      recount();

      let leaderIdx = -1;
      let maxTiles = 0;
      for (let i = 0; i < 4; i++) {
        if (active[i].enabled && counts[i] > maxTiles) {
          maxTiles = counts[i];
          leaderIdx = i;
        }
      }

      drawArcadeBackdrop(ctx, '#c084fc');

      // Batched tile passes: empty tiles, then one pass per painter colour
      const cellTotal = COLS * ROWS;
      ctx.save();
      for (let pass = -1; pass < 4; pass++) {
        if (pass === -1) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#111621';
        } else {
          if (counts[pass] === 0) continue;
          ctx.globalAlpha = 0.77;
          ctx.fillStyle = active[pass].color;
        }
        for (let k = 0; k < cellTotal; k++) {
          if (grid[k] !== pass) continue;
          const c = k % COLS;
          const r = (k - c) / COLS;
          ctx.fillRect(OX + c * CELL + 1, OY + r * CELL + 1, CELL - 2, CELL - 2);
        }
      }
      ctx.restore();

      // Dramatic final-5-second arena border pulse
      if (ticksLeft > 0 && ticksLeft <= 300) {
        const pulse = 0.5 + 0.5 * Math.sin(frame * 0.28);
        ctx.save();
        ctx.strokeStyle = `rgba(251, 113, 133, ${0.35 + pulse * 0.55})`;
        ctx.shadowColor = '#fb7185';
        ctx.shadowBlur = 18 * pulse;
        ctx.lineWidth = 4 + pulse * 3;
        ctx.strokeRect(OX, OY, COLS * CELL, ROWS * CELL);
        ctx.restore();
      }

      // Golden Paint Bucket with glowing animated aura
      if (bucket.active) {
        const auraPulse = 0.5 + 0.5 * Math.sin(frame * 0.14);
        ctx.save();
        const auraGrad = ctx.createRadialGradient(bucket.x, bucket.y, 6, bucket.x, bucket.y, 34 + auraPulse * 8);
        auraGrad.addColorStop(0, 'rgba(250, 204, 21, 0.45)');
        auraGrad.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(bucket.x, bucket.y, 34 + auraPulse * 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(253, 224, 71, ${0.4 + auraPulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bucket.x, bucket.y, 18 + auraPulse * 5, 0, Math.PI * 2);
        ctx.stroke();

        // Orbiting golden sparks
        for (let s = 0; s < 3; s++) {
          const oa = frame * 0.08 + (s * Math.PI * 2) / 3;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(bucket.x + Math.cos(oa) * 20, bucket.y + Math.sin(oa) * 20, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.roundRect(bucket.x - 11, bucket.y - 11, 22, 22, 5);
        ctx.fill();
        ctx.fillStyle = '#0b0d12';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('2X', bucket.x, bucket.y + 4);
        ctx.restore();
      }

      // Flying Paint Bombs
      for (const b of bombs) {
        const arcScale = 1 + Math.sin((b.life / 24) * Math.PI) * 0.6;
        ctx.save();
        ctx.fillStyle = active[b.owner].color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 7 * arcScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const p = painters[i];
        drawPlayerOrb(ctx, p.x, p.y, 15, active[i].color, i, {
          angle: p.angle,
          leader: i === leaderIdx,
          shield: p.frenzyFrames > 0,
          cooldownPct: p.bombCd / 65,
        });
      }

      // Live Territory Percentage Bar at top of arena (y = 58..66)
      const barX = OX;
      const barW = COLS * CELL;
      const totalPainted = counts[0] + counts[1] + counts[2] + counts[3];
      ctx.fillStyle = '#0f1420';
      ctx.fillRect(barX, 60, barW, 8);
      let curX = barX;
      if (totalPainted > 0) {
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || counts[i] === 0) continue;
          const segW = (counts[i] / totalPainted) * barW;
          ctx.fillStyle = active[i].color;
          ctx.fillRect(curX, 60, segW, 8);
          curX += segW;
        }
      }

      // Timer Pill with final-5-second dramatic scale pulse
      const finalFive = ticksLeft > 0 && ticksLeft <= 300;
      const pillScale = finalFive ? 1 + 0.14 * Math.abs(Math.sin(frame * 0.22)) : 1;
      ctx.save();
      ctx.translate(GAME_WIDTH / 2, 86);
      ctx.scale(pillScale, pillScale);
      ctx.fillStyle = finalFive ? 'rgba(136, 19, 55, 0.92)' : 'rgba(11, 13, 18, 0.88)';
      ctx.strokeStyle = finalFive ? '#fb7185' : 'rgba(255,255,255,0.16)';
      ctx.lineWidth = finalFive ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(-42, -12, 84, 24, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ticksLeft < 600 ? '#fb7185' : '#facc15';
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(ticksLeft / 60)}s`, 0, 4);
      ctx.restore();

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (winner) {
        drawRoundBanner(ctx, winner, 'STARTING NEXT TURF BLITZ...', '#c084fc');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderIdx,
          valueText: `${counts[i]} (${totalPainted > 0 ? Math.round((counts[i] / totalPainted) * 100) : 0}%)`,
        })),
        'PAINT: STICK / WASD  ·  PAINT BOMB: A / SPACE  ·  SPLAT SHOCKWAVE: B / SHIFT',
      );
    },
  };
}
