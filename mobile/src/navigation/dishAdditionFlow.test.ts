import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { appFlow } from '../testSupport/appFlow.ts';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let finish!: () => void;
let fail = false;
const result = { title: 'Salad', mealType: 'lunch', items: [
  { name: 'Salad', quantity: '100 g', calories: 80, protein: 2, carbs: 9, fat: 4 },
], totals: { calories: 80, protein: 2, carbs: 9, fat: 4 } };
(globalThis as any).__dishModel = async () => {
  await new Promise<void>(resolve => { finish = resolve; });
  if (fail) throw new Error('offline');
  return { text: JSON.stringify(result) };
};
const fixture = appFlow({
  realModules: ['./src/services/mealAddition', './src/services/backgroundDishAddition', './src/services/mealActivity'],
  adapters: {
    '../ai/piClient': 'export const analyzeMeal = input => globalThis.__dishModel(input);',
    './foregroundWork': 'export const beginForegroundWork = async () => async () => {};',
    'expo-file-system': `export class File {
      uri = 'file:///saved-photo.jpg'; exists = true;
      copy() {} delete() {} async base64() { return 'photo'; }
    } export class Directory { create() {} } export const Paths = { document: 'file:///documents' };`,
    '../data/mealRepository': `export const getMeal = async id => structuredClone(globalThis.__mealDateFlow.meals.find(meal => meal.id === id));
      export const replaceMealIfRevision = async (meal, revision) => {
        const meals = globalThis.__mealDateFlow.meals;
        const index = meals.findIndex(value => value.id === meal.id && value.revision === revision);
        if (index < 0) return undefined;
        meals[index] = { ...meal, revision: revision + 1 }; return meals[index];
      };`,
  },
});
const { default: App } = await import('../../App.tsx');
let app: ReactTestRenderer;
const screen = (name: string) => app.root.findByType(name as any).props;

for (const mode of ['photo', 'text']) {
  test(`${mode} addition leaves capture before recognition and completes after navigating away`, async () => {
    fixture.state.meals = [{ id: 'lunch', revision: 1, capturedAt: Date.now(), status: 'complete', photos: [], note: '',
      analysis: { ...result, title: 'Soup', items: [{ ...result.items[0], name: 'Soup' }] } } as any];
    await act(async () => { app = create(createElement(App)); });
    await act(async () => screen('HomeScreen').onOpen(fixture.state.meals[0]));
    await act(async () => screen('MealDetailScreen').onAddDish());
    if (mode === 'photo') {
      await act(async () => screen('CaptureScreen').onCaptured({ uri: 'file:///salad.jpg', mimeType: 'image/jpeg' }));
      await act(async () => screen('CaptureReviewScreen').onSend());
    } else {
      await act(async () => screen('CaptureScreen').onDescribe());
      await act(async () => screen('DescribeMealScreen').onChange('Salad'));
      await act(async () => screen('DescribeMealScreen').onSend());
    }
    assert.equal(screen('MealDetailScreen').dishAddition.status, 'running');
    assert.equal(screen('MealDetailScreen').meal.analysis.items.length, 1);
    await act(async () => screen('MealDetailScreen').onBack());
    assert.equal(screen('HomeScreen').activities.has('lunch'), true);
    await act(async () => { finish(); });
    assert.equal(screen('HomeScreen').activities.has('lunch'), false);
    assert.deepEqual(screen('HomeScreen').meals[0].analysis.items.map((item: any) => item.name), ['Soup', 'Salad']);
  });
}

test('a background failure is visible in the journal and retries from the meal without recapture', async () => {
  fail = true;
  fixture.state.meals = [{ id: 'lunch', revision: 1, capturedAt: Date.now(), status: 'complete', photos: [], note: '', analysis: result } as any];
  await act(async () => { app = create(createElement(App)); });
  await act(async () => screen('HomeScreen').onOpen(fixture.state.meals[0]));
  await act(async () => screen('MealDetailScreen').onAddDish());
  await act(async () => screen('CaptureScreen').onDescribe());
  await act(async () => screen('DescribeMealScreen').onChange('Extra salad'));
  await act(async () => screen('DescribeMealScreen').onSend());
  await act(async () => screen('MealDetailScreen').onBack());
  await act(async () => { finish(); });
  assert.equal(screen('HomeScreen').failedDishAdditionIds.has('lunch'), true);
  await act(async () => screen('HomeScreen').onOpen(fixture.state.meals[0]));
  assert.equal(screen('MealDetailScreen').dishAddition.status, 'failed');
  fail = false;
  await act(async () => screen('MealDetailScreen').onRetryDishAddition());
  assert.equal(screen('MealDetailScreen').dishAddition.status, 'running');
  await act(async () => { finish(); });
  assert.equal(screen('MealDetailScreen').dishAddition, undefined);
  assert.equal(screen('MealDetailScreen').meal.analysis.items.length, 2);
});

test.afterEach(async () => { if (app) await act(async () => app.unmount()); });
test.after(() => {
  fixture.close();
  delete (globalThis as any).__dishModel;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});
