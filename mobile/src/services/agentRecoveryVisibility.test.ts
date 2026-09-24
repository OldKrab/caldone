import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, chat, sessions, textOutput } from '../testing/mealAgentTestContext.ts';
const { beginAgentTurn } = await import('../data/agentTurnRepository.ts');

test('reopening an interrupted general conversation exposes Retry and resumes the accepted input once', async () => {
  const thread = await chat.createChatThread({ title: 'Interrupted general chat' });
  await beginAgentTurn(thread.id, undefined, { role: 'chatUser', id: 'accepted-before-crash',
    text: 'Explain nutrition totals', timestamp: 1, attachments: [], source: 'chat',
  });
  let snapshot: any;
  const session = await sessions.openChatSession({ thread, onChanged: value => { snapshot = value; }, onDataChanged: async () => {} });
  assert.ok(snapshot.error, 'the persisted turn must have a visible recovery action, even without an assistant error message');
  fixture.respond = async () => [textOutput('Here is the explanation.')];
  await session.retry();
  assert.equal(snapshot.error, undefined);
  await session.close();
  assert.equal((await chat.loadChatMessages(thread.id)).filter(m => m.role === 'chatUser').length, 1);
});
