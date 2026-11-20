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

// 26. BOMBER GRID (Powerup Drops, Plasma Blast Corridors, Chain Detonations, Smart Bomb-Fleeing AI!)
export function createBomberGridEngine(): MiniGameEngine {
  const COLS = 13;
  const ROWS = 9;
  const CELL = 46;
  const OX = (GAME_WIDTH - COLS * CELL) / 2;
  const OY = 82;

  const wins = [0, 0, 0, 0];
  const grid = new Int8Array(COLS * ROWS); // 0=empty, 1=solid wall, 2=crate

  const makeFighters = () => [
    { x: OX + CELL * 0.5, y: OY + CELL * 0.5, alive: true, cd: 0, maxBombs: 1, range: 2, speed: 3.1, prevA: false, aiReact: 0, aiWasDanger: false, aiIx: 0, aiIy: 0 },
    { x: OX + (COLS - 0.5) * CELL, y: OY + (ROWS - 0.5) * CELL, alive: true, cd: 0, maxBombs: 1, range: 2, speed: 3.1, prevA: false, aiReact: 0, aiWasDanger: false, aiIx: 0, aiIy: 0 },
    { x: OX + (COLS - 0.5) * CELL, y: OY + CELL * 0.5, alive: true, cd: 0, maxBombs: 1, range: 2, speed: 3.1, prevA: false, aiReact: 0, aiWasDanger: false, aiIx: 0, aiIy: 0 },
    { x: OX + CELL * 0.5, y: OY + (ROWS - 0.5) * CELL, alive: true, cd: 0, maxBombs: 1, range: 2, speed: 3.1, prevA: false, aiReact: 0, aiWasDanger: false, aiIx: 0, aiIy: 0 },
  ];

  let fighters = makeFighters();
  let bombs: Array<{ c: number; r: number; timer: number; owner: number; range: number }> = [];
  let flames: Array<{ c: number; r: number; timer: number; maxTimer: number }> = [];
  let pickups: Array<{ c: number; r: number; type: 'range' | 'bomb' | 'speed' }> = [];
  let banner = '';
  let freeze = 20;

  const reset = () => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (r % 2 === 1 && c % 2 === 1) grid[r * COLS + c] = 1;
        else {
          const isCorner = (c <= 1 || c >= COLS - 2) && (r <= 1 || r >= ROWS - 2);
          grid[r * COLS + c] = !isCorner && Math.random() < 0.58 ? 2 : 0;
        }
      }
    }
    fighters = makeFighters();
    bombs = [];
    flames = [];
    pickups = [];
    banner = '';
    freeze = 20;
  };
  reset();

  const isCellWalkable = (c: number, r: number, ignoreBombAt?: { c: number; r: number }) => {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    if (grid[r * COLS + c] !== 0) return false;
    if (bombs.some((b) => b.c === c && b.r === r && !(ignoreBombAt && ignoreBombAt.c === c && ignoreBombAt.r === r))) {
      return false;
    }
    return true;
  };

  const isWalkablePos = (x: number, y: number, ownC: number, ownR: number) => {
    const c = Math.floor((x - OX) / CELL);
    const r = Math.floor((y - OY) / CELL);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    if (grid[r * COLS + c] !== 0) return false;
    if (bombs.some((b) => b.c === c && b.r === r && !(c === ownC && r === ownR))) return false;
    return true;
  };

  const buildDangerMap = (extraBomb?: { c: number; r: number; range: number }) => {
    // 1 = will be in a blast, 2 = burning right now (never walk through)
    const danger = new Uint8Array(COLS * ROWS);
    for (const fl of flames) {
      danger[fl.r * COLS + fl.c] = 2;
    }
    const allBombs = extraBomb ? [...bombs, extraBomb] : bombs;
    for (const b of allBombs) {
      if (danger[b.r * COLS + b.c] === 0) danger[b.r * COLS + b.c] = 1;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dc, dr] of dirs) {
        for (let step = 1; step <= b.range; step++) {
          const cc = b.c + dc * step;
          const rr = b.r + dr * step;
          if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) break;
          if (grid[rr * COLS + cc] === 1) break;
          if (danger[rr * COLS + cc] === 0) danger[rr * COLS + cc] = 1;
          if (grid[rr * COLS + cc] === 2) break;
        }
      }
    }
    return danger;
  };

  const DIRS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  // Reusable BFS scratch buffers (no per-call queue-of-objects allocation / O(n) shift)
  const bfsQueue = new Int16Array(COLS * ROWS);
  const bfsFirst = new Int8Array(COLS * ROWS);
  const bfsDist = new Int16Array(COLS * ROWS);
  const bfsSeen = new Uint8Array(COLS * ROWS);

  /**
   * Breadth-first search from (startC,startR) to the nearest cell satisfying `goal`.
   * Returns the first-step direction index into DIRS, -1 if the start already satisfies the
   * goal, or -2 if unreachable. `avoid` = 1 skips any blast-zone cell, 2 only skips burning cells.
   */
  const bfsStep = (
    startC: number,
    startR: number,
    danger: Uint8Array,
    avoid: 1 | 2,
    maxDist: number,
    goal: (c: number, r: number) => boolean,
  ): number => {
    if (goal(startC, startR)) return -1;
    bfsSeen.fill(0);
    let head = 0;
    let tail = 0;
    const s0 = startR * COLS + startC;
    bfsQueue[tail++] = s0;
    bfsSeen[s0] = 1;
    bfsFirst[s0] = -1;
    bfsDist[s0] = 0;
    while (head < tail) {
      const cur = bfsQueue[head++];
      const cc = cur % COLS;
      const cr = (cur - cc) / COLS;
      if (bfsDist[cur] >= maxDist) continue;
      for (let d = 0; d < 4; d++) {
        const nc = cc + DIRS[d][0];
        const nr = cr + DIRS[d][1];
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
        const ni = nr * COLS + nc;
        if (bfsSeen[ni]) continue;
        bfsSeen[ni] = 1;
        if (!isCellWalkable(nc, nr) || danger[ni] >= avoid) continue;
        bfsFirst[ni] = cur === s0 ? d : bfsFirst[cur];
        bfsDist[ni] = bfsDist[cur] + 1;
        if (goal(nc, nr)) return bfsFirst[ni];
        bfsQueue[tail++] = ni;
      }
    }
    return -2;
  };

  const findSafeEscapeStep = (startC: number, startR: number, danger: Uint8Array): [number, number] | null => {
    const d = bfsStep(startC, startR, danger, 2, 7, (c, r) => danger[r * COLS + c] === 0);
    if (d === -2) return null;
    if (d === -1) return [0, 0];
    return [DIRS[d][0], DIRS[d][1]];
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
        const danger = buildDangerMap();

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled || !fighters[i].alive) continue;
          const f = fighters[i];
          const curC = Math.floor((f.x - OX) / CELL);
          const curR = Math.floor((f.y - OY) / CELL);
          let ix = 0;
          let iy = 0;
          let btnA = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            btnA = inp.actionA;
          } else {
            // Smart bomb-fleeing AI, now fully grid-pathed (BFS). The old bot walked in a
            // straight line at pickups through solid walls and got stuck, and its escape search
            // happily routed through live flames.
            const cx = OX + (curC + 0.5) * CELL;
            const cy = OY + (curR + 0.5) * CELL;
            let stepDir = -2;
            const inDanger = danger[curR * COLS + curC] !== 0;
            // Human-like reaction time when a threat first appears (someone ELSE's bomb). Without
            // it two CPUs could bomb-and-dodge each other perfectly forever.
            if (inDanger && !f.aiWasDanger) {
              const ownBombHere = bombs.some((b) => b.owner === i && b.c === curC && b.r === curR);
              f.aiReact = ownBombHere ? 0 : 4 + Math.floor(Math.random() * 16);
            }
            f.aiWasDanger = inDanger;
            if (inDanger && f.aiReact > 0) {
              f.aiReact--;
              stepDir = -3; // keep doing whatever we were doing
            } else if (inDanger) {
              stepDir = bfsStep(curC, curR, danger, 2, 8, (c, r) => danger[r * COLS + c] === 0);
            } else {
              const range = f.range;
              const isGoal = (c: number, r: number) => {
                for (const pk of pickups) if (pk.c === c && pk.r === r) return true;
                for (let d = 0; d < 4; d++) {
                  const nc = c + DIRS[d][0];
                  const nr = r + DIRS[d][1];
                  if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS && grid[nr * COLS + nc] === 2) return true;
                }
                for (let j = 0; j < 4; j++) {
                  const o = fighters[j];
                  if (j === i || !active[j].enabled || !o.alive) continue;
                  const fc = Math.floor((o.x - OX) / CELL);
                  const fr = Math.floor((o.y - OY) / CELL);
                  if ((fc === c && Math.abs(fr - r) <= range) || (fr === r && Math.abs(fc - c) <= range)) return true;
                }
                return false;
              };
              stepDir = bfsStep(curC, curR, danger, 1, 16, isGoal);
              if (stepDir === -1) {
                // At a bombing spot: plant only if centred and a safe escape route exists
                const centred = Math.abs(f.x - cx) < 9 && Math.abs(f.y - cy) < 9;
                if (centred && f.cd === 0 && Math.random() < 0.2) {
                  // Escape must be short (≤4 cells ≈ 60f of a 92f fuse) and must NOT route
                  // through other bombs' blast zones — the old check allowed both, and ~40% of
                  // CPU deaths were self-inflicted.
                  const simDanger = buildDangerMap({ c: curC, r: curR, range: f.range });
                  if (bfsStep(curC, curR, danger, 1, 4, (c, r) => simDanger[r * COLS + c] === 0) >= 0) {
                    btnA = true;
                  }
                }
              } else if (stepDir === -2) {
                // Nothing reachable: drift between safe neighbours
                const off = (Math.floor(frame / 28) + i) % 4;
                for (let k = 0; k < 4; k++) {
                  const d = (off + k) % 4;
                  const nc = curC + DIRS[d][0];
                  const nr = curR + DIRS[d][1];
                  if (isCellWalkable(nc, nr) && danger[nr * COLS + nc] === 0) {
                    stepDir = d;
                    break;
                  }
                }
              }
            }
            if (stepDir === -3) {
              ix = f.aiIx;
              iy = f.aiIy;
            } else {
              const tx = stepDir >= 0 ? cx + DIRS[stepDir][0] * CELL : cx;
              const ty = stepDir >= 0 ? cy + DIRS[stepDir][1] * CELL : cy;
              const ddx = tx - f.x;
              const ddy = ty - f.y;
              const dd = Math.hypot(ddx, ddy);
              if (dd > 1.5) {
                const sp = Math.min(1, dd / f.speed);
                ix = (ddx / dd) * sp;
                iy = (ddy / dd) * sp;
              }
            }
            f.aiIx = ix;
            f.aiIy = iy;
          }

          // Only test the LEADING edge of movement. Checking both ±10 edges meant a fighter whose
          // centre sat within 10px of a blocked neighbour could never move on that axis again
          // (permanent freeze — observed bots stuck for entire rounds).
          if (Math.abs(ix) > 0.01) {
            const nx = f.x + ix * f.speed;
            if (isWalkablePos(nx + Math.sign(ix) * 10, f.y, curC, curR)) f.x = nx;
          }
          if (Math.abs(iy) > 0.01) {
            const ny = f.y + iy * f.speed;
            if (isWalkablePos(f.x, ny + Math.sign(iy) * 10, curC, curR)) f.y = ny;
          }
          // Lane assist: while travelling along one axis, ease onto the corridor centre line so
          // orbs don't clip through pillar corners and turning into side corridors feels clean.
          if (Math.abs(ix) > 0.2 && Math.abs(iy) < 0.2) {
            const lane = OY + (Math.floor((f.y - OY) / CELL) + 0.5) * CELL;
            f.y += Math.max(-f.speed * 0.6, Math.min(f.speed * 0.6, lane - f.y));
          } else if (Math.abs(iy) > 0.2 && Math.abs(ix) < 0.2) {
            const lane = OX + (Math.floor((f.x - OX) / CELL) + 0.5) * CELL;
            f.x += Math.max(-f.speed * 0.6, Math.min(f.speed * 0.6, lane - f.x));
          }

          // Collect pickups (in-place; uses the post-move cell)
          const nowC = Math.floor((f.x - OX) / CELL);
          const nowR = Math.floor((f.y - OY) / CELL);
          for (let pi = pickups.length - 1; pi >= 0; pi--) {
            const pk = pickups[pi];
            if (pk.c === nowC && pk.r === nowR) {
              if (pk.type === 'range') {
                f.range = Math.min(5, f.range + 1);
                vfx.popup(f.x, f.y - 16, '+RANGE!', '#ff6b2b', 12);
              } else if (pk.type === 'bomb') {
                f.maxBombs = Math.min(4, f.maxBombs + 1);
                vfx.popup(f.x, f.y - 16, '+BOMB!', '#38bdf8', 12);
              } else {
                f.speed = Math.min(4.6, f.speed + 0.4);
                vfx.popup(f.x, f.y - 16, '+SPEED!', '#2ee59d', 12);
              }
              vfx.ring(f.x, f.y, '#facc15', 36, 2);
              vfx.burst(f.x, f.y, '#facc15', 8, 3.5);
              sound.pickup(100);
              rumble(i, 45, 0.4);
              pickups.splice(pi, 1);
            }
          }

          if (f.cd > 0) f.cd--;
          const tapA = btnA && !f.prevA;
          f.prevA = btnA;
          let ownBombs = 0;
          let cellTaken = false;
          for (const b of bombs) {
            if (b.owner === i) ownBombs++;
            if (b.c === curC && b.r === curR) cellTaken = true;
          }
          if (tapA && f.cd === 0 && ownBombs < f.maxBombs && !cellTaken) {
            bombs.push({ c: curC, r: curR, timer: 92, owner: i, range: f.range });
            f.cd = 16;
            sound.beep(320, 0.05);
            vfx.ring(OX + (curC + 0.5) * CELL, OY + (curR + 0.5) * CELL, '#facc15', 28, 2);
            rumble(i, 30, 0.3);
          }
        }

        // Detonate bombs + chain detonations!
        const toExplode: typeof bombs = [];
        bombs = bombs.filter((b) => {
          b.timer--;
          if (b.timer <= 0) {
            toExplode.push(b);
            return false;
          }
          return true;
        });

        let chainCount = 0;
        let ownersHit = 0;
        while (toExplode.length > 0) {
          const b = toExplode.shift()!;
          chainCount++;
          ownersHit |= 1 << b.owner;
          vfx.ring(OX + (b.c + 0.5) * CELL, OY + (b.r + 0.5) * CELL, '#fde047', 30 + b.range * 18, 3);
          const dirs = [
            [0, 0],
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          for (const [dc, dr] of dirs) {
            const maxStep = dc === 0 && dr === 0 ? 0 : b.range;
            for (let step = 0; step <= maxStep; step++) {
              const cc = b.c + dc * step;
              const rr = b.r + dr * step;
              if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) break;
              const cell = grid[rr * COLS + cc];
              if (cell === 1) break;
              // Refresh an existing flame in this cell instead of stacking duplicates
              let existing = false;
              for (const fl of flames) {
                if (fl.c === cc && fl.r === rr) {
                  fl.timer = fl.maxTimer;
                  existing = true;
                  break;
                }
              }
              if (!existing) flames.push({ c: cc, r: rr, timer: 26, maxTimer: 26 });

              // Chain detonate any bomb caught in blast corridor!
              const chainIdx = bombs.findIndex((ob) => ob.c === cc && ob.r === rr);
              if (chainIdx >= 0) {
                const [chained] = bombs.splice(chainIdx, 1);
                toExplode.push(chained);
              }

              if (cell === 2) {
                grid[rr * COLS + cc] = 0;
                const px = OX + cc * CELL + CELL / 2;
                const py = OY + rr * CELL + CELL / 2;
                vfx.burst(px, py, '#facc15', 12, 4.5);
                if (Math.random() < 0.36) {
                  const roll = Math.random();
                  pickups.push({
                    c: cc,
                    r: rr,
                    type: roll < 0.36 ? 'range' : roll < 0.72 ? 'bomb' : 'speed',
                  });
                }
                break;
              }
            }
          }
        }
        // One explosion sound/shake per frame — chains used to fire N stacked explosion() calls
        if (chainCount > 0) {
          vfx.shake(Math.min(14, 6 + chainCount * 1.5));
          sound.explosion();
          if (chainCount > 1) {
            vfx.hitstop(Math.min(4, chainCount));
            sound.combo(chainCount);
            vfx.flash('#ff6b2b', Math.min(0.2, 0.05 * chainCount));
          }
          for (let o = 0; o < 4; o++) if (ownersHit & (1 << o)) rumble(o, 70, 0.55);
        }

        flames = flames.filter((fl) => {
          fl.timer--;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || !fighters[i].alive) continue;
            const c = Math.floor((fighters[i].x - OX) / CELL);
            const r = Math.floor((fighters[i].y - OY) / CELL);
            if (c === fl.c && r === fl.r) {
              fighters[i].alive = false;
              vfx.hitstop(2);
              vfx.burst(fighters[i].x, fighters[i].y, active[i].color, 26, 7);
              vfx.ring(fighters[i].x, fighters[i].y, '#ff6b2b', 65, 3);
              vfx.popup(fighters[i].x, fighters[i].y - 16, 'BLASTED!', '#ff6b2b', 15);
              vfx.shake(10);
              rumble(i, 170, 0.95);
            }
          }
          return fl.timer > 0;
        });

        const alive = [0, 1, 2, 3].filter((i) => active[i].enabled && fighters[i].alive);
        const total = active.filter((a) => a.enabled).length;
        if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
          if (alive.length === 1) {
            wins[alive[0]]++;
            banner = `${active[alive[0]].name} BOMBER CHAMP!`;
            sound.win();
            vfx.confetti(fighters[alive[0]].x, fighters[alive[0]].y, 46);
            vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 26);
            vfx.flash(active[alive[0]].color, 0.22);
            rumble(alive[0], 220, 0.6);
          } else {
            banner = 'BLAST DRAW!';
          }
          freeze = 90;
        } else if (total === 1 && alive.length === 1 && bombs.length === 0 && flames.length === 0 && !grid.includes(2)) {
          // Solo (no bots): clearing every crate ends the round instead of idling forever
          wins[alive[0]]++;
          banner = 'GRID CLEARED!';
          sound.win();
          vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 46);
          vfx.flash(active[alive[0]].color, 0.22);
          rumble(alive[0], 220, 0.6);
          freeze = 90;
        }
      }

      drawArcadeBackdrop(ctx, '#ff6b2b');

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const val = grid[r * COLS + c];
          const x = OX + c * CELL;
          const y = OY + r * CELL;
          if (val === 1) {
            ctx.fillStyle = '#1f2937';
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 4);
            ctx.fill();
            ctx.stroke();
          } else if (val === 2) {
            ctx.fillStyle = '#b45309';
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(x + 4, y + 4, CELL - 8, CELL - 8, 6);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // Powerup Pickups
      for (const pk of pickups) {
        const px = OX + (pk.c + 0.5) * CELL;
        const py = OY + (pk.r + 0.5) * CELL;
        const col = pk.type === 'range' ? '#ff6b2b' : pk.type === 'bomb' ? '#38bdf8' : '#2ee59d';
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px, py, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(pk.type === 'range' ? '+R' : pk.type === 'bomb' ? '+B' : '+S', px, py + 4);
        ctx.restore();
      }

      // Animated glowing plasma blast corridors — additive bloom rect instead of shadowBlur
      // (a big chain can light 50+ cells at once)
      if (flames.length > 0) {
        ctx.save();
        for (const fl of flames) {
          const alpha = fl.timer / fl.maxTimer;
          const x = OX + fl.c * CELL;
          const y = OY + fl.r * CELL;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = alpha * 0.35;
          ctx.fillStyle = '#ff6b2b';
          ctx.fillRect(x - 4, y - 4, CELL + 8, CELL + 8);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 6);
          ctx.fill();
          ctx.fillStyle = '#fef08a';
          ctx.beginPath();
          ctx.roundRect(x + 10, y + 10, CELL - 20, CELL - 20, 4);
          ctx.fill();
        }
        ctx.restore();
      }

      for (const b of bombs) {
        const bx = OX + (b.c + 0.5) * CELL;
        const by = OY + (b.r + 0.5) * CELL;
        const pulse = 1 + Math.sin(frame * 0.3) * 0.14;
        ctx.save();
        ctx.shadowColor = b.timer < 28 ? '#ef4444' : '#facc15';
        ctx.shadowBlur = 14;
        ctx.fillStyle = b.timer < 28 && b.timer % 6 < 3 ? '#ef4444' : '#facc15';
        ctx.beginPath();
        ctx.arc(bx, by, 13 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled || !fighters[i].alive) continue;
        const f = fighters[i];
        drawPlayerOrb(ctx, f.x, f.y, 14, active[i].color, i, {
          leader: i === leaderSlot,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'REBUILDING CRATE MAZE...', '#ff6b2b');
      }

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderSlot,
          valueText: `${fighters[i].alive ? `R${fighters[i].range}` : 'KO'} · W${wins[i]}`,
        })),
        'MOVE: STICK / WASD   ·   PLANT BOMB: A / SPACE   ·   COLLECT +R / +B / +S!',
      );
    },
  };
}

