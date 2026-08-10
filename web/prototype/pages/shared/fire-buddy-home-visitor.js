import { FIRE_BUDDY_SOCIAL_COPY_CAROUSEL, mountFireBuddySocial } from './fire-buddy-social.js?v=20260810c';
import { createFireBuddy3DAvatar } from './fire-buddy-3d-avatar.js?v=20260810c';
import { createFireBuddy3DSleepAvatar } from './fire-buddy-3d-sleep-avatar.js?v=20260810c';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function classifyFireBuddyRestFurniture(name = '', category = '') {
  const semantic = `${name} ${category}`.toLowerCase();
  if (/床|床榻|bed|daybed/.test(semantic)) return 'bed';
  if (/沙发|贵妃椅|躺椅|sofa|couch|chaise|recliner/.test(semantic)) return 'sofa';
  return null;
}

function floorFootprint(name, category, rawWidth, rawDepth) {
  const semantic = `${name || ''} ${category || ''}`.toLowerCase();
  if (/吊灯|壁灯|吸顶灯|电视|地毯|挂画|摆件|坐垫|lamp|light|television|rug|decor/.test(semantic)) return null;
  let longCap = 1.25;
  let shortCap = .9;
  if (/沙发|sofa/.test(semantic)) { longCap = 2.6; shortCap = 1.15; }
  else if (/桌|table|desk/.test(semantic)) { longCap = 1.9; shortCap = 1.15; }
  else if (/柜|cabinet|shelf/.test(semantic)) { longCap = 2.2; shortCap = .72; }
  else if (/椅|chair/.test(semantic)) { longCap = .9; shortCap = .82; }
  else if (/植物|盆栽|plant/.test(semantic)) { longCap = .78; shortCap = .72; }
  const widthIsLong = rawWidth >= rawDepth;
  return widthIsLong
    ? [Math.min(rawWidth, longCap), Math.min(rawDepth, shortCap)]
    : [Math.min(rawWidth, shortCap), Math.min(rawDepth, longCap)];
}

export function requiresFurnitureGesture(entry = {}) {
  if (entry.key === 'enter' || entry.key === 'explore') return false;
  return ['furniture', 'favorite', 'similar', 'recommend', 'try', 'try-success', 'keep'].includes(entry.key)
    || /这个|它|同款|相似/.test(entry.message || '');
}

export function isFireBuddyFriendChatEntry(search = globalThis.location?.search || '') {
  const params = new URLSearchParams(search);
  return params.get('mode') === 'locked' && params.get('source') === 'friend-share' && Boolean(params.get('friend'));
}

