import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const initial = {title:'Spritz',mealType:'snack',items:[{name:'Spritz',quantity:'500 ml',calories:200,protein:0,carbs:50,fat:0}],totals:{calories:200,protein:0,carbs:50,fat:0},clarification:{questions:['How much?'],impactCalories:200}};
const fixture:any = {meal:{id:'m',capturedAt:1,revision:1,status:'needs_input',photos:[],note:'Spritz',analysis:initial},saved:0,questions:[],input:undefined};
(globalThis as any).__mealHandoff=fixture;
const sources:Record<string,string>={
  'expo-file-system':'export class File {} export class Directory { create(){} } export const Paths={};',
  'expo-notifications':'export const setNotificationHandler=()=>{};',
  'react-native':'export const AppState={currentState:"active"};export const Platform={OS:"android"};',
  './foregroundWork':'export const beginForegroundWork=async()=>async()=>{};',
  '../i18n':'export const locale="en";export const t=x=>x;',
  '../ai/piClient':`export const analyzeMeal=()=>{};export const correctMealAnalysis=()=>{};
    export const refineMealAnalysis=async input=>{const f=globalThis.__mealHandoff;f.input=input;
      if(f.fail)throw Error('search could not be verified');
      return {text:JSON.stringify({...f.meal.analysis,clarification:{questions:['Which variant?'],impactCalories:150},research:{status:'completed',sources:[{url:'https://invented.test'}]}}),research:{status:'completed',sources:[{url:'https://source.test/product',title:'Product'}]}}};`,
  '../data/chatRepository':`export const getChatToolReceipt=async()=>undefined;export const saveChatToolReceipt=async()=>{};
    export const recordChatAction=async action=>({...action,id:'a'});export const appendInlineMealAnswer=async()=>{};
    export const ensureClarificationThread=async()=>({id:'clarification-thread'});
    export const syncMealQuestionsToThread=async(threadId,mealId,questions)=>{globalThis.__mealHandoff.questions.push({threadId,questions})};`,
  '../data/mealRepository':`export const appendDiagnosticEvent=async()=>{};export const getMeal=async()=>globalThis.__mealHandoff.meal;export const replaceMealIfRevision=async meal=>{globalThis.__mealHandoff.meal={...meal,revision:meal.revision+1};return globalThis.__mealHandoff.meal};
    export const saveMealAnalysis=async(id,analysis)=>{const f=globalThis.__mealHandoff;f.saved++;f.meal={...f.meal,analysis,revision:f.meal.revision+1}};
    export const setMealStatus=async()=>{};export const getPreference=async()=>null;
    ${['listProcessableMeals','recordMealFailure','savePreference','deleteMealIfRevision','getDailyGoals','getGoalProfile','listMeals','saveDailyGoals','saveGoalProfile','saveMealRecord'].map(name=>`export const ${name}=async()=>{};`).join('')}`,
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

test('an explicit weight correction scales a saved product even when earlier research failed',async()=>{
  fixture.meal={id:'m',revision:1,capturedAt:1,status:'needs_input',photos:[],error:'Search could not be verified',analysis:{title:'Chips',mealType:'snack',items:[{name:'Chips',quantity:'38 g',calories:190,protein:1.9,carbs:19,fat:11.4}],totals:{calories:190,protein:1.9,carbs:19,fat:11.4}}};
  fixture.fail=true;
  const messages:any[]=[{role:'chatUser',text:'Google this product',timestamp:1,attachments:[]},{role:'chatUser',text:'80 g of chips, not 38',timestamp:2,attachments:[]}];
  const tool=createCalDoneTools({threadId:'t',attachments:new Map(),getMessages:()=>messages,onDataChanged:async()=>{}}).find(t=>t.name==='edit_meal')!;
  await tool.execute('weight',{mealId:'m',expectedRevision:1,portionGrams:80},new AbortController().signal);
  assert.equal(fixture.meal.analysis.items[0].quantity,'80 g');
  assert.equal(fixture.meal.analysis.items[0].name,'Chips');
  assert.equal(fixture.meal.analysis.totals.calories,400);
  assert.equal(fixture.meal.error,undefined);
  assert.equal(fixture.input,undefined,'a known-weight correction must not invoke model research');
  await assert.rejects(tool.execute('conflict',{mealId:'m',expectedRevision:1,portionGrams:100},new AbortController().signal),/changed/);
});
