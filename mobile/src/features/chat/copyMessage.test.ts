import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyMessage } from './copyMessage.ts';

test('copy sends the whole visible answer to the clipboard without private activity', async () => {
  const writes: string[] = [];
  const result = await copyMessage({ role: 'assistant', content: [
    { type: 'thinking', thinking: 'private reasoning' },
    { type: 'text', text: 'A **small snack**.' },
    { type: 'toolCall', id: '1', name: 'read_meal', arguments: {} },
    { type: 'text', text: 'About 80 kcal.\nCheck the package.' },
  ] }, async (text) => { writes.push(text); });
  assert.equal(result, true);
  assert.deepEqual(writes, ['A **small snack**.\n\nAbout 80 kcal.\nCheck the package.']);
});

test('copy preserves the user message and does not write empty tool-only messages', async () => {
  const writes: string[] = [];
  assert.equal(await copyMessage({ role: 'chatUser', text: 'Проверь порцию\n150 г' }, async (text) => { writes.push(text); }), true);
  assert.equal(await copyMessage({ role: 'assistant', content: [{ type: 'toolCall' }] }, async (text) => { writes.push(text); }), false);
  assert.deepEqual(writes, ['Проверь порцию\n150 г']);
});

test('clipboard failure is not reported as successful copying', async () => {
  await assert.rejects(copyMessage({ role: 'chatUser', text: 'Lunch' }, async () => { throw new Error('Clipboard unavailable'); }), /Clipboard unavailable/);
});
