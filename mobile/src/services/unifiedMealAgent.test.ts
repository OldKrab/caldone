import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeAgentHarness, toolOutput, textOutput } from '../testing/nativeAgentHarness.ts';

const harness=nativeAgentHarness();
const {fixture}=harness;
const client=await import('../ai/piClient.ts');
const meals=await import('../data/mealRepository.ts');
const chat=await import('../data/chatRepository.ts');
const processor=await import('./mealProcessor.ts');
await meals.initializeMeals();await chat.initializeChat();
await client.connectProvider('openai-codex','oauth',{onEvent(){}});
test.after(()=>harness.close());

test('adding a meal starts its persistent agent conversation and saves an estimate with a question',async()=>{
  fixture.requests=[];
  const meal=await meals.createMeal({id:'new-meal',capturedAt:1,note:'Две булочки, количество съеденного пока не указано',photos:[]});
  fixture.respond=async payload=>{
    if(payload.input.some((item:any)=>item.type==='function_call_output'))return [textOutput('Сохранил оценку. Сколько съели?')];
    const current=await meals.getMeal(meal.id);
    return [toolOutput('edit_meal',{mealId:meal.id,expectedRevision:current!.revision,title:'Булочки',mealType:'snack',
      items:[{name:'Булочки',quantity:'2 шт.',calories:400,protein:8,carbs:70,fat:10}],
      questions:[{question:'Сколько булочек съели?',options:['Одну','Две']}],statusText:'Сохраняю булочки'},'initial-save')];
  };
  await processor.processMeal(meal.id);
  const saved=await meals.getMeal(meal.id);
  assert.equal(saved?.analysis?.title,'Булочки');
  assert.equal(saved?.status,'needs_input');
  assert.equal(saved?.questions?.filter(q=>q.state==='open').length,1);
  const thread=await chat.preferredMealThread(meal.id,false);
  assert.ok(thread,'a conversation starts with the first meal input');
  const messages=await chat.loadChatMessages(thread.id);
  assert.ok(messages.some(m=>m.role==='chatUser' && m.text.includes(meal.note)));
  assert.ok(messages.some(m=>m.role==='toolResult' && m.toolName==='edit_meal' && !m.isError));
  assert.ok(fixture.requests.every(p=>p.tools?.some((t:any)=>t.name==='edit_meal')),'all inference belongs to the agent tool loop');
});

test('a form answer and an indirect chat answer use one history and close only the questions actually answered',async()=>{
  await meals.saveMealRecord({id:'answers',revision:1,capturedAt:1,status:'needs_input',note:'Пирожки',photos:[],analysis:{
    title:'Пирожки',mealType:'lunch',items:[{name:'Пирожки',quantity:'2 шт.',calories:400,protein:8,carbs:70,fat:10}],
    totals:{calories:400,protein:8,carbs:70,fat:10},clarification:{questions:['Сколько съели?','Был ли соус?'],impactCalories:150},
  }});
  const before=(await meals.getMeal('answers'))!;
  const quantity=before.questions![0],sauce=before.questions![1];
  let phase='discussion';
  fixture.respond=async payload=>{
    const latestUser=payload.input.filter((i:any)=>i.role==='user').at(-1);
    const text=JSON.stringify(latestUser);
    if(phase==='discussion')return [textOutput('Спрашиваю, чтобы уточнить количество.')];
    const last=payload.input.at(-1);
    if(last?.type==='function_call_output')return [textOutput('Учёл ответ.')];
    const current=(await meals.getMeal('answers'))!;
    const isForm=phase==='form';
    if(isForm)assert.ok(text.includes(sauce.id),'form submissions retain the stable question ID');
    return [toolOutput('edit_meal',{mealId:'answers',expectedRevision:current.revision,
      ...(isForm?{}:{items:[{name:'Пирожки',quantity:'1 шт.',calories:200,protein:4,carbs:35,fat:5}]}),
      resolutions:[{id:isForm?sauce.id:quantity.id,state:'answered',answer:isForm?'Без соуса':'Из двух одну оставил'}],
    },phase+'-save')];
  };
  const {sendMealMessage}=await import('./mealConversation.ts');
  await sendMealMessage('answers','Почему ты это спрашиваешь?');
  assert.equal((await meals.getMeal('answers'))!.questions!.filter(q=>q.state==='open').length,2);
  phase='form';
  await processor.answerMealClarification('answers','Был ли соус?\nБез соуса',[{questionId:sauce.id,answer:'Без соуса'}]);
  let current=(await meals.getMeal('answers'))!;
  assert.deepEqual(current.questions!.filter(q=>q.state==='open').map(q=>q.id),[quantity.id]);
  phase='indirect';
  await sendMealMessage('answers','Из двух одну оставил');
  current=(await meals.getMeal('answers'))!;
  assert.equal(current.analysis!.totals.calories,200);
  assert.equal(current.questions!.filter(q=>q.state==='open').length,0);
  const threads=(await chat.listChatThreads()).filter(t=>t.mealId==='answers');
  assert.equal(threads.length,1);
  const messages=await chat.loadChatMessages(threads[0].id);
  assert.equal(messages.filter(m=>m.role==='chatUser').length,3);
  assert.ok(messages.some(m=>m.role==='chatUser' && m.text==='Из двух одну оставил'));
});

