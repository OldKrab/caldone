import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, client, meals, chat, conversation, savedMeal, rice, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';

for (const scenario of ['observed', 'ignored', 'disabled'] as const) {
  test(`agent nutrition search: ${scenario}`, async () => {
    const meal = await savedMeal(`search-${scenario}`);
    await client.setWebSearchEnabled('openai-codex', scenario !== 'disabled');
    fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
      ? [textOutput('Search result handled.')]
      : [...(scenario === 'observed' ? [{ type: 'web_search_call', id: 'search-1', status: 'completed',
          action: { sources: [{ url: 'https://source.example/rice', title: 'Rice' }] } }] : []),
        toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision, items: [{ ...rice, calories: 140 }] }, `search-${scenario}`)];
    await conversation.sendMealMessage(meal.id, 'Найди в интернете и уточни калорийность');
    const saved = (await meals.getMeal(meal.id))!;
    const thread = (await chat.preferredMealThread(meal.id, false))!;
    const result = (await chat.loadChatMessages(thread.id)).find(m => m.role === 'toolResult' && m.toolName === 'edit_meal') as any;
    if (scenario === 'ignored') {
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /search could not be verified/);
      assert.equal(saved.revision, meal.revision);
    } else {
      assert.equal(result.isError, false);
      assert.equal(saved.analysis!.research?.status, scenario === 'observed' ? 'completed' : 'unavailable');
      assert.equal(saved.analysis!.totals.calories, 140);
    }
    assert.equal(fixture.requests[0].tools.some((t: any) => t.type === 'web_search'), scenario !== 'disabled');
  });
}

test('provider search evidence survives an SSE response without a Content-Type header', async () => {
  const meal = await savedMeal('missing-content-type');
  await client.setWebSearchEnabled('openai-codex', true);
  fixture.omitSseContentType = true;
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Saved with verified search.')]
    : [{ type: 'web_search_call', id: 'headerless-search', status: 'completed',
      action: { sources: [{ url: 'https://source.example/rice', title: 'Rice nutrition' }] } },
      toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision, items: [{ ...rice, calories: 140 }] }, 'headerless-save')];
  try {
    await conversation.sendMealMessage(meal.id, 'Погугли калорийность и обнови запись');
    const saved = (await meals.getMeal(meal.id))!;
    assert.equal(saved.analysis!.research?.status, 'completed');
    assert.equal(saved.analysis!.research!.sources[0].url, 'https://source.example/rice');
  } finally { fixture.omitSseContentType = false; }
});