function findRestSurface(THREE, group) {
  const candidates = [];
  group.traverse((part) => {
    if (!part.isMesh || !part.geometry) return;
    const box = new THREE.Box3().setFromObject(part);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const longSide = Math.max(size.x, size.z);
    const shortSide = Math.min(size.x, size.z);
    // Reject missing-model placeholders and implausibly tall surfaces. Sleeping
    // on the floor is never used as a fallback when a real cushion is unknown.
    if (longSide < .62 || shortSide < .28 || box.max.y < .16 || box.max.y > 1.20 || size.y > 1.35) return;
    const area = size.x * size.z;
    candidates.push({
      x: center.x,
      y: box.max.y + .018,
      z: center.z,
      area,
      score: area / (1 + Math.max(0, size.y - .62) * .8)
    });
  });
  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function findPlacementGroup(object) {
  let cursor = object;
  while (cursor && !cursor.userData?.placementId) cursor = cursor.parent;
  return cursor || null;
}

export function mountFireBuddyHomeVisitor({
  THREE,
  scene,
  camera,
  renderer,
  overlayRoot,
  rooms = [],
  projectPlacements = [],
  placementGroups,
  selectable = [],
  resolveAsset = () => null,
  viewer = null,
  random = Math.random
} = {}) {
  if (!isFireBuddyFriendChatEntry()) return null;
  if (!THREE || !scene || !camera || !renderer || !overlayRoot || !placementGroups) throw new Error('mountFireBuddyHomeVisitor requires the active home scene');
  let disposed = false;
  let frame = null;
  let copyTimer = null;
  let inspectTimer = null;
  let sleepTimer = null;
  let wakeTimer = null;
  let css2DRenderer = null;
  let css2DObject = null;
  let css2DAnchor = null;
  let css2DResizeObserver = null;
  let copyIndex = 0;
  let reactionCopyIndex = 0;
  let pendingInspection = null;
  let pendingSleep = null;
  let sleeping = false;
  let sleepReturnPoint = null;
  let recentEntityIds = [];
  let pointerStart = null;
  let lastFrame = performance.now();
  const travelExtents = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const previousPosition = new THREE.Vector3();
  const entityById = new Map();
  const ambientCopies = FIRE_BUDDY_SOCIAL_COPY_CAROUSEL.filter((entry) => !requiresFurnitureGesture(entry));
  const reactionCopies = FIRE_BUDDY_SOCIAL_COPY_CAROUSEL.filter(requiresFurnitureGesture);
  const wasStage = overlayRoot.classList.contains('fire-buddy-social-stage');
  overlayRoot.classList.add('fire-buddy-social-stage');
  const packageBallNudge = overlayRoot.closest('.dh-root')?.querySelector('#matchAssistantNudge') || null;
  const packageBallNudgeDisplay = packageBallNudge?.style.getPropertyValue('display') || '';
  const packageBallNudgePriority = packageBallNudge?.style.getPropertyPriority('display') || '';
  packageBallNudge?.style.setProperty('display', 'none', 'important');

  const entities = projectPlacements.map((placement) => {
    const group = placementGroups.get(placement.id);
    const asset = resolveAsset(placement.assetId) || {};
    if (!group || asset.mount === 'wall' || asset.mount === 'ceiling') return null;
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (size.x < .08 || size.z < .08) return null;
    const footprint = floorFootprint(asset.name || placement.name, asset.category || placement.category, size.x, size.z);
    if (!footprint) return null;
    const restKind = classifyFireBuddyRestFurniture(asset.name || placement.name, asset.category || placement.category);
    const sleepSurface = restKind ? findRestSurface(THREE, group) : null;
    const entity = {
      id: placement.id,
      assetId: placement.assetId,
      roomId: placement.roomId,
      name: asset.name || placement.name || '家具',
      category: asset.category || placement.category || '家具',
      restKind,
      sleepSurface,
      target: { x: center.x, y: Math.max(.22, Math.min(center.y, 1.15)), z: center.z },
      position: { x: center.x, y: finite(placement.position?.y), z: center.z },
      dimensions: [Math.max(.1, footprint[0]), Math.max(.1, size.y), Math.max(.1, footprint[1])],
      scale: { x: 1, y: 1, z: 1 }
    };
    entityById.set(entity.id, entity);
    return entity;
  }).filter(Boolean);

  const transparentPixel = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  transparentPixel.needsUpdate = true;
  const buddy = mountFireBuddySocial({
    THREE,
    scene,
    camera,
    rooms,
    placements: entities,
    navigationOptions: { margin: .34, obstaclePadding: .38, maxPoints: 14 },
    texture: transparentPixel,
    overlayRoot,
    viewportElement: renderer.domElement,
    bubblePositioning: 'external',
    viewer,
    random,
    durations: { walk: [9000, 13000], sit: [4500, 7000] },
    promptCooldown: 11000,
    promptVisibleFor: 4300,
    onPrompt: ({ message }) => { overlayRoot.dataset.fireBuddyLastCopy = message; }
  });
  buddy.sprite.visible = false;
  const incoming = buddy.group.getObjectByName('fire-buddy-social-sprite-incoming');
  if (incoming) incoming.visible = false;
  const avatar = createFireBuddy3DAvatar({ THREE, scale: .38 });
  const sleepAvatar = createFireBuddy3DSleepAvatar({ THREE, scale: .38, showZ: true });
  buddy.group.add(avatar.root);
  buddy.group.add(sleepAvatar.root);
  buddy.group.userData.bubbleAnchorObject = avatar.root;
  sleepAvatar.root.visible = false;
  import('./fire-buddy-css2d-renderer.js?v=20260810d').then(({ FireBuddyCSS2DObject, FireBuddyCSS2DRenderer }) => {
    if (disposed || !buddy.bubble) return;
    css2DRenderer = new FireBuddyCSS2DRenderer();
    Object.assign(css2DRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '4' });
    overlayRoot.append(css2DRenderer.domElement);
    css2DAnchor = new THREE.Object3D();
    css2DAnchor.name = 'fire-buddy-css2d-anchor';
    buddy.group.add(css2DAnchor);
    css2DObject = new FireBuddyCSS2DObject(buddy.bubble);
    css2DObject.center.set(.5, 1);
    css2DAnchor.add(css2DObject);
    const resizeCSS2D = () => css2DRenderer?.setSize(overlayRoot.clientWidth || 1, overlayRoot.clientHeight || 1);
    css2DResizeObserver = new ResizeObserver(resizeCSS2D);
    css2DResizeObserver.observe(overlayRoot);
    resizeCSS2D();
    overlayRoot.dataset.fireBuddyBubblePositioning = 'css2d';
  }).catch(() => { overlayRoot.dataset.fireBuddyBubblePositioning = 'css2d-error'; });
  previousPosition.copy(buddy.group.position);
  overlayRoot.dataset.fireBuddyMounted = 'true';
  overlayRoot.dataset.fireBuddyState = buddy.state;
  overlayRoot.dataset.fireBuddyObstacleCount = String(entities.length);
  overlayRoot.dataset.fireBuddyWaypointCount = String(buddy.navigation.points.length);
  overlayRoot.dataset.fireBuddyInspectionCount = '0';
  overlayRoot.dataset.fireBuddySleepCount = '0';
  overlayRoot.dataset.fireBuddyRestFurnitureCount = String(entities.filter((entity) => entity.restKind).length);
  overlayRoot.dataset.fireBuddyRestSurfaceCount = String(entities.filter((entity) => entity.sleepSurface).length);

  const clearTimer = (timer) => { if (timer !== null) clearTimeout(timer); };
  const scheduleCopy = (delay = 15000) => {
    clearTimer(copyTimer);
    copyTimer = setTimeout(() => {
      copyTimer = null;
      if (disposed) return;
      if (sleeping) { scheduleCopy(3000); return; }
      const entry = ambientCopies[copyIndex];
      const shown = buddy.prompt(entry.key, entry.message);
      if (shown) copyIndex = (copyIndex + 1) % ambientCopies.length;
      scheduleCopy(shown ? 15000 : 3000);
    }, delay);
  };

  const reachableStandPoint = (entity) => {
    const obstacle = buddy.navigation.obstacles.find((item) => item.source?.id === entity.id);
    if (!obstacle) return null;
    const centerX = (obstacle.minX + obstacle.maxX) / 2;
    const centerZ = (obstacle.minZ + obstacle.maxZ) / 2;
    const candidates = [.08, .22, .38].flatMap((gap) => [
      { x: centerX, y: 0, z: obstacle.minZ - gap },
      { x: centerX, y: 0, z: obstacle.maxZ + gap },
      { x: obstacle.minX - gap, y: 0, z: centerZ },
      { x: obstacle.maxX + gap, y: 0, z: centerZ }
    ]);
    const current = { x: buddy.group.position.x, z: buddy.group.position.z };
    return candidates.map((point) => ({ point, path: buddy.navigation.findPath(current, point) }))
      .filter((candidate) => {
        if (!candidate.path.length || buddy.navigation.obstacles.some((box) => candidate.point.x >= box.minX && candidate.point.x <= box.maxX && candidate.point.z >= box.minZ && candidate.point.z <= box.maxZ)) return false;
        let previous = current;
        return candidate.path.every((point) => {
          const clear = buddy.navigation.segmentIsClear(previous, point);
          previous = point;
          return clear;
        });
      })
      .sort((a, b) => distance(current, a.point) - distance(current, b.point))[0] || null;
  };

  const inspectEntity = (entity, { manual = false } = {}) => {
    if (disposed || !entity || pendingInspection || pendingSleep || sleeping) return false;
    const approach = reachableStandPoint(entity);
    if (!approach || !buddy.walkTo(approach.point)) return false;
    const start = { x: buddy.group.position.x, z: buddy.group.position.z };
    let previous = start;
    const pathClear = approach.path.every((point) => {
      const clear = buddy.navigation.segmentIsClear(previous, point);
      previous = point;
      return clear;
    });
    const standAt = approach.point;
    pendingInspection = { entity, standAt, manual };
    overlayRoot.dataset.fireBuddyTarget = entity.id;
    overlayRoot.dataset.fireBuddyPathClear = String(pathClear);
    return true;
  };

  const inspectionCandidates = () => {
    const available = entities.filter((entity) => !recentEntityIds.includes(entity.id));
    const pool = available.length ? available : entities;
    if (!pool.length) return [];
    const current = { x: buddy.group.position.x, z: buddy.group.position.z };
    const ranked = [...pool].sort((a, b) => distance(current, b.position) - distance(current, a.position));
    const offset = Math.floor(random() * ranked.length);
    return [...ranked.slice(offset), ...ranked.slice(0, offset)];
  };

  const scheduleInspection = (delay = 14000 + random() * 6000) => {
    clearTimer(inspectTimer);
    inspectTimer = setTimeout(() => {
      inspectTimer = null;
      if (disposed) return;
      const started = !sleeping && !pendingSleep && !pendingInspection && inspectionCandidates().some((entity) => inspectEntity(entity));
      if (!started) scheduleInspection(2800 + random() * 2200);
    }, delay);
  };

  const restCandidates = () => {
    const restingFurniture = entities.filter((entity) => entity.restKind && entity.sleepSurface);
    if (!restingFurniture.length) return [];
    const current = { x: buddy.group.position.x, z: buddy.group.position.z };
    return [...restingFurniture].sort((a, b) => {
      if (a.restKind !== b.restKind) return a.restKind === 'bed' ? -1 : 1;
      return distance(current, a.position) - distance(current, b.position);
    });
  };

  const approachRestFurniture = (entity) => {
    if (disposed || sleeping || pendingSleep || pendingInspection) return false;
    const approach = reachableStandPoint(entity);
    if (!approach || !buddy.walkTo(approach.point)) return false;
    pendingSleep = { entity, standAt: approach.point };
    overlayRoot.dataset.fireBuddySleepTarget = entity.id;
    overlayRoot.dataset.fireBuddySleepTargetKind = entity.restKind;
    return true;
  };

  const scheduleSleep = (delay = 26000 + random() * 10000) => {
    clearTimer(sleepTimer);
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      if (disposed) return;
      const started = !sleeping && !pendingSleep && !pendingInspection && restCandidates().some(approachRestFurniture);
      if (!started) scheduleSleep(6500 + random() * 3500);
    }, delay);
  };

  const beginSleep = ({ entity, standAt }) => {
    if (!entity.sleepSurface) { pendingSleep = null; scheduleSleep(); return; }
    const duration = 8500 + random() * 3500;
    sleepReturnPoint = { x: standAt.x, y: buddy.group.position.y, z: standAt.z };
    buddy.group.position.set(entity.sleepSurface.x, entity.sleepSurface.y, entity.sleepSurface.z);
    const cameraDx = camera.position.x - entity.sleepSurface.x;
    const cameraDz = camera.position.z - entity.sleepSurface.z;
    sleeping = true;
    pendingSleep = null;
    buddy.setState('sit');
    buddy.hold(duration + 500);
    avatar.root.visible = false;
    sleepAvatar.root.visible = true;
    buddy.group.userData.bubbleAnchorObject = sleepAvatar.root;
    sleepAvatar.root.rotation.y = Math.atan2(cameraDx, cameraDz);
    overlayRoot.dataset.fireBuddyState = 'sleep';
    overlayRoot.dataset.fireBuddySleepingNear = entity.id;
    overlayRoot.dataset.fireBuddySleepingOn = entity.id;
    overlayRoot.dataset.fireBuddySleepSurfaceY = entity.sleepSurface.y.toFixed(3);
    overlayRoot.dataset.fireBuddySleepCount = String(Number(overlayRoot.dataset.fireBuddySleepCount || 0) + 1);
    clearTimer(wakeTimer);
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      if (disposed) return;
      sleeping = false;
      sleepAvatar.root.visible = false;
      avatar.root.visible = true;
      buddy.group.userData.bubbleAnchorObject = avatar.root;
      if (sleepReturnPoint) buddy.group.position.set(sleepReturnPoint.x, sleepReturnPoint.y, sleepReturnPoint.z);
      sleepReturnPoint = null;
      buddy.setState('walk');
      delete overlayRoot.dataset.fireBuddySleepingNear;
      delete overlayRoot.dataset.fireBuddySleepingOn;
      delete overlayRoot.dataset.fireBuddySleepSurfaceY;
      scheduleInspection(4200 + random() * 2800);
      scheduleSleep();
    }, duration);
  };

  const onPointerDown = (event) => { if (event.button === undefined || event.button === 0) pointerStart = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = (event) => {
    if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8) { pointerStart = null; return; }
    pointerStart = null;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(selectable, true)[0];
    const placementGroup = hit && findPlacementGroup(hit.object);
    const entity = placementGroup && entityById.get(placementGroup.userData.placementId);
    if (entity) inspectEntity(entity, { manual: true });
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  const tick = (timestamp) => {
    if (disposed) return;
    const delta = Math.min(.05, Math.max(0, (timestamp - lastFrame) / 1000));
    lastFrame = timestamp;
    const dx = buddy.group.position.x - previousPosition.x;
    const dz = buddy.group.position.z - previousPosition.z;
    const heading = Math.hypot(dx, dz) > .0001 ? Math.atan2(dx, dz) : null;
    const cameraHeading = Math.atan2(camera.position.x - buddy.group.position.x, camera.position.z - buddy.group.position.z);
    if (sleeping) sleepAvatar.update(timestamp / 1000);
    else avatar.update(buddy.state, timestamp / 1000, buddy.state === 'sit' ? cameraHeading : heading, delta);
    if (css2DRenderer && css2DAnchor) {
      scene.updateMatrixWorld(true);
      const activeAvatar = sleeping ? sleepAvatar.root : avatar.root;
      const activeBox = new THREE.Box3().setFromObject(activeAvatar, true);
      const anchorWorld = activeBox.getCenter(new THREE.Vector3());
      anchorWorld.y = activeBox.max.y + .05;
      buddy.group.worldToLocal(anchorWorld);
      css2DAnchor.position.copy(anchorWorld);
      css2DRenderer.render(scene, camera);
    }
    previousPosition.copy(buddy.group.position);
    travelExtents.minX = Math.min(travelExtents.minX, buddy.group.position.x);
    travelExtents.maxX = Math.max(travelExtents.maxX, buddy.group.position.x);
    travelExtents.minZ = Math.min(travelExtents.minZ, buddy.group.position.z);
    travelExtents.maxZ = Math.max(travelExtents.maxZ, buddy.group.position.z);
    overlayRoot.dataset.fireBuddyState = sleeping ? 'sleep' : buddy.state;
    overlayRoot.dataset.fireBuddyCompletedRoutes = String(buddy.group.userData.completedRoutes || 0);
    overlayRoot.dataset.fireBuddyTravelSpread = `${(travelExtents.maxX - travelExtents.minX).toFixed(2)},${(travelExtents.maxZ - travelExtents.minZ).toFixed(2)}`;
    if (pendingInspection && distance(buddy.group.position, pendingInspection.standAt) < .06) {
      const { entity, manual } = pendingInspection;
      const buddyScreen = buddy.group.position.clone().project(camera);
      const targetScreen = new THREE.Vector3(entity.target.x, entity.target.y, entity.target.z).project(camera);
      const pokeSide = targetScreen.x < buddyScreen.x ? -1 : 1;
      const reactionEntry = reactionCopies[reactionCopyIndex];
      reactionCopyIndex = (reactionCopyIndex + 1) % reactionCopies.length;
      buddy.hold(4400);
      avatar.react('furniture', { heading: cameraHeading, side: pokeSide, duration: 4.15 });
      overlayRoot.dataset.fireBuddyPokeSide = pokeSide < 0 ? 'left' : 'right';
      overlayRoot.dataset.fireBuddyReactionFacing = 'camera';
      buddy.prompt(reactionEntry.key, reactionEntry.message, { force: true });
      recentEntityIds = [...recentEntityIds.filter((id) => id !== entity.id), entity.id].slice(-4);
      overlayRoot.dataset.fireBuddyLastEntity = entity.id;
      overlayRoot.dataset.fireBuddyEntityHistory = recentEntityIds.join(',');
      overlayRoot.dataset.fireBuddyInspectionCount = String(Number(overlayRoot.dataset.fireBuddyInspectionCount || 0) + 1);
      pendingInspection = null;
      scheduleInspection();
    }
    if (pendingSleep && distance(buddy.group.position, pendingSleep.standAt) < .10) beginSleep(pendingSleep);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  scheduleCopy(1200);
  scheduleInspection(6200 + random() * 2600);
  if (restCandidates().length) scheduleSleep(12000 + random() * 5000);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimer(copyTimer);
    clearTimer(inspectTimer);
    clearTimer(sleepTimer);
    clearTimer(wakeTimer);
    if (frame !== null) cancelAnimationFrame(frame);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
    css2DResizeObserver?.disconnect();
    css2DObject?.removeFromParent();
    css2DAnchor?.removeFromParent();
    css2DRenderer?.dispose();
    css2DResizeObserver = null;
    css2DObject = null;
    css2DAnchor = null;
    css2DRenderer = null;
    avatar.dispose();
    sleepAvatar.dispose();
    buddy.dispose();
    transparentPixel.dispose();
    if (!wasStage) overlayRoot.classList.remove('fire-buddy-social-stage');
    if (packageBallNudge) {
      if (packageBallNudgeDisplay) packageBallNudge.style.setProperty('display', packageBallNudgeDisplay, packageBallNudgePriority);
      else packageBallNudge.style.removeProperty('display');
    }
    delete overlayRoot.dataset.fireBuddyMounted;
    delete overlayRoot.dataset.fireBuddyState;
    delete overlayRoot.dataset.fireBuddyTarget;
    delete overlayRoot.dataset.fireBuddyObstacleCount;
    delete overlayRoot.dataset.fireBuddyWaypointCount;
    delete overlayRoot.dataset.fireBuddyInspectionCount;
    delete overlayRoot.dataset.fireBuddyTravelSpread;
    delete overlayRoot.dataset.fireBuddyEntityHistory;
    delete overlayRoot.dataset.fireBuddyCompletedRoutes;
    delete overlayRoot.dataset.fireBuddyPathClear;
    delete overlayRoot.dataset.fireBuddyLastEntity;
    delete overlayRoot.dataset.fireBuddyLastCopy;
    delete overlayRoot.dataset.fireBuddyPokeSide;
    delete overlayRoot.dataset.fireBuddyReactionFacing;
    delete overlayRoot.dataset.fireBuddyRestFurnitureCount;
    delete overlayRoot.dataset.fireBuddyRestSurfaceCount;
    delete overlayRoot.dataset.fireBuddySleepCount;
    delete overlayRoot.dataset.fireBuddySleepTarget;
    delete overlayRoot.dataset.fireBuddySleepTargetKind;
    delete overlayRoot.dataset.fireBuddySleepingNear;
    delete overlayRoot.dataset.fireBuddySleepingOn;
    delete overlayRoot.dataset.fireBuddySleepSurfaceY;
    delete overlayRoot.dataset.fireBuddyBubblePositioning;
  };

  return { buddy, avatar, sleepAvatar, entities, inspectEntity, approachRestFurniture, dispose, get sleeping() { return sleeping; }, get disposed() { return disposed; } };
}
