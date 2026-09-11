import assert from 'node:assert/strict';
import test from 'node:test';
import { retryConnection, connectionErrorText, connectionErrorDetails, continuationMessages } from './connectionRecovery.ts';

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


test('provider HTML is summarized in both languages, including saved and prefixed errors', () => {
  const html = 'Error: 403 <!DOCTYPE HTML><html><body>Unable to load site <svg/> IP 192.0.2.1 request req-test</body></html>';
  for (const language of ['en', 'ru']) {
    const summary = connectionErrorText(html, language);
    assert.doesNotMatch(summary, /DOCTYPE|html|svg|192\.0\.2\.1|req-test/);
    assert.match(summary, language === 'ru' ? /сервису ИИ/ : /AI service/);
  }
});


test('details preserve diagnostic markup and identifiers but redact recognized credentials', () => {
  const error = '<html>request req-test IP 192.0.2.1</html>\nAuthorization: Bearer secret-token\nCookie: session=secret-cookie\n{"access_token":"secret-access","refresh_token":"secret-refresh","api_key":"secret-key"}\nhttps://example.test/?token=secret-query&request_id=req-test';
  const details = connectionErrorDetails(error);
  assert.match(details, /<html>request req-test IP 192\.0\.2\.1<\/html>/);
  assert.match(details, /request_id=req-test/);
  assert.doesNotMatch(details, /secret-/);
  assert.match(details, /\[redacted\]/);
});


test('markup containing transport phrases is not automatically retried', async () => {
  let calls = 0;
  await assert.rejects(retryConnection(async () => {
    calls++;
    throw new Error('<body>403 Forbidden: fetch failed</body>');
  }, async () => {}));
  assert.equal(calls, 1);
});

test('ordinary errors and comparisons retain their meaning; page fragments never become HTTP diagnoses', () => {
  for (const error of ['401 Unauthorized', '403 Forbidden', '429 Too many requests', 'Choose a meal first', 'Expected amount < 100 g', '{"error":"Invalid portion"}']) {
    assert.equal(connectionErrorText(error, 'en'), error);
  }
  for (const error of ['<SVG/>', 'upstream: <BODY class="error">denied', '<div>request 429</div>', '<title>401 Unauthorized</title>']) {
    assert.match(connectionErrorText(error, 'en'), /Could not reach the AI service/);
  }
});

test('plain-text credential fields are also concealed in the main error', () => {
  assert.doesNotMatch(connectionErrorText('Request failed: api_key=secret-key', 'en'), /secret-key/);
});

test('quoted credential fields are redacted without discarding neighboring diagnostics', () => {
  const details = connectionErrorDetails('{"Cookie":"session=secret-cookie", "Authorization":"Basic secret-auth", "request_id":"req-test"}');
  assert.doesNotMatch(details, /secret-/);
  assert.match(details, /"request_id":"req-test"/);
});