// 27. TUG-O-WAR CLASH (2v2 Rhythm-Pulse Surge Meter, Leaning Tuggers, Rope Sparks & Pitfall KO!)
export function createTugOfWarEngine(): MiniGameEngine {
  let ropeOffset = 0; // -250 = Left wins, +250 = Right wins
  const teamWins = [0, 0];
  const lock = [false, false, false, false];
  const pulls = [0, 0, 0, 0];
  const lean = [0, 0, 0, 0];
  // CPU tap scheduler: frames until next pull (old bots pulled ~3x/sec — trivially out-mashed)
  const botNext = [8, 10, 12, 14];
  let banner = '';
  let freeze = 20;
  let winTeam = -1;

  return {
    step(env) {
      const { ctx, players, botsEnabled, keys, pads, sound, vfx, rumble, frame } = env;
      const active = [0, 1, 2, 3].map((s) => {
        const id = getSlotIdentity(s, players);
        return { ...id, enabled: id.isHuman || botsEnabled };
      });

      // Rhythm-pulse surge cursor (0..1 oscillating)
      const beatVal = Math.sin(frame * 0.14) * 0.5 + 0.5;
      const inSweetSpot = beatVal > 0.72;

      // Uneven teams (e.g. 2 humans vs 1, no bots): scale per-pull strength so a lone puller
      // matches a pair. 2v2 / 1v1 are unchanged.
      const teamN = [
        (active[0].enabled ? 1 : 0) + (active[2].enabled ? 1 : 0),
        (active[1].enabled ? 1 : 0) + (active[3].enabled ? 1 : 0),
      ];
      const maxTeam = Math.max(1, teamN[0], teamN[1]);

      vfx.beginCamera(ctx);

      if (freeze > 0) {
        freeze--;
        // Victory drag: losers get yanked toward the pit while the banner is up
        if (banner && winTeam >= 0) {
          const target = winTeam === 0 ? -340 : 340;
          ropeOffset += (target - ropeOffset) * 0.08;
          if (freeze % 6 === 0) {
            vfx.spark(
              GAME_WIDTH / 2 + (Math.random() - 0.5) * 100,
              300 + (Math.random() - 0.5) * 220,
              (Math.random() - 0.5) * 2,
              -2.5 - Math.random() * 2,
              '#fb923c',
              3,
            );
          }
        }
        if (freeze === 0 && banner) {
          ropeOffset = 0;
          banner = '';
          winTeam = -1;
          for (let i = 0; i < 4; i++) pulls[i] = 0;
        }
      } else {
        for (let i = 0; i < 4; i++) {
          if (lean[i] > 0) lean[i] *= 0.86;
          if (!active[i].enabled) continue;
          const isLeft = i === 0 || i === 2;
          let pulled = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            const btn = inp.actionA || inp.actionB;
            if (btn && !lock[i]) {
              pulled = true;
              lock[i] = true;
            }
            if (!btn) lock[i] = false;
          } else {
            // Bot mashes at a human-ish 5–8 taps/sec, and sometimes holds a tap for the gold pulse
            botNext[i]--;
            if (botNext[i] <= 0) {
              if (!inSweetSpot && beatVal > 0.55 && Math.random() < 0.5) {
                botNext[i] = 2; // wait a beat for the gold zone
              } else {
                pulled = true;
                botNext[i] = 7 + Math.floor(Math.random() * 6);
              }
            }
          }

          if (pulled) {
            const surge = inSweetSpot ? 2 : 1;
            const teamScale = maxTeam / Math.max(1, teamN[isLeft ? 0 : 1]);
            pulls[i] += surge;
            lean[i] = surge * 10;
            ropeOffset += (isLeft ? -11 : 11) * surge * teamScale;
            const px = (isLeft ? 210 : GAME_WIDTH - 210) + (i > 1 ? (isLeft ? 50 : -50) : 0) + ropeOffset * 0.4;
            const py = i < 2 ? 255 : 335;

            // Smoke cloud at boots + rope tension sparks
            vfx.burst(px, py + 16, '#94a3b8', 5, 2.5, 4);
            if (surge === 2) {
              vfx.bolt(px, py, GAME_WIDTH / 2 + ropeOffset, 295, '#fde047');
              vfx.popup(px, py - 24, 'SURGE 2X!', '#fde047', 13);
              sound.combo(3);
              rumble(i, 60, 0.65);
            } else {
              sound.beep(isLeft ? 420 : 540, 0.04);
              rumble(i, 30, 0.35);
            }
            vfx.spark(
              GAME_WIDTH / 2 + ropeOffset,
              295,
              (Math.random() - 0.5) * 6,
              (Math.random() - 0.5) * 6,
              '#ff6b2b',
              3.5,
            );
          }
        }

        if (ropeOffset <= -250 || ropeOffset >= 250) {
          const leftWon = ropeOffset <= -250;
          winTeam = leftWon ? 0 : 1;
          teamWins[winTeam]++;
          banner = leftWon ? 'LEFT TEAM (P1+P3) WINS!' : 'RIGHT TEAM (P2+P4) WINS!';
          freeze = 95;
          vfx.hitstop(4);
          vfx.shake(12);
          vfx.confetti(leftWon ? 260 : GAME_WIDTH - 260, 260, 50);
          vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 24);
          vfx.burst(GAME_WIDTH / 2, 300, '#ff6b2b', 30, 7.5, 4, 0.12);
          vfx.ring(GAME_WIDTH / 2, 300, '#fde047', 140, 5);
          sound.win();
          sound.explosion();
          vfx.flash(leftWon ? '#38bdf8' : '#fb7185', 0.25);
          for (let i = 0; i < 4; i++) {
            const onWinTeam = (i === 0 || i === 2) === leftWon;
            rumble(i, onWinTeam ? 220 : 160, onWinTeam ? 0.6 : 0.9);
          }
        } else if (frame % 40 === 0 && Math.abs(ropeOffset) > 180) {
          // Brink-of-defeat tension pulse
          sound.beep(110, 0.08, 'sine', 0.08);
          vfx.ring(GAME_WIDTH / 2 + ropeOffset, 295, '#ef4444', 46, 2);
        }
      }

      drawArcadeBackdrop(ctx, '#facc15');

      // Pitfall lava abyss in center
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(GAME_WIDTH / 2 - 58, 155, 116, 270, 10);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Energy Rope
      ctx.save();
      ctx.shadowColor = inSweetSpot ? '#fde047' : '#fb923c';
      ctx.shadowBlur = inSweetSpot ? 20 : 10;
      ctx.strokeStyle = inSweetSpot ? '#fef08a' : '#fde047';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(140 + ropeOffset, 295);
      ctx.lineTo(GAME_WIDTH - 140 + ropeOffset, 295);
      ctx.stroke();
      ctx.restore();

      // Center Core Marker + Pulse ring
      ctx.save();
      ctx.shadowColor = '#ff6b2b';
      ctx.shadowBlur = 22;
      ctx.fillStyle = '#ff6b2b';
      ctx.beginPath();
      ctx.arc(GAME_WIDTH / 2 + ropeOffset, 295, 18, 0, Math.PI * 2);
      ctx.fill();
      if (inSweetSpot) {
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(GAME_WIDTH / 2 + ropeOffset, 295, 26 + Math.sin(frame * 0.4) * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Leaning Tuggers
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const isLeft = i === 0 || i === 2;
        const px =
          (isLeft ? 210 : GAME_WIDTH - 210) +
          (i > 1 ? (isLeft ? 50 : -50) : 0) +
          ropeOffset * 0.4 -
          (isLeft ? lean[i] : -lean[i]);
        const py = i < 2 ? 255 : 335;
        const leanAng = (isLeft ? -0.35 : 0.35) - (isLeft ? lean[i] * 0.025 : -lean[i] * 0.025);

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(leanAng);
        drawPlayerOrb(ctx, 0, 0, 20, active[i].color, i, {
          angle: isLeft ? 0 : Math.PI,
        });
        ctx.restore();
      }

      // Rhythm-Pulse Surge Meter Bar (inside y: 68..506!)
      const barW = 280;
      const barX = GAME_WIDTH / 2 - barW / 2;
      const barY = 456;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, 20, 10);
      ctx.fill();
      ctx.stroke();

      // Golden 2x zone on right 28%
      ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
      ctx.fillRect(barX + barW * 0.72, barY + 2, barW * 0.26, 16);

      ctx.fillStyle = inSweetSpot ? '#fde047' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(barX + 10 + beatVal * (barW - 20), barY + 10, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f3f2ed';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('RHYTHM SURGE METER (TAP ON GOLD = 2X PULL!)', GAME_WIDTH / 2, barY - 6);

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'RESETTING PLASMA ROPE...', '#facc15');
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
              ? `PULL ${pulls[i]} · TW ${teamWins[0]}`
              : `PULL ${pulls[i]} · TW ${teamWins[1]}`,
        })),
        '2V2 ROPE CLASH: TAP A / B / SPACE ON GOLD PULSE FOR 2X SURGE!',
      );
    },
  };
}

