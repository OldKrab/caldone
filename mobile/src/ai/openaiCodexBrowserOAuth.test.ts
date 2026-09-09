import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { providerLoginError } from './providerLoginError.ts';
import { setLocale, t } from '../i18n.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const fixture = {
  code: deferred<string>(), browser: deferred<{ type: string }>(),
  opened: deferred<void>(), secondStart: deferred<void>(),
  browserLaunches: 0, eventLaunches: 0, starts: 0, cancels: 0, closes: 0,
  tokenFailure: undefined as Error | undefined, tokenStatus: 200,
};
(globalThis as any).__codexLogin = fixture;
const native = `export const CodexLoopback = {
  async start() { const f = globalThis.__codexLogin; if (++f.starts === 2) f.secondStart.resolve(); },
  waitForCode() { return globalThis.__codexLogin.code.promise; },
  cancel(message) { const f = globalThis.__codexLogin; f.cancels++; f.code.reject(new Error(message)); },
  close() { globalThis.__codexLogin.closes++; }
};`;
const browser = `export async function openAuthSessionAsync() {
  const f = globalThis.__codexLogin; f.browserLaunches++; f.opened.resolve(); return f.browser.promise;
}`;
const hooks = registerHooks({ resolve(specifier, context, next) {
  const source = specifier === '../../modules/codex-loopback' ? native
    : specifier === 'expo-web-browser' ? browser : undefined;
  return source ? { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    : next(specifier, context);
} });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  if (fixture.tokenFailure) throw fixture.tokenFailure;
  if (fixture.tokenStatus !== 200) return new Response('private-provider-response', { status: fixture.tokenStatus });
  const payload = btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } }));
  return Response.json({ access_token: `test.${payload}.signature`, refresh_token: 'test-refresh', expires_in: 3600 });
};
const { openaiCodexBrowserOAuth: auth } = await import('./openaiCodexBrowserOAuth.ts');

function reset() {
  Object.assign(fixture, {
    code: deferred<string>(), browser: deferred<{ type: string }>(),
    opened: deferred<void>(), secondStart: deferred<void>(),
    browserLaunches: 0, eventLaunches: 0, starts: 0, cancels: 0, closes: 0,
    tokenFailure: undefined, tokenStatus: 200,
  });
}
function login() {
  return auth.login!({
    signal: new AbortController().signal,
    prompt: async () => '',
    notify: event => {
      // Auth URL events ask the provider UI to open a browser. Count that
      // public interaction as well as the adapter-owned native session.
      if (event.type === 'auth_url') fixture.eventLaunches++;
    },
  });
}
async function browserOpened() {
  await fixture.opened.promise;
  assert.equal(fixture.browserLaunches, 1, 'the native auth session opened');
}

test('one login opens one browser and returns the connected account', { timeout: 5_000 }, async () => {
  reset();
  const result = login();
  await browserOpened();
  fixture.browser.resolve({ type: 'success' });
  fixture.code.resolve('test-code');
  assert.equal((await result).accountId, 'test-account');
  assert.equal(fixture.eventLaunches + fixture.browserLaunches, 1);
});

test('a late browser dismissal from a completed login cannot cancel its retry', { timeout: 5_000 }, async () => {
  reset();
  const first = login();
  await browserOpened();
  const oldBrowser = fixture.browser;
  fixture.code.resolve('first-code');
  await first;

  reset();
  const second = login().then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  await browserOpened();
  oldBrowser.resolve({ type: 'dismiss' });
  await new Promise<void>(resolve => setImmediate(resolve));
  fixture.browser.resolve({ type: 'success' });
  fixture.code.resolve('second-code');
  const outcome = await second;
  assert.equal(fixture.cancels, 0);
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.value?.accountId, 'test-account');
});

test('a concurrent login does not replace the active attempt', { timeout: 5_000 }, async () => {
  reset();
  const first = login();
  await browserOpened();
  const second = login().then(() => 'connected', error => error.message);
  await Promise.race([second, fixture.secondStart.promise]);
  fixture.browser.resolve({ type: 'success' });
  fixture.code.resolve('active-code');
  await first;
  assert.match(await second, /already in progress/i);
  assert.equal(fixture.starts, 1);
});

test('dismissing login releases the attempt so a fresh login can connect', { timeout: 5_000 }, async () => {
  reset();
  const first = login().catch(error => error);
  await browserOpened();
  fixture.browser.resolve({ type: 'dismiss' });
  assert.equal(providerLoginError(await first).code, 'AUTH_CANCELLED');

  reset();
  const retry = login();
  await browserOpened();
  fixture.browser.resolve({ type: 'success' });
  fixture.code.resolve('retry-code');
  assert.equal((await retry).accountId, 'test-account');
});

test('token-network failures identify the failed step without exposing private errors', { timeout: 5_000 }, async () => {
  reset();
  fixture.tokenFailure = new TypeError('Network request failed: secret-test-code');
  const result = login().catch(error => error);
  await browserOpened();
  fixture.browser.resolve({ type: 'success' });
  fixture.code.resolve('test-code');
  const failure = providerLoginError(await result);
  assert.equal(failure.code, 'AUTH_TOKEN_NETWORK');
  setLocale('en');
  assert.match(t(failure.key), /browser.*CalDone.*VPN/i);
  assert.doesNotMatch(t(failure.key), /secret-test-code/);
  setLocale('ru');
  assert.match(t(failure.key), /браузер.*CalDone.*VPN/i);
  setLocale('en');
});

test.after(() => {
  globalThis.fetch = originalFetch;
  hooks.deregister();
  delete (globalThis as any).__codexLogin;
});
