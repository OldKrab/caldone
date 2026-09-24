import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, meals, chat, conversation, savedMeal, rice, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';

test('indirect answers apply in the agent itself and retain remaining question IDs', async () => {
  const meal = await savedMeal('indirect-answer');
  const thread = await chat.ensureMealThread(meal.id, 'Meal');
  const { commitMealAgentEdit } = await import('../data/mealAgentRepository.ts');
  const first = await commitMealAgentEdit({ callId: 'initial-questions', threadId: thread.id, mealId: meal.id,
    expectedRevision: meal.revision, edit: {}, questions: [
      { question: 'How much rice?', options: ['100 g', '200 g'] }, { question: 'Any sauce?', options: ['Yes', 'No'] },
    ],
  });
  const [portion, sauce] = first.meal.questions!;
  fixture.respond = async payload => {
    assert.ok(!payload.tools.some((tool: any) => ['reanalyze_meal', 'answer_meal_question'].includes(tool.name)));
    if (payload.input.at(-1)?.type === 'function_call_output') return [textOutput('Adjusted the rice.')];
    return [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: first.meal.revision,
      items: [{ ...rice, quantity: '200 g', calories: 260 }], resolutions: [{ id: portion.id, state: 'answered', answer: 'Two portions of 100 g' }],
    }, 'indirect-save')];
  };
  await conversation.sendMealMessage(meal.id, 'There were two portions of 100 g');
  const saved = (await meals.getMeal(meal.id))!;
  assert.equal(saved.questions!.find(q => q.id === portion.id)!.state, 'answered');
  assert.equal(saved.questions!.find(q => q.id === sauce.id)!.state, 'open');
  assert.equal(saved.analysis!.totals.calories, 260);
  assert.equal((await chat.loadChatMessages(thread.id)).filter(m => m.role === 'chatUser').length, 1);
});
