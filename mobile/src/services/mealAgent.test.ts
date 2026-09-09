import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, meals, chat } from '../test/mealAgentFixture.ts';
const {answerMealClarification, processPendingMeals} = await import('./mealProcessor.ts');

const initial = {
  title: 'Минтай с рисом и сырным соусом', mealType: 'dinner' as const,
  items: [{name: 'Минтай с рисом', quantity: '1 порция', calories: 400, protein: 30, carbs: 40, fat: 13}],
  totals: {calories: 400, protein: 30, carbs: 40, fat: 13},
  clarification: {questions: ['Что было в стакане?', 'Какой это был сырный соус?'], impactCalories: 200},
};


const {analyzeMeal} = await import('../ai/piClient.ts');
const {createCalDoneTools} = await import('../ai/chatTools.ts');
const call = (name: string, args: unknown, id: string) => [{type: 'function_call', id, call_id: id, name, arguments: JSON.stringify(args), status: 'completed'}];

test.before(async () => {
  await meals.saveMealRecord({id: 'previous', revision: 1, capturedAt: 1, status: 'complete', note: 'Тонкий слой сметаны',
    photos: [{id: 'previous-photo', uri: 'file:///previous.jpg', mimeType: 'image/jpeg', createdAt: 1}], analysis: {...initial, clarification: undefined}});
});
test.beforeEach(() => { fixture.requests = []; fixture.enabled = false; });

test('meal analysis uses the chat tool loop to find an earlier meal, read its note and inspect its photo', async () => {

  fixture.respond = async () => {
    switch (fixture.requests.length) {
      case 1: return call('search_meals', {query: 'Минтай'}, 'search-previous');
      case 2: return call('get_meal', {mealId: 'previous'}, 'read-previous');
      case 3: return call('view_meal_photos', {mealId: 'previous'}, 'photo-previous');
      default: return {...initial, clarification: undefined};
    }
  };
  const result = await analyzeMeal({mealId: 'current', photos: [{base64: 'Y3VycmVudA==', mimeType: 'image/jpeg'}], note: 'Как в прошлый раз', language: 'Russian'});
  assert.equal(fixture.requests.length, 4, 'analysis must execute local tools and continue with their results');
  assert.deepEqual(fixture.requests[0].tools.filter((tool: any) => tool.type === 'function').map((tool: any) => tool.name).sort(),
    createCalDoneTools({threadId: 'test', attachments: new Map(), getMessages: () => [], onDataChanged: async () => {}}).map(tool => tool.name).sort());
  const finalRequest = JSON.stringify(fixture.requests.at(-1).input);
  assert.ok(finalRequest.includes('Тонкий слой сметаны'));
  assert.ok(finalRequest.includes('data:image/jpeg;base64,cHJldmlvdXM='));
  assert.ok(finalRequest.includes('data:image/jpeg;base64,Y3VycmVudA=='));
  assert.equal(JSON.parse(result.text).title, initial.title);
});

test('reading an earlier meal exposes original clarification answers to the analysis', async () => {
  const thread = await chat.ensureClarificationThread('previous', initial.title);
  await chat.syncMealQuestionsToThread(thread.id, 'previous', ['Что было в стакане?']);
  await chat.appendInlineMealAnswer(thread.id, 'Молоко, выпил целиком');
  fixture.requests = [];
  fixture.respond = async () => fixture.requests.length === 1
    ? call('get_meal', {mealId: 'previous'}, 'read-answers')
    : {...initial, clarification: undefined};
  await analyzeMeal({mealId: 'current', photos: [], note: 'Та же еда, что в прошлый раз', language: 'Russian'});
  const request = JSON.stringify(fixture.requests.at(-1).input);
  assert.ok(request.includes('Молоко, выпил целиком'), 'saved nutrition is not a substitute for the original answer');
});

