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

// 51. ORBITAL SHIELD (Aim Orbiting Shield & Parry Laser Missiles Back at Rivals!)
export function createOrbitalShieldEngine(): MiniGameEngine {
  const CX = GAME_WIDTH / 2;
  const CY = 288;
  const ARENA_L = 44;
  const ARENA_R = GAME_WIDTH - 44;
  const ARENA_T = 76;
  const ARENA_B = GAME_HEIGHT - 40;

  const wins = [0, 0, 0, 0];
  const score = [0, 0, 0, 0];
  let roundBannerTimer = 70;
  let bannerTitle = 'ORBITAL SHIELD';
  let bannerSub = 'STICK: MOVE & AIM SHIELD · A: PARRY SURGE TO REFLECT MISSILES!';
  let bannerColor = '#38bdf8';
  let matchOver = false;
  // Set when a round ends; freezes play until the banner finishes and resetRound() runs.
  // (Without it the round-end check re-fired during the banner's last 10 frames, awarding
  // the same round win over and over.)
  let roundOver = false;
  let roundFrames = 0;
  const prevA = [false, false, false, false];

  const orbs = [0, 1, 2, 3].map((i) => ({
    x: i % 2 === 0 ? 185 : GAME_WIDTH - 185,
    y: i < 2 ? 165 : 405,
    vx: 0,
    vy: 0,
    shieldAngle: i % 2 === 0 ? 0 : Math.PI,
    parryTimer: 0,
    parryCd: 0,
    hp: 3,
    invuln: 0,
    flash: 0,
  }));

  interface Missile {
    x: number;
    y: number;
    vx: number;
    vy: number;
    owner: number;
    speed: number;
    bounces: number;
    color: string;
  }

  let missiles: Missile[] = [];
  let spawnTimer = 50;

  function resetRound() {
    missiles = [];
    spawnTimer = 45;
    roundFrames = 0;
    for (let i = 0; i < 4; i++) {
      orbs[i].x = i % 2 === 0 ? 185 : GAME_WIDTH - 185;
      orbs[i].y = i < 2 ? 165 : 405;
      orbs[i].vx = 0;
      orbs[i].vy = 0;
      orbs[i].shieldAngle = Math.atan2(CY - orbs[i].y, CX - orbs[i].x);
      orbs[i].parryTimer = 0;
      orbs[i].parryCd = 0;
      orbs[i].hp = 3;
      orbs[i].invuln = 30;
      orbs[i].flash = 0;
    }
  }

  function angleDiff(a: number, b: number) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      if (roundBannerTimer > 0) {
        roundBannerTimer--;
        if (roundBannerTimer === 0) {
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

      if (roundBannerTimer <= 10 && !matchOver && !roundOver) {
        roundFrames++;
        // Center emitter spawns missiles
        spawnTimer--;
        if (spawnTimer <= 0 && missiles.length < 7) {
          const alive = [0, 1, 2, 3].filter((idx) => active[idx].enabled && orbs[idx].hp > 0);
          const targetIdx = alive[Math.floor(Math.random() * Math.max(1, alive.length))] ?? 0;
          const ang = Math.atan2(orbs[targetIdx].y - CY, orbs[targetIdx].x - CX) + (Math.random() - 0.5) * 0.35;
          const spd = 4.5 + Math.min(2.5, roundFrames * 0.0008);
          missiles.push({
            x: CX + Math.cos(ang) * 26,
            y: CY + Math.sin(ang) * 26,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            owner: -1,
            speed: spd,
            bounces: 4,
            color: '#fb7185',
          });
          sound.beep(520, 0.05, 'sawtooth', 0.06);
          vfx.ring(CX, CY, '#fb7185', 38, 2);
          spawnTimer = Math.max(42, 85 - missiles.length * 8);
        }

        // Update players
        for (let i = 0; i < 4; i++) {
          const o = orbs[i];
          if (!active[i].enabled || o.hp <= 0) continue;
          if (o.parryTimer > 0) o.parryTimer--;
          if (o.parryCd > 0) o.parryCd--;
          if (o.invuln > 0) o.invuln--;
          if (o.flash > 0) o.flash--;

          let ix = 0;
          let iy = 0;
          let parry = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            parry = inp.actionA && !prevA[i];
            prevA[i] = inp.actionA;
          } else {
            // Bot: find nearest threatening missile and aim shield toward it!
            let threat: Missile | null = null;
            let bestDist = 9999;
            for (const m of missiles) {
              if (m.owner === i) continue;
              const d = Math.hypot(m.x - o.x, m.y - o.y);
              if (d < bestDist) {
                bestDist = d;
                threat = m;
              }
            }
            if (threat) {
              const angToMissile = Math.atan2(threat.y - o.y, threat.x - o.x);
              const diff = angleDiff(angToMissile, o.shieldAngle);
              o.shieldAngle += Math.max(-0.22, Math.min(0.22, diff));
              if (bestDist < 72 && o.parryCd === 0 && Math.random() < 0.25) {
                parry = true;
              }
              // Strafe perpendicular to incoming missile
              const perp = angToMissile + (i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
              ix = Math.cos(perp) * 0.65;
              iy = Math.sin(perp) * 0.65;
            } else {
              ix = Math.cos(frame * 0.03 + i) * 0.5;
              iy = Math.sin(frame * 0.03 + i) * 0.5;
            }
          }

          if (active[i].isHuman && Math.hypot(ix, iy) > 0.15) {
            const targetAng = Math.atan2(iy, ix);
            const diff = angleDiff(targetAng, o.shieldAngle);
            o.shieldAngle += diff * 0.28;
          }

          o.vx = o.vx * 0.78 + ix * 0.9;
          o.vy = o.vy * 0.78 + iy * 0.9;
          o.x = Math.max(ARENA_L + 26, Math.min(ARENA_R - 26, o.x + o.vx));
          o.y = Math.max(ARENA_T + 26, Math.min(ARENA_B - 26, o.y + o.vy));

          // Avoid center emitter solid pillar
          const dc = Math.hypot(o.x - CX, o.y - CY);
          if (dc < 52 && dc > 0.1) {
            o.x = CX + ((o.x - CX) / dc) * 52;
            o.y = CY + ((o.y - CY) / dc) * 52;
          }

          if (parry && o.parryCd === 0) {
            o.parryTimer = 14;
            o.parryCd = 34;
            sound.sweep(480, 920, 0.08, 'triangle', 0.08);
            vfx.ring(o.x, o.y, '#facc15', 42, 2.5);
          }
        }

        // Update missiles
        missiles = missiles.filter((m) => {
          m.x += m.vx;
          m.y += m.vy;

          if (frame % 2 === 0) {
            vfx.spark(m.x, m.y, -m.vx * 0.15, -m.vy * 0.15, m.color, 3);
          }

          // Wall bounce
          let bounced = false;
          if (m.x < ARENA_L + 8) { m.x = ARENA_L + 8; m.vx = Math.abs(m.vx); bounced = true; }
          if (m.x > ARENA_R - 8) { m.x = ARENA_R - 8; m.vx = -Math.abs(m.vx); bounced = true; }
          if (m.y < ARENA_T + 8) { m.y = ARENA_T + 8; m.vy = Math.abs(m.vy); bounced = true; }
          if (m.y > ARENA_B - 8) { m.y = ARENA_B - 8; m.vy = -Math.abs(m.vy); bounced = true; }
          if (bounced) {
            m.bounces--;
            vfx.spark(m.x, m.y, 0, 0, m.color, 4);
            if (m.bounces < 0) return false;
          }

          // Check shield deflect & player hit
          for (let i = 0; i < 4; i++) {
            const o = orbs[i];
            if (!active[i].enabled || o.hp <= 0) continue;
            const d = Math.hypot(m.x - o.x, m.y - o.y);

            // Shield arc check (radius 24..38)
            if (d >= 18 && d <= 40) {
              const incAng = Math.atan2(m.y - o.y, m.x - o.x);
              const arcHalf = o.parryTimer > 0 ? 1.55 : 0.95;
              if (Math.abs(angleDiff(incAng, o.shieldAngle)) <= arcHalf && m.owner !== i) {
                const isParry = o.parryTimer > 0;
                m.speed = Math.min(11.5, m.speed * (isParry ? 1.35 : 1.12));
                m.owner = i;
                m.color = active[i].color;
                m.bounces = 4;

                // Aim deflected missile toward nearest rival!
                let rivalAng = o.shieldAngle;
                let bestRivalD = 9999;
                for (let j = 0; j < 4; j++) {
                  if (j === i || !active[j].enabled || orbs[j].hp <= 0) continue;
                  const rd = Math.hypot(orbs[j].x - o.x, orbs[j].y - o.y);
                  if (rd < bestRivalD) {
                    bestRivalD = rd;
                    rivalAng = Math.atan2(orbs[j].y - o.y, orbs[j].x - o.x);
                  }
                }
                const outAng = isParry ? rivalAng : o.shieldAngle + (Math.random() - 0.5) * 0.25;
                m.vx = Math.cos(outAng) * m.speed;
                m.vy = Math.sin(outAng) * m.speed;
                m.x = o.x + Math.cos(incAng) * 42;
                m.y = o.y + Math.sin(incAng) * 42;

                score[i] += isParry ? 15 : 5;
                sound.combo(isParry ? 5 : 2);
                vfx.burst(m.x, m.y, isParry ? '#facc15' : active[i].color, isParry ? 14 : 8, 4.5);
                if (isParry) {
                  vfx.hitstop(2);
                  vfx.popup(o.x, o.y - 28, 'PARRY +15!', '#facc15', 14);
                }
                rumble(i, isParry ? 90 : 45, 0.65);
                break;
              }
            }

            // Core hit
            if (d < 20 && o.invuln === 0 && m.owner !== i) {
              o.hp--;
              o.invuln = 48;
              o.flash = 10;
              sound.explosion();
              vfx.hitstop(2);
              vfx.shake(8);
              vfx.burst(o.x, o.y, '#fb7185', 18, 5);
              if (m.owner >= 0) {
                score[m.owner] += o.hp === 0 ? 40 : 20;
                vfx.popup(o.x, o.y - 24, o.hp === 0 ? 'SHATTER +40!' : 'HIT +20!', active[m.owner].color, 14);
                rumble(m.owner, 70, 0.55);
              }
              if (o.hp === 0) {
                vfx.hitstop(4);
                vfx.flash(active[i].color, 0.22);
                vfx.ring(o.x, o.y, active[i].color, 90, 4.5);
                vfx.burst(o.x, o.y, active[i].color, 26, 6.5, 4, 0.12);
                if (m.owner < 0) vfx.popup(o.x, o.y - 24, 'SHATTERED!', '#fb7185', 14);
              }
              rumble(i, 140, 0.9);
              return false;
            }
          }

          return true;
        });

        // Round survival check
        const alive = [0, 1, 2, 3].filter((idx) => active[idx].enabled && orbs[idx].hp > 0);
        const totalEnabled = active.filter((a) => a.enabled).length;
        if (totalEnabled <= 1 && alive.length === 0) {
          // Solo (bots off): shattered -> show the score and start a fresh wave
          const soloIdx = Math.max(0, active.findIndex((a) => a.enabled));
          roundOver = true;
          bannerTitle = 'SHIELD SHATTERED!';
          bannerSub = `SCORE ${score[soloIdx]} PTS · PARRY MORE TO SCORE HIGHER`;
          bannerColor = '#fb7185';
          roundBannerTimer = 90;
        } else if (totalEnabled > 1 && alive.length <= 1) {
          // If the last two shatter on the same frame, the higher scorer takes the round
          const rw =
            alive[0] ??
            [0, 1, 2, 3].filter((idx) => active[idx].enabled).sort((a, b) => score[b] - score[a])[0] ??
            0;
          roundOver = true;
          wins[rw]++;
          score[rw] += 30;
          sound.win();
          vfx.flash(active[rw].color, 0.25);
          vfx.confetti(CX, CY, 50);
          rumble(rw, 160, 0.7);
          if (wins[rw] >= 3) {
            vfx.confetti(180, 200, 40);
            vfx.confetti(GAME_WIDTH - 180, 200, 40);
            matchOver = true;
            bannerTitle = `${active[rw].name} IS SHIELD MASTER!`;
            bannerSub = `3 ROUND WINS · ${score[rw]} PTS`;
            bannerColor = active[rw].color;
            roundBannerTimer = 140;
          } else {
            bannerTitle = `${active[rw].name} WINS ROUND!`;
            bannerSub = `WINS ${wins[rw]}/3 · NEXT WAVE`;
            bannerColor = active[rw].color;
            roundBannerTimer = 80;
          }
        }
      }

      // Render
      drawArcadeBackdrop(ctx, '#38bdf8');

      // Center Laser Emitter
      ctx.save();
      ctx.shadowColor = '#fb7185';
      ctx.shadowBlur = 22;
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CX, CY, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fb7185';
      ctx.beginPath();
      ctx.arc(CX, CY, 8 + Math.sin(frame * 0.18) * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => wins[b] * 1000 + score[b] - (wins[a] * 1000 + score[a]))[0];

      // Players + orbiting shield paddles
      for (let i = 0; i < 4; i++) {
        const o = orbs[i];
        if (!active[i].enabled || o.hp <= 0) continue;

        ctx.save();
        if (o.invuln > 0 && Math.floor(frame / 3) % 2 === 0) ctx.globalAlpha = 0.55;

        // Orbiting shield arc
        const isParrying = o.parryTimer > 0;
        ctx.strokeStyle = isParrying ? '#facc15' : active[i].color;
        ctx.shadowColor = isParrying ? '#facc15' : active[i].color;
        ctx.shadowBlur = isParrying ? 20 : 12;
        ctx.lineWidth = isParrying ? 7 : 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(o.x, o.y, 31, o.shieldAngle - (isParrying ? 1.35 : 0.85), o.shieldAngle + (isParrying ? 1.35 : 0.85));
        ctx.stroke();
        ctx.restore();

        drawPlayerOrb(ctx, o.x, o.y, 16, active[i].color, i, {
          leader: i === leaderIdx && (wins[i] > 0 || score[i] > 0),
          flash: o.flash > 0,
          cooldownPct: o.parryCd / 34,
          label: `${o.hp}♥`,
        });
      }

      // Missiles
      for (const m of missiles) {
        ctx.save();
        // Additive halo instead of per-missile shadowBlur
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 3.5, 0, Math.PI * 2);
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
        valueText: `★${wins[s]} · ${'♥'.repeat(Math.max(0, orbs[s].hp))}`,
        highlight: s === leaderIdx && (wins[s] > 0 || score[s] > 0),
      }));
      drawTopScoreboard(ctx, pills, 'STICK: MOVE & AIM SHIELD · A: PARRY SURGE · FIRST TO 3 WINS');

      if (roundBannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 52. CYBER RELAY GP (High-Speed Circuit, Heat-Boost Zones & Rhythm Nitro Pads!)
export function createCyberRelayEngine(): MiniGameEngine {
  const TOTAL_LAPS = 3;
  const CX = GAME_WIDTH / 2;
  const CY = 288;
  const RX = 365;
  const RY = 165;
  const TRACK_HALF_W = 50;

  // Parametric rounded stadium + subtle chicane wave
  function trackPoint(theta: number): { x: number; y: number } {
    const wave = Math.sin(theta * 2) * 16;
    return {
      x: CX + Math.cos(theta) * (RX + wave * 0.4),
      y: CY + Math.sin(theta) * (RY - wave * 0.6),
    };
  }

  function trackTangent(theta: number): number {
    const p1 = trackPoint(theta - 0.01);
    const p2 = trackPoint(theta + 0.01);
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
  }

  const boostZones = [0.65, 2.55, 4.45]; // angles along track

  const racers = [0, 1, 2, 3].map((i) => {
    const startAngle = -Math.PI / 2 - 0.12 - i * 0.05;
    const pt = trackPoint(startAngle);
    const offset = (i % 2 === 0 ? -16 : 16);
    return {
      x: pt.x,
      y: pt.y + offset,
      vx: 0,
      vy: 0,
      angle: 0,
      speed: 0,
      progressAngle: 0,
      lastTheta: startAngle,
      lap: 1,
      nitro: 0,
      nitroCd: 0,
      flash: 0,
      finished: false,
    };
  });

  let bannerTimer = 70;
  let bannerTitle = 'CYBER RELAY GP';
  let bannerSub = 'L/R: STEER · A/UP: GAS · B: NITRO ON >> PADS · 3 LAPS!';
  let bannerColor = '#2ee59d';
  let matchOver = false;
  const prevB = [false, false, false, false];

  function angleDiff(a: number, b: number) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }

  function resetRace() {
    for (let i = 0; i < 4; i++) {
      const startAngle = -Math.PI / 2 - 0.12 - i * 0.05;
      const pt = trackPoint(startAngle);
      racers[i].x = pt.x;
      racers[i].y = pt.y + (i % 2 === 0 ? -16 : 16);
      racers[i].vx = 0;
      racers[i].vy = 0;
      racers[i].angle = 0;
      racers[i].speed = 0;
      racers[i].progressAngle = 0;
      racers[i].lastTheta = startAngle;
      racers[i].lap = 1;
      racers[i].nitro = 0;
      racers[i].nitroCd = 0;
      racers[i].finished = false;
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
          resetRace();
        }
      }

      if (bannerTimer <= 10 && !matchOver) {
        for (let i = 0; i < 4 && !matchOver; i++) {
          if (!active[i].enabled) continue;
          const r = racers[i];
          if (r.nitro > 0) r.nitro--;
          if (r.nitroCd > 0) r.nitroCd--;
          if (r.flash > 0) r.flash--;

          // Current track theta estimate
          const curTheta = Math.atan2((r.y - CY) / RY, (r.x - CX) / RX);
          const centerPt = trackPoint(curTheta);
          const distFromCenterline = Math.hypot(r.x - centerPt.x, r.y - centerPt.y);

          // Check if over a heat-boost pad
          let onBoostPad = false;
          for (const bz of boostZones) {
            const bp = trackPoint(bz);
            if (Math.hypot(r.x - bp.x, r.y - bp.y) < 42) onBoostPad = true;
          }

          // Registry controls: Steer Left/Right · Gas A/Up · Rhythm Nitro B (Down = brake).
          // Humans and bots drive the same heading-based car model.
          let steer = 0;
          let gas = false;
          let brake = false;
          let tapNitro = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            steer = inp.x;
            gas = inp.actionA || inp.y < -0.5;
            brake = inp.y > 0.5;
            tapNitro = inp.actionB && !prevB[i];
            prevB[i] = inp.actionB;
          } else {
            // Bot steers its heading toward a point ahead on the track spline
            const lookAhead = curTheta + 0.3;
            const targetPt = trackPoint(lookAhead);
            const laneOffset = (i - 1.5) * 9;
            const tx = targetPt.x + Math.cos(lookAhead) * laneOffset;
            const ty = targetPt.y + Math.sin(lookAhead) * laneOffset;
            const diff = angleDiff(Math.atan2(ty - r.y, tx - r.x), r.angle);
            steer = Math.max(-1, Math.min(1, diff * 2.4));
            gas = Math.abs(diff) < 1.1 || r.speed < 2.5;
            if (r.nitroCd === 0 && Math.abs(diff) < 0.35) {
              if (onBoostPad ? Math.random() < 0.12 : Math.random() < 0.006) tapNitro = true;
            }
          }

          if (tapNitro && r.nitroCd === 0) {
            const perfectPad = onBoostPad;
            r.nitro = perfectPad ? 36 : 18;
            r.nitroCd = perfectPad ? 38 : 68;
            r.speed = Math.max(r.speed, perfectPad ? 6.4 : 5.4);
            sound.dash();
            if (perfectPad) {
              sound.combo(4);
              vfx.popup(r.x, r.y - 22, 'PERFECT BOOST!', '#facc15', 13);
              vfx.ring(r.x, r.y, '#facc15', 46, 3);
              rumble(i, 90, 0.7);
            } else {
              rumble(i, 60, 0.45);
            }
            vfx.burst(r.x, r.y, perfectPad ? '#facc15' : active[i].color, 12, 4.5);
          }

          const offTrack = distFromCenterline > TRACK_HALF_W;
          const topSpd = r.nitro > 0 ? 7.4 : offTrack ? 3.2 : 5.1;

          // Throttle / brake / reverse
          if (gas || r.nitro > 0) r.speed += r.speed < 0 ? 0.3 : 0.16;
          else r.speed *= 0.975;
          if (brake) r.speed -= 0.3;
          if (r.speed > topSpd) r.speed = Math.max(topSpd, r.speed - 0.18);
          r.speed = Math.max(-1.6, r.speed);

          // Steering authority grows with speed (and flips while reversing)
          const turnRate = 0.058 * Math.max(0.3, Math.min(1, Math.abs(r.speed) / 2.6));
          r.angle += steer * turnRate * (r.speed < 0 ? -1 : 1);

          // Grip: velocity eases toward the heading for a little drift on hard turns
          r.vx += (Math.cos(r.angle) * r.speed - r.vx) * 0.22;
          r.vy += (Math.sin(r.angle) * r.speed - r.vy) * 0.22;
          r.x += r.vx;
          r.y += r.vy;

          if (offTrack && Math.abs(r.speed) > 2 && frame % 4 === 0) {
            vfx.spark(r.x, r.y, -r.vx * 0.3, -r.vy * 0.3, '#94a3b8', 2.5);
          }

          // Keep on outer arena bounds
          r.x = Math.max(46, Math.min(GAME_WIDTH - 46, r.x));
          r.y = Math.max(78, Math.min(GAME_HEIGHT - 38, r.y));

          // Hard barrier just outside the track run-off
          {
            const th = Math.atan2((r.y - CY) / RY, (r.x - CX) / RX);
            const cp = trackPoint(th);
            const dx = r.x - cp.x;
            const dy = r.y - cp.y;
            const dd = Math.hypot(dx, dy);
            const limit = TRACK_HALF_W + 18;
            if (dd > limit) {
              r.x = cp.x + (dx / dd) * limit;
              r.y = cp.y + (dy / dd) * limit;
              r.speed *= 0.9;
              if (frame % 3 === 0) {
                vfx.spark(r.x, r.y, (-dx / dd) * 2, (-dy / dd) * 2, '#38bdf8', 3);
                sound.noiseBurst(0.04, 1800, 0.035);
              }
            }
          }

          if (r.nitro > 0 && frame % 2 === 0) {
            vfx.afterimage(r.x, r.y, 13, '#facc15', 8);
          }

          // Track progress delta
          const newTheta = Math.atan2((r.y - CY) / RY, (r.x - CX) / RX);
          let delta = newTheta - r.lastTheta;
          if (delta > Math.PI) delta -= Math.PI * 2;
          if (delta < -Math.PI) delta += Math.PI * 2;
          r.progressAngle += delta;
          r.lastTheta = newTheta;

          const newLap = Math.max(1, Math.floor(r.progressAngle / (Math.PI * 2)) + 1);
          if (newLap > r.lap) {
            r.lap = newLap;
            if (r.lap > TOTAL_LAPS) {
              matchOver = true;
              bannerTitle = `${active[i].name} WINS THE GP!`;
              bannerSub = `CHAMPION · ${TOTAL_LAPS} LAPS COMPLETE`;
              bannerColor = active[i].color;
              bannerTimer = 140;
              sound.win();
              vfx.flash(active[i].color, 0.3);
              vfx.confetti(r.x, r.y, 65);
              vfx.confetti(GAME_WIDTH / 2, 200, 45);
              rumble(i, 200, 0.85);
            } else {
              sound.combo(r.lap);
              vfx.ring(r.x, r.y, '#2ee59d', 50, 3);
              vfx.popup(r.x, r.y - 24, r.lap === TOTAL_LAPS ? 'FINAL LAP!' : `LAP ${r.lap}/${TOTAL_LAPS}`, '#2ee59d', 14);
              rumble(i, 70, 0.5);
            }
          }
        }

        // Racer bump sparks
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled) continue;
            const a = racers[i];
            const b = racers[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < 28) {
              const nx = dx / d;
              const ny = dy / d;
              const overlap = 28 - d;
              a.x -= nx * overlap * 0.5;
              a.y -= ny * overlap * 0.5;
              b.x += nx * overlap * 0.5;
              b.y += ny * overlap * 0.5;
              a.vx -= nx * 2.2;
              a.vy -= ny * 2.2;
              b.vx += nx * 2.2;
              b.vy += ny * 2.2;
              a.flash = 5;
              b.flash = 5;
              sound.hit();
              vfx.spark((a.x + b.x) / 2, (a.y + b.y) / 2, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, '#facc15', 3.5);
              rumble(i, 50, 0.45);
              rumble(j, 50, 0.45);
            }
          }
        }
      }

      // Render Speedway
      drawArcadeBackdrop(ctx, '#2ee59d');

      ctx.save();
      // Road outer glow + surface
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let t = 0; t <= Math.PI * 2 + 0.08; t += 0.08) {
        const pt = trackPoint(t);
        if (t === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = TRACK_HALF_W * 2 + 10;
      ctx.stroke();

      ctx.strokeStyle = '#111827';
      ctx.lineWidth = TRACK_HALF_W * 2;
      ctx.stroke();

      // Center racing line dashes
      ctx.setLineDash([14, 16]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);

      // Start/Finish gate at top (-PI/2)
      const startPt = trackPoint(-Math.PI / 2);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(startPt.x, startPt.y - TRACK_HALF_W);
      ctx.lineTo(startPt.x, startPt.y + TRACK_HALF_W);
      ctx.stroke();

      // Heat-boost nitro pads
      for (const bz of boostZones) {
        const bp = trackPoint(bz);
        const tang = trackTangent(bz);
        ctx.save();
        ctx.translate(bp.x, bp.y);
        ctx.rotate(tang);
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 16;
        ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-24, -22, 48, 44, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#facc15';
        ctx.font = '800 14px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('>>', 0, 5);
        ctx.restore();
      }
      ctx.restore();

      const standings = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => racers[b].progressAngle - racers[a].progressAngle);
      const leaderIdx = standings[0];

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const r = racers[i];
        drawPlayerOrb(ctx, r.x, r.y, 14, active[i].color, i, {
          angle: r.angle,
          leader: i === leaderIdx && r.progressAngle > 0.2,
          flash: r.flash > 0,
          cooldownPct: Math.min(1, r.nitroCd / 68),
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      const pills: ScorePillData[] = [0, 1, 2, 3].map((s) => {
        const pos = standings.indexOf(s) + 1;
        return {
          slot: s,
          name: active[s].name,
          color: active[s].color,
          active: active[s].enabled,
          valueText: `#${pos || '-'} · L${Math.min(TOTAL_LAPS, racers[s].lap)}/${TOTAL_LAPS}`,
          highlight: s === leaderIdx && racers[s].progressAngle > 0.2,
        };
      });
      drawTopScoreboard(ctx, pills, 'L/R: STEER · A/UP: GAS · DOWN: BRAKE · B: NITRO (PERFECT ON >> PADS!)');

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 53. TREASURE DIVERS (Oxygen Trench, Deep Loot & Patrol Sharks/Jellyfish!)
export function createTreasureDiversEngine(): MiniGameEngine {
  const SURFACE_Y = 122;
  const ROUND_FRAMES = 55 * 60;

  const banked = [0, 0, 0, 0];
  let roundTimer = ROUND_FRAMES;
  let bannerTimer = 70;
  let bannerTitle = 'TREASURE DIVERS';
  let bannerSub = 'DIVE DEEP FOR PEARLS & CHESTS · SURFACE TO BANK O2 & SCORE!';
  let bannerColor = '#38bdf8';
  let matchOver = false;
  const prevA = [false, false, false, false];

  const divers = [0, 1, 2, 3].map((i) => ({
    x: 180 + i * 200,
    y: SURFACE_Y,
    vx: 0,
    vy: 0,
    o2: 100,
    carried: 0,
    burstCd: 0,
    stun: 0,
    flash: 0,
    angle: Math.PI / 2,
    botRefilling: false,
  }));

  interface Loot {
    x: number;
    y: number;
    val: number;
    kind: 'pearl' | 'gem' | 'chest';
  }
  let loots: Loot[] = [];

  const hazards = [
    { x: 200, y: 235, vx: 2.3, kind: 'shark' as const },
    { x: 720, y: 335, vx: -2.7, kind: 'shark' as const },
    { x: 350, y: 425, vx: 2.1, kind: 'jelly' as const },
    { x: 640, y: 195, vx: -1.8, kind: 'jelly' as const },
  ];

  function populateLoot() {
    while (loots.length < 12) {
      const r = Math.random();
      if (r < 0.25) {
        loots.push({
          x: 90 + Math.random() * (GAME_WIDTH - 180),
          y: 415 + Math.random() * 68,
          val: 50,
          kind: 'chest',
        });
      } else if (r < 0.6) {
        loots.push({
          x: 80 + Math.random() * (GAME_WIDTH - 160),
          y: 270 + Math.random() * 130,
          val: 25,
          kind: 'gem',
        });
      } else {
        loots.push({
          x: 70 + Math.random() * (GAME_WIDTH - 140),
          y: 155 + Math.random() * 115,
          val: 10,
          kind: 'pearl',
        });
      }
    }
  }

  function resetAll() {
    banked.fill(0);
    roundTimer = ROUND_FRAMES;
    loots = [];
    populateLoot();
    for (let i = 0; i < 4; i++) {
      divers[i].x = 180 + i * 200;
      divers[i].y = SURFACE_Y;
      divers[i].vx = 0;
      divers[i].vy = 0;
      divers[i].o2 = 100;
      divers[i].carried = 0;
      divers[i].stun = 0;
      divers[i].botRefilling = false;
    }
  }

  populateLoot();

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

      populateLoot();

      if (bannerTimer <= 10 && !matchOver) {
        roundTimer = Math.max(0, roundTimer - 1);

        // Hazards patrol
        for (const h of hazards) {
          h.x += h.vx;
          if (h.x < 70 || h.x > GAME_WIDTH - 70) h.vx *= -1;
        }

        // Divers
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const d = divers[i];
          if (d.burstCd > 0) d.burstCd--;
          if (d.stun > 0) d.stun--;
          if (d.flash > 0) d.flash--;

          let ix = 0;
          let iy = 0;
          let swimBurst = false;

          if (active[i].isHuman) {
            // Always sample so the burst edge-detect stays fresh through a stun
            const inp = readPlayerInput(i, pads, keys);
            if (d.stun === 0) {
              ix = inp.x;
              iy = inp.y;
              swimBurst = inp.actionA && !prevA[i];
            }
            prevA[i] = inp.actionA;
          }
          if (d.stun > 0) {
            d.vy -= 0.08;
          } else if (!active[i].isHuman) {
            // Bot dives for loot, surfaces when o2 < 35 or carrying >= 65, and stays up
            // until its tank is nearly full (previously it re-dove at ~35% O2 and yo-yo'd).
            const atSurface = d.y <= SURFACE_Y + 6;
            if (d.o2 < 34 || d.carried >= 65) d.botRefilling = true;
            if (d.botRefilling && atSurface && d.o2 >= 92 && d.carried === 0) d.botRefilling = false;
            const needSurface = d.botRefilling;
            if (needSurface && atSurface) {
              iy = -0.4;
              ix = Math.sin(frame * 0.04 + i * 1.7) * 0.3;
            } else if (needSurface) {
              iy = -0.9;
              ix = Math.sin(frame * 0.05 + i) * 0.25;
              if (d.o2 < 22 && d.burstCd === 0) swimBurst = true;
            } else {
              let best: Loot | null = null;
              let bestScore = -999;
              for (const l of loots) {
                const dist = Math.hypot(l.x - d.x, l.y - d.y);
                const s = l.val * 2.5 - dist * 0.25;
                if (s > bestScore) {
                  bestScore = s;
                  best = l;
                }
              }
              if (best) {
                const dist = Math.hypot(best.x - d.x, best.y - d.y) || 1;
                ix = ((best.x - d.x) / dist) * 0.85;
                iy = ((best.y - d.y) / dist) * 0.85;
                if (dist > 140 && d.burstCd === 0 && Math.random() < 0.04) swimBurst = true;
              }
            }
            // Steer around nearby sharks / jellies (imperfectly)
            for (const h of hazards) {
              const hx = d.x - h.x;
              const hy = d.y - h.y;
              const hd = Math.hypot(hx, hy);
              if (hd > 0 && hd < 70) {
                const w = (1 - hd / 70) * 1.1;
                ix += (hx / hd) * w;
                iy += (hy / hd) * w;
              }
            }
            const im = Math.hypot(ix, iy);
            if (im > 1) {
              ix /= im;
              iy /= im;
            }
          }

          if (Math.hypot(ix, iy) > 0.15) d.angle = Math.atan2(iy, ix);

          if (swimBurst && d.burstCd === 0 && d.stun === 0) {
            d.vx += Math.cos(d.angle) * 7.2;
            d.vy += Math.sin(d.angle) * 7.2;
            d.burstCd = 34;
            sound.dash();
            vfx.burst(d.x, d.y, '#7dd3fc', 8, 3);
          }

          if (d.burstCd > 24) vfx.afterimage(d.x, d.y, 14, active[i].color, 7);

          d.vx = d.vx * 0.85 + ix * 0.55;
          d.vy = d.vy * 0.85 + iy * 0.55;
          d.x = Math.max(52, Math.min(GAME_WIDTH - 52, d.x + d.vx));
          d.y = Math.max(SURFACE_Y - 10, Math.min(GAME_HEIGHT - 44, d.y + d.vy));

          // Oxygen & Banking at surface
          if (d.y <= SURFACE_Y + 6) {
            d.o2 = Math.min(100, d.o2 + 2.4);
            if (d.carried > 0) {
              banked[i] += d.carried;
              sound.combo(Math.min(10, Math.floor(d.carried / 15) + 1));
              if (d.carried >= 50) sound.pickup(240);
              vfx.popup(d.x, d.y - 18, `BANKED +${d.carried}!`, '#2ee59d', d.carried >= 50 ? 18 : 15);
              vfx.burst(d.x, d.y, '#2ee59d', 12 + Math.min(14, Math.floor(d.carried / 8)), 4.5);
              vfx.ring(d.x, d.y, '#2ee59d', 40 + Math.min(40, d.carried * 0.4), 3);
              d.carried = 0;
              rumble(i, 90, 0.6);
            }
          } else {
            const depthFactor = 0.09 + ((d.y - SURFACE_Y) / 360) * 0.13;
            d.o2 = Math.max(0, d.o2 - depthFactor);
            if (d.o2 <= 0) {
              // Out of oxygen!
              const lost = Math.ceil(d.carried * 0.5);
              d.carried -= lost;
              vfx.burst(d.x, d.y, '#7dd3fc', 14, 4);
              d.y = SURFACE_Y;
              d.o2 = 100;
              d.flash = 10;
              sound.explosion();
              vfx.shake(5);
              vfx.popup(d.x, SURFACE_Y + 24, lost > 0 ? `OUT OF O2! -${lost}` : 'OUT OF O2!', '#fb7185', 14);
              rumble(i, 140, 0.85);
            }
          }

          // Collect loot
          for (let li = loots.length - 1; li >= 0; li--) {
            const l = loots[li];
            if (Math.hypot(d.x - l.x, d.y - l.y) < 28) {
              d.carried += l.val;
              loots.splice(li, 1);
              sound.pickup(l.val * 3);
              if (l.kind === 'chest') {
                vfx.ring(l.x, l.y, '#facc15', 42, 2.5);
                rumble(i, 60, 0.45);
              }
              vfx.burst(l.x, l.y, l.kind === 'chest' ? '#facc15' : '#38bdf8', 10, 3.5);
              vfx.popup(l.x, l.y - 14, `+${l.val}`, '#facc15', 13);
            }
          }

          // Hazard collision
          for (const h of hazards) {
            if (Math.hypot(d.x - h.x, d.y - h.y) < 28 && d.stun === 0) {
              d.stun = 34;
              d.flash = 12;
              d.vx = (d.x - h.x) * 0.35;
              d.vy = -4.5;
              const dropped = Math.min(d.carried, 20);
              d.carried -= dropped;
              sound.hit();
              vfx.shake(6);
              if (h.kind === 'jelly') vfx.bolt(h.x, h.y, d.x, d.y, '#c084fc');
              vfx.burst(d.x, d.y, '#fb7185', 12, 4);
              vfx.popup(d.x, d.y - 18, dropped > 0 ? `ZAP -${dropped}` : 'ZAP!', '#fb7185', 13);
              rumble(i, 120, 0.8);
            }
          }
        }

        if (roundTimer <= 0) {
          // Auto-bank half of carried at buzzer? No, surface banking matters!
          const winner = [0, 1, 2, 3]
            .filter((idx) => active[idx].enabled)
            .sort((a, b) => banked[b] - banked[a])[0] ?? 0;
          matchOver = true;
          bannerTitle = `${active[winner].name} IS DEEP SEA KING!`;
          bannerSub = `BANKED ${banked[winner]} PTS`;
          bannerColor = active[winner].color;
          bannerTimer = 140;
          sound.win();
          vfx.flash(active[winner].color, 0.3);
          vfx.confetti(GAME_WIDTH / 2, 210, 65);
          vfx.confetti(divers[winner].x, divers[winner].y, 30);
          rumble(winner, 200, 0.8);
        }
      }

      // Render Ocean Trench
      drawArcadeBackdrop(ctx, '#38bdf8');

      // Deep ocean gradient
      ctx.save();
      const seaGrad = ctx.createLinearGradient(0, SURFACE_Y, 0, GAME_HEIGHT - 36);
      seaGrad.addColorStop(0, 'rgba(56, 189, 248, 0.18)');
      seaGrad.addColorStop(0.5, 'rgba(14, 116, 144, 0.22)');
      seaGrad.addColorStop(1, 'rgba(15, 23, 42, 0.72)');
      ctx.fillStyle = seaGrad;
      ctx.fillRect(36, SURFACE_Y, GAME_WIDTH - 72, GAME_HEIGHT - 36 - SURFACE_Y);

      // Shimmering water surface line
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 36; x <= GAME_WIDTH - 36; x += 18) {
        const wy = SURFACE_Y + Math.sin(x * 0.04 + frame * 0.08) * 3;
        if (x === 36) ctx.moveTo(x, wy);
        else ctx.lineTo(x, wy);
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(125, 211, 252, 0.5)';
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▲ SURFACE ZONE: REFILL O2 & BANK TREASURE ▲', GAME_WIDTH / 2, SURFACE_Y - 12);
      ctx.restore();

      // Loots
      for (const l of loots) {
        ctx.save();
        // One cheap additive halo per loot instead of shadowBlur
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = l.kind === 'chest' ? '#facc15' : l.kind === 'gem' ? '#2ee59d' : '#f3f2ed';
        ctx.beginPath();
        ctx.arc(l.x, l.y, l.kind === 'chest' ? 22 : l.kind === 'gem' ? 18 : 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        if (l.kind === 'chest') {
          ctx.fillStyle = '#eab308';
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(l.x - 13, l.y - 10, 26, 20, 4);
          ctx.fill();
          ctx.stroke();
        } else if (l.kind === 'gem') {
          ctx.fillStyle = '#2ee59d';
          ctx.beginPath();
          ctx.moveTo(l.x, l.y - 11);
          ctx.lineTo(l.x + 10, l.y);
          ctx.lineTo(l.x, l.y + 11);
          ctx.lineTo(l.x - 10, l.y);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = '#e2e8f0';
          ctx.beginPath();
          ctx.arc(l.x, l.y, 7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Hazards
      for (const h of hazards) {
        ctx.save();
        if (h.kind === 'shark') {
          const dir = h.vx >= 0 ? 1 : -1;
          ctx.fillStyle = '#fb7185';
          ctx.shadowColor = '#fb7185';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(h.x + dir * 20, h.y);
          ctx.lineTo(h.x - dir * 16, h.y - 10);
          ctx.lineTo(h.x - dir * 10, h.y);
          ctx.lineTo(h.x - dir * 16, h.y + 10);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = '#c084fc';
          ctx.shadowColor = '#c084fc';
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(h.x, h.y, 12, Math.PI, 0);
          ctx.fill();
          ctx.strokeStyle = '#e879f9';
          ctx.lineWidth = 2;
          for (let t = -8; t <= 8; t += 8) {
            ctx.beginPath();
            ctx.moveTo(h.x + t, h.y);
            ctx.lineTo(h.x + t + Math.sin(frame * 0.2 + t) * 4, h.y + 14);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => banked[b] - banked[a])[0];

      // Divers + O2 bars
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const d = divers[i];

        // O2 bar above diver
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(d.x - 18, d.y - 28, 36, 5);
        ctx.fillStyle = d.o2 < 30 ? '#fb7185' : '#38bdf8';
        ctx.fillRect(d.x - 18, d.y - 28, (36 * d.o2) / 100, 5);
        if (d.carried > 0) {
          ctx.fillStyle = '#facc15';
          ctx.font = '800 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`+${d.carried}`, d.x, d.y + 28);
        }
        ctx.restore();

        drawPlayerOrb(ctx, d.x, d.y, 15, active[i].color, i, {
          angle: d.angle,
          leader: i === leaderIdx && banked[i] > 0,
          flash: d.flash > 0,
          cooldownPct: d.burstCd / 34,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      const pills: ScorePillData[] = [0, 1, 2, 3].map((s) => ({
        slot: s,
        name: active[s].name,
        color: active[s].color,
        active: active[s].enabled,
        valueText: `${banked[s]} (+${divers[s].carried})`,
        highlight: s === leaderIdx && banked[s] > 0,
      }));
      drawTopScoreboard(
        ctx,
        pills,
        `TIME ${Math.ceil(roundTimer / 60)}s · A: SWIM BURST · PEARLS +10 · GEMS +25 · CHESTS +50`,
      );

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 54. MIRROR BLADES (Samurai Charge Dash-Slash & Timed Mirror Parry!)
export function createMirrorBladesEngine(): MiniGameEngine {
  const TARGET_SCORE = 150;
  const ARENA_L = 48;
  const ARENA_R = GAME_WIDTH - 48;
  const ARENA_T = 80;
  const ARENA_B = GAME_HEIGHT - 42;

  const scores = [0, 0, 0, 0];
  let bannerTimer = 70;
  let bannerTitle = 'MIRROR BLADES';
  let bannerSub = 'HOLD/RELEASE A: DASH-SLICE · B: TIMED PARRY REFLECTS SLASH!';
  let bannerColor = '#fb7185';
  let matchOver = false;
  const prevB = [false, false, false, false];

  interface SlashLine {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    life: number;
  }
  let slashes: SlashLine[] = [];

  const samurai = [0, 1, 2, 3].map((i) => ({
    x: i % 2 === 0 ? 180 : GAME_WIDTH - 180,
    y: i < 2 ? 165 : 405,
    angle: i % 2 === 0 ? 0 : Math.PI,
    charge: 0,
    parryTimer: 0,
    parryCd: 0,
    stunTimer: 0,
    respawn: 0,
    flash: 0,
    slashCd: 0,
  }));

  function resetAll() {
    scores.fill(0);
    slashes = [];
    for (let i = 0; i < 4; i++) {
      samurai[i].x = i % 2 === 0 ? 180 : GAME_WIDTH - 180;
      samurai[i].y = i < 2 ? 165 : 405;
      samurai[i].charge = 0;
      samurai[i].parryTimer = 0;
      samurai[i].parryCd = 0;
      samurai[i].stunTimer = 0;
      samurai[i].respawn = 0;
      samurai[i].slashCd = 0;
    }
  }

  function pointSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble } = env;
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

      slashes = slashes.filter((sl) => {
        sl.life--;
        return sl.life > 0;
      });

      if (bannerTimer <= 10 && !matchOver) {
        for (let i = 0; i < 4 && !matchOver; i++) {
          if (!active[i].enabled) continue;
          const s = samurai[i];
          if (s.parryTimer > 0) s.parryTimer--;
          if (s.parryCd > 0) s.parryCd--;
          if (s.stunTimer > 0) s.stunTimer--;
          if (s.slashCd > 0) s.slashCd--;
          if (s.flash > 0) s.flash--;

          if (s.respawn > 0) {
            s.respawn--;
            if (active[i].isHuman) prevB[i] = readPlayerInput(i, pads, keys).actionB;
            if (s.respawn === 0) {
              s.x = 120 + Math.random() * (GAME_WIDTH - 240);
              s.y = 120 + Math.random() * (GAME_HEIGHT - 220);
              vfx.ring(s.x, s.y, active[i].color, 36, 2);
              sound.beep(660, 0.05, 'sine', 0.05);
            }
            continue;
          }

          if (s.stunTimer > 0) continue;

          let ix = 0;
          let iy = 0;
          let holdA = false;
          let tapB = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            holdA = inp.actionA;
            tapB = inp.actionB && !prevB[i];
            prevB[i] = inp.actionB;
          } else {
            // Samurai bot
            let targetIdx = -1;
            let bestDist = 9999;
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled || samurai[j].respawn > 0) continue;
              const d = Math.hypot(samurai[j].x - s.x, samurai[j].y - s.y);
              if (d < bestDist) {
                bestDist = d;
                targetIdx = j;
              }
            }
            if (targetIdx >= 0) {
              const t = samurai[targetIdx];
              const dx = t.x - s.x;
              const dy = t.y - s.y;
              ix = (dx / (bestDist || 1)) * 0.85;
              iy = (dy / (bestDist || 1)) * 0.85;
              if (t.charge > 12 && bestDist < 175 && s.parryCd === 0 && Math.random() < 0.14) {
                tapB = true;
              } else if (bestDist < 185 && s.slashCd === 0) {
                holdA = s.charge < 12;
              }
            }
          }

          if (Math.hypot(ix, iy) > 0.15) {
            s.angle = Math.atan2(iy, ix);
          }

          if (tapB && s.parryCd === 0 && s.charge === 0) {
            s.parryTimer = 15;
            s.parryCd = 42;
            sound.beep(780, 0.06, 'sine', 0.09);
            vfx.ring(s.x, s.y, '#38bdf8', 38, 2.5);
          }

          if (holdA && s.slashCd === 0 && s.parryTimer === 0) {
            if (s.charge === 29) {
              // Full-charge ready cue
              sound.beep(1180, 0.05, 'triangle', 0.06);
              vfx.ring(s.x, s.y, active[i].color, 30, 2);
            }
            s.charge = Math.min(30, s.charge + 1);
            // Slow crouch while charging
            s.x = Math.max(ARENA_L + 18, Math.min(ARENA_R - 18, s.x + ix * 1.4));
            s.y = Math.max(ARENA_T + 18, Math.min(ARENA_B - 18, s.y + iy * 1.4));
          } else if (!holdA && s.charge > 0) {
            // Execute Dash-Slice!
            const dashDist = 90 + s.charge * 4.5;
            const startX = s.x;
            const startY = s.y;
            const endX = Math.max(ARENA_L + 18, Math.min(ARENA_R - 18, s.x + Math.cos(s.angle) * dashDist));
            const endY = Math.max(ARENA_T + 18, Math.min(ARENA_B - 18, s.y + Math.sin(s.angle) * dashDist));

            s.charge = 0;
            s.slashCd = 24;
            s.x = endX;
            s.y = endY;

            slashes.push({ x1: startX, y1: startY, x2: endX, y2: endY, color: active[i].color, life: 16 });
            sound.sweep(900, 220, 0.1, 'sawtooth', 0.11);
            vfx.afterimage(startX, startY, 15, active[i].color, 10);
            vfx.afterimage((startX + endX) / 2, (startY + endY) / 2, 15, active[i].color, 10);

            // Check hits along slash line
            let parried = false;
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled || samurai[j].respawn > 0) continue;
              const rival = samurai[j];
              if (pointSegDist(rival.x, rival.y, startX, startY, endX, endY) < 28) {
                if (rival.parryTimer > 0) {
                  // MIRROR PARRY REFLECT!
                  parried = true;
                  scores[j] += 35;
                  s.respawn = 65;
                  s.charge = 0;
                  s.parryTimer = 0;
                  rival.flash = 10;
                  sound.explosion();
                  vfx.hitstop(3);
                  vfx.shake(11);
                  vfx.flash('#38bdf8', 0.25);
                  vfx.bolt(rival.x, rival.y, endX, endY, '#38bdf8');
                  vfx.burst(rival.x, rival.y, '#38bdf8', 22, 6);
                  vfx.popup(rival.x, rival.y - 26, 'MIRROR PARRY +35!', '#38bdf8', 16);
                  rumble(j, 110, 0.8);
                  rumble(i, 160, 0.95);
                  checkWin(j);
                  break;
                } else {
                  scores[i] += 25;
                  rival.respawn = 65;
                  // A sliced samurai loses its wind-up; otherwise the stored charge
                  // auto-fired a dash the moment it respawned.
                  rival.charge = 0;
                  rival.parryTimer = 0;
                  s.flash = 8;
                  sound.explosion();
                  vfx.hitstop(3);
                  vfx.shake(9);
                  vfx.flash(active[i].color, 0.18);
                  vfx.burst(rival.x, rival.y, active[i].color, 22, 6);
                  vfx.popup(rival.x, rival.y - 24, 'SLICE +25!', active[i].color, 15);
                  rumble(i, 90, 0.7);
                  rumble(j, 140, 0.85);
                  checkWin(i);
                  if (matchOver) break;
                }
              }
            }
            if (parried) continue;
          } else {
            s.x = Math.max(ARENA_L + 18, Math.min(ARENA_R - 18, s.x + ix * 4.2));
            s.y = Math.max(ARENA_T + 18, Math.min(ARENA_B - 18, s.y + iy * 4.2));
          }
        }
      }

      function checkWin(slot: number) {
        if (!matchOver && scores[slot] >= TARGET_SCORE) {
          matchOver = true;
          bannerTitle = `${active[slot].name} IS BLADE MASTER!`;
          bannerSub = `FIRST TO ${TARGET_SCORE} PTS`;
          bannerColor = active[slot].color;
          bannerTimer = 135;
          sound.win();
          vfx.flash(active[slot].color, 0.3);
          vfx.confetti(GAME_WIDTH / 2, 220, 65);
          vfx.confetti(samurai[slot].x, samurai[slot].y, 30);
          rumble(slot, 200, 0.85);
        }
      }

      // Render Dojo Arena
      drawArcadeBackdrop(ctx, '#fb7185');

      // Decorative dojo ring
      ctx.save();
      ctx.strokeStyle = 'rgba(251, 113, 133, 0.2)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(GAME_WIDTH / 2, 288, 155, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Katana slash trails
      for (const sl of slashes) {
        ctx.save();
        ctx.globalAlpha = sl.life / 16;
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = sl.color;
        ctx.shadowBlur = 18;
        ctx.lineWidth = 6 * (sl.life / 16);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sl.x1, sl.y1);
        ctx.lineTo(sl.x2, sl.y2);
        ctx.stroke();
        ctx.restore();
      }

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => scores[b] - scores[a])[0];

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || samurai[i].respawn > 0) continue;
        const s = samurai[i];

        // Charge aim telegraph laser
        if (s.charge > 0) {
          const previewDist = 90 + s.charge * 4.5;
          ctx.save();
          ctx.strokeStyle = active[i].color;
          ctx.globalAlpha = 0.45;
          ctx.setLineDash([6, 6]);
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x + Math.cos(s.angle) * previewDist, s.y + Math.sin(s.angle) * previewDist);
          ctx.stroke();
          ctx.restore();
        }

        drawPlayerOrb(ctx, s.x, s.y, 16, active[i].color, i, {
          angle: s.angle,
          leader: i === leaderIdx && scores[i] > 0,
          shield: s.parryTimer > 0,
          flash: s.flash > 0,
          cooldownPct: s.slashCd / 24,
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
      drawTopScoreboard(ctx, pills, 'HOLD/RELEASE A: DASH-SLICE · B: TIMED PARRY REFLECT');

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 55. ASTEROID BOWLING (4-Lane Cosmic Pin Smashing, Curve Spin, Strikes & Spares!)
export function createAsteroidBowlingEngine(): MiniGameEngine {
  const MAX_FRAMES = 5;
  const LANE_W = 196;
  const LANE_GAP = 18;
  const TOTAL_W = LANE_W * 4 + LANE_GAP * 3;
  const START_X = (GAME_WIDTH - TOTAL_W) / 2;
  const LANE_TOP = 84;
  const LANE_BOTTOM = GAME_HEIGHT - 44;

  interface Pin {
    x: number;
    y: number;
    vx: number;
    vy: number;
    standing: boolean;
  }

  function makePins(laneCenterX: number): Pin[] {
    const pins: Pin[] = [];
    const rows = [0, 1, 2, 3];
    for (const r of rows) {
      const count = r + 1;
      const y = LANE_TOP + 76 - r * 17;
      for (let c = 0; c < count; c++) {
        const x = laneCenterX + (c - (count - 1) / 2) * 22;
        pins.push({ x, y, vx: 0, vy: 0, standing: true });
      }
    }
    return pins;
  }

  const lanes = [0, 1, 2, 3].map((i) => {
    const cx = START_X + i * (LANE_W + LANE_GAP) + LANE_W / 2;
    return {
      cx,
      score: 0,
      bowlFrame: 1,
      ballInFrame: 1 as 1 | 2,
      phase: 'aim' as 'aim' | 'power' | 'roll' | 'settle' | 'done',
      aimX: cx,
      aimAngle: -Math.PI / 2,
      power: 0.7,
      ballX: cx,
      ballY: LANE_BOTTOM - 26,
      ballVx: 0,
      ballVy: 0,
      spin: 0,
      settleTimer: 0,
      pins: makePins(cx),
      botWait: 30,
      lastResult: '',
    };
  });

  let bannerTimer = 70;
  let bannerTitle = 'ASTEROID BOWLING';
  let bannerSub = 'STICK: POSITION & CURVE · A: LOCK AIM -> POWER -> ROLL!';
  let bannerColor = '#c084fc';
  let matchOver = false;
  const prevA = [false, false, false, false];

  // Knocked-pin physics shared by the roll AND settle phases so chain reactions keep
  // going after the ball leaves the deck. Pins bounce off the lane gutters instead of
  // flying into neighbouring lanes. Returns how many standing pins were newly toppled.
  function stepPins(l: (typeof lanes)[number], damping: number) {
    let toppled = 0;
    const minX = l.cx - LANE_W / 2 + 8;
    const maxX = l.cx + LANE_W / 2 - 8;
    for (const p1 of l.pins) {
      if (p1.standing) continue;
      p1.x += p1.vx;
      p1.y += p1.vy;
      p1.vx *= damping;
      p1.vy *= damping;
      if (p1.x < minX) {
        p1.x = minX;
        p1.vx = Math.abs(p1.vx) * 0.5;
      } else if (p1.x > maxX) {
        p1.x = maxX;
        p1.vx = -Math.abs(p1.vx) * 0.5;
      }
      if (p1.y < LANE_TOP + 8) {
        p1.y = LANE_TOP + 8;
        p1.vy = Math.abs(p1.vy) * 0.4;
      }
      if (Math.abs(p1.vx) + Math.abs(p1.vy) < 0.35) continue; // resting pins don't topple others
      for (const p2 of l.pins) {
        if (!p2.standing) continue;
        if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 18) {
          p2.standing = false;
          p2.vx = p1.vx * 0.8 + (p2.x - p1.x) * 0.3;
          p2.vy = p1.vy * 0.8 + (p2.y - p1.y) * 0.3;
          toppled++;
        }
      }
    }
    return toppled;
  }

  function resetMatch() {
    for (let i = 0; i < 4; i++) {
      const l = lanes[i];
      l.score = 0;
      l.bowlFrame = 1;
      l.ballInFrame = 1;
      l.phase = 'aim';
      l.aimX = l.cx;
      l.ballX = l.cx;
      l.ballY = LANE_BOTTOM - 26;
      l.pins = makePins(l.cx);
      l.lastResult = '';
      l.botWait = 30;
      l.power = 0.7;
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
          resetMatch();
        }
      }

      if (bannerTimer <= 10 && !matchOver) {
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const l = lanes[i];
          if (l.phase === 'done') continue;

          let ix = 0;
          let tapA = false;
          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            tapA = inp.actionA && !prevA[i];
            prevA[i] = inp.actionA;
          } else {
            l.botWait--;
            if (l.phase === 'aim') {
              l.aimX += Math.sin(frame * 0.05 + i) * 0.8;
              if (l.botWait <= 0 && Math.abs(l.aimAngle + Math.PI / 2) < 0.14) {
                tapA = true;
                l.botWait = 18;
              }
            } else if (l.phase === 'power') {
              if (l.botWait <= 0 && l.power > 0.72) {
                tapA = true;
              }
            } else if (l.phase === 'roll') {
              ix = (l.cx - l.ballX) * 0.02;
            }
          }

          if (l.phase === 'aim') {
            l.aimX = Math.max(l.cx - 65, Math.min(l.cx + 65, l.aimX + ix * 2.5));
            l.ballX = l.aimX;
            l.ballY = LANE_BOTTOM - 26;
            l.aimAngle = -Math.PI / 2 + Math.sin(frame * 0.075 + i) * 0.36;
            if (tapA) {
              l.phase = 'power';
              sound.beep(520, 0.05, 'triangle', 0.07);
            }
          } else if (l.phase === 'power') {
            l.power = 0.45 + ((Math.sin(frame * 0.14 + i) + 1) * 0.5) * 0.55;
            if (tapA) {
              l.phase = 'roll';
              const spd = 7.2 + l.power * 5.2;
              l.ballVx = Math.cos(l.aimAngle) * spd;
              l.ballVy = Math.sin(l.aimAngle) * spd;
              l.spin = 0;
              sound.dash();
              vfx.burst(l.ballX, l.ballY, active[i].color, 10, 4);
            }
          } else if (l.phase === 'roll') {
            // Curve spin control
            l.spin = ix * 0.12;
            l.ballVx += l.spin;
            l.ballX += l.ballVx;
            l.ballY += l.ballVy;

            // Keep inside gutter walls (gutters slow or deflect slightly)
            if (l.ballX < l.cx - LANE_W / 2 + 12) {
              l.ballX = l.cx - LANE_W / 2 + 12;
              if (l.ballVx < -1) {
                sound.beep(180, 0.04, 'square', 0.04);
                vfx.spark(l.ballX, l.ballY, 2, 0, '#94a3b8', 3);
              }
              l.ballVx = Math.abs(l.ballVx) * 0.4;
            } else if (l.ballX > l.cx + LANE_W / 2 - 12) {
              l.ballX = l.cx + LANE_W / 2 - 12;
              if (l.ballVx > 1) {
                sound.beep(180, 0.04, 'square', 0.04);
                vfx.spark(l.ballX, l.ballY, -2, 0, '#94a3b8', 3);
              }
              l.ballVx = -Math.abs(l.ballVx) * 0.4;
            }

            if (frame % 2 === 0) vfx.afterimage(l.ballX, l.ballY, 11, active[i].color, 7);

            // Pin collisions (one impact sound per frame so a full rack doesn't stack 10 oscillators)
            let ballHits = 0;
            for (const p of l.pins) {
              if (!p.standing) continue;
              const d = Math.hypot(l.ballX - p.x, l.ballY - p.y);
              if (d < 20) {
                p.standing = false;
                const ang = Math.atan2(p.y - l.ballY, p.x - l.ballX);
                p.vx = Math.cos(ang) * 5.5 + l.ballVx * 0.4;
                p.vy = Math.sin(ang) * 5.5 + l.ballVy * 0.35;
                vfx.burst(p.x, p.y, '#facc15', 7, 3.5);
                ballHits++;
              }
            }
            if (ballHits > 0) {
              sound.hit();
              vfx.shake(Math.min(6, 2 + ballHits));
              rumble(i, 45 + ballHits * 15, 0.5);
            }

            // Pin-to-pin chain reaction
            if (stepPins(l, 0.92) > 0) {
              sound.beep(640, 0.03, 'triangle', 0.05);
              vfx.burst(l.cx, LANE_TOP + 55, '#facc15', 4, 2.5);
            }

            if (l.ballY < LANE_TOP + 10) {
              l.phase = 'settle';
              l.settleTimer = 36;
            }
          } else if (l.phase === 'settle') {
            if (stepPins(l, 0.9) > 0) {
              sound.beep(640, 0.03, 'triangle', 0.05);
            }
            l.settleTimer--;
            if (l.settleTimer <= 0) {
              const standingCount = l.pins.filter((p) => p.standing).length;
              const knockedTotal = 10 - standingCount;

              if (l.ballInFrame === 1 && standingCount === 0) {
                // STRIKE!
                l.score += 30;
                l.lastResult = 'STRIKE!';
                sound.combo(6);
                sound.explosion();
                vfx.hitstop(3);
                vfx.shake(7);
                vfx.flash(active[i].color, 0.18);
                vfx.ring(l.cx, LANE_TOP + 60, '#facc15', 80, 4);
                vfx.confetti(l.cx, LANE_TOP + 60, 24);
                vfx.popup(l.cx, LANE_TOP + 90, 'STRIKE! +30', '#facc15', 16);
                rumble(i, 160, 0.85);
                advanceFrame(l);
              } else if (l.ballInFrame === 1) {
                l.score += knockedTotal * 2;
                l.ballInFrame = 2;
                l.phase = 'aim';
                l.ballX = l.aimX;
                l.ballY = LANE_BOTTOM - 26;
                l.pins = l.pins.filter((p) => p.standing);
                l.botWait = 20;
                vfx.popup(l.cx, LANE_TOP + 90, `${knockedTotal} PINS!`, active[i].color, 13);
              } else {
                const spare = standingCount === 0;
                const bonus = spare ? 15 : 0;
                const newlyKnocked = l.pins.length - standingCount;
                l.score += newlyKnocked * 2 + bonus;
                l.lastResult = spare ? 'SPARE!' : '';
                if (spare) {
                  sound.combo(4);
                  vfx.burst(l.cx, LANE_TOP + 60, '#2ee59d', 18, 5);
                  vfx.ring(l.cx, LANE_TOP + 60, '#2ee59d', 60, 3);
                  vfx.popup(l.cx, LANE_TOP + 90, 'SPARE! +15', '#2ee59d', 15);
                  rumble(i, 100, 0.6);
                }
                advanceFrame(l);
              }
            }
          }
        }

        const allDone = active.every((a, idx) => !a.enabled || lanes[idx].phase === 'done');
        if (allDone) {
          const winner = [0, 1, 2, 3]
            .filter((idx) => active[idx].enabled)
            .sort((a, b) => lanes[b].score - lanes[a].score)[0] ?? 0;
          matchOver = true;
          bannerTitle = `${active[winner].name} BOWLS A VICTORY!`;
          bannerSub = `FINAL SCORE: ${lanes[winner].score} PTS`;
          bannerColor = active[winner].color;
          bannerTimer = 140;
          sound.win();
          vfx.flash(active[winner].color, 0.3);
          vfx.confetti(GAME_WIDTH / 2, 220, 70);
          vfx.confetti(lanes[winner].cx, LANE_TOP + 80, 35);
          rumble(winner, 200, 0.85);
        }
      }

      function advanceFrame(l: (typeof lanes)[number]) {
        if (l.bowlFrame >= MAX_FRAMES) {
          l.phase = 'done';
        } else {
          l.bowlFrame++;
          l.ballInFrame = 1;
          l.phase = 'aim';
          l.ballX = l.aimX;
          l.ballY = LANE_BOTTOM - 26;
          l.pins = makePins(l.cx);
          l.botWait = 24;
        }
      }

      // Render 4 Cosmic Lanes
      drawArcadeBackdrop(ctx, '#c084fc');

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => lanes[b].score - lanes[a].score)[0];

      for (let i = 0; i < 4; i++) {
        const l = lanes[i];
        const lx = l.cx - LANE_W / 2;

        ctx.save();
        ctx.fillStyle = active[i].enabled ? 'rgba(15, 23, 42, 0.88)' : 'rgba(15, 23, 42, 0.35)';
        ctx.strokeStyle = active[i].enabled ? active[i].color : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = i === leaderIdx && l.score > 0 ? 3 : 1.5;
        ctx.beginPath();
        ctx.roundRect(lx, LANE_TOP, LANE_W, LANE_BOTTOM - LANE_TOP, 10);
        ctx.fill();
        ctx.stroke();

        // Lane guide chevrons
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(l.cx, LANE_TOP + 90);
        ctx.lineTo(l.cx, LANE_BOTTOM - 50);
        ctx.stroke();

        // Frame badge
        ctx.fillStyle = active[i].enabled ? active[i].color : '#475569';
        ctx.font = '800 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          active[i].enabled
            ? l.phase === 'done'
              ? 'FINISHED'
              : `FRAME ${l.bowlFrame}/${MAX_FRAMES} · B${l.ballInFrame}`
            : 'OPEN LANE',
          l.cx,
          LANE_BOTTOM - 6,
        );
        ctx.restore();

        if (!active[i].enabled) continue;

        // Pins
        for (const p of l.pins) {
          ctx.save();
          ctx.fillStyle = p.standing ? '#f8fafc' : '#64748b';
          ctx.strokeStyle = p.standing ? '#facc15' : '#475569';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        // Aim arrow & power meter
        if (l.phase === 'aim' || l.phase === 'power') {
          ctx.save();
          ctx.strokeStyle = active[i].color;
          ctx.lineWidth = 3;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(l.ballX, l.ballY);
          ctx.lineTo(l.ballX + Math.cos(l.aimAngle) * 75, l.ballY + Math.sin(l.aimAngle) * 75);
          ctx.stroke();
          ctx.restore();

          if (l.phase === 'power') {
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(l.cx - 45, LANE_BOTTOM - 55, 90, 8);
            ctx.fillStyle = l.power > 0.8 ? '#2ee59d' : '#facc15';
            ctx.fillRect(l.cx - 45, LANE_BOTTOM - 55, 90 * l.power, 8);
            ctx.restore();
          }
        }

        // Bowling ball
        if (l.phase !== 'done') {
          drawPlayerOrb(ctx, l.ballX, l.ballY, 12, active[i].color, i, {
            leader: i === leaderIdx && l.score > 0,
            label: '',
          });
        }
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      const pills: ScorePillData[] = [0, 1, 2, 3].map((s) => ({
        slot: s,
        name: active[s].name,
        color: active[s].color,
        active: active[s].enabled,
        valueText: `${lanes[s].score} PTS`,
        highlight: s === leaderIdx && lanes[s].score > 0,
      }));
      drawTopScoreboard(
        ctx,
        pills,
        'STICK: POSITION & CURVE · A: LOCK AIM & POWER · 5 FRAMES',
      );

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}
