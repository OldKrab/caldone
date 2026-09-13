import { test } from 'node:test';
import { nativeAgentHarness } from './nativeAgentHarness.ts';

// Each node:test file owns a process and an isolated database. Production
// imports happen after native bridges are installed; the agent itself is real.
export const harness = nativeAgentHarness();
export const { fixture } = harness;
export const client = await import('../ai/piClient.ts');
export const meals = await import('../data/mealRepository.ts');
export const chat = await import('../data/chatRepository.ts');
export const processor = await import('../services/mealProcessor.ts');
export const conversation = await import('../services/mealConversation.ts');
export const sessions = await import('../services/chatSession.ts');
export { toolOutput, textOutput } from './nativeAgentHarness.ts';

await meals.initializeMeals();
await chat.initializeChat();
await client.connectProvider('openai-codex', 'oauth', { onEvent() {} });
test.after(() => harness.close());
test.beforeEach(() => {
  fixture.requests = [];
});

export const rice = { name: 'Rice', quantity: '100 g', calories: 130, protein: 2.5, carbs: 28, fat: 0.5 };

export async function savedMeal(id: string) {
  await meals.saveMealRecord({
    id,
    revision: 1,
    capturedAt: 1234,
    status: 'complete',
    note: 'Original note',
    photos: [],
    analysis: { title: 'Lunch', mealType: 'lunch', items: [rice], totals: rice },
  });
  return (await meals.getMeal(id))!;
}
