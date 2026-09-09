import assert from 'node:assert/strict';
import test from 'node:test';
import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models';
import type { AiDiagnosticEvent } from '../data/mealRepository';
import { fixture, meals, token } from '../test/mealAgentFixture.ts';

fixture.enabled = true;
fixture.search = true;
fixture.respond = async () => [
  ...(fixture.search ? [{type: 'web_search_call', id: 's', status: 'completed', action: {sources: [{url: 'https://source.test/drink', title: 'Drink'}]}}] : []),
  {type: 'message', id: 'msg', status: 'completed', role: 'assistant', content: [{type: 'output_text', text: '{"title":"Spritz"}', annotations: []}]},
];
const {refineMealAnalysis,analyzeMeal}=await import('./piClient.ts');
const input={mealId:'meal',photos:[],previousJson:'{}',question:'How much?',answer:'Google it, I drank the whole bottle',language:'English' as const};
test('real meal request forces search through Pi and returns provider evidence',async()=>{
  const result=await refineMealAnalysis(input);
  assert.deepEqual(fixture.payload.tool_choice,{type:'web_search'});
  assert.equal(result.research.status,'completed');
  assert.equal(result.research.sources[0].url,'https://source.test/drink');
  assert.equal((await meals.listDiagnosticEvents()).find((event): event is AiDiagnosticEvent => event.operation === 'clarify' && !event.phase)?.searchStatus,'completed');
});
test('a provider that ignores forced search cannot return a successful meal estimate',async()=>{
  fixture.search=false;
  await assert.rejects(refineMealAnalysis(input),/search could not be verified/);
  assert.equal((await meals.listDiagnosticEvents()).find((event): event is AiDiagnosticEvent => event.operation === 'clarify' && !event.phase)?.searchStatus,'not_searched');
});
test('disabled search remains disabled and is reported as unavailable',async()=>{
  fixture.enabled=false;
  const result=await refineMealAnalysis(input);
  assert.equal(result.research.status,'unavailable');
  assert.ok(fixture.payload.tools.every((tool: any) => tool.type === 'function'));
  assert.equal(fixture.payload.tool_choice,'auto');
});

test('test capture observes the real mobile Codex wire payload and parsed answer', async () => {
  fixture.enabled = true;
  fixture.search = false;
  fixture.model = { ...Object.values(OPENAI_CODEX_MODELS).find(model => model.id === 'gpt-5.6-terra'), reasoning: false };
  fixture.diagnostics.arm();
  // React Native has no Node zlib; exercise Pi's actual uncompressed mobile path.
  const getBuiltinModule = process.getBuiltinModule;
  process.getBuiltinModule = ((name: string) => name === 'node:zlib' ? undefined : getBuiltinModule(name)) as typeof getBuiltinModule;
  try {
    const result = await analyzeMeal({ mealId: 'photo-test', photos: [{ base64: 'aW1hZ2U=', mimeType: 'image/jpeg' }], language: 'Russian' });
    assert.equal(fixture.trace.state, 'complete');
    assert.equal(fixture.trace.requests[0].body.model, fixture.payload.model);
    assert.deepEqual(fixture.trace.requests[0].body.input, fixture.payload.input);
    assert.ok(JSON.stringify(fixture.trace.requests[0].body.input).includes('data:image/jpeg;base64,aW1hZ2U='));
    assert.equal(fixture.trace.responses[0].text, result.text);
    assert.equal(fixture.trace.responses[0].responseId, 'resp-test');
    assert.equal(JSON.stringify(fixture.trace).includes(token), false);
  } finally { process.getBuiltinModule = getBuiltinModule; }
});

test('a text-only meal actively requests search without making artwork a prerequisite for nutrition', async () => {
  fixture.enabled = true;
  fixture.search = false;
  const result = await analyzeMeal({ mealId: 'text-image', photos: [], note: 'Two eggs on toast', language: 'English' });
  assert.deepEqual(fixture.payload.tool_choice, { type: 'web_search' });
  assert.equal(result.research.status, 'not_searched');
  fixture.enabled = false;
  await analyzeMeal({ mealId: 'text-offline', photos: [], note: 'Two eggs on toast', language: 'English' });
  assert.ok(fixture.payload.tools.every((tool: any) => tool.type === 'function'));
});

test('automatic artwork search respects an explicit request not to search', async () => {
  fixture.enabled = true;
  for (const note of ['Two eggs. Do not search the web.', 'Два яйца. Не ищи в интернете.']) {
    await analyzeMeal({ mealId: 'no-search', photos: [], note, language: 'English' });
    assert.equal(fixture.payload.tool_choice, 'auto');
  }
});
