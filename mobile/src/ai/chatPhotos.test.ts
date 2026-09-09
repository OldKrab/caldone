import { Agent } from '@earendil-works/pi-agent-core';
import assert from 'node:assert/strict';
import test from 'node:test';
import { zstdDecompressSync } from 'node:zlib';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-codex-responses';
import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models';

// Keep Pi's real Codex request builder and SSE parser. Substitute only native
// services, credential lookup and HTTP; no real credentials or network are used.
const token='test.'+btoa(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fixture'}}))+'.test';
const fixture:any={photo:btoa('saved meal photo'),meal:{id:'m',photos:[{id:'p',uri:'file:///meal.jpg',mimeType:'image/jpeg'}]},model:{...Object.values(OPENAI_CODEX_MODELS).find(model=>model.id==='gpt-5.6-terra'),reasoning:false},search:true,enabled:true,events:[]};
fixture.stream=(model:any,context:any,options:any)=>streamSimple(model,context,{...options,apiKey:token});
fixture.fetch=async(_url:any,init:any)=>{
  fixture.payload=JSON.parse(typeof init.body === 'string' ? init.body : zstdDecompressSync(init.body).toString());
  const output=[...(fixture.search?[{type:'web_search_call',id:'s',status:'completed',action:{sources:[{url:'https://source.test/drink',title:'Drink'}]}}]:[]),{type:'message',id:'msg',status:'completed',role:'assistant',content:[{type:'output_text',text:'{"title":"Spritz"}',annotations:[]}]}];
  const events=[...output.map(item=>({type:'response.output_item.done',item})),{type:'response.completed',response:{id:'resp-test',status:'completed',output,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
  return new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
};
(globalThis as any).__chatPhotos=fixture; fixture.Agent=Agent;
const sources:Record<string,string>={
  '../services/mealRequestTraceStore':'export const mealRequestDiagnostics={begin:()=>undefined};',
  '@earendil-works/pi-agent-core':'export const Agent=globalThis.__chatPhotos.Agent;',
  '@earendil-works/pi-ai':`export const contentText=content=>content.filter(x=>x.type==='text').map(x=>x.text).join('');
    export const getSupportedThinkingLevels=()=>[];export const createModels=()=>({setProvider(){},getModel:()=>globalThis.__chatPhotos.model,getModels:()=>[globalThis.__chatPhotos.model],streamSimple:(...args)=>globalThis.__chatPhotos.stream(...args)});`,

  'react-native':'export const AppState={currentState:"active"};',
  'expo/fetch':'export const fetch=(...args)=>globalThis.__chatPhotos.fetch(...args);',
  'expo-file-system':`export class File {constructor(uri){this.uri=uri}async base64(){if(globalThis.__chatPhotos.missing)throw Error('File missing');return globalThis.__chatPhotos.photo}}export class Directory {} export const Paths={};`,
  'expo-secure-store':`export const getItemAsync=async key=>key.includes('web-search')?String(globalThis.__chatPhotos.enabled):null;`,
  './mobileRuntime':'export const installPiMobileRuntime=()=>{};',
  './mobileProviders':'export const mobilePiProviders=()=>[];',
  './openaiCodexMobileProvider':'export const openaiCodexMobileProvider=()=>({});',
  './secureCredentialStore':'export class SecureCredentialStore {}',
  '../services/foregroundRecovery':'export const waitForConnectionRecovery=async()=>{};',
  '../data/mealRepository':`export const appendDiagnosticEvent=async()=>{};export const getMeal=async()=>globalThis.__chatPhotos.meal;`,
};
registerHooks({resolve(specifier,context,next){
  if(sources[specifier])return {url:'data:text/javascript,'+encodeURIComponent(sources[specifier]),shortCircuit:true};
  if(specifier.startsWith('.') && context.parentURL?.startsWith('file:')){
    const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return next(url.href,context);
  }
  return next(specifier,context);
}});

const {createChatAgent}=await import('./piClient.ts');
const originalPhoto={type:'image',data:fixture.photo,mimeType:'image/jpeg'};
const photoReceipt:any={role:'toolResult',toolCallId:'photo',toolName:'view_meal_photos',isError:false,
  content:[{type:'text',text:'[Meal photo was shown to the assistant.]'}],details:{mealId:'m',photoIds:['p']},timestamp:1};
const imageBlocks=(payload:any):any[]=>{
  if(!payload||typeof payload!=='object')return [];
  return [...(payload.type==='input_image'?[payload]:[]),...Object.values(payload).flatMap(imageBlocks)];
};
async function askWithReceipt(receipt:any){
  const agent=await createChatAgent({systemPrompt:'Identify the saved photo',messages:[receipt],tools:[],sessionId:'photo-test'});
  await agent.prompt('Look at it again');
  assert.equal(agent.state.errorMessage,undefined);
  return fixture.payload;
}
test('a follow-up request restores a previously viewed meal photo after chat history was sanitized',async()=>{
  const payload=await askWithReceipt(photoReceipt);
  assert.deepEqual(imageBlocks(payload).map(x=>x.image_url),['data:image/jpeg;base64,'+fixture.photo]);
  assert.deepEqual(photoReceipt.content,[{type:'text',text:'[Meal photo was shown to the assistant.]'}], 'request hydration must not put image bytes into saved history');
});

test('only the previously opened photo IDs are restored, not other photos on the meal',async()=>{
  fixture.meal.photos.push({id:'other',uri:'file:///other.jpg',mimeType:'image/jpeg'});
  const payload=await askWithReceipt(photoReceipt);
  assert.equal(imageBlocks(payload).length,1);
  fixture.meal.photos.pop();
});

test('missing files and deleted meals produce an honest notice without aborting chat',async()=>{
  const meal=fixture.meal;
  try {
    for(const missingMeal of [false,true]) {
      fixture.missing=true;
      fixture.meal=missingMeal?undefined:meal;
      const payload=await askWithReceipt(photoReceipt);
      assert.equal(imageBlocks(payload).length,0);
      assert.match(JSON.stringify(payload.input),/no longer available/);
      assert.doesNotMatch(JSON.stringify(payload.input),/Meal photo was shown/);
    }
  } finally {fixture.missing=false;fixture.meal=meal;}
});

test('a fresh tool result keeps its image without adding a second copy',async()=>{
  const payload=await askWithReceipt({...photoReceipt,content:[originalPhoto]});
  assert.equal(imageBlocks(payload).length,1);
});
