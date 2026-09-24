import assert from 'node:assert/strict';
import test from 'node:test';

import { Agent } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';

import { acquireChatSessionLease, subscribeToChatAgent } from './chatAgentEvents.ts';

test('completed reply becomes idle while slow session persistence continues', async () => {
  const faux = createFauxCore({ tokensPerSecond: 10_000 });
  faux.setResponses([fauxAssistantMessage('Hello')]);
  const agent = new Agent({
    initialState: { model: faux.getModel() },
    streamFn: faux.streamSimple,
  });
  let releasePersistence!: () => void;
  const persistence = new Promise<void>((resolve) => { releasePersistence = resolve; });
  const unsubscribe = subscribeToChatAgent(agent, async (event) => {
    if (event.type === 'message_end') await persistence;
  });

  const outcome = await Promise.race([
    agent.prompt('Hi').then(() => 'idle'),
    new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 100)),
  ]);

  assert.equal(outcome, 'idle');
  assert.equal(agent.state.isStreaming, false);
  releasePersistence();
  unsubscribe();
});

test('reopening a conversation waits for its previous session to release ownership', async () => {
  const releaseFirst = await acquireChatSessionLease('thread-1');
  let secondOpened = false;
  const second = acquireChatSessionLease('thread-1').then((release) => {
    secondOpened = true;
    return release;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(secondOpened, false);

  releaseFirst();
  const releaseSecond = await second;
  assert.equal(secondOpened, true);
  releaseSecond();
});
