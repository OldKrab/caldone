import type { MealResearch } from '../domain/mealResearch.ts';
import { providerActivityFromEvent, type ProviderToolActivity } from './providerActivityEvent.ts';

export function withHostedSearch(payload: unknown, required = false): Record<string, unknown> {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const include = Array.isArray(body.include) ? body.include : [];
  return {
    ...body,
    tools: tools.some(tool => tool?.type === 'web_search') ? tools : [...tools, {type:'web_search'}],
    include: [...new Set([...include, 'web_search_call.action.sources'])],
    ...(required ? {tool_choice:{type:'web_search'}} : {}),
  };
}

/** Await the observer before trusting its result. Cloning is optional for UI,
 * but a missing/truncated observation must never masquerade as an unused tool.
 * Each HTTP attempt replaces the preceding observation (including provider retries). */
export function trackedSearchFetch(baseFetch: typeof globalThis.fetch, onActivity?: (activity: ProviderToolActivity) => void) {
  let observation: Promise<MealResearch> = Promise.resolve({status:'unobserved',sources:[]});
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await baseFetch(input, init);
    try {
      observation = response.body && response.headers.get('content-type')?.includes('text/event-stream')
        ? observe(response.clone(), onActivity)
        : Promise.resolve({status:'unobserved',sources:[]});
    } catch {
      observation = Promise.resolve({status:'unobserved',sources:[]});
    }
    return response;
  };
  return {fetch, result: () => observation};
}

async function observe(response: Response, onActivity?: (activity: ProviderToolActivity) => void): Promise<MealResearch> {
  const calls = new Map<string, ProviderToolActivity['status']>();
  const sources = new Map<string, {url:string; title:string}>();
  let complete = false;
  let responseId: string | undefined;
  let malformed = false;
  const addSource = (value: any) => {
    if (typeof value?.url !== 'string') return;
    try {
      const url = new URL(value.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
      sources.set(value.url, {url:value.url,title:typeof value.title === 'string' ? value.title : url.hostname});
    } catch { /* A malformed provider citation cannot become a clickable source. */ }
  };
  const item = (value: any) => {
    const activity = providerActivityFromEvent({type:'response.output_item.done',item:value});
    if (activity) { calls.set(activity.id, activity.status); onActivity?.(activity); }
    if (value?.type === 'web_search_call' && Array.isArray(value.action?.sources)) value.action.sources.forEach(addSource);
    if (value?.type === 'message' && Array.isArray(value.content)) {
      for (const block of value.content) {
        for (const annotation of block.annotations ?? []) if (annotation.type === 'url_citation') addSource(annotation);
      }
    }
  };
  const emit = (chunk: string) => {
    const data = chunk.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let event: any;
    try { event = JSON.parse(data); } catch { malformed = true; return; }
    const activity = providerActivityFromEvent(event);
    if (activity) { calls.set(activity.id, activity.status); onActivity?.(activity); }
    if (event.type === 'response.output_item.done') item(event.item);
    if (event.type === 'response.completed' || event.type === 'response.done') {
      complete = true;
      responseId = event.response?.id;
      if (Array.isArray(event.response?.output)) event.response.output.forEach(item);
    }
  };
  const reader = response.body?.getReader();
  if (!reader) return {status:'unobserved',sources:[]};
  try {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const {done,value} = await reader.read();
      buffer += decoder.decode(value,{stream:!done});
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? '';
      chunks.forEach(emit);
      if (done || complete) break;
    }
    if (buffer) emit(buffer);
  } catch { malformed = true; }
  finally {
    // Do not await tee cancellation: the provider parser owns the other branch.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const statuses = [...calls.values()];
  const status = !complete || malformed ? 'unobserved' : statuses.includes('error') || statuses.includes('active') ? 'failed' : statuses.length ? 'completed' : 'not_searched';
  return {status,sources: status === 'completed' ? [...sources.values()] : [],...(responseId ? {responseId} : {})};
}
