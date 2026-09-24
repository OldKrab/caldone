import assert from 'node:assert/strict';
import test from 'node:test';

import { macroGoalRows } from './homeSummary.ts';

test('home macro summary pairs eaten amounts with every calculated goal', () => {
  assert.deepEqual(
    macroGoalRows(
      { calories: 270, protein: 3, carbs: 30, fat: 15 },
      { calories: 2_280, protein: 100, carbs: 280, fat: 70 },
    ),
    [
      { key: 'protein', current: 3, goal: 100 },
      { key: 'carbs', current: 30, goal: 280 },
      { key: 'fat', current: 15, goal: 70 },
    ],
  );
});
