import assert from 'node:assert/strict';
import test from 'node:test';
import type { Meal } from '../domain/meal.ts';
import { requestMealReanalysis } from './mealReanalysis.ts';

const meal: Meal = {
  id: 'text-meal', revision: 1, capturedAt: 1, status: 'complete',
  photos: [], note: 'Two eggs and toast',
};

test('a saved text meal can be reanalyzed without photos', async () => {
  const queued: Meal[] = [];
  assert.equal(await requestMealReanalysis(meal, async value => { queued.push(value); }), 'started');
  assert.deepEqual(queued, [meal]);
});

test('rapid requests from either screen share one retry until processing finishes', async () => {
  let finish!: () => void;
  const processing = new Promise<void>(resolve => { finish = resolve; });
  const first = requestMealReanalysis(meal, () => processing);
  try {
    assert.equal(await requestMealReanalysis(meal, async () => assert.fail('duplicate retry')), 'busy');
  } finally { finish(); }
  assert.equal(await first, 'started');
  assert.equal(await requestMealReanalysis(meal, async () => {}), 'started');
});

test('queued work, active analysis and answer submission cannot be restarted', async () => {
  const unexpected = async () => assert.fail('busy meal was retried');
  for (const status of ['queued', 'analyzing'] as const) {
    assert.equal(await requestMealReanalysis({ ...meal, status }, unexpected), 'busy');
  }
  assert.equal(await requestMealReanalysis(meal, unexpected, true), 'busy');
});

test('photo-only meals can restart, but empty input is explained without queuing work', async () => {
  const photoMeal = { ...meal, note: '', photos: [{ id: 'photo', uri: 'saved.jpg', mimeType: 'image/jpeg', createdAt: 1 }] };
  assert.equal(await requestMealReanalysis(photoMeal, async () => {}), 'started');
  assert.equal(await requestMealReanalysis({ ...meal, note: ' \n ' }, async () => assert.fail('empty meal was retried')), 'missing_input');
});

test('a failed retry releases ownership so the user can try again', async () => {
  await assert.rejects(requestMealReanalysis(meal, async () => { throw Error('storage unavailable'); }), /storage unavailable/);
  assert.equal(await requestMealReanalysis(meal, async () => {}), 'started');
});
