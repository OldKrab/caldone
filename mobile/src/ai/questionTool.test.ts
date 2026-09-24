import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chat } from '../testing/mealAgentTestContext.ts';
const { createQuestionTools } = await import('./questionTool.ts');
import { buildActivityFeed } from '../features/chat/activityFeed.ts';

test('saved questions remain actionable after discussion and become inactive only after explicit resolution', async () => {
  const thread = await chat.createChatThread({ title: 'Choices' });
  const tools = createQuestionTools({ threadId: thread.id, onDataChanged: async () => {} });
  const ask = tools.find(t => t.name === 'ask_question')!;
  const result = await ask.execute('ask-1', { questions: [{ question: 'Which meal?', options: ['Breakfast', 'Dinner'] }] });
  const questions = (result.details as any).questions;
  const messages: any[] = [{ role: 'chatUser', text: 'Why do you need that?', attachments: [], timestamp: 3 }];
  const feed = buildActivityFeed({ messages, actions: [], busy: false, questions });
  assert.equal((feed.at(-1) as any).active, true);
  assert.equal((buildActivityFeed({ messages, actions: [], busy: true, questions }).find(item => item.kind === 'question') as any).active, false);
  const resolution = await tools.find(t => t.name === 'resolve_questions')!.execute('resolve-1', {
    resolutions: [{ id: questions[0].id, state: 'answered', answer: 'Dinner' }],
  });
  assert.equal(buildActivityFeed({ messages, actions: [], busy: false, questions: (resolution.details as any).questions }).some(item => item.kind === 'question'), false);
  assert.match(JSON.stringify(result.content), /no answer has been supplied/);
});

test('unfinished and failed question calls never offer actionable answers', () => {
  const message: any = { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'ask-1', name: 'ask_question', arguments: { questions: [{ question: 'Q?', options: ['Yes', 'No'] }] } }] };
  assert.equal(buildActivityFeed({ messages: [], streamingMessage: message, busy: true, actions: [], questions: [] })[0].kind, 'activity');
  const failure: any = { role: 'toolResult', timestamp: 2, toolCallId: 'ask-1', isError: true };
  assert.equal(buildActivityFeed({ messages: [message, failure], busy: false, actions: [], questions: [] })[0].kind, 'activity');
});

test('invalid choices fail without creating a saved question', async () => {
  const thread = await chat.createChatThread({ title: 'Invalid choices' });
  const tools = createQuestionTools({ threadId: thread.id, onDataChanged: async () => {} });
  await assert.rejects(tools[0].execute('invalid', { questions: [{ question: 'Q?', options: ['Yes', ' Yes '] }] }), /distinct/);
  assert.deepEqual((await tools[1].execute('read', {})).details, { questions: [] });
});
