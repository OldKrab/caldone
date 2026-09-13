import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, meals, chat, conversation, savedMeal, rice, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';
const { addDishToMeal } = await import('./mealAddition.ts');

test('model explanations cannot overwrite the user note during meal correction', async () => {
  const before = await savedMeal('user-note-ownership');
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('I will keep your original note.')]
    : [toolOutput('edit_meal', { mealId: before.id, expectedRevision: before.revision,
      note: 'The user does not know the brand. Assume 75 g per pancake.',
      items: [{ ...rice, calories: 180 }],
    }, 'rewrite-user-note')];
  await conversation.sendMealMessage(before.id, 'About a teaspoon of oil');
  assert.equal((await meals.getMeal(before.id))!.note, 'Original note');
});

test('an addition can refine its own new item twice in one turn while original items remain protected', async () => {
  await savedMeal('multi-step-addition');
  let step = 0;
  fixture.respond = async () => {
    const meal = (await meals.getMeal('multi-step-addition'))!;
    if (step++ === 0) return [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision,
      items: [rice, { ...rice, name: 'Bread', calories: 80 }],
    }, 'add-first')];
    if (step === 2) return [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision,
      items: [rice, { ...rice, name: 'Bread', calories: 90 }],
    }, 'add-refined')];
    return [textOutput('Added bread.')];
  };
  await addDishToMeal('multi-step-addition', { note: 'Bread', photos: [] });
  const meal = (await meals.getMeal('multi-step-addition'))!;
  assert.equal(meal.analysis!.items[1].calories, 90);
  assert.deepEqual(meal.analysis!.items[0], rice);
});

test('an addition cannot silently change the original meal metadata', async () => {
  const before = await savedMeal('addition-metadata');
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Cannot change that during an addition.')]
    : [toolOutput('edit_meal', { mealId: before.id, expectedRevision: before.revision, mealType: 'breakfast',
      note: 'Replaced note', capturedAt: '2026-01-01T12:00:00Z', items: [rice, { ...rice, name: 'Bread' }],
    }, 'invalid-addition-metadata')];
  await addDishToMeal(before.id, { note: 'Bread', photos: [] });
  const after = (await meals.getMeal(before.id))!;
  assert.equal(after.note, before.note);
  assert.equal(after.capturedAt, before.capturedAt);
  assert.equal(after.analysis!.mealType, before.analysis!.mealType);
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Keep the meal title.')]
    : [toolOutput('edit_meal', { mealId: before.id, expectedRevision: after.revision, title: 'Renamed meal',
      items: [rice, { ...rice, name: 'Bread' }],
    }, 'invalid-addition-title')];
  await addDishToMeal(before.id, { note: 'Bread', photos: [] });
  assert.equal((await meals.getMeal(before.id))!.analysis!.title, before.analysis!.title);
});

test('a form answer to an added dish cannot replace original items after reopening', async () => {
  await savedMeal('addition-form');
  fixture.respond = async payload => {
    if (payload.input.at(-1)?.type === 'function_call_output') return [textOutput('How much bread?')];
    const meal = (await meals.getMeal('addition-form'))!;
    return [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision,
      items: [rice, { ...rice, name: 'Bread', calories: 90 }], questions: [{ question: 'Bread portion?', options: ['50 g', '100 g'] }],
    }, 'addition-with-question')];
  };
  await addDishToMeal('addition-form', { note: 'Bread', photos: [] });
  let meal = (await meals.getMeal('addition-form'))!;
  assert.equal(meal.analysis!.dishAddition?.originalItemCount, 1);
  const question = meal.questions![0];
  fixture.respond = async payload => {
    if (payload.input.at(-1)?.type === 'function_call_output') return [textOutput('Cannot replace the rice.')];
    const current = (await meals.getMeal(meal.id))!;
    return [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: current.revision,
      items: [{ ...rice, calories: 999 }, { ...rice, name: 'Bread', calories: 180 }],
      resolutions: [{ id: question.id, state: 'answered', answer: '100 g' }],
    }, 'invalid-original-edit')];
  };
  await conversation.sendMealMessage(meal.id, '100 g', [], { source: 'form', questionAnswers: [{ questionId: question.id, answer: '100 g' }] });
  meal = (await meals.getMeal(meal.id))!;
  assert.deepEqual(meal.analysis!.items[0], rice);
  assert.equal(meal.questions!.find(q => q.id === question.id)!.state, 'open');
  const thread = (await chat.preferredMealThread(meal.id, false))!;
  assert.ok((await chat.loadChatMessages(thread.id)).some(m => m.role === 'toolResult' && m.isError));
});
