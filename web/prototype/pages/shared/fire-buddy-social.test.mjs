import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIRE_BUDDY_SOCIAL_COPY_CAROUSEL, buildFireBuddyNavigation, createFireBuddyStateMachine, findFireBuddyPath, mountFireBuddySocial } from './fire-buddy-social.js';

test('friend-share hides Package Ball dialogue nudge without removing its launcher', async () => {
  const css = await readFile(new URL('./fire-buddy-social.css', import.meta.url), 'utf8');
  assert.match(css, /\.dh-root\.is-friend-share #matchAssistantNudge\s*\{\s*display: none !important;/);
  assert.doesNotMatch(css, /\.dh-root\.is-friend-share #matchAssistantLauncher\s*\{\s*display: none/);
  assert.doesNotMatch(css, /\.dh-root\.is-friend-share #shareButton/);
  assert.doesNotMatch(css, /scale: \.7;/);
  assert.match(css, /max-width: min\(123px/);
  assert.match(css, /isolation: isolate;/);
  assert.match(css, /z-index: -1;/);
});

function fakeClock() {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimer(fn) { const id = ++nextId; timers.set(id, fn); return id; },
    clearTimer(id) { timers.delete(id); },
    runNext() { const [id, fn] = timers.entries().next().value || []; if (!fn) return; timers.delete(id); fn(); },
    get size() { return timers.size; }
  };
}

test('fire-buddy social copy carousel keeps the approved nine-line order', () => {
  assert.equal(FIRE_BUDDY_SOCIAL_COPY_CAROUSEL.length, 9);
  assert.deepEqual(FIRE_BUDDY_SOCIAL_COPY_CAROUSEL.map((entry) => entry.key), [
    'enter', 'explore', 'furniture', 'favorite', 'similar', 'recommend', 'try', 'try-success', 'keep'
  ]);
  assert.equal(FIRE_BUDDY_SOCIAL_COPY_CAROUSEL[0].message, '主人主人，我好喜欢这个房子呀！');
  assert.equal(FIRE_BUDDY_SOCIAL_COPY_CAROUSEL.at(-1).message, '主人主人，我们把它留下来吧～');
});

test('speech bubble anchor uses the avatar world top center plus five centimeters', async () => {
  const source = await readFile(new URL('./fire-buddy-social.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /viewportRect\.top - hostRect\.top/);
  assert.match(source, /overlayRoot\.clientHeight \|\| viewportElement\?\.clientHeight/);
  assert.doesNotMatch(source, /viewportRect\?\.height/);
  assert.match(source, /scene\.updateMatrixWorld\?\.\(true\)/);
  assert.match(source, /box\.getCenter\(new THREE\.Vector3\(\)\)/);
  assert.match(source, /anchorWorld\.y = box\.max\.y \+ \.05/);
  assert.match(source, /const desiredY = headScreen\.y/);
});

test('fire-buddy walk starts immediately and forced walk owns one timer', () => {
  const clock = fakeClock();
  const changes = [];
  const fsm = createFireBuddyStateMachine({ onChange: ({ state }) => changes.push(state), random: () => 0, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  assert.equal(fsm.state, 'walk');
  assert.deepEqual(changes, ['walk']);
  assert.equal(fsm.setState('walk'), true);
  assert.equal(clock.size, 1);
  fsm.dispose();
  assert.equal(clock.size, 0);
});

test('fire-buddy sit is directly testable and returns to walk', () => {
  const clock = fakeClock();
  const fsm = createFireBuddyStateMachine({ random: () => 0, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  assert.equal(fsm.setState('sit'), true);
  assert.equal(fsm.state, 'sit');
  clock.runNext();
  assert.equal(fsm.state, 'walk');
  fsm.dispose();
});

test('fire-buddy walk alternates only with sit', () => {
  const clock = fakeClock();
  const fsm = createFireBuddyStateMachine({ random: () => 0, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  clock.runNext();
  assert.equal(fsm.state, 'sit');
  clock.runNext();
  assert.equal(fsm.state, 'walk');
  assert.equal(fsm.setState('sleep'), false);
  assert.equal(fsm.setState('eat'), false);
  fsm.dispose();
});

test('fire-buddy state lock keeps a directed walk active until released', () => {
  const clock = fakeClock();
  const fsm = createFireBuddyStateMachine({ random: () => 0, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  assert.equal(clock.size, 1);
  assert.equal(fsm.setLocked(true), true);
  assert.equal(clock.size, 0);
  clock.runNext();
  assert.equal(fsm.state, 'walk');
  assert.equal(fsm.setLocked(false), true);
  assert.equal(clock.size, 1);
  clock.runNext();
  assert.equal(fsm.state, 'sit');
  fsm.dispose();
});

test('fire-buddy navigation stays inside rooms, avoids padded furniture, and blocks crossing paths', () => {
  const rooms = [{ id: 'living', type: 'living', x: 0, z: 0, width: 6, depth: 5 }];
  const placements = [
    { roomId: 'living', name: '沙发', position: { x: 0, z: 0 }, dimensions: [2.2, .8, 1] },
    { roomId: 'living', name: '餐桌', position: { x: 1.8, z: 1.2 }, dimensions: [1.2, .8, 1.2] }
  ];
  const navigation = buildFireBuddyNavigation({ rooms, placements });
  assert.ok(navigation.points.length >= 3 && navigation.points.length <= 5);
  for (const point of navigation.points) {
    assert.ok(point.x >= -2.38 && point.x <= 2.38);
    assert.ok(point.z >= -1.88 && point.z <= 1.88);
    for (const box of navigation.obstacles) assert.ok(point.x < box.minX || point.x > box.maxX || point.z < box.minZ || point.z > box.maxZ);
  }
  assert.ok(navigation.points.some((point) => point.sleep));
  assert.ok(navigation.points.some((point) => point.eat));
  assert.equal(navigation.segmentIsClear({ x: -2.5, z: 0 }, { x: 2.5, z: 0 }), false);
  assert.ok(Math.abs(navigation.obstacles[0].minX + 1.72) < 1e-9);
  assert.ok(Math.abs(navigation.obstacles[0].maxX - 1.72) < 1e-9);
  assert.ok(Math.abs(navigation.obstacles[0].minZ + 1.12) < 1e-9);
  assert.ok(Math.abs(navigation.obstacles[0].maxZ - 1.12) < 1e-9, 'furniture footprint must include the full 1.08m sprite radius plus clearance');
});

test('fire-buddy expanded navigation distributes safe points across the room', () => {
  const navigation = buildFireBuddyNavigation({
    rooms: [{ id: 'living', type: 'living', x: 0, z: 0, width: 10, depth: 7 }],
    placements: [{ id: 'center-table', position: { x: 0, z: 0 }, dimensions: [1.5, .8, 1.2] }],
    margin: .42,
    obstaclePadding: .48,
    maxPoints: 14
  });
  assert.ok(navigation.points.length >= 10);
  assert.ok(Math.max(...navigation.points.map((point) => point.x)) - Math.min(...navigation.points.map((point) => point.x)) > 6);
  assert.ok(Math.max(...navigation.points.map((point) => point.z)) - Math.min(...navigation.points.map((point) => point.z)) > 4);
  for (const point of navigation.points) assert.ok(navigation.obstacles.every((box) => point.x < box.minX || point.x > box.maxX || point.z < box.minZ || point.z > box.maxZ));
});

test('fire-buddy A* routes around a blocking furniture footprint and smooths the path', () => {
  const bounds = { minX: -3, maxX: 3, minZ: -2.5, maxZ: 2.5 };
  const obstacles = [{ minX: -.8, maxX: .8, minZ: -1.15, maxZ: 1.15 }];
  const start = { x: -2.3, z: 0 };
  const goal = { x: 2.3, z: 0 };
  const path = findFireBuddyPath({ start, goal, bounds, obstacles, cellSize: .25 });
  assert.ok(path.length >= 2, 'blocked straight line should produce at least one bend');
  assert.deepEqual(path.at(-1), goal);
  let previous = start;
  for (const point of path) {
    assert.ok(point.x >= bounds.minX && point.x <= bounds.maxX);
    assert.ok(point.z >= bounds.minZ && point.z <= bounds.maxZ);
    assert.ok(obstacles.every((box) => point.x < box.minX || point.x > box.maxX || point.z < box.minZ || point.z > box.maxZ));
    assert.ok(obstacles.every((box) => !segmentHitsForTest(previous, point, box)));
    previous = point;
  }
});

function segmentHitsForTest(a, b, box) {
  let low = 0;
  let high = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, box.minX, box.maxX], [a.z, b.z - a.z, box.minZ, box.maxZ]]) {
    if (Math.abs(delta) < 1e-7) { if (start < min || start > max) return false; continue; }
    const t1 = (min - start) / delta;
    const t2 = (max - start) / delta;
    low = Math.max(low, Math.min(t1, t2));
    high = Math.min(high, Math.max(t1, t2));
    if (low > high) return false;
  }
  return true;
}

test('fire-buddy dispose makes later timers and forced state changes inert', () => {
  const clock = fakeClock();
  const changes = [];
  const fsm = createFireBuddyStateMachine({ onChange: ({ state }) => changes.push(state), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  fsm.dispose();
  assert.equal(clock.size, 0);
  assert.equal(fsm.setState('sit'), false);
  clock.runNext();
  assert.deepEqual(changes, ['walk']);
});

test('navigation can be rebuilt when final furniture geometry arrives', async () => {
  const source = await readFile(new URL('./fire-buddy-social.js', import.meta.url), 'utf8');
  assert.match(source, /const refreshNavigation = \(nextPlacements = placements\) =>/);
  assert.match(source, /Object\.assign\(navigation, buildFireBuddyNavigation/);
  assert.match(source, /insideObstacle && navigation\.points\.length/);
  assert.match(source, /refreshNavigation, dispose/);
});

test('fire-buddy 2.5D sprite uses depth testing and releases scene, frame, texture, and materials', () => {
  class Node {
    constructor() {
      this.children = [];
      this.parent = null;
      this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => Object.assign(this.position, { x, y, z }) };
      this.scale = { set: () => {} };
      this.userData = {};
    }
    add(child) { child.parent = this; this.children.push(child); }
    remove(child) { this.children = this.children.filter((item) => item !== child); child.parent = null; }
    clear() { this.children.length = 0; }
  }
  class Group extends Node {}
  class Sprite extends Node { constructor(material) { super(); this.material = material; this.center = { set() {} }; } }
  class SpriteMaterial { constructor(options) { Object.assign(this, options); this.rotation = 0; this.disposed = false; } dispose() { this.disposed = true; } }
  const loadedTexture = { disposed: false, dispose() { this.disposed = true; } };
  class TextureLoader { load(_url, onLoad) { onLoad(loadedTexture); } }
  class Vector3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } project() { return this; } }
  class CanvasTexture {}
  const THREE = { Group, Sprite, SpriteMaterial, TextureLoader, Vector3, CanvasTexture, SRGBColorSpace: 'srgb' };
  const scene = new Group();
  const camera = {};
  let cancelled = null;
  const buddy = mountFireBuddySocial({
    THREE, scene, camera,
    rooms: [{ id: 'room', x: 0, z: 0, width: 5, depth: 5 }],
    requestFrame: () => 81,
    cancelFrame: (id) => { cancelled = id; },
    random: () => 0
  });
  assert.equal(scene.children.includes(buddy.group), true);
  assert.equal(buddy.sprite.material.depthTest, true);
  assert.equal(buddy.sprite.material.depthWrite, false);
  const spriteMaterial = buddy.sprite.material;
  buddy.dispose();
  assert.equal(scene.children.includes(buddy.group), false);
  assert.equal(cancelled, 81);
  assert.equal(loadedTexture.disposed, true);
  assert.equal(spriteMaterial.disposed, true);
  assert.equal(buddy.disposed, true);
});

test('fire-buddy reduced motion keeps walk sprite still while retaining state updates', () => {
  class Node {
    constructor() {
      this.children = [];
      this.parent = null;
      this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => Object.assign(this.position, { x, y, z }) };
      this.scale = { set() {} };
      this.userData = {};
    }
    add(child) { child.parent = this; this.children.push(child); }
    remove(child) { this.children = this.children.filter((item) => item !== child); }
    clear() { this.children.length = 0; }
  }
  class Group extends Node {}
  class Sprite extends Node { constructor(material) { super(); this.material = material; this.center = { set() {} }; } }
  class SpriteMaterial { constructor(options) { Object.assign(this, options); this.rotation = 0; } dispose() {} }
  class TextureLoader { load(_url, onLoad) { onLoad({ dispose() {} }); } }
  class Vector3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } project() { return this; } }
  const THREE = { Group, Sprite, SpriteMaterial, TextureLoader, Vector3, CanvasTexture: class {}, SRGBColorSpace: 'srgb' };
  let frame;
  const buddy = mountFireBuddySocial({
    THREE, scene: new Group(), camera: {}, rooms: [{ id: 'room', width: 5, depth: 5 }],
    reducedMotion: true, random: () => 0, now: () => 0,
    requestFrame: (callback) => { frame = callback; return 1; }, cancelFrame() {}
  });
  frame(16);
  assert.equal(buddy.state, 'walk');
  assert.equal(buddy.sprite.position.y, 0);
  assert.equal(buddy.sprite.material.rotation, 0);
  buddy.dispose();
});
