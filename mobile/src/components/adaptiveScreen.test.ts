import assert from 'node:assert/strict';
import { test } from 'node:test';

import { keyboardSafeAreaConfig, shouldStackFormFields } from './adaptiveScreen.ts';

test('Android forms keep the bottom safe area and avoid the IME with stable padding', () => {
  assert.deepEqual(keyboardSafeAreaConfig('android'), {
    behavior: 'padding',
    edges: ['top', 'right', 'bottom', 'left'],
    keyboardVerticalOffset: 0,
  });
});

test('form fields stack when a narrow window or large text would make two columns collide', () => {
  assert.equal(shouldStackFormFields(359, 1), true);
  assert.equal(shouldStackFormFields(392, 1), false);
  assert.equal(shouldStackFormFields(430, 1.25), true);
});