test('the agent waits for durable input before contacting the provider',async()=>{
  await meals.saveMealRecord({id:'durable-input',revision:1,capturedAt:1,status:'complete',note:'Rice',photos:[],analysis:{
    title:'Rice',mealType:'lunch',items:[],totals:{calories:0,protein:0,carbs:0,fat:0},
  }});
  const {sendMealMessage}=await import('./mealConversation.ts');
  fixture.requests=[];
  fixture.respond=async()=>[textOutput('Объяснение')];
  const started=Promise.withResolvers<void>();
  const release=Promise.withResolvers<void>();
  const original=fixture.database.runAsync;
  fixture.database.runAsync=async(sql:string,...args:any[])=>{
    if(sql.includes('INSERT INTO chat_messages') && args.some(v=>typeof v==='string' && v.includes('Before inference'))){
      started.resolve();await release.promise;
    }
    return original(sql,...args);
  };
  const sending=sendMealMessage('durable-input','Before inference');
  await started.promise;
  await new Promise(resolve=>setTimeout(resolve,30));
  const requestsBeforeSave=fixture.requests.length;
  release.resolve();await sending;
  fixture.database.runAsync=original;
  assert.equal(requestsBeforeSave,0,'a crash before input commit must never leave an unrecorded request running');
});

test('a failed form turn can resume after the screen closes without sending the answer twice',async()=>{
  await meals.saveMealRecord({id:'resume-answer',revision:1,capturedAt:1,status:'needs_input',note:'Rice',photos:[],analysis:{
    title:'Rice',mealType:'lunch',items:[{name:'Rice',quantity:'200 g',calories:260,protein:5,carbs:56,fat:1}],
    totals:{calories:260,protein:5,carbs:56,fat:1},clarification:{questions:['How much?'],impactCalories:150},
  }});
  fixture.respond=async()=>{throw new Error('Fixture connection unavailable')};
  await assert.rejects(processor.answerMealClarification('resume-answer','100 g'),/Fixture connection unavailable/);
  const {resumeMealConversation}=await import('./mealConversation.ts');
  fixture.respond=async payload=>{
    if(payload.input.at(-1)?.type==='function_call_output')return [textOutput('Сохранил 100 г.')];
    const current=(await meals.getMeal('resume-answer'))!;
    return [toolOutput('edit_meal',{mealId:current.id,expectedRevision:current.revision,
      items:[{name:'Rice',quantity:'100 g',calories:130,protein:2.5,carbs:28,fat:0.5}],
      resolutions:[{id:current.questions![0].id,state:'answered',answer:'100 g'}]},'recovered-answer')];
  };
  await resumeMealConversation('resume-answer');
  const saved=(await meals.getMeal('resume-answer'))!;
  assert.equal(saved.analysis!.totals.calories,130);
  const thread=(await chat.preferredMealThread('resume-answer',false))!;
  const messages=await chat.loadChatMessages(thread.id);
  assert.equal(messages.filter(m=>m.role==='chatUser' && m.text==='100 g').length,1);
  assert.equal((await chat.listChatActions(thread.id)).length,1);
});

test('an identity question before the first estimate is durable and shared with the meal card',async()=>{
  await meals.createMeal({id:'unknown-food',capturedAt:1,note:'Неясное блюдо',photos:[]});
  fixture.respond=async payload=>payload.input.at(-1)?.type==='function_call_output'
    ?[textOutput('Уточните, что это за еда.')]
    :[toolOutput('ask_question',{questions:[{question:'Что это за еда?',options:['Суп','Каша']}],statusText:'Уточняю блюдо'},'identity-question')];
  await processor.processMeal('unknown-food');
  const saved=(await meals.getMeal('unknown-food'))!;
  assert.equal(saved.analysis,undefined,'unclear identity must not force a fabricated estimate');
  assert.equal(saved.status,'needs_input');
  assert.equal(saved.questions!.filter(q=>q.state==='open').length,1);
  const id=saved.questions![0].id;
  fixture.respond=async()=>[textOutput('Нужно определить продукт, чтобы оценить состав.')];
  const {sendMealMessage}=await import('./mealConversation.ts');
  await sendMealMessage('unknown-food','Зачем это уточнять?');
  assert.equal((await meals.getMeal('unknown-food'))!.questions!.find(q=>q.id===id)!.state,'open');
});

