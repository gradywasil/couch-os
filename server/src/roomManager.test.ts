import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_PLAYERS, sanitizeInputState } from '@couch-emu/shared';
import { RoomManager } from './roomManager.js';

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('RoomManager', () => {
  it('creates a room, joins players in sequential slots, and reclaims on reconnect', () => {
    const rm = new RoomManager();
    const { room } = rm.createOrReclaimHostRoom('host-1', 'COUCH');
    assert.equal(room.roomCode, 'COUCH');
    assert.equal(room.hostConnected, true);

    const p1 = rm.joinPlayer('sock-p1', 'couch', 'Alice', 'client-a');
    assert.equal(p1.ok, true);
    if (!p1.ok) return;
    assert.equal(p1.player.slot, 0);
    assert.equal(p1.player.name, 'Alice');

    const p2 = rm.joinPlayer('sock-p2', 'COUCH', 'Bob', 'client-b');
    assert.equal(p2.ok, true);
    if (!p2.ok) return;
    assert.equal(p2.player.slot, 1);

    // Same clientId on a new socket while the old one is still live -> keeps slot 0
    const p1Re = rm.joinPlayer('sock-p1-new', 'COUCH', 'Alice 2', 'client-a');
    assert.equal(p1Re.ok, true);
    if (!p1Re.ok) return;
    assert.equal(p1Re.player.slot, 0);
    assert.equal(p1Re.player.name, 'Alice 2');
    assert.equal(p1Re.replacedSocketId, 'sock-p1');
    assert.equal(room.players.size, 2);
    // The superseded socket no longer speaks for the room
    assert.equal(rm.getBinding('sock-p1'), undefined);
  });

  it('keeps a dropped phone in its port during the grace window, then frees it', () => {
    const c = clock();
    const rm = new RoomManager(c.now);
    rm.createOrReclaimHostRoom('host', 'GRCE');
    rm.joinPlayer('a1', 'GRCE', 'Alice', 'client-a');
    rm.joinPlayer('b1', 'GRCE', 'Bob', 'client-b');

    // Alice's phone locks: socket closes
    const detached = rm.detachSocket('a1');
    assert.equal(detached?.role, 'player');
    const room = rm.getRoom('GRCE')!;
    const ghost = room.players.get('a1')!;
    assert.equal(ghost.connected, false);
    assert.equal(ghost.slot, 0);

    // A newcomer can't steal Alice's slot while she's in grace
    const carol = rm.joinPlayer('c1', 'GRCE', 'Carol', 'client-c');
    assert.ok(carol.ok && carol.player.slot === 2);

    // Alice comes back within grace and gets P1 again
    c.advance(10_000);
    assert.equal(rm.pruneDisconnectedPlayers(45_000).length, 0);
    const back = rm.joinPlayer('a2', 'GRCE', '', 'client-a');
    assert.ok(back.ok);
    if (!back.ok) return;
    assert.equal(back.player.slot, 0);
    assert.equal(back.player.name, 'Alice'); // blank name keeps the old one
    assert.equal(back.player.connected, true);
    assert.equal(back.replacedSocketId, undefined);

    // Bob drops and never returns -> released after grace
    rm.detachSocket('b1');
    c.advance(46_000);
    const touched = rm.pruneDisconnectedPlayers(45_000);
    assert.equal(touched.length, 1);
    assert.equal(room.players.has('b1'), false);
  });

  it('caps rooms at MAX_PLAYERS', () => {
    const rm = new RoomManager();
    rm.createOrReclaimHostRoom('host', 'FULL');
    for (let i = 0; i < MAX_PLAYERS; i++) {
      assert.ok(rm.joinPlayer(`s${i}`, 'FULL', `P${i}`, `c${i}`).ok);
    }
    const extra = rm.joinPlayer('sx', 'FULL', 'Extra', 'cx');
    assert.equal(extra.ok, false);
    if (!extra.ok) assert.equal(extra.code, 'ROOM_FULL');
  });

  it('does not let a second live host hijack an occupied room', () => {
    const rm = new RoomManager();
    rm.createOrReclaimHostRoom('host-a', 'TAKE');
    const alive = new Set(['host-a']);
    const { room } = rm.createOrReclaimHostRoom('host-b', 'TAKE', (id) =>
      alive.has(id),
    );
    assert.notEqual(room.roomCode, 'TAKE');
    assert.equal(rm.getRoom('TAKE')!.hostId, 'host-a');

    // Once the original host is gone, a reload reclaims the room
    rm.detachSocket('host-a');
    alive.delete('host-a');
    const again = rm.createOrReclaimHostRoom('host-c', 'TAKE', (id) =>
      alive.has(id),
    );
    assert.equal(again.room.roomCode, 'TAKE');
    assert.equal(again.room.hostConnected, true);
  });

  it('swaps player slots and updates layouts', () => {
    const rm = new RoomManager();
    rm.createOrReclaimHostRoom('host-1', 'ABCD');
    rm.joinPlayer('p1', 'ABCD', 'P1', 'c1');
    rm.joinPlayer('p2', 'ABCD', 'P2', 'c2');

    rm.swapSlots('ABCD', 0, 1);
    const state = rm.toPublicRoomState(rm.getRoom('ABCD')!);
    assert.equal(state.players[0].name, 'P2');
    assert.equal(state.players[0].slot, 0);
    assert.equal(state.players[1].name, 'P1');
    assert.equal(state.players[1].slot, 1);

    assert.equal(rm.swapSlots('ABCD', 0, MAX_PLAYERS), null);

    rm.setLayout('ABCD', 'nes');
    assert.equal(rm.getRoom('ABCD')?.defaultLayout, 'nes');
  });

  it('rejects joining a non-existent room and handles kicking and leaving', () => {
    const rm = new RoomManager();
    const miss = rm.joinPlayer('p1', 'NOPE', 'Alice', 'c1');
    assert.equal(miss.ok, false);

    rm.createOrReclaimHostRoom('host-1', 'WXYZ');
    rm.joinPlayer('p1', 'WXYZ', 'Alice', 'c1');
    const kicked = rm.kickPlayer('WXYZ', 'p1');
    assert.ok(kicked);
    assert.equal(rm.getRoom('WXYZ')?.players.size, 0);

    rm.joinPlayer('p2', 'WXYZ', 'Bob', 'c2');
    assert.ok(rm.leavePlayer('p2'));
    assert.equal(rm.getRoom('WXYZ')?.players.size, 0);
  });

  it('prunes abandoned rooms', () => {
    const c = clock();
    const rm = new RoomManager(c.now);
    rm.createOrReclaimHostRoom('host', 'GONE');
    rm.detachSocket('host');
    c.advance(130_000);
    const removed = rm.pruneExpiredRooms(120_000);
    assert.equal(removed.length, 1);
    assert.equal(rm.getRoom('GONE'), undefined);
  });
});

describe('sanitizeInputState', () => {
  it('clamps axes and triggers and masks buttons', () => {
    const s = sanitizeInputState({
      buttonsMask: 0xfffffff,
      axes: [3, -9, Number.NaN, 0.5],
      l2: 7,
      r2: -1,
      seq: 4,
    });
    assert.ok(s);
    assert.equal(s!.buttonsMask, 0x1ffff);
    assert.deepEqual(s!.axes, [1, -1, 0, 0.5]);
    assert.equal(s!.l2, 1);
    assert.equal(s!.r2, 0);
  });

  it('rejects garbage', () => {
    assert.equal(sanitizeInputState(null), null);
    assert.equal(sanitizeInputState({ axes: [] }), null);
  });
});