test('plain text in a meal chat answers its pending question and recalculates the meal', async () => {
  const {openChatSession} = await import('./chatSession.ts');
  await meals.saveMealRecord({id: 'plain-answer', revision: 1, capturedAt: Date.now(), status: 'needs_input', note: initial.title, photos: [], analysis: initial});
  const thread = await chat.ensureClarificationThread('plain-answer', initial.title);
  await chat.syncMealQuestionsToThread(thread.id, 'plain-answer', initial.clarification.questions);
  fixture.requests = [];
  fixture.respond = async () => ({...initial, title: 'Минтай со сметаной, рис и молоко', clarification: undefined});
  const snapshots: any[] = [];
  const session = await openChatSession({thread, selectedMealId: 'plain-answer', onChanged: snapshot => snapshots.push(snapshot), onDataChanged: async () => {}});
  try {
    await session.send('Молоко, выпил. На минтае сметана', []);
    assert.equal((await meals.getMeal('plain-answer'))?.status, 'complete', 'ordinary composer text must be applied as the pending answer');
    assert.equal(fixture.requests.length, 1, 'no separate routing or confirmation model call is needed');
    const saved = await chat.loadChatMessages(thread.id);
    assert.equal(saved.filter(message => message.role === 'chatUser' && message.text === 'Молоко, выпил. На минтае сметана').length, 1);
    assert.equal(snapshots.at(-1).busy, false);
  } finally { await session.close(); }
});

test('a plain estimate answer confirms the saved meal without unrelated search diagnostics', async () => {
  const {openChatSession} = await import('./chatSession.ts');
  await meals.saveMealRecord({id: 'quiet-estimate', revision: 1, capturedAt: Date.now(), status: 'needs_input', photos: [], note: initial.title, analysis: initial});
  const thread = await chat.ensureClarificationThread('quiet-estimate', initial.title);
  await chat.syncMealQuestionsToThread(thread.id, 'quiet-estimate', initial.clarification.questions);
  fixture.enabled = true;
  fixture.respond = async () => ({...initial, clarification: undefined});
  const session = await openChatSession({thread, selectedMealId: 'quiet-estimate', onChanged: () => {}, onDataChanged: async () => {}});
  try {
    await session.send('I do not care about those details. Just use a reasonable estimate and finish logging this meal. Please do not ask any more questions.', []);
    assert.equal((await meals.getMeal('quiet-estimate'))?.status, 'complete');
    const messages = await chat.loadChatMessages(thread.id);
    const confirmation = messages.findLast(message => message.role === 'assistant');
    assert.ok(confirmation?.role === 'assistant');
    const text = confirmation.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    assert.match(text, /400/);
    assert.doesNotMatch(text, /web|search|веб|поиск/i);
  } finally { await session.close(); }
});


test('a later answer retains earlier milk and sauce answers, while background recovery cannot replace the active request', async () => {
  await meals.saveMealRecord({id: 'answer-history', revision: 1, capturedAt: Date.now(), status: 'needs_input', photos: [], note: initial.title, analysis: initial});
  fixture.requests = [];
  let started!: () => void;
  let finish!: () => void;
  const arrived = new Promise<void>(resolve => { started = resolve; });
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  fixture.respond = async () => {
    started();
    await waiting;
    return {...initial, clarification: {questions: ['Какой марки был соус?'], impactCalories: 120}};
  };
  const first = answerMealClarification('answer-history', 'Молоко, выпил. На минтае тонкий слой сметаны');
  await arrived;
  try {
    await processPendingMeals();
    assert.equal(fixture.requests.length, 1, 'background recovery must not start an analysis without the active answer');
  } finally { finish(); await first; }
  fixture.respond = async () => ({...initial, clarification: undefined});
  await answerMealClarification('answer-history', 'Heinz');
  const request = JSON.stringify(fixture.requests.at(-1).input);
  assert.ok(request.includes('Молоко, выпил. На минтае тонкий слой сметаны'));
  assert.ok(request.includes('Heinz'));
  assert.equal((await meals.getMeal('answer-history'))?.status, 'complete');
});

test('failed plain answers can be retried after reopening without duplicating the answer', async () => {
  const {openChatSession} = await import('./chatSession.ts');
  await meals.saveMealRecord({id: 'retry-answer', revision: 1, capturedAt: Date.now(), status: 'needs_input', photos: [], note: initial.title, analysis: initial});
  const thread = await chat.ensureClarificationThread('retry-answer', initial.title);
  await chat.syncMealQuestionsToThread(thread.id, 'retry-answer', initial.clarification.questions);
  const snapshots: any[] = [];
  const options = {thread, selectedMealId: 'retry-answer', onChanged: (snapshot: any) => snapshots.push(snapshot), onDataChanged: async () => {}};
  let session = await openChatSession(options);
  fixture.respond = async () => ({title: 'Invalid estimate'});
  try {
    await assert.rejects(session.send('Молоко, сметана', []), /invalid meal result/);
    assert.equal((await meals.getMeal('retry-answer'))?.status, 'needs_input');
    assert.equal(snapshots.at(-1).busy, false);
    assert.match(snapshots.at(-1).error, /invalid meal result/);
    await session.close();
    session = await openChatSession(options);
    assert.match(snapshots.at(-1).error, /invalid meal result/, 'a reopened chat must show the failed answer and offer retry');
    fixture.respond = async () => ({...initial, clarification: undefined});
    await session.retry();
    assert.equal((await meals.getMeal('retry-answer'))?.status, 'complete');
    assert.equal(snapshots.at(-1).error, undefined);
    assert.equal((await chat.loadChatMessages(thread.id)).filter(message => message.role === 'chatUser' && message.text === 'Молоко, сметана').length, 1);
  } finally { await session.close(); }
});

