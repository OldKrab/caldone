import assert from 'node:assert/strict';
import test from 'node:test';
import { providerLoginError } from './providerLoginError.ts';
import { setLocale, t } from '../i18n.ts';

test('known login failures offer localized guidance and stable safe diagnostic codes', () => {
  const cases = [
    ['Browser login was cancelled', 'AUTH_CANCELLED'],
    ['Login already in progress', 'AUTH_IN_PROGRESS'],
    ['Login callback timed out', 'AUTH_CALLBACK_TIMEOUT'],
    ['OAuth state mismatch.', 'AUTH_CALLBACK_STATE'],
    ['OpenAI login failed: csrf_mismatch', 'AUTH_BROWSER_SESSION'],
    ['OpenAI login failed: request_forbidden', 'AUTH_PROVIDER_REJECTED'],
    ['OAuth callback listener failed: Address already in use', 'AUTH_CALLBACK_LISTENER'],
    ['Browser launch failed: no browser available', 'AUTH_BROWSER_LAUNCH'],
    ['Token exchange failed: Token exchange failed (403): secret-token-body', 'AUTH_TOKEN_HTTP_403'],
    ['Token exchange failed: OpenAI access token is not a JWT', 'AUTH_TOKEN_RESPONSE'],
    ['OAuth setup failed: crypto not available', 'AUTH_SETUP'],
    ['Network request failed: private-url', 'AUTH_NETWORK'],
    ['Credential store modify failed for openai-codex', 'AUTH_STORAGE'],
    ['Provider selection save failed', 'AUTH_STORAGE'],
  ];
  for (const [message, code] of cases) {
    const result = providerLoginError(new Error(message));
    assert.equal(result.code, code, message);
    setLocale('en');
    const english = t(result.key);
    setLocale('ru');
    const russian = t(result.key);
    assert.notEqual(english, russian);
    assert.ok(english.length > 20 && russian.length > 20);
    assert.doesNotMatch(english + russian, /secret-token-body|private-url/);
  }
  setLocale('en');
});

test('unknown provider errors never echo response bodies, URLs or non-Error objects', () => {
  for (const error of [new Error('https://localhost/callback?code=private-code'), 'access_token=private-token', { message: 'private-code' }, null]) {
    assert.deepEqual(providerLoginError(error), { key: 'providerConnectionError', code: 'AUTH_UNKNOWN' });
  }
});
