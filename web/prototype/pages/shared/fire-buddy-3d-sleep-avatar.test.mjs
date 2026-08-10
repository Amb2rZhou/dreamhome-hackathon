import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const moduleUrl=new URL('./fire-buddy-3d-sleep-avatar.js',import.meta.url);
const demoUrl=new URL('../fire-buddy-3d-sleep-demo.html',import.meta.url);

test('sleep avatar remains isolated and exposes lifecycle API',async()=>{
  const source=await readFile(moduleUrl,'utf8');
  assert.match(source,/export function createFireBuddy3DSleepAvatar/);
  assert.match(source,/return \{root,update,dispose/);
  assert.match(source,/base\.dispose\(\)/);
  assert.match(source,/const sleepyTwitch=Math\.sin\(time\*2\.55\)\*\.011\+Math\.sin\(time\*\.72\)\*\.006/);
  assert.match(source,/character\.scale\.set\(1-breathe\*\.006,1\+breathe\*\.014,1-breathe\*\.004\)/);
  assert.match(source,/leftArm\?\.position\.set\(-\.43,-\.79,\.70\)/);
  assert.match(source,/rightArm\.scale\.set\(\.96,\.79,1\.02\)/);
  assert.match(source,/rightFoot\?\.position\.set\(\.88,-\.85,\.04\)/);
  assert.match(source,/rightFoot\.rotation\.set\(\.02,Math\.PI\/2,-\.10\)/);
  assert.match(source,/leftFoot\.scale\.set\(1,\.76,\.96\)/);
  assert.match(source,/rightFoot\.scale\.set\(1,\.76,\.96\)/);
  assert.match(source,/for \(const part of awakeFaceParts\) part\.visible=false/);
});

test('sleep pose uses the established avatar as its visual source',async()=>{
  const source=await readFile(moduleUrl,'utf8');
  assert.match(source,/import \{ createFireBuddy3DAvatar \}/);
  assert.match(source,/createFireBuddy3DAvatar\(\{THREE,scale:1\}\)/);
  assert.match(source,/makeClosedEye/);
  assert.match(source,/Math\.sin\(time\*1\.35\)/);
});

test('standalone demo imports only the isolated sleep module',async()=>{
  const source=await readFile(demoUrl,'utf8');
  assert.match(source,/createFireBuddy3DSleepAvatar/);
  assert.doesNotMatch(source,/my-home\/index\.html|chat\/index\.html/);
});