test('analysis keeps completed chat evidence and reopens its photos without forwarding the unfinished parent call', async () => {
  const {mealRequestContext} = await import('../ai/mealRequestContext.ts');
  const assistant = (content: any[]) => ({role: 'assistant', content, api: fixture.model.api, provider: fixture.model.provider, model: fixture.model.id,
    stopReason: 'toolUse', timestamp: 2, usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}});
  const context = mealRequestContext([
    {role: 'chatUser', text: 'Сравни с предыдущим блюдом', attachments: [], timestamp: 1},
    assistant([{type: 'toolCall', id: 'opened-photo', name: 'view_meal_photos', arguments: {mealId: 'previous'}}]),
    {role: 'toolResult', toolCallId: 'opened-photo', toolName: 'view_meal_photos', isError: false, timestamp: 3,
      content: [{type: 'image', data: 'cHJldmlvdXM=', mimeType: 'image/jpeg'}], details: {mealId: 'previous', photoIds: ['previous-photo']}},
    {role: 'chatUser', text: 'Да, пересчитай', attachments: [], timestamp: 4},
    assistant([{type: 'toolCall', id: 'unfinished-parent', name: 'reanalyze_meal', arguments: {mealId: 'handoff-context'}}]),
  ] as any);
  fixture.requests = [];
  fixture.respond = async () => ({...initial, clarification: undefined});
  await analyzeMeal({mealId: 'handoff-context', photos: [], note: 'Пересчёт', language: 'Russian', conversation: context.conversation});
  const input = JSON.stringify(fixture.payload.input);
  assert.ok(input.includes('Сравни с предыдущим блюдом'));
  assert.ok(input.includes('data:image/jpeg;base64,cHJldmlvdXM='));
  assert.ok(!input.includes('unfinished-parent'));
  assert.equal((await chat.listChatThreads()).some(thread => thread.mealId === 'handoff-context'), false,
    'inference must not create an empty visible chat before there is a question or conversation');
});

test('meal context includes its regular conversations as well as clarification answers', async () => {
  const clarification = await chat.ensureClarificationThread('previous', initial.title);
  await chat.appendInlineMealAnswer(clarification.id, 'Молоко, выпил целиком');
  const regular = await chat.createChatThread({mealId: 'previous', purpose: 'meal'});
  await chat.appendInlineMealAnswer(regular.id, 'В рис добавил сливочное масло');
  const unrelated = await chat.createChatThread({mealId: 'unrelated', purpose: 'meal'});
  await chat.appendInlineMealAnswer(unrelated.id, 'UNRELATED_CONVERSATION');
  fixture.requests = [];
  fixture.respond = async () => fixture.requests.length === 1
    ? call('get_meal', {mealId: 'previous'}, 'read-all-conversations') : {...initial, clarification: undefined};
  await analyzeMeal({mealId: 'read-history', photos: [], note: 'Та же еда', language: 'Russian'});
  let input = JSON.stringify(fixture.payload.input);
  assert.ok(input.includes('Молоко, выпил целиком'));
  assert.ok(input.includes('В рис добавил сливочное масло'), 'regular meal conversations are also evidence');
  assert.ok(!input.includes('UNRELATED_CONVERSATION'));
  fixture.respond = async () => ({...initial, clarification: undefined});
  await analyzeMeal({mealId: 'previous', photos: [], note: 'Пересчитай', language: 'Russian'});
  input = JSON.stringify(fixture.payload.input);
  assert.ok(input.includes('Молоко, выпил целиком'));
  assert.ok(input.includes('В рис добавил сливочное масло'));
  assert.ok(!input.includes('UNRELATED_CONVERSATION'));
});


