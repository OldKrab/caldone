import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkLease } from './workLease.ts';

test('concurrent analyses keep the foreground service until the last owner finishes', async () => {
  const events:string[]=[];
  const work=createWorkLease(async()=>{events.push('start')},async()=>{events.push('stop')});
  const [first,second]=await Promise.all([work.acquire(),work.acquire()]);
  await first();await first();
  assert.equal(work.active(),true);
  assert.deepEqual(events,['start']);
  await second();
  assert.equal(work.active(),false);
  assert.deepEqual(events,['start','stop']);
});

test('a failed service start does not leak an owner or block future work',async()=>{
  let fail=true;
  const work=createWorkLease(async()=>{if(fail)throw Error('denied')},async()=>{});
  await assert.rejects(work.acquire(),/denied/);
  assert.equal(work.active(),false);
  fail=false;
  const release=await work.acquire();await release();
  assert.equal(work.active(),false);
});
