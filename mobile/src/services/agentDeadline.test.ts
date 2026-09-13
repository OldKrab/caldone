import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, meals, conversation, savedMeal, rice, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';

test('a timed-out provider cannot execute late mutations even when its transport ignores abort', async t => {
  const before = await savedMeal('late-provider');
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  fixture.respond = async payload => {
    if (payload.input.at(-1)?.type === 'function_call_output') return [textOutput('Too late.')];
    started.resolve(); await release.promise;
    return [toolOutput('edit_meal', { mealId: before.id, expectedRevision: before.revision,
      items: [{ ...rice, calories: 999 }],
    }, 'late-mutation')];
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sending = conversation.sendMealMessage(before.id, 'Change the calories to 999').then(() => undefined, error => error);
  await started.promise;
  t.mock.timers.tick(180_001);
  release.resolve();
  const error = await sending;
  assert.match(String(error), /timed out/);
  assert.deepEqual(await meals.getMeal(before.id), before);
});
