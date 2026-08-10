import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('furniture poke selects a lateral arm and never reaches through depth', async () => {
  const source = await readFile(new URL('./fire-buddy-3d-avatar.js', import.meta.url), 'utf8');
  assert.match(source, /reactionSide=Number\(options\.side\)<0\?-1:1/);
  assert.match(source, /const pokingArm=reactionSide<0\?leftArm:rightArm/);
  assert.match(source, /pokingArm\.position\.set\(reactionSide\*\(\.84\+\.48\*reach\),-\.38,\.10\+\.08\*reach\)/);
  assert.doesNotMatch(source, /rightArm\.position\.set\(\.84,-\.38,\.05\+1\.08\*reach\)/);
  assert.match(source, /\(time-reactionStarted\)\/reactionDuration/);
});
