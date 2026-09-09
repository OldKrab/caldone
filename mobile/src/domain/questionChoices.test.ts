import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatQuestionAnswers, normalizeQuestionChoices } from './questionChoices.ts';
import { mealQuestionChoices, normalizeClarification } from './mealQuestions.ts';

test('model choices are trimmed, deduplicated, bounded and matched to actual meal questions', () => {
  const clarification = normalizeClarification({
    questions: [' How much? ', 'Which sauce?'], impactCalories: 150,
    choices: [
      { question: ' How much? ', options: [' 100 g ', '200 g', '100 g', '', 42] },
      { question: 'Not a pending question', options: ['Yes', 'No'] },
      { question: 'Which sauce?', options: ['Only one choice'] },
    ],
  });
  assert.deepEqual(clarification?.choices, [{ question: 'How much?', options: ['100 g', '200 g'] }]);
  assert.deepEqual(mealQuestionChoices(clarification), [
    { question: 'How much?', options: ['100 g', '200 g'] },
    { question: 'Which sauce?', options: [] },
  ]);
  assert.equal(normalizeQuestionChoices([{ question: 'Q', options: Array.from({ length: 10 }, (_, i) => `${i}`) }])[0].options.length, 6);
  assert.deepEqual(normalizeQuestionChoices([null, {}, { question: 'Q', options: ['Yes', 'Yes'] }]), []);
});

test('legacy and missing choices keep the original question readable', () => {
  assert.deepEqual(mealQuestionChoices({ question: 'Was cream added?', impactCalories: 90 }), [
    { question: 'Was cream added?', options: [] },
  ]);
  assert.deepEqual(mealQuestionChoices(undefined), []);
});

test('only explicitly answered questions are submitted with their context', () => {
  const questions = [{ question: 'How much?', options: ['100 g', '200 g'] }, { question: 'Cream?', options: ['Yes', 'No'] }];
  assert.equal(formatQuestionAnswers(questions, {}), '');
  assert.equal(formatQuestionAnswers(questions, { 'How much?': '200 g', unrelated: 'Ignore this' }), 'How much?\n200 g');
  assert.equal(formatQuestionAnswers(questions, { 'How much?': ' About 175 g ', 'Cream?': 'Not sure' }), 'How much?\nAbout 175 g\n\nCream?\nNot sure');
  assert.equal(formatQuestionAnswers([{ question: '__proto__', options: [] }], {}), '');
});
