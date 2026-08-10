const STATES = Object.freeze(['walk', 'sit']);

const DEFAULT_COPY = Object.freeze({
  furniture: ['主人快看，这个也太可爱了吧！', '主人主人，我好喜欢这个呀！'],
  recommendation: ['这盏灯和房间的木色很搭耶。', '看到喜欢的家具，可以先收藏起来。'],
  default: ['朋友的家真温馨，我也来逛逛。']
});

export const FIRE_BUDDY_SOCIAL_COPY_CAROUSEL = Object.freeze([
  Object.freeze({ key: 'enter', label: '进入好友房间', message: '主人主人，我好喜欢这个房子呀！' }),
  Object.freeze({ key: 'explore', label: '开始探索', message: '这里有好多好看的东西，我们逛逛嘛～' }),
  Object.freeze({ key: 'furniture', label: '看到家具', message: '主人快看，这个也太可爱了吧！' }),
  Object.freeze({ key: 'favorite', label: '引导收藏', message: '我好喜欢这个，主人帮我收藏起来嘛～' }),
  Object.freeze({ key: 'similar', label: '查看同款', message: '主人，我们看看有没有相似的好东西吧！' }),
  Object.freeze({ key: 'recommend', label: '引导推荐', message: '它和我们家也很搭，要不要看看怎么搭呀？' }),
  Object.freeze({ key: 'try', label: '引导试摆', message: '主人，把它搬回我们家试试看嘛！' }),
  Object.freeze({ key: 'try-success', label: '试摆效果不错', message: '哇，它放在我们家也好合适！' }),
  Object.freeze({ key: 'keep', label: '引导留下', message: '主人主人，我们把它留下来吧～' })
]);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function roomBounds(room, margin) {
  const width = Math.max(.8, finite(room?.width ?? room?.w, 5));
  const depth = Math.max(.8, finite(room?.depth ?? room?.d, 5));
  const x = finite(room?.x);
  const z = finite(room?.z);
  const insetX = Math.min(margin, width * .22);
  const insetZ = Math.min(margin, depth * .22);
  return { room, minX: x - width / 2 + insetX, maxX: x + width / 2 - insetX, minZ: z - depth / 2 + insetZ, maxZ: z + depth / 2 - insetZ };
}

function placementBounds(placement, padding) {
  const position = placement?.position || placement || {};
  const dimensions = placement?.dimensions || placement?.size || placement?.footprint || [.9, .8, .9];
  const scale = placement?.scale || { x: 1, z: 1 };
  const width = Math.max(.1, finite(Array.isArray(dimensions) ? dimensions[0] : dimensions.width ?? dimensions.w, .9) * Math.abs(finite(scale.x, 1)));
  const depth = Math.max(.1, finite(Array.isArray(dimensions) ? dimensions[2] : dimensions.depth ?? dimensions.d, .9) * Math.abs(finite(scale.z, 1)));
  const x = finite(position.x);
  const z = finite(position.z);
  return { source: placement, minX: x - width / 2 - padding, maxX: x + width / 2 + padding, minZ: z - depth / 2 - padding, maxZ: z + depth / 2 + padding };
}

function isPointClear(point, obstacles) {
  return obstacles.every((box) => point.x < box.minX || point.x > box.maxX || point.z < box.minZ || point.z > box.maxZ);
}

const pointInBounds = (point, bounds) => point.x >= bounds.minX && point.x <= bounds.maxX && point.z >= bounds.minZ && point.z <= bounds.maxZ;

function segmentHitsBox(a, b, box) {
  let low = 0;
  let high = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, box.minX, box.maxX], [a.z, b.z - a.z, box.minZ, box.maxZ]]) {
    if (Math.abs(delta) < 1e-7) {
      if (start < min || start > max) return false;
      continue;
    }
    const t1 = (min - start) / delta;
    const t2 = (max - start) / delta;
    low = Math.max(low, Math.min(t1, t2));
    high = Math.min(high, Math.max(t1, t2));
    if (low > high) return false;
  }
  return true;
}

