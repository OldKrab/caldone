import {nativeAgentHarness,toolOutput,textOutput} from './nativeAgentHarness.ts';
const [path,mode]=process.argv.slice(2);
const harness=nativeAgentHarness({databasePath:path});
const {fixture}=harness;
const client=await import('../ai/piClient.ts');
const meals=await import('../data/mealRepository.ts');
const chat=await import('../data/chatRepository.ts');
const {answerMealClarification}=await import('../services/mealProcessor.ts');
const {resumeMealConversation}=await import('../services/mealConversation.ts');
await meals.initializeMeals();await chat.initializeChat();
await client.connectProvider('openai-codex','oauth',{onEvent(){}});
fixture.respond=async payload=>{
  if(payload.input.at(-1)?.type==='function_call_output')return [textOutput('Сохранил 100 г.')];
  const meal=(await meals.getMeal('crash'))!;
  return [toolOutput('edit_meal',{mealId:'crash',expectedRevision:meal.revision,
    items:[{name:'Rice',quantity:'100 g',calories:130,protein:2.5,carbs:28,fat:0.5}],
    resolutions:[{id:meal.questions![0].id,state:'answered',answer:'100 g'}]},'crash-save')];
};
if(mode==='crash'){
  await meals.saveMealRecord({id:'crash',revision:1,capturedAt:1,status:'needs_input',note:'Rice',photos:[],analysis:{
    title:'Rice',mealType:'lunch',items:[{name:'Rice',quantity:'200 g',calories:260,protein:5,carbs:56,fat:1}],
    totals:{calories:260,protein:5,carbs:56,fat:1},clarification:{questions:['How much?'],impactCalories:150},
  }});
  let receiptWritten=false;
  const run=fixture.database.runAsync,exec=fixture.database.execAsync;
  fixture.database.runAsync=async(sql,...args)=>{
    const result=await run(sql,...args);
    if(sql.includes('INSERT INTO chat_tool_receipts'))receiptWritten=true;
    return result;
  };
  fixture.database.execAsync=async sql=>{
    await exec(sql);
    // Simulate Android killing the process after a durable meal update, before
    // the agent can persist its toolResult or finish its turn.
    if(sql==='COMMIT' && receiptWritten)process.exit(86);
  };
  await answerMealClarification('crash','100 g');
  throw new Error('The expected crash point was not reached');
}else{
  await resumeMealConversation('crash');
  const thread=(await chat.preferredMealThread('crash',false))!;
  const messages=await chat.loadChatMessages(thread.id);
  const meal=(await meals.getMeal('crash'))!;
  console.log(JSON.stringify({calories:meal.analysis!.totals.calories,revision:meal.revision,
    users:messages.filter(m=>m.role==='chatUser').length,actions:(await chat.listChatActions(thread.id)).length,
    requests:fixture.requests.length,restoredResult:fixture.requests[0]?.input.find((i:any)=>i.type==='function_call_output')?.output}));
  harness.close();
}
