import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import { fixture, meals, chat, conversation, sessions, savedMeal, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';

test('removing a photo from a meal preserves the file needed by its conversation and Undo', async () => {
  let meal = await savedMeal('photo-ownership');
  const uri = `${fixture.root}/original.jpg`;
  writeFileSync(uri, 'original photo');
  const photo = { id: 'original', uri, mimeType: 'image/jpeg', createdAt: 1 };
  await meals.replaceMeal({ ...meal, photos: [photo] });
  meal = (await meals.getMeal(meal.id))!;
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Removed from the meal.')]
    : [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision, removePhotoIds: [photo.id] }, 'remove-photo')];
  await conversation.sendMealMessage(meal.id, 'Remove this photo from the meal', [photo]);
  assert.equal((await meals.getMeal(meal.id))!.photos.length, 0);
  assert.equal(existsSync(uri), true, 'accepted evidence and the Undo snapshot still own this file');
  const thread = (await chat.preferredMealThread(meal.id, false))!;
  await sessions.undoAssistantAction((await chat.listChatActions(thread.id))[0].id);
  assert.equal((await meals.getMeal(meal.id))!.photos[0].uri, uri);
  assert.equal(existsSync(uri), true);
});
