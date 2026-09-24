import assert from 'node:assert/strict';
import test from 'node:test';
import { retryConnection, connectionErrorText, continuationMessages } from './connectionRecovery.ts';

test('connection abort waits for foreground recovery and retries once', async () => {
  const order:string[]=[];
  let calls=0;
  const result=await retryConnection(async()=>{
    order.push('request');
    if (++calls===1) throw new Error('Software caused connection abort');
    return 'saved';
  },async()=>{order.push('foreground');});
  assert.equal(result,'saved');
  assert.deepEqual(order,['request','foreground','request']);
});
test('persistent DNS failure stops after two attempts; auth is never retried',async()=>{
  for(const [error,expected] of [['UnknownHostException: chatgpt.com',2],['401 Unauthorized',1]] as const){
    let calls=0;
    await assert.rejects(retryConnection(async()=>{calls++;throw new Error(error)},async()=>{}));
    assert.equal(calls,expected);
  }
  assert.match(connectionErrorText('UnknownHostException: chatgpt.com','en'),/connection/i);
});
test('retry keeps completed tool results and drops only failed assistant response',()=>{
  const user={role:'chatUser',text:'Update my meal'};
  const tool={role:'toolResult',toolCallId:'saved',content:[]};
  const failed={role:'assistant',stopReason:'error',errorMessage:'Software caused connection abort'};
  assert.deepEqual(continuationMessages([user,tool,failed]),[user,tool]);
  assert.equal(continuationMessages([user,{role:'assistant',stopReason:'stop'}]),undefined);
});
