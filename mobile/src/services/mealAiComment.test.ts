import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, meals, chat, conversation, savedMeal, rice, toolOutput, textOutput } from '../testing/mealAgentTestContext.ts';
const { createCalDoneTools } = await import('../ai/chatTools.ts');
const { parseCalDoneBackup } = await import('../domain/backup.ts');
const { mergeCalDoneBackup } = await import('../data/backupRepository.ts');
const { undoAssistantAction } = await import('./chatSession.ts');
const { actionDetails } = await import('../features/chat/actionDetails.ts');

test('the assistant saves its own comment without changing the user note or nutrition', async () => {
  const before = await savedMeal('ai-comment');
  fixture.respond = async payload => payload.input.at(-1)?.type === 'function_call_output'
    ? [textOutput('Saved the assumption separately.')]
    : [toolOutput('edit_meal', {
      mealId: before.id, expectedRevision: before.revision,
      aiComment: 'Oil is estimated at 5 g; the amount was not measured.',
    }, 'save-ai-comment')];
  await conversation.sendMealMessage(before.id, 'Save your oil assumption as an AI comment.');
  const saved = (await meals.getMeal(before.id))!;
  assert.equal(saved.aiComment, 'Oil is estimated at 5 g; the amount was not measured.');
  assert.equal(saved.note, before.note);
  assert.deepEqual(saved.analysis, before.analysis);
});

test('backup import preserves the AI comment independently of the original note', async () => {
  const source = {...await savedMeal('comment-backup-source'), aiComment:'Portion estimated at 100 g.'};
  const backup = parseCalDoneBackup(JSON.parse(JSON.stringify({
    format:'caldone-backup', schemaVersion:1, exportedAt:'2026-09-13T12:00:00Z',
    preferences:{}, conversations:[], meals:[{...source,id:'comment-backup-import'}],
  })));
  await mergeCalDoneBackup(backup);
  const restored = (await meals.getMeal('comment-backup-import'))!;
  assert.equal(restored.aiComment, 'Portion estimated at 100 g.');
  assert.equal(restored.note, 'Original note');
});

test('a meal created in chat stores assistant explanations separately from quoted user input', async () => {
  const thread = await chat.createChatThread();
  const tools = createCalDoneTools({threadId:thread.id,attachments:new Map(),getMessages:()=>[],onDataChanged:async()=>{}});
  await tools.find(tool=>tool.name==='create_meal')!.execute('create-with-comment', {
    title:'Rice', mealType:'lunch', note:'Rice for lunch', items:[rice], aiComment:'Portion estimated at 100 g.',
  }, new AbortController().signal);
  const created = (await meals.listMeals()).find(meal=>meal.analysis?.title==='Rice')!;
  assert.equal(created.aiComment, 'Portion estimated at 100 g.');
  assert.equal(created.note, 'Rice for lunch');
});

test('comment corrections are inspectable and undoable without inventing a nutrition estimate', async () => {
  const meal = await meals.createMeal({id:'comment-without-estimate',capturedAt:1234,note:'  My photo, unchanged.  ',photos:[]});
  const thread = await chat.ensureMealThread(meal.id, 'Unidentified meal');
  const tools = createCalDoneTools({threadId:thread.id,mealId:meal.id,attachments:new Map(),getMessages:()=>[],onDataChanged:async()=>{}});
  const edit = tools.find(tool=>tool.name==='edit_meal')!;
  const signal = new AbortController().signal;
  await edit.execute('comment-initial', {mealId:meal.id,expectedRevision:meal.revision,aiComment:'Food cannot be identified from this photo.'}, signal);
  let saved = (await meals.getMeal(meal.id))!;
  assert.equal(saved.analysis, undefined);
  assert.equal(saved.note, '  My photo, unchanged.  ');
  await edit.execute('comment-correction', {mealId:meal.id,expectedRevision:saved.revision,aiComment:'The photo does not show food.'}, signal);
  const correction = (await chat.listChatActions(thread.id)).find(action=>action.id==='agent:comment-correction')!;
  assert.deepEqual(actionDetails(correction,'ru'), [{label:'Комментарий ИИ',before:'Food cannot be identified from this photo.',after:'The photo does not show food.'}]);
  await undoAssistantAction(correction.id);
  saved = (await meals.getMeal(meal.id))!;
  assert.equal(saved.aiComment, 'Food cannot be identified from this photo.');
  const read = await tools.find(tool=>tool.name==='get_meal')!.execute('read-comment',{mealId:meal.id},signal);
  assert.match(JSON.stringify(read), /Food cannot be identified/);
  await assert.rejects(edit.execute('stale-comment',{mealId:meal.id,expectedRevision:meal.revision,aiComment:'Stale'},signal),/changed/);
  await edit.execute('comment-clear', {mealId:meal.id,expectedRevision:saved.revision,aiComment:''}, signal);
  saved = (await meals.getMeal(meal.id))!;
  assert.equal(saved.aiComment, undefined);
  assert.equal(saved.note, '  My photo, unchanged.  ');
  assert.equal(saved.analysis, undefined);
});
