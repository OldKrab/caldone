import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Meal, MealAnalysis } from '../domain/meal.ts';

const original: Meal = {
  id: 'lunch', revision: 7, capturedAt: 123, status: 'complete', note: 'First dish',
  photos: [{ id: 'old', uri: 'old-photo', mimeType: 'image/jpeg', createdAt: 123 }],
  analysis: {
    title: 'My lunch', mealType: 'lunch',
    items: [{ name: 'Edited soup', quantity: '250 g', calories: 211, protein: 12, carbs: 25, fat: 7 }],
    totals: { calories: 211, protein: 12, carbs: 25, fat: 7 },
  },
};
const addition: MealAnalysis = {
  title: 'Wrong replacement title', mealType: 'dinner',
  items: [{ name: 'Salad', quantity: '100 g', calories: 80, protein: 2, carbs: 9, fat: 4 }],
  totals: { calories: 999, protein: 999, carbs: 999, fat: 999 },
};
const fixture = {
  meal: structuredClone(original) as Meal | undefined,
  result: addition, input: undefined as any, readPhotos: [] as string[], deletedPhotos: [] as string[], saves: 0, releases: 0,
  afterAnalyze: async () => {}, fail: false,
};
(globalThis as any).__dishAddition = fixture;
const sources: Record<string, string> = {
  './foregroundWork': 'export const beginForegroundWork=async()=>async()=>{globalThis.__dishAddition.releases++};',
  'expo-file-system': `export class File {constructor(uri){this.uri=uri} get exists(){return true} delete(){globalThis.__dishAddition.deletedPhotos.push(this.uri)} async base64(){globalThis.__dishAddition.readPhotos.push(this.uri); return 'bytes:'+this.uri}}`,
  'expo-notifications': 'export const setNotificationHandler=()=>{};',
  'react-native': 'export const AppState={currentState:"active"};export const Platform={OS:"android"};',
  '../ai/piClient': `export async function analyzeMeal(input){const f=globalThis.__dishAddition; f.input=input; await f.afterAnalyze(); if(f.fail)throw new Error('offline');return {text:JSON.stringify(f.result)}};export const refineMealAnalysis=analyzeMeal;export const correctMealAnalysis=analyzeMeal;`,
  '../data/mealRepository': `export const appendDiagnosticEvent=async()=>{};export const getMeal=async()=>structuredClone(globalThis.__dishAddition.meal);
    export async function replaceMealIfRevision(meal,revision){const f=globalThis.__dishAddition; if(f.meal?.revision!==revision)return undefined; f.saves++;f.meal={...meal,revision:revision+1};return f.meal;}
    export const saveMealAnalysis=async(id,analysis)=>{const f=globalThis.__dishAddition;f.meal.analysis=analysis;f.meal.status=analysis.clarification?'needs_input':'complete'};
    export const setMealStatus=async(id,status)=>{globalThis.__dishAddition.meal.status=status};
    export const listProcessableMeals=async()=>[];export const recordMealFailure=async()=>false;
    export const getPreference=async()=>null;export const savePreference=async()=>{};`,
  '../data/chatRepository': 'export const appendInlineMealAnswer=async()=>{};export const ensureClarificationThread=async()=>({id:"thread"});export const syncMealQuestionsToThread=async()=>{};',
  '../i18n': 'export const locale="en";export const t=x=>x;',
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (sources[specifier]) return { url: 'data:text/javascript,' + encodeURIComponent(sources[specifier]), shortCircuit: true };
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { addDishToMeal } = await import('./mealAddition.ts');
const { answerMealClarification } = await import('./mealProcessor.ts');
const newPhoto = { id: 'new', uri: 'new-photo', mimeType: 'image/jpeg', createdAt: 456 };
function reset() {
  Object.assign(fixture, {
    meal: structuredClone(original), result: structuredClone(addition), input: undefined,
    readPhotos: [], deletedPhotos: [], saves: 0, releases: 0, afterAnalyze: async () => {}, fail: false,
  });
}

test('add a dish without replacing original items, metadata, photos, or notes', async () => {
  reset();
  await addDishToMeal('lunch', { photos: [newPhoto], note: '  Side salad  ' });
  assert.deepEqual(fixture.input.existingMeal, original.analysis);
  assert.deepEqual(fixture.readPhotos, ['new-photo']);
  assert.equal(fixture.meal!.id, original.id);
  assert.equal(fixture.meal!.capturedAt, original.capturedAt);
  assert.equal(fixture.meal!.analysis!.title, original.analysis!.title);
  assert.equal(fixture.meal!.analysis!.mealType, 'lunch');
  assert.deepEqual(fixture.meal!.analysis!.items, [...original.analysis!.items, ...addition.items]);
  assert.deepEqual(fixture.meal!.analysis!.totals, { calories: 291, protein: 14, carbs: 34, fat: 11 });
  assert.deepEqual(fixture.meal!.photos, [...original.photos, newPhoto]);
  assert.equal(fixture.meal!.note, 'First dish\nSide salad');
  assert.equal(fixture.saves, 1);
  assert.equal(fixture.releases, 1);
});

test('text additions and repeated additions update one meal and keep new questions', async () => {
  reset();
  await addDishToMeal('lunch', { photos: [], note: 'A side salad' });
  fixture.result.clarification = { questions: ['How much dressing?'], impactCalories: 100 };
  await addDishToMeal('lunch', { photos: [], note: 'Another side salad' });
  assert.deepEqual(fixture.readPhotos, []);
  assert.equal(fixture.meal!.analysis!.items.length, 3);
  assert.equal(fixture.meal!.analysis!.totals.calories, 371);
  assert.equal(fixture.meal!.status, 'needs_input');
  assert.deepEqual(fixture.meal!.analysis!.clarification, fixture.result.clarification);
});

test('failure leaves the existing meal intact and permits retry', async () => {
  reset();
  fixture.fail = true;
  await assert.rejects(addDishToMeal('lunch', { photos: [], note: 'Salad' }), /offline/);
  assert.deepEqual(fixture.meal, original);
  assert.equal(fixture.saves, 0);
  fixture.fail = false;
  await addDishToMeal('lunch', { photos: [], note: 'Salad' });
  assert.equal(fixture.saves, 1);
  assert.equal(fixture.releases, 2);
});

test('concurrent edits or deletion reject stale additions without overwriting or resurrecting meals', async () => {
  for (const deleted of [false, true]) {
    reset();
    fixture.afterAnalyze = async () => {
      if (deleted) fixture.meal = undefined;
      else { fixture.meal!.revision++; fixture.meal!.note = 'Concurrent edit'; }
    };
    await assert.rejects(addDishToMeal('lunch', { photos: [], note: 'Salad' }), /addDishChanged/);
    assert.equal(fixture.saves, 0);
    assert.equal(fixture.meal?.note, deleted ? undefined : 'Concurrent edit');
  }
});

test('empty input, empty analysis and unfinished meals do not save additions', async () => {
  reset();
  await assert.rejects(addDishToMeal('lunch', { photos: [], note: ' ' }), /addDishError/);
  assert.equal(fixture.input, undefined);
  fixture.result.items = [];
  await assert.rejects(addDishToMeal('lunch', { photos: [], note: 'Salad' }), /addDishError/);
  assert.deepEqual(fixture.meal, original);
  for (const status of ['queued', 'analyzing', 'needs_input', 'failed'] as const) {
    reset();
    fixture.meal!.status = status;
    await assert.rejects(addDishToMeal('lunch', { photos: [], note: 'Salad' }), /addDishNotReady/);
    assert.equal(fixture.input, undefined);
  }
});

test('a second submission while analysis runs cannot add the dish twice', async () => {
  reset();
  let finish!: () => void;
  const paused = new Promise<void>(resolve => { finish = resolve; });
  fixture.afterAnalyze = () => paused;
  const first = addDishToMeal('lunch', { photos: [], note: 'Salad' });
  await assert.rejects(addDishToMeal('lunch', { photos: [], note: 'Salad' }), /analysisAlreadyRunning/);
  finish();
  await first;
  assert.equal(fixture.saves, 1);
});

test('answering an addition question after serialization changes only its items', async () => {
  reset();
  fixture.result.clarification = { questions: ['How much?'], impactCalories: 150 };
  await addDishToMeal('lunch', { photos: [newPhoto], note: 'Extra dish' });
  fixture.meal = JSON.parse(JSON.stringify(fixture.meal));
  fixture.readPhotos = [];
  fixture.result = { ...addition, items: [{ ...addition.items[0], calories: 150 }] };
  await answerMealClarification('lunch', '200 grams');
  assert.deepEqual(fixture.readPhotos, ['new-photo']);
  assert.deepEqual(JSON.parse(fixture.input.previousJson).items, addition.items);
  assert.equal(fixture.input.note, 'Extra dish');
  assert.deepEqual(fixture.meal!.analysis!.items[0], original.analysis!.items[0]);
  assert.equal(fixture.meal!.analysis!.items[1].calories, 150);
  assert.equal(fixture.meal!.analysis!.totals.calories, 361);
  assert.equal(fixture.meal!.analysis!.title, original.analysis!.title);
  assert.equal(fixture.meal!.analysis!.dishAddition, undefined);
  assert.equal(fixture.meal!.status, 'complete');
});

test('stopping analysis leaves the meal unchanged and permits a fresh submission', async () => {
  reset();
  const controller = new AbortController();
  fixture.afterAnalyze = async () => controller.abort();
  await assert.rejects(addDishToMeal('lunch', { photos: [], note: 'Salad', signal: controller.signal }), /abort/i);
  assert.deepEqual(fixture.meal, original);
  assert.equal(fixture.saves, 0);
  fixture.afterAnalyze = async () => {};
  await addDishToMeal('lunch', { photos: [], note: 'Salad' });
  assert.equal(fixture.saves, 1);
});

test('background addition returns before recognition and publishes completion without replacing original items', async () => {
  reset();
  const service = await import('./backgroundDishAddition.ts');
  let finish!: () => void;
  fixture.afterAnalyze = () => new Promise<void>(resolve => { finish = resolve; });
  let state: ReadonlyMap<string, import('./backgroundDishAddition.ts').DishAdditionState> = new Map();
  const unsubscribe = service.subscribeDishAdditions(value => { state = value; });
  const returned = service.startDishAddition('lunch', { photos: [newPhoto], note: 'Salad' });
  assert.equal(returned, undefined, 'capture can close without awaiting the model');
  assert.equal(state.get('lunch')?.status, 'running');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.saves, 0);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.has('lunch'), false);
  assert.deepEqual(fixture.meal!.analysis!.items, [...original.analysis!.items, ...addition.items]);
  unsubscribe();
});

