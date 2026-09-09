export type MealActivityStage = 'reading_photos' | 'reviewing_meal' | 'thinking' | 'web_search' | 'writing_result' | 'saving_result';

type Listener = (activities: ReadonlyMap<string, MealActivityStage>) => void;

const activities = new Map<string, MealActivityStage>();
export type MealActivityDetails = { readonly startedAt: number; readonly stages: readonly MealActivityStage[] };
const details = new Map<string, MealActivityDetails>();

export function getMealActivityDetails(mealId: string): MealActivityDetails | undefined {
  return details.get(mealId);
}

const listeners = new Set<Listener>();

/** Ephemeral progress only: meal status in the repository remains authoritative. */
export function setMealActivity(mealId: string, stage?: MealActivityStage): void {
  if (stage) {
    const previous = details.get(mealId);
    if (!previous || previous.stages.at(-1) !== stage) {
      // Observed transitions, not a predicted checklist. Bound history for retries.
      details.set(mealId, { startedAt: previous?.startedAt ?? Date.now(), stages: [...(previous?.stages ?? []), stage].slice(-12) });
    }
    activities.set(mealId, stage);
  } else {
    activities.delete(mealId);
    details.delete(mealId);
  }
  const snapshot = new Map(activities);
  listeners.forEach((listener) => listener(snapshot));
}

export function subscribeMealActivity(listener: Listener): () => void {
  listener(new Map(activities));
  listeners.add(listener);
  return () => listeners.delete(listener);
}
