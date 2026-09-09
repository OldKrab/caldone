import assert from 'node:assert/strict';
import { test } from 'node:test';

import { composerBottomSpace, keyboardAvoidingBehavior, keyboardOccupiesWindow } from './composerPlacement.ts';

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

// Native frame placement is checked by scripts/check-assistant-keyboard.mjs.
// A helper-only calculation cannot catch the screen passing the wrong inset.
