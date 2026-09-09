import assert from 'node:assert/strict';
import test from 'node:test';

import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, parseCalDoneBackup, planBackupMerge, summarizeBackup } from './backup.ts';

const meal = {
  id: 'meal-1', revision: 2, capturedAt: 1_700_000_000_000, status: 'complete', note: '',
  photos: [{ mimeType: 'image/jpeg', base64: 'YWJj' }],
  analysis: {
    title: 'Soup', mealType: 'lunch', items: [{ name: 'Soup', quantity: '1 bowl', calories: 200, protein: 8, carbs: 25, fat: 7 }],
    totals: { calories: 200, protein: 8, carbs: 25, fat: 7 },
  },
};

test('parses the current versioned CalDone backup format', () => {
  const backup = parseCalDoneBackup({
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-09-04T10:00:00.000Z',
    preferences: { goals: { calories: 2_000 }, units: { energy: 'kcal', weight: 'g' } },
    meals: [meal],
    conversations: [],
  });

  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.schemaVersion, BACKUP_SCHEMA_VERSION);
  assert.equal(backup.meals[0]?.analysis?.title, 'Soup');
});

test('backup round trips addition clarification boundaries and rejects invalid item counts', () => {
  const dishAddition = { originalItemCount: 0, photoIds: ['dish-photo'], note: 'Extra soup' };
  const data = {
    format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: '2026-09-04T10:00:00.000Z',
    preferences: {}, conversations: [],
    meals: [{ ...meal, analysis: { ...meal.analysis, dishAddition, clarification: { questions: ['How much?'], impactCalories: 150 } } }],
  };
  assert.deepEqual(parseCalDoneBackup(data).meals[0].analysis?.dishAddition, dishAddition);
  dishAddition.originalItemCount = 2;
  assert.throws(() => parseCalDoneBackup(data), /Invalid dish addition item boundary/);
});

test('summarizes restorable meal and chat photos before import', () => {
  const backup = parseCalDoneBackup({
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-09-04T10:00:00.000Z',
    preferences: {},
    meals: [meal],
    conversations: [{
      thread: { id: 'chat-1', title: 'Soup', createdAt: 1, updatedAt: 2 },
      messages: [{ role: 'chatUser', text: 'What is this?', timestamp: 2, attachments: [{ id: 'photo-1', mimeType: 'image/png', base64: 'ZGVm' }] }],
      actions: [],
    }],
  });

  assert.deepEqual(summarizeBackup(backup), { meals: 1, conversations: 1, photos: 2 });
});

test('preserves meal-analysis questions embedded in conversation history', () => {
  const backup = parseCalDoneBackup({
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-09-04T10:00:00.000Z',
    preferences: {},
    meals: [],
    conversations: [{
      thread: { id: 'chat-1', title: 'Soup', createdAt: 1, updatedAt: 2, mealId: 'meal-1', purpose: 'clarification' },
      messages: [{ role: 'mealQuestion', mealId: 'meal-1', questions: ['How much?', 'Which sauce?'], timestamp: 2 }],
      actions: [],
    }],
  });

  assert.deepEqual(backup.conversations[0]?.messages[0], {
    role: 'mealQuestion', mealId: 'meal-1', questions: ['How much?', 'Which sauce?'], timestamp: 2,
  });
});

test('rejects unrelated or malformed JSON before import', () => {
  assert.throws(() => parseCalDoneBackup({ format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: 'today', preferences: {}, meals: [{ id: 'broken' }] }), /Invalid/);
  assert.throws(() => parseCalDoneBackup({ format: 'other-app', schemaVersion: 1, exportedAt: 'today', preferences: {}, meals: [] }), /Unsupported backup format/);
});

test('merge planning never overwrites meals or conversations already on the device', () => {
  const backup = parseCalDoneBackup({
    format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-09-04T10:00:00.000Z', preferences: {}, meals: [meal],
    conversations: [{ thread: { id: 'chat-1', title: '', createdAt: 1, updatedAt: 1 }, messages: [], actions: [] }],
  });

  const plan = planBackupMerge(backup, new Set(['meal-1']), new Set(['chat-1']));

  assert.deepEqual(plan.meals, []);
  assert.deepEqual(plan.conversations, []);
  assert.equal(plan.skippedMeals, 1);
  assert.equal(plan.skippedConversations, 1);
});

test('imports a pre-rename backup including meal and conversation photos', () => {
  const backup = parseCalDoneBackup({
    format: 'calodone-backup', schemaVersion: 1,
    exportedAt: '2026-09-05T10:00:00.000Z',
    preferences: { goals: { calories: 2280 }, locale: 'ru' },
    meals: [meal],
    conversations: [{
      thread: { id: 'old-chat', title: 'Soup', createdAt: 1, updatedAt: 2 },
      messages: [{ role: 'chatUser', text: 'Photo', timestamp: 2, attachments: [{ mimeType: 'image/png', base64: 'ZGVm' }] }],
      actions: [],
    }],
  });
  assert.equal(backup.format, 'caldone-backup');
  assert.equal(backup.meals[0].photos[0].base64, 'YWJj');
  assert.deepEqual(summarizeBackup(backup), { meals: 1, conversations: 1, photos: 2 });
  assert.equal(backup.preferences.goals?.calories, 2280);
});
