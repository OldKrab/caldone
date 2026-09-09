import assert from 'node:assert/strict';
import test from 'node:test';
import { requestWithDeadline } from './requestDeadline.ts';

test('a stalled analysis settles at its deadline even when the transport ignores abort',async()=>{
  let signal:AbortSignal|undefined;
  await assert.rejects(requestWithDeadline(s=>{signal=s;return new Promise(()=>{})},undefined,15),/timed out/);
  assert.equal(signal?.aborted,true);
});

test('user cancellation interrupts waiting without waiting for a network response',async()=>{
  const controller=new AbortController();
  const pending=requestWithDeadline(()=>new Promise(()=>{}),controller.signal,1000);
  controller.abort();
  await assert.rejects(pending,/cancelled/);
});