const semanticText = (item) => `${item?.kind || ''} ${item?.type || ''} ${item?.category || ''} ${item?.name || ''} ${item?.assetName || ''}`.toLowerCase();
const isSleepSemantic = (item) => /bed|sofa|rug|床|沙发|地毯/.test(semanticText(item));
const isEatSemantic = (item) => /table|desk|餐桌|茶几|桌/.test(semanticText(item));

function nearestClearPointAround(box, bounds, obstacles) {
  const gap = .32;
  const candidates = [
    { x: (box.minX + box.maxX) / 2, z: box.minZ - gap },
    { x: (box.minX + box.maxX) / 2, z: box.maxZ + gap },
    { x: box.minX - gap, z: (box.minZ + box.maxZ) / 2 },
    { x: box.maxX + gap, z: (box.minZ + box.maxZ) / 2 }
  ];
  return candidates.find((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.z >= bounds.minZ && point.z <= bounds.maxZ && isPointClear(point, obstacles));
}

function smoothPath(points, segmentIsClear) {
  if (points.length <= 2) return points;
  const smoothed = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (next > anchor + 1 && !segmentIsClear(points[anchor], points[next])) next -= 1;
    smoothed.push(points[next]);
    anchor = next;
  }
  return smoothed;
}

/** Plans a local CPU-only path on the room floor. Obstacles are already padded by the buddy radius. */
export function findFireBuddyPath({ start, goal, bounds, obstacles = [], cellSize = .28 } = {}) {
  if (!start || !goal || !bounds || !pointInBounds(start, bounds) || !pointInBounds(goal, bounds)) return [];
  const segmentIsClear = (a, b) => obstacles.every((box) => !segmentHitsBox(a, b, box));
  if (segmentIsClear(start, goal)) return [{ ...goal }];

  const cols = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
  const rows = Math.max(2, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize));
  const stepX = (bounds.maxX - bounds.minX) / cols;
  const stepZ = (bounds.maxZ - bounds.minZ) / rows;
  const key = (x, z) => `${x}:${z}`;
  const pointAt = (x, z) => ({ x: bounds.minX + (x + .5) * stepX, z: bounds.minZ + (z + .5) * stepZ });
  const cellFor = (point) => ({
    x: clamp(Math.floor((point.x - bounds.minX) / stepX), 0, cols - 1),
    z: clamp(Math.floor((point.z - bounds.minZ) / stepZ), 0, rows - 1)
  });
  const walkable = (x, z) => x >= 0 && x < cols && z >= 0 && z < rows && isPointClear(pointAt(x, z), obstacles);
  const nearestWalkable = (cell) => {
    if (walkable(cell.x, cell.z)) return cell;
    const limit = Math.max(cols, rows);
    for (let radius = 1; radius <= limit; radius += 1) {
      for (let x = cell.x - radius; x <= cell.x + radius; x += 1) {
        for (const z of [cell.z - radius, cell.z + radius]) if (walkable(x, z)) return { x, z };
      }
      for (let z = cell.z - radius + 1; z < cell.z + radius; z += 1) {
        for (const x of [cell.x - radius, cell.x + radius]) if (walkable(x, z)) return { x, z };
      }
    }
    return null;
  };
  const startCell = nearestWalkable(cellFor(start));
  const goalCell = nearestWalkable(cellFor(goal));
  if (!startCell || !goalCell) return [];

  const open = new Map([[key(startCell.x, startCell.z), { ...startCell, g: 0, f: 0 }]]);
  const closed = new Set();
  const parents = new Map();
  const costs = new Map([[key(startCell.x, startCell.z), 0]]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const heuristic = (cell) => Math.hypot(cell.x - goalCell.x, cell.z - goalCell.z);
  let reached = null;

  while (open.size) {
    let currentKey = null;
    let current = null;
    for (const [candidateKey, candidate] of open) {
      if (!current || candidate.f < current.f) { currentKey = candidateKey; current = candidate; }
    }
    open.delete(currentKey);
    if (current.x === goalCell.x && current.z === goalCell.z) { reached = current; break; }
    closed.add(currentKey);
    for (const [dx, dz] of directions) {
      const nx = current.x + dx;
      const nz = current.z + dz;
      if (!walkable(nx, nz)) continue;
      if (dx && dz && (!walkable(current.x + dx, current.z) || !walkable(current.x, current.z + dz))) continue;
      const nextKey = key(nx, nz);
      if (closed.has(nextKey)) continue;
      const tentative = current.g + (dx && dz ? Math.SQRT2 : 1);
      if (tentative >= (costs.get(nextKey) ?? Infinity)) continue;
      parents.set(nextKey, currentKey);
      costs.set(nextKey, tentative);
      open.set(nextKey, { x: nx, z: nz, g: tentative, f: tentative + heuristic({ x: nx, z: nz }) });
    }
  }
  if (!reached) return [];

  const cells = [];
  let cursor = key(reached.x, reached.z);
  while (cursor) {
    const [x, z] = cursor.split(':').map(Number);
    cells.push(pointAt(x, z));
    cursor = parents.get(cursor);
  }
  cells.reverse();
  const route = smoothPath([{ ...start }, ...cells, { ...goal }], segmentIsClear);
  return route.slice(1);
}

