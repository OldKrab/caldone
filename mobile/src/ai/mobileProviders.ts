import {
  createProvider,
  type ApiKeyAuth,
  type Provider,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { azureOpenAIResponsesProvider } from '@earendil-works/pi-ai/providers/azure-openai-responses';
import { basetenProvider } from '@earendil-works/pi-ai/providers/baseten';
import { cerebrasProvider } from '@earendil-works/pi-ai/providers/cerebras';
import { cloudflareAIGatewayProvider } from '@earendil-works/pi-ai/providers/cloudflare-ai-gateway';
import { cloudflareWorkersAIProvider } from '@earendil-works/pi-ai/providers/cloudflare-workers-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { fireworksProvider } from '@earendil-works/pi-ai/providers/fireworks';
import { googleVertexProvider } from '@earendil-works/pi-ai/providers/google-vertex';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { groqProvider } from '@earendil-works/pi-ai/providers/groq';
import { huggingfaceProvider } from '@earendil-works/pi-ai/providers/huggingface';
import { minimaxCnProvider } from '@earendil-works/pi-ai/providers/minimax-cn';
import { minimaxProvider } from '@earendil-works/pi-ai/providers/minimax';
import { mistralProvider } from '@earendil-works/pi-ai/providers/mistral';
import { moonshotaiCnProvider } from '@earendil-works/pi-ai/providers/moonshotai-cn';
import { moonshotaiProvider } from '@earendil-works/pi-ai/providers/moonshotai';
import { nvidiaProvider } from '@earendil-works/pi-ai/providers/nvidia';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode';
import { qwenTokenPlanCnProvider } from '@earendil-works/pi-ai/providers/qwen-token-plan-cn';
import { qwenTokenPlanIndividualProvider } from '@earendil-works/pi-ai/providers/qwen-token-plan-individual';
import { qwenTokenPlanProvider } from '@earendil-works/pi-ai/providers/qwen-token-plan';
import { togetherProvider } from '@earendil-works/pi-ai/providers/together';
import { vercelAIGatewayProvider } from '@earendil-works/pi-ai/providers/vercel-ai-gateway';
import { xiaomiTokenPlanAmsProvider } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-ams';
import { xiaomiTokenPlanCnProvider } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-cn';
import { xiaomiTokenPlanSgpProvider } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-sgp';
import { xiaomiProvider } from '@earendil-works/pi-ai/providers/xiaomi';
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn';
import { zaiProvider } from '@earendil-works/pi-ai/providers/zai';
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
import { KIMI_CODING_MODELS } from '@earendil-works/pi-ai/providers/kimi-coding.models';
import { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models';
import { XAI_MODELS } from '@earendil-works/pi-ai/providers/xai.models';

/**
 * Pi providers that can run in the React Native bundle.
 *
 * Pi's desktop-only OAuth loaders and Bedrock runtime deliberately use
 * bundler-opaque Node imports, which Metro cannot execute. Their API-key
 * equivalents are registered explicitly where available; Codex OAuth is
 * supplied separately by the app's mobile provider.
 */
export function mobilePiProviders(): Provider[] {
  return [
    anthropicMobileProvider(),
    azureOpenAIResponsesProvider(),
    basetenProvider(),
    cerebrasProvider(),
    cloudflareAIGatewayProvider(),
    cloudflareWorkersAIProvider(),
    deepseekProvider(),
    fireworksProvider(),
    googleProvider(),
    googleVertexProvider(),
    groqProvider(),
    huggingfaceProvider(),
    kimiCodingMobileProvider(),
    minimaxProvider(),
    minimaxCnProvider(),
    mistralProvider(),
    moonshotaiProvider(),
    moonshotaiCnProvider(),
    nvidiaProvider(),
    openaiProvider(),
    opencodeProvider(),
    opencodeGoProvider(),
    openrouterMobileProvider(),
    qwenTokenPlanProvider(),
    qwenTokenPlanCnProvider(),
    qwenTokenPlanIndividualProvider(),
    togetherProvider(),
    vercelAIGatewayProvider(),
    xaiMobileProvider(),
    xiaomiProvider(),
    xiaomiTokenPlanAmsProvider(),
    xiaomiTokenPlanCnProvider(),
    xiaomiTokenPlanSgpProvider(),
    zaiProvider(),
    zaiCodingCnProvider(),
  ];
}

function mobileApiKeyAuth(name: string): ApiKeyAuth {
  return {
    name,
    login: async (interaction) => ({
      type: 'api_key',
      key: await interaction.prompt({ type: 'secret', message: `Enter ${name}` }),
    }),
    resolve: async ({ credential }) =>
      credential?.key
        ? { auth: { apiKey: credential.key }, env: credential.env, source: 'stored credential' }
        : undefined,
  };
}

function anthropicMobileProvider() {
  return createProvider({
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    auth: { apiKey: mobileApiKeyAuth('Anthropic API key') },
    models: Object.values(ANTHROPIC_MODELS),
    api: anthropicMessagesApi(),
  });
}

function kimiCodingMobileProvider() {
  return createProvider({
    id: 'kimi-coding',
    name: 'Kimi For Coding',
    baseUrl: 'https://api.kimi.com/coding',
    auth: { apiKey: mobileApiKeyAuth('Kimi API key') },
    models: Object.values(KIMI_CODING_MODELS),
    api: anthropicMessagesApi(),
  });
}

function openrouterMobileProvider() {
  return createProvider({
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: { apiKey: mobileApiKeyAuth('OpenRouter API key') },
    models: Object.values(OPENROUTER_MODELS),
    api: openAICompletionsApi(),
  });
}

function xaiMobileProvider() {
  return createProvider({
    id: 'xai',
    name: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    auth: { apiKey: mobileApiKeyAuth('xAI API key') },
    models: Object.values(XAI_MODELS),
    api: openAIResponsesApi(),
  });
}
