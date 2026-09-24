export type MealActivityStage = 'reading_photos' | 'reviewing_meal' | 'thinking' | 'web_search' | 'writing_result' | 'saving_result';

type Listener = (activities: ReadonlyMap<string, MealActivityStage>) => void;

const activities = new Map<string, MealActivityStage>();
const startedAt = new Map<string, number>();
const listeners = new Set<Listener>();

/** Start of the operation, retained across stage changes and screen navigation. */
export function mealActivityStartedAt(mealId: string): number | undefined {
  return startedAt.get(mealId);
}

/** Ephemeral progress only: meal status in the repository remains authoritative. */
export function setMealActivity(mealId: string, stage?: MealActivityStage): void {
  if (stage) {
    if (!activities.has(mealId)) startedAt.set(mealId, Date.now());
    activities.set(mealId, stage);
  } else {
    activities.delete(mealId);
    startedAt.delete(mealId);
  }
  const snapshot = new Map(activities);
  listeners.forEach((listener) => listener(snapshot));
}

export function subscribeMealActivity(listener: Listener): () => void {
  listener(new Map(activities));
  listeners.add(listener);
  return () => listeners.delete(listener);
}
