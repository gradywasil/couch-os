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

// 36. ASTEROID MINERS (Tractor-Beam Laser, Mega Geodes, Pulse-Bump Steal & Deposit Rings)
export function createAsteroidMinersEngine(): MiniGameEngine {
  const TARGET_SCORE = 450;
  let scores = [0, 0, 0, 0];

  const bases = [
    { x: 100, y: 122 },
    { x: GAME_WIDTH - 100, y: 122 },
    { x: 100, y: GAME_HEIGHT - 84 },
    { x: GAME_WIDTH - 100, y: GAME_HEIGHT - 84 },
  ];

  interface OreNode {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    mega: boolean;
    r: number;
  }

  interface LooseOre {
    x: number;
    y: number;
    vx: number;
    vy: number;
    val: number;
    mega: boolean;
    lockSlot: number; // slot that may not re-grab this ore yet (spill victim)
    lockTimer: number;
  }

  const makeRigs = () =>
    bases.map((b, i) => ({
      x: b.x + (i % 2 === 0 ? 45 : -45),
      y: b.y,
      vx: 0,
      vy: 0,
      angle: i % 2 === 0 ? 0 : Math.PI,
      cargo: 0,
      bumpCd: 0,
      prevB: false,
      lasering: false,
      laserX: 0,
      laserY: 0,
      laserMega: false,
      mineTick: 0,
      bankCombo: 0,
    }));
  let rigs = makeRigs();

  const spawnNode = (mega = false): OreNode => ({
    x: 185 + Math.random() * (GAME_WIDTH - 370),
    y: 118 + Math.random() * (GAME_HEIGHT - 206),
    hp: mega ? 5 : 3,
    maxHp: mega ? 5 : 3,
    mega,
    r: mega ? 24 : 17,
  });

  let nodes: OreNode[] = [
    spawnNode(false),
    spawnNode(false),
    spawnNode(false),
    spawnNode(true),
    spawnNode(false),
    spawnNode(false),
  ];
  let ores: LooseOre[] = [];
  let banner = '';
  let freeze = 20;

  const resetMatch = () => {
    scores = [0, 0, 0, 0];
    rigs = makeRigs();
    nodes = [
      spawnNode(false),
      spawnNode(false),
      spawnNode(false),
      spawnNode(true),
      spawnNode(false),
      spawnNode(false),
    ];
    ores = [];
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
      const maxScore = Math.max(...scores);
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (active[slot].isHuman) rumble(slot, ms, intensity);
      };
      const MINE_RANGE = 135;

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetMatch();
      } else {
        if (nodes.length < 6 && frame % 55 === 0) {
          const hasMega = nodes.some((n) => n.mega);
          nodes.push(spawnNode(!hasMega && Math.random() < 0.35));
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const r = rigs[i];
          let ix = 0;
          let iy = 0;
          let bumpBtn = false;
          let laserBtn = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            laserBtn = inp.actionA; // Mining Laser (hold) — matches registry controls
            bumpBtn = inp.actionB; // Pulse-bump steal
          } else {
            // Smart miner bot: bank if carrying >= 35 cargo, else grab loose ore, else mine Mega Geode
            const home = bases[i];
            if (r.cargo >= 35) {
              const d = Math.hypot(home.x - r.x, home.y - r.y) || 1;
              ix = ((home.x - r.x) / d) * 0.85;
              iy = ((home.y - r.y) / d) * 0.85;
            } else if (ores.length > 0) {
              let bestOre = ores[0];
              let bestD = Infinity;
              for (const o of ores) {
                const d = Math.hypot(o.x - r.x, o.y - r.y);
                if (d < bestD) {
                  bestD = d;
                  bestOre = o;
                }
              }
              const d = Math.hypot(bestOre.x - r.x, bestOre.y - r.y) || 1;
              ix = ((bestOre.x - r.x) / d) * 0.85;
              iy = ((bestOre.y - r.y) / d) * 0.85;
            } else if (nodes.length > 0) {
              // Prefer the Mega Geode, otherwise the nearest rock (bots used to all dogpile nodes[0])
              let target = nodes[0];
              let bestScore = Infinity;
              for (const n of nodes) {
                const sc = Math.hypot(n.x - r.x, n.y - r.y) - (n.mega ? 140 : 0) + ((i * 37 + n.x) % 60);
                if (sc < bestScore) {
                  bestScore = sc;
                  target = n;
                }
              }
              const d = Math.hypot(target.x - r.x, target.y - r.y) || 1;
              if (d > 88) {
                ix = ((target.x - r.x) / d) * 0.8;
                iy = ((target.y - r.y) / d) * 0.8;
              }
            }
            // Fire the mining laser whenever a rock is in tether range
            for (const n of nodes) {
              if (Math.hypot(n.x - r.x, n.y - r.y) < MINE_RANGE) {
                laserBtn = true;
                break;
              }
            }
            // Bot uses pulse bump if near a rival carrying cargo
            if (r.bumpCd === 0) {
              for (let j = 0; j < 4; j++) {
                if (j !== i && active[j].enabled && rigs[j].cargo >= 15 && Math.hypot(rigs[j].x - r.x, rigs[j].y - r.y) < 70) {
                  bumpBtn = Math.random() < 0.5;
                  break;
                }
              }
            }
          }

          const trigB = bumpBtn && !r.prevB;
          r.prevB = bumpBtn;
          if (r.bumpCd > 0) r.bumpCd--;

          if (Math.hypot(ix, iy) > 0.15) r.angle = Math.atan2(iy, ix);
          r.vx = r.vx * 0.84 + ix * 4.4 * 0.35;
          r.vy = r.vy * 0.84 + iy * 4.4 * 0.35;
          r.x = Math.max(54, Math.min(GAME_WIDTH - 54, r.x + r.vx));
          r.y = Math.max(88, Math.min(GAME_HEIGHT - 50, r.y + r.vy));

          // Pulse-Bump Shockwave: steal loose ore from rivals & crack nearby rock!
          if (trigB && r.bumpCd === 0) {
            r.bumpCd = 48;
            vfx.ring(r.x, r.y, active[i].color, 78, 3);
            vfx.burst(r.x, r.y, active[i].color, 10, 4.5);
            sound.dash();
            buzz(i, 40, 0.35);
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled) continue;
              const o = rigs[j];
              const dx = o.x - r.x;
              const dy = o.y - r.y;
              const d = Math.hypot(dx, dy);
              if (d > 0 && d < 82) {
                o.vx += (dx / d) * 8.5;
                o.vy += (dy / d) * 8.5;
                if (o.cargo > 0) {
                  const spilled = Math.min(o.cargo, 20);
                  o.cargo -= spilled;
                  o.bankCombo = 0;
                  // Spill backwards toward the bumper so the victim can't instantly re-scoop it
                  ores.push({
                    x: o.x,
                    y: o.y,
                    vx: (-dx / d) * 3.5,
                    vy: (-dy / d) * 3.5,
                    val: spilled,
                    mega: spilled >= 20,
                    lockSlot: j,
                    lockTimer: 50,
                  });
                  vfx.popup(o.x, o.y - 16, `SPILLED ${spilled}!`, '#ff6b2b');
                  vfx.shake(5);
                }
                vfx.hitstop(2);
                vfx.burst(o.x, o.y, '#ff6b2b', 10, 4.5);
                sound.hit();
                buzz(j, 120, 0.8);
                buzz(i, 60, 0.5);
              }
            }
          }

          // Mining laser (hold A): tethers to the closest asteroid within range
          let bestNi = -1;
          let bestNd = MINE_RANGE;
          if (laserBtn) {
            for (let ni = 0; ni < nodes.length; ni++) {
              const n = nodes[ni];
              const d = Math.hypot(n.x - r.x, n.y - r.y);
              if (d < bestNd) {
                bestNd = d;
                bestNi = ni;
              }
            }
          }
          r.lasering = bestNi >= 0;
          if (bestNi >= 0) {
            r.mineTick++;
            const n = nodes[bestNi];
            r.angle = Math.atan2(n.y - r.y, n.x - r.x);
            r.laserX = n.x;
            r.laserY = n.y;
            r.laserMega = n.mega;
            if (frame % 7 === 0) {
              vfx.bolt(r.x, r.y, n.x, n.y, n.mega ? '#facc15' : '#2ee59d');
              vfx.spark(n.x, n.y, (r.x - n.x) * 0.04, (r.y - n.y) * 0.04, n.mega ? '#fde047' : '#2ee59d', 3);
            }
            if (r.mineTick >= 24) {
              r.mineTick = 0;
              n.hp--;
              sound.beep(n.mega ? 300 : 420, 0.05, 'square', 0.06);
              vfx.burst(n.x, n.y, n.mega ? '#fde047' : '#a7f3d0', 5, 3);
              buzz(i, 25, 0.25);
              if (n.hp <= 0) {
                vfx.burst(n.x, n.y, n.mega ? '#facc15' : '#2ee59d', n.mega ? 24 : 15, 6);
                vfx.ring(n.x, n.y, n.mega ? '#facc15' : '#2ee59d', 64, 3);
                vfx.shake(n.mega ? 7 : 3.5);
                buzz(i, n.mega ? 150 : 70, n.mega ? 0.8 : 0.5);
                if (n.mega) {
                  vfx.hitstop(3);
                  vfx.flash('#facc15', 0.14);
                  vfx.popup(n.x, n.y - 16, 'MEGA GEODE!', '#facc15', 16);
                  ores.push({
                    x: n.x,
                    y: n.y,
                    vx: (Math.random() - 0.5) * 3,
                    vy: (Math.random() - 0.5) * 3,
                    val: 40,
                    mega: true,
                    lockSlot: -1,
                    lockTimer: 0,
                  });
                }
                for (let k = 0; k < 3; k++) {
                  ores.push({
                    x: n.x,
                    y: n.y,
                    vx: (Math.random() - 0.5) * 4,
                    vy: (Math.random() - 0.5) * 4,
                    val: 15,
                    mega: false,
                    lockSlot: -1,
                    lockTimer: 0,
                  });
                }
                nodes.splice(bestNi, 1);
                sound.explosion();
              }
            }
          } else {
            r.mineTick = 0;
          }

          // Deposit carried cargo at own Base Drop-Off Ring
          const base = bases[i];
          if (r.cargo > 0 && Math.hypot(r.x - base.x, r.y - base.y) < 38) {
            scores[i] += r.cargo;
            r.bankCombo++;
            vfx.ring(base.x, base.y, active[i].color, 70, 3.5);
            vfx.burst(base.x, base.y, active[i].color, 12, 4.5);
            vfx.popup(base.x, base.y - 18, `BANKED +${r.cargo}!`, '#2ee59d', 15);
            if (r.cargo >= 40) {
              vfx.confetti(base.x, base.y, 18);
              vfx.shake(4);
            }
            sound.combo(r.bankCombo);
            sound.pickup(200);
            buzz(i, r.cargo >= 40 ? 120 : 60, r.cargo >= 40 ? 0.7 : 0.4);
            r.cargo = 0;
          }
        }

        // Loose ore pickup (in-place compaction, no per-frame array allocation)
        let write = 0;
        for (let oi = 0; oi < ores.length; oi++) {
          const o = ores[oi];
          o.x = Math.max(54, Math.min(GAME_WIDTH - 54, o.x + o.vx));
          o.y = Math.max(88, Math.min(GAME_HEIGHT - 50, o.y + o.vy));
          o.vx *= 0.94;
          o.vy *= 0.94;
          if (o.lockTimer > 0) o.lockTimer--;
          let taken = false;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            if (o.lockTimer > 0 && o.lockSlot === i) continue;
            if (Math.hypot(o.x - rigs[i].x, o.y - rigs[i].y) < 28) {
              rigs[i].cargo += o.val;
              vfx.popup(o.x, o.y - 10, `+${o.val} ORE`, o.mega ? '#facc15' : active[i].color);
              vfx.ring(o.x, o.y, o.mega ? '#facc15' : '#38bdf8', 26, 2);
              sound.pickup(o.mega ? 180 : i * 50);
              buzz(i, 35, 0.3);
              taken = true;
              break;
            }
          }
          if (!taken) ores[write++] = o;
        }
        ores.length = write;

        const winner = [0, 1, 2, 3].find((i) => active[i].enabled && scores[i] >= TARGET_SCORE);
        if (winner !== undefined) {
          banner = `${active[winner].name} ASTEROID TYCOON!`;
          vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 42);
          vfx.confetti(bases[winner].x, bases[winner].y, 30);
          vfx.flash('#2ee59d', 0.2);
          sound.win();
          buzz(winner, 260, 0.9);
          freeze = 110;
        }
      }

      drawArcadeBackdrop(ctx, '#2ee59d');

      // Deposit Base Rings
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const b = bases[i];
        ctx.save();
        ctx.strokeStyle = active[i].color;
        ctx.fillStyle = `${active[i].color}1a`;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(b.x, b.y, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = active[i].color;
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('DROP', b.x, b.y + 3);
        ctx.restore();
      }

      // Asteroid Nodes + Mega Geodes
      for (const n of nodes) {
        ctx.save();
        ctx.shadowColor = n.mega ? '#facc15' : '#2ee59d';
        ctx.shadowBlur = n.mega ? 22 : 10;
        ctx.fillStyle = n.mega ? '#422006' : '#1e293b';
        ctx.strokeStyle = n.mega ? '#facc15' : '#2ee59d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = n.mega ? '#fde047' : '#a7f3d0';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${n.hp}/${n.maxHp}`, n.x, n.y + 4);
        ctx.restore();
      }

      // Loose Ores (additive halo instead of per-gem shadowBlur)
      ctx.save();
      for (const o of ores) {
        const rr = o.mega ? 10 : 7;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = o.mega ? '#facc15' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(o.x, o.y, rr + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = o.lockTimer > 0 && frame % 6 < 3 ? 0.5 : 1;
        ctx.fillStyle = o.mega ? '#fde047' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(o.x, o.y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Mining laser beams
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const r = rigs[i];
        if (!active[i].enabled || !r.lasering || freeze > 0) continue;
        const col = r.laserMega ? '#facc15' : '#2ee59d';
        const wob = 1 + Math.sin(frame * 0.6 + i) * 0.35;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 9 * wob;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.laserX, r.laserY);
        ctx.stroke();
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      ctx.restore();

      // Rigs
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const r = rigs[i];
        drawPlayerOrb(ctx, r.x, r.y, 16, active[i].color, i, {
          angle: r.angle,
          leader: maxScore > 0 && scores[i] === maxScore,
          cooldownPct: r.bumpCd / 48,
        });
        if (r.cargo > 0) {
          ctx.fillStyle = '#fde047';
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`+${r.cargo}`, r.x, r.y - 22);
        }
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'LAUNCHING NEW ASTEROID BELT...', '#2ee59d');
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
        'PILOT: STICK / WASD · MINING LASER: HOLD A / SPACE · PULSE BUMP: B / SHIFT · BANK AT DROP RING!',
      );
    },
  };
}

