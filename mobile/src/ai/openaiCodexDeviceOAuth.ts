import type {
  OAuthAuth,
  OAuthCredential,
  ProviderAuthInteraction,
} from '@earendil-works/pi-ai';

// These public-client values and endpoints intentionally mirror Pi 0.84.4.
// They are isolated here because OpenAI does not document them as a general
// mobile application API; a production library must track upstream changes.
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_BASE_URL = 'https://auth.openai.com';
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
const TIMEOUT_MS = 15 * 60 * 1_000;
const ACCOUNT_CLAIM = 'https://api.openai.com/auth';

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

function abortError(): Error {
  return new Error('Login cancelled');
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(abortError());
      },
      { once: true },
    );
  });
}

async function requireJson<T>(response: Response, operation: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${operation} failed (${response.status}): ${body || response.statusText}`);
  }
  return response.json() as Promise<T>;
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

async function exchangeCode(
  authorizationCode: string,
  codeVerifier: string,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: authorizationCode,
      code_verifier: codeVerifier,
      redirect_uri: DEVICE_REDIRECT_URI,
    }).toString(),
    signal,
  });
  return credentialFromToken(await requireJson<TokenResponse>(response, 'Token exchange'));
}

async function login(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  const start = await fetch(DEVICE_USER_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
    signal: interaction.signal,
  });
  const device = await requireJson<{
    device_auth_id: string;
    user_code: string;
    interval: number | string;
  }>(start, 'Device-code request');

  const intervalSeconds = Number(device.interval);
  if (!device.device_auth_id || !device.user_code || !Number.isFinite(intervalSeconds)) {
    throw new Error('OpenAI returned an invalid device-code response');
  }

  interaction.notify({
    type: 'device_code',
    userCode: device.user_code,
    verificationUri: DEVICE_VERIFICATION_URI,
    intervalSeconds,
    expiresInSeconds: TIMEOUT_MS / 1_000,
  });

  const deadline = Date.now() + TIMEOUT_MS;
  let pollIntervalMs = Math.max(1_000, intervalSeconds * 1_000);
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs, interaction.signal);
    const response = await fetch(DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: device.device_auth_id,
        user_code: device.user_code,
      }),
      signal: interaction.signal,
    });

    if (response.ok) {
      const result = await requireJson<{
        authorization_code: string;
        code_verifier: string;
      }>(response, 'Device authorization');
      if (!result.authorization_code || !result.code_verifier) {
        throw new Error('OpenAI returned an incomplete device authorization');
      }
      return exchangeCode(result.authorization_code, result.code_verifier, interaction.signal);
    }

    const body = await response.text().catch(() => '');
    let code = '';
    try {
      const parsed = JSON.parse(body) as { error?: string | { code?: string } };
      code = typeof parsed.error === 'string' ? parsed.error : parsed.error?.code ?? '';
    } catch {
      // A 403/404 is the pending response used by the current endpoint.
    }

    if (code === 'slow_down') {
      pollIntervalMs += 5_000;
      continue;
    }
    if (
      response.status === 403 ||
      response.status === 404 ||
      code === 'deviceauth_authorization_pending'
    ) {
      continue;
    }
    throw new Error(`Device authorization failed (${response.status}): ${body || response.statusText}`);
  }

  throw new Error('Device-code login timed out');
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
  return credentialFromToken(await requireJson<TokenResponse>(response, 'Token refresh'));
}

/** Device-code-only OAuth adapter; avoids Pi's Node callback server and loader. */
export const openaiCodexDeviceOAuth: OAuthAuth = {
  name: 'OpenAI (ChatGPT Plus/Pro)',
  isSubscription: true,
  loginLabel: 'Sign in with ChatGPT',
  login,
  refresh,
  async toAuth(credential) {
    return { apiKey: credential.access };
  },
};
