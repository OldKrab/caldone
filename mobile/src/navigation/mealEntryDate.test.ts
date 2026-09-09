import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { appFlow } from '../testSupport/appFlow.ts';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = appFlow();
const { default: App } = await import('../../App.tsx');
const originalTimezone = process.env.TZ;
process.env.TZ = 'America/New_York';
const today = () => new Date(2026, 8, 9, 14, 2).getTime();
const yesterday = () => new Date(2026, 8, 8).getTime();
let app: ReactTestRenderer;
const screen = (name: string) => app.root.findByType(name as any).props;

async function openYesterday() {
  fixture.state.meals = [];
  await act(async () => { app = create(createElement(App)); });
  await act(async () => screen('HomeScreen').onPreviousDay());
  assert.equal(screen('HomeScreen').day, yesterday());
}
async function describe() {
  await act(async () => screen('HomeScreen').onCapture());
  await act(async () => screen('CaptureScreen').onDescribe());
}

test('manual entry from yesterday stays on yesterday after saving and reopening', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: today() });
  await openYesterday();
  await describe();
  await act(async () => screen('DescribeMealScreen').onManual());
  const detail = screen('MealDetailScreen');
  const timestamp = detail.meal.capturedAt;
  assert.equal(new Date(timestamp).getDate(), 8);
  assert.equal(new Date(timestamp).getHours(), 14);
  const analysis = { title: 'Repeat-test oats', mealType: 'breakfast', items: [
    { name: 'Rolled oats', quantity: '50 g', calories: 190, protein: 7, carbs: 30, fat: 4 },
  ], totals: { calories: 190, protein: 7, carbs: 30, fat: 4 } };
  await act(async () => detail.onSave(timestamp, analysis));
  await act(async () => screen('MealDetailScreen').onBack());
  assert.equal(screen('HomeScreen').day, yesterday());
  assert.equal(screen('HomeScreen').meals.length, 1);
  assert.equal(screen('HomeScreen').meals[0].analysis.totals.calories, 190);
  await act(async () => screen('HomeScreen').onOpen(screen('HomeScreen').meals[0]));
  assert.equal(screen('MealDetailScreen').meal.capturedAt, timestamp);
  await act(async () => screen('MealDetailScreen').onBack());
  await act(async () => screen('HomeScreen').onNextDay());
  assert.deepEqual(screen('HomeScreen').meals, []);
});

test('text entry keeps the selected day after submission and leaves today empty', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: today() });
  await openYesterday();
  await describe();
  await act(async () => screen('DescribeMealScreen').onChange('2 boiled eggs'));
  await act(async () => screen('DescribeMealScreen').onSend());
  assert.equal(screen('HomeScreen').day, yesterday());
  assert.equal(screen('HomeScreen').meals.length, 1);
  assert.equal(screen('HomeScreen').meals[0].note, '2 boiled eggs');
  assert.equal(new Date(screen('HomeScreen').meals[0].capturedAt).getDate(), 8);
  await act(async () => screen('HomeScreen').onNextDay());
  assert.deepEqual(screen('HomeScreen').meals, []);
});

test('photo entry retains yesterday across midnight and a daylight-saving boundary', async context => {
  // March 8, 2026 is the 23-hour spring-forward day in New York.
  context.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 2, 9, 23, 58).getTime() });
  fixture.state.meals = [];
  await act(async () => { app = create(createElement(App)); });
  await act(async () => screen('HomeScreen').onPreviousDay());
  await act(async () => screen('HomeScreen').onCapture());
  await act(async () => screen('CaptureScreen').onCaptured({ uri: 'file:///meal.jpg', mimeType: 'image/jpeg' }));
  context.mock.timers.setTime(new Date(2026, 2, 10, 0, 3).getTime());
  await act(async () => screen('CaptureReviewScreen').onSend());
  assert.equal(screen('HomeScreen').day, new Date(2026, 2, 8).getTime());
  const meal = screen('HomeScreen').meals[0];
  assert.equal(meal.capturedAt, new Date(2026, 2, 8, 0, 3).getTime());
  assert.equal(meal.photos.length, 1);
});

test('manual entry keeps local clock time on a 23-hour journal day', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 2, 9, 14, 2).getTime() });
  fixture.state.meals = [];
  await act(async () => { app = create(createElement(App)); });
  await act(async () => screen('HomeScreen').onPreviousDay());
  await describe();
  await act(async () => screen('DescribeMealScreen').onManual());
  assert.equal(screen('MealDetailScreen').meal.capturedAt, new Date(2026, 2, 8, 14, 2).getTime());
});

test('widget capture starts on today even when the journal was showing yesterday', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: today() });
  await openYesterday();
  await act(async () => fixture.state.onUrl!({ url: 'caldone://capture' }));
  await act(async () => screen('CaptureScreen').onDescribe());
  await act(async () => screen('DescribeMealScreen').onManual());
  assert.equal(new Date(screen('MealDetailScreen').meal.capturedAt).getDate(), 9);
});

test.afterEach(async () => { if (app) await act(async () => app.unmount()); });
test.after(() => {
  fixture.close();
  if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});
