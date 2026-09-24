import assert from 'node:assert/strict';
import test from 'node:test';

import { backDestination, type AppScreen } from './backNavigation.ts';

test('Android Back returns internal screens to their app parent', () => {
  assert.equal(backDestination('assistant', false), 'home');
  assert.equal(backDestination('chat_history', false), 'assistant');
  assert.equal(backDestination('settings', false), 'home');
  assert.equal(backDestination('providers', false), 'settings');
  assert.equal(backDestination('assistant_provider' as AppScreen, false), 'assistant');
  assert.equal(backDestination('detail', false), 'home');
  assert.equal(backDestination('describe', false), 'home');
});

test('Android Back leaves capture review without trapping the user in a loop', () => {
  assert.equal(backDestination('camera', true), 'home');
  assert.equal(backDestination('camera', false), 'home');
  assert.equal(backDestination('capture_review', true), 'camera');
});

test('Android Back may leave only from Today', () => {
  assert.equal(backDestination('home', false), 'exit');
});
