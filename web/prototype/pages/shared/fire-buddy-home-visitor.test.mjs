import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { classifyFireBuddyRestFurniture, isFireBuddyFriendChatEntry, requiresFurnitureGesture } from './fire-buddy-home-visitor.js';

test('buddy mounts only for a locked home entered from a friend chat card', () => {
  assert.equal(isFireBuddyFriendChatEntry('?home=h1&mode=locked&source=friend-share&friend=amber'), true);
  assert.equal(isFireBuddyFriendChatEntry('?home=h1&mode=locked&source=friend-share'), false);
  assert.equal(isFireBuddyFriendChatEntry('?home=h1&mode=locked&friend=amber'), false);
  assert.equal(isFireBuddyFriendChatEntry('?home=h1&mode=edit&source=friend-share&friend=amber'), false);
});

test('referential copy always requires a furniture gesture', () => {
  const gestureEntries = [
    { key: 'furniture', message: '主人快看，这个也太可爱了吧！' },
    { key: 'recommend', message: '它和我们家也很搭，要不要看看怎么搭呀？' },
    { key: 'try', message: '主人，把它搬回我们家试试看嘛！' }
  ];
  for (const entry of gestureEntries) assert.equal(requiresFurnitureGesture(entry), true);
  assert.equal(requiresFurnitureGesture({ key: 'enter', message: '主人主人，我好喜欢这个房子呀！' }), false);
  assert.equal(requiresFurnitureGesture({ key: 'explore', message: '这里有好多好看的东西，我们逛逛嘛～' }), false);
});

test('rest strategy recognizes only furniture suitable for sleeping', () => {
  assert.equal(classifyFireBuddyRestFurniture('云朵双人床', '卧室家具'), 'bed');
  assert.equal(classifyFireBuddyRestFurniture('奶油模块沙发', '客厅家具'), 'sofa');
  assert.equal(classifyFireBuddyRestFurniture('Chaise lounge', 'chair'), 'sofa');
  assert.equal(classifyFireBuddyRestFurniture('餐桌', '桌几'), null);
  assert.equal(classifyFireBuddyRestFurniture('地毯', '软装'), null);
});

test('home visitor switches models and releases sleep resources', async () => {
  const source = await readFile(new URL('./fire-buddy-home-visitor.js', import.meta.url), 'utf8');
  assert.match(source, /createFireBuddy3DSleepAvatar/);
  assert.match(source, /sleepAvatar\.root\.visible = true/);
  assert.match(source, /overlayRoot\.dataset\.fireBuddyState = 'sleep'/);
  assert.match(source, /fireBuddySleepCount/);
  assert.match(source, /sleepAvatar\.dispose\(\)/);
  assert.match(source, /packageBallNudge\?\.style\.setProperty\('display', 'none', 'important'\)/);
});

test('sleep strategy approaches semantic furniture through safe navigation', async () => {
  const source = await readFile(new URL('./fire-buddy-home-visitor.js', import.meta.url), 'utf8');
  assert.match(source, /const approach = reachableStandPoint\(entity\)/);
  assert.match(source, /buddy\.walkTo\(approach\.point\)/);
  assert.match(source, /if \(restCandidates\(\)\.length\) scheduleSleep/);
  assert.match(source, /buddy\.group\.position\.set\(entity\.sleepSurface\.x, entity\.sleepSurface\.y, entity\.sleepSurface\.z\)/);
  assert.match(source, /entities\.filter\(\(entity\) => entity\.restKind && entity\.sleepSurface\)/);
  assert.match(source, /function findRestSurface\(THREE, group\)/);
  assert.match(source, /score: area \/ \(1 \+ Math\.max\(0, size\.y - \.62\) \* \.8\)/);
  assert.match(source, /box\.max\.y > 1\.20/);
});

test('furniture reaction faces the camera and pokes toward screen left or right', async () => {
  const source = await readFile(new URL('./fire-buddy-home-visitor.js', import.meta.url), 'utf8');
  assert.match(source, /const cameraHeading = Math\.atan2\(camera\.position\.x - buddy\.group\.position\.x/);
  assert.match(source, /const pokeSide = targetScreen\.x < buddyScreen\.x \? -1 : 1/);
  assert.match(source, /avatar\.react\('furniture', \{ heading: cameraHeading, side: pokeSide/);
  assert.match(source, /fireBuddyReactionFacing = 'camera'/);
  assert.match(source, /duration: 4\.15/);
});
