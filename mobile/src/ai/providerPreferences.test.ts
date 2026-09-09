import assert from 'node:assert/strict';
import { test } from 'node:test';

import { webSearchPreference } from './providerPreferences.ts';

test('web search defaults on but respects an explicit opt-out', () => {
  assert.equal(webSearchPreference(null), true);
  assert.equal(webSearchPreference('true'), true);
  assert.equal(webSearchPreference('false'), false);
});