// 28. BULLET HELL BOSS (3-Phase Dreadnought, Destructible Turrets, Graze Bonus, Focus Dash!)
export function createBulletHellBossEngine(): MiniGameEngine {
  const scores = [0, 0, 0, 0];
  const boss = {
    x: GAME_WIDTH / 2,
    y: 148,
    hp: 120,
    maxHp: 120,
    phase: 0,
    level: 1,
    attackMode: 0, // 0=Spiral, 1=Sweeping Laser, 2=Ring Barrage
    modeTimer: 0,
    laserAngle: Math.PI / 2,
  };

  let turrets = [
    { ox: -74, oy: 12, hp: 35, maxHp: 35, alive: true },
    { ox: 74, oy: 12, hp: 35, maxHp: 35, alive: true },
  ];

  const ships = [0, 1, 2, 3].map((i) => ({
    x: 180 + i * 200,
    y: 432,
    vx: 0,
    vy: 0,
    cd: 0,
    invuln: 0,
    dashCd: 0,
    prevB: false,
  }));

  let pBullets: Array<{ x: number; y: number; vx: number; vy: number; owner: number }> = [];
  let bossBullets: Array<{ x: number; y: number; vx: number; vy: number; color: string; grazed: number }> = [];
  const BULLET_COLORS = ['#fda4af', '#facc15', '#c084fc', '#38bdf8'];
  let bossFlash = 0;
  const botSide = [-1, 1, -1, 1];

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

      boss.phase += 0.028;
      boss.x = GAME_WIDTH / 2 + Math.sin(boss.phase) * 175;
      boss.modeTimer++;

      if (boss.modeTimer >= 240) {
        boss.modeTimer = 0;
        boss.attackMode = (boss.attackMode + 1) % 3;
        vfx.ring(boss.x, boss.y, '#fb7185', 80, 3);
      }

      // Phase 0: Spiral Barrage
      if (boss.attackMode === 0 && frame % 16 === 0) {
        const arms = 6 + Math.min(4, boss.level);
        for (let k = 0; k < arms; k++) {
          const ang = boss.phase * 2.6 + (Math.PI * 2 * k) / arms;
          bossBullets.push({
            x: boss.x,
            y: boss.y,
            vx: Math.cos(ang) * 3.1,
            vy: Math.sin(ang) * 3.1,
            color: k % 2 === 0 ? '#fda4af' : '#facc15',
            grazed: 0,
          });
        }
      }

      // Phase 1: Sweeping Laser Telegraph -> Sweep!
      if (boss.attackMode === 1) {
        if (boss.modeTimer < 60) {
          boss.laserAngle = Math.PI * 0.25 + Math.sin(frame * 0.04) * 0.1;
        } else if (boss.modeTimer < 185) {
          boss.laserAngle = Math.PI * 0.25 + ((boss.modeTimer - 60) / 125) * (Math.PI * 0.5);
          if (boss.modeTimer % 4 === 0) {
            const lx = boss.x + Math.cos(boss.laserAngle) * 420;
            const ly = boss.y + Math.sin(boss.laserAngle) * 420;
            vfx.bolt(boss.x, boss.y, lx, ly, '#fb7185');
            if (boss.modeTimer % 16 === 0) sound.noiseBurst(0.08, 1200, 0.08);
          }
          // Check laser sweep collision with players
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled || ships[i].invuln > 0) continue;
            const s = ships[i];
            const dx = s.x - boss.x;
            const dy = s.y - boss.y;
            const proj = dx * Math.cos(boss.laserAngle) + dy * Math.sin(boss.laserAngle);
            if (proj > 0) {
              const perp = Math.abs(-dx * Math.sin(boss.laserAngle) + dy * Math.cos(boss.laserAngle));
              if (perp < 16) {
                ships[i].invuln = 60;
                scores[i] = Math.max(0, scores[i] - 20);
                vfx.burst(s.x, s.y, '#fb7185', 16, 5);
                vfx.popup(s.x, s.y - 20, 'SCORCHED -20', '#fb7185', 13);
                vfx.hitstop(2);
                vfx.shake(6);
                sound.hit();
                rumble(i, 130, 0.85);
              }
            }
          }
        }
      }

      // Phase 2: Ring Barrage
      if (boss.attackMode === 2 && frame % 34 === 0) {
        const ringN = 12 + Math.min(6, boss.level);
        const offset = (frame * 0.13) % (Math.PI * 2);
        for (let k = 0; k < ringN; k++) {
          const ang = offset + (Math.PI * 2 * k) / ringN;
          bossBullets.push({
            x: boss.x,
            y: boss.y,
            vx: Math.cos(ang) * 2.8,
            vy: Math.sin(ang) * 2.8,
            color: '#c084fc',
            grazed: 0,
          });
        }
      }

      // Alive turrets occasionally fire aimed orbs (they used to fire straight down regardless)
      if (frame % 75 === 0) {
        for (const t of turrets) {
          if (!t.alive) continue;
          const tx = boss.x + t.ox;
          const ty = boss.y + t.oy;
          let aimX = 0;
          let aimY = 1;
          let bestD = Infinity;
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            const d = Math.hypot(ships[i].x - tx, ships[i].y - ty);
            if (d < bestD) {
              bestD = d;
              aimX = (ships[i].x - tx) / (d || 1);
              aimY = (ships[i].y - ty) / (d || 1);
            }
          }
          bossBullets.push({ x: tx, y: ty, vx: aimX * 3.6, vy: aimY * 3.6, color: '#38bdf8', grazed: 0 });
        }
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const s = ships[i];
        let ix = 0;
        let iy = 0;
        let fire = false;
        let btnB = false;

        if (active[i].isHuman) {
          const inp = readPlayerInput(i, pads, keys);
          ix = inp.x;
          iy = inp.y;
          fire = inp.actionA;
          btnB = inp.actionB;
        } else {
          // Dodge: sum repulsion from bullets predicted ~8 frames ahead, then drift under the
          // boss (old bot wandered on a sine path and mostly shot empty air, and never reacted
          // to the sweeping laser at all).
          let rx = 0;
          let ry = 0;
          let closest = Infinity;
          for (const b of bossBullets) {
            const fx = b.x + b.vx * 8;
            const fy = b.y + b.vy * 8;
            const d = Math.hypot(s.x - fx, s.y - fy);
            if (d < 70) {
              const w = (70 - d) / 70;
              rx += ((s.x - fx) / (d || 1)) * w;
              ry += ((s.y - fy) / (d || 1)) * w;
            }
            const dn = Math.hypot(s.x - b.x, s.y - b.y);
            if (dn < closest) closest = dn;
          }
          const homeX = boss.x + botSide[i] * (40 + i * 18);
          const homeY = 400 + (i % 2) * 40;
          ix = Math.max(-1, Math.min(1, (homeX - s.x) * 0.02)) + rx * 1.6;
          iy = Math.max(-1, Math.min(1, (homeY - s.y) * 0.02)) + ry * 1.6;
          if (closest < 22 && s.dashCd === 0 && Math.random() < 0.5) btnB = true;
          // Laser sweep: dash THROUGH the beam (dash grants i-frames) just before it arrives
          if (boss.attackMode === 1 && boss.modeTimer >= 50 && boss.modeTimer < 185) {
            const a = Math.atan2(s.y - boss.y, s.x - boss.x);
            const ahead = a - boss.laserAngle;
            if (ahead > 0 && ahead < 0.2) {
              ix = 1;
              iy = 0;
              if (s.dashCd === 0) btnB = true;
            }
          }
          const m = Math.hypot(ix, iy);
          if (m > 1) {
            ix /= m;
            iy /= m;
          }
          fire = Math.abs(s.x - boss.x) < 120 || frame % 3 === 0;
        }

        if (s.dashCd > 0) s.dashCd--;
        const tapB = btnB && !s.prevB;
        s.prevB = btnB;

        if (tapB && s.dashCd === 0) {
          s.dashCd = 44;
          s.invuln = Math.max(s.invuln, 16);
          const dx = Math.hypot(ix, iy) > 0.1 ? ix : 0;
          const dy = Math.hypot(ix, iy) > 0.1 ? iy : -1;
          s.vx += dx * 10;
          s.vy += dy * 10;
          vfx.ring(s.x, s.y, '#38bdf8', 38, 2);
          vfx.afterimage(s.x, s.y, 15, active[i].color, 10);
          sound.dash();
        }

        s.vx = s.vx * 0.8 + ix * 1.1;
        s.vy = s.vy * 0.8 + iy * 1.1;
        s.x = Math.max(46, Math.min(GAME_WIDTH - 46, s.x + s.vx + ix * 3.8));
        s.y = Math.max(210, Math.min(GAME_HEIGHT - 46, s.y + s.vy + iy * 3.8));

        if (s.invuln > 0) s.invuln--;
        if (s.cd > 0) s.cd--;
        if (fire && s.cd === 0) {
          pBullets.push({ x: s.x, y: s.y - 16, vx: 0, vy: -10, owner: i });
          s.cd = 9;
          if (active[i].isHuman && frame % 2 === 0) sound.beep(1100 + i * 60, 0.025, 'square', 0.025);
        }
      }
      if (bossFlash > 0) bossFlash--;

      pBullets = pBullets.filter((b) => {
        b.y += b.vy;
        // Check destructible shield turrets first
        for (const t of turrets) {
          if (!t.alive) continue;
          const tx = boss.x + t.ox;
          const ty = boss.y + t.oy;
          if (Math.hypot(b.x - tx, b.y - ty) < 22) {
            t.hp--;
            scores[b.owner] += 6;
            vfx.burst(b.x, b.y, '#38bdf8', 4, 3, 2);
            if (t.hp <= 0) {
              t.alive = false;
              scores[b.owner] += 40;
              vfx.hitstop(2);
              vfx.burst(tx, ty, '#facc15', 24, 6.5);
              vfx.ring(tx, ty, '#38bdf8', 65, 3);
              vfx.popup(tx, ty, 'TURRET +40!', '#facc15', 14);
              sound.explosion();
            }
            return false;
          }
        }

        if (Math.hypot(b.x - boss.x, b.y - boss.y) < 38) {
          const dmg = turrets.some((t) => t.alive) ? 1 : 2;
          boss.hp -= dmg;
          scores[b.owner] += 10;
          bossFlash = 3;
          vfx.spark(b.x, b.y, (Math.random() - 0.5) * 4, 2 + Math.random() * 2, active[b.owner].color, 2.5);
          if (boss.hp <= 0) {
            boss.level++;
            boss.maxHp = 120 + boss.level * 45;
            boss.hp = boss.maxHp;
            turrets = [
              { ox: -74, oy: 12, hp: 35 + boss.level * 5, maxHp: 35 + boss.level * 5, alive: true },
              { ox: 74, oy: 12, hp: 35 + boss.level * 5, maxHp: 35 + boss.level * 5, alive: true },
            ];
            scores[b.owner] += 100;
            vfx.hitstop(3);
            vfx.confetti(boss.x, boss.y, 44);
            vfx.burst(boss.x, boss.y, '#ff6b2b', 36, 8);
            vfx.ring(boss.x, boss.y, '#facc15', 135, 5);
            vfx.popup(boss.x, boss.y, `DREADNOUGHT LV ${boss.level}!`, '#facc15', 18);
            vfx.shake(12);
            vfx.flash('#fde047', 0.22);
            sound.explosion();
            sound.win();
            for (let k = 0; k < 4; k++) rumble(k, 200, 0.7);
            // Screen-clear: every boss bullet pops into a spark
            for (let k = 0; k < bossBullets.length; k += 3) {
              const bb = bossBullets[k];
              vfx.spark(bb.x, bb.y, bb.vx * 0.5, bb.vy * 0.5 - 1, '#fde047', 2.5);
            }
            bossBullets.length = 0;
          }
          return false;
        }
        return b.y > 65;
      });

      // Boss bullets: in-place compaction (largest array in the game; no per-frame realloc)
      let bw = 0;
      for (let bi = 0; bi < bossBullets.length; bi++) {
        const b = bossBullets[bi];
        b.x += b.vx;
        b.y += b.vy;
        let dead = false;
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const dist = Math.hypot(b.x - ships[i].x, b.y - ships[i].y);
          if (ships[i].invuln === 0 && dist < 14) {
            ships[i].invuln = 60;
            scores[i] = Math.max(0, scores[i] - 20);
            vfx.burst(ships[i].x, ships[i].y, '#fb7185', 16, 5);
            vfx.ring(ships[i].x, ships[i].y, '#fb7185', 48, 3);
            vfx.popup(ships[i].x, ships[i].y - 20, '-20', '#fb7185', 13);
            vfx.hitstop(2);
            vfx.shake(6);
            sound.hit();
            rumble(i, 120, 0.75);
            dead = true;
            break;
          } else if (dist < 30 && ships[i].invuln === 0 && (b.grazed & (1 << i)) === 0) {
            // GRAZE BONUS! (not while invulnerable — that was free points through bullets)
            b.grazed |= 1 << i;
            scores[i] += 5;
            vfx.spark(ships[i].x, ships[i].y, (Math.random() - 0.5) * 4, -2, '#fde047', 3);
            if (frame % 4 === 0) vfx.popup(ships[i].x, ships[i].y - 20, '+5 GRAZE', '#fde047', 10);
            sound.beep(1320, 0.03, 'triangle', 0.04);
          }
        }
        if (dead) continue;
        if (b.x > 30 && b.x < GAME_WIDTH - 30 && b.y > 65 && b.y < GAME_HEIGHT - 30) bossBullets[bw++] = b;
      }
      bossBullets.length = bw;

      drawArcadeBackdrop(ctx, '#fb7185');

      // Sweeping laser telegraph / active beam
      if (boss.attackMode === 1) {
        const lx = boss.x + Math.cos(boss.laserAngle) * 520;
        const ly = boss.y + Math.sin(boss.laserAngle) * 520;
        ctx.save();
        if (boss.modeTimer < 60) {
          ctx.strokeStyle = 'rgba(251, 113, 133, 0.55)';
          ctx.setLineDash([8, 8]);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(boss.x, boss.y);
          ctx.lineTo(lx, ly);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (boss.modeTimer < 185) {
          ctx.shadowColor = '#fb7185';
          ctx.shadowBlur = 24;
          ctx.strokeStyle = '#fb7185';
          ctx.lineWidth = 14;
          ctx.beginPath();
          ctx.moveTo(boss.x, boss.y);
          ctx.lineTo(lx, ly);
          ctx.stroke();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 4;
          ctx.stroke();
        }
        ctx.restore();
      }

      // Shield Turrets
      for (const t of turrets) {
        if (!t.alive) continue;
        const tx = boss.x + t.ox;
        const ty = boss.y + t.oy;
        ctx.save();
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(tx, ty, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Boss Dreadnought Core
      ctx.save();
      ctx.shadowColor = '#fb7185';
      ctx.shadowBlur = 26;
      ctx.fillStyle = bossFlash > 0 ? '#ffe4e6' : '#be123c';
      ctx.strokeStyle = '#fda4af';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(boss.x, boss.y, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Boss HP bar
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(boss.x - 50, boss.y - 52, 100, 8);
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(boss.x - 50, boss.y - 52, (100 * Math.max(0, boss.hp)) / boss.maxHp, 8);

      // Boss bullets batched into one path per colour + a shared white-hot core pass
      if (bossBullets.length > 0) {
        for (const col of BULLET_COLORS) {
          ctx.fillStyle = col;
          ctx.beginPath();
          for (const b of bossBullets) {
            if (b.color !== col) continue;
            ctx.moveTo(b.x + 5.5, b.y);
            ctx.arc(b.x, b.y, 5.5, 0, Math.PI * 2);
          }
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        for (const b of bossBullets) {
          ctx.moveTo(b.x + 2.2, b.y);
          ctx.arc(b.x, b.y, 2.2, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      for (const b of pBullets) {
        ctx.fillStyle = active[b.owner].color;
        ctx.fillRect(b.x - 2, b.y - 6, 4, 12);
      }
      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const s = ships[i];
        if (s.invuln > 0 && Math.floor(s.invuln / 4) % 2 === 0) continue;
        ctx.save();
        ctx.shadowColor = active[i].color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = active[i].color;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - 16);
        ctx.lineTo(s.x - 14, s.y + 12);
        ctx.lineTo(s.x + 14, s.y + 12);
        ctx.closePath();
        ctx.fill();
        if (i === leaderSlot) {
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      drawTopScoreboard(
        ctx,
        active.map((a, i) => ({
          slot: i,
          name: a.name,
          color: a.color,
          active: a.enabled,
          highlight: i === leaderSlot,
          valueText: `${scores[i]}pt`,
        })),
        'FIRE: A / SPACE   ·   FOCUS DASH: B / SHIFT   ·   SKIM BULLETS TO GRAZE +5!',
      );
    },
  };
}

// 29. SOCCER STRIKER 2V2 (Stamina Sprint, Charged Comet Super Kick + Spin, Rippling Nets!)
export function createSoccerStrikerEngine(): MiniGameEngine {
  const LEFT = 76;
  const RIGHT = GAME_WIDTH - 76;
  const TOP = 80;
  const BOTTOM = GAME_HEIGHT - 42;
  const CY = (TOP + BOTTOM) / 2;
  const GOAL_H = 74;
  const WIN_GOALS = 5;

  const teamScore = [0, 0];
  const teamWins = [0, 0];
  let netRippleL = 0;
  let netRippleR = 0;

  const mk = (x: number, y: number, dirX: number) => ({
    x,
    y,
    vx: 0,
    vy: 0,
    cd: 0,
    stamina: 100,
    charge: 0,
    prevA: false,
    dirX,
    dirY: 0,
    touchCd: 0,
    aiKick: 0, // CPU: charge frames to hold before releasing
  });
  const makePlayers = () => [
    mk(250, CY - 60, 1),
    mk(GAME_WIDTH - 250, CY - 60, -1),
    mk(165, CY + 60, 1),
    mk(GAME_WIDTH - 165, CY + 60, -1),
  ];

  let playersPos = makePlayers();
  const ball = { x: GAME_WIDTH / 2, y: CY, vx: 0, vy: 0, spin: 0, comet: 0 };
  let banner = '';
  let freeze = 20;
  let pendingKickoff = false;

  const resetPositions = () => {
    playersPos = makePlayers();
    ball.x = GAME_WIDTH / 2;
    ball.y = CY;
    ball.vx = 0;
    ball.vy = 0;
    ball.spin = 0;
    ball.comet = 0;
  };

  const resetMatch = () => {
    teamScore[0] = 0;
    teamScore[1] = 0;
    resetPositions();
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
        if (pendingKickoff) {
          // Goal celebration: let the ball bulge the net before kickoff
          ball.x = Math.max(LEFT - 18, Math.min(RIGHT + 18, ball.x + ball.vx * 0.5));
          ball.y = Math.max(CY - GOAL_H + 8, Math.min(CY + GOAL_H - 8, ball.y + ball.vy * 0.5));
          ball.vx *= 0.85;
          ball.vy *= 0.85;
        }
        if (freeze === 0 && banner) {
          pendingKickoff = false;
          resetMatch();
        } else if (freeze === 0 && pendingKickoff) {
          pendingKickoff = false;
          resetPositions();
          sound.beep(660, 0.08, 'triangle', 0.08);
        }
      } else {
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const p = playersPos[i];
          const isLeftTeam = i === 0 || i === 2;
          if (p.touchCd > 0) p.touchCd--;
          let ix = 0;
          let iy = 0;
          let btnA = false;
          let sprint = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            btnA = inp.actionA;
            sprint = inp.actionB && p.stamina > 4;
          } else {
            const goalX = isLeftTeam ? RIGHT : LEFT;
            const dBall = Math.hypot(ball.x - p.x, ball.y - p.y) || 1;
            if (i < 2) {
              // Striker aims behind ball toward goal
              const bgx = goalX - ball.x;
              const bgy = CY - ball.y;
              const bgd = Math.hypot(bgx, bgy) || 1;
              const approachX = ball.x - (bgx / bgd) * 24;
              const approachY = ball.y - (bgy / bgd) * 24;
              const da = Math.hypot(approachX - p.x, approachY - p.y) || 1;
              ix = ((approachX - p.x) / da) * 0.86;
              iy = ((approachY - p.y) / da) * 0.86;
              sprint = dBall > 140 && p.stamina > 30;
            } else {
              // Support / Keeper
              const guardX = isLeftTeam ? LEFT + 95 : RIGHT - 95;
              const targetY = Math.max(CY - 95, Math.min(CY + 95, ball.y));
              const tx = dBall < 140 ? ball.x : guardX;
              const ty = dBall < 140 ? ball.y : targetY;
              const d = Math.hypot(tx - p.x, ty - p.y) || 1;
              ix = ((tx - p.x) / d) * 0.78;
              iy = ((ty - p.y) / d) * 0.78;
            }
            // Kick logic. The old bot held A only while within 48px and released once the
            // dribbled ball rolled away (>42px), so it ALWAYS whiffed into a dash and never
            // actually kicked. Now: when lined up behind the ball toward goal, hold for a
            // pre-rolled charge and release while still in contact range.
            const toBallX = (ball.x - p.x) / dBall;
            const toBallY = (ball.y - p.y) / dBall;
            const gdx = goalX - p.x;
            const gdy = CY - p.y;
            const gd = Math.hypot(gdx, gdy) || 1;
            const aligned = toBallX * (gdx / gd) + toBallY * (gdy / gd) > (i < 2 ? 0.8 : 0.3);
            if (p.charge > 0) {
              btnA = dBall < 40 && p.charge < p.aiKick;
              // Ease off while winding up so we don't dribble the ball out of reach
              if (dBall < 34) {
                ix *= 0.15;
                iy *= 0.15;
              }
            } else if (dBall < 36 && aligned) {
              const farShot = Math.abs(goalX - p.x) > 330;
              const ballSlow = Math.hypot(ball.vx, ball.vy) < 1.6;
              p.aiKick =
                ballSlow && (farShot || Math.random() < 0.35)
                  ? 22 + Math.floor(Math.random() * 8)
                  : 2 + Math.floor(Math.random() * 6);
              btnA = true;
            }
          }

          if (Math.hypot(ix, iy) > 0.15) {
            const m = Math.hypot(ix, iy);
            p.dirX = ix / m;
            p.dirY = iy / m;
          }

          if (sprint && Math.hypot(ix, iy) > 0.1) {
            p.stamina = Math.max(0, p.stamina - 1.4);
            if (frame % 3 === 0) vfx.afterimage(p.x, p.y, 17, active[i].color, 7);
          } else {
            p.stamina = Math.min(100, p.stamina + 0.65);
          }

          const accel = sprint ? 0.96 : 0.65;
          p.vx = (p.vx + ix * accel) * 0.88;
          p.vy = (p.vy + iy * accel) * 0.88;
          p.x = Math.max(LEFT + 18, Math.min(RIGHT - 18, p.x + p.vx));
          p.y = Math.max(TOP + 18, Math.min(BOTTOM - 18, p.y + p.vy));

          if (p.cd > 0) p.cd--;

          // Charge Super Kick with A!
          if (btnA) {
            p.charge = Math.min(36, p.charge + 1);
          } else if (p.prevA || p.charge > 0) {
            const superKick = p.charge >= 20;
            const db = Math.hypot(ball.x - p.x, ball.y - p.y);
            if (db < 42) {
              const nx = (ball.x - p.x) / (db || 1);
              const ny = (ball.y - p.y) / (db || 1);
              const power = superKick ? 14.8 : 9.2;
              ball.vx = nx * power + p.vx * 0.6;
              ball.vy = ny * power + p.vy * 0.6;
              if (superKick) {
                ball.comet = 45;
                ball.spin = (p.dirX * ny - p.dirY * nx) * 0.28 || 0.14;
                vfx.hitstop(1);
                vfx.ring(ball.x, ball.y, '#ff6b2b', 55, 3);
                vfx.popup(p.x, p.y - 20, 'COMET KICK!', '#ff6b2b', 13);
                sound.noiseBurst(0.12, 950, 0.14);
                rumble(i, 100, 0.8);
              } else {
                vfx.burst(ball.x, ball.y, '#ffffff', 6, 3.5);
                sound.hit();
                rumble(i, 45, 0.4);
              }
            } else if (p.cd === 0) {
              // Dash kick lunge
              p.vx += p.dirX * 8.5;
              p.vy += p.dirY * 8.5;
              p.cd = 32;
              vfx.afterimage(p.x, p.y, 17, active[i].color, 10);
              sound.dash();
            }
            p.charge = 0;
          }
          p.prevA = btnA;

          // Dribble contact
          const db = Math.hypot(ball.x - p.x, ball.y - p.y);
          if (db > 0 && db < 30) {
            const nx = (ball.x - p.x) / db;
            const ny = (ball.y - p.y) / db;
            ball.x = p.x + nx * 31;
            ball.y = p.y + ny * 31;
            ball.vx = nx * 5.2 + p.vx * 0.78;
            ball.vy = ny * 5.2 + p.vy * 0.78;
            // Throttle dribble-touch audio/haptics (previously fired nearly every frame)
            if (p.touchCd === 0) {
              sound.beep(260, 0.03, 'triangle', 0.05);
              rumble(i, 25, 0.25);
              p.touchCd = 10;
            }
          }
        }

        // Apply curved spin & comet trail
        if (ball.comet > 0) {
          ball.comet--;
          const perpX = -ball.vy;
          const perpY = ball.vx;
          const pm = Math.hypot(perpX, perpY) || 1;
          ball.vx += (perpX / pm) * ball.spin;
          ball.vy += (perpY / pm) * ball.spin;
          if (frame % 2 === 0) {
            vfx.afterimage(ball.x, ball.y, 13, '#ff6b2b', 9);
            vfx.spark(ball.x, ball.y, -ball.vx * 0.2, -ball.vy * 0.2, '#fde047', 3);
          }
        }

        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.vx *= 0.986;
        ball.vy *= 0.986;

        if (ball.y < TOP + 12 || ball.y > BOTTOM - 12) {
          ball.vy *= -0.85;
          ball.y = Math.max(TOP + 12, Math.min(BOTTOM - 12, ball.y));
        }

        const inGoal = Math.abs(ball.y - CY) < GOAL_H;
        if (ball.x < LEFT + 12) {
          if (inGoal) {
            teamScore[1]++;
            netRippleL = 1;
            vfx.hitstop(3);
            vfx.confetti(LEFT, ball.y, 38);
            vfx.burst(LEFT, ball.y, '#fb7185', 30, 7.5);
            vfx.popup(GAME_WIDTH / 2, CY - 16, 'GOAL RIGHT!', '#fb7185', 22);
            vfx.shake(11);
            vfx.flash('#fb7185', 0.16);
            sound.explosion();
            rumble(1, 160, 0.7);
            rumble(3, 160, 0.7);
            ball.x = LEFT + 4;
            if (teamScore[1] >= WIN_GOALS) {
              teamWins[1]++;
              banner = 'RIGHT TEAM (P2+P4) WINS!';
              freeze = 95;
              sound.win();
              vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 40);
            } else {
              sound.combo(teamScore[1] + 2);
              pendingKickoff = true;
              freeze = 55;
            }
          } else {
            ball.vx *= -0.85;
            ball.x = LEFT + 12;
          }
        } else if (ball.x > RIGHT - 12) {
          if (inGoal) {
            teamScore[0]++;
            netRippleR = 1;
            vfx.hitstop(3);
            vfx.confetti(RIGHT, ball.y, 38);
            vfx.burst(RIGHT, ball.y, '#38bdf8', 30, 7.5);
            vfx.popup(GAME_WIDTH / 2, CY - 16, 'GOAL LEFT!', '#38bdf8', 22);
            vfx.shake(11);
            vfx.flash('#38bdf8', 0.16);
            sound.explosion();
            rumble(0, 160, 0.7);
            rumble(2, 160, 0.7);
            ball.x = RIGHT - 4;
            if (teamScore[0] >= WIN_GOALS) {
              teamWins[0]++;
              banner = 'LEFT TEAM (P1+P3) WINS!';
              freeze = 95;
              sound.win();
              vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 40);
            } else {
              sound.combo(teamScore[0] + 2);
              pendingKickoff = true;
              freeze = 55;
            }
          } else {
            ball.vx *= -0.85;
            ball.x = RIGHT - 12;
          }
        }
      }

      drawArcadeBackdrop(ctx, '#2ee59d');

      // Pitch markings
      ctx.strokeStyle = 'rgba(46, 229, 157, 0.45)';
      ctx.lineWidth = 3;
      ctx.strokeRect(LEFT, TOP, RIGHT - LEFT, BOTTOM - TOP);
      ctx.beginPath();
      ctx.moveTo(GAME_WIDTH / 2, TOP);
      ctx.lineTo(GAME_WIDTH / 2, BOTTOM);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(GAME_WIDTH / 2, CY, 56, 0, Math.PI * 2);
      ctx.stroke();

      // Rippling Goal Nets
      const drawNet = (gx: number, dir: number, rip: number, col: string) => {
        ctx.save();
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.35)';
        ctx.lineWidth = 1.5;
        const depth = 24 + rip * 14 * Math.abs(Math.sin(frame * 0.4));
        ctx.strokeRect(dir < 0 ? gx - depth : gx, CY - GOAL_H, depth, GOAL_H * 2);
        for (let y = CY - GOAL_H + 14; y < CY + GOAL_H; y += 18) {
          ctx.beginPath();
          ctx.moveTo(gx, y);
          ctx.lineTo(gx + dir * depth, y);
          ctx.stroke();
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(gx, CY - GOAL_H);
        ctx.lineTo(gx, CY + GOAL_H);
        ctx.stroke();
        ctx.restore();
      };
      drawNet(LEFT, -1, netRippleL, '#38bdf8');
      drawNet(RIGHT, 1, netRippleR, '#fb7185');

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const p = playersPos[i];
        drawPlayerOrb(ctx, p.x, p.y, 17, active[i].color, i, {
          angle: Math.atan2(p.dirY, p.dirX),
        });
        // Stamina micro-bar below player
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(p.x - 14, p.y + 22, 28, 4);
        ctx.fillStyle = '#2ee59d';
        ctx.fillRect(p.x - 14, p.y + 22, (28 * p.stamina) / 100, 4);

        if (p.charge > 0) {
          ctx.strokeStyle = p.charge >= 20 ? '#ff6b2b' : '#facc15';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p.charge / 36));
          ctx.stroke();
        }
      }

      ctx.save();
      ctx.shadowColor = ball.comet > 0 ? '#ff6b2b' : '#ffffff';
      ctx.shadowBlur = ball.comet > 0 ? 24 : 14;
      ctx.fillStyle = ball.comet > 0 ? '#fde047' : '#ffffff';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'PREPARING NEXT KICKOFF...', '#2ee59d');
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
              ? `L ${teamScore[0]}/${WIN_GOALS} · TW${teamWins[0]}`
              : `R ${teamScore[1]}/${WIN_GOALS} · TW${teamWins[1]}`,
        })),
        '2V2 PITCH   ·   HOLD A: CHARGED COMET KICK   ·   HOLD B: STAMINA SPRINT',
      );
    },
  };
}

