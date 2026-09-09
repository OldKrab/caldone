import * as openAICodexResponsesApi from '@earendil-works/pi-ai/api/openai-codex-responses';
import { createProvider } from '@earendil-works/pi-ai';
import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models';

import { openaiCodexBrowserOAuth } from './openaiCodexBrowserOAuth';

/** Pi's model catalog and transport with only its Node-oriented auth seam replaced. */
export function openaiCodexMobileProvider() {
  return createProvider({
    id: 'openai-codex',
    name: 'OpenAI Codex',
    baseUrl: 'https://chatgpt.com/backend-api',
    auth: { oauth: openaiCodexBrowserOAuth },
    models: Object.values(OPENAI_CODEX_MODELS),
    api: openAICodexResponsesApi,
  });
}
