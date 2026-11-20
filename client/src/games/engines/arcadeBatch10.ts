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

// 46. METEOR TENNIS 2v2 (Lob, Smash, Dive-Dash & Fireball Rallies!)
export function createMeteorTennisEngine(): MiniGameEngine {
  const TEAM_WIN_SCORE = 7;
  const COURT_LEFT = 58;
  const COURT_RIGHT = GAME_WIDTH - 58;
  const COURT_TOP = 84;
  const COURT_BOTTOM = GAME_HEIGHT - 44;
  const NET_X = GAME_WIDTH / 2;

  let teamScore = [0, 0]; // [Left Team (P1+P3), Right Team (P2+P4)]
  let rally = 0;
  let maxRally = 0;
  let netRipple = 0;
  let roundBannerTimer = 75;
  let bannerTitle = 'METEOR TENNIS 2v2';
  let bannerSub = 'P1+P3 vs P2+P4 · A: SWING/SMASH · B: DIVE DASH';
  let bannerColor = '#ff6b2b';
  let matchOver = false;

  const prevA = [false, false, false, false];
  const prevB = [false, false, false, false];

  const playersState = [0, 1, 2, 3].map((slot) => {
    const isLeft = slot % 2 === 0;
    const isTop = slot < 2;
    return {
      x: isLeft ? 190 : GAME_WIDTH - 190,
      y: isTop ? 195 : 375,
      vx: 0,
      vy: 0,
      charge: 0,
      swingTimer: 0,
      dashTimer: 0,
      dashCd: 0,
      flash: 0,
      facing: isLeft ? 0 : Math.PI,
    };
  });

  const ball = {
    x: NET_X - 120,
    y: 285,
    z: 36,
    vx: 4.5,
    vy: 1.2,
    vz: 3.0,
    fireLevel: 0,
    lastHitter: 0,
    bouncesOnSide: 0,
    side: 0, // 0 = left, 1 = right
    serveTimer: 45,
    smashed: false,
  };
  // Per-bot swing intent (charge target) so CPU players mix soft returns & smashes
  const botChargeGoal = [8, 8, 8, 8];

  function resetPositions(serveToSide: number) {
    for (let i = 0; i < 4; i++) {
      const isLeft = i % 2 === 0;
      const isTop = i < 2;
      playersState[i].x = isLeft ? 185 : GAME_WIDTH - 185;
      playersState[i].y = isTop ? 195 : 375;
      playersState[i].vx = 0;
      playersState[i].vy = 0;
      playersState[i].charge = 0;
      playersState[i].swingTimer = 0;
      playersState[i].dashTimer = 0;
    }
    rally = 0;
    ball.fireLevel = 0;
    ball.bouncesOnSide = 0;
    ball.side = serveToSide;
    ball.x = serveToSide === 0 ? 220 : GAME_WIDTH - 220;
    ball.y = 285;
    ball.z = 48;
    ball.vx = serveToSide === 0 ? 4.2 : -4.2;
    ball.vy = (Math.random() - 0.5) * 2.2;
    ball.vz = 3.6;
    ball.serveTimer = 38;
    ball.smashed = false;
    ball.lastHitter = -1;
  }

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });
      // A team with nobody on it (e.g. solo play with bots off) becomes a rebound practice wall
      const teamEnabled = [
        active[0].enabled || active[2].enabled,
        active[1].enabled || active[3].enabled,
      ];
      let pointScored = false;

      vfx.beginCamera(ctx);

      if (roundBannerTimer > 0) {
        roundBannerTimer--;
        if (roundBannerTimer === 0 && matchOver) {
          teamScore = [0, 0];
          maxRally = 0;
          matchOver = false;
          resetPositions(0);
        }
      }

      if (netRipple > 0.2) netRipple *= 0.9;
      else netRipple = 0;

      // Update players
      for (let i = 0; i < 4; i++) {
        const p = playersState[i];
        const isLeft = i % 2 === 0;
        if (p.swingTimer > 0) p.swingTimer--;
        if (p.dashTimer > 0) p.dashTimer--;
        if (p.dashCd > 0) p.dashCd--;
        if (p.flash > 0) p.flash--;

        if (!active[i].enabled) continue;

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
          prevA[i] = inp.actionA;
          prevB[i] = inp.actionB;
        } else {
          // Smart 2v2 tennis bot
          const partnerIdx = isLeft ? (i === 0 ? 2 : 0) : i === 1 ? 3 : 1;
          const ballOnMySide = (ball.x < NET_X && isLeft) || (ball.x >= NET_X && !isLeft);
          const homeX = isLeft ? (i === 0 ? 150 : 270) : i === 1 ? GAME_WIDTH - 150 : GAME_WIDTH - 270;
          const homeY = i < 2 ? 190 : 380;

          const partnerDist = Math.hypot(playersState[partnerIdx].x - ball.x, playersState[partnerIdx].y - ball.y);
          const myDist = Math.hypot(p.x - ball.x, p.y - ball.y);
          const shouldChase = ballOnMySide && (myDist <= partnerDist + 24 || !active[partnerIdx].enabled);

          const targetX = shouldChase ? ball.x + (isLeft ? -22 : 22) : homeX;
          const targetY = shouldChase ? ball.y : homeY;
          const dx = targetX - p.x;
          const dy = targetY - p.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist > 8) {
            ix = (dx / dist) * 0.85;
            iy = (dy / dist) * 0.85;
          }
          // Wind up early as the ball approaches, release when it is inside racket reach.
          const ballIncoming = isLeft ? ball.vx < 0 : ball.vx > 0;
          if (shouldChase && p.swingTimer === 0 && ball.serveTimer <= 0 && !matchOver) {
            if (p.charge === 0) {
              if (myDist < 150 && (ballIncoming || ballOnMySide)) {
                holdA = true;
                botChargeGoal[i] = Math.random() < 0.32 ? 16 : 5;
              }
            } else {
              holdA = true;
              const inReach = myDist < 40 && ball.z < 70;
              if (inReach && (p.charge >= botChargeGoal[i] || myDist < 30)) holdA = false;
              else if (p.charge >= 28 && myDist < 50) holdA = false;
            }
          } else if (p.charge > 0 && !ballOnMySide && !ballIncoming) {
            holdA = false;
          }
          if (shouldChase && myDist > 125 && ball.z < 26 && p.dashCd === 0 && Math.random() < 0.04) {
            tapB = true;
          }
        }

        if (tapB && p.dashCd === 0 && p.dashTimer === 0) {
          const mag = Math.hypot(ix, iy);
          const ang = mag > 0.1 ? Math.atan2(iy, ix) : p.facing;
          p.vx = Math.cos(ang) * 11.5;
          p.vy = Math.sin(ang) * 11.5;
          p.dashTimer = 11;
          p.dashCd = 42;
          sound.dash();
          vfx.burst(p.x, p.y, '#e2e8f0', 8, 3.2, 3, 0);
        }

        if (p.dashTimer > 0) {
          vfx.afterimage(p.x, p.y, 16, active[i].color, 8);
        } else {
          const speed = p.charge > 0 ? 3.2 : 4.9;
          p.vx = p.vx * 0.65 + ix * speed * 0.35;
          p.vy = p.vy * 0.65 + iy * speed * 0.35;
        }

        p.x += p.vx;
        p.y += p.vy;

        // Keep each team on its own half
        const minX = isLeft ? COURT_LEFT + 18 : NET_X + 24;
        const maxX = isLeft ? NET_X - 24 : COURT_RIGHT - 18;
        p.x = Math.max(minX, Math.min(maxX, p.x));
        p.y = Math.max(COURT_TOP + 18, Math.min(COURT_BOTTOM - 18, p.y));

        if (Math.hypot(ix, iy) > 0.2) {
          p.facing = Math.atan2(iy, ix);
        } else {
          p.facing = isLeft ? 0 : Math.PI;
        }

        // Charge & Swing
        if (holdA && p.swingTimer === 0) {
          p.charge = Math.min(28, p.charge + 1);
        } else if (!holdA && p.charge > 0) {
          p.swingTimer = 14;
          const isSmash = p.charge >= 14;
          p.charge = 0;
          sound.sweep(isSmash ? 280 : 420, isSmash ? 820 : 640, 0.08, 'triangle', 0.09);

          // Check hit on ball
          const reach = p.dashTimer > 0 ? 58 : 48;
          const distToBall = Math.hypot(ball.x - p.x, ball.y - p.y);
          if (distToBall < reach && ball.z < 75 && ball.serveTimer <= 0 && !matchOver) {
            const dirX = isLeft ? 1 : -1;
            const aimY = iy * 3.4 + (Math.random() - 0.5) * 0.8;
            const spdBoost = isSmash ? 9.4 : 6.4;
            const rallyBoost = Math.min(3.5, rally * 0.32);
            ball.vx = dirX * (spdBoost + rallyBoost);
            ball.vy = aimY;
            ball.vz = isSmash ? 1.8 : 4.8;
            ball.fireLevel = isSmash ? Math.min(3, ball.fireLevel + 1) : Math.max(0, ball.fireLevel);
            if (rally >= 5) ball.fireLevel = Math.max(1, ball.fireLevel);

            rally++;
            maxRally = Math.max(maxRally, rally);
            ball.lastHitter = i;
            ball.bouncesOnSide = 0;
            ball.smashed = isSmash;
            p.flash = 8;

            sound.combo(rally);
            if (isSmash) {
              sound.hit();
              vfx.hitstop(2);
              vfx.shake(7);
              vfx.ring(ball.x, ball.y, '#ff6b2b', 58, 3.5);
              vfx.burst(ball.x, ball.y, '#facc15', 16, 5.5);
              vfx.popup(ball.x, ball.y - 24, `SMASH x${rally}!`, '#ff6b2b', 15);
              rumble(i, 120, 0.85);
            } else {
              vfx.ring(ball.x, ball.y, active[i].color, 36, 2);
              vfx.burst(ball.x, ball.y, active[i].color, 8, 3.5);
              if (rally >= 3) {
                vfx.popup(ball.x, ball.y - 20, `RALLY ${rally}`, '#38bdf8', 12);
              }
              rumble(i, 60, 0.4);
            }
          }
        }
      }

      // Ball physics
      if (!matchOver && roundBannerTimer <= 10) {
        if (ball.serveTimer > 0) {
          ball.serveTimer--;
        } else {
          const prevX = ball.x;
          ball.x += ball.vx;
          ball.y += ball.vy;
          ball.z += ball.vz;
          ball.vz -= 0.21;

          // Net crossing ripple
          if ((prevX < NET_X && ball.x >= NET_X) || (prevX >= NET_X && ball.x < NET_X)) {
            if (ball.z < 14) {
              // Hit net!
              ball.vx *= -0.45;
              ball.vz = 2.5;
              netRipple = 12;
              sound.noiseBurst(0.08, 700, 0.1);
              vfx.burst(NET_X, ball.y, '#38bdf8', 8, 3);
            } else {
              netRipple = 7 + ball.fireLevel * 3;
              ball.side = ball.x < NET_X ? 0 : 1;
              ball.bouncesOnSide = 0;
            }
          }

          // Side wall cushion bounce inside court boundaries
          if (ball.y < COURT_TOP + 10) {
            ball.y = COURT_TOP + 10;
            ball.vy = Math.abs(ball.vy) * 0.92;
            vfx.spark(ball.x, ball.y, 0, 2, '#38bdf8', 3);
          } else if (ball.y > COURT_BOTTOM - 10) {
            ball.y = COURT_BOTTOM - 10;
            ball.vy = -Math.abs(ball.vy) * 0.92;
            vfx.spark(ball.x, ball.y, 0, -2, '#38bdf8', 3);
          }

          // Floor bounce
          if (ball.z <= 0) {
            ball.z = 0;
            ball.vz = Math.max(2.6, Math.abs(ball.vz) * 0.78);
            ball.bouncesOnSide++;
            vfx.ring(ball.x, ball.y, ball.fireLevel > 0 ? '#ff6b2b' : '#2ee59d', 28, 2);
            sound.beep(260 + ball.bouncesOnSide * 90, 0.05, 'sine', 0.07);

            // Double bounce or out of bounds back wall -> opposing team scores
            // (an empty side is a practice wall, so the ball just keeps rolling to it)
            const sideTeam = ball.x < NET_X ? 0 : 1;
            if (ball.bouncesOnSide >= 2 && teamEnabled[sideTeam]) {
              awardPoint(1 - sideTeam, 'DOUBLE BOUNCE!');
            }
          }

          // Practice rebound wall for an empty team: returns a lob, but a SMASH beats it
          if (!pointScored) {
            const wallSide = !teamEnabled[1] && ball.vx > 0 && ball.x > COURT_RIGHT - 12
              ? 1
              : !teamEnabled[0] && ball.vx < 0 && ball.x < COURT_LEFT + 12
                ? 0
                : -1;
            if (wallSide >= 0) {
              if (ball.smashed) {
                awardPoint(1 - wallSide, 'WALL SMASH!');
              } else {
                const dir = wallSide === 1 ? -1 : 1;
                ball.x = wallSide === 1 ? COURT_RIGHT - 12 : COURT_LEFT + 12;
                ball.vx = dir * (7.4 + Math.random() * 1.3 + Math.min(1.5, rally * 0.12));
                ball.vy = (Math.random() - 0.5) * 3;
                ball.z = Math.max(ball.z, 24);
                ball.vz = 5.6;
                ball.bouncesOnSide = 0;
                ball.lastHitter = -1;
                rally++;
                maxRally = Math.max(maxRally, rally);
                netRipple = 6;
                sound.beep(300, 0.06, 'square', 0.06);
                vfx.ring(ball.x, ball.y, '#94a3b8', 40, 2.5);
                vfx.burst(ball.x, ball.y, '#e2e8f0', 8, 3.5);
              }
            }
          }

          // Back wall past court baseline
          if (!pointScored) {
            if (ball.x < COURT_LEFT - 14) {
              awardPoint(1, 'ACE!');
            } else if (ball.x > COURT_RIGHT + 14) {
              awardPoint(0, 'ACE!');
            }
          }

          // Fireball trail
          if (frame % 2 === 0 && (ball.fireLevel > 0 || Math.abs(ball.vx) > 7.5)) {
            vfx.spark(
              ball.x,
              ball.y - ball.z * 0.7,
              -ball.vx * 0.15 + (Math.random() - 0.5),
              (Math.random() - 0.5) * 1.2,
              ball.fireLevel >= 2 ? '#ff6b2b' : '#facc15',
              ball.fireLevel >= 2 ? 4.5 : 3,
            );
          }
        }
      }

      function awardPoint(scoringTeam: number, reason: string) {
        if (pointScored || matchOver) return;
        pointScored = true;
        teamScore[scoringTeam]++;
        const teamCol = scoringTeam === 0 ? '#ff6b2b' : '#38bdf8';
        sound.explosion();
        vfx.hitstop(3);
        vfx.shake(8);
        vfx.flash(teamCol, 0.22);
        vfx.ring(ball.x, ball.y, teamCol, 80, 4);
        vfx.burst(ball.x, ball.y, teamCol, 22, 6);
        vfx.popup(ball.x, Math.max(110, ball.y - 20), `${reason} +1`, '#facc15', 16);
        for (let s = 0; s < 4; s++) {
          if (!active[s].isHuman) continue;
          if (s % 2 === scoringTeam) rumble(s, 90, 0.6);
          else rumble(s, 160, 0.9);
        }

        if (teamScore[scoringTeam] >= TEAM_WIN_SCORE) {
          matchOver = true;
          bannerTitle = scoringTeam === 0 ? 'LEFT SQUAD WINS!' : 'RIGHT SQUAD WINS!';
          bannerSub = `FINAL ${teamScore[0]} - ${teamScore[1]} · BEST RALLY: ${maxRally}`;
          bannerColor = teamCol;
          roundBannerTimer = 140;
          sound.win();
          vfx.flash(teamCol, 0.35);
          vfx.confetti(GAME_WIDTH / 2, 220, 65);
          vfx.confetti(scoringTeam === 0 ? 260 : GAME_WIDTH - 260, 200, 40);
        } else {
          bannerTitle = scoringTeam === 0 ? 'LEFT TEAM SCORES!' : 'RIGHT TEAM SCORES!';
          bannerSub = `${reason} · SCORE ${teamScore[0]} - ${teamScore[1]}`;
          bannerColor = scoringTeam === 0 ? '#ff6b2b' : '#38bdf8';
          roundBannerTimer = 50;
          resetPositions(1 - scoringTeam);
        }
      }

      // Render court
      drawArcadeBackdrop(ctx, '#ff6b2b');

      ctx.save();
      // Court floor
      ctx.fillStyle = 'rgba(14, 24, 42, 0.85)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(COURT_LEFT, COURT_TOP, COURT_RIGHT - COURT_LEFT, COURT_BOTTOM - COURT_TOP, 12);
      ctx.fill();
      ctx.stroke();

      // Service lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(COURT_LEFT, (COURT_TOP + COURT_BOTTOM) / 2);
      ctx.lineTo(COURT_RIGHT, (COURT_TOP + COURT_BOTTOM) / 2);
      ctx.moveTo(COURT_LEFT + 140, COURT_TOP);
      ctx.lineTo(COURT_LEFT + 140, COURT_BOTTOM);
      ctx.moveTo(COURT_RIGHT - 140, COURT_TOP);
      ctx.lineTo(COURT_RIGHT - 140, COURT_BOTTOM);
      ctx.stroke();

      // Team side badges
      ctx.font = '800 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 107, 43, 0.35)';
      ctx.fillText(`LEFT SQUAD: ${teamScore[0]}`, 260, COURT_TOP + 20);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.fillText(`RIGHT SQUAD: ${teamScore[1]}`, GAME_WIDTH - 260, COURT_TOP + 20);

      // Glowing energy net with ripple
      ctx.strokeStyle = '#38bdf8';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let ny = COURT_TOP; ny <= COURT_BOTTOM; ny += 12) {
        const wave = Math.sin(ny * 0.08 + frame * 0.35) * netRipple;
        if (ny === COURT_TOP) ctx.moveTo(NET_X + wave, ny);
        else ctx.lineTo(NET_X + wave, ny);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Practice rebound wall on an empty team's baseline
      for (let t = 0; t < 2; t++) {
        if (teamEnabled[t]) continue;
        const wx = t === 0 ? COURT_LEFT + 4 : COURT_RIGHT - 10;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.fillRect(wx, COURT_TOP + 4, 6, COURT_BOTTOM - COURT_TOP - 8);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.4)';
        ctx.font = '800 11px "JetBrains Mono", monospace';
        ctx.fillText('PRACTICE WALL · SMASH IT TO SCORE', t === 0 ? 260 : GAME_WIDTH - 260, COURT_BOTTOM - 12);
      }
      ctx.restore();

      // Players & swing arcs
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const p = playersState[i];

        // Swing arc
        if (p.swingTimer > 0) {
          ctx.save();
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 5;
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 34, p.facing - 0.9, p.facing + 0.9);
          ctx.stroke();
          ctx.restore();
        }

        // Charge halo
        if (p.charge > 0) {
          ctx.save();
          ctx.strokeStyle = p.charge >= 14 ? '#ff6b2b' : '#facc15';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 24 + p.charge * 0.3, 0, Math.PI * 2 * (p.charge / 28));
          ctx.stroke();
          ctx.restore();
        }

        drawPlayerOrb(ctx, p.x, p.y, 17, active[i].color, i, {
          angle: p.facing,
          flash: p.flash > 0,
          cooldownPct: p.dashCd / 42,
        });
      }

      // Ball shadow + ball
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y + 6, Math.max(5, 11 - ball.z * 0.08), Math.max(3, 6 - ball.z * 0.04), 0, 0, Math.PI * 2);
      ctx.fill();

      const drawY = ball.y - ball.z * 0.7;
      const ballColor = ball.fireLevel >= 2 ? '#ff6b2b' : ball.fireLevel === 1 ? '#facc15' : '#2ee59d';
      ctx.shadowColor = ballColor;
      ctx.shadowBlur = 20;
      ctx.fillStyle = ballColor;
      ctx.beginPath();
      ctx.arc(ball.x, drawY, 10 + ball.fireLevel * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ball.x - 2, drawY - 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      const pills: ScorePillData[] = [0, 1, 2, 3].map((s) => {
        const t = s % 2;
        return {
          slot: s,
          name: active[s].name,
          color: active[s].color,
          active: active[s].enabled,
          valueText: `${t === 0 ? 'L' : 'R'} · ${teamScore[t]}/${TEAM_WIN_SCORE}`,
          highlight: teamScore[t] > teamScore[1 - t],
        };
      });
      drawTopScoreboard(ctx, pills, `RALLY: ${rally} · A: SWING (HOLD=SMASH) · B: DIVE DASH`);

      if (roundBannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 47. VORTEX SURVIVAL (Spinning Black Hole Pull + Thruster Burst + Rim Orbs!)
export function createVortexSurvivalEngine(): MiniGameEngine {
  const CX = GAME_WIDTH / 2;
  const CY = 288;
  const HORIZON_R = 34;
  const ROUND_FRAMES = 45 * 60;

  const wins = [0, 0, 0, 0];
  const score = [0, 0, 0, 0];
  let roundTimer = ROUND_FRAMES;
  let roundBannerTimer = 70;
  let bannerTitle = 'VORTEX SURVIVAL';
  let bannerSub = 'GRAB RIM ORBS · A: THRUSTER BURST · BUMP RIVALS IN!';
  let bannerColor = '#c084fc';
  let matchOver = false;
  // True between a round ending and the next resetRound(); freezes the arena so the
  // end-of-round check can't fire again during the banner's final frames.
  let roundOver = false;
  const prevA = [false, false, false, false];

  const orbs: Array<{ angle: number; dist: number; gold: boolean; pulse: number }> = [];
  const debris: Array<{ angle: number; dist: number; speed: number; size: number; color: string }> = Array.from(
    { length: 28 },
    (_, idx) => ({
      angle: (Math.PI * 2 * idx) / 28,
      dist: 60 + Math.random() * 210,
      speed: 0.012 + Math.random() * 0.02,
      size: 2 + Math.random() * 2.5,
      color: idx % 2 === 0 ? '#c084fc' : '#38bdf8',
    }),
  );

  const ships = [0, 1, 2, 3].map((i) => ({
    x: CX + Math.cos((Math.PI / 2) * i + 0.4) * 175,
    y: CY + Math.sin((Math.PI / 2) * i + 0.4) * 140,
    vx: 0,
    vy: 0,
    alive: true,
    burstCd: 0,
    flash: 0,
    lastHitBy: -1,
    lastHitTimer: 0,
    angle: 0,
  }));

  function spawnOrbs() {
    while (orbs.length < 7) {
      const gold = Math.random() < 0.28;
      orbs.push({
        angle: Math.random() * Math.PI * 2,
        dist: gold ? 78 + Math.random() * 45 : 105 + Math.random() * 95,
        gold,
        pulse: Math.random() * 6,
      });
    }
  }

  function resetRound() {
    roundTimer = ROUND_FRAMES;
    orbs.length = 0;
    spawnOrbs();
    for (let i = 0; i < 4; i++) {
      const ang = (Math.PI / 2) * i + 0.4;
      ships[i].x = CX + Math.cos(ang) * 175;
      ships[i].y = CY + Math.sin(ang) * 140;
      ships[i].vx = 0;
      ships[i].vy = 0;
      ships[i].alive = true;
      ships[i].burstCd = 0;
      ships[i].flash = 0;
      ships[i].lastHitBy = -1;
      ships[i].lastHitTimer = 0;
    }
  }

  spawnOrbs();

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
      } else if (!roundOver) {
        roundTimer = Math.max(0, roundTimer - 1);
      }

      spawnOrbs();
      const gravityStrength = 0.085 + (1 - roundTimer / ROUND_FRAMES) * 0.085;

      // Update swirling background debris
      for (const d of debris) {
        d.angle += d.speed * (160 / Math.max(40, d.dist));
        d.dist -= 0.45;
        if (d.dist < HORIZON_R) d.dist = 240 + Math.random() * 50;
      }

      // Rotate orbs slowly
      for (const o of orbs) {
        o.angle += o.gold ? 0.018 : 0.01;
        o.pulse += 0.1;
      }

      if (roundBannerTimer <= 10 && !roundOver && !matchOver) {
        for (let i = 0; i < 4; i++) {
          const s = ships[i];
          if (!active[i].enabled || !s.alive) continue;
          if (s.burstCd > 0) s.burstCd--;
          if (s.flash > 0) s.flash--;
          if (s.lastHitTimer > 0) {
            s.lastHitTimer--;
            if (s.lastHitTimer === 0) s.lastHitBy = -1;
          }

          let ix = 0;
          let iy = 0;
          let burst = false;

          const dxC = CX - s.x;
          const dyC = CY - s.y;
          const distC = Math.hypot(dxC, dyC) || 1;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            burst = inp.actionA && !prevA[i];
            prevA[i] = inp.actionA;
          } else {
            // Bot: escape inner danger, else grab safest orb or bump nearby player
            if (distC < 105) {
              ix = -dxC / distC;
              iy = -dyC / distC;
              if (distC < 74 && s.burstCd === 0) burst = true;
            } else {
              // Opportunistic shove: burst into a rival who is already deeper in the well
              let bumpIdx = -1;
              let bumpDist = 120;
              for (let j = 0; j < 4; j++) {
                if (j === i || !active[j].enabled || !ships[j].alive) continue;
                const dj = Math.hypot(ships[j].x - s.x, ships[j].y - s.y);
                const rivalDistC = Math.hypot(ships[j].x - CX, ships[j].y - CY);
                if (dj < bumpDist && rivalDistC < distC - 12) {
                  bumpDist = dj;
                  bumpIdx = j;
                }
              }
              if (bumpIdx >= 0 && s.burstCd === 0 && Math.random() < 0.05) {
                const dj = bumpDist || 1;
                ix = (ships[bumpIdx].x - s.x) / dj;
                iy = (ships[bumpIdx].y - s.y) / dj;
                burst = true;
              }
            }
            if (!burst && distC >= 105) {
              let bestOrb = orbs[0];
              let bestVal = -999;
              for (const o of orbs) {
                const ox = CX + Math.cos(o.angle) * o.dist;
                const oy = CY + Math.sin(o.angle) * o.dist;
                const od = Math.hypot(ox - s.x, oy - s.y);
                const val = (o.gold ? 80 : 30) - od * 0.25 + (o.dist - 60) * 0.2;
                if (val > bestVal) {
                  bestVal = val;
                  bestOrb = o;
                }
              }
              if (bestOrb) {
                const ox = CX + Math.cos(bestOrb.angle) * bestOrb.dist;
                const oy = CY + Math.sin(bestOrb.angle) * bestOrb.dist;
                const d = Math.hypot(ox - s.x, oy - s.y) || 1;
                ix = ((ox - s.x) / d) * 0.85;
                iy = ((oy - s.y) / d) * 0.85;
              }
            }
          }

          // Gravity pull toward center + slight orbital swirl
          const pull = gravityStrength * (180 / Math.max(55, distC));
          s.vx += (dxC / distC) * pull + (-dyC / distC) * pull * 0.18;
          s.vy += (dyC / distC) * pull + (dxC / distC) * pull * 0.18;

          // Player thruster steering
          s.vx += ix * 0.42;
          s.vy += iy * 0.42;

          if (Math.hypot(ix, iy) > 0.15) {
            s.angle = Math.atan2(iy, ix);
          }

          // Thruster burst
          if (burst && s.burstCd === 0) {
            const ang = Math.hypot(ix, iy) > 0.15 ? Math.atan2(iy, ix) : Math.atan2(-dyC, -dxC);
            s.vx += Math.cos(ang) * 8.2;
            s.vy += Math.sin(ang) * 8.2;
            s.burstCd = 42;
            sound.dash();
            vfx.burst(s.x, s.y, active[i].color, 12, 4.5);
            vfx.ring(s.x, s.y, active[i].color, 38, 2);
            rumble(i, 70, 0.5);
          }

          if (s.burstCd > 30) {
            vfx.afterimage(s.x, s.y, 16, active[i].color, 9);
          }

          s.vx *= 0.935;
          s.vy *= 0.935;
          s.x += s.vx;
          s.y += s.vy;

          // Arena boundary bounce
          if (s.x < 52) { s.x = 52; s.vx = Math.abs(s.vx) * 0.7; }
          if (s.x > GAME_WIDTH - 52) { s.x = GAME_WIDTH - 52; s.vx = -Math.abs(s.vx) * 0.7; }
          if (s.y < 86) { s.y = 86; s.vy = Math.abs(s.vy) * 0.7; }
          if (s.y > GAME_HEIGHT - 46) { s.y = GAME_HEIGHT - 46; s.vy = -Math.abs(s.vy) * 0.7; }

          // Collect orbs
          for (let oi = orbs.length - 1; oi >= 0; oi--) {
            const o = orbs[oi];
            const ox = CX + Math.cos(o.angle) * o.dist;
            const oy = CY + Math.sin(o.angle) * o.dist;
            if (Math.hypot(s.x - ox, s.y - oy) < 28) {
              const pts = o.gold ? 25 : 10;
              score[i] += pts;
              orbs.splice(oi, 1);
              sound.pickup(o.gold ? 220 : 0);
              if (o.gold) {
                vfx.ring(ox, oy, '#facc15', 40, 2.5);
                rumble(i, 50, 0.4);
              }
              vfx.burst(ox, oy, o.gold ? '#facc15' : '#2ee59d', 12, 4);
              vfx.popup(ox, oy - 12, `+${pts}`, o.gold ? '#facc15' : '#2ee59d', 13);
            }
          }

          // Survival tick points
          if (frame % 30 === 0) score[i] += 2;

          // Singularity death check
          if (Math.hypot(s.x - CX, s.y - CY) < HORIZON_R) {
            s.alive = false;
            sound.explosion();
            vfx.hitstop(3);
            vfx.shake(10);
            vfx.flash('#c084fc', 0.22);
            vfx.burst(CX, CY, active[i].color, 26, 6.5);
            vfx.ring(CX, CY, active[i].color, 90, 4);
            if (s.lastHitBy >= 0 && s.lastHitBy !== i) {
              score[s.lastHitBy] += 40;
              vfx.popup(CX, CY - 38, `${active[s.lastHitBy].name} KO +40!`, active[s.lastHitBy].color, 15);
            } else {
              vfx.popup(CX, CY - 34, `${active[i].name} SWALLOWED!`, '#fb7185', 14);
            }
            rumble(i, 180, 0.95);
          }
        }

        // Player-player bump collisions
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !ships[i].alive) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled || !ships[j].alive) continue;
            const a = ships[i];
            const b = ships[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0 && dist < 34) {
              const nx = dx / dist;
              const ny = dy / dist;
              const overlap = 34 - dist;
              a.x -= nx * overlap * 0.5;
              a.y -= ny * overlap * 0.5;
              b.x += nx * overlap * 0.5;
              b.y += ny * overlap * 0.5;

              const force = 5.4;
              a.vx -= nx * force;
              a.vy -= ny * force;
              b.vx += nx * force;
              b.vy += ny * force;
              a.flash = 6;
              b.flash = 6;
              a.lastHitBy = j;
              a.lastHitTimer = 90;
              b.lastHitBy = i;
              b.lastHitTimer = 90;

              sound.hit();
              vfx.ring((a.x + b.x) / 2, (a.y + b.y) / 2, '#facc15', 38, 2.5);
              vfx.burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffffff', 8, 4);
              rumble(i, 70, 0.55);
              rumble(j, 70, 0.55);
            }
          }
        }

        // Round end check
        const aliveSlots = [0, 1, 2, 3].filter((idx) => active[idx].enabled && ships[idx].alive);
        const totalActive = active.filter((a) => a.enabled).length;
        if (totalActive === 1 && aliveSlots.length === 0) {
          // Solo run swallowed: no round win, just restart the vortex
          const soloIdx = Math.max(0, active.findIndex((a) => a.enabled));
          roundOver = true;
          bannerTitle = 'SWALLOWED BY THE VOID!';
          bannerSub = `SURVIVE ${Math.ceil(ROUND_FRAMES / 60)}s TO WIN A ROUND · ${score[soloIdx]} PTS`;
          bannerColor = '#fb7185';
          roundBannerTimer = 85;
        } else if ((totalActive > 1 && aliveSlots.length <= 1) || roundTimer <= 0) {
          let roundWinner = aliveSlots[0] ?? 0;
          if (aliveSlots.length > 1 || aliveSlots.length === 0) {
            roundWinner = [0, 1, 2, 3]
              .filter((idx) => active[idx].enabled)
              .sort((a, b) => score[b] - score[a])[0] ?? 0;
          }
          roundOver = true;
          wins[roundWinner]++;
          score[roundWinner] += 30;
          sound.win();
          vfx.flash(active[roundWinner].color, 0.25);
          vfx.confetti(CX, CY, 45);
          if (active[roundWinner].isHuman) rumble(roundWinner, 160, 0.7);
          if (wins[roundWinner] >= 3) {
            vfx.confetti(180, 200, 40);
            vfx.confetti(GAME_WIDTH - 180, 200, 40);
            matchOver = true;
            bannerTitle = `${active[roundWinner].name} IS VORTEX KING!`;
            bannerSub = `3 ROUND WINS · SCORE ${score[roundWinner]} PTS`;
            bannerColor = active[roundWinner].color;
            roundBannerTimer = 140;
          } else {
            bannerTitle = `${active[roundWinner].name} SURVIVES!`;
            bannerSub = `ROUND WIN ${wins[roundWinner]}/3 · NEXT VORTEX SOON`;
            bannerColor = active[roundWinner].color;
            roundBannerTimer = 85;
          }
        }
      }

      // Render arena & vortex
      drawArcadeBackdrop(ctx, '#c084fc');

      // Gravitational rings
      for (let r = 65; r <= 235; r += 55) {
        ctx.save();
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.14)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 10]);
        ctx.beginPath();
        ctx.arc(CX, CY, r, frame * 0.008, frame * 0.008 + Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Swirling debris
      for (const d of debris) {
        const dx = CX + Math.cos(d.angle) * d.dist;
        const dy = CY + Math.sin(d.angle) * d.dist;
        ctx.fillStyle = d.color;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.arc(dx, dy, d.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Black Hole Accretion Disk
      ctx.save();
      const bhGrad = ctx.createRadialGradient(CX, CY, 12, CX, CY, 74);
      bhGrad.addColorStop(0, '#000000');
      bhGrad.addColorStop(0.45, '#070312');
      bhGrad.addColorStop(0.62, '#c084fc');
      bhGrad.addColorStop(0.8, 'rgba(56, 189, 248, 0.25)');
      bhGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bhGrad;
      ctx.beginPath();
      ctx.arc(CX, CY, 74, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#e879f9';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(CX, CY, HORIZON_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Energy orbs
      for (const o of orbs) {
        const ox = CX + Math.cos(o.angle) * o.dist;
        const oy = CY + Math.sin(o.angle) * o.dist;
        const r = (o.gold ? 10 : 7.5) + Math.sin(o.pulse) * 1.6;
        ctx.save();
        // Cheap additive halo instead of per-orb shadowBlur
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = o.gold ? '#facc15' : '#2ee59d';
        ctx.beginPath();
        ctx.arc(ox, oy, r * 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ox, oy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Draw ships
      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => wins[b] * 1000 + score[b] - (wins[a] * 1000 + score[a]))[0];

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !ships[i].alive) continue;
        const s = ships[i];
        drawPlayerOrb(ctx, s.x, s.y, 17, active[i].color, i, {
          angle: s.angle,
          leader: i === leaderIdx && (wins[i] > 0 || score[i] > 0),
          flash: s.flash > 0,
          cooldownPct: s.burstCd / 42,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      const pills: ScorePillData[] = [0, 1, 2, 3].map((s) => ({
        slot: s,
        name: active[s].name,
        color: active[s].color,
        active: active[s].enabled,
        valueText: `★${wins[s]} · ${score[s]}`,
        highlight: s === leaderIdx && (wins[s] > 0 || score[s] > 0),
      }));
      drawTopScoreboard(
        ctx,
        pills,
        `TIME ${Math.ceil(roundTimer / 60)}s · FIRST TO 3 WINS · A: THRUSTER BURST`,
      );

      if (roundBannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 48. JETPACK JOUST (Aerial Platform Jousting + Lance Powerups!)
export function createJetpackJoustEngine(): MiniGameEngine {
  const TARGET_SCORE = 160;
  const ARENA_LEFT = 42;
  const ARENA_RIGHT = GAME_WIDTH - 42;
  const FLOOR_Y = GAME_HEIGHT - 44;

  const platforms = [
    { x: 110, y: 385, w: 190 },
    { x: GAME_WIDTH - 300, y: 385, w: 190 },
    { x: GAME_WIDTH / 2 - 125, y: 275, w: 250 },
    { x: 185, y: 165, w: 165 },
    { x: GAME_WIDTH - 350, y: 165, w: 165 },
  ];

  const scores = [0, 0, 0, 0];
  let bannerTimer = 70;
  let bannerTitle = 'JETPACK JOUST';
  let bannerSub = 'A: JETPACK THRUST · B: DASH · STOMP FROM ABOVE!';
  let bannerColor = '#38bdf8';
  let matchOver = false;
  const prevB = [false, false, false, false];

  let lancePickup = { x: GAME_WIDTH / 2, y: 230, active: true, respawn: 0 };

  const knights = [0, 1, 2, 3].map((i) => ({
    x: 170 + i * 200,
    y: 130 + (i % 2) * 100,
    vx: 0,
    vy: 0,
    facing: i < 2 ? 1 : -1,
    grounded: false,
    respawnBubble: 0,
    lanceTimer: 0,
    dashCd: 0,
    flash: 0,
  }));

  function resetAll() {
    scores.fill(0);
    for (let i = 0; i < 4; i++) {
      knights[i].x = 170 + i * 200;
      knights[i].y = 140;
      knights[i].vx = 0;
      knights[i].vy = 0;
      knights[i].respawnBubble = 0;
      knights[i].lanceTimer = 0;
      knights[i].dashCd = 0;
    }
    lancePickup = { x: GAME_WIDTH / 2, y: 230, active: true, respawn: 0 };
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

      if (!lancePickup.active) {
        lancePickup.respawn--;
        if (lancePickup.respawn <= 0) {
          lancePickup.active = true;
          lancePickup.x = 160 + Math.random() * (GAME_WIDTH - 320);
          lancePickup.y = 120 + Math.random() * 200;
          vfx.ring(lancePickup.x, lancePickup.y, '#facc15', 36, 2);
        }
      }

      if (bannerTimer <= 10 && !matchOver) {
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const k = knights[i];
          if (k.dashCd > 0) k.dashCd--;
          if (k.flash > 0) k.flash--;
          if (k.lanceTimer > 0) k.lanceTimer--;

          if (k.respawnBubble > 0) {
            k.respawnBubble--;
            k.y = 115 + Math.sin(frame * 0.12 + i) * 10;
            if (k.respawnBubble === 0) {
              vfx.burst(k.x, k.y, active[i].color, 12, 4);
              sound.pickup(100);
            }
            continue;
          }

          let ix = 0;
          let thrust = false;
          let dash = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            thrust = inp.actionA || inp.y < -0.45;
            dash = inp.actionB && !prevB[i];
            prevB[i] = inp.actionB;
          } else {
            // Smart aerial joust bot
            let targetX = lancePickup.active ? lancePickup.x : GAME_WIDTH / 2;
            let targetY = lancePickup.active ? lancePickup.y - 20 : 200;
            let bestDist = 9999;
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled || knights[j].respawnBubble > 0) continue;
              const d = Math.hypot(knights[j].x - k.x, knights[j].y - k.y);
              if (d < bestDist && (!lancePickup.active || d < 240)) {
                bestDist = d;
                targetX = knights[j].x;
                targetY = knights[j].y - 36; // aim above rival's head!
              }
            }
            const dx = targetX - k.x;
            ix = Math.max(-0.9, Math.min(0.9, dx * 0.025));
            if (k.y > targetY || k.y > FLOOR_Y - 50) thrust = true;
            if (Math.abs(dx) < 110 && k.y < targetY + 12 && k.dashCd === 0 && Math.random() < 0.06) {
              dash = true;
            }
          }

          if (Math.abs(ix) > 0.1) k.facing = ix > 0 ? 1 : -1;

          // Jetpack physics
          k.vx = k.vx * 0.88 + ix * 0.65;
          k.vy += 0.28; // gravity

          if (thrust) {
            k.vy = Math.max(-5.8, k.vy - 0.68);
            k.grounded = false;
            if (frame % 3 === 0) {
              vfx.spark(k.x - k.facing * 8, k.y + 14, (Math.random() - 0.5) * 1.5, 2.5, '#ff6b2b', 3.5);
            }
            if (frame % 7 === 0) sound.noiseBurst(0.04, 650, 0.04);
          }

          if (dash && k.dashCd === 0) {
            k.vx = k.facing * 10.5;
            k.dashCd = 45;
            sound.dash();
            vfx.burst(k.x, k.y, active[i].color, 10, 4);
          }
          if (k.dashCd > 35) vfx.afterimage(k.x, k.y, 15, active[i].color, 8);

          const prevY = k.y;
          k.x += k.vx;
          k.y += k.vy;

          // Side wrap portals
          if (k.x < ARENA_LEFT) {
            k.x = ARENA_RIGHT - 4;
            vfx.ring(ARENA_RIGHT - 8, k.y, '#38bdf8', 26, 2);
          } else if (k.x > ARENA_RIGHT) {
            k.x = ARENA_LEFT + 4;
            vfx.ring(ARENA_LEFT + 8, k.y, '#38bdf8', 26, 2);
          }

          // Top ceiling & floor
          if (k.y < 86) {
            k.y = 86;
            k.vy = Math.max(0, k.vy);
          }
          k.grounded = false;
          if (k.y >= FLOOR_Y - 16) {
            k.y = FLOOR_Y - 16;
            k.vy = 0;
            k.grounded = true;
          }

          // Platform one-way landings
          if (k.vy >= 0) {
            for (const pl of platforms) {
              if (k.x >= pl.x - 10 && k.x <= pl.x + pl.w + 10 && prevY + 16 <= pl.y + 6 && k.y + 16 >= pl.y) {
                k.y = pl.y - 16;
                k.vy = 0;
                k.grounded = true;
              }
            }
          }

          // Lance pickup
          if (lancePickup.active && Math.hypot(k.x - lancePickup.x, k.y - lancePickup.y) < 30) {
            lancePickup.active = false;
            lancePickup.respawn = 240;
            k.lanceTimer = 360;
            scores[i] += 10;
            sound.pickup(180);
            vfx.ring(lancePickup.x, lancePickup.y, '#facc15', 45, 3);
            vfx.popup(k.x, k.y - 24, 'HYPER LANCE! +10', '#facc15', 13);
            rumble(i, 60, 0.45);
            checkJoustWin(i);
            if (matchOver) break;
          }
        }

        // Joust collisions
        for (let i = 0; i < 4 && !matchOver; i++) {
          const a = knights[i];
          if (!active[i].enabled || a.respawnBubble > 0) continue;
          for (let j = i + 1; j < 4 && !matchOver; j++) {
            const b = knights[j];
            if (!active[j].enabled || b.respawnBubble > 0 || a.respawnBubble > 0) continue;

            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const hitRadius = a.lanceTimer > 0 || b.lanceTimer > 0 ? 40 : 32;
            if (dist < hitRadius) {
              const heightDiff = b.y - a.y; // > 0 means a is higher
              const aHasLance = a.lanceTimer > 0 && b.lanceTimer === 0;
              const bHasLance = b.lanceTimer > 0 && a.lanceTimer === 0;

              if (heightDiff > 8 || (Math.abs(heightDiff) <= 8 && aHasLance)) {
                popKnight(i, j);
              } else if (heightDiff < -8 || (Math.abs(heightDiff) <= 8 && bHasLance)) {
                popKnight(j, i);
              } else {
                // Clash!
                const nx = a.x < b.x ? -1 : 1;
                a.vx = nx * 6.5;
                b.vx = -nx * 6.5;
                a.vy = -3.5;
                b.vy = -3.5;
                a.flash = 6;
                b.flash = 6;
                sound.hit();
                vfx.burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#facc15', 10, 4);
                vfx.ring((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffffff', 36, 2);
              }
            }
          }
        }
      }

      function popKnight(winner: number, loser: number) {
        const w = knights[winner];
        const l = knights[loser];
        const pts = w.lanceTimer > 0 ? 30 : 20;
        scores[winner] += pts;
        w.vy = -5.5;
        w.flash = 8;
        // Capture pop location before the loser is warped to its respawn bubble
        const popX = l.x;
        const popY = l.y;
        l.respawnBubble = 90;
        l.x = 160 + Math.random() * (GAME_WIDTH - 320);
        l.y = 115;
        l.vx = 0;
        l.vy = 0;
        l.lanceTimer = 0;

        sound.explosion();
        vfx.hitstop(3);
        vfx.shake(8);
        vfx.flash(active[winner].color, 0.16);
        vfx.ring(popX, popY, active[winner].color, 60, 3.5);
        vfx.burst(popX, popY, active[loser].color, 20, 5.5);
        vfx.burst(popX, popY, '#ffffff', 8, 3, 3, 0.15);
        vfx.popup(w.x, w.y - 26, `JOUST +${pts}!`, active[winner].color, 15);
        rumble(winner, 80, 0.7);
        rumble(loser, 160, 0.9);

        checkJoustWin(winner);
      }

      function checkJoustWin(winner: number) {
        if (matchOver || scores[winner] < TARGET_SCORE) return;
        matchOver = true;
        bannerTitle = `${active[winner].name} RULES THE SKIES!`;
        bannerSub = `CHAMPION WITH ${scores[winner]} PTS`;
        bannerColor = active[winner].color;
        bannerTimer = 135;
        sound.win();
        vfx.flash(active[winner].color, 0.3);
        vfx.confetti(GAME_WIDTH / 2, 220, 60);
        vfx.confetti(knights[winner].x, knights[winner].y, 30);
        rumble(winner, 200, 0.8);
      }

      // Render
      drawArcadeBackdrop(ctx, '#38bdf8');

      // Floor + Side wrap indicators
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.fillRect(ARENA_LEFT, FLOOR_Y, ARENA_RIGHT - ARENA_LEFT, 6);

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ARENA_LEFT, 82);
      ctx.lineTo(ARENA_LEFT, FLOOR_Y);
      ctx.moveTo(ARENA_RIGHT, 82);
      ctx.lineTo(ARENA_RIGHT, FLOOR_Y);
      ctx.stroke();
      ctx.restore();

      // Platforms
      for (const pl of platforms) {
        ctx.save();
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(pl.x, pl.y, pl.w, 12, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Lance pickup
      if (lancePickup.active) {
        const py = lancePickup.y + Math.sin(frame * 0.1) * 5;
        ctx.save();
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.moveTo(lancePickup.x - 16, py + 4);
        ctx.lineTo(lancePickup.x + 18, py);
        ctx.lineTo(lancePickup.x - 16, py - 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => scores[b] - scores[a])[0];

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const k = knights[i];

        if (k.respawnBubble > 0) {
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(k.x, k.y, 24, 0, Math.PI * 2);
          ctx.stroke();
          drawPlayerOrb(ctx, k.x, k.y, 14, active[i].color, i, { label: 'WAIT' });
          ctx.restore();
          continue;
        }

        // Draw lance protruding in facing direction
        ctx.save();
        const lanceLen = k.lanceTimer > 0 ? 34 : 22;
        ctx.strokeStyle = k.lanceTimer > 0 ? '#facc15' : '#e2e8f0';
        ctx.shadowColor = k.lanceTimer > 0 ? '#facc15' : '#ffffff';
        ctx.shadowBlur = k.lanceTimer > 0 ? 14 : 4;
        ctx.lineWidth = k.lanceTimer > 0 ? 4 : 2.5;
        ctx.beginPath();
        ctx.moveTo(k.x, k.y + 2);
        ctx.lineTo(k.x + k.facing * lanceLen, k.y + 2);
        ctx.stroke();
        ctx.restore();

        drawPlayerOrb(ctx, k.x, k.y, 16, active[i].color, i, {
          angle: k.facing === 1 ? 0 : Math.PI,
          leader: i === leaderIdx && scores[i] > 0,
          flash: k.flash > 0,
          cooldownPct: k.dashCd / 45,
          shield: k.lanceTimer > 0,
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
      drawTopScoreboard(ctx, pills, 'A: JETPACK THRUST · B: LANCE DASH · HIT FROM ABOVE!');

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 49. CRATE DROPPER (Sky-Crane Crates, TNT, Gold Loot & Rising Floor Laser!)
export function createCrateDropperEngine(): MiniGameEngine {
  const LEFT = 72;
  const RIGHT = GAME_WIDTH - 72;
  const FLOOR_BASE = GAME_HEIGHT - 44;
  const CRATE_SIZE = 44;
  const COLS = Math.floor((RIGHT - LEFT) / CRATE_SIZE);
  const GRID_LEFT = LEFT + ((RIGHT - LEFT) - COLS * CRATE_SIZE) / 2;
  const ROUND_FRAMES = 50 * 60;

  type CrateKind = 'normal' | 'tnt' | 'gold';
  interface Crate {
    col: number;
    x: number;
    y: number;
    vy: number;
    kind: CrateKind;
    landed: boolean;
    fuse: number;
    dead: boolean;
  }

  let crates: Crate[] = [];
  let craneX = GAME_WIDTH / 2;
  let craneTargetCol = 8;
  let dropCooldown = 45;
  let laserY = FLOOR_BASE + 12;
  let laserPhaseTimer = 0;
  let roundTimer = ROUND_FRAMES;
  let bannerTimer = 70;
  let bannerTitle = 'CRATE DROPPER';
  let bannerSub = 'A: JUMP · B: SHOVE · CLIMB CRATES ABOVE RISING LASER!';
  let bannerColor = '#facc15';
  let matchOver = false;

  const scores = [0, 0, 0, 0];
  const prevA = [false, false, false, false];
  const prevB = [false, false, false, false];

  const runners = [0, 1, 2, 3].map((i) => ({
    x: GRID_LEFT + (3 + i * 3) * CRATE_SIZE + CRATE_SIZE / 2,
    y: FLOOR_BASE - 16,
    vx: 0,
    vy: 0,
    grounded: false,
    shoveCd: 0,
    respawn: 0,
    flash: 0,
    facing: 1,
  }));

  function resetGame() {
    scores.fill(0);
    crates = [];
    laserY = FLOOR_BASE + 14;
    laserPhaseTimer = 0;
    roundTimer = ROUND_FRAMES;
    for (let i = 0; i < 4; i++) {
      runners[i].x = GRID_LEFT + (3 + i * 3) * CRATE_SIZE + CRATE_SIZE / 2;
      runners[i].y = FLOOR_BASE - 16;
      runners[i].vx = 0;
      runners[i].vy = 0;
      runners[i].respawn = 0;
      runners[i].shoveCd = 0;
    }
  }

  // Lowest resting y for crate c given the landed crates beneath it in its column
  function crateFloorStop(c: Crate) {
    let floorStop = FLOOR_BASE - CRATE_SIZE;
    for (const other of crates) {
      if (other === c || !other.landed || other.dead) continue;
      if (Math.abs(other.x - c.x) < CRATE_SIZE * 0.7 && other.y >= c.y + 1) {
        floorStop = Math.min(floorStop, other.y - CRATE_SIZE);
      }
    }
    return floorStop;
  }

  // In-place removal of dead crates (no per-frame array reallocation)
  function compactCrates() {
    let w = 0;
    for (let r = 0; r < crates.length; r++) {
      if (!crates[r].dead) crates[w++] = crates[r];
    }
    crates.length = w;
  }

  // Respawn on top of the tallest safe stack so a respawn never drops straight into the laser
  function safeRespawnX() {
    let best: Crate | null = null;
    for (const c of crates) {
      if (!c.landed || c.dead || c.kind === 'tnt') continue;
      if (!best || c.y < best.y) best = c;
    }
    if (best) return best.x + CRATE_SIZE / 2;
    return GRID_LEFT + Math.floor(Math.random() * COLS) * CRATE_SIZE + CRATE_SIZE / 2;
  }

  function getCrateTopAt(x: number, yFoot: number): Crate | null {
    let best: Crate | null = null;
    for (const c of crates) {
      if (c.dead) continue;
      if (x >= c.x - 10 && x <= c.x + CRATE_SIZE + 10 && yFoot <= c.y + 10 && yFoot >= c.y - 12) {
        if (!best || c.y < best.y) best = c;
      }
    }
    return best;
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
          resetGame();
        }
      }

      if (bannerTimer <= 10 && !matchOver) {
        roundTimer = Math.max(0, roundTimer - 1);

        // Sky-crane drops crates
        const targetX = GRID_LEFT + craneTargetCol * CRATE_SIZE + CRATE_SIZE / 2;
        craneX += (targetX - craneX) * 0.14;
        dropCooldown--;
        if (dropCooldown <= 0) {
          const r = Math.random();
          const kind: CrateKind = r < 0.22 ? 'tnt' : r < 0.42 ? 'gold' : 'normal';
          // Cap column stack height to keep play below HUD
          const colHeight = crates.filter((c) => c.col === craneTargetCol && c.landed).length;
          if (colHeight < 6) {
            crates.push({
              col: craneTargetCol,
              x: GRID_LEFT + craneTargetCol * CRATE_SIZE,
              y: 88,
              vy: 2.2,
              kind,
              landed: false,
              fuse: kind === 'tnt' ? 140 : 0,
              dead: false,
            });
            sound.beep(320, 0.04, 'square', 0.05);
          }
          craneTargetCol = Math.floor(Math.random() * COLS);
          dropCooldown = Math.max(24, 52 - Math.floor((ROUND_FRAMES - roundTimer) / 140));
        }

        // Rising floor laser cycle
        laserPhaseTimer = (laserPhaseTimer + 1) % 660;
        // Stage 1 rise is cleared by standing on 1 crate, stage 2 needs a 2-crate stack.
        // (Previously the first rise already required 2 stacked crates, which almost never
        // exist ~4s into a round, so everyone got zapped every cycle.)
        let targetLaserY = FLOOR_BASE + 16;
        if (laserPhaseTimer > 260 && laserPhaseTimer < 500) {
          targetLaserY = FLOOR_BASE - 34;
        } else if (laserPhaseTimer >= 500 && laserPhaseTimer < 580) {
          targetLaserY = FLOOR_BASE - 78;
        }
        if (laserPhaseTimer === 230 || laserPhaseTimer === 470) {
          sound.sweep(220, 520, 0.25, 'sawtooth', 0.06);
          vfx.popup(GAME_WIDTH / 2, FLOOR_BASE - 120, 'LASER RISING! CLIMB!', '#fb7185', 15);
        }
        laserY += (targetLaserY - laserY) * 0.04;

        // Update crates (removals are flagged `dead` and compacted after the loop so the
        // TNT blast can't invalidate the iteration index)
        for (let ci = crates.length - 1; ci >= 0; ci--) {
          const c = crates[ci];
          if (c.dead) continue;
          if (c.landed) {
            // Support blown away from under a resting crate -> let it fall again
            if (c.y < crateFloorStop(c) - 1) c.landed = false;
          }
          if (!c.landed) {
            c.vy = Math.min(8, c.vy + 0.35);
            c.y += c.vy;

            const floorStop = crateFloorStop(c);
            if (c.y >= floorStop) {
              const impact = c.vy;
              c.y = floorStop;
              c.vy = 0;
              c.landed = true;
              if (impact > 3) {
                sound.beep(140, 0.05, 'triangle', 0.06);
                vfx.burst(c.x + CRATE_SIZE / 2, c.y + CRATE_SIZE, '#94a3b8', 6, 2.2);
              }
            }
          }

          if (c.kind === 'tnt') {
            c.fuse--;
            if (c.fuse <= 0) {
              // Explode TNT!
              const ex = c.x + CRATE_SIZE / 2;
              const ey = c.y + CRATE_SIZE / 2;
              c.dead = true;
              sound.explosion();
              vfx.hitstop(3);
              vfx.shake(10);
              vfx.flash('#ff6b2b', 0.2);
              vfx.burst(ex, ey, '#ff6b2b', 24, 6.5);
              vfx.burst(ex, ey, '#facc15', 10, 4, 4, 0.2);
              vfx.ring(ex, ey, '#facc15', 95, 4);

              // Clear nearby crates (chain-detonating other TNT) and knock players
              for (const other of crates) {
                if (other.dead || Math.hypot(other.x - c.x, other.y - c.y) > 78) continue;
                if (other.kind === 'tnt') {
                  other.fuse = Math.min(other.fuse, 6);
                } else {
                  other.dead = true;
                  vfx.burst(other.x + CRATE_SIZE / 2, other.y + CRATE_SIZE / 2, '#94a3b8', 6, 3.5);
                }
              }
              for (let pi = 0; pi < 4; pi++) {
                if (!active[pi].enabled || runners[pi].respawn > 0) continue;
                const rp = runners[pi];
                const d = Math.hypot(rp.x - ex, rp.y - ey);
                if (d < 95) {
                  const ang = Math.atan2(rp.y - ey, rp.x - ex);
                  rp.vx = Math.cos(ang) * 9.5;
                  rp.vy = -7.5;
                  rp.flash = 10;
                  rumble(pi, 140, 0.85);
                }
              }
            }
          }
        }
        compactCrates();

        // Update players
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const r = runners[i];
          if (r.shoveCd > 0) r.shoveCd--;
          if (r.flash > 0) r.flash--;

          if (r.respawn > 0) {
            r.respawn--;
            if (r.respawn === 0) {
              r.x = safeRespawnX();
              r.y = 110;
              r.vx = 0;
              r.vy = 0;
              vfx.ring(r.x, r.y, active[i].color, 36, 2);
            }
            continue;
          }

          let ix = 0;
          let jump = false;
          let shove = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            jump = (inp.actionA && !prevA[i]) || inp.y < -0.65;
            shove = inp.actionB && !prevB[i];
            prevA[i] = inp.actionA;
            prevB[i] = inp.actionB;
          } else {
            // Bot climbs crates toward gold crates or safe high ground above laser
            const goldCrate = crates.find((c) => c.kind === 'gold');
            const dangerTnt = crates.find((c) => c.kind === 'tnt' && c.fuse < 45 && Math.hypot(c.x + 22 - r.x, c.y + 22 - r.y) < 90);
            if (dangerTnt) {
              ix = r.x < dangerTnt.x + 22 ? -0.95 : 0.95;
              if (r.grounded) jump = true;
            } else if (goldCrate) {
              const dx = goldCrate.x + CRATE_SIZE / 2 - r.x;
              ix = Math.max(-0.9, Math.min(0.9, dx * 0.03));
              if (r.grounded && (goldCrate.y < r.y - 10 || Math.abs(dx) > 45 && Math.random() < 0.05)) {
                jump = true;
              }
            } else if (laserPhaseTimer > 210) {
              // Climb highest crate nearby
              let highest = crates[0];
              for (const c of crates) {
                if (c.kind !== 'tnt' && (!highest || c.y < highest.y)) highest = c;
              }
              if (highest) {
                const dx = highest.x + CRATE_SIZE / 2 - r.x;
                ix = Math.max(-0.85, Math.min(0.85, dx * 0.03));
                if (r.grounded && highest.y < r.y) jump = true;
              }
            } else {
              ix = Math.sin(frame * 0.03 + i * 2) * 0.65;
            }
            if (r.shoveCd === 0 && Math.random() < 0.015) shove = true;
          }

          if (Math.abs(ix) > 0.1) r.facing = ix > 0 ? 1 : -1;

          r.vx = r.vx * 0.8 + ix * 1.1;
          r.vy += 0.45; // gravity

          if (jump && r.grounded) {
            r.vy = -9.6;
            r.grounded = false;
            sound.sweep(280, 520, 0.07, 'triangle', 0.07);
            vfx.burst(r.x, r.y + 14, '#e2e8f0', 6, 2.5);
          }

          if (shove && r.shoveCd === 0) {
            r.shoveCd = 40;
            r.vx += r.facing * 6.5;
            sound.dash();
            vfx.ring(r.x + r.facing * 18, r.y, active[i].color, 34, 2.5);
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled || runners[j].respawn > 0) continue;
              if (Math.hypot(runners[j].x - r.x, runners[j].y - r.y) < 46) {
                runners[j].vx = r.facing * 9.5;
                runners[j].vy = -4.5;
                runners[j].flash = 8;
                sound.hit();
                rumble(j, 90, 0.7);
              }
            }
          }

          const prevY = r.y;
          r.x += r.vx;
          r.y += r.vy;

          r.x = Math.max(GRID_LEFT + 14, Math.min(GRID_LEFT + COLS * CRATE_SIZE - 14, r.x));

          // Stand on floor or crate top
          r.grounded = false;
          if (r.y >= FLOOR_BASE - 15) {
            r.y = FLOOR_BASE - 15;
            r.vy = 0;
            r.grounded = true;
          }

          if (r.vy >= 0) {
            const cTop = getCrateTopAt(r.x, r.y + 15);
            if (cTop && prevY + 15 <= cTop.y + 12) {
              r.y = cTop.y - 15;
              r.vy = 0;
              r.grounded = true;
            }
          }

          // Collect gold crates on touch
          for (let ci = crates.length - 1; ci >= 0; ci--) {
            const c = crates[ci];
            if (c.kind === 'gold' && Math.hypot(r.x - (c.x + 22), r.y - (c.y + 22)) < 34) {
              scores[i] += 25;
              crates.splice(ci, 1);
              sound.pickup(180);
              vfx.burst(c.x + 22, c.y + 22, '#facc15', 16, 5);
              vfx.ring(c.x + 22, c.y + 22, '#facc15', 44, 2.5);
              vfx.popup(c.x + 22, c.y, 'GOLD +25!', '#facc15', 14);
              rumble(i, 60, 0.45);
            }
          }

          // Crushed by falling crate?
          for (const c of crates) {
            if (!c.landed && Math.abs(r.x - (c.x + 22)) < 22 && Math.abs(r.y - (c.y + CRATE_SIZE)) < 16) {
              r.vx = r.x < c.x + 22 ? -6 : 6;
              r.vy = -3;
              r.flash = 6;
            }
          }

          // Survival points
          if (frame % 30 === 0) scores[i] += 3;

          // Floor laser hit!
          if (r.y + 12 >= laserY) {
            r.respawn = 65;
            scores[i] = Math.max(0, scores[i] - 15);
            sound.explosion();
            vfx.shake(7);
            vfx.burst(r.x, r.y, '#fb7185', 18, 5);
            vfx.popup(r.x, r.y - 16, 'LASER ZAP -15', '#fb7185', 13);
            rumble(i, 150, 0.9);
          }
        }

        if (roundTimer <= 0) {
          const winner = [0, 1, 2, 3]
            .filter((idx) => active[idx].enabled)
            .sort((a, b) => scores[b] - scores[a])[0] ?? 0;
          matchOver = true;
          bannerTitle = `${active[winner].name} WINS!`;
          bannerSub = `CRATE MASTER · ${scores[winner]} PTS`;
          bannerColor = active[winner].color;
          bannerTimer = 135;
          sound.win();
          vfx.flash(active[winner].color, 0.3);
          vfx.confetti(GAME_WIDTH / 2, 220, 65);
          vfx.confetti(runners[winner].x, runners[winner].y, 30);
          rumble(winner, 200, 0.8);
        }
      }

      // Render
      drawArcadeBackdrop(ctx, '#facc15');

      // Sky-crane & telegraph beam
      ctx.save();
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.16)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(craneX, 92);
      ctx.lineTo(craneX, FLOOR_BASE);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.roundRect(craneX - 24, 72, 48, 16, 5);
      ctx.fill();
      ctx.restore();

      // Floor
      ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.fillRect(GRID_LEFT, FLOOR_BASE, COLS * CRATE_SIZE, 6);

      // Crates
      for (const c of crates) {
        ctx.save();
        if (c.kind === 'tnt') {
          const blink = c.fuse < 55 && Math.floor(c.fuse / 5) % 2 === 0;
          ctx.fillStyle = blink ? '#ffffff' : '#ef4444';
          ctx.strokeStyle = '#fca5a5';
        } else if (c.kind === 'gold') {
          ctx.fillStyle = '#eab308';
          ctx.strokeStyle = '#fef08a';
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 12;
        } else {
          ctx.fillStyle = '#334155';
          ctx.strokeStyle = '#64748b';
        }
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(c.x + 2, c.y + 2, CRATE_SIZE - 4, CRATE_SIZE - 4, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = c.kind === 'normal' ? '#94a3b8' : '#0b0d12';
        ctx.font = '800 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          c.kind === 'tnt' ? 'TNT' : c.kind === 'gold' ? '$$$' : 'BOX',
          c.x + CRATE_SIZE / 2,
          c.y + CRATE_SIZE / 2 + 4,
        );
        ctx.restore();
      }

      // Rising floor laser
      if (laserY < FLOOR_BASE + 8) {
        ctx.save();
        ctx.fillStyle = 'rgba(251, 113, 133, 0.22)';
        ctx.fillRect(GRID_LEFT, laserY, COLS * CRATE_SIZE, FLOOR_BASE - laserY + 8);
        ctx.strokeStyle = '#fb7185';
        ctx.shadowColor = '#fb7185';
        ctx.shadowBlur = 16;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(GRID_LEFT, laserY);
        ctx.lineTo(GRID_LEFT + COLS * CRATE_SIZE, laserY);
        ctx.stroke();
        ctx.restore();
      }

      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => scores[b] - scores[a])[0];

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || runners[i].respawn > 0) continue;
        const r = runners[i];
        drawPlayerOrb(ctx, r.x, r.y, 15, active[i].color, i, {
          angle: r.facing === 1 ? 0 : Math.PI,
          leader: i === leaderIdx && scores[i] > 0,
          flash: r.flash > 0,
          cooldownPct: r.shoveCd / 40,
        });
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
        `TIME ${Math.ceil(roundTimer / 60)}s · A: JUMP · B: SHOVE · DODGE TNT & LASER`,
      );

      if (bannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}

// 50. RHYTHM SIMON DUEL (4-Color Cyber Sequence Race!)
export function createSimonDuelEngine(): MiniGameEngine {
  const TARGET_SCORE = 200;
  const PAD_COLORS = ['#facc15', '#fb7185', '#2ee59d', '#38bdf8']; // 0:UP/Y, 1:RIGHT/B, 2:DOWN/A, 3:LEFT/X
  const PAD_FREQS = [587.33, 440, 349.23, 523.25];
  const PAD_LABELS = ['▲ / Y', '▶ / B', '▼ / A', '◀ / X'];
  const CX = GAME_WIDTH / 2;
  const CY = 288;

  const scores = [0, 0, 0, 0];
  let sequence: number[] = [];
  let seqLength = 3;
  let phase: 'show' | 'input' | 'pause' = 'pause';
  let showIdx = 0;
  let phaseTimer = 55;
  let activeLitPad = -1;
  let finishOrder: number[] = [];
  let roundBannerTimer = 65;
  let bannerTitle = 'RHYTHM SIMON DUEL';
  let bannerSub = 'WATCH CENTER PAD · RACE TO REPEAT WITH STICK OR Y/B/A/X!';
  let bannerColor = '#2ee59d';
  let matchOver = false;

  const pState = [0, 1, 2, 3].map(() => ({
    progress: 0,
    done: false,
    lockTimer: 0,
    lastPressedPad: -1,
    pressFlash: 0,
    botNextTimer: 22,
  }));

  const prevDirs = [
    { up: false, right: false, down: false, left: false },
    { up: false, right: false, down: false, left: false },
    { up: false, right: false, down: false, left: false },
    { up: false, right: false, down: false, left: false },
  ];
  const humanPress = [-1, -1, -1, -1];

  function startNewSequence() {
    sequence = Array.from({ length: seqLength }, () => Math.floor(Math.random() * 4));
    phase = 'show';
    showIdx = 0;
    phaseTimer = 22;
    activeLitPad = -1;
    finishOrder = [];
    for (let i = 0; i < 4; i++) {
      pState[i].progress = 0;
      pState[i].done = false;
      pState[i].lockTimer = 0;
      pState[i].lastPressedPad = -1;
      pState[i].pressFlash = 0;
      pState[i].botNextTimer = 18 + Math.floor(Math.random() * 14);
    }
  }

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      vfx.beginCamera(ctx);

      // Sample human pads every frame so edge detection stays fresh across phases
      // (a button held/pressed during the WATCH phase must not fire on the first GO frame).
      for (let i = 0; i < 4; i++) {
        const inPhase = phase === 'input' && roundBannerTimer === 0 && !matchOver;
        const ps = pState[i];
        if (!active[i].enabled || !active[i].isHuman) {
          humanPress[i] = -1;
          continue;
        }
        const inp = readPlayerInput(i, pads, keys);
        const up = inp.y < -0.55 || inp.actionY;
        const right = inp.x > 0.55 || inp.actionB;
        const down = inp.y > 0.55 || inp.actionA;
        const left = inp.x < -0.55 || inp.actionX;
        const pd = prevDirs[i];
        let chosen = -1;
        if (up && !pd.up) chosen = 0;
        else if (right && !pd.right) chosen = 1;
        else if (down && !pd.down) chosen = 2;
        else if (left && !pd.left) chosen = 3;
        pd.up = up;
        pd.right = right;
        pd.down = down;
        pd.left = left;
        humanPress[i] = inPhase && !ps.done ? chosen : -1;
      }

      if (roundBannerTimer > 0) {
        roundBannerTimer--;
        if (roundBannerTimer === 0) {
          if (matchOver) {
            scores.fill(0);
            seqLength = 3;
            matchOver = false;
          }
          startNewSequence();
        }
      } else {
        if (phase === 'show') {
          phaseTimer--;
          if (phaseTimer === 10) {
            activeLitPad = -1;
          } else if (phaseTimer <= 0) {
            if (showIdx < sequence.length) {
              activeLitPad = sequence[showIdx];
              sound.beep(PAD_FREQS[activeLitPad], 0.14, 'triangle', 0.13);
              vfx.ring(CX, CY, PAD_COLORS[activeLitPad], 130, 3);
              showIdx++;
              phaseTimer = Math.max(18, 30 - seqLength * 2);
            } else {
              activeLitPad = -1;
              phase = 'input';
              phaseTimer = 280; // max time to complete input
              vfx.popup(CX, CY - 135, 'REPEAT NOW!', '#2ee59d', 18);
              sound.sweep(440, 880, 0.08, 'sine', 0.09);
            }
          }
        } else if (phase === 'input') {
          phaseTimer--;

          for (let i = 0; i < 4; i++) {
            const ps = pState[i];
            if (ps.pressFlash > 0) ps.pressFlash--;
            if (ps.lockTimer > 0) ps.lockTimer--;
            if (!active[i].enabled || ps.done) continue;

            if (matchOver) break;
            let chosenPad = -1;
            if (active[i].isHuman) {
              chosenPad = humanPress[i];
            } else {
              ps.botNextTimer--;
              if (ps.botNextTimer <= 0 && ps.lockTimer === 0) {
                const mistake = Math.random() < 0.08;
                chosenPad = mistake ? Math.floor(Math.random() * 4) : sequence[ps.progress];
                ps.botNextTimer = 14 + Math.floor(Math.random() * 13);
              }
            }

            if (chosenPad >= 0 && ps.lockTimer === 0) {
              ps.lastPressedPad = chosenPad;
              ps.pressFlash = 10;
              const cornerX = i % 2 === 0 ? 150 : GAME_WIDTH - 150;
              const cornerY = i < 2 ? 170 : 400;

              if (chosenPad === sequence[ps.progress]) {
                ps.progress++;
                sound.beep(PAD_FREQS[chosenPad], 0.08, 'triangle', 0.08);
                vfx.burst(cornerX, cornerY, PAD_COLORS[chosenPad], 8, 3.5);
                rumble(i, 25, 0.25);
                if (ps.progress >= sequence.length) {
                  ps.done = true;
                  finishOrder.push(i);
                  const placeBonus = [45, 30, 20, 10][finishOrder.length - 1] ?? 10;
                  const pts = placeBonus + seqLength * 3;
                  scores[i] += pts;
                  sound.combo(finishOrder.length + 2);
                  vfx.ring(cornerX, cornerY, active[i].color, 65, 3);
                  vfx.popup(cornerX, cornerY - 40, `#${finishOrder.length} +${pts}!`, '#facc15', 16);
                  rumble(i, 90, 0.65);

                  if (scores[i] >= TARGET_SCORE) {
                    matchOver = true;
                    bannerTitle = `${active[i].name} IS RHYTHM ACE!`;
                    bannerSub = `FINAL SCORE: ${scores[i]} PTS`;
                    bannerColor = active[i].color;
                    roundBannerTimer = 135;
                    sound.win();
                    vfx.flash(active[i].color, 0.3);
                    vfx.confetti(CX, CY, 70);
                    vfx.confetti(cornerX, cornerY, 30);
                    rumble(i, 200, 0.8);
                  }
                }
              } else {
                // Wrong note!
                ps.progress = 0;
                ps.lockTimer = 28;
                sound.beep(130, 0.14, 'sawtooth', 0.09);
                vfx.shake(4);
                vfx.burst(cornerX, cornerY, '#fb7185', 10, 3.5);
                vfx.popup(cornerX, cornerY - 36, 'MISS! RESET', '#fb7185', 13);
                rumble(i, 120, 0.75);
              }
            }
          }

          const enabledCount = active.filter((a) => a.enabled).length;
          if (!matchOver && (finishOrder.length >= enabledCount || phaseTimer <= 0)) {
            const clearedLen = sequence.length;
            seqLength = Math.min(8, seqLength + 1);
            phase = 'pause';
            if (finishOrder.length === 0) {
              bannerTitle = 'TIME UP! NO CLEAR';
              bannerColor = '#fb7185';
              sound.sweep(400, 160, 0.2, 'sawtooth', 0.07);
            } else {
              bannerTitle = `SEQUENCE ${clearedLen} CLEAR!`;
              bannerColor = '#38bdf8';
            }
            bannerSub =
              finishOrder.length > 0
                ? `FASTEST: ${active[finishOrder[0]].name} · NEXT: ${seqLength} NOTES`
                : `NEXT LENGTH: ${seqLength} NOTES`;
            roundBannerTimer = 55;
          }
        }
      }

      // Render backdrop & giant 4-color center Simon wheel
      drawArcadeBackdrop(ctx, '#2ee59d');

      const padAngles = [
        [-Math.PI * 0.75, -Math.PI * 0.25], // Top
        [-Math.PI * 0.25, Math.PI * 0.25],  // Right
        [Math.PI * 0.25, Math.PI * 0.75],   // Bottom
        [Math.PI * 0.75, Math.PI * 1.25],   // Left
      ];
      const labelOffsets = [
        { x: 0, y: -76 },
        { x: 76, y: 0 },
        { x: 0, y: 82 },
        { x: -76, y: 0 },
      ];

      for (let p = 0; p < 4; p++) {
        const isLit = activeLitPad === p;
        ctx.save();
        ctx.fillStyle = PAD_COLORS[p];
        ctx.globalAlpha = isLit ? 0.96 : 0.28;
        if (isLit) {
          ctx.shadowColor = PAD_COLORS[p];
          ctx.shadowBlur = 28;
        }
        ctx.beginPath();
        ctx.arc(CX, CY, 114, padAngles[p][0] + 0.05, padAngles[p][1] - 0.05);
        ctx.arc(CX, CY, 44, padAngles[p][1] - 0.05, padAngles[p][0] + 0.05, true);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = isLit ? 1 : 0.7;
        ctx.fillStyle = isLit ? '#07090e' : '#f3f2ed';
        ctx.font = '800 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(PAD_LABELS[p], CX + labelOffsets[p].x, CY + labelOffsets[p].y + 4);
        ctx.restore();
      }

      // Center core status
      ctx.save();
      ctx.fillStyle = '#0b0d12';
      ctx.strokeStyle = phase === 'show' ? '#facc15' : '#2ee59d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CX, CY, 38, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f3f2ed';
      ctx.font = '800 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(phase === 'show' ? 'WATCH' : 'GO!', CX, CY - 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`LEN ${seqLength}`, CX, CY + 14);
      ctx.restore();

      // Player mini-pads in 4 corners
      const leaderIdx = [0, 1, 2, 3]
        .filter((idx) => active[idx].enabled)
        .sort((a, b) => scores[b] - scores[a])[0];

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const ps = pState[i];
        const px = i % 2 === 0 ? 150 : GAME_WIDTH - 150;
        const py = i < 2 ? 170 : 400;

        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
        ctx.strokeStyle = ps.done ? '#2ee59d' : ps.lockTimer > 0 ? '#fb7185' : active[i].color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(px - 88, py - 50, 176, 100, 12);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = active[i].color;
        ctx.font = '800 12px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(active[i].name.slice(0, 12), px, py - 28);

        // Progress pips
        for (let k = 0; k < sequence.length; k++) {
          const pipX = px - ((sequence.length - 1) * 18) / 2 + k * 18;
          ctx.fillStyle =
            k < ps.progress
              ? PAD_COLORS[sequence[k]]
              : 'rgba(255,255,255,0.14)';
          ctx.beginPath();
          ctx.arc(pipX, py + 4, 6, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = ps.done ? '#2ee59d' : ps.lockTimer > 0 ? '#fb7185' : '#94a3b8';
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.fillText(
          ps.done ? 'COMPLETE!' : ps.lockTimer > 0 ? 'LOCKED!' : `${ps.progress}/${sequence.length}`,
          px,
          py + 32,
        );
        ctx.restore();

        if (ps.pressFlash > 0 && ps.lastPressedPad >= 0) {
          drawPlayerOrb(ctx, px - 64, py - 32, 8, PAD_COLORS[ps.lastPressedPad], i, {
            flash: true,
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
        valueText: `${scores[s]}/${TARGET_SCORE}`,
        highlight: s === leaderIdx && scores[s] > 0,
      }));
      drawTopScoreboard(ctx, pills, 'STICK OR Y(▲) B(▶) A(▼) X(◀) · SPEED MULTIPLIER BONUS!');

      if (roundBannerTimer > 0) {
        drawRoundBanner(ctx, bannerTitle, bannerSub, bannerColor);
      }
    },
  };
}
