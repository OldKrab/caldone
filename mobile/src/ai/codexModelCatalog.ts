import type { Model, RefreshModelsContext, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models';
import { fetch as expoFetch } from 'expo/fetch';

// Codex gates catalog entries by protocol compatibility, not the CalDone version.
// Verified against codex-cli 0.156.1 and its /codex/models endpoint; 0.154.0
// omits GPT-6 Sol/Luna even for accounts that can use them. Revisit this
// when adopting new Codex protocol capabilities; never use a fabricated future version.
const CATALOG_URL = 'https://chatgpt.com/backend-api/codex/models?client_version=0.156.1';
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

type RemoteModel = {
  slug: string;
  display_name: string;
  input_modalities: string[];
  context_window: number;
  supported_reasoning_levels: { effort: string }[];
  priority?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseModel(value: unknown): RemoteModel {
  if (!isRecord(value)
    || typeof value.slug !== 'string' || !value.slug.trim()
    || typeof value.display_name !== 'string' || !value.display_name.trim()
    || !Array.isArray(value.input_modalities)
    || !value.input_modalities.every(input => typeof input === 'string')
    || typeof value.context_window !== 'number' || !Number.isSafeInteger(value.context_window) || value.context_window <= 0
    || !Array.isArray(value.supported_reasoning_levels)
    || !value.supported_reasoning_levels.every(level => isRecord(level) && typeof level.effort === 'string')) {
    throw new Error('Codex returned an invalid model catalog');
  }
  return value as RemoteModel;
}

/** Uses the effective OAuth credential supplied by Pi, including token refresh.
 * Do not query the API-key /v1/models catalog: subscription availability differs. */
export async function fetchCodexModels(context: RefreshModelsContext): Promise<Model<'openai-codex-responses'>[]> {
  const credential = context.credential;
  if (credential?.type !== 'oauth' || typeof credential.accountId !== 'string') {
    throw new Error('Connect OpenAI Codex before loading its models');
  }
  const response = await expoFetch(CATALOG_URL, {
    headers: {
      Authorization: `Bearer ${credential.access}`,
      'ChatGPT-Account-ID': credential.accountId,
      originator: 'caldone',
    },
    signal: context.signal,
  });
  // Never include a response body or auth headers in a user-facing error.
  if (!response.ok) throw new Error(`Could not load Codex models (HTTP ${response.status})`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.models)) throw new Error('Codex returned an invalid model catalog');
  const visible = payload.models
    .filter(value => isRecord(value) && value.visibility === 'list')
    .map(parseModel)
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
  const seen = new Set<string>();
  return visible.map(remote => {
    if (seen.has(remote.slug)) throw new Error('Codex returned duplicate model IDs');
    seen.add(remote.slug);
    const efforts = new Set(remote.supported_reasoning_levels.map(level => level.effort));
    const thinkingLevelMap: ThinkingLevelMap = Object.fromEntries(
      THINKING_LEVELS.map(level => [level, efforts.has(level) ? level : null]),
    );
    const known = Object.values(OPENAI_CODEX_MODELS).find(model => model.id === remote.slug);
    return {
      id: remote.slug,
      name: remote.display_name,
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api',
      input: remote.input_modalities.filter((input): input is 'text' | 'image' => input === 'text' || input === 'image'),
      reasoning: THINKING_LEVELS.some(level => level !== 'off' && efforts.has(level)),
      thinkingLevelMap,
      contextWindow: remote.context_window,
      // This endpoint supplies neither prices nor output limits. Pi requires
      // numeric metadata, but its Codex transport does not send maxTokens.
      // Zero costs mean unavailable estimates, not free inference. Never copy
      // another model's rates or make a new model depend on Pi's bundled catalog.
      maxTokens: known?.maxTokens ?? 16384,
      cost: known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsOpenAIGrammarTools: true, supportsAdditionalTools: true, supportsToolSearch: true },
    };
  });
}
