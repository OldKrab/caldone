import assert from 'node:assert/strict';
import { test } from 'node:test';
import { questionTool } from './questionTool.ts';
import { buildActivityFeed } from '../features/chat/activityFeed.ts';

test('a question tool result renders selectable answers and becomes inactive after a user reply', async () => {
  const questions = [{ question: 'Which meal?', options: ['Breakfast today', 'Dinner yesterday'] }];
  const result = await questionTool.execute('ask-1', { questions });
  const messages: any[] = [
    { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'ask-1', name: 'ask_question', arguments: { questions } }] },
    { role: 'toolResult', timestamp: 2, toolCallId: 'ask-1', isError: false, ...result },
  ];
  // A serialized result is the same contract used by durable chat history.
  const restored = JSON.parse(JSON.stringify(messages));
  assert.deepEqual(buildActivityFeed({ messages: restored, actions: [], busy: false }), [
    { kind: 'question', key: 'question-ask-1', questions, active: true },
  ]);
  assert.equal((buildActivityFeed({ messages: restored, actions: [], busy: true })[0] as any).active, false);
  restored.push({ role: 'chatUser', timestamp: 3, text: 'Which meal?\nBreakfast today', attachments: [] });
  assert.equal((buildActivityFeed({ messages: restored, actions: [], busy: false })[0] as any).active, false);
  assert.match(JSON.stringify(result.content), /No answer has been given/);
});

test('unfinished and failed question calls never offer actionable answers', () => {
  const message: any = { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'ask-1', name: 'ask_question', arguments: { questions: [{ question: 'Q?', options: ['Yes', 'No'] }] } }] };
  assert.equal(buildActivityFeed({ messages: [], streamingMessage: message, busy: true, actions: [] })[0].kind, 'activity');
  const failure: any = { role: 'toolResult', timestamp: 2, toolCallId: 'ask-1', isError: true };
  assert.equal(buildActivityFeed({ messages: [message, failure], busy: false, actions: [] })[0].kind, 'activity');
});

test('invalid question choices fail instead of silently presenting a single default', async () => {
  await assert.rejects(questionTool.execute('ask-1', { questions: [{ question: 'Q?', options: ['Yes', ' Yes '] }] }), /at least two distinct/);
});
