import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, client, chat, meals, sessions, savedMeal, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';
import { buildActivityFeed } from '../features/chat/activityFeed.ts';
import type { ChatSessionSnapshot } from './chatSession.ts';

test('search and local tools share the timeline while the next model response is pending', async () => {
  const meal = await savedMeal('activity-timeline');
  await client.setWebSearchEnabled('openai-codex', true);
  const thread = await chat.ensureMealThread(meal.id, 'Lunch');
  let snapshot!: ChatSessionSnapshot;
  let release!: () => void;
  let arrived!: () => void;
  const nextRequest = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const session = await sessions.openChatSession({ thread, selectedMealId: meal.id,
    onChanged: value => { snapshot = value; }, onDataChanged: async () => {} });
  let request = 0;
  fixture.respond = async () => {
    if (++request === 1) return [
      { type: 'web_search_call', id: 'nutrition-search', status: 'completed', action: { type: 'search', sources: [] } },
      toolOutput('get_meal', { mealId: meal.id }, 'read-after-search'),
    ];
    arrived();
    await gate;
    return [textOutput('Here is the explanation.')];
  };
  const sending = session.send('Explain the nutrition', []);
  try {
    await nextRequest;
    const feed = buildActivityFeed(snapshot);
    const activity = feed.filter(item => item.kind === 'activity');
    assert.deepEqual(activity.flatMap(item => item.tools.map(tool => tool.call.name)), ['web_search', 'get_meal']);
    assert.equal(activity.length, 1, 'search belongs to the same group as adjacent local tools');
    assert.ok(activity[0].tools.every(tool => tool.status === 'completed'));
    const progress = feed.filter(item => item.kind === 'progress');
    assert.deepEqual(progress.map(item => item.activity.stage), ['thinking']);
  } finally {
    release();
    await sending;
    await session.close();
    await client.setWebSearchEnabled('openai-codex', false);
  }
});

test('separate searches remain distinct and keep their place after reopening the conversation', async () => {
  const meal = await savedMeal('search-history');
  await client.setWebSearchEnabled('openai-codex', true);
  const thread = await chat.ensureMealThread(meal.id, 'Lunch');
  let snapshot!: ChatSessionSnapshot;
  let session = await sessions.openChatSession({ thread, selectedMealId: meal.id,
    onChanged: value => { snapshot = value; }, onDataChanged: async () => {} });
  let request = 0;
  fixture.respond = async () => ++request <= 2 ? [
    { type: 'web_search_call', id: 'provider-reuses-this-id', status: 'completed', action: {type: 'search', sources: []} },
    toolOutput('get_meal', {mealId: meal.id}, `read-${request}`),
  ] : [textOutput('Two sources checked.')];
  try {
    await session.send('Compare the sources', []);
    const toolNames = () => buildActivityFeed(snapshot).flatMap(item => item.kind === 'activity' ? item.tools.map(tool => tool.call.name) : []);
    assert.deepEqual(toolNames(), ['web_search', 'get_meal', 'web_search', 'get_meal']);
    await session.close();
    session = await sessions.openChatSession({ thread, selectedMealId: meal.id,
      onChanged: value => { snapshot = value; }, onDataChanged: async () => {} });
    assert.deepEqual(toolNames(), ['web_search', 'get_meal', 'web_search', 'get_meal']);
    fixture.respond = async () => [textOutput('You are welcome.')];
    await session.send('Thanks', []);
    assert.deepEqual(toolNames(), ['web_search', 'get_meal', 'web_search', 'get_meal'], 'a new message must not erase completed search history');
    assert.ok(!JSON.stringify(fixture.requests).includes('caldoneProviderActivities'), 'UI metadata must not be sent as model input');
  } finally { await session.close(); await client.setWebSearchEnabled('openai-codex', false); }
});

test('Stop marks an in-flight hosted search as interrupted, not successfully completed', async () => {
  const meal = await savedMeal('search-stop');
  await client.setWebSearchEnabled('openai-codex', true);
  const thread = await chat.ensureMealThread(meal.id, 'Lunch');
  let snapshot!: ChatSessionSnapshot;
  const active = Promise.withResolvers<void>();
  const originalFetch = fixture.fetch;
  fixture.fetch = async (_url, init) => {
    if (String(_url).includes('/codex/models?')) return originalFetch(_url, init);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({type: 'response.output_item.added', output_index: 0,
        item: {type: 'web_search_call', id: 'unfinished-search', status: 'in_progress'},
      }) + '\n\n'));
      init.signal?.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), {once: true});
    } }), {headers: {'content-type': 'text/event-stream'}});
  };
  const session = await sessions.openChatSession({ thread, selectedMealId: meal.id,
    onChanged: value => { snapshot = value; if (value.providerActivities.some(a => a.status === 'active')) active.resolve(); },
    onDataChanged: async () => {},
  });
  const sending = session.send('Look it up', []);
  try {
    await active.promise;
    const live = buildActivityFeed(snapshot);
    assert.equal(live.filter(item => item.kind === 'progress').length, 0);
    assert.equal(snapshot.mealActivity, 'web_search', 'the diary must show the same actual stage as the chat');
    session.abort();
    await sending;
    const tools = buildActivityFeed(snapshot).flatMap(item => item.kind === 'activity' ? item.tools : []);
    assert.equal(tools.find(tool => tool.call.name === 'web_search')?.status, 'cancelled');
  } finally { session.abort(); await sending.catch(() => undefined); await session.close(); fixture.fetch = originalFetch;
    await client.setWebSearchEnabled('openai-codex', false); }
});

test('an accepted form is replaced by its sent answer while the model is still processing', async () => {
  const meal = await savedMeal('accepted-form-activity');
  await meals.saveMealRecord({ ...meal, status: 'needs_input', questions: [
    { id: 'form-oil', mealId: meal.id, question: 'How much oil?', options: ['None', '5 g'], state: 'open', createdAt: 1 },
  ] });
  const thread = await chat.ensureMealThread(meal.id, 'Lunch');
  let snapshot!: ChatSessionSnapshot;
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const session = await sessions.openChatSession({ thread, selectedMealId: meal.id,
    onChanged: value => { snapshot = value; }, onDataChanged: async () => {} });
  fixture.respond = async () => { started.resolve(); await gate.promise; return [textOutput('Your answer is being considered.')]; };
  const sending = session.send('5 g', [], { source: 'form', questionAnswers: [{ questionId: 'form-oil', answer: '5 g' }] });
  try {
    await started.promise;
    assert.equal((await chat.loadChatMessages(thread.id)).filter(message => message.role === 'chatUser').length, 1);
    assert.equal((await meals.getMeal(meal.id))!.questions![0].state, 'open', 'acceptance does not pretend the agent has resolved the question');
    const feed = buildActivityFeed(snapshot);
    assert.equal(feed.filter(item => item.kind === 'question').length, 0, 'the accepted form must disappear before the model finishes');
    assert.equal(feed.filter(item => item.kind === 'message' && item.message.role === 'chatUser').length, 1);
    assert.equal(feed.filter(item => item.kind === 'progress').length, 1);
  } finally { gate.resolve(); await sending; await session.close(); }
});
