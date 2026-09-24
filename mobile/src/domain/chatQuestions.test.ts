import assert from 'node:assert/strict';
import { test } from 'node:test';

import { newChatUserMessage, newMealQuestionMessage } from './chat.ts';

test('meal clarification chat starts with every model question visible', () => {
  assert.deepEqual(newMealQuestionMessage({
    mealId: 'meal-42',
    questions: ['How much?', 'Which sauce?'],
    timestamp: 123,
  }), {
    role: 'mealQuestion',
    mealId: 'meal-42',
    questions: ['How much?', 'Which sauce?'],
    timestamp: 123,
  });
});

test('an inline answer is stored as a normal user turn in the meal chat', () => {
  assert.deepEqual(newChatUserMessage('It was 300 ml', 456), {
    role: 'chatUser',
    text: 'It was 300 ml',
    attachments: [],
    timestamp: 456,
  });
});
