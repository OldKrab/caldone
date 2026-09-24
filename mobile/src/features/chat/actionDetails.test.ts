import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionDetails } from './actionDetails.ts';
import type { ChatAction } from '../../domain/chat.ts';
import type { Meal } from '../../domain/meal.ts';

test('an updated portion shows its actual before and after values from the undo snapshots', () => {
  const before: Meal = { id: 'meal', revision: 1, capturedAt: 0, status: 'complete', note: '', photos: [], analysis: { title: 'Snack', mealType: 'snack', totals: { calories: 50, protein: 1, carbs: 5, fat: 3 }, items: [{ name: 'Chocolate', quantity: '10 g', calories: 50, protein: 1, carbs: 5, fat: 3 }] } };
  const after = structuredClone(before);
  after.analysis!.totals.calories = 75;
  after.analysis!.items[0].quantity = '15 g';
  const action: ChatAction = { id: 'a', threadId: 't', label: 'Updated', createdAt: 1, undone: false, undo: { kind: 'restore_meal', meal: before, expectedMeal: after } };
  const rows = actionDetails(action, 'en');
  assert.ok(rows.some((row) => row.before === '50 kcal' && row.after === '75 kcal'));
  assert.ok(rows.some((row) => row.before === '10 g' && row.after === '15 g'));
  assert.equal(rows.some((row) => row.label === 'Title'), false);
});