// 37. DEMOLITION DERBY (Armor Sparks, Smoke Trails, Nitro Pickups & T-Bone Physics)
export function createDemolitionDerbyEngine(): MiniGameEngine {
  const MAX_HP = 5;
  const wins = [0, 0, 0, 0];

  interface NitroCan {
    x: number;
    y: number;
    life: number;
  }

  let cars = [0, 1, 2, 3].map((i) => ({
    x: i % 2 === 0 ? 175 : GAME_WIDTH - 175,
    y: i < 2 ? 165 : 405,
    vx: 0,
    vy: 0,
    angle: i % 2 === 0 ? 0 : Math.PI,
    hp: MAX_HP,
    boostCd: 0,
    nitroCharges: 1,
    prevB: false,
    invuln: 20,
    botTarget: -1,
  }));

  let nitros: NitroCan[] = [{ x: GAME_WIDTH / 2, y: 290, life: 420 }];
  let banner = '';
  let bannerSub = '';
  let freeze = 20;
  const DUMMY_COLOR = '#64748b';

  const reset = () => {
    cars = [0, 1, 2, 3].map((i) => ({
      x: i % 2 === 0 ? 175 : GAME_WIDTH - 175,
      y: i < 2 ? 165 : 405,
      vx: 0,
      vy: 0,
      angle: i % 2 === 0 ? 0 : Math.PI,
      hp: MAX_HP,
      boostCd: 0,
      nitroCharges: 1,
      prevB: false,
      invuln: 25,
      botTarget: -1,
    }));
    nitros = [{ x: GAME_WIDTH / 2, y: 290, life: 420 }];
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
      let enabledCount = 0;
      for (const a of active) if (a.enabled) enabledCount++;
      // Solo with bots off: empty slots become idle junker cars to practise ramming on
      const solo = enabledCount === 1;
      const live = [0, 1, 2, 3].map((i) => active[i].enabled || solo);
      const isDummy = (i: number) => solo && !active[i].enabled;
      const carColor = (i: number) => (isDummy(i) ? DUMMY_COLOR : active[i].color);
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (active[slot].isHuman) rumble(slot, ms, intensity);
      };
      const maxWins = Math.max(...wins);

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        if (frame % 160 === 0 && nitros.length < 3) {
          nitros.push({
            x: 140 + Math.random() * (GAME_WIDTH - 280),
            y: 120 + Math.random() * (GAME_HEIGHT - 200),
            life: 450,
          });
        }
        nitros = nitros.filter((n) => --n.life > 0);

        for (let i = 0; i < 4; i++) {
          if (!live[i] || cars[i].hp <= 0) continue;
          const c = cars[i];
          let steer = 0;
          let gas = false;
          let turboBtn = false;

          if (isDummy(i)) {
            // Junker: slow lazy circles
            steer = Math.sin(frame * 0.012 + i * 2.1) * 0.6;
            gas = frame % 120 < 50;
          } else if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            steer = inp.x;
            gas = inp.actionA || inp.y < -0.2 || Math.abs(inp.x) > 0.25;
            turboBtn = inp.actionB;
          } else {
            // Bot: re-pick the nearest rival periodically (previously every bot hunted slot 0),
            // detour for nitro when empty, and only fire nitro when lined up at ramming range.
            const valid = c.botTarget >= 0 && live[c.botTarget] && cars[c.botTarget].hp > 0;
            if (!valid || frame % 150 === i * 30) {
              let best = -1;
              let bestD = Infinity;
              for (let j = 0; j < 4; j++) {
                if (j === i || !live[j] || cars[j].hp <= 0) continue;
                const d = Math.hypot(cars[j].x - c.x, cars[j].y - c.y) * (0.6 + Math.random() * 0.8);
                if (d < bestD) {
                  bestD = d;
                  best = j;
                }
              }
              c.botTarget = best;
            }
            let target: { x: number; y: number } | null = null;
            if (c.botTarget >= 0) {
              // Lead the target and, when it's facing us (head-on = no damage), swing wide
              // to line up a T-bone from the flank instead of bouncing bumper-to-bumper.
              const t = cars[c.botTarget];
              let ax = t.x + t.vx * 10;
              let ay = t.y + t.vy * 10;
              const tdx = c.x - t.x;
              const tdy = c.y - t.y;
              const td = Math.hypot(tdx, tdy) || 1;
              const facingMe = (Math.cos(t.angle) * tdx + Math.sin(t.angle) * tdy) / td;
              if (facingMe > 0.55 && td > 70) {
                const side = i % 2 === 0 ? 1 : -1;
                ax += Math.cos(t.angle + (Math.PI / 2) * side) * 90;
                ay += Math.sin(t.angle + (Math.PI / 2) * side) * 90;
              }
              target = { x: ax, y: ay };
            }
            if (c.nitroCharges === 0 && nitros.length > 0) {
              let bestN = nitros[0];
              let bestNd = Infinity;
              for (const n of nitros) {
                const d = Math.hypot(n.x - c.x, n.y - c.y);
                if (d < bestNd) {
                  bestNd = d;
                  bestN = n;
                }
              }
              if (bestNd < 320 || !target) target = bestN;
            }
            if (target) {
              const desired = Math.atan2(target.y - c.y, target.x - c.x);
              let diff = desired - c.angle;
              while (diff > Math.PI) diff -= Math.PI * 2;
              while (diff < -Math.PI) diff += Math.PI * 2;
              steer = Math.max(-1, Math.min(1, diff * 2.2));
              // Lift off the gas to carve a tighter turn (breaks endless tail-chase orbits)
              gas = Math.abs(diff) < 1.0 || Math.hypot(c.vx, c.vy) < 1.6;
              const dist = Math.hypot(target.x - c.x, target.y - c.y);
              if (Math.abs(diff) < 0.25 && dist < 230 && c.boostCd === 0 && c.nitroCharges > 0 && Math.random() < 0.08) {
                turboBtn = true;
              }
            }
          }

          const trigB = turboBtn && !c.prevB;
          c.prevB = turboBtn;
          if (c.boostCd > 0) c.boostCd--;
          if (c.invuln > 0) c.invuln--;

          if (trigB && c.boostCd === 0 && c.nitroCharges > 0) {
            c.nitroCharges--;
            c.vx += Math.cos(c.angle) * 9.5;
            c.vy += Math.sin(c.angle) * 9.5;
            c.boostCd = 45;
            vfx.burst(c.x, c.y, '#38bdf8', 12, 4.5);
            vfx.ring(c.x, c.y, '#38bdf8', 48, 2.5);
            sound.dash();
            buzz(i, 60, 0.5);
          }

          c.angle += steer * 0.075;
          if (gas) {
            c.vx += Math.cos(c.angle) * 0.36;
            c.vy += Math.sin(c.angle) * 0.36;
          }
          c.vx *= 0.94;
          c.vy *= 0.94;
          c.x += c.vx;
          c.y += c.vy;

          const spd = Math.hypot(c.vx, c.vy);
          if (spd > 6) {
            if (frame % 2 === 0) vfx.afterimage(c.x, c.y, 15, carColor(i), 8);
            if (frame % 3 === 0) vfx.spark(c.x, c.y, -c.vx * 0.2, -c.vy * 0.2, '#facc15', 2.5);
          }
          // Low HP smoke & armor sparks
          if (c.hp <= 2 && frame % 4 === 0) {
            vfx.spark(c.x, c.y, (Math.random() - 0.5) * 1.5, -1.2, c.hp === 1 ? '#ef4444' : '#64748b', 4);
          }

          if (c.x < 56 || c.x > GAME_WIDTH - 56) {
            c.vx *= -0.75;
            c.x = Math.max(56, Math.min(GAME_WIDTH - 56, c.x));
            vfx.spark(c.x, c.y, -c.vx * 0.5, 0, '#fde047', 3);
          }
          if (c.y < 88 || c.y > GAME_HEIGHT - 52) {
            c.vy *= -0.75;
            c.y = Math.max(88, Math.min(GAME_HEIGHT - 52, c.y));
            vfx.spark(c.x, c.y, 0, -c.vy * 0.5, '#fde047', 3);
          }

          // Collect Nitro canisters
          for (let ni = nitros.length - 1; ni >= 0; ni--) {
            if (Math.hypot(c.x - nitros[ni].x, c.y - nitros[ni].y) < 28) {
              c.nitroCharges = Math.min(3, c.nitroCharges + 1);
              vfx.popup(nitros[ni].x, nitros[ni].y - 12, 'NITRO +1!', '#38bdf8');
              vfx.ring(nitros[ni].x, nitros[ni].y, '#38bdf8', 42, 2.5);
              sound.pickup(140);
              nitros.splice(ni, 1);
            }
          }
        }

        // Angle-based Ramming Physics (T-Bone vs Head-On)
        const wreck = (k: number, attacker: number) => {
          const v = cars[k];
          vfx.hitstop(4);
          vfx.burst(v.x, v.y, '#ff6b2b', 30, 8);
          vfx.burst(v.x, v.y, carColor(k), 16, 5);
          vfx.ring(v.x, v.y, '#ef4444', 86, 4);
          vfx.popup(v.x, v.y - 26, 'WRECKED!', '#fb7185', 18);
          vfx.flash('#ff6b2b', 0.2);
          vfx.shake(12);
          sound.explosion();
          buzz(k, 260, 1);
          buzz(attacker, 120, 0.7);
        };

        for (let i = 0; i < 4; i++) {
          if (!live[i] || cars[i].hp <= 0) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!live[j] || cars[j].hp <= 0) continue;
            const a = cars[i];
            const b = cars[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < 36) {
              const nx = dx / d;
              const ny = dy / d;
              const spdA = Math.hypot(a.vx, a.vy);
              const spdB = Math.hypot(b.vx, b.vy);
              a.x -= nx * 5;
              a.y -= ny * 5;
              b.x += nx * 5;
              b.y += ny * 5;
              a.vx -= nx * 5.8;
              a.vy -= ny * 5.8;
              b.vx += nx * 5.8;
              b.vy += ny * 5.8;

              const cx = (a.x + b.x) / 2;
              const cy = (a.y + b.y) / 2;
              vfx.burst(cx, cy, '#facc15', 16, 6);
              vfx.shake(7);
              sound.hit();
              sound.noiseBurst(0.1, 900, 0.12);

              // Check T-bone angle: how aligned is attacker velocity with collision normal, vs target facing
              const aAlign = (Math.cos(a.angle) * nx + Math.sin(a.angle) * ny) * spdA;
              const bAlign = (Math.cos(b.angle) * -nx + Math.sin(b.angle) * -ny) * spdB;
              const bSideHit = Math.abs(Math.cos(b.angle) * nx + Math.sin(b.angle) * ny) < 0.5;
              const aSideHit = Math.abs(Math.cos(a.angle) * nx + Math.sin(a.angle) * ny) < 0.5;

              // Practice junkers never deal damage
              if (aAlign > bAlign + 1.2 && b.invuln === 0 && !isDummy(i)) {
                const dmg = bSideHit && spdA > 5 ? 2 : 1;
                b.hp = Math.max(0, b.hp - dmg);
                b.invuln = 18;
                vfx.popup(b.x, b.y - 16, dmg === 2 ? 'T-BONE -2!' : 'CRUNCH!', '#ff6b2b', dmg === 2 ? 16 : 14);
                buzz(j, 160, 0.9);
                buzz(i, 70, 0.5);
                if (dmg === 2) vfx.hitstop(2);
                if (b.hp <= 0) wreck(j, i);
              } else if (bAlign > aAlign + 1.2 && a.invuln === 0 && !isDummy(j)) {
                const dmg = aSideHit && spdB > 5 ? 2 : 1;
                a.hp = Math.max(0, a.hp - dmg);
                a.invuln = 18;
                vfx.popup(a.x, a.y - 16, dmg === 2 ? 'T-BONE -2!' : 'CRUNCH!', '#ff6b2b', dmg === 2 ? 16 : 14);
                buzz(i, 160, 0.9);
                buzz(j, 70, 0.5);
                if (dmg === 2) vfx.hitstop(2);
                if (a.hp <= 0) wreck(i, j);
              }
            }
          }
        }

        const alive = [0, 1, 2, 3].filter((i) => live[i] && cars[i].hp > 0);
        const total = live.filter(Boolean).length;
        const soloDead = solo && alive.every((k) => isDummy(k));
        if ((total > 1 && alive.length <= 1) || soloDead) {
          if (alive.length === 1 && !isDummy(alive[0])) {
            const w = alive[0];
            wins[w]++;
            banner = solo ? 'JUNKYARD CLEARED!' : `${active[w].name} WRECKING KING!`;
            vfx.confetti(cars[w].x, cars[w].y, 38);
            vfx.confetti(GAME_WIDTH / 2, 200, 30);
            vfx.flash('#facc15', 0.2);
            sound.win();
            buzz(w, 260, 0.85);
          } else {
            banner = 'TOTAL WRECK!';
          }
          bannerSub = solo ? 'PRACTICE YARD · TOWING IN FRESH JUNKERS...' : 'REPAIRING DERBY RIGS...';
          freeze = 100;
        }
      }

      drawArcadeBackdrop(ctx, '#ff6b2b');

      // Nitro Canisters
      for (const n of nitros) {
        ctx.save();
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#0284c7';
        ctx.strokeStyle = '#bae6fd';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(n.x - 9, n.y - 12, 18, 24, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('N2O', n.x, n.y + 3);
        ctx.restore();
      }

      // Cars + Armor HP bars
      for (let i = 0; i < 4; i++) {
        if (!live[i] || cars[i].hp <= 0) continue;
        const c = cars[i];
        const col = c.invuln > 0 && frame % 4 < 2 ? '#ffffff' : carColor(i);
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.angle);
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(-17, -11, 34, 22, 6);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-8, -7, 13, 14);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(10, -8, 5, 16);
        ctx.restore();

        // HP pips & Nitro pips
        for (let h = 0; h < MAX_HP; h++) {
          ctx.fillStyle = h < c.hp ? '#2ee59d' : '#334155';
          ctx.fillRect(c.x - 16 + h * 7, c.y + 18, 5, 4);
        }
        if (c.nitroCharges > 0) {
          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 9px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`N:${c.nitroCharges}`, c.x, c.y - 20);
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
          name: isDummy(i) ? 'JUNKER' : a.name,
          color: carColor(i),
          active: live[i],
          highlight: !isDummy(i) && maxWins > 0 && wins[i] === maxWins,
          valueText: isDummy(i)
            ? `${cars[i].hp > 0 ? `HP${cars[i].hp}` : 'WRECK'}`
            : `${cars[i].hp > 0 ? `HP${cars[i].hp}` : 'WRECK'} · W${wins[i]}`,
        })),
        'STEER: LEFT/RIGHT · GAS: A / UP · NITRO T-BONE RAM: B / SHIFT',
      );
    },
  };
}

