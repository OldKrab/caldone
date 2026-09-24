import assert from 'node:assert/strict';
import { test } from 'node:test';

import { composerBottomSpace, keyboardAvoidingBehavior, keyboardAvoidingOffset, keyboardOccupiesWindow } from './composerPlacement.ts';

test('composer reserves app navigation only while the keyboard is hidden', () => {
  assert.equal(composerBottomSpace(false, 84), 84);
  assert.equal(composerBottomSpace(true, 84), 0);
});

test('a resized Android window reveals the keyboard when the platform event is missing', () => {
  assert.equal(keyboardOccupiesWindow(false, 1275, 2048), true);
  assert.equal(composerBottomSpace(keyboardOccupiesWindow(false, 1275, 2048), 84), 0);
});

test('Android explicitly avoids an overlay keyboard when edge-to-edge keeps the window full height', () => {
  assert.equal(keyboardAvoidingBehavior('android'), 'padding');
});

test('Android includes the bottom system inset when the IME height excludes it', () => {
  const trace = {
    composerBottom: 458.3333435058594 + 74.66665649414062,
    keyboardTop: 493,
    safeAreaBottom: 44,
  };

  const correctedComposerBottom = trace.composerBottom - keyboardAvoidingOffset('android', trace.safeAreaBottom);

  assert.ok(correctedComposerBottom <= trace.keyboardTop);
  assert.equal(keyboardAvoidingOffset('ios', trace.safeAreaBottom), 0);
});
