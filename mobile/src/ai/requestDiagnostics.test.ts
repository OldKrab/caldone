import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { requestDiagnostics, recordToolDiagnostic } from './requestDiagnostics.ts';

test('diagnostics tie an outbound photo to the server request without storing its bytes or credentials', async () => {
  const events: any[] = [];
  const bytes = Buffer.from('the actual photo bytes');
  const payload = {model: 'vision-model', instructions: 'Private meal instructions', input: [{role: 'user', content: [
    {type: 'input_text', text: 'Private meal note'},
    {type: 'input_image', image_url: 'data:image/jpeg;base64,' + bytes.toString('base64')},
  ]}]};
  const response = new Response('stream untouched', {headers: {'x-request-id': 'server-request'}});
  const trace = requestDiagnostics({provider: 'openai-codex', model: 'vision-model', api: 'openai-codex-responses', mealId: 'meal'}, async event => {events.push(event);});
  await trace.onPayload(payload);
  const returned = await trace.wrapFetch(async () => response)('https://chatgpt.com/backend-api/codex/responses', {
    headers: {Authorization: 'Bearer secret-token'}, body: JSON.stringify(payload), method: 'POST',
  });
  assert.equal(returned, response);
  assert.equal(await returned.text(), 'stream untouched');
  assert.equal(events[0].requestId, events[1].requestId);
  assert.deepEqual(events[0].images, [{mimeType: 'image/jpeg', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}]);
  assert.equal(events[1].httpStatus, 200);
  assert.equal(events[1].serverRequestId, 'server-request');
  const saved = JSON.stringify(events);
  for (const privateValue of ['secret-token', bytes.toString('base64'), 'Private meal instructions', 'Private meal note']) assert.ok(!saved.includes(privateValue));
});

test('tool diagnostics distinguish a returned photo from a failed photo lookup', async () => {
  const events: any[] = [];
  const record = async (event: any) => {events.push(event);};
  const context = {threadId: 'thread', toolCallId: 'photo-call', toolName: 'view_meal_photos'};
  await recordToolDiagnostic({...context, phase: 'started', value: {mealId: 'meal'}}, record);
  await recordToolDiagnostic({...context, phase: 'completed', value: {content: [{type: 'image', mimeType: 'image/jpeg', data: btoa('photo')}]}, isError: false}, record);
  await recordToolDiagnostic({...context, toolCallId: 'failed-call', phase: 'completed', value: {content: [{type: 'text', text: 'Private storage error'}]}, isError: true}, record);
  assert.equal(events[0].toolCallId, events[1].toolCallId);
  assert.equal(events[1].images.length, 1);
  assert.equal(events[1].isError, false);
  assert.equal(events[2].isError, true);
  assert.deepEqual(events[2].images, []);
  assert.ok(!JSON.stringify(events).includes('Private storage error'));
});
