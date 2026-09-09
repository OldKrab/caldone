import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultNutritionUnits, displayEnergy, displayWeight, parsePreference } from './preferences.ts';

test('converts stored kcal and grams only for display', () => {
  assert.ok(Math.abs(displayEnergy(100, { energy: 'kj', weight: 'g' }) - 418.4) < 0.00001);
  assert.ok(Math.abs(displayWeight(28.3495, { energy: 'kcal', weight: 'oz' }) - 1) < 0.00001);
});

test('falls back safely when a persisted preference is malformed', () => {
  assert.deepEqual(parsePreference('{bad json', defaultNutritionUnits), defaultNutritionUnits);
  assert.deepEqual(parsePreference('{"energy":"kj"}', defaultNutritionUnits), { energy: 'kj', weight: 'g' });
});