// 38. GRAPPLE SWING (Pendulum Rope Physics, Golden Coin Hoops & Rising Hazard Floor)
export function createGrappleSwingEngine(): MiniGameEngine {
  const wins = [0, 0, 0, 0];

  interface Hook {
    x: number;
    y: number;
  }

  interface Hoop {
    x: number;
    y: number;
    taken: boolean;
  }

  const makeSwingers = () =>
    [0, 1, 2, 3].map((i) => ({
      x: 150 + i * 24,
      y: 230,
      vx: 4.2,
      vy: 0,
      alive: true,
      anchor: null as Hook | null,
      ropeLen: 110,
      launchTrail: 0,
      bonus: 0,
    }));

  let swingers = makeSwingers();

  let hooks: Hook[] = [];
  let hoops: Hoop[] = [];
  let camX = 0;
  let hazardY = GAME_HEIGHT - 34;
  let banner = '';
  let bannerSub = '';
  let freeze = 20;
  let runFrames = 0;
  let bestSoloDist = 0;

  const initWorld = () => {
    hooks = Array.from({ length: 14 }, (_, idx) => ({
      x: 210 + idx * 175,
      y: 108 + (idx % 2) * 44,
    }));
    hoops = Array.from({ length: 10 }, (_, idx) => ({
      x: 300 + idx * 230,
      y: 210 + Math.sin(idx * 1.4) * 55,
      taken: false,
    }));
  };

  const reset = () => {
    swingers = makeSwingers();
    initWorld();
    camX = 0;
    hazardY = GAME_HEIGHT - 34;
    banner = '';
    bannerSub = '';
    freeze = 20;
    runFrames = 0;
  };
  initWorld();

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
      const distM = Math.floor(camX / 10);

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        runFrames++;
        // Scroll speed ramps up over ~75s so rounds always resolve
        const scroll = 3.35 + Math.min(1.7, runFrames / 2600);
        camX += scroll;
        hazardY = Math.max(GAME_HEIGHT - 96, hazardY - 0.032);

        const lastHook = hooks[hooks.length - 1];
        if (lastHook.x - camX < GAME_WIDTH + 240) {
          hooks.push({ x: lastHook.x + 170, y: 105 + Math.random() * 58 });
        }
        const lastHoop = hoops[hoops.length - 1];
        if (lastHoop.x - camX < GAME_WIDTH + 240) {
          hoops.push({
            x: lastHoop.x + 225,
            y: 185 + Math.random() * 110,
            taken: false,
          });
        }
        // Prune world pieces far behind the camera (these arrays used to grow forever).
        // Anchors are object references, so removing old hooks never re-targets a rope.
        while (hooks.length > 2 && hooks[0].x < camX - 320) {
          const old = hooks[0];
          let inUse = false;
          for (const sw of swingers) if (sw.anchor === old) inUse = true;
          if (inUse) break;
          hooks.shift();
        }
        while (hoops.length > 1 && hoops[0].x < camX - 120) hoops.shift();

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !swingers[i].alive) continue;
          const s = swingers[i];
          let hold = false;
          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            hold = inp.actionA || inp.actionB;
          } else {
            // Smart bot: grapple when falling below mid-height, release once past the hook
            const curH = s.anchor;
            if (curH) {
              hold = s.x < curH.x + 25 || s.y > 265;
            } else {
              hold = s.y > 250 || s.vy > 2.2;
            }
          }

          if (hold) {
            if (!s.anchor) {
              // Latch onto the best hook ahead (holding keeps trying until one is in reach)
              let best: Hook | null = null;
              let bestD = Infinity;
              for (const h of hooks) {
                const d = Math.hypot(h.x - s.x, h.y - s.y);
                if (h.x > s.x - 45 && d < bestD && d < 280) {
                  bestD = d;
                  best = h;
                }
              }
              if (best) {
                s.anchor = best;
                s.ropeLen = Math.max(70, Math.min(185, bestD));
                sound.beep(560, 0.04);
                sound.sweep(900, 1500, 0.06, 'square', 0.04);
                vfx.ring(best.x - camX, best.y, active[i].color, 26, 2);
                vfx.spark(best.x - camX, best.y, 0, -2, '#fde047', 3);
                buzz(i, 30, 0.3);
              }
            }
            if (s.anchor) {
              // True elastic pendulum tension + tangential drive
              const h = s.anchor;
              const dx = s.x - h.x;
              const dy = s.y - h.y;
              const dist = Math.hypot(dx, dy) || 1;
              if (dist > s.ropeLen) {
                const nx = dx / dist;
                const ny = dy / dist;
                const stretch = dist - s.ropeLen;
                s.vx -= nx * stretch * 0.065;
                s.vy -= ny * stretch * 0.065;
                // Tangential swing boost
                s.vx += -ny * 0.14;
                s.vy += nx * 0.06;
              }
            }
          } else if (s.anchor) {
            // Release launch boost!
            s.anchor = null;
            s.launchTrail = 18;
            s.vx = Math.min(8.4, s.vx + 1.1);
            s.vy -= 1.2;
            sound.dash();
            vfx.burst(s.x - camX, s.y, active[i].color, 8, 3.5);
            buzz(i, 40, 0.35);
          }

          if (s.launchTrail > 0) {
            s.launchTrail--;
            if (frame % 2 === 0) vfx.afterimage(s.x - camX, s.y, 14, active[i].color, 10);
          }

          s.vy += 0.33;
          s.vx = Math.max(2.6, Math.min(8.4, s.vx * 0.994));
          s.vy *= 0.99;
          s.x += s.vx;
          s.y += s.vy;

          // Golden coin hoops
          for (const hp of hoops) {
            if (!hp.taken && Math.hypot(s.x - hp.x, s.y - hp.y) < 30) {
              hp.taken = true;
              s.bonus += 25;
              s.vx += 0.9;
              vfx.ring(hp.x - camX, hp.y, '#facc15', 56, 3);
              vfx.burst(hp.x - camX, hp.y, '#fde047', 10, 4);
              vfx.popup(hp.x - camX, hp.y - 16, '+25 HOOP!', '#facc15');
              sound.combo(Math.min(10, Math.floor(s.bonus / 25)));
              buzz(i, 45, 0.4);
            }
          }

          if (s.y > hazardY - 10 || s.y < 68 || s.x < camX - 24) {
            s.alive = false;
            s.anchor = null;
            const fx = Math.max(30, s.x - camX);
            const fy = Math.min(hazardY, s.y);
            vfx.hitstop(3);
            vfx.burst(fx, fy, active[i].color, 22, 6.5);
            vfx.burst(fx, fy, '#ef4444', 12, 4);
            vfx.ring(fx, fy, '#ef4444', 70, 3.5);
            vfx.popup(fx + 20, fy - 20, s.y > hazardY - 10 ? 'FRIED!' : 'LOST!', '#fb7185', 15);
            vfx.flash('#ef4444', 0.14);
            vfx.shake(8);
            sound.explosion();
            buzz(i, 170, 0.9);
          }
        }

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && swingers[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          const dist = Math.floor(camX / 10);
          if (alive.length === 1) {
            const w = alive[0];
            wins[w]++;
            banner = `${active[w].name} SWING ACE!`;
            bannerSub = `${dist}m · ${swingers[w].bonus} HOOP PTS · LAUNCHING NEXT GRAPPLE RUN...`;
            vfx.confetti(swingers[w].x - camX, swingers[w].y, 34);
            vfx.confetti(GAME_WIDTH / 2, 160, 30);
            vfx.flash('#facc15', 0.2);
            sound.win();
            buzz(w, 240, 0.85);
          } else if (total === 1) {
            const isBest = dist > bestSoloDist;
            if (isBest) bestSoloDist = dist;
            banner = isBest ? `NEW BEST · ${dist}m!` : `SWUNG ${dist}m`;
            bannerSub = `BEST ${bestSoloDist}m · ${swingers[0].bonus} HOOP PTS · LAUNCHING NEXT RUN...`;
            if (isBest) {
              vfx.confetti(GAME_WIDTH / 2, 160, 34);
              sound.win();
            }
          } else {
            banner = 'CHASM WIPEOUT!';
            bannerSub = `${dist}m · LAUNCHING NEXT GRAPPLE RUN...`;
          }
          freeze = 100;
        }
      }

      drawArcadeBackdrop(ctx, '#38bdf8');

      // Rising Neon Hazard Floor
      ctx.save();
      const hazGrad = ctx.createLinearGradient(0, hazardY, 0, GAME_HEIGHT - 28);
      hazGrad.addColorStop(0, 'rgba(239, 68, 68, 0.85)');
      hazGrad.addColorStop(1, 'rgba(127, 29, 29, 0.95)');
      ctx.fillStyle = hazGrad;
      ctx.fillRect(28, hazardY, GAME_WIDTH - 56, GAME_HEIGHT - 28 - hazardY);
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(28, hazardY);
      for (let hx = 28; hx <= GAME_WIDTH - 28; hx += 24) {
        ctx.lineTo(hx, hazardY + Math.sin(hx * 0.05 + frame * 0.12) * 2.5);
      }
      ctx.stroke();
      ctx.restore();

      // Golden Hoops
      for (const hp of hoops) {
        if (hp.taken) continue;
        const sx = hp.x - camX;
        if (sx < 10 || sx > GAME_WIDTH - 10) continue;
        ctx.save();
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 14;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(sx, hp.y, 12, 24, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Grapple Hooks
      for (const h of hooks) {
        const sx = h.x - camX;
        if (sx < 20 || sx > GAME_WIDTH - 20) continue;
        ctx.save();
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(sx, h.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Swingers & Elastic Neon Ropes
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !swingers[i].alive) continue;
        const s = swingers[i];
        const sx = s.x - camX;
        if (s.anchor) {
          const h = s.anchor;
          ctx.save();
          ctx.shadowColor = active[i].color;
          ctx.shadowBlur = 10;
          ctx.strokeStyle = active[i].color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(sx, s.y);
          ctx.lineTo(h.x - camX, h.y);
          ctx.stroke();
          ctx.restore();
        }
        drawPlayerOrb(ctx, sx, s.y, 14, active[i].color, i, {
          angle: Math.atan2(s.vy, s.vx),
          leader: maxWins > 0 && wins[i] === maxWins,
        });
      }

      // Distance meter
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.beginPath();
      ctx.roundRect(GAME_WIDTH / 2 - 52, 70, 104, 24, 8);
      ctx.fill();
      ctx.fillStyle = '#7dd3fc';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${distM}m`, GAME_WIDTH / 2, 87);

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
          highlight: maxWins > 0 && wins[i] === maxWins,
          valueText: `${swingers[i].alive ? 'AIR' : 'KO'} ${swingers[i].bonus}★ W${wins[i]}`,
        })),
        'HOLD A / B / SPACE TO GRAPPLE HOOK · RELEASE AT PEAK FOR TURBO LAUNCH!',
      );
    },
  };
}

// 39. FLAPPY SQUAD (Moving Laser Gates, Golden Coin Rings, Turbo Dash & Wing Puffs)
export function createFlappySquadEngine(): MiniGameEngine {
  const wins = [0, 0, 0, 0];

  interface Gate {
    x: number;
    gapY: number;
    baseY: number;
    gapH: number;
    moving: boolean;
    phase: number;
    coinTaken: boolean[];
  }

  let birds = [0, 1, 2, 3].map((i) => ({
    x: 190 + i * 32,
    y: 260,
    vy: 0,
    alive: true,
    lock: false,
    prevB: false,
    dashTimer: 0,
    dashCd: 0,
    streak: 0,
  }));

  let pipes: Gate[] = [];
  let banner = '';
  let bannerSub = '';
  let freeze = 20;
  let gatesCleared = 0;
  let bestSoloGates = 0;
  const PIPE_SPEED = 4.3;
  const gapAt = (p: Gate, f: number) => (p.moving ? p.baseY + Math.sin(f * 0.05 + p.phase) * 42 : p.baseY);

  const reset = () => {
    birds = [0, 1, 2, 3].map((i) => ({
      x: 190 + i * 32,
      y: 260,
      vy: 0,
      alive: true,
      lock: false,
      prevB: false,
      dashTimer: 0,
      dashCd: 0,
      streak: 0,
    }));
    pipes = [];
    banner = '';
    bannerSub = '';
    freeze = 20;
    gatesCleared = 0;
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
      const crash = (i: number, ceilingOrFloor: boolean) => {
        const b = birds[i];
        b.alive = false;
        vfx.hitstop(3);
        vfx.burst(b.x, b.y, active[i].color, 22, 6);
        vfx.burst(b.x, b.y, '#ffffff', 8, 3.5);
        vfx.ring(b.x, b.y, '#ef4444', 56, 3);
        vfx.popup(b.x, b.y - 18, ceilingOrFloor ? 'OUT OF BOUNDS!' : 'SPLAT!', '#fb7185', 14);
        vfx.shake(7);
        sound.explosion();
        buzz(i, 160, 0.9);
      };

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) reset();
      } else {
        if (frame % 66 === 0) {
          const gy = 165 + Math.random() * 200;
          pipes.push({
            x: GAME_WIDTH + 40,
            gapY: gy,
            baseY: gy,
            gapH: 136,
            moving: Math.random() < 0.45,
            phase: Math.random() * Math.PI * 2,
            coinTaken: [false, false, false, false],
          });
        }

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !birds[i].alive) continue;
          const b = birds[i];
          let flap = false;
          let dashBtn = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            // Registry: "Flap Wings: Tap A / B / Up / Space"
            const btn = inp.actionA || inp.actionB || inp.y < -0.45;
            if (btn && !b.lock) {
              flap = true;
              b.lock = true;
            }
            if (!btn) b.lock = false;
            dashBtn = inp.actionX || inp.actionY;
          } else {
            // Bot: aim for where the (possibly moving) gap will be when we reach it
            let nextP: Gate | null = null;
            for (const p of pipes) {
              if (p.x + 48 > b.x - 12) {
                nextP = p;
                break;
              }
            }
            let targetY = 270;
            if (nextP) {
              const eta = Math.max(0, (nextP.x + 24 - b.x) / PIPE_SPEED);
              targetY = gapAt(nextP, frame + Math.min(eta, 40));
            }
            // Flap from just below the gap centre (a flap rises ~78px), flap harder when far
            // below, with slight per-bot sloppiness so they stay beatable.
            const slop = Math.sin(frame * 0.07 + i * 1.9) * 7;
            if (b.y > targetY + 28 + slop && b.vy > 0.6) flap = true;
            else if (b.y > targetY + 70 && b.vy > -2.5) flap = true;
            if (nextP && Math.abs(nextP.x + 24 - b.x) < 60 && Math.abs(b.y - nextP.gapY) > 56 && b.dashCd === 0) {
              dashBtn = Math.random() < 0.5;
            }
          }

          const trigB = dashBtn && !b.prevB;
          b.prevB = dashBtn;
          if (b.dashCd > 0) b.dashCd--;
          if (b.dashTimer > 0) {
            b.dashTimer--;
            b.vy *= 0.5;
            if (frame % 2 === 0) vfx.afterimage(b.x, b.y, 13, '#38bdf8', 8);
          }

          if (trigB && b.dashCd === 0) {
            b.dashTimer = 15;
            b.dashCd = 75;
            b.vy = 0;
            vfx.ring(b.x, b.y, '#38bdf8', 40, 2.5);
            sound.dash();
            buzz(i, 40, 0.35);
          }

          if (flap) {
            b.vy = -7.6;
            for (let k = 0; k < 4; k++) {
              vfx.spark(b.x - 8, b.y + 8, -1.5 - Math.random() * 2, 1.5 + Math.random() * 2, '#f8fafc', 3);
            }
            sound.beep(520 + i * 35, 0.04);
          }

          if (b.dashTimer === 0) b.vy += 0.37;
          b.y += b.vy;

          if (b.y < 76 || b.y > GAME_HEIGHT - 36) crash(i, true);
        }

        let write = 0;
        for (let pi = 0; pi < pipes.length; pi++) {
          const p = pipes[pi];
          const wasAhead = p.x + 48 >= 190;
          p.x -= PIPE_SPEED;
          p.gapY = gapAt(p, frame);
          if (wasAhead && p.x + 48 < 190) {
            gatesCleared++;
            if (gatesCleared % 10 === 0) {
              vfx.popup(GAME_WIDTH / 2, 110, `${gatesCleared} GATES!`, '#4ade80', 18);
              sound.combo(10);
            }
          }

          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || !birds[i].alive) continue;
            const b = birds[i];
            // Golden coin ring inside gap
            if (!p.coinTaken[i] && Math.hypot(b.x - (p.x + 24), b.y - p.gapY) < 28) {
              p.coinTaken[i] = true;
              b.streak++;
              vfx.ring(p.x + 24, p.gapY, '#facc15', 40, 2);
              vfx.burst(p.x + 24, p.gapY, '#fde047', 6, 3);
              vfx.popup(b.x, b.y - 16, `RING x${b.streak}!`, '#facc15');
              sound.combo(b.streak);
              buzz(i, 30, 0.3);
            }

            if (b.dashTimer === 0 && b.x + 12 > p.x && b.x - 12 < p.x + 48) {
              if (b.y - 12 < p.gapY - p.gapH / 2 || b.y + 12 > p.gapY + p.gapH / 2) {
                crash(i, false);
              }
            }
          }
          if (p.x > -60) pipes[write++] = p;
        }
        pipes.length = write;

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && birds[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          if (alive.length === 1) {
            const w = alive[0];
            wins[w]++;
            banner = `${active[w].name} SKY ACE!`;
            bannerSub = `${gatesCleared} GATES · ${birds[w].streak} RINGS · NEW FLIGHT STARTING...`;
            vfx.confetti(birds[w].x, birds[w].y, 34);
            vfx.confetti(GAME_WIDTH / 2, 180, 30);
            vfx.flash('#4ade80', 0.18);
            sound.win();
            buzz(w, 240, 0.85);
          } else if (total === 1) {
            const isBest = gatesCleared > bestSoloGates;
            if (isBest) bestSoloGates = gatesCleared;
            banner = isBest ? `NEW BEST · ${gatesCleared} GATES!` : `${gatesCleared} GATES CLEARED`;
            bannerSub = `BEST ${bestSoloGates} · ${birds[0].streak} RINGS · NEW FLIGHT STARTING...`;
            if (isBest && gatesCleared > 0) {
              vfx.confetti(GAME_WIDTH / 2, 180, 34);
              sound.win();
            }
          } else {
            banner = 'SQUAD CRASH!';
            bannerSub = `${gatesCleared} GATES · NEW FLIGHT STARTING...`;
          }
          freeze = 95;
        }
      }

      drawArcadeBackdrop(ctx, '#4ade80');

      // Pipes & Laser Gates
      for (const p of pipes) {
        const topH = Math.max(0, p.gapY - p.gapH / 2 - 66);
        const botY = p.gapY + p.gapH / 2;
        ctx.fillStyle = p.moving ? '#7f1d1d' : '#166534';
        ctx.strokeStyle = p.moving ? '#ef4444' : '#4ade80';
        ctx.lineWidth = 2.5;
        ctx.fillRect(p.x, 66, 48, topH);
        ctx.strokeRect(p.x, 66, 48, topH);
        ctx.fillRect(p.x, botY, 48, Math.max(0, GAME_HEIGHT - 30 - botY));
        ctx.strokeRect(p.x, botY, 48, Math.max(0, GAME_HEIGHT - 30 - botY));

        // Golden coin ring in gap
        if (!p.coinTaken.every(Boolean)) {
          ctx.save();
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(p.x + 24, p.gapY, 9, 18, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !birds[i].alive) continue;
        const b = birds[i];
        drawPlayerOrb(ctx, b.x, b.y, 13, active[i].color, i, {
          angle: Math.max(-0.7, Math.min(0.7, b.vy * 0.08)),
          leader: maxWins > 0 && wins[i] === maxWins,
          shield: b.dashTimer > 0,
          cooldownPct: b.dashCd / 75,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#4ade80');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: maxWins > 0 && wins[i] === maxWins,
          valueText: `${birds[i].alive ? 'FLY' : 'KO'} ${birds[i].streak}◎ W${wins[i]}`,
        })),
        'FLAP: TAP A / B / UP / SPACE · PHASE DASH: X / Y (Q / E)',
      );
    },
  };
}

// 40. SNOWBALL FIGHT (Destructible Ice Forts, Giant Snowballs, Chill Freeze & Dodge Roll)
export function createSnowballFightEngine(): MiniGameEngine {
  const TARGET_SCORE = 300;
  const THROW_CD = 14;
  const DUMMY_COLOR = '#94a3b8';
  const scores = [0, 0, 0, 0];
  const wins = [0, 0, 0, 0];

  interface IceFort {
    x: number;
    y: number;
    w: number;
    h: number;
    hp: number;
    maxHp: number;
    regenTimer: number;
  }

  const forts: IceFort[] = [
    { x: 260, y: 170, w: 32, h: 72, hp: 4, maxHp: 4, regenTimer: 0 },
    { x: GAME_WIDTH - 292, y: 170, w: 32, h: 72, hp: 4, maxHp: 4, regenTimer: 0 },
    { x: 260, y: 330, w: 32, h: 72, hp: 4, maxHp: 4, regenTimer: 0 },
    { x: GAME_WIDTH - 292, y: 330, w: 32, h: 72, hp: 4, maxHp: 4, regenTimer: 0 },
    { x: GAME_WIDTH / 2 - 22, y: 260, w: 44, h: 56, hp: 5, maxHp: 5, regenTimer: 0 },
  ];

  const spawnFighter = (i: number) => ({
    x: i % 2 === 0 ? 130 : GAME_WIDTH - 130,
    y: i < 2 ? 155 : 415,
    vx: 0,
    vy: 0,
    dirX: i % 2 === 0 ? 1 : -1,
    dirY: 0,
    charge: 0,
    chill: 0,
    frozenTimer: 0,
    rollTimer: 0,
    rollCd: 0,
    prevB: false,
    throwCd: 0,
    hitFlash: 0,
    botGoal: 0, // bot: charge to reach before releasing
    botWait: 30 + i * 10, // bot: frames until next wind-up
    botTarget: -1,
  });
  const fighters = [0, 1, 2, 3].map(spawnFighter);

  let snowballs: Array<{ x: number; y: number; vx: number; vy: number; r: number; owner: number; mega: boolean }> = [];
  let banner = '';
  let bannerSub = '';
  let freeze = 20;

  const resetMatch = () => {
    for (let i = 0; i < 4; i++) {
      scores[i] = 0;
      Object.assign(fighters[i], spawnFighter(i));
    }
    for (const ft of forts) {
      ft.hp = ft.maxHp;
      ft.regenTimer = 0;
    }
    snowballs = [];
    banner = '';
    bannerSub = '';
    freeze = 20;
  };

  // Keep a fighter out of intact forts, even when its centre ended up inside one.
  const pushOutOfFort = (f: { x: number; y: number }, ft: IceFort, r: number) => {
    if (f.x > ft.x && f.x < ft.x + ft.w && f.y > ft.y && f.y < ft.y + ft.h) {
      const dl = f.x - ft.x;
      const dr = ft.x + ft.w - f.x;
      const dt = f.y - ft.y;
      const db = ft.y + ft.h - f.y;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) f.x = ft.x - r;
      else if (m === dr) f.x = ft.x + ft.w + r;
      else if (m === dt) f.y = ft.y - r;
      else f.y = ft.y + ft.h + r;
      return;
    }
    const cx = Math.max(ft.x, Math.min(ft.x + ft.w, f.x));
    const cy = Math.max(ft.y, Math.min(ft.y + ft.h, f.y));
    const dx = f.x - cx;
    const dy = f.y - cy;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < r) {
      f.x += (dx / d) * (r - d);
      f.y += (dy / d) * (r - d);
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
      // Solo with bots off: empty slots become wandering snowman targets
      const solo = enabledCount === 1;
      const live = [0, 1, 2, 3].map((i) => active[i].enabled || solo);
      const isDummy = (i: number) => solo && !active[i].enabled;
      const colorOf = (i: number) => (isDummy(i) ? DUMMY_COLOR : active[i].color);
      const buzz = (slot: number, ms: number, intensity: number) => {
        if (active[slot].isHuman) rumble(slot, ms, intensity);
      };
      const maxScore = Math.max(...scores);
      const maxWins = Math.max(...wins);

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        if (freeze === 0 && banner) resetMatch();
      } else {
        // Regenerating forts
        for (const ft of forts) {
          if (ft.hp <= 0) {
            ft.regenTimer++;
            if (ft.regenTimer >= 260) {
              ft.hp = ft.maxHp;
              ft.regenTimer = 0;
              vfx.ring(ft.x + ft.w / 2, ft.y + ft.h / 2, '#bae6fd', 44, 2);
              sound.pickup(260);
            }
          }
        }

        for (let i = 0; i < 4; i++) {
          if (!live[i]) continue;
          const f = fighters[i];
          if (f.rollCd > 0) f.rollCd--;
          if (f.rollTimer > 0) f.rollTimer--;
          if (f.throwCd > 0) f.throwCd--;
          if (f.hitFlash > 0) f.hitFlash--;

          if (f.frozenTimer > 0) {
            f.frozenTimer--;
            f.vx *= 0.8;
            f.vy *= 0.8;
            // Knockback while frozen used to slide fighters out of the arena / into forts
            f.x = Math.max(54, Math.min(GAME_WIDTH - 54, f.x + f.vx));
            f.y = Math.max(88, Math.min(GAME_HEIGHT - 50, f.y + f.vy));
            for (const ft of forts) if (ft.hp > 0) pushOutOfFort(f, ft, 18);
            if (f.frozenTimer === 0) {
              vfx.burst(f.x, f.y, '#e0f2fe', 10, 3.5);
              sound.beep(880, 0.05, 'sine', 0.05);
            }
            continue;
          }
          if (f.chill > 0 && frame % 3 === 0) f.chill--;

          let ix = 0;
          let iy = 0;
          let hold = false;
          let rollBtn = false;
          let aimX = 0;
          let aimY = 0;

          if (isDummy(i)) {
            ix = Math.cos(frame * 0.013 + i * 2.2) * 0.45;
            iy = Math.sin(frame * 0.019 + i * 1.3) * 0.45;
          } else if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            hold = inp.actionA;
            rollBtn = inp.actionB;
          } else {
            // Bot: harass the nearest rival, wind up a random-size throw, aim on release
            const valid = f.botTarget >= 0 && live[f.botTarget];
            if (!valid || frame % 100 === i * 25) {
              let best = -1;
              let bestD = Infinity;
              for (let j = 0; j < 4; j++) {
                if (j === i || !live[j]) continue;
                const d = Math.hypot(fighters[j].x - f.x, fighters[j].y - f.y) * (0.75 + Math.random() * 0.5);
                if (d < bestD) {
                  bestD = d;
                  best = j;
                }
              }
              f.botTarget = best;
            }
            const target = f.botTarget >= 0 ? fighters[f.botTarget] : null;
            if (target) {
              const dx = target.x - f.x;
              const dy = target.y - f.y;
              const d = Math.hypot(dx, dy) || 1;
              // Keep a throwing distance instead of hugging the target
              const approach = d > 260 ? 0.72 : d < 150 ? -0.5 : 0;
              ix = (dx / d) * approach + Math.cos(frame * 0.04 + i) * 0.45;
              iy = (dy / d) * approach + Math.sin(frame * 0.04 + i) * 0.45;
              if (f.charge === 0) {
                if (f.botWait > 0) f.botWait--;
                else if (f.throwCd === 0) {
                  f.botGoal = target.frozenTimer > 0 ? 6 : Math.random() < 0.35 ? 24 + Math.random() * 10 : 4 + Math.random() * 12;
                  hold = true;
                }
              } else {
                hold = f.charge < f.botGoal;
              }
              if (!hold && f.charge > 0) {
                // Release: lead the target a little, with some error
                const spd = f.charge > 22 ? 9.8 : 7.6;
                const t = d / spd;
                const lx = target.x + target.vx * t * 0.6 - f.x;
                const ly = target.y + target.vy * t * 0.6 - f.y;
                const ang = Math.atan2(ly, lx) + (Math.random() - 0.5) * 0.18;
                aimX = Math.cos(ang);
                aimY = Math.sin(ang);
                f.botWait = 20 + Math.floor(Math.random() * 40);
              }
            }
            for (const sb of snowballs) {
              if (sb.owner !== i && f.rollCd === 0 && Math.hypot(sb.x - f.x, sb.y - f.y) < 75) {
                // Only roll for balls actually heading our way
                if (sb.vx * (f.x - sb.x) + sb.vy * (f.y - sb.y) > 0 && Math.random() < 0.3) {
                  rollBtn = true;
                  break;
                }
              }
            }
          }

          const trigB = rollBtn && !f.prevB;
          f.prevB = rollBtn;

          if (Math.hypot(ix, iy) > 0.15) {
            const m = Math.hypot(ix, iy);
            f.dirX = ix / m;
            f.dirY = iy / m;
          }
          if (aimX !== 0 || aimY !== 0) {
            f.dirX = aimX;
            f.dirY = aimY;
          }

          if (trigB && f.rollCd === 0) {
            f.rollTimer = 14;
            f.rollCd = 45;
            f.vx = f.dirX * 9.5;
            f.vy = f.dirY * 9.5;
            vfx.burst(f.x, f.y, '#e0f2fe', 7, 3);
            sound.dash();
            buzz(i, 35, 0.3);
          }

          if (f.rollTimer > 0 && frame % 2 === 0) {
            vfx.afterimage(f.x, f.y, 16, '#bae6fd', 8);
          }

          const chillMult = 1 - Math.min(0.45, (f.chill / 100) * 0.45);
          const moveSpd = (hold ? 2.4 : isDummy(i) ? 2.6 : 4.5) * chillMult;
          if (f.rollTimer === 0) {
            f.vx = f.vx * 0.78 + ix * moveSpd * 0.45;
            f.vy = f.vy * 0.78 + iy * moveSpd * 0.45;
          }
          f.x = Math.max(54, Math.min(GAME_WIDTH - 54, f.x + f.vx));
          f.y = Math.max(88, Math.min(GAME_HEIGHT - 50, f.y + f.vy));

          // Collide with intact ice forts
          for (const ft of forts) if (ft.hp > 0) pushOutOfFort(f, ft, 18);

          if (hold && f.throwCd === 0) {
            f.charge = Math.min(36, f.charge + 1);
            if (f.charge === 23) {
              // Mega-snowball threshold reached
              vfx.ring(f.x, f.y, '#e0f2fe', 34, 2);
              sound.beep(990, 0.06, 'triangle', 0.06);
              buzz(i, 30, 0.3);
            }
          } else if (f.charge > 0) {
            const mega = f.charge > 22;
            snowballs.push({
              x: f.x + f.dirX * 22,
              y: f.y + f.dirY * 22,
              vx: f.dirX * (mega ? 9.8 : 7.6),
              vy: f.dirY * (mega ? 9.8 : 7.6),
              r: mega ? 15 : 8,
              owner: i,
              mega,
            });
            f.charge = 0;
            f.throwCd = THROW_CD; // stops tap-spam machine-gunning
            sound.sweep(mega ? 500 : 700, mega ? 180 : 260, mega ? 0.16 : 0.09, 'triangle', mega ? 0.09 : 0.06);
            if (mega) vfx.burst(f.x + f.dirX * 22, f.y + f.dirY * 22, '#e0f2fe', 8, 3);
          }
        }

        let write = 0;
        for (let si = 0; si < snowballs.length; si++) {
          const sb = snowballs[si];
          sb.x += sb.vx;
          sb.y += sb.vy;
          if (sb.mega && frame % 2 === 0) {
            vfx.afterimage(sb.x, sb.y, sb.r, '#e0f2fe', 7);
          }
          let keep = sb.x > 30 && sb.x < GAME_WIDTH - 30 && sb.y > 68 && sb.y < GAME_HEIGHT - 30;

          // Hit ice forts
          if (keep) {
            for (const ft of forts) {
              if (ft.hp > 0 && sb.x + sb.r > ft.x && sb.x - sb.r < ft.x + ft.w && sb.y + sb.r > ft.y && sb.y - sb.r < ft.y + ft.h) {
                ft.hp -= sb.mega ? 2 : 1;
                vfx.burst(sb.x, sb.y, '#bae6fd', 12, 5);
                if (ft.hp <= 0) {
                  vfx.burst(ft.x + ft.w / 2, ft.y + ft.h / 2, '#e0f2fe', 18, 5.5);
                  vfx.popup(ft.x + ft.w / 2, ft.y - 8, 'FORT SMASHED!', '#bae6fd', 13);
                  vfx.shake(4);
                }
                sound.noiseBurst(0.12, 1800, 0.12);
                keep = false;
                break;
              }
            }
          }

          // Hit players
          if (keep) {
            for (let i = 0; i < 4; i++) {
              if (!live[i] || i === sb.owner) continue;
              const f = fighters[i];
              if (f.rollTimer > 0) continue; // Dodge roll iframes!
              if (Math.hypot(sb.x - f.x, sb.y - f.y) < sb.r + 16) {
                const wasFrozen = f.frozenTimer > 0;
                const pts = wasFrozen ? 35 : sb.mega ? 25 : 10;
                scores[sb.owner] += pts;
                f.hitFlash = 10;

                // Knockback + Chill buildup
                f.vx += sb.vx * (sb.mega ? 1.15 : 0.65);
                f.vy += sb.vy * (sb.mega ? 1.15 : 0.65);
                f.chill = Math.min(100, f.chill + (sb.mega ? 60 : 35));
                if (wasFrozen) {
                  f.frozenTimer = 0;
                  f.chill = 0;
                  vfx.hitstop(3);
                  vfx.ring(f.x, f.y, '#38bdf8', 60, 3.5);
                  vfx.popup(f.x, f.y - 18, 'ICE SHATTER +35!', '#38bdf8', 16);
                  sound.noiseBurst(0.18, 2200, 0.16);
                } else if (f.chill >= 100) {
                  f.frozenTimer = 95;
                  f.chill = 0;
                  f.charge = 0; // drop the half-packed snowball instead of auto-throwing on thaw
                  vfx.ring(f.x, f.y, '#7dd3fc', 48, 3);
                  vfx.popup(f.x, f.y - 18, 'FROZEN!', '#7dd3fc', 16);
                  sound.combo(5);
                  buzz(i, 200, 0.7);
                } else {
                  vfx.popup(f.x, f.y - 16, sb.mega ? 'MEGA HIT +25!' : '+10', colorOf(sb.owner));
                  sound.hit();
                }

                if (sb.mega) vfx.hitstop(2);
                vfx.burst(f.x, f.y, '#e0f2fe', 18, 6);
                vfx.shake(sb.mega ? 8 : 4);
                buzz(i, 120, 0.8);
                buzz(sb.owner, 50, 0.4);
                keep = false;
                break;
              }
            }
          }
          if (keep) snowballs[write++] = sb;
        }
        snowballs.length = write;

        // Match win
        let winner = -1;
        for (let i = 0; i < 4; i++) {
          if (active[i].enabled && scores[i] >= TARGET_SCORE && (winner < 0 || scores[i] > scores[winner])) winner = i;
        }
        if (winner >= 0) {
          wins[winner]++;
          banner = `${active[winner].name} SNOW KING!`;
          bannerSub = `FIRST TO ${TARGET_SCORE}PT · RE-PACKING THE RINK...`;
          vfx.confetti(GAME_WIDTH / 2, 220, 44);
          vfx.confetti(fighters[winner].x, fighters[winner].y, 30);
          vfx.flash('#e0f2fe', 0.25);
          vfx.shake(6);
          sound.win();
          buzz(winner, 260, 0.9);
          freeze = 120;
        }
      }

      drawArcadeBackdrop(ctx, '#7dd3fc');

      // Ice Forts
      for (const ft of forts) {
        if (ft.hp <= 0) {
          ctx.strokeStyle = 'rgba(125, 211, 252, 0.25)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(ft.x, ft.y, ft.w, ft.h);
          ctx.setLineDash([]);
          continue;
        }
        ctx.save();
        ctx.fillStyle = ft.hp >= 3 ? '#0284c7' : '#0369a1';
        ctx.strokeStyle = '#bae6fd';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(ft.x, ft.y, ft.w, ft.h, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Snowballs (additive halo instead of per-ball shadowBlur)
      ctx.save();
      for (const sb of snowballs) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#bae6fd';
        ctx.beginPath();
        ctx.arc(sb.x, sb.y, sb.r + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#f0f9ff';
        ctx.beginPath();
        ctx.arc(sb.x, sb.y, sb.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Fighters
      for (let i = 0; i < 4; i++) {
        if (!live[i]) continue;
        const f = fighters[i];
        // Chill ring indicator
        if (f.chill > 0 && f.frozenTimer === 0) {
          ctx.strokeStyle = '#7dd3fc';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (f.chill / 100));
          ctx.stroke();
        }
        drawPlayerOrb(ctx, f.x, f.y, 17, f.frozenTimer > 0 ? '#bae6fd' : colorOf(i), i, {
          angle: Math.atan2(f.dirY, f.dirX),
          leader: !isDummy(i) && maxScore > 0 && scores[i] === maxScore,
          shield: f.frozenTimer > 0 || f.rollTimer > 0,
          flash: f.hitFlash > 0 && frame % 4 < 2,
          cooldownPct: f.rollCd / 45,
        });
        if (f.charge > 4) {
          ctx.fillStyle = f.charge > 22 && frame % 6 < 3 ? '#ffffff' : '#f0f9ff';
          ctx.beginPath();
          ctx.arc(f.x + f.dirX * 21, f.y + f.dirY * 21, 4 + f.charge * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, bannerSub, '#7dd3fc');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: isDummy(i) ? 'SNOWMAN' : a.name,
          color: colorOf(i),
          active: live[i],
          highlight: !isDummy(i) && maxScore > 0 && scores[i] === maxScore,
          valueText: isDummy(i) ? 'TARGET' : maxWins > 0 ? `${scores[i]}/${TARGET_SCORE} W${wins[i]}` : `${scores[i]}/${TARGET_SCORE}`,
        })),
        'MOVE: STICK / WASD · HOLD & RELEASE A / SPACE TO THROW · DODGE ROLL: B / SHIFT',
      );
    },
  };
}
