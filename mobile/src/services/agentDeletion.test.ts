import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, meals, chat, sessions, savedMeal, rice, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';

test('deleting a conversation during inference prevents late meal edits and orphaned messages', async () => {
  const meal = await savedMeal('deleted-thread');
  const thread = await chat.ensureMealThread(meal.id, 'Lunch');
  const session = await sessions.openChatSession({ thread, selectedMealId: meal.id, onChanged() {}, onDataChanged: async () => {} });
  fixture.respond = async payload => {
    if (payload.input.at(-1)?.type === 'function_call_output') return [textOutput('Conversation was deleted.')];
    await chat.deleteChatThread(thread.id);
    return [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision,
      items: [{ ...rice, calories: 999 }],
    }, 'deleted-thread-edit')];
  };
  await session.send('Update to 999 kcal', []).catch(() => undefined);
  await session.close();
  assert.deepEqual(await meals.getMeal(meal.id), meal);
  assert.deepEqual(await chat.loadChatMessages(thread.id), []);
  assert.deepEqual(await chat.listChatActions(thread.id), []);
});
