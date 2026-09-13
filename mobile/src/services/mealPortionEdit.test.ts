import assert from 'node:assert/strict';
import test from 'node:test';
import { meals, chat } from '../testing/mealAgentTestContext.ts';
const { createCalDoneTools } = await import('../ai/chatTools.ts');

test('a known-weight correction preserves product density without repeating failed research', async () => {
  const item = {name:'Chips',quantity:'38 g',calories:190,protein:1.9,carbs:19,fat:11.4};
  await meals.saveMealRecord({id:'portion',revision:1,capturedAt:1,status:'complete',note:'Original chips note',photos:[],
    analysis:{title:'Chips',mealType:'snack',items:[item],totals:item}});
  const thread = await chat.ensureMealThread('portion','Chips');
  const tool = createCalDoneTools({threadId:thread.id,attachments:new Map(),getMessages:()=>[
    {role:'chatUser',text:'Google this product',attachments:[],timestamp:1},
    {role:'chatUser',text:'80 g of chips, not 38',attachments:[],timestamp:2}],
    getResearch:async()=>{assert.fail('A direct weight correction must not repeat research');},
    onDataChanged:async()=>{}}).find(tool=>tool.name==='edit_meal')!;
  await tool.execute('weight',{mealId:'portion',expectedRevision:1,portionGrams:80},new AbortController().signal);
  const saved = (await meals.getMeal('portion'))!;
  assert.equal(saved.analysis!.items[0].quantity,'80 g');
  assert.equal(saved.analysis!.totals.calories,400);
  assert.equal(saved.note,'Original chips note');
  await assert.rejects(tool.execute('stale',{mealId:'portion',expectedRevision:1,portionGrams:100},new AbortController().signal),/changed/);
});


test('unified edits retain artwork for portion answers and discard it when food identity changes', async () => {
  const {commitMealAgentEdit} = await import('../data/mealAgentRepository.ts');
  const item = {name:'Eggs',quantity:'2 eggs',calories:140,protein:12,carbs:1,fat:10};
  const artwork = {url:'https://food.example.com/eggs.jpg',sourceUrl:'https://food.example.com/eggs'};
  await meals.saveMealRecord({id:'artwork',revision:1,capturedAt:1,status:'complete',note:'Two eggs',photos:[],
    analysis:{title:'Eggs',mealType:'breakfast',items:[item],totals:item,webImage:artwork}});
  const thread = await chat.ensureMealThread('artwork','Eggs');
  const first = await commitMealAgentEdit({callId:'portion-art',threadId:thread.id,mealId:'artwork',expectedRevision:1,
    edit:{items:[{...item,quantity:'3 eggs',calories:210}]}});
  assert.deepEqual(first.meal.analysis?.webImage,artwork);
  const second = await commitMealAgentEdit({callId:'identity-art',threadId:thread.id,mealId:'artwork',expectedRevision:first.meal.revision,
    edit:{items:[{...item,name:'Chocolate cake'}]}});
  assert.equal(second.meal.analysis?.webImage,undefined);
});