// 30. KING OF THE HILL (Concentric 2x/4x Bullseye, Periodic Center EMP Pulse, Knockback Dash, Leader Beam!)
export function createKingOfHillEngine(): MiniGameEngine {
  const scores = [0, 0, 0, 0];
  const wins = [0, 0, 0, 0];
  const WIN_SCORE = 120;

  const makePlayers = () =>
    [0, 1, 2, 3].map((i) => ({
      x: i % 2 === 0 ? 150 : GAME_WIDTH - 150,
      y: i < 2 ? 160 : 420,
      vx: 0,
      vy: 0,
      dashCd: 0,
      dashTimer: 0,
      prevA: false,
      dirX: i % 2 === 0 ? 1 : -1,
      dirY: 0,
    }));

  let playersPos = makePlayers();
  const zone = { x: GAME_WIDTH / 2, y: 292, outerR: 88, innerR: 38, shiftTimer: 260, empTimer: 220 };
  let banner = '';
  let freeze = 20;

  const resetMatch = () => {
    for (let i = 0; i < 4; i++) scores[i] = 0;
    playersPos = makePlayers();
    zone.x = GAME_WIDTH / 2;
    zone.y = 292;
    zone.shiftTimer = 260;
    zone.empTimer = 220;
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
        zone.shiftTimer--;
        if (zone.shiftTimer <= 0) {
          zone.x = 175 + Math.random() * (GAME_WIDTH - 350);
          zone.y = 160 + Math.random() * (GAME_HEIGHT - 270);
          zone.shiftTimer = 270;
          vfx.ring(zone.x, zone.y, '#c084fc', 105, 4);
          sound.pickup(200);
        }

        // Periodic EMP Pulse charge at center
        zone.empTimer--;
        if (zone.empTimer <= 0) {
          zone.empTimer = 240;
          vfx.ring(zone.x, zone.y, '#38bdf8', 135, 5);
          vfx.shake(7);
          sound.noiseBurst(0.18, 950, 0.14);
          for (let i = 0; i < 4; i++) {
            if (!active[i].enabled) continue;
            const p = playersPos[i];
            const d = Math.hypot(p.x - zone.x, p.y - zone.y);
            if (d < 120) {
              const nx = d > 0 ? (p.x - zone.x) / d : 1;
              const ny = d > 0 ? (p.y - zone.y) / d : 0;
              p.vx += nx * 12;
              p.vy += ny * 12;
              vfx.bolt(zone.x, zone.y, p.x, p.y, '#38bdf8');
              rumble(i, 120, 0.8);
            }
          }
        }

        const outerInside: number[] = [];
        const innerInside: number[] = [];

        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          const p = playersPos[i];
          let ix = 0;
          let iy = 0;
          let btnA = false;

          if (active[i].isHuman) {
            const inp = readPlayerInput(i, pads, keys);
            ix = inp.x;
            iy = inp.y;
            btnA = inp.actionA;
          } else {
            // Bot aims for inner core unless EMP is about to fire!
            const d = Math.hypot(zone.x - p.x, zone.y - p.y) || 1;
            if (zone.empTimer < 26 && d < 95) {
              ix = ((p.x - zone.x) / d) * 0.9;
              iy = ((p.y - zone.y) / d) * 0.9;
              if (p.dashCd === 0) btnA = true;
            } else {
              ix = ((zone.x - p.x) / d) * 0.88;
              iy = ((zone.y - p.y) / d) * 0.88;
              if (d > 40 && d < 120 && p.dashCd === 0 && Math.random() < 0.05) btnA = true;
              // Blast a rival off the hill when one is crowding us inside the zone
              if (d < zone.outerR && p.dashCd === 0) {
                for (let j = 0; j < 4; j++) {
                  if (j === i || !active[j].enabled) continue;
                  if (Math.hypot(playersPos[j].x - p.x, playersPos[j].y - p.y) < 62 && Math.random() < 0.08) {
                    btnA = true;
                    break;
                  }
                }
              }
            }
          }

          if (Math.hypot(ix, iy) > 0.15) {
            const m = Math.hypot(ix, iy);
            p.dirX = ix / m;
            p.dirY = iy / m;
          }

          if (p.dashCd > 0) p.dashCd--;
          if (p.dashTimer > 0) {
            p.dashTimer--;
            vfx.afterimage(p.x, p.y, 19, active[i].color, 9);
          }

          const tapA = btnA && !p.prevA;
          p.prevA = btnA;

          if (tapA && p.dashCd === 0) {
            const dx = Math.hypot(ix, iy) > 0.1 ? ix : p.dirX;
            const dy = Math.hypot(ix, iy) > 0.1 ? iy : p.dirY;
            p.vx += dx * 12.5;
            p.vy += dy * 12.5;
            p.dashCd = 46;
            p.dashTimer = 14;
            vfx.ring(p.x, p.y, active[i].color, 54, 3);
            vfx.ring(p.x, p.y, '#38bdf8', 84, 2.5);
            sound.dash();
            sound.noiseBurst(0.1, 900, 0.08);
            rumble(i, 45, 0.4);
            // Registry calls A a "Shockwave Blast": the dash launch also emits a short-range
            // radial shove so you can clear rivals off the hill without a direct hit.
            for (let j = 0; j < 4; j++) {
              if (j === i || !active[j].enabled) continue;
              const o = playersPos[j];
              const od = Math.hypot(o.x - p.x, o.y - p.y);
              if (od > 0 && od < 80) {
                const f = 7.5 * (1 - od / 80) + 2.5;
                o.vx += ((o.x - p.x) / od) * f;
                o.vy += ((o.y - p.y) / od) * f;
                vfx.bolt(p.x, p.y, o.x, o.y, '#38bdf8');
                rumble(j, 80, 0.6);
              }
            }
          }

          p.vx = (p.vx + ix * 0.68) * 0.89;
          p.vy = (p.vy + iy * 0.68) * 0.89;
          p.x = Math.max(54, Math.min(GAME_WIDTH - 54, p.x + p.vx));
          p.y = Math.max(88, Math.min(GAME_HEIGHT - 50, p.y + p.vy));

          const distZone = Math.hypot(p.x - zone.x, p.y - zone.y);
          if (distZone < zone.innerR) {
            innerInside.push(i);
          } else if (distZone < zone.outerR) {
            outerInside.push(i);
          }
        }

        // Player-to-player knockback slams
        for (let i = 0; i < 4; i++) {
          if (!active[i].enabled) continue;
          for (let j = i + 1; j < 4; j++) {
            if (!active[j].enabled) continue;
            const a = playersPos[i];
            const b = playersPos[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0 && dist < 39) {
              const nx = dx / dist;
              const ny = dy / dist;
              const aDashing = a.dashTimer > 0;
              const bDashing = b.dashTimer > 0;
              const pushA = bDashing ? 13 : 5.5;
              const pushB = aDashing ? 13 : 5.5;
              const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
              a.vx -= nx * pushA;
              a.vy -= ny * pushA;
              b.vx += nx * pushB;
              b.vy += ny * pushB;
              if (aDashing || bDashing) {
                vfx.hitstop(2);
                vfx.shake(5);
                vfx.burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#facc15', 14, 5.5);
                vfx.popup((a.x + b.x) / 2, (a.y + b.y) / 2 - 22, 'SLAM!', '#facc15', 13);
              }
              // Only make noise on real impacts (shoving bodies used to buzz hit()+rumble
              // nearly every frame while crowding the zone)
              if (aDashing || bDashing || closing > 3) {
                sound.hit();
                rumble(i, 80, 0.7);
                rumble(j, 80, 0.7);
              }
            }
          }
        }

        if (frame % 15 === 0) {
          innerInside.forEach((slot) => {
            scores[slot] += 4;
            if (frame % 60 === 0) {
              vfx.popup(playersPos[slot].x, playersPos[slot].y - 24, '+4X CORE', '#fde047', 11);
            }
            vfx.spark(playersPos[slot].x, playersPos[slot].y - 18, (Math.random() - 0.5) * 1.5, -2, '#fde047', 2.5);
          });
          outerInside.forEach((slot) => {
            scores[slot] += 2;
          });
          const winner = [0, 1, 2, 3].find((i) => active[i].enabled && scores[i] >= WIN_SCORE);
          if (winner !== undefined) {
            wins[winner]++;
            banner = `${active[winner].name} HILL MONARCH!`;
            freeze = 95;
            sound.win();
            vfx.confetti(playersPos[winner].x, playersPos[winner].y, 50);
            vfx.confetti(GAME_WIDTH / 2, GAME_HEIGHT / 2, 26);
            vfx.flash(active[winner].color, 0.25);
            rumble(winner, 220, 0.6);
          }
        }
      }

      drawArcadeBackdrop(ctx, '#c084fc');

      // Concentric Bullseye Zone (+2x outer, +4x inner core)
      ctx.save();
      ctx.fillStyle = 'rgba(192, 132, 252, 0.13)';
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.outerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(250, 204, 21, 0.2)';
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.innerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // EMP charge telegraph ring
      if (zone.empTimer < 65) {
        const pct = zone.empTimer / 65;
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, 120 * pct, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('EMP!', zone.x, zone.y + 4);
      } else {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.8)';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('4X', zone.x, zone.y + 4);
      }
      ctx.restore();

      // Leader vertical beam
      if (leaderSlot >= 0 && active[leaderSlot].enabled) {
        const lp = playersPos[leaderSlot];
        ctx.save();
        const grad = ctx.createLinearGradient(lp.x, 68, lp.x, lp.y + 20);
        grad.addColorStop(0, 'rgba(250, 204, 21, 0)');
        grad.addColorStop(0.6, 'rgba(250, 204, 21, 0.22)');
        grad.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(lp.x - 18, 68, 36, lp.y - 48);
        ctx.restore();
      }

      for (let i = 0; i < 4; i++) {
        if (!active[i].enabled) continue;
        const p = playersPos[i];
        drawPlayerOrb(ctx, p.x, p.y, 19, active[i].color, i, {
          angle: Math.atan2(p.dirY, p.dirX),
          leader: i === leaderSlot,
          cooldownPct: p.dashCd / 46,
        });
      }

      vfx.renderAndStep(ctx);
      vfx.endCamera(ctx);

      if (banner) {
        drawRoundBanner(ctx, banner, 'SHIFTING NEW HILL ZONE...', '#c084fc');
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
        '2X OUTER / 4X CORE   ·   SHOCKWAVE DASH: A / SPACE   ·   DODGE CENTER EMP!',
      );
    },
  };
}
