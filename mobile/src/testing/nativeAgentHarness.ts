import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, mkdirSync, copyFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';

/** Production agent, tools, repositories, registry and transport with only the
 * Android bridges and HTTP substituted. A live harness may supply real HTTP and
 * an in-memory OAuth credential; neither is persisted by this helper. */
export function nativeAgentHarness(
  input: {
    databasePath?: string;
    credential?: { type: 'oauth'; access: string; refresh: string; expires: number; accountId: string };
    fetch?: typeof globalThis.fetch;
  } = {},
) {
  const sqlite = new DatabaseSync(input.databasePath ?? ':memory:');
  const token =
    'test.' +
    btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture' } })) +
    '.test';
  const fixture = {
    sqlite,
    storage: new Map<string, string>([['caldone.ai.web-search.openai-codex', 'false']]),
    credential: input.credential ?? {
      type: 'oauth' as const,
      access: token,
      refresh: 'test-refresh',
      expires: Date.now() + 3600000,
      accountId: 'fixture',
    },
    requests: [] as any[],
    appState: { currentState: 'active' },
    notifications: [] as unknown[],
    foregroundNotifications: [] as { title: string; body: string }[],
    foregroundStops: 0,
    notificationPermission: false,
    notificationControls: undefined as any,
    omitSseContentType: false,
    photos: new Map<string, string>(),
    root: mkdtempSync(join(tmpdir(), 'caldone-agent-')),
    respond: async (_payload: any): Promise<any[]> => [textOutput('Done')],
    database: {
      async execAsync(sql: string) {
        sqlite.exec(sql);
      },
      async runAsync(sql: string, ...args: any[]) {
        return sqlite.prepare(sql).run(...args);
      },
      async getFirstAsync(sql: string, ...args: any[]) {
        return sqlite.prepare(sql).get(...args);
      },
      async getAllAsync(sql: string, ...args: any[]) {
        return sqlite.prepare(sql).all(...args);
      },
    },
    fetch: async (url: any, init: any): Promise<Response> => {
      if (String(url).includes('/codex/models?'))
        return input.fetch
          ? input.fetch(url, init)
          : Response.json({
              models: [
                {
                  slug: 'fixture-vision',
                  display_name: 'Fixture vision',
                  visibility: 'list',
                  input_modalities: ['text', 'image'],
                  context_window: 200000,
                  supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
                },
              ],
            });
      const payload = JSON.parse(
        typeof init.body === 'string' ? init.body : zstdDecompressSync(init.body).toString(),
      );
      fixture.requests.push(payload);
      if (input.fetch) return input.fetch(url, init);
      if (fixture.requests.length > 80) throw new Error('Unexpected agent loop');
      const response = sseResponse(await fixture.respond(payload));
      if (fixture.omitSseContentType) response.headers.delete('content-type');
      return response;
    },
    fileBase64: (uri: string) =>
      fixture.photos.get(uri) ??
      readFileSync(uri.startsWith('file:') ? fileURLToPath(uri) : uri).toString('base64'),
    fileDelete: (uri: string) => {
      fixture.photos.delete(uri);
      // Only the adapter's owned fixtures are writable. Live source photos
      // outside this directory are read-only evidence.
      if (uri.startsWith(fixture.root + '/') && existsSync(uri)) unlinkSync(uri);
    },
    existsSync,
    mkdirSync,
    copyFileSync,
  };
  (globalThis as any).__nativeAgent = fixture;
  const sources: Record<string, string> = {
    'react-native':
      'export const AppState=globalThis.__nativeAgent.appState;export const Platform={OS:"android"};',
    'expo/fetch': 'export const fetch=(...args)=>globalThis.__nativeAgent.fetch(...args);',
    'expo-sqlite': 'export const openDatabaseSync=()=>globalThis.__nativeAgent.database;',
    'expo-secure-store': `const s=globalThis.__nativeAgent.storage;export const getItemAsync=async k=>s.get(k)??null;
      export const setItemAsync=async(k,v)=>{s.set(k,v)};export const deleteItemAsync=async k=>{s.delete(k)};`,
    'expo-file-system': `const f=globalThis.__nativeAgent;
      export class Directory {constructor(...parts){this.uri=parts.map(p=>p.uri??p).join('/')}create(){f.mkdirSync(this.uri,{recursive:true})}}
      export class File {constructor(...parts){this.uri=parts.map(p=>p.uri??p).join('/')}get exists(){return f.existsSync(this.uri)}
        async base64(){return f.fileBase64(this.uri)}async copy(target){f.copyFileSync(this.uri,target.uri)}delete(){f.fileDelete(this.uri)} }
      export const Paths={document:globalThis.__nativeAgent.root};`,
    'expo-notifications': `export const setNotificationHandler=()=>{};
      export const AndroidImportance={DEFAULT:3};export const SchedulableTriggerInputTypes={DATE:'date'};
      export const setNotificationChannelAsync=async()=>{};export const setNotificationCategoryAsync=async()=>{};
      export const getPermissionsAsync=async()=>globalThis.__nativeAgent.notificationControls?.permission??({granted:globalThis.__nativeAgent.notificationPermission});
      export const requestPermissionsAsync=async()=>globalThis.__nativeAgent.notificationControls?.request();
      export const cancelScheduledNotificationAsync=async id=>globalThis.__nativeAgent.notificationControls?.cancel(id);
      export const scheduleNotificationAsync=async n=>globalThis.__nativeAgent.notificationControls?globalThis.__nativeAgent.notificationControls.schedule(n):globalThis.__nativeAgent.notifications.push(n);`,
    './mobileRuntime': 'export const installPiMobileRuntime=()=>{};',
    './mobileProviders': 'export const mobilePiProviders=()=>[];',
    './openaiCodexBrowserOAuth': `export const openaiCodexBrowserOAuth={login:async()=>({...globalThis.__nativeAgent.credential}),
      refresh:async c=>c,toAuth:async c=>({apiKey:c.access})};`,
    '../../modules/caldone-processing': `export const Processing={
      start:async(title,body)=>{globalThis.__nativeAgent.foregroundNotifications.push({title,body})},
      stop:async()=>{globalThis.__nativeAgent.foregroundStops++}
    };`,
    './foregroundRecovery': 'export const waitForConnectionRecovery=async()=>{};',
    '../services/foregroundRecovery': 'export const waitForConnectionRecovery=async()=>{};',
    '../i18n':
      'export const locale="ru";export const t=(key,values)=>key+(values?" "+JSON.stringify(values):"");',
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (sources[specifier])
        return { url: 'data:text/javascript,' + encodeURIComponent(sources[specifier]), shortCircuit: true };
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
        const url = new URL(specifier + '.ts', context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
      return next(specifier, context);
    },
  });
  return {
    ...fixture,
    fixture,
    close() {
      hooks.deregister();
      sqlite.close();
    },
  };
}

export function textOutput(text: string) {
  return {
    type: 'message',
    id: 'msg',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
}
export function toolOutput(name: string, args: unknown, id = 'call-test') {
  return {
    type: 'function_call',
    id: 'fc_' + id,
    call_id: id,
    name,
    arguments: JSON.stringify(args),
    status: 'completed',
  };
}
export function sseResponse(output: any[]): Response {
  const events = output.flatMap((item, index) => [
    { type: 'response.output_item.added', output_index: index, item },
    { type: 'response.output_item.done', output_index: index, item },
  ]);
  events.push({
    type: 'response.completed',
    response: {
      id: 'resp-test',
      status: 'completed',
      output,
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    },
  } as any);
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}
