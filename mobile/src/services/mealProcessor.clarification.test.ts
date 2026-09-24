import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, meals, chat, processor, sessions, conversation, savedMeal, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';
const { commitMealAgentEdit } = await import('../data/mealAgentRepository.ts');

async function questionMeal(id: string) {
  const meal = await savedMeal(id);
  const thread = await chat.ensureMealThread(id, 'Lunch');
  return (await commitMealAgentEdit({ callId: `${id}-questions`, threadId: thread.id, mealId: id, expectedRevision: 1, edit: {},
    questions: [{ question: 'How much?', options: ['100 g', '200 g'] }, { question: 'Sauce?', options: ['Yes', 'No'] }],
  })).meal;
}

test('background recovery cannot resubmit an active form answer', async () => {
  const meal = await questionMeal('form-background');
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  fixture.respond = async () => { started.resolve(); await release.promise; return [textOutput('Need another detail.')]; };
  const sending = processor.answerMealClarification(meal.id, '100 g', [{ questionId: meal.questions![0].id, answer: '100 g' }]);
  await started.promise;
  await processor.processPendingMeals();
  assert.equal(fixture.requests.length, 1);
  release.resolve(); await sending;
  assert.equal((await meals.getMeal(meal.id))!.questions!.filter(q => q.state === 'open').length, 2);
});

test('answers in a secondary historical chat update canonical questions without fabricated primary-chat user messages', async () => {
  const meal = await questionMeal('secondary-answer');
  const primary = (await chat.preferredMealThread(meal.id, true))!;
  const secondary = await chat.createChatThread({ title: 'Older conversation', mealId: meal.id });
  const session = await sessions.openChatSession({ thread: secondary, selectedMealId: meal.id, onChanged() {}, onDataChanged: async () => {} });
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Recorded 100 g.')]
    : [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision,
      resolutions: [{ id: meal.questions![0].id, state: 'answered', answer: '100 g' }],
    }, 'secondary-resolution')];
  await session.send('100 g', []); await session.close();
  assert.equal((await chat.loadChatMessages(primary.id)).filter(m => m.role === 'chatUser').length, 0);
  fixture.respond = async payload => {
    if (payload.input.at(-1)?.type === 'function_call_output') {
      assert.match(JSON.stringify(payload.input.at(-1)), /100 g/);
      assert.match(JSON.stringify(payload.input.at(-1)), /answered/);
      return [textOutput('Your earlier answer is saved.')];
    }
    return [toolOutput('get_meal', { mealId: meal.id }, 'primary-read')];
  };
  await conversation.sendMealMessage(meal.id, 'What did I already answer?');
  assert.equal((await meals.getMeal(meal.id))!.questions!.filter(q => q.state === 'open').length, 1);
});

test('failed photo answers preserve questions and retain all saved angles on retry', async () => {
  let meal = await questionMeal('photo-answer');
  fixture.photos.set('/first-angle', 'Zmlyc3Q='); fixture.photos.set('/second-angle', 'c2Vjb25k');
  await meals.replaceMeal({ ...meal, photos: [
    { id: 'first', uri: '/first-angle', mimeType: 'image/jpeg', createdAt: 1 },
    { id: 'second', uri: '/second-angle', mimeType: 'image/jpeg', createdAt: 1 },
  ] });
  meal = (await meals.getMeal(meal.id))!;
  fixture.respond = async () => { throw new Error('Photo request unavailable'); };
  await assert.rejects(processor.answerMealClarification(meal.id, '100 g'), /Photo request unavailable/);
  assert.deepEqual(await meals.getMeal(meal.id), meal);
  fixture.respond = async payload => {
    if (payload.input.at(-1)?.type === 'function_call_output' || payload.input.at(-1)?.role === 'user' && JSON.stringify(payload.input.at(-1)).includes('input_image')) {
      assert.equal((JSON.stringify(payload.input).match(/input_image/g) ?? []).length, 2);
      return [textOutput('Both angles inspected.')];
    }
    return [toolOutput('view_meal_photos', { mealId: meal.id }, 'view-both')];
  };
  await conversation.resumeMealConversation(meal.id);
  const thread = (await chat.preferredMealThread(meal.id, false))!;
  assert.equal((await chat.loadChatMessages(thread.id)).filter(m => m.role === 'chatUser' && m.text === '100 g').length, 1);
});
