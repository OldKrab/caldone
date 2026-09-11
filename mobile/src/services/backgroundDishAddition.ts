import { File } from 'expo-file-system';
import type { MealPhoto } from '../domain/meal';
import { t } from '../i18n';
import { setMealActivity } from './mealActivity';
import { addDishToMeal } from './mealAddition';

export type DishAdditionState = { status: 'running' | 'failed'; error?: string };
type Input = { photos: MealPhoto[]; note: string };
type Job = { input: Input; state: DishAdditionState; controller?: AbortController; discard?: boolean };
const jobs = new Map<string, Job>();
const listeners = new Set<(states: ReadonlyMap<string, DishAdditionState>) => void>();
const snapshot = () => new Map([...jobs].map(([id, job]) => [id, job.state]));
const publish = () => listeners.forEach(listener => listener(snapshot()));

/** Owns the copied photos after capture hands off. Jobs live for this app session;
 * the original meal is updated only by addDishToMeal's revision-checked save. */
export function startDishAddition(id: string, input: Input): void {
  if (jobs.has(id)) throw new Error(t('analysisAlreadyRunning'));
  const job: Job = { input, state: { status: 'running' } };
  jobs.set(id, job);
  run(id, job);
}

function run(id: string, job: Job): void {
  job.state = { status: 'running' };
  job.controller = new AbortController();
  setMealActivity(id, 'reading_photos');
  publish();
  void addDishToMeal(id, { ...job.input, signal: job.controller.signal, onActivity: stage => setMealActivity(id, stage) }).then(() => {
    jobs.delete(id);
  }, error => {
    job.state = { status: 'failed', error: error instanceof Error ? error.message : undefined };
  }).finally(() => {
    setMealActivity(id);
    if (job.discard && jobs.get(id) === job) discardDishAddition(id);
    else publish();
  });
}

export function subscribeDishAdditions(listener: (states: ReadonlyMap<string, DishAdditionState>) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => { listeners.delete(listener); };
}

export function retryDishAddition(id: string): void {
  const job = jobs.get(id);
  if (job?.state.status === 'failed') run(id, job);
}

export function stopDishAddition(id: string): void {
  jobs.get(id)?.controller?.abort();
}

/** Cancel work before deleting its photos; a successful save transfers ownership
 * to the meal and must never be cleaned up as an abandoned draft. */
export function discardDishAddition(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  if (job.state.status === 'running') {
    job.discard = true;
    job.controller?.abort();
    return;
  }
  for (const photo of job.input.photos) {
    try {
      const file = new File(photo.uri);
      if (file.exists) file.delete();
    } catch { /* Best-effort cleanup must not block dismissing a failed job. */ }
  }
  jobs.delete(id);
  publish();
}

export function discardAllDishAdditions(): void {
  for (const id of jobs.keys()) discardDishAddition(id);
}
