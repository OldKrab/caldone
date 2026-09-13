import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';

// Exercise public settings and chat entry points with the real Pi registry,
// credential store, Codex catalog adapter and request encoder. Substitute only
// native services, interactive OAuth and external HTTP; no account is contacted.
const token = 'test.' + btoa(JSON.stringify({'https://api.openai.com/auth': {chatgpt_account_id: 'fixture'}})) + '.test';
const remote = (slug: string, extra = {}) => ({
  slug, display_name: slug, visibility: 'list', input_modalities: ['text', 'image'],
  context_window: 200000, supported_reasoning_levels: [{effort: 'low'}, {effort: 'high'}], ...extra,
});
const fixture = {
  storage: new Map<string, string>(),
  catalog: {models: [remote('future-vision-model')]},
  status: 200,
  requests: [] as {url: string; init: RequestInit}[],
  payload: undefined as any,
  credential: {type: 'oauth', access: token, refresh: 'test-refresh', expires: Date.now() + 3600000, accountId: 'fixture'},
  refreshes: 0,
  fetch: async (url: string, init: RequestInit) => {
    fixture.requests.push({url: String(url), init});
    if (String(url).includes('/codex/models?')) {
      return Response.json(fixture.catalog, {status: fixture.status});
    }
    fixture.payload = JSON.parse(typeof init.body === 'string' ? init.body : zstdDecompressSync(init.body as Uint8Array).toString());
    const item = {type: 'message', id: 'msg', status: 'completed', role: 'assistant', content: [{type: 'output_text', text: 'A pastry.', annotations: []}]};
    const events = [{type: 'response.output_item.done', item}, {type: 'response.completed', response: {
      id: 'resp', status: 'completed', output: [item], usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2},
    }}];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}});
  },
};
(globalThis as any).__modelCatalog = fixture;
const sources: Record<string, string> = {
  'react-native': 'export const AppState={currentState:"active"};',
  'expo/fetch': 'export const fetch=(...args)=>globalThis.__modelCatalog.fetch(...args);',
  'expo-file-system': 'export class File {}',
  'expo-secure-store': `const store=globalThis.__modelCatalog.storage;
    export const getItemAsync=async key=>store.get(key)??null;
    export const setItemAsync=async(key,value)=>{store.set(key,value)};
    export const deleteItemAsync=async key=>{store.delete(key)};`,
  './mobileRuntime': 'export const installPiMobileRuntime=()=>{};',
  './mobileProviders': 'export const mobilePiProviders=()=>[];',
  './openaiCodexBrowserOAuth': `export const openaiCodexBrowserOAuth={
    login:async()=>({...globalThis.__modelCatalog.credential}),
    refresh:async credential=>{globalThis.__modelCatalog.refreshes++;return {...credential,access:credential.access+'-refreshed',expires:Date.now()+3600000}},
    toAuth:async credential=>({apiKey:credential.access})};`,
  '../services/foregroundRecovery': 'export const waitForConnectionRecovery=async()=>{};',
  '../data/mealRepository': 'export const appendDiagnosticEvent=async()=>{};export const getMeal=async()=>undefined;',
};
registerHooks({resolve(specifier, context, next) {
  if (sources[specifier]) return {url: 'data:text/javascript,' + encodeURIComponent(sources[specifier]), shortCircuit: true};
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
}});
const client = await import('./piClient.ts');
const codex = () => client.getProviderOptions().find(provider => provider.id === 'openai-codex')!;
const connect = () => client.connectProvider('openai-codex', 'oauth', {onEvent() {}});
beforeEach(async () => {
  await client.signOut();
  fixture.storage.clear();
  fixture.catalog = {models: [remote('future-vision-model')]};
  fixture.status = 200;
  fixture.requests = [];
  fixture.refreshes = 0;
  fixture.credential = {...fixture.credential, expires: Date.now() + 3600000, accountId: 'fixture'};
});

test('Codex can be connected before an account-specific model list exists', async () => {
  assert.ok(codex().authTypes.includes('oauth'));
  assert.deepEqual(codex().models, []);
  await client.refreshProviderModels(true);
  assert.equal(fixture.requests.length, 0);
});

