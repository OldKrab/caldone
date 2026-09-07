import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mealInputContent, hasMealInput } from './mealInput.ts';

test('a description without photos is valid meal evidence and reaches the model', () => {
  const input = { photos: [], note: '  Two eggs and toast  ' };
  assert.equal(hasMealInput(input), true);
  const content = mealInputContent(input);
  assert.equal(content.length, 1);
  assert.equal(content[0].type, 'text');
  assert.match((content[0] as any).text, /Two eggs and toast/);
});

test('empty and whitespace-only meals cannot be submitted', () => {
  assert.equal(hasMealInput({ photos: [], note: ' \n ' }), false);
  assert.throws(() => mealInputContent({ photos: [], note: ' ' }), /description or photo/);
});

test('photo meals keep both their images and optional description', () => {
  const content = mealInputContent({ photos: [{ base64: 'image-bytes', mimeType: 'image/jpeg' }], note: 'Half the plate' });
  assert.match((content[0] as any).text, /Half the plate/);
  assert.deepEqual(content[1], { type: 'image', data: 'image-bytes', mimeType: 'image/jpeg' });
});

test('dish additions send the existing meal as context and only new photo evidence', () => {
  const content = mealInputContent({
    photos: [{ base64: 'new-dish', mimeType: 'image/jpeg' }],
    note: 'Another serving of soup',
    existingMeal: { title: 'Lunch', mealType: 'lunch', items: [{ name: 'Soup', calories: 200 }], totals: { calories: 200 } },
  });
  const prompt = (content[0] as { text: string }).text;
  assert.match(prompt, /ONLY the newly added food/);
  assert.match(prompt, /Do not recalculate or repeat existing items/);
  assert.match(prompt, /extra serving does count/);
  assert.match(prompt, /"title":"Lunch"/);
  assert.match(prompt, /Another serving of soup/);
  assert.deepEqual(content[1], { type: 'image', data: 'new-dish', mimeType: 'image/jpeg' });
});