/** Creates deterministic room-safe points and padded furniture obstacles. */
export function buildFireBuddyNavigation({ rooms = [], placements = [], margin = .62, obstaclePadding = .62, maxPoints = 5 } = {}) {
  const usableRooms = (rooms.length ? rooms : [{ id: 'fallback-room', x: 0, z: 0, width: 5, depth: 5 }])
    .filter((room) => finite(room?.width ?? room?.w, 0) > 0 && finite(room?.depth ?? room?.d, 0) > 0);
  if (!usableRooms.length) usableRooms.push({ id: 'fallback-room', x: 0, z: 0, width: 5, depth: 5 });
  const obstacles = placements.map((item) => placementBounds(item, obstaclePadding));
  const points = [];

  for (const room of usableRooms) {
    const bounds = roomBounds(room, margin);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const candidates = [];
    for (let zIndex = 0; zIndex < 11; zIndex += 1) {
      for (let xIndex = 0; xIndex < 13; xIndex += 1) {
        candidates.push({ x: bounds.minX + width * (.04 + xIndex / 12 * .92), z: bounds.minZ + depth * (.04 + zIndex / 10 * .92) });
      }
    }
    const roomType = semanticText(room);
    const safeCandidates = candidates.filter((candidate) => isPointClear(candidate, obstacles));
    const selected = [];
    while (safeCandidates.length && points.length + selected.length < maxPoints) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let index = 0; index < safeCandidates.length; index += 1) {
        const candidate = safeCandidates[index];
        const score = selected.length
          ? Math.min(...selected.map((point) => distance(point, candidate)))
          : -Math.hypot(candidate.x - cx, candidate.z - cz);
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      }
      selected.push(safeCandidates.splice(bestIndex, 1)[0]);
    }
    points.push(...selected.map((candidate) => ({ ...candidate, y: finite(room?.floorY), roomId: room.id, sleep: /bed|living|卧|客厅/.test(roomType), eat: /dining|kitchen|餐|厨/.test(roomType) })));
    if (points.length >= maxPoints) break;
  }

  for (const placement of placements) {
    const preferred = isSleepSemantic(placement) ? 'sleep' : isEatSemantic(placement) ? 'eat' : '';
    if (!preferred) continue;
    const matchingRoom = usableRooms.find((room) => !placement.roomId || room.id === placement.roomId) || usableRooms[0];
    const bounds = roomBounds(matchingRoom, margin);
    const point = nearestClearPointAround(placementBounds(placement, obstaclePadding), bounds, obstacles);
    if (!point) continue;
    const tagged = { ...point, y: finite(matchingRoom?.floorY), roomId: matchingRoom.id, sleep: preferred === 'sleep', eat: preferred === 'eat' };
    const replaceAt = points.findIndex((candidate) => !candidate[preferred]);
    if (replaceAt >= 0) points.splice(replaceAt, 1, tagged);
    else if (points.length < maxPoints) points.push(tagged);
  }

  if (!points.length) {
    const bounds = roomBounds(usableRooms[0], 0);
    points.push({ x: (bounds.minX + bounds.maxX) / 2, y: 0, z: (bounds.minZ + bounds.maxZ) / 2, roomId: usableRooms[0].id });
  }
  const bounds = usableRooms.map((room) => roomBounds(room, margin));
  const segmentIsClear = (a, b) => obstacles.every((box) => !segmentHitsBox(a, b, box));
  const findPath = (start, goal) => {
    const room = bounds.find((item) => pointInBounds(start, item) && pointInBounds(goal, item));
    return room ? findFireBuddyPath({ start, goal, bounds: room, obstacles }) : [];
  };
  return { points: points.slice(0, clamp(maxPoints, 3, 16)), obstacles, bounds, segmentIsClear, findPath };
}

