import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, meals, processor, rice, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';

test('queued text meals use the agent without requiring image input', async () => {
  await meals.createMeal({ id: 'text-only', capturedAt: 1, note: 'Rice, 100 g', photos: [] });
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Saved rice.')]
    : [toolOutput('edit_meal', { mealId: 'text-only', expectedRevision: 1, title: 'Rice', mealType: 'lunch', items: [rice] }, 'text-save')];
  await processor.processPendingMeals();
  const saved = (await meals.getMeal('text-only'))!;
  assert.equal(saved.status, 'complete');
  assert.equal(saved.analysis!.totals.calories, 130);
  assert.ok(fixture.requests[0].input.some((item: any) => JSON.stringify(item).includes('Rice, 100 g')));
  assert.ok(!fixture.requests[0].input.some((item: any) => JSON.stringify(item).includes('input_image')));
});
