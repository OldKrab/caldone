import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MealRequestDiagnostics } from './mealRequestTrace.ts';

test('only the armed analysis records the transmitted photo and response without auth headers', async () => {
  let saved: any;
  const diagnostics = new MealRequestDiagnostics({ read: () => saved, write: value => { saved = value; } });
  assert.equal(diagnostics.begin({ mealId: 'normal' }), undefined);
  diagnostics.arm();
  const capture = diagnostics.begin({ mealId: 'test', sourcePhotos: [{ base64: 'aW1hZ2U=', mimeType: 'image/jpeg' }] })!;
  assert.ok(capture);
  assert.equal(diagnostics.begin({ mealId: 'other' }), undefined);
  const payload = { model: 'gpt-5.6-terra', input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/jpeg;base64,aW1hZ2U=' }] }], reasoning: { effort: 'high' } };
  const init = { method: 'POST', headers: { Authorization: 'Bearer secret' }, body: JSON.stringify(payload) };
  const response = new Response('data: streamed response\n\n');
  const fetch = capture.wrapFetch(async (url, options) => {
    assert.equal(url, 'https://example.com/responses?token=secret');
    assert.equal(options, init);
    return response;
  });
  assert.equal(await fetch('https://example.com/responses?token=secret', init), response);
  capture.response({ text: 'Куриная грудка', responseId: 'response-1', stopReason: 'stop' });
  capture.finish();
  assert.deepEqual(saved.requests[0].body, payload);
  assert.equal(saved.requests[0].endpoint, 'https://example.com/responses');
  assert.equal(saved.responses[0].text, 'Куриная грудка');
  assert.equal(saved.state, 'complete');
  assert.equal(JSON.stringify(saved).includes('secret'), false);
  assert.equal(await response.text(), 'data: streamed response\n\n');
});

test('capture survives reconstruction and deletion prevents late callbacks restoring a photo', async () => {
  let serialized: string | undefined;
  const store = { read: () => serialized ? JSON.parse(serialized) : undefined, write: (value: any) => { serialized = value ? JSON.stringify(value) : undefined; } };
  new MealRequestDiagnostics(store).arm();
  const diagnostics = new MealRequestDiagnostics(store);
  const old = diagnostics.begin({ mealId: 'old' })!;
  diagnostics.arm();
  const next = diagnostics.begin({ mealId: 'new' })!;
  old.finish(new Error('old failed'));
  assert.equal(diagnostics.read()?.metadata?.mealId, 'new');
  diagnostics.clear();
  next.response({ text: 'late response' });
  next.finish();
  assert.equal(diagnostics.read(), undefined);
});

test('diagnostic write failures do not consume or break the request', async () => {
  let saved: any;
  let broken = false;
  const diagnostics = new MealRequestDiagnostics({ read: () => saved, write: value => { if (broken) throw Error('disk full'); saved = value; } });
  diagnostics.arm();
  const capture = diagnostics.begin({ mealId: 'test' })!;
  broken = true;
  const response = new Response('ok');
  assert.equal(await capture.wrapFetch(async () => response)('https://example.com', { body: '{}' }), response);
  capture.response({ text: 'ok' });
  capture.finish();
});
