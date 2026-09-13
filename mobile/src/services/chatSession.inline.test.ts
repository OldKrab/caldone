import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, meals, chat, sessions, conversation, savedMeal, rice, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';

test('leaving and reopening chat retains the active turn, progress, and eventual answer', async () => {
  const meal = await savedMeal('retained-session');
  const thread = await chat.ensureMealThread(meal.id, 'Lunch');
  let snapshot: any;
  const input = { thread, selectedMealId: meal.id, onChanged: (value: any) => { snapshot = value; }, onDataChanged: async () => {} };
  const session = await sessions.openChatSession(input);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  fixture.respond = async () => { started.resolve(); await release.promise; return [textOutput('The answer survived navigation.')]; };
  const sending = session.send('Explain this meal', []);
  await started.promise;
  await session.close();
  const reopened = await sessions.openChatSession(input);
  assert.equal(snapshot.busy, true);
  assert.ok(snapshot.workStartedAt);
  await assert.rejects(reopened.send('Duplicate', []), /progress/);
  release.resolve(); await sending;
  assert.equal(snapshot.busy, false);
  assert.ok(snapshot.messages.some((m: any) => m.role === 'assistant' && JSON.stringify(m.content).includes('survived navigation')));
  await reopened.close();
  assert.equal((await chat.loadChatMessages(thread.id)).filter(m => m.role === 'chatUser').length, 1);
});

test('a screen attaching to background meal work keeps receiving data refreshes on later turns', async () => {
  const meal = await savedMeal('headless-to-screen');
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  fixture.respond = async () => { started.resolve(); await release.promise; return [textOutput('Ready.')]; };
  const background = conversation.sendMealMessage(meal.id, 'Explain the meal');
  await started.promise;
  const thread = (await chat.preferredMealThread(meal.id, false))!;
  let refreshes = 0;
  const session = await sessions.openChatSession({ thread, selectedMealId: meal.id, onChanged() {},
    onDataChanged: async () => { refreshes++; },
  });
  release.resolve(); await background;
  refreshes = 0;
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Updated.')]
    : [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision, items: [{ ...rice, calories: 140 }] }, 'attached-screen-edit')];
  await session.send('Change to 140 kcal', []);
  assert.ok(refreshes > 0, 'the surviving screen must not retain the headless caller’s empty refresh callback');
  await session.close();
});

test('a connection retry retains input and completed tools without running the mutation twice', async () => {
  const meal = await savedMeal('connection-retry');
  let request = 0;
  fixture.respond = async () => {
    request++;
    if (request === 1) return [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision, items: [{ ...rice, calories: 140 }] }, 'once-only')];
    if (request === 2) throw new Error('Network request failed');
    return [textOutput('Saved after reconnecting.')];
  };
  await conversation.sendMealMessage(meal.id, 'Set rice to 140 kcal');
  const thread = (await chat.preferredMealThread(meal.id, false))!;
  assert.equal((await meals.getMeal(meal.id))!.revision, 2);
  assert.equal((await chat.listChatActions(thread.id)).length, 1);
  assert.equal((await chat.loadChatMessages(thread.id)).filter(m => m.role === 'chatUser').length, 1);
  assert.equal(request, 3);
});

test('tool execution events expose running and completed operations', async () => {
  const meal = await savedMeal('execution-events');
  const thread = await chat.ensureMealThread(meal.id, 'Lunch');
  const snapshots: any[] = [];
  const session = await sessions.openChatSession({ thread, selectedMealId: meal.id,
    onChanged: value => snapshots.push(value), onDataChanged: async () => {},
  });
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Read the meal.')]
    : [toolOutput('get_meal', { mealId: meal.id, statusText: 'Opening the meal' }, 'read-progress')];
  await session.send('Read this meal', []);
  await session.close();
  const statuses = snapshots.flatMap(s => Object.values(s.toolExecutions ?? {}).map((e: any) => e.status));
  assert.ok(statuses.includes('running'));
  assert.ok(statuses.includes('completed'));
});

test('Undo restores nutrition and question state and remains undone after another message and reopening', async () => {
  const meal = await savedMeal('session-undo');
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Updated.')]
    : [toolOutput('edit_meal', { mealId: meal.id, expectedRevision: meal.revision, items: [{ ...rice, calories: 140 }],
      questions: [{ question: 'Any sauce?', options: ['Yes', 'No'] }],
    }, 'undoable-edit')];
  await conversation.sendMealMessage(meal.id, 'Update to 140 kcal');
  const thread = (await chat.preferredMealThread(meal.id, false))!;
  const action = (await chat.listChatActions(thread.id))[0];
  await sessions.undoAssistantAction(action.id);
  const restored = (await meals.getMeal(meal.id))!;
  assert.equal(restored.analysis!.totals.calories, 130);
  assert.equal(restored.questions?.length ?? 0, 0);
  fixture.respond = async () => [textOutput('The previous estimate was restored.')];
  await conversation.sendMealMessage(meal.id, 'What is the current estimate?');
  let snapshot: any;
  const session = await sessions.openChatSession({ thread, selectedMealId: meal.id,
    onChanged: value => { snapshot = value; }, onDataChanged: async () => {},
  });
  assert.equal(snapshot.actions.find((a: any) => a.id === action.id).undone, true);
  await session.close();
});