/** Testable finite-state machine. Forced states reschedule cleanly. */
export function createFireBuddyStateMachine({ onChange = () => {}, random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout, durations = {} } = {}) {
  const stateDurations = { walk: [10000, 16000], sit: [5000, 8000], ...durations };
  let state = null;
  let timer = null;
  let locked = false;
  let disposed = false;
  const schedule = () => {
    if (disposed || locked) return;
    const range = Array.isArray(stateDurations[state]) ? stateDurations[state] : [stateDurations[state], stateDurations[state]];
    const delay = finite(range[0], 4000) + (finite(range[1], range[0]) - finite(range[0], 4000)) * random();
    timer = setTimer(() => {
      timer = null;
      if (disposed) return;
      const next = state === 'walk' ? 'sit' : 'walk';
      setState(next, 'timer');
    }, Math.max(0, delay));
  };
  const setState = (next, reason = 'forced') => {
    if (disposed || !STATES.includes(next)) return false;
    if (timer !== null) clearTimer(timer);
    state = next;
    onChange({ state, reason });
    schedule();
    return true;
  };
  const setLocked = (next) => {
    if (disposed) return false;
    locked = Boolean(next);
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!locked) schedule();
    return true;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  setState('walk', 'mount');
  return { get state() { return state; }, setState, setLocked, dispose, get disposed() { return disposed; } };
}

function choosePoint(points, current, predicate, navigation, random) {
  const preferred = points.filter(predicate);
  const candidates = (preferred.length ? preferred : points).filter((point) => !current || distance(point, current) > .12);
  const reachable = candidates.filter((point) => !current || navigation.findPath(current, point).length);
  const pool = reachable.length ? reachable : current ? [current] : candidates.length ? candidates : points;
  return pool[Math.floor(random() * pool.length)] || current || { x: 0, y: 0, z: 0 };
}

