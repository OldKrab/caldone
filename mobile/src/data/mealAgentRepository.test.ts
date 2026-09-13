import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { repositories } from './repositoryTestHarness.ts';

test('existing meal databases gain optional AI comments without rewriting user notes', async () => {
  const {sqlite, load} = repositories();
  try {
    // A pre-comment database is an installation input, not a mock of repository internals.
    sqlite.exec(`CREATE TABLE meals (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL, captured_at INTEGER NOT NULL,
      status TEXT NOT NULL, note TEXT NOT NULL, photos_json TEXT NOT NULL, analysis_json TEXT, error TEXT
    );
    INSERT INTO meals VALUES ('legacy',7,1234,'needs_input','  Мои слова.  ','[]',NULL,NULL);`);
    const meals = load(resolve(import.meta.dirname, 'mealRepository.ts'));
    await meals.initializeMeals();
    const before = await meals.getMeal('legacy');
    assert.equal(before.note, '  Мои слова.  ');
    assert.equal(before.revision, 7);
    assert.equal(before.aiComment, undefined);
    await meals.replaceMeal({...before, aiComment:'Food cannot be identified yet.'});
    await meals.initializeMeals();
    const reopened = await meals.getMeal('legacy');
    assert.equal(reopened.aiComment, 'Food cannot be identified yet.');
    assert.equal(reopened.note, '  Мои слова.  ');
  } finally { sqlite.close(); }
});

test('applying a portion answer saves nutrition and only closes that question, including after restart and retry', async () => {
  const {chat, sqlite, load} = repositories();
  try {
    const meals = load(resolve(import.meta.dirname, 'mealRepository.ts'));
    const updates = load(resolve(import.meta.dirname, 'mealAgentRepository.ts'));
    await meals.initializeMeals(); await chat.initializeChat();
    await meals.saveMealRecord({id:'lunch',revision:1,capturedAt:1,status:'needs_input',note:'',photos:[],analysis:{
      title:'Rice',mealType:'lunch',items:[{name:'Rice',quantity:'200 g',calories:260,protein:5,carbs:56,fat:1}],
      totals:{calories:260,protein:5,carbs:56,fat:1},clarification:{questions:['How much?', 'Which sauce?'],impactCalories:150},
    }});
    const thread = await chat.ensureClarificationThread('lunch','Rice');
    const before = await meals.getMeal('lunch');
    const questions = await updates.getMealAgentQuestions('lunch',thread.id);
    assert.equal(questions.length,2);
    const result = await updates.commitMealAgentEdit({callId:'portion-1',threadId:thread.id,mealId:'lunch',expectedRevision:before.revision,
      edit:{items:[{name:'Rice',quantity:'100 g',calories:130,protein:2.5,carbs:28,fat:0.5}]},
      resolutions:[{id:questions[0].id,state:'answered',answer:'Ate half'}],
    });
    assert.equal(result.meal.analysis.totals.calories,130);
    assert.deepEqual(JSON.parse(JSON.stringify(result.meal.analysis.clarification.questions)),['Which sauce?']);
    assert.equal(result.meal.status,'needs_input');
    const reloaded = await meals.getMeal('lunch');
    assert.equal(reloaded.questions.find((q:any)=>q.id===questions[0].id).answer,'Ate half');
    const repeated = await updates.commitMealAgentEdit({callId:'portion-1',threadId:thread.id,mealId:'lunch',expectedRevision:before.revision,edit:{items:[]}});
    assert.equal(repeated.meal.revision,reloaded.revision,'same committed tool call returns its receipt without a second mutation');
    assert.equal((await chat.listChatActions(thread.id)).length,1);
  } finally {sqlite.close();}
});

