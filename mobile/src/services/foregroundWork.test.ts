import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeAgentHarness } from '../testing/nativeAgentHarness.ts';

test('background protection describes a request without claiming every chat message analyzes food', async () => {
  const harness = nativeAgentHarness();
  const { beginForegroundWork, foregroundWorkActive } = await import('./foregroundWork.ts');
  try {
    const release = await beginForegroundWork();
    assert.equal(foregroundWorkActive(), true);
    const notification = harness.fixture.foregroundNotifications[0];
    assert.match(notification.body, /запрос/i);
    assert.doesNotMatch(notification.body, /анализирую еду/i);
    await release();
    assert.equal(foregroundWorkActive(), false);
    assert.equal(harness.fixture.foregroundStops, 1);
  } finally { harness.close(); }
});
