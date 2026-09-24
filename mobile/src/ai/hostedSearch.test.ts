import assert from 'node:assert/strict';
import test from 'node:test';
import { trackedSearchFetch, withHostedSearch } from './hostedSearch.ts';

const sse = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers:{'content-type':'text/event-stream'}});

test('required meal research forces the hosted tool while preserving provider options', () => {
  const payload = withHostedSearch({tools:[],include:['reasoning.encrypted_content']}, true);
  assert.deepEqual(payload.tool_choice, {type:'web_search'});
  assert.deepEqual(payload.include, ['reasoning.encrypted_content','web_search_call.action.sources']);
});

test('search evidence comes from the consumed provider response, not model text', async () => {
  const tracked = trackedSearchFetch(async () => sse([
    {type:'response.output_item.done',item:{type:'web_search_call',id:'s1',status:'completed',action:{sources:[{url:'https://example.org/product',title:'Product'}]}}},
    {type:'response.completed',response:{id:'resp-1'}},
  ]));
  const response = await tracked.fetch('https://provider.test');
  await response.text();
  assert.deepEqual(await tracked.result(), {status:'completed',sources:[{url:'https://example.org/product',title:'Product'}],responseId:'resp-1'});
});

test('no search, failed search, and broken observation remain distinguishable', async () => {
  for (const [events,status] of [
    [[{type:'response.completed',response:{id:'r'}}],'not_searched'],
    [[{type:'response.output_item.done',item:{type:'web_search_call',id:'s',status:'failed'}},{type:'response.completed'}],'failed'],
    [[{type:'response.web_search_call.in_progress',item_id:'s'}],'unobserved'],
  ] as const) {
    const tracked=trackedSearchFetch(async()=>sse([...events]));
    await (await tracked.fetch('https://provider.test')).text();
    assert.equal((await tracked.result()).status,status);
  }
  const tracked=trackedSearchFetch(async()=>{const response=sse([]);response.clone=()=>{throw Error('unsupported')};return response});
  await tracked.fetch('https://provider.test');
  assert.equal((await tracked.result()).status,'unobserved');
});

test('a terminal provider event settles observation without waiting for the connection to close', async () => {
  const tracked=trackedSearchFetch(async()=>new Response(new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"id":"r","output":[]}}\n\n'));
  }}),{headers:{'content-type':'text/event-stream'}}));
  await tracked.fetch('https://provider.test');
  const result=await Promise.race([tracked.result(),new Promise(resolve=>setTimeout(()=>resolve('timed out'),50))]);
  assert.notEqual(result,'timed out');
});
