import assert from 'node:assert/strict';
import test from 'node:test';

import { providerActivityFromEvent } from './providerActivityEvent.ts';

test('projects hosted web-search lifecycle without retaining provider content', () => {
  assert.deepEqual(providerActivityFromEvent({
    type: 'response.output_item.added',
    output_index: 2,
    item: { id: 'ws_123', type: 'web_search_call', status: 'in_progress', query: 'private query' },
  }), { id: 'web-search-ws_123', name: 'web_search', status: 'active' });

  assert.deepEqual(providerActivityFromEvent({
    type: 'response.web_search_call.completed',
    item_id: 'ws_123',
  }), { id: 'web-search-ws_123', name: 'web_search', status: 'complete' });

  assert.deepEqual(providerActivityFromEvent({
    type: 'response.output_item.done',
    item: { id: 'ws_124', type: 'web_search_call', status: 'incomplete' },
  }), { id: 'web-search-ws_124', name: 'web_search', status: 'error' });
});

test('ignores ordinary response content', () => {
  assert.equal(providerActivityFromEvent({ type: 'response.output_text.delta', delta: 'hello' }), undefined);
});
