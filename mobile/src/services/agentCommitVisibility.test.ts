import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, chat, meals, sessions, savedMeal, rice, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';
import type { ChatSessionSnapshot } from './chatSession.ts';

test('a screen refresh failure cannot report an already committed edit as a failed mutation', async () => {
  const meal = await savedMeal('refresh-after-commit');
  const thread = await chat.ensureMealThread(meal.id, 'Lunch');
  let snapshot!: ChatSessionSnapshot;
  const session = await sessions.openChatSession({ thread, selectedMealId: meal.id,
    onChanged: value => { snapshot = value; },
    onDataChanged: async () => { throw new Error('Screen refresh unavailable'); },
  });
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Saved.')]
    : [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision,
      title: 'Corrected lunch', items: [{ ...rice, calories: 180 }],
    }, 'committed-before-refresh')];
  try {
    await session.send('Correct this meal', []);
    assert.equal((await meals.getMeal(meal.id))!.analysis!.title, 'Corrected lunch');
    const result = snapshot.messages.find(message => message.role === 'toolResult' && message.toolCallId === 'committed-before-refresh');
    assert.equal(result?.role === 'toolResult' && result.isError, false);
    assert.equal(snapshot.error, undefined);
    assert.equal((await chat.listChatActions(thread.id)).length, 1);
    assert.ok((await meals.listDiagnosticEvents()).some(event => event.operation === 'observer_error' && event.threadId === thread.id));
  } finally { await session.close(); }
});
