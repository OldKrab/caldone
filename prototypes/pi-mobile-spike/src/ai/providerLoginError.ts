import type { CopyKey } from '../i18n';

type LoginFailure = { key: CopyKey; code: string };
const networkFailure = /Network request failed|fetch failed|UnknownHostException|Unable to resolve host|ECONNRESET|connection.*(?:lost|abort)/i;

/** Return only app-owned copy and diagnostic codes, never raw OAuth data. */
export function providerLoginError(error: unknown): LoginFailure {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // Classify the response status before inspecting text: an HTTP error body
  // can contain arbitrary strings, including words that resemble a network error.
  if (message.startsWith('Token exchange failed:')) {
    const status = message.match(/^Token exchange failed: Token exchange failed \(([1-5]\d{2})\):/);
    if (status) return { key: 'loginTokenRejectedError', code: `AUTH_TOKEN_HTTP_${status[1]}` };
    if (networkFailure.test(message)) return { key: 'loginTokenNetworkError', code: 'AUTH_TOKEN_NETWORK' };
    return { key: 'loginTokenResponseError', code: 'AUTH_TOKEN_RESPONSE' };
  }
  const known: ReadonlyArray<readonly [RegExp, CopyKey, string]> = [
    [/^(?:Credential store modify failed for |Provider selection save failed)/, 'loginStorageError', 'AUTH_STORAGE'],
    [/^(?:Browser login was cancelled|Login cancelled)$/, 'loginCancelled', 'AUTH_CANCELLED'],
    [/^Login already in progress$/, 'loginInProgress', 'AUTH_IN_PROGRESS'],
    [/^Login callback timed out$/, 'loginTimedOut', 'AUTH_CALLBACK_TIMEOUT'],
    [/^OAuth state mismatch/, 'loginStateMismatch', 'AUTH_CALLBACK_STATE'],
    [/^OpenAI login failed: csrf_mismatch$/, 'loginBrowserSessionError', 'AUTH_BROWSER_SESSION'],
    [/^OpenAI login failed:/, 'loginProviderRejectedError', 'AUTH_PROVIDER_REJECTED'],
    [/^OAuth callback listener failed:/, 'loginListenerError', 'AUTH_CALLBACK_LISTENER'],
    [/^Browser launch failed:/, 'loginBrowserLaunchError', 'AUTH_BROWSER_LAUNCH'],
    [/^OAuth setup failed:/, 'loginSetupError', 'AUTH_SETUP'],
  ];
  const match = known.find(([pattern]) => pattern.test(message));
  if (match) return { key: match[1], code: match[2] };
  if (networkFailure.test(message)) return { key: 'loginNetworkError', code: 'AUTH_NETWORK' };
  return { key: 'providerConnectionError', code: 'AUTH_UNKNOWN' };
}
