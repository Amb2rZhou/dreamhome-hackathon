import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecommendationEngine, parseIntentWithRules } from './recommendations.mjs';

const recommend = await createRecommendationEngine();

test('rule parser extracts replacement intent and preferences', () => {
  const intent = parseIntentWithRules('给书房换一个白色现代办公椅');
  assert.equal(intent.mode, 'replacement');
  assert.equal(intent.room, 'study');
  assert.equal(intent.targetCategory, '办公椅');
  assert.deepEqual(intent.colors, ['白色']);
  assert.deepEqual(intent.styles, ['现代']);
});

test('proactive recommendation reuses the 178-item AUG11 catalog', async () => {
  const result = await recommend({ mode: 'proactive', limit: 5 });
  assert.equal(result.catalogSize, 178);
  assert.equal(result.clarificationRequired, false);
  assert.equal(result.items.length, 5);
  assert.ok(result.items.every((item) => typeof item.trialAvailable === 'boolean'));
});

test('replacement is same-category and excludes selected and seen items', async () => {
  const first = await recommend({ mode: 'replacement', selectedItemId: 'ast_00e00df1bfeb', limit: 4 });
  assert.ok(first.items.length > 0);
  assert.ok(first.items.every((item) => item.category === '单椅'));
  assert.ok(first.items.every((item) => item.id !== 'ast_00e00df1bfeb'));
  const second = await recommend({ mode: 'replacement', selectedItemId: 'ast_00e00df1bfeb', seenItemIds: first.items.map((item) => item.id), limit: 4 });
  assert.ok(second.items.every((item) => !first.items.some((seen) => seen.id === item.id)));
});

test('missing replacement target asks a clarification question', async () => {
  const result = await recommend({ query: '帮我换一个更合适的' });
  assert.equal(result.clarificationRequired, true);
  assert.match(result.clarificationQuestion, /哪一件家具/);
  assert.deepEqual(result.items, []);
});
