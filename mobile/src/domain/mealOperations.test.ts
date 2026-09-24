import assert from 'node:assert/strict';
import test from 'node:test';

import type { Meal } from './meal.ts';
import { analysisFromItems, applyMealEdit, normalizeMealAnalysis, normalizeMealPhotos, summarizeNutrition } from './mealOperations.ts';
import { mealQuestions } from './mealQuestions.ts';

test('meal analysis totals are derived from its items', () => {
  assert.deepEqual(
    analysisFromItems({
      title: 'Lunch',
      mealType: 'lunch',
      items: [
        { name: 'Soup', quantity: '1 bowl', calories: 180, protein: 8, carbs: 24, fat: 6 },
        { name: 'Bread', quantity: '2 slices', calories: 150, protein: 5, carbs: 28, fat: 2 },
      ],
    }).totals,
    { calories: 330, protein: 13, carbs: 52, fat: 8 },
  );
});

test('normalizing model output replaces inconsistent totals without losing its question', () => {
  const normalized = normalizeMealAnalysis({
    title: 'Snack',
    mealType: 'snack',
    items: [{ name: 'Bar', quantity: '20 g', calories: 96, protein: 1, carbs: 12, fat: 5 }],
    totals: { calories: 245, protein: 4, carbs: 30, fat: 12 },
    clarification: { question: 'Was it one piece?', impactCalories: 149 },
  });

  assert.deepEqual(normalized.totals, { calories: 96, protein: 1, carbs: 12, fat: 5 });
  assert.deepEqual(mealQuestions(normalized.clarification), ['Was it one piece?']);
});

test('metadata and photo edits preserve a pending clarification', () => {
  const meal = {
    id: 'meal-1',
    revision: 4,
    capturedAt: 1_000,
    status: 'needs_input',
    note: 'Old note',
    photos: [
      { id: 'front', uri: 'front.jpg', mimeType: 'image/jpeg', createdAt: 900 },
      { id: 'side', uri: 'side.jpg', mimeType: 'image/jpeg', createdAt: 950 },
    ],
    analysis: {
      title: 'Lunch',
      mealType: 'lunch',
      items: [{ name: 'Soup', quantity: '1 bowl', calories: 180, protein: 8, carbs: 24, fat: 6 }],
      totals: { calories: 180, protein: 8, carbs: 24, fat: 6 },
      clarification: { question: 'How much cream?', impactCalories: 120 },
    },
  } as Meal;

  const edited = applyMealEdit(meal, { note: 'New note', removePhotoIds: ['side'] });

  assert.equal(edited.note, 'New note');
  assert.deepEqual(edited.photos.map((photo) => photo.id), ['front']);
  assert.deepEqual(edited.analysis?.clarification, meal.analysis?.clarification);
  assert.equal(edited.status, 'needs_input');
});

test('adding an already attached photo does not duplicate it', () => {
  const meal = mealAt('meal-1', 1_000, 100, 5);
  const photo = { id: 'front', uri: 'front.jpg', mimeType: 'image/jpeg', createdAt: 900 };
  meal.photos = [photo];

  const edited = applyMealEdit(meal, { addPhotos: [photo] });

  assert.deepEqual(edited.photos, [photo]);
});

test('nutrition summary groups known estimates and compares them with goals', () => {
  const meals = [
    mealAt('first', new Date(2026, 8, 1, 8).getTime(), 400, 20),
    mealAt('second', new Date(2026, 8, 1, 19).getTime(), 600, 30),
    mealAt('third', new Date(2026, 8, 2, 12).getTime(), 800, 40),
  ];

  const summary = summarizeNutrition(meals, {
    from: new Date(2026, 8, 1).getTime(),
    to: new Date(2026, 8, 2, 23, 59).getTime(),
    goals: { calories: 2_000, protein: 100 },
    groupByDay: true,
  });

  assert.deepEqual(summary.totals, { calories: 1_800, protein: 90, carbs: 0, fat: 0 });
  assert.equal(summary.mealCount, 3);
  assert.equal(summary.daysWithMeals, 2);
  assert.deepEqual(summary.averagePerLoggedDay, { calories: 900, protein: 45, carbs: 0, fat: 0 });
  assert.deepEqual(summary.goalDifferencePerLoggedDay, { calories: -1_100, protein: -55 });
  assert.deepEqual(summary.days.map((day) => day.totals.calories), [1_000, 800]);
});

test('legacy photos receive stable IDs and capture timestamps', () => {
  const photos = normalizeMealPhotos('meal-7', 123_000, [
    { uri: 'first.jpg', mimeType: 'image/jpeg' },
    { id: 'existing', uri: 'second.jpg', mimeType: 'image/jpeg', createdAt: 122_000 },
  ]);

  assert.deepEqual(photos, [
    { id: 'meal-7-photo-0', uri: 'first.jpg', mimeType: 'image/jpeg', createdAt: 123_000 },
    { id: 'existing', uri: 'second.jpg', mimeType: 'image/jpeg', createdAt: 122_000 },
  ]);
});

function mealAt(id: string, capturedAt: number, calories: number, protein: number): Meal {
  return {
    id,
    revision: 1,
    capturedAt,
    status: 'complete',
    note: '',
    photos: [],
    analysis: {
      title: id,
      mealType: 'lunch',
      items: [{ name: id, quantity: '1', calories, protein, carbs: 0, fat: 0 }],
      totals: { calories, protein, carbs: 0, fat: 0 },
    },
  };
}
