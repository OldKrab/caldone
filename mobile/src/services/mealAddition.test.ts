import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { fixture, meals, chat, processor, savedMeal, rice, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';
const { addDishToMeal } = await import('./mealAddition.ts');

function addResponse(id: string, callId: string) {
  fixture.respond = async payload => {
    if (payload.input.at(-1)?.type === 'function_call_output') return [textOutput('Added bread.')];
    const meal = (await meals.getMeal(id))!;
    return [toolOutput('edit_meal', { mealId: id, expectedRevision: meal.revision,
      items: [...meal.analysis!.items, { ...rice, name: 'Bread' }],
    }, callId)];
  };
}

test('photo and text additions preserve original items, metadata and photos across repeated additions', async () => {
  const before = await savedMeal('add-photos');
  const uri = `${fixture.root}/new-dish.jpg`;
  writeFileSync(uri, 'photo fixture');
  addResponse(before.id, 'photo-add');
  await addDishToMeal(before.id, { note: 'Bread', photos: [{ id: 'new-dish', uri, mimeType: 'image/jpeg', createdAt: 5 }] });
  let saved = (await meals.getMeal(before.id))!;
  assert.deepEqual(saved.analysis!.items[0], rice);
  assert.equal(saved.photos.length, 1);
  assert.notEqual(saved.photos[0].uri, uri);
  assert.equal(saved.note, before.note);
  assert.equal(saved.capturedAt, before.capturedAt);
  assert.equal(saved.analysis!.mealType, before.analysis!.mealType);
  addResponse(before.id, 'text-add');
  await addDishToMeal(before.id, { note: 'Another bread serving', photos: [] });
  saved = (await meals.getMeal(before.id))!;
  assert.equal(saved.analysis!.items.length, 3);
  assert.equal(saved.photos.length, 1);
  const thread = (await chat.preferredMealThread(before.id, false))!;
  assert.equal((await chat.loadChatMessages(thread.id)).filter(m => m.role === 'chatUser').length, 2);
});

test('a failed addition retains accepted photos and retry applies the same message exactly once', async () => {
  const before = await savedMeal('failed-add');
  const uri = `${fixture.root}/retry-dish.jpg`;
  writeFileSync(uri, 'photo fixture');
  const input = { note: 'Bread', photos: [{ id: 'retry-dish', uri, mimeType: 'image/jpeg', createdAt: 5 }] };
  fixture.respond = async () => { throw new Error('Connection unavailable'); };
  await assert.rejects(addDishToMeal(before.id, input), /Connection unavailable/);
  assert.deepEqual(await meals.getMeal(before.id), before);
  assert.ok((await chat.retainedInputPhotoUris()).has(uri));
  addResponse(before.id, 'retry-add');
  await addDishToMeal(before.id, input);
  const saved = (await meals.getMeal(before.id))!;
  assert.equal(saved.analysis!.items.length, 2);
  assert.equal(saved.photos.length, 1);
  const thread = (await chat.preferredMealThread(before.id, false))!;
  assert.equal((await chat.loadChatMessages(thread.id)).filter(m => m.role === 'chatUser').length, 1);
});

for (const mutation of ['edit', 'delete'] as const) {
  test(`an addition cannot overwrite a concurrent ${mutation}`, async () => {
    const before = await savedMeal(`concurrent-${mutation}`);
    fixture.respond = async payload => {
      if (payload.input.at(-1)?.type === 'function_call_output') return [textOutput('The meal changed.')];
      if (mutation === 'delete') await meals.deleteMeal(before.id);
      else await meals.replaceMeal({ ...before, note: 'Human edit' });
      return [toolOutput('edit_meal', { mealId: before.id, expectedRevision: before.revision,
        items: [rice, { ...rice, name: 'Bread' }],
      }, `stale-add-${mutation}`)];
    };
    await addDishToMeal(before.id, { note: 'Bread', photos: [] });
    const saved = await meals.getMeal(before.id);
    if (mutation === 'delete') assert.equal(saved, undefined);
    else { assert.equal(saved!.note, 'Human edit'); assert.equal(saved!.analysis!.items.length, 1); }
  });
}

test('empty and unfinished additions fail before inference; empty model items cannot save', async () => {
  const before = await savedMeal('invalid-addition');
  await assert.rejects(addDishToMeal(before.id, { note: ' ', photos: [] }));
  await meals.createMeal({ id: 'unfinished', capturedAt: 1, note: 'Rice', photos: [] });
  await assert.rejects(addDishToMeal('unfinished', { note: 'Bread', photos: [] }));
  assert.equal(fixture.requests.length, 0);
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Invalid estimate.')]
    : [toolOutput('edit_meal', { mealId: before.id, expectedRevision: before.revision, items: [] }, 'empty-add')];
  await addDishToMeal(before.id, { note: 'Bread', photos: [] });
  assert.deepEqual(await meals.getMeal(before.id), before);
});

test('duplicate submission and background recovery cannot race an active addition', async () => {
  const meal = await savedMeal('duplicate-add');
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  fixture.respond = async payload => {
    if (payload.input.at(-1)?.type === 'function_call_output') return [textOutput('Added.')];
    started.resolve(); await release.promise;
    return [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision, items: [rice, { ...rice, name: 'Bread' }] }, 'single-add')];
  };
  const sending = addDishToMeal(meal.id, { note: 'Bread', photos: [] });
  await started.promise;
  await assert.rejects(addDishToMeal(meal.id, { note: 'Bread', photos: [] }), /progress/);
  // Another unfinished fixture must not enter this test's provider script.
  await meals.deleteMeal('unfinished');
  await processor.processPendingMeals();
  assert.equal(fixture.requests.length, 1);
  release.resolve(); await sending;
  assert.equal((await meals.getMeal(meal.id))!.analysis!.items.length, 2);
});

test('stopping an addition permits a fresh submission without replaying the cancelled input', async () => {
  const meal = await savedMeal('cancelled-add');
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  fixture.respond = async () => { started.resolve(); await release.promise; return [textOutput('Interrupted')]; };
  const controller = new AbortController();
  const sending = addDishToMeal(meal.id, { note: 'Bread', photos: [], signal: controller.signal });
  await started.promise;
  controller.abort(); release.resolve(); await assert.rejects(sending, /aborted|cancelled/i);
  assert.deepEqual(await meals.getMeal(meal.id), meal);
  addResponse(meal.id, 'fresh-add');
  await addDishToMeal(meal.id, { note: 'Bread instead', photos: [] });
  assert.equal((await meals.getMeal(meal.id))!.analysis!.items.length, 2);
});
