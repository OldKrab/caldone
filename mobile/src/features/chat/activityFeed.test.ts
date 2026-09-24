import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildActivityFeed } from './activityFeed.ts';

const call = (id: string) => ({ type: 'toolCall', id, name: 'get_meal', arguments: { statusText: 'Read meal' } });
const assistant = (content: unknown[], timestamp = 1) => ({ role: 'assistant', content, timestamp });
const result = (id: string) => ({ role: 'toolResult', toolCallId: id, isError: false, timestamp: 2 });
const feed = (messages: unknown[], streamingMessage?: unknown, busy = false, toolExecutions = {}) => buildActivityFeed({ messages, streamingMessage, busy, actions: [], toolExecutions } as any);

test('consecutive calls across internal messages form one stable activity group', () => {
  const first = feed([assistant([call('a')]), result('a')]);
  const next = feed([assistant([call('a')]), result('a')], assistant([call('b')], 3), true);
  assert.equal(next.length, 1);
  assert.equal(next[0].key, first[0].key);
  assert.equal(next[0].kind, 'activity');
  if (next[0].kind === 'activity') assert.deepEqual(next[0].tools.map(tool => tool.call.id), ['a', 'b']);
});

test('streamed arguments stay hidden until execution and cannot rename a running action', () => {
  const partial = assistant([{ ...call('a'), arguments: { statusText: 'Read m' } }]);
  const preparing = feed([], partial, true)[0];
  assert.equal(preparing.kind, 'activity');
  if (preparing.kind === 'activity') {
    assert.equal(preparing.tools[0].status, 'preparing');
    assert.deepEqual(preparing.tools[0].call.arguments, {});
  }
  const running = feed([], partial, true, { a: { status: 'running', arguments: { statusText: 'Read meal' } } })[0];
  if (running.kind === 'activity') {
    assert.equal(running.tools[0].status, 'running');
    assert.equal(running.tools[0].call.arguments.statusText, 'Read meal');
  }
});

test('text and new user turns break groups, but results do not; receipts stay visible', () => {
  const items = buildActivityFeed({ messages: [assistant([call('a')]), result('a'), assistant([{ type: 'text', text: 'Found meal' }, call('b')], 4), { role: 'chatUser', text: 'Next', attachments: [], timestamp: 5 }, assistant([call('c')], 6)] as any, actions: [{ id: 'receipt', createdAt: 3 }] as any, busy: true });
  assert.deepEqual(items.map(item => item.kind), ['activity', 'action', 'message', 'activity', 'message', 'activity']);
  if (items[3].kind === 'activity') assert.equal(items[3].tools[0].status, 'cancelled');
});

test('an aborted tool is cancelled, not reported as a failed action', () => {
  const items = feed([assistant([call('a')]), { ...result('a'), isError: true }], undefined, false, { a: { status: 'cancelled', arguments: { statusText: 'Read meal' } } });
  if (items[0].kind === 'activity') assert.equal(items[0].tools[0].status, 'cancelled');
});

test('resolved questions disappear even when appended after the correction reply', () => {
  const messages = [assistant([{ type: 'text', text: 'Bottle saved; dessert excluded' }]), { role: 'mealQuestion', mealId: 'drink', questions: ['Send label', 'Which dessert?'], timestamp: 2 }];
  const input = { messages, actions: [], busy: false, pendingMealQuestions: { drink: [] } };
  const items = buildActivityFeed(input as any);
  assert.equal(items.length, 1);
  assert.equal(messages.length, 2, 'history remains intact');
  const restored = buildActivityFeed({ ...input, pendingMealQuestions: { drink: ['Send label'] } } as any);
  assert.equal(restored.length, 2);
  assert.deepEqual((restored[1] as any).message.questions, ['Send label']);
});

test('a hosted search uses the same activity group and replaces the generic waiting indicator', () => {
  const items = buildActivityFeed({
    messages: [assistant([call('read')]), result('read')],
    actions: [], busy: true, mealActivity: 'thinking',
    providerActivities: [{id: 'search', name: 'web_search', status: 'active', messageIndex: 2, blockIndex: 0}],
  } as any) as any[];
  assert.deepEqual(items.map(item => item.kind), ['activity']);
  assert.deepEqual(items[0].tools.map((tool: any) => [tool.call.name, tool.status]), [['get_meal', 'completed'], ['web_search', 'running']]);
});

test('hosted work stays between surrounding prose and appears once before an empty streaming response', () => {
  const input = {messages: [assistant([{type: 'text', text: 'I will look it up.'}]), assistant([], 3)],
    actions: [], busy: true, providerActivities: [{id: 'search', name: 'web_search', status: 'active', messageIndex: 1, blockIndex: 0}]};
  const items = buildActivityFeed(input as any);
  assert.deepEqual(items.map(item => item.kind), ['message', 'activity']);
  assert.equal(items.flatMap(item => item.kind === 'activity' ? item.tools : []).length, 1);
});

test('persisted questions remain actionable after unrelated chat and close by ID across every rendering',()=>{
  const questions=[
    {id:'portion',mealId:'meal',question:'How much?',options:['100 g','200 g'],state:'open',createdAt:1},
    {id:'sauce',mealId:'meal',question:'Which sauce?',options:['None','Mayo'],state:'answered',answer:'None',createdAt:1},
  ];
  const input={messages:[assistant([{type:'toolCall',id:'ask-old',name:'ask_question',arguments:{}}]),
    {...result('ask-old'),details:{questions}},
    {role:'chatUser',text:'Why are you asking?',attachments:[],timestamp:3},
    assistant([{type:'text',text:'To estimate the portion.'}],4)],questions,actions:[],busy:false};
  const rendered=buildActivityFeed(input as any).filter(item=>item.kind==='question');
  assert.equal(rendered.length,1);
  assert.equal(rendered[0].active,true);
  assert.deepEqual(rendered[0].questions.map(q=>q.id),['portion']);
  const finished=buildActivityFeed({...input,questions:questions.map(q=>({...q,state:'answered'}))} as any);
  assert.equal(finished.filter(item=>item.kind==='question').length,0);
});
