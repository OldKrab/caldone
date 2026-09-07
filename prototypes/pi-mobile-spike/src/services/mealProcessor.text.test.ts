import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = { note: 'Two eggs and toast', input: undefined as any, saved: undefined as any, failures: [] as string[], withWebImage: false };
(globalThis as any).__textMeal = fixture;
const sources: Record<string, string> = {
  './foregroundWork': 'export const beginForegroundWork=async()=>async()=>{};',
  'expo/fetch': `export const fetch=async()=>new Response('<head><meta property="og:image" content="https://cdn.example.com/eggs.jpg"></head>',{headers:{'content-type':'text/html'}});`,
  'expo-file-system': 'export class File { constructor(){throw new Error("Text meals must not read image files")} }',
  'expo-notifications': 'export const setNotificationHandler=()=>{};',
  'react-native': 'export const AppState={currentState:"active"};export const Platform={OS:"android"};',
  '../ai/piClient': `export async function analyzeMeal(input){globalThis.__textMeal.input=input;return {text:JSON.stringify({webImageSourceUrl:globalThis.__textMeal.withWebImage?'https://food.example.com/eggs':undefined,title:'Eggs and toast',mealType:'breakfast',items:[{name:'Eggs and toast',quantity:'1 portion',calories:250,protein:15,carbs:20,fat:12}],totals:{calories:250,protein:15,carbs:20,fat:12}}),research:globalThis.__textMeal.withWebImage?{status:'completed',sources:[{url:'https://food.example.com/eggs',title:'Eggs'}]}:undefined}};export const correctMealAnalysis=()=>{};export const refineMealAnalysis=()=>{};`,
  '../data/mealRepository': `export const getMeal=async()=>({id:'text-meal',photos:[],note:globalThis.__textMeal.note,status:'queued'});
    export const listProcessableMeals=async()=>[{id:'text-meal'}];
    export const saveMealAnalysis=async(id,analysis)=>{globalThis.__textMeal.saved=analysis};
    export const recordMealFailure=async(id,error)=>{globalThis.__textMeal.failures.push(error);return false};
    export const getPreference=async()=>null;export const savePreference=async()=>{};export const setMealStatus=async()=>{};`,
  '../data/chatRepository': 'export const appendInlineMealAnswer=async()=>{};export const ensureClarificationThread=async()=>({id:"thread"});export const syncMealQuestionsToThread=async()=>{};',
  '../i18n': 'export const locale="en";export const t=x=>x;',
};
const hooks=registerHooks({resolve(specifier,context,next){
  if(sources[specifier])return {url:'data:text/javascript,'+encodeURIComponent(sources[specifier]),shortCircuit:true};
  if(specifier.startsWith('.') && context.parentURL?.startsWith('file:')){
    const url=new URL(specifier+'.ts',context.parentURL);
    if(existsSync(fileURLToPath(url)))return next(url.href,context);
  }
  return next(specifier,context);
}});
const {processPendingMeals}=await import('./mealProcessor.ts');
test('queued text meals are analyzed and saved without accessing photo storage',async()=>{
  try {
    await processPendingMeals();
    assert.deepEqual(fixture.failures,[]);
    assert.equal(fixture.input.note,'Two eggs and toast');
    assert.deepEqual(fixture.input.photos,[]);
    assert.equal(fixture.saved.title,'Eggs and toast');
    fixture.withWebImage=true;
    await processPendingMeals();
    assert.deepEqual(fixture.failures,[]);
    assert.deepEqual(fixture.input.photos,[]);
    assert.deepEqual(fixture.saved.webImage,{url:'https://cdn.example.com/eggs.jpg',sourceUrl:'https://food.example.com/eggs'});
    fixture.note=' ';
    fixture.input=undefined;
    await processPendingMeals();
    assert.equal(fixture.input,undefined);
    assert.equal(fixture.failures.length,1,'empty meals must not reach the provider');
  } finally {hooks.deregister();}
});