/** Mounts a world-space 2.5D visitor sprite. The host passes its existing THREE instance. */
export function mountFireBuddySocial({ THREE, scene, camera, rooms = [], placements = [], navigationOptions = {}, textureUrl = '../../assets/social/fire-buddy.png', texture = null, walkVideoUrl = '', sitVideoUrl = '', overlayRoot = null, viewportElement = null, bubblePositioning = 'screen', viewer = null, onPrompt = () => {}, random = Math.random, reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true, requestFrame = globalThis.requestAnimationFrame?.bind(globalThis), cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis), setTimer = setTimeout, clearTimer = clearTimeout, now = () => globalThis.performance?.now?.() ?? Date.now(), promptCooldown = 12000, promptVisibleFor = 4200, durations } = {}) {
  if (!THREE || !scene || !camera) throw new Error('mountFireBuddySocial requires THREE, scene, and camera');
  const navigation = buildFireBuddyNavigation({ rooms, placements, ...navigationOptions });
  const group = new THREE.Group();
  group.name = 'fire-buddy-social';
  group.userData.fireBuddySocial = true;
  const material = new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false, alphaTest: .04 });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'fire-buddy-social-sprite';
  sprite.center?.set?.(.5, 0);
  sprite.scale.set(1.08, 1.08, 1.08);
  sprite.renderOrder = 0;
  group.add(sprite);
  const incomingMaterial = new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false, alphaTest: .04, opacity: 0 });
  const incomingSprite = new THREE.Sprite(incomingMaterial);
  incomingSprite.name = 'fire-buddy-social-sprite-incoming';
  incomingSprite.center?.set?.(.5, 0);
  incomingSprite.scale.set(1.03, 1.03, 1.03);
  incomingSprite.renderOrder = 1;
  incomingSprite.visible = false;
  group.add(incomingSprite);
  scene.add(group);

  let ownedTexture = null;
  let video = null;
  let sitVideo = null;
  let activeVideo = null;
  let walkTexture = null;
  let overlayCanvas = null;
  let overlayContext = null;
  let incomingCanvas = null;
  let incomingContext = null;
  let incomingTexture = null;
  let disposed = false;
  if (walkVideoUrl && typeof document !== 'undefined' && THREE.CanvasTexture) {
    video = document.createElement('video');
    video.src = walkVideoUrl;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    if (sitVideoUrl) {
      sitVideo = document.createElement('video');
      sitVideo.src = sitVideoUrl;
      sitVideo.loop = true;
      sitVideo.muted = true;
      sitVideo.playsInline = true;
      sitVideo.autoplay = false;
      sitVideo.preload = 'auto';
      sitVideo.setAttribute('playsinline', '');
      sitVideo.setAttribute('webkit-playsinline', '');
    }
    activeVideo = video;
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 128;
    overlayCanvas.height = 128;
    overlayContext = overlayCanvas.getContext('2d', { willReadFrequently: true });
    walkTexture = new THREE.CanvasTexture(overlayCanvas);
    walkTexture.colorSpace = THREE.SRGBColorSpace;
    walkTexture.minFilter = THREE.LinearFilter;
    walkTexture.magFilter = THREE.LinearFilter;
    material.map = walkTexture;
    incomingCanvas = document.createElement('canvas');
    incomingCanvas.width = 128;
    incomingCanvas.height = 128;
    incomingContext = incomingCanvas.getContext('2d', { willReadFrequently: true });
    incomingTexture = new THREE.CanvasTexture(incomingCanvas);
    incomingTexture.colorSpace = THREE.SRGBColorSpace;
    incomingTexture.minFilter = THREE.LinearFilter;
    incomingTexture.magFilter = THREE.LinearFilter;
    incomingMaterial.map = incomingTexture;
    material.needsUpdate = true;
    video.addEventListener('canplay', () => { if (!disposed && group.userData.state === 'walk') video.play().catch(() => {}); });
    video.play().catch(() => {});
  } else if (texture) material.map = texture;
  else {
    const loader = new THREE.TextureLoader();
    loader.load(textureUrl, (loaded) => {
      if (disposed) { loaded.dispose(); return; }
      loaded.colorSpace = THREE.SRGBColorSpace;
      material.map = ownedTexture = loaded;
      material.needsUpdate = true;
    }, undefined, () => { if (!disposed) group.userData.textureError = true; });
  }

  const bubble = overlayRoot && typeof document !== 'undefined' ? document.createElement('div') : null;
  if (bubble) {
    bubble.className = 'fire-buddy-social__bubble';
    bubble.hidden = true;
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    bubble.dataset.viewer = viewer?.name || '';
    overlayRoot.append(bubble);
  }

  let current = choosePoint(navigation.points, null, () => true, navigation, random);
  let target = current;
  let route = [];
  let routeIndex = 0;
  let frameId = null;
  let bubbleTimer = null;
  let lastFrame = now();
  let lastPromptAt = -Infinity;
  let transitionStarted = 0;
  let transitioning = false;
  let holdUntil = -Infinity;
  let directedRoute = false;
  const transitionDuration = reducedMotion ? 80 : 320;
  group.position.set(current.x, finite(current.y) + .015, current.z);

  const fsm = createFireBuddyStateMachine({ random, durations, setTimer, clearTimer, onChange: ({ state }) => {
    current = { x: group.position.x, y: group.position.y - .015, z: group.position.z };
    if (state === 'walk') {
      target = choosePoint(navigation.points, current, () => true, navigation, random);
      route = navigation.findPath(current, target);
      routeIndex = 0;
    }
    if (state !== 'walk') {
      route = [];
      routeIndex = 0;
    }
    group.userData.route = route.map((point) => ({ ...point }));
    if (walkTexture) {
      material.map = walkTexture;
    }
    const nextVideo = state === 'sit' && sitVideo ? sitVideo : video;
    if (nextVideo && activeVideo && nextVideo !== activeVideo && incomingTexture) {
      activeVideo.pause();
      activeVideo = nextVideo;
      activeVideo.currentTime = 0;
      activeVideo.play().catch(() => {});
      transitionStarted = now();
      transitioning = true;
      group.userData.transitioning = true;
      material.opacity = 1;
      incomingMaterial.opacity = 0;
      incomingSprite.visible = true;
    } else {
      activeVideo = nextVideo;
      activeVideo?.play().catch(() => {});
      group.userData.transitioning = false;
    }
    sprite.visible = true;
    material.needsUpdate = true;
    group.userData.state = state;
  }});

  const updateBubble = () => {
    if (!bubble || bubble.hidden || typeof camera.updateMatrixWorld !== 'function') return;
    camera.updateProjectionMatrix?.();
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld?.(true);
    // CSS positions live in the overlay's unscaled coordinate system. The
    // phone shell is visually scaled, so getBoundingClientRect() would apply
    // that scale once here and the parent transform a second time.
    const width = overlayRoot.clientWidth || viewportElement?.clientWidth || 1;
    const height = overlayRoot.clientHeight || viewportElement?.clientHeight || 1;
    const toScreen = (world) => {
      const projected = world.clone().project(camera);
      return { x: (projected.x * .5 + .5) * width, y: (-projected.y * .5 + .5) * height, z: projected.z };
    };
    // Use the model's world-space top center. Projecting the visually highest
    // Box3 corner exaggerates height under an angled perspective camera.
    const anchorObject = group.userData.bubbleAnchorObject;
    let anchorWorld;
    if (anchorObject && THREE.Box3) {
      const box = new THREE.Box3().setFromObject(anchorObject, true);
      anchorWorld = box.getCenter(new THREE.Vector3());
      anchorWorld.y = box.max.y + .05;
    } else {
      anchorWorld = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, .05, 0));
    }
    const headScreen = toScreen(anchorWorld);
    const desiredX = headScreen.x;
    const desiredY = headScreen.y;
    const pointZ = headScreen.z;
    const bubbleWidth = bubble.offsetWidth || Math.min(176, width - 24);
    const halfWidth = bubbleWidth / 2;
    const bubbleX = clamp(desiredX, halfWidth + 8, width - halfWidth - 8);
    const tailX = clamp(desiredX - bubbleX + halfWidth, 16, bubbleWidth - 16);
    bubble.style.setProperty('--fire-buddy-tail-x', `${tailX}px`);
    bubble.style.transform = `translate(-50%, -100%) translate(${bubbleX}px, ${desiredY}px)`;
    bubble.hidden = pointZ < -1 || pointZ > 1;
  };
  const drawVideoFrame = (sourceVideo, canvas, context, texture) => {
    if (!sourceVideo || !canvas || !context || !texture || sourceVideo.readyState < 2) return false;
      context.clearRect(0, 0, 128, 128);
      context.drawImage(sourceVideo, 0, 0, 128, 128);
      const frame = context.getImageData(0, 0, 128, 128);
      let lowestVisibleRow = -1;
      for (let index = 0; index < frame.data.length; index += 4) {
        const peak = Math.max(frame.data[index], frame.data[index + 1], frame.data[index + 2]);
        frame.data[index + 3] = peak <= 8 ? 0 : peak >= 40 ? 255 : Math.round((peak - 8) / 32 * 255);
        if (frame.data[index + 3] > 20) lowestVisibleRow = Math.max(lowestVisibleRow, Math.floor(index / 4 / 128));
      }
      const shift = lowestVisibleRow >= 0 ? 127 - lowestVisibleRow : 0;
      if (shift > 0) {
        for (let y = 127; y >= 0; y -= 1) {
          const sourceY = y - shift;
          for (let x = 0; x < 128; x += 1) {
            const destination = (y * 128 + x) * 4;
            const source = sourceY >= 0 ? (sourceY * 128 + x) * 4 : -1;
            for (let channel = 0; channel < 4; channel += 1) frame.data[destination + channel] = source >= 0 ? frame.data[source + channel] : 0;
          }
        }
      }
      context.putImageData(frame, 0, 0);
      texture.needsUpdate = true;
      return true;
  };
  const updateWalkVideo = () => {
    if (!activeVideo || !overlayCanvas || !overlayContext || !walkTexture) return;
    if (transitioning) {
      drawVideoFrame(activeVideo, incomingCanvas, incomingContext, incomingTexture);
      const progress = clamp((now() - transitionStarted) / transitionDuration, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      material.opacity = 1 - eased * .88;
      incomingMaterial.opacity = eased;
      const incomingScale = 1.03 + eased * .05;
      incomingSprite.scale.set(incomingScale, incomingScale, incomingScale);
      if (progress >= 1) {
        overlayContext.clearRect(0, 0, 128, 128);
        overlayContext.drawImage(incomingCanvas, 0, 0);
        walkTexture.needsUpdate = true;
        material.opacity = 1;
        incomingMaterial.opacity = 0;
        incomingSprite.visible = false;
        incomingSprite.scale.set(1.03, 1.03, 1.03);
        transitioning = false;
        group.userData.transitioning = false;
      }
    } else {
      drawVideoFrame(activeVideo, overlayCanvas, overlayContext, walkTexture);
    }
  };
  const tick = (timestamp) => {
    if (disposed) return;
    const elapsed = Math.min(.05, Math.max(0, (timestamp - lastFrame) / 1000));
    lastFrame = timestamp;
    if (fsm.state === 'walk' && !transitioning && timestamp >= holdUntil) {
      const waypoint = route[routeIndex] || target;
      const dx = waypoint.x - group.position.x;
      const dz = waypoint.z - group.position.z;
      const remaining = Math.hypot(dx, dz);
      const step = Math.min(remaining, elapsed * (reducedMotion ? .48 : .72));
      if (remaining > .001) {
        group.position.x += dx / remaining * step;
        group.position.z += dz / remaining * step;
      }
      if (remaining <= .025 && routeIndex < route.length - 1) routeIndex += 1;
      else if (remaining <= .025) {
        current = { x: group.position.x, y: group.position.y - .015, z: group.position.z };
        if (directedRoute) {
          directedRoute = false;
          route = [];
          routeIndex = 0;
          target = current;
          holdUntil = now() + 250;
          group.userData.directedRoute = false;
          group.userData.completedRoutes = (group.userData.completedRoutes || 0) + 1;
          fsm.setLocked(false);
          group.userData.route = [];
          group.userData.routeIndex = 0;
          updateWalkVideo();
          updateBubble();
          frameId = requestFrame?.(tick) ?? null;
          return;
        }
        const nextTarget = choosePoint(navigation.points, current, () => true, navigation, random);
        const nextRoute = navigation.findPath(current, nextTarget);
        if (distance(current, nextTarget) <= .12) {
          target = current;
          route = [];
          routeIndex = 0;
          group.userData.route = [];
        } else if (nextRoute.length) {
          target = nextTarget;
          route = nextRoute;
          routeIndex = 0;
          group.userData.route = route.map((point) => ({ ...point }));
          group.userData.completedRoutes = (group.userData.completedRoutes || 0) + 1;
        }
      }
      group.userData.routeIndex = routeIndex;
      sprite.position.y = 0;
      sprite.material.rotation = 0;
    } else {
      sprite.position.y = 0;
      sprite.material.rotation = 0;
    }
    sprite.scale.set(1.08, 1.08, 1.08);
    updateWalkVideo();
    if (bubblePositioning === 'screen') updateBubble();
    frameId = requestFrame?.(tick) ?? null;
  };
  frameId = requestFrame?.(tick) ?? null;

  const prompt = (kind = 'default', copy, { force = false } = {}) => {
    const timestamp = now();
    if (disposed || (!force && timestamp - lastPromptAt < promptCooldown)) return false;
    const choices = copy ? [copy] : DEFAULT_COPY[kind] || DEFAULT_COPY.default;
    const message = choices[Math.floor(random() * choices.length)];
    lastPromptAt = timestamp;
    if (bubble) {
      if (bubbleTimer !== null) clearTimer(bubbleTimer);
      bubble.textContent = message;
      bubble.hidden = false;
      bubble.classList.remove('is-visible');
      void bubble.offsetWidth;
      bubble.classList.add('is-visible');
      bubbleTimer = setTimer(() => {
        bubbleTimer = null;
        bubble.classList.remove('is-visible');
        bubble.hidden = true;
      }, promptVisibleFor);
    }
    onPrompt({ kind, message, viewer, state: fsm.state });
    return true;
  };

  const walkTo = (goal) => {
    if (disposed || !goal) return false;
    fsm.setLocked(true);
    if (fsm.state !== 'walk') fsm.setState('walk', 'walkTo');
    current = { x: group.position.x, y: group.position.y - .015, z: group.position.z };
    const planned = navigation.findPath(current, goal);
    if (!planned.length) { fsm.setLocked(false); return false; }
    directedRoute = true;
    target = { ...goal };
    route = planned;
    routeIndex = 0;
    group.userData.route = route.map((point) => ({ ...point }));
    group.userData.routeIndex = 0;
    group.userData.directedRoute = true;
    return true;
  };

  const hold = (duration = 2000) => {
    if (disposed) return false;
    holdUntil = now() + Math.max(0, finite(duration, 2000));
    group.userData.holdUntil = holdUntil;
    return true;
  };

  const refreshNavigation = (nextPlacements = placements) => {
    if (disposed) return false;
    placements = nextPlacements;
    Object.assign(navigation, buildFireBuddyNavigation({ rooms, placements, ...navigationOptions }));
    route = [];
    routeIndex = 0;
    directedRoute = false;
    group.userData.route = [];
    group.userData.routeIndex = 0;
    group.userData.directedRoute = false;
    const position = { x: group.position.x, z: group.position.z };
    const insideObstacle = navigation.obstacles.some((box) => position.x >= box.minX && position.x <= box.maxX && position.z >= box.minZ && position.z <= box.maxZ);
    if (insideObstacle && navigation.points.length) {
      const safe = [...navigation.points].sort((a, b) => distance(position, a) - distance(position, b))[0];
      group.position.set(safe.x, finite(safe.y) + .015, safe.z);
      current = safe;
      target = safe;
    }
    fsm.setLocked(false);
    group.userData.navigationRefreshCount = Number(group.userData.navigationRefreshCount || 0) + 1;
    return true;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    fsm.dispose();
    if (bubbleTimer !== null) clearTimer(bubbleTimer);
    bubbleTimer = null;
    if (frameId !== null) cancelFrame?.(frameId);
    bubble?.remove();
    group.parent?.remove(group);
    incomingMaterial.dispose();
    material.dispose();
    ownedTexture?.dispose?.();
    walkTexture?.dispose?.();
    incomingTexture?.dispose?.();
    overlayCanvas?.remove();
    incomingCanvas?.remove();
    overlayCanvas = null;
    overlayContext = null;
    incomingCanvas = null;
    incomingContext = null;
    incomingTexture = null;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video = null;
    }
    if (sitVideo) {
      sitVideo.pause();
      sitVideo.removeAttribute('src');
      sitVideo.load();
      sitVideo = null;
    }
    group.clear?.();
  };
  return { group, sprite, bubble, mediaElement: video, mediaElements: { walk: video, sit: sitVideo }, navigation, get state() { return fsm.state; }, setState: fsm.setState, walkTo, hold, prompt, refreshNavigation, dispose, get disposed() { return disposed; } };
}

export { STATES as FIRE_BUDDY_STATES };
