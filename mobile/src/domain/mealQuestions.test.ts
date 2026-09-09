import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mealQuestions, normalizeClarification } from './mealQuestions.ts';

test('meal analysis accepts several material clarification questions', () => {
  const clarification = normalizeClarification({
    questions: ['How large was the bowl?', 'Was cream added?'],
    impactCalories: 160,
  });

  assert.deepEqual(mealQuestions(clarification), ['How large was the bowl?', 'Was cream added?']);
});

test('legacy single-question meals remain readable', () => {
  assert.deepEqual(mealQuestions({ question: 'Was cream added?', impactCalories: 90 }), ['Was cream added?']);
});
