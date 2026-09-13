import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, meals, chat, processor, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';

test('an unknown answer before the first estimate cannot mark nonexistent nutrition as estimated', async () => {
  const meal = await meals.createMeal({ id: 'unknown-answer', capturedAt: 1, note: 'Unknown food', photos: [] });
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('What food is it?')]
    : [toolOutput('ask_question', { questions: [{ question: 'What food is it?', options: ['Rice', 'Pasta'] }] }, 'unknown-question')];
  await processor.processMeal(meal.id);
  const current = (await meals.getMeal(meal.id))!, question = current.questions![0];
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Cannot estimate an unidentified food.')]
    : [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: current.revision,
      resolutions: [{ id: question.id, state: 'answered', answer: 'Not sure', uncertain: true }],
    }, 'unknown-answer-save')];
  await processor.answerMealClarification(meal.id, 'Not sure', [{ questionId: question.id, answer: 'Not sure' }]);
  const saved = (await meals.getMeal(meal.id))!;
  assert.equal(saved.status, 'needs_input');
  assert.equal(saved.analysis, undefined);
  assert.equal(saved.questions![0].state, 'answered');
  assert.equal(saved.questions![0].uncertain, true);
  assert.ok(await chat.preferredMealThread(meal.id, false));
});

test('a completed capture response without an estimate leaves no phantom background analysis', async () => {
  const meal = await meals.createMeal({ id: 'prose-only', capturedAt: 1, note: 'Food is unclear', photos: [] });
  fixture.respond = async () => [textOutput('There is not enough information to identify the food.')];
  await processor.processMeal(meal.id);
  assert.equal((await meals.getMeal(meal.id))!.status, 'needs_input');
  assert.ok(!(await meals.listProcessableMeals()).some(m => m.id === meal.id));
});