test('analysis resumes a connection failure with completed tools and search evidence intact', async () => {
  fixture.requests = [];
  fixture.enabled = true;
  fixture.respond = async () => {
    switch (fixture.requests.length) {
      case 1: return [{type: 'web_search_call', id: 'web', status: 'completed', action: {sources: [{url: 'https://source.test/meal', title: 'Meal'}]}},
        ...call('get_meal', {mealId: 'previous'}, 'before-network-failure')];
      case 2: return new Response('data: ' + JSON.stringify({type: 'response.failed', response: {error: {message: 'Network request failed'}}}) + '\n\n',
        {headers: {'content-type': 'text/event-stream'}});
      default: return {...initial, clarification: undefined};
    }
  };
  try {
    const result = await analyzeMeal({mealId: 'network-resume', photos: [], note: 'Погугли и сравни', requireSearch: true, language: 'Russian'});
    assert.equal(fixture.requests.length, 3);
    assert.deepEqual(fixture.requests[0].tool_choice, {type: 'web_search'});
    assert.equal(fixture.requests[2].tool_choice, 'auto');
    assert.ok(JSON.stringify(fixture.requests[2].input).includes('Тонкий слой сметаны'));
    assert.equal(result.research.status, 'completed');
    assert.equal(result.research.sources[0].url, 'https://source.test/meal');
  } finally { fixture.enabled = false; }
});

