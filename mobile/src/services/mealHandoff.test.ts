import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const initial = {title:'Spritz',mealType:'snack',items:[{name:'Spritz',quantity:'500 ml',calories:200,protein:0,carbs:50,fat:0}],totals:{calories:200,protein:0,carbs:50,fat:0},clarification:{questions:['How much?'],impactCalories:200}};
const fixture:any = {meal:{id:'m',capturedAt:1,revision:1,status:'needs_input',photos:[],note:'Spritz',analysis:initial},saved:0,questions:[],input:undefined};
(globalThis as any).__mealHandoff=fixture;
const sources:Record<string,string>={
  'expo-file-system':'export class File {} export class Directory {} export const Paths={};',
  'expo-notifications':'export const setNotificationHandler=()=>{};',
  'react-native':'export const AppState={currentState:"active"};export const Platform={OS:"android"};',
  './foregroundWork':'export const beginForegroundWork=async()=>async()=>{};',
  '../i18n':'export const locale="en";export const t=x=>x;',
  '../ai/piClient':`export const analyzeMeal=()=>{};export const correctMealAnalysis=()=>{};
    export const refineMealAnalysis=async input=>{const f=globalThis.__mealHandoff;f.input=input;
      if(f.fail)throw Error('search could not be verified');
      return {text:JSON.stringify({...f.meal.analysis,clarification:{questions:['Which variant?'],impactCalories:150},research:{status:'completed',sources:[{url:'https://invented.test'}]}}),research:{status:'completed',sources:[{url:'https://source.test/product',title:'Product'}]}}};`,
  '../data/chatRepository':`export const loadMealChatMessages=async()=>[];export const getChatToolReceipt=async()=>undefined;export const saveChatToolReceipt=async()=>{};
    export const recordChatAction=async action=>({...action,id:'a'});export const appendInlineMealAnswer=async()=>{};
    export const ensureClarificationThread=async()=>({id:'clarification-thread'});
    export const syncMealQuestionsToThread=async(threadId,mealId,questions)=>{globalThis.__mealHandoff.questions.push({threadId,questions})};`,
  '../data/mealRepository':`export const appendDiagnosticEvent=async()=>{};export const getMeal=async()=>globalThis.__mealHandoff.meal;
    export const saveMealAnalysis=async(id,analysis)=>{const f=globalThis.__mealHandoff;f.saved++;f.meal={...f.meal,analysis,revision:f.meal.revision+1}};
    export const setMealStatus=async()=>{};export const getPreference=async()=>null;
    ${['listProcessableMeals','recordMealFailure','savePreference','deleteMealIfRevision','getDailyGoals','getGoalProfile','listMeals','replaceMealIfRevision','saveDailyGoals','saveGoalProfile','saveMealRecord'].map(name=>`export const ${name}=async()=>{};`).join('')}`,
};
const hooks=registerHooks({resolve(specifier,context,next){
  if(sources[specifier])return {url:'data:text/javascript,'+encodeURIComponent(sources[specifier]),shortCircuit:true};
  if(specifier.startsWith('.') && context.parentURL?.startsWith('file:')){
    const url=new URL(specifier+'.ts',context.parentURL);
    if(existsSync(fileURLToPath(url)))return next(url.href,context);
  }
  return next(specifier,context);
}});
const {createCalDoneTools}=await import('../ai/chatTools.ts');
const {subscribeMealAnswers}=await import('./mealAnswerSubmission.ts');

test('clarification tool preserves the user request, saves observed research and publishes remaining questions in the active thread',async()=>{
  const tools=createCalDoneTools({threadId:'active-thread',attachments:new Map(),getMessages:()=>[{role:'chatUser',text:'Погугли, всю бутылку выпил',timestamp:1,attachments:[]}],onDataChanged:async()=>{}});
  const tool=tools.find(tool=>tool.name==='answer_meal_question')!;
  const result:any=await tool.execute('call-1',{mealId:'m',expectedRevision:1,interpretation:'Confirmed online: 200 kcal'},new AbortController().signal);
  assert.equal(fixture.input.answer,'Погугли, всю бутылку выпил');
  assert.equal(fixture.input.assistantInterpretation,'Confirmed online: 200 kcal');
  assert.equal(fixture.input.requireSearch,true);
  assert.equal(fixture.saved,1);
  assert.equal(fixture.meal.analysis.research.sources[0].url,'https://source.test/product');
  assert.match(result.details.value.confirmation,/source.test/);
  assert.ok(fixture.questions.some((entry:any)=>entry.threadId==='active-thread' && entry.questions.includes('Which variant?')));
});

test('failed required research preserves the previous meal and releases question submission state',async()=>{
  fixture.fail=true;
  const before=JSON.stringify(fixture.meal.analysis);
  let hidden:ReadonlySet<string>=new Set();
  const unsubscribe=subscribeMealAnswers(value=>{hidden=value});
  const tools=createCalDoneTools({threadId:'active-thread',attachments:new Map(),getMessages:()=>[{role:'chatUser',text:'Google it',timestamp:2,attachments:[]}],onDataChanged:async()=>{}});
  await assert.rejects(tools.find(tool=>tool.name==='answer_meal_question')!.execute('call-2',{mealId:'m',expectedRevision:2},new AbortController().signal),/search/);
  assert.equal(JSON.stringify(fixture.meal.analysis),before);
  assert.equal(fixture.saved,1);
  assert.equal(hidden.size,0);
  unsubscribe();
});
