import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, meals, processor, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';

test('a background identity question notifies the user even before the first nutrition estimate', async () => {
  await meals.createMeal({ id: 'question-notification', capturedAt: 1, note: 'Unknown food', photos: [] });
  fixture.appState.currentState = 'background';
  fixture.notificationPermission = true;
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('What food is it?')]
    : [toolOutput('ask_question', { questions: [{ question: 'What food is it?', options: ['Rice', 'Pasta'] }] }, 'identity-notification')];
  try {
    await processor.processMeal('question-notification');
    assert.equal(fixture.notifications.length, 1);
    assert.deepEqual((fixture.notifications[0] as any).content.data, { mealId: 'question-notification' });
    assert.equal((fixture.notifications[0] as any).content.body, 'What food is it?');
    assert.equal((await meals.getMeal('question-notification'))!.analysis, undefined);
  } finally { fixture.appState.currentState = 'active'; }
});
