import * as openAICodexResponsesApi from '@earendil-works/pi-ai/api/openai-codex-responses';
import { createProvider } from '@earendil-works/pi-ai';

import { openaiCodexBrowserOAuth } from './openaiCodexBrowserOAuth';
import { fetchCodexModels } from './codexModelCatalog';

/** Pi owns auth refresh and transactional catalog updates; Codex owns availability. */
export function openaiCodexMobileProvider() {
  return createProvider({
    id: 'openai-codex',
    name: 'OpenAI Codex',
    baseUrl: 'https://chatgpt.com/backend-api',
    auth: { oauth: openaiCodexBrowserOAuth },
    models: [],
    fetchModels: fetchCodexModels,
    api: openAICodexResponsesApi,
  });
}
