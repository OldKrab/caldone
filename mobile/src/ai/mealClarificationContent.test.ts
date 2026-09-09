import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMealClarificationContent } from './mealClarificationContent.ts';

test('answering all food in the photo retains every saved image in the provider request', () => {
  const content = buildMealClarificationContent({
    previousJson: '{"title":"Unidentified meal"}', question: 'Which food did you eat?',
    answer: 'Everything in the picture', note: 'Lunch at the cafeteria',
    photos: [{ base64: 'cGhvdG8x', mimeType: 'image/jpeg' }, { base64: 'cGhvdG8y', mimeType: 'image/png' }],
  });
  assert.deepEqual(content.filter((block) => block.type === 'image'), [
    { type: 'image', data: 'cGhvdG8x', mimeType: 'image/jpeg' },
    { type: 'image', data: 'cGhvdG8y', mimeType: 'image/png' },
  ]);
  const text = content.find((block) => block.type === 'text');
  assert.ok(text?.type === 'text');
  assert.match(text.text, /Everything in the picture/);
  assert.match(text.text, /Lunch at the cafeteria/);
  assert.match(text.text, /Which food did you eat/);
});
