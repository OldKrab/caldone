import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MealRequestDiagnostics } from '../ai/mealRequestTrace.ts';
import { zstdDecompressSync } from 'node:zlib';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-codex-responses';
import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models';

// Exercise the processor, repositories and provider request together. Only the
// native bridges, credentials and external HTTP response are substituted.
const sqlite = new DatabaseSync(':memory:');
export const token = 'test.' + btoa(JSON.stringify({'https://api.openai.com/auth': {chatgpt_account_id: 'fixture'}})) + '.test';
export const fixture: any = {
  model: {...Object.values(OPENAI_CODEX_MODELS).find(model => model.input.includes('image'))!, reasoning: false},
  requests: [], Agent, Type, enabled: false,
  database: {
    async execAsync(sql: string) { sqlite.exec(sql); },
    async runAsync(sql: string, ...args: any[]) { return sqlite.prepare(sql).run(...args); },
    async getFirstAsync(sql: string, ...args: any[]) { return sqlite.prepare(sql).get(...args); },
    async getAllAsync(sql: string, ...args: any[]) { return sqlite.prepare(sql).all(...args); },
  },
};
fixture.diagnostics = new MealRequestDiagnostics({read: () => fixture.trace, write: value => { fixture.trace = value; }});
fixture.stream = (model: any, context: any, options: any) => streamSimple(model, context, {...options, apiKey: token});
fixture.fetch = async (_url: any, init: any) => {
  const payload = JSON.parse(typeof init.body === 'string' ? init.body : zstdDecompressSync(init.body).toString());
  fixture.requests.push(payload);
  fixture.payload = payload;
  const analysis = await fixture.respond(payload);
  if (analysis instanceof Response) return analysis;
  const output = Array.isArray(analysis) ? analysis : [{type: 'message', id: 'msg', status: 'completed', role: 'assistant', content: [
    {type: 'output_text', text: JSON.stringify(analysis), annotations: []},
  ]}];
  const events = [
    ...output.map(item => ({type: 'response.output_item.done', item})),
    {type: 'response.completed', response: {id: 'resp-test', status: 'completed', output, usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}}},
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}});
};
(globalThis as any).__clarification = fixture;
const sources: Record<string, string> = {
  '@earendil-works/pi-ai': `export const contentText=content=>content.filter(x=>x.type==='text').map(x=>x.text).join('');
    export const Type=globalThis.__clarification.Type;export const getSupportedThinkingLevels=()=>[];export const createModels=()=>({setProvider(){},getModel:()=>globalThis.__clarification.model,getModels:()=>[globalThis.__clarification.model],streamSimple:(...args)=>globalThis.__clarification.stream(...args)});`,
  '@earendil-works/pi-agent-core': 'export const Agent=globalThis.__clarification.Agent;',
  'react-native': 'export const AppState={currentState:"active"};export const Platform={OS:"android"};',
  'expo/fetch': 'export const fetch=(...args)=>globalThis.__clarification.fetch(...args);',
  'expo-sqlite': 'export const openDatabaseSync=()=>globalThis.__clarification.database;',
  'expo-file-system': 'export class File {constructor(uri){this.uri=uri}async base64(){return this.uri.includes("previous")?"cHJldmlvdXM=":"cGhvdG8="}} export class Directory {} export const Paths={};',
  'expo-notifications': `export const setNotificationHandler=()=>{};
    export const AndroidImportance={DEFAULT:3};
    export const SchedulableTriggerInputTypes={DATE:'date'};
    export const setNotificationChannelAsync=async()=>{};
    export const setNotificationCategoryAsync=async()=>{};
    export const getPermissionsAsync=async()=>globalThis.__clarification.notifications.permission;
    export const requestPermissionsAsync=async()=>globalThis.__clarification.notifications.request();
    export const scheduleNotificationAsync=async request=>globalThis.__clarification.notifications.schedule(request);
    export const cancelScheduledNotificationAsync=async id=>globalThis.__clarification.notifications.cancel(id);`,
  'expo-secure-store': 'export const getItemAsync=async key=>key.includes("web-search")?String(globalThis.__clarification.enabled):null;',
  '../services/mealRequestTraceStore': 'export const mealRequestDiagnostics=globalThis.__clarification.diagnostics;',
  './mobileRuntime': 'export const installPiMobileRuntime=()=>{};',
  './mobileProviders': 'export const mobilePiProviders=()=>[];',
  './openaiCodexMobileProvider': 'export const openaiCodexMobileProvider=()=>({});',
  './secureCredentialStore': 'export class SecureCredentialStore {}',
  '../services/foregroundRecovery': 'export const waitForConnectionRecovery=async()=>{};',
  './foregroundRecovery': 'export const waitForConnectionRecovery=async()=>{};',
  './foregroundWork': 'export const beginForegroundWork=async()=>async()=>{};',
  '../i18n': 'export const locale="ru";export const t=x=>x;',
};
const hooks = registerHooks({resolve(specifier, context, next) {
  if (sources[specifier]) return {url: 'data:text/javascript,' + encodeURIComponent(sources[specifier]), shortCircuit: true};
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
}});
export const meals = await import('../data/mealRepository.ts');
export const chat = await import('../data/chatRepository.ts');
await meals.initializeMeals();
await chat.initializeChat();
test.after(() => { hooks.deregister(); sqlite.close(); });