test('server-added models become selectable without a bundled entry and reach the chat request', async () => {
  await connect();
  fixture.catalog.models.push(remote('hidden-model', {visibility: 'hide'}), remote('text-model', {input_modalities: ['text']}));
  await client.refreshProviderModels(true);
  assert.deepEqual(codex().models.map(model => model.id), ['future-vision-model']);
  assert.deepEqual(codex().models[0].thinkingLevels, ['low', 'high']);
  const request = fixture.requests[0];
  assert.equal(new URL(request.url).pathname, '/backend-api/codex/models');
  assert.ok(new URL(request.url).searchParams.has('client_version'));
  assert.equal(new Headers(request.init.headers).get('Authorization'), `Bearer ${token}`);
  assert.equal(new Headers(request.init.headers).get('ChatGPT-Account-ID'), 'fixture');
  await client.selectProviderModel('openai-codex', 'future-vision-model');
  await client.selectThinkingLevel('openai-codex', 'future-vision-model', 'high');
  const agent = await client.createChatAgent({systemPrompt: 'Describe the food.', messages: [], tools: [], sessionId: 'catalog-test'});
  await agent.prompt('What is it?');
  assert.equal(agent.state.errorMessage, undefined);
  assert.equal(fixture.payload.model, 'future-vision-model');
  assert.equal(fixture.payload.reasoning.effort, 'high');
  assert.equal(fixture.requests.filter(request => request.url.includes('/codex/models?')).length, 1, 'reuse the fresh catalog');
});

test('a refreshed catalog removes retired entries and does not silently replace the selected model', async () => {
  await connect();
  await client.refreshProviderModels(true);
  await client.selectProviderModel('openai-codex', 'future-vision-model');
  fixture.catalog = {models: [remote('replacement-vision-model')]};
  await client.refreshProviderModels(true);
  assert.deepEqual(codex().models.map(model => model.id), ['replacement-vision-model']);
  await assert.rejects(client.createChatAgent({systemPrompt: '', messages: [], tools: [], sessionId: 'retired'}), /selected Codex model is unavailable/);
});

test('failed refresh preserves the last successful list and reports the failure', async () => {
  await connect();
  await client.refreshProviderModels(true);
  fixture.status = 503;
  await assert.rejects(client.refreshProviderModels(true), /HTTP 503/);
  assert.deepEqual(codex().models.map(model => model.id), ['future-vision-model']);
  fixture.status = 200;
  fixture.catalog = {models: [remote('broken', {context_window: -1})]};
  await assert.rejects(client.refreshProviderModels(true), /invalid model catalog/);
  assert.deepEqual(codex().models.map(model => model.id), ['future-vision-model']);
});

test('first request discovers models, shares concurrent refreshes and uses renewed OAuth credentials', async () => {
  fixture.credential.expires = 0;
  await connect();
  await Promise.all([client.refreshProviderModels(), client.refreshProviderModels(true)]);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.refreshes, 1);
  assert.equal(new Headers(fixture.requests[0].init.headers).get('Authorization'), `Bearer ${token}-refreshed`);
});

test('logging into another account discards the previous catalog even if discovery fails', async () => {
  await connect();
  await client.refreshProviderModels(true);
  fixture.credential.accountId = 'different-account';
  await connect();
  fixture.status = 503;
  await assert.rejects(client.refreshProviderModels(true), /HTTP 503/);
  assert.deepEqual(codex().models, []);
  await assert.rejects(client.createChatAgent({systemPrompt: '', messages: [], tools: [], sessionId: 'offline'}), /HTTP 503/);
});

test('additional input modalities do not hide an otherwise supported vision model', async () => {
  await connect();
  fixture.catalog = {models: [remote('future-vision-model', {input_modalities: ['text', 'image', 'audio']})]};
  await client.refreshProviderModels(true);
  assert.deepEqual(codex().models.map(model => model.id), ['future-vision-model']);
});