test('background failure keeps input for retry and rejects duplicate submissions', async () => {
  reset();
  const service = await import('./backgroundDishAddition.ts');
  fixture.fail = true;
  let state: ReadonlyMap<string, import('./backgroundDishAddition.ts').DishAdditionState> = new Map();
  const unsubscribe = service.subscribeDishAdditions(value => { state = value; });
  service.startDishAddition('lunch', { photos: [newPhoto], note: 'Salad' });
  assert.throws(() => service.startDishAddition('lunch', { photos: [], note: 'Duplicate' }), /analysisAlreadyRunning/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.get('lunch')?.status, 'failed');
  assert.deepEqual(fixture.meal, original);
  assert.deepEqual(fixture.deletedPhotos, []);
  fixture.fail = false;
  service.retryDishAddition('lunch');
  service.retryDishAddition('lunch');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.has('lunch'), false);
  assert.equal(fixture.saves, 1);
  assert.equal(fixture.input.note, 'Salad');
  assert.deepEqual(fixture.deletedPhotos, []);
  unsubscribe();
});

test('stopping background recognition preserves the meal; discarding releases only the new photos', async () => {
  reset();
  const service = await import('./backgroundDishAddition.ts');
  let finish!: () => void;
  fixture.afterAnalyze = () => new Promise<void>(resolve => { finish = resolve; });
  let state: ReadonlyMap<string, import('./backgroundDishAddition.ts').DishAdditionState> = new Map();
  const unsubscribe = service.subscribeDishAdditions(value => { state = value; });
  service.startDishAddition('lunch', { photos: [newPhoto], note: 'Salad' });
  await new Promise(resolve => setImmediate(resolve));
  service.stopDishAddition('lunch');
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fixture.meal, original);
  assert.equal(state.get('lunch')?.status, 'failed');
  service.discardDishAddition('lunch');
  assert.equal(state.has('lunch'), false);
  assert.deepEqual(fixture.deletedPhotos, ['new-photo']);
  unsubscribe();
});

test('discarding active work cancels the request before freeing its private photo copies', async () => {
  reset();
  const service = await import('./backgroundDishAddition.ts');
  let finish!: () => void;
  fixture.afterAnalyze = () => new Promise<void>(resolve => { finish = resolve; });
  let state: ReadonlyMap<string, import('./backgroundDishAddition.ts').DishAdditionState> = new Map();
  const unsubscribe = service.subscribeDishAdditions(value => { state = value; });
  service.startDishAddition('lunch', { photos: [newPhoto], note: 'Salad' });
  await new Promise(resolve => setImmediate(resolve));
  service.discardDishAddition('lunch');
  assert.equal(fixture.input.signal.aborted, true);
  assert.deepEqual(fixture.deletedPhotos, []);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.has('lunch'), false);
  assert.equal(fixture.saves, 0);
  assert.deepEqual(fixture.deletedPhotos, ['new-photo']);
  unsubscribe();
});

test.after(() => hooks.deregister());
