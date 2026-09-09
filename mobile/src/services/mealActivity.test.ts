import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMealActivityDetails, setMealActivity } from './mealActivity.ts';

test('activity records only observed transitions and clears on completion', () => {
  setMealActivity('progress-test', 'reviewing_meal');
  const start = getMealActivityDetails('progress-test')!;
  setMealActivity('progress-test', 'reviewing_meal');
  setMealActivity('progress-test', 'web_search');
  const next = getMealActivityDetails('progress-test')!;
  assert.equal(next.startedAt, start.startedAt);
  assert.deepEqual(next.stages, ['reviewing_meal', 'web_search']);
  assert.deepEqual(start.stages, ['reviewing_meal']);
  setMealActivity('progress-test');
  assert.equal(getMealActivityDetails('progress-test'), undefined);
});