test('Undo restores question state as well as nutrition after an uncertain answer', async () => {
  const {chat, sqlite, load} = repositories();
  try {
    const meals = load(resolve(import.meta.dirname, 'mealRepository.ts'));
    const updates = load(resolve(import.meta.dirname, 'mealAgentRepository.ts'));
    await meals.initializeMeals(); await chat.initializeChat();
    await meals.saveMealRecord({id:'soup',revision:1,capturedAt:1,status:'needs_input',note:'',photos:[],analysis:{
      title:'Soup',mealType:'lunch',items:[{name:'Soup',quantity:'1 bowl',calories:200,protein:10,carbs:20,fat:9}],
      totals:{calories:200,protein:10,carbs:20,fat:9},clarification:{questions:['How much oil?'],impactCalories:150},
    }});
    const thread=await chat.ensureClarificationThread('soup','Soup');
    const before=await meals.getMeal('soup');
    const result=await updates.commitMealAgentEdit({callId:'unknown-oil',threadId:thread.id,mealId:'soup',expectedRevision:before.revision,
      edit:{},resolutions:[{id:before.questions[0].id,state:'answered',answer:'I do not know',uncertain:true}]});
    assert.equal(result.meal.analysis.totals.calories,200);
    assert.equal(result.meal.status,'estimated','an unknown answer is recorded without inventing certainty');
    assert.equal(result.meal.analysis.clarification,undefined);
    await meals.replaceMeal(before);
    const restored=await meals.getMeal('soup');
    assert.equal(restored.questions[0].state,'open');
    assert.equal(restored.questions[0].answer,undefined);
    assert.equal(restored.analysis.clarification.questions[0],'How much oil?');
  } finally {sqlite.close();}
});

test('a stale or invalid meal update cannot partially resolve questions',async()=>{
  const {chat,sqlite,load}=repositories();
  try{
    const meals=load(resolve(import.meta.dirname,'mealRepository.ts'));
    const updates=load(resolve(import.meta.dirname,'mealAgentRepository.ts'));
    await meals.initializeMeals();await chat.initializeChat();
    await meals.saveMealRecord({id:'safe',revision:1,capturedAt:1,status:'needs_input',note:'',photos:[],analysis:{title:'Rice',mealType:'lunch',items:[],totals:{calories:0,protein:0,carbs:0,fat:0},clarification:{questions:['How much?'],impactCalories:120}}});
    const thread=await chat.ensureClarificationThread('safe','Rice');
    const before=await meals.getMeal('safe');
    const input={callId:'invalid',threadId:thread.id,mealId:'safe',expectedRevision:before.revision,
      edit:{items:[{name:'Rice',quantity:'100 g',calories:-100,protein:1,carbs:1,fat:1}]},
      resolutions:[{id:before.questions[0].id,state:'answered',answer:'100 g'}]};
    await assert.rejects(updates.commitMealAgentEdit(input),/nutrition|non-negative/i);
    assert.equal((await meals.getMeal('safe')).questions[0].state,'open');
    await meals.setMealStatus('safe','needs_input');
    await assert.rejects(updates.commitMealAgentEdit({...input,edit:{note:'changed'}}),/changed/);
    assert.equal((await meals.getMeal('safe')).note,'');
    assert.equal((await chat.listChatActions(thread.id)).length,0);
  }finally{sqlite.close();}
});

test('deleting a meal removes its question state before the ID can be used again',async()=>{
  const {chat,sqlite,load}=repositories();
  try{
    const meals=load(resolve(import.meta.dirname,'mealRepository.ts'));
    await meals.initializeMeals();await chat.initializeChat();
    await meals.saveMealRecord({id:'deleted',revision:1,capturedAt:1,status:'needs_input',note:'',photos:[],analysis:{title:'Rice',mealType:'lunch',items:[],totals:{calories:0,protein:0,carbs:0,fat:0},clarification:{questions:['Old question?'],impactCalories:150}}});
    assert.equal((await meals.getMeal('deleted')).questions.length,1);
    await meals.deleteMeal('deleted');
    await meals.createMeal({id:'deleted',capturedAt:2,note:'New meal',photos:[]});
    assert.equal((await meals.getMeal('deleted')).questions.length,0);
  }finally{sqlite.close();}
});

test('the permanent meal conversation reuses existing history and does not delete another open chat',async()=>{
  const {chat,sqlite,load}=repositories();
  try{
    const meals=load(resolve(import.meta.dirname,'mealRepository.ts'));
    await meals.initializeMeals();await chat.initializeChat();
    const existing=await chat.createChatThread({mealId:'historic',purpose:'meal',title:'Old meal conversation'});
    await chat.appendInlineMealAnswer(existing.id,'Already answered yesterday');
    const blank=await chat.createChatThread();
    const primary=await chat.ensureMealThread('historic','Meal');
    assert.equal(primary.id,existing.id);
    assert.equal((await chat.loadChatMessages(primary.id))[0].text,'Already answered yesterday');
    await chat.ensureMealThread('new-meal','New meal');
    assert.ok((await chat.listChatThreads()).some((thread:any)=>thread.id===blank.id));
  }finally{sqlite.close();}
});
