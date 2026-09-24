import type {
  OAuthAuth,
  OAuthCredential,
  ProviderAuthInteraction,
} from '@earendil-works/pi-ai';
import * as WebBrowser from 'expo-web-browser';

import { CodexLoopback } from '../../modules/codex-loopback';

// These values mirror Pi's OpenAI Codex provider. OpenAI registers the
// localhost redirect against this public client, so the redirect URI is a
// protocol invariant rather than application configuration.
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_BASE_URL = 'https://auth.openai.com';
const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const APP_RETURN_URI = 'caldone://oauth-complete';
const SCOPE = 'openid profile email offline_access';
const ACCOUNT_CLAIM = 'https://api.openai.com/auth';
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1_000;

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

type CallbackServer = {
  close(): void;
  cancel(error: Error): void;
  waitForCode(): Promise<string>;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(byteLength: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function createAuthorizationFlow(): Promise<{
  state: string;
  verifier: string;
  url: string;
}> {
  const verifier = randomBase64Url(32);
  const challenge = toBase64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  );
  const state = randomBase64Url(24);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'pi');
  return { state, verifier, url: url.toString() };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('OpenAI access token is not a JWT');
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

function credentialFromToken(token: TokenResponse): OAuthCredential {
  const payload = decodeJwtPayload(token.access_token);
  const auth = payload[ACCOUNT_CLAIM] as { chatgpt_account_id?: unknown } | undefined;
  if (typeof auth?.chatgpt_account_id !== 'string') {
    throw new Error('OpenAI access token does not contain a ChatGPT account id');
  }

  return {
    type: 'oauth',
    access: token.access_token,
    refresh: token.refresh_token,
    expires: Date.now() + token.expires_in * 1_000,
    accountId: auth.chatgpt_account_id,
  };
}

async function requireToken(response: Response, operation: string): Promise<OAuthCredential> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${operation} failed (${response.status}): ${body || response.statusText}`);
  }

  const token = (await response.json()) as Partial<TokenResponse>;
  if (!token.access_token || !token.refresh_token || typeof token.expires_in !== 'number') {
    throw new Error(`${operation} returned an incomplete token response`);
  }
  return credentialFromToken(token as TokenResponse);
}

async function exchangeCode(
  code: string,
  verifier: string,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }).toString(),
    signal,
  });
  return requireToken(response, 'Token exchange');
}

async function refresh(
  credential: OAuthCredential,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refresh,
      client_id: CLIENT_ID,
    }).toString(),
    signal,
  });
  return requireToken(response, 'Token refresh');
}

async function startCallbackServer(
  expectedState: string,
  signal: AbortSignal,
): Promise<CallbackServer> {
  if (signal.aborted) throw new Error('Login cancelled');

  await CodexLoopback.start(expectedState);
  const codePromise = CodexLoopback.waitForCode();
  const onAbort = () => CodexLoopback.cancel('Login cancelled');
  const timeout = setTimeout(
    () => CodexLoopback.cancel('Login callback timed out'),
    CALLBACK_TIMEOUT_MS,
  );
  signal.addEventListener('abort', onAbort, { once: true });

  const close = () => {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
    CodexLoopback.close();
  };
  const cancel = (error: Error) => CodexLoopback.cancel(error.message);
  return { close, cancel, waitForCode: () => codePromise };
}

function stageError(stage: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${stage}: ${detail}`, { cause: error });
}

async function login(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  interaction.notify({ type: 'progress', message: 'OAuth: creating authorization request' });
  const authorization = await createAuthorizationFlow().catch((error) => {
    throw stageError('OAuth setup failed', error);
  });
  interaction.notify({ type: 'progress', message: 'OAuth: starting localhost callback listener' });
  const callbackServer = await startCallbackServer(
    authorization.state,
    interaction.signal,
  ).catch((error) => {
    throw stageError('OAuth callback listener failed', error);
  });
  interaction.notify({
    type: 'auth_url',
    url: authorization.url,
    instructions: 'Complete ChatGPT login in the browser.',
  });
  interaction.notify({ type: 'progress', message: 'OAuth: opening browser' });

  // Android's auth session observes the CalDone deep link emitted by the
  // callback page and brings the existing activity back to the foreground.
  // The authorization code itself is accepted only by the loopback listener.
  void WebBrowser.openAuthSessionAsync(authorization.url, APP_RETURN_URI).then(
    (result) => {
      if (result.type !== 'success') {
        callbackServer.cancel(new Error('Browser login was cancelled'));
      }
    },
    (error) => {
      callbackServer.cancel(stageError('Browser launch failed', error));
    },
  );

  try {
    const code = await callbackServer.waitForCode();
    interaction.notify({ type: 'progress', message: 'OAuth: callback received, exchanging token' });
    return await exchangeCode(code, authorization.verifier, interaction.signal).catch((error) => {
      throw stageError('Token exchange failed', error);
    });
  } finally {
    callbackServer.close();
  }
}

/** Android browser OAuth adapter using OpenAI's allow-listed localhost callback. */
export const openaiCodexBrowserOAuth: OAuthAuth = {
  name: 'OpenAI (ChatGPT Plus/Pro)',
  isSubscription: true,
  loginLabel: 'Sign in with ChatGPT',
  login,
  refresh,
  async toAuth(credential) {
    return { apiKey: credential.access };
  },
};
