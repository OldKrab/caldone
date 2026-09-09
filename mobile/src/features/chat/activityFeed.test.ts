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

test('answered questions remain in chat history while the answer is processing and after resolution', () => {
  const question={role:'mealQuestion',mealId:'m',questions:['How large is the portion?'],timestamp:1};
  const answer={role:'chatUser',text:"I don't know. Stop asking.",attachments:[],timestamp:2};
  for(const busy of [true,false]) {
    const items=buildActivityFeed({messages:[question,answer] as any,actions:[],busy,
      answeringMealIds:new Set(busy?['m']:[]),pendingMealQuestions:{m:[]}});
    assert.deepEqual(items.filter(item=>item.kind==='message').map(item=>item.message),[question,answer]);
  }
});

test('only the latest unresolved question has answer controls; older questions stay readable', () => {
  const old={role:'mealQuestion',mealId:'m',questions:['How much?'],timestamp:1};
  const latest={...old,timestamp:3,questions:['How much?','Which sauce?']};
  const items=buildActivityFeed({messages:[old,latest] as any,actions:[],busy:false,pendingMealQuestions:{m:['Which sauce?']}});
  assert.equal(items.length,2);
  assert.deepEqual(items.map(item=>item.kind==='message'?item.activeQuestions:undefined),[[],['Which sauce?']]);
});

test('failed tool exposes returned reason without exposing successful tool payloads', () => {
  const items = feed([assistant([call('a'), call('b')]), {...result('a'),isError:true,content:[{type:'text',text:'Search could not be verified.'}]}, {...result('b'),content:[{type:'text',text:'Internal meal data'}]}]);
  assert.equal(items[0].kind, 'activity');
  if(items[0].kind === 'activity') {
    assert.equal(items[0].tools[0].error, 'Search could not be verified.');
    assert.equal(items[0].tools[1].error, undefined);
  }
});