test('an analysis cannot commit intermediate mutations and cancellation preserves the saved meal', async () => {
  const before = await meals.getMeal('previous');
  fixture.requests = [];
  fixture.respond = async () => fixture.requests.length === 1
    ? call('delete_meal', {mealId: 'previous', expectedRevision: before!.revision}, 'mid-analysis-delete')
    : {...initial, clarification: undefined};
  await analyzeMeal({mealId: 'deferred-write', photos: [], note: 'Оцени еду', language: 'Russian'});
  assert.deepEqual(await meals.getMeal('previous'), before, 'the caller owns committing the estimate after a successful analysis');
  assert.equal(fixture.requests.length, 2, 'the same agent loop receives and handles the tool error');

  await meals.saveMealRecord({id: 'cancel-answer', revision: 1, capturedAt: Date.now(), status: 'needs_input', photos: [], note: initial.title, analysis: initial});
  let arrived!: () => void;
  let finish!: () => void;
  const started = new Promise<void>(resolve => { arrived = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  fixture.respond = async () => { arrived(); await pending; return {...initial, clarification: undefined}; };
  const controller = new AbortController();
  const answer = answerMealClarification('cancel-answer', 'Молоко', undefined, controller.signal);
  await started;
  controller.abort();
  try {
    await assert.rejects(answer, /cancelled/);
    assert.equal((await meals.getMeal('cancel-answer'))?.status, 'needs_input');
    assert.equal((await meals.getMeal('cancel-answer'))?.analysis?.title, initial.title);
  } finally { finish(); }
  fixture.respond = async () => ({...initial, clarification: undefined});
  await answerMealClarification('cancel-answer', 'Молоко, выпил');
  assert.equal((await meals.getMeal('cancel-answer'))?.status, 'complete');
});


test('successive plain answers consume remaining selectable questions and then return to normal chat', async () => {
  const {openChatSession} = await import('./chatSession.ts');
  await meals.saveMealRecord({id: 'successive-answers', revision: 1, capturedAt: Date.now(), status: 'needs_input', photos: [], note: initial.title, analysis: initial});
  const thread = await chat.ensureClarificationThread('successive-answers', initial.title);
  await chat.syncMealQuestionsToThread(thread.id, 'successive-answers', initial.clarification.questions);
  const snapshots: any[] = [];
  const session = await openChatSession({thread, selectedMealId: 'successive-answers', onChanged: snapshot => snapshots.push(snapshot), onDataChanged: async () => {}});
  fixture.requests = [];
  const remaining = {question: 'Какой марки был соус?', options: ['Heinz', 'Другая марка']};
  fixture.respond = async () => fixture.requests.length === 1
    ? call('ask_question', {questions: [remaining]}, 'ask-brand')
    : {...initial, clarification: {questions: [remaining.question], choices: [remaining], impactCalories: 120}};
  try {
    await session.send('Молоко, выпил. Покупной сырный соус', []);
    assert.equal((await meals.getMeal('successive-answers'))?.status, 'needs_input');
    assert.ok(snapshots.at(-1).messages.some((message: any) => message.role === 'mealQuestion' && message.questions.includes(remaining.question)));
    fixture.respond = async () => ({...initial, clarification: undefined});
    await session.send('Heinz', []);
    const complete = await meals.getMeal('successive-answers');
    assert.equal(complete?.status, 'complete');
    const earlierRequest = JSON.stringify(fixture.payload.input);
    assert.ok(earlierRequest.includes('Молоко, выпил. Покупной сырный соус'));
    assert.ok(earlierRequest.includes('Heinz'));
    fixture.respond = async () => [{type: 'message', id: 'normal-chat', status: 'completed', role: 'assistant', content: [{type: 'output_text', text: 'Пожалуйста!', annotations: []}]}];
    await session.send('Спасибо', []);
    assert.deepEqual(await meals.getMeal('successive-answers'), complete, 'a completed meal must no longer consume ordinary chat text as a clarification');
    assert.equal(snapshots.at(-1).messages.at(-1).content[0].text, 'Пожалуйста!');
  } finally { await session.close(); }
});


test('a failed required search cannot be disabled when the same meal is retried', async () => {
  const id = 'required-retry';
  const analysis = {...initial, clarification: undefined};
  await meals.saveMealRecord({id, revision: 1, capturedAt: Date.now(), status: 'complete', note: initial.title, photos: [], analysis});
  const thread = await chat.createChatThread({mealId: id, purpose: 'meal'});
  const messages: any[] = [{role: 'chatUser', text: 'Recalculate with reasonable portions and oil.', timestamp: 1, attachments: []}];
  const tools = createCalDoneTools({threadId: thread.id, getMessages: () => messages, attachments: new Map(), onDataChanged: async () => {}});
  const reanalyze = tools.find(tool => tool.name === 'reanalyze_meal')!;
  const args = {mealId: id, expectedRevision: 1, requireSearch: true};
  messages.push({role: 'assistant', content: [{type: 'toolCall', id: 'require-first', name: 'reanalyze_meal', arguments: args}]});
  fixture.enabled = true;
  fixture.respond = async () => analysis;
  await assert.rejects(reanalyze.execute('require-first', args), /[Rr]ead.*meal.*again.*web search.*required/);
  messages.push({role: 'toolResult', toolCallId: 'require-first', toolName: 'reanalyze_meal', isError: true, content: [{type: 'text', text: 'Search could not be verified'}]});
  const unchanged = await meals.getMeal(id);
  assert.deepEqual(unchanged!.analysis, analysis, 'failed research must preserve saved nutrition');
  assert.equal(unchanged!.revision, 3, 'entering and leaving analysis advances the revision');
  await assert.rejects(reanalyze.execute('require-stale', args), /meal changed.*Read it again/);
  await assert.rejects(tools.find(tool => tool.name === 'edit_meal')!.execute('bypass-research',
    {mealId: id, expectedRevision: unchanged!.revision, items: analysis.items}), /research and recalculate/);

  await assert.rejects(reanalyze.execute('require-retry', {mealId: id, expectedRevision: unchanged!.revision, requireSearch: false}), /search could not be verified/);
  fixture.respond = async () => [
    {type: 'web_search_call', id: 'verified-search', status: 'completed', action: {sources: [{url: 'https://source.test/nutrition', title: 'Nutrition'}]}},
    {type: 'message', id: 'verified-estimate', status: 'completed', role: 'assistant', content: [{type: 'output_text', text: JSON.stringify(analysis), annotations: []}]},
  ];
  const current = await meals.getMeal(id);
  const result: any = await reanalyze.execute('require-verified', {mealId: id, expectedRevision: current!.revision, requireSearch: false});
  assert.equal(result.details.value.research.status, 'completed');
  assert.match(result.details.value.confirmation, /https:\/\/source.test\/nutrition/);

});


test('required research is preserved when reanalysis falls back to a manually entered meal', async () => {
  const id = 'manual-research';
  await meals.saveMealRecord({id, revision: 1, capturedAt: Date.now(), status: 'complete', note: '', photos: [], analysis: {...initial, clarification: undefined}});
  const thread = await chat.createChatThread({mealId: id, purpose: 'meal'});
  const tools = createCalDoneTools({threadId: thread.id, attachments: new Map(), onDataChanged: async () => {},
    getMessages: () => [{role: 'chatUser', text: 'Recalculate with reasonable portions.', timestamp: 1, attachments: []}]});
  fixture.enabled = true;
  fixture.respond = async () => ({...initial, clarification: undefined});
  await assert.rejects(tools.find(tool => tool.name === 'reanalyze_meal')!.execute('manual-required',
    {mealId: id, expectedRevision: 1, requireSearch: true, interpretation: 'Use typical portions'}), /search could not be verified/);
});