test('nutrition updates retain provider-observed search evidence, not model-authored source claims',async()=>{
  await meals.createMeal({id:'researched',capturedAt:1,note:'Найди в интернете и запиши рис',photos:[]});
  await client.setWebSearchEnabled('openai-codex',true);
  fixture.respond=async payload=>{
    if(payload.input.at(-1)?.type==='function_call_output')return [textOutput('Сохранил оценку по источнику.')];
    const current=(await meals.getMeal('researched'))!;
    return [{type:'web_search_call',id:'search-nutrition',status:'completed',action:{type:'search',sources:[{url:'https://manufacturer.example/rice',title:'Rice nutrition'}]}},
      toolOutput('edit_meal',{mealId:current.id,expectedRevision:current.revision,title:'Rice',mealType:'lunch',items:[{name:'Rice',quantity:'100 g',calories:130,protein:2.5,carbs:28,fat:0.5}]},'research-save')];
  };
  await processor.processMeal('researched');
  const research=(await meals.getMeal('researched'))!.analysis?.research;
  assert.equal(research?.status,'completed');
  assert.equal(research?.sources[0].url,'https://manufacturer.example/rice');
  await client.setWebSearchEnabled('openai-codex',false);
});

test('ordinary assistant questions use explicit resolution too, including answers outside a form',async()=>{
  const {openChatSession}=await import('./chatSession.ts');
  const thread=await chat.createChatThread({title:'General discussion'});
  let snapshot:any;
  const session=await openChatSession({thread,onChanged:s=>{snapshot=s},onDataChanged:async()=>{}});
  let phase='ask';
  fixture.respond=async payload=>{
    if(payload.input.at(-1)?.type==='function_call_output')return [textOutput('Хорошо.')];
    if(phase==='ask')return [toolOutput('ask_question',{questions:[{question:'За какой день показать итоги?',options:['Сегодня','Вчера']}]},'general-question')];
    if(phase==='discussion')return [textOutput('Можно посмотреть любой день.')];
    return [toolOutput('resolve_questions',{resolutions:[{id:snapshot.questions[0].id,state:'answered',answer:'Сегодня'}]},'general-resolution')];
  };
  try{
    await session.send('Покажи итоги',[]);
    assert.equal(snapshot.questions[0].state,'open');
    phase='discussion';await session.send('А за какие дни можно?',[]);
    assert.equal(snapshot.questions[0].state,'open');
    phase='answer';await session.send('За текущий день',[]);
    assert.equal(snapshot.questions[0].state,'answered');
  }finally{await session.close();}
});

test('backup and restore preserve answered questions and their IDs without restarting old requests',async()=>{
  const {parseCalDoneBackup}=await import('../domain/backup.ts');
  const {mergeCalDoneBackup}=await import('../data/backupRepository.ts');
  const meal=(await meals.getMeal('answers'))!;
  const thread=(await chat.preferredMealThread(meal.id,false))!;
  const exported=await chat.exportChatData(false) as any[];
  const backup=parseCalDoneBackup({format:'caldone-backup',schemaVersion:1,exportedAt:new Date().toISOString(),preferences:{},
    meals:[{...meal,capturedAt:1000}],conversations:exported.filter(c=>c.thread.id===thread.id)});
  await chat.deleteChatThread(thread.id);
  await meals.deleteMeal(meal.id);
  await mergeCalDoneBackup(backup);
  const restored=(await meals.getMeal(meal.id))!;
  assert.equal(restored.questions!.length,2);
  assert.deepEqual(restored.questions!.map(q=>[q.id,q.state,q.answer]),meal.questions!.map(q=>[q.id,q.state,q.answer]));
  const {pendingAgentTurn}=await import('../data/agentTurnRepository.ts');
  assert.equal(await pendingAgentTurn({mealId:meal.id}),undefined);
});

test('adding another dish uses the same agent and preserves existing item values',async()=>{
  const original={name:'Edited soup',quantity:'250 g',calories:211,protein:12,carbs:25,fat:7};
  await meals.saveMealRecord({id:'addition',revision:1,capturedAt:1,status:'complete',note:'My lunch',photos:[],analysis:{title:'My lunch',mealType:'lunch',items:[original],totals:{calories:211,protein:12,carbs:25,fat:7}}});
  fixture.respond=async payload=>{
    if(payload.input.at(-1)?.type==='function_call_output')return [textOutput('Добавил салат.')];
    const current=(await meals.getMeal('addition'))!;
    return [toolOutput('edit_meal',{mealId:'addition',expectedRevision:current.revision,
      items:[original,{name:'Salad',quantity:'100 g',calories:80,protein:2,carbs:9,fat:4}]},'add-salad')];
  };
  const {addDishToMeal}=await import('./mealAddition.ts');
  await addDishToMeal('addition',{note:'Добавь салат, 100 г',photos:[]});
  const updated=(await meals.getMeal('addition'))!;
  assert.equal(updated.analysis!.totals.calories,291);
  assert.deepEqual(updated.analysis!.items[0],original);
  const thread=(await chat.preferredMealThread('addition',false))!;
  assert.ok(thread);
  assert.ok((await chat.loadChatMessages(thread.id)).some(m=>m.role==='chatUser' && m.source==='addition'));
});
