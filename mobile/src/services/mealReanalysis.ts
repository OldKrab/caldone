import type { Meal } from '../domain/meal.ts';
import { hasMealInput } from '../ai/mealInput.ts';

// Acquire synchronously: a second tap can arrive before React or SQLite exposes
// queued status. Keep ownership through processing, including refresh failures.
const pending = new Set<string>();

/** Shared entry point for journal and detail-screen reanalysis. */
export async function requestMealReanalysis(
  meal: Meal,
  retry: (meal: Meal) => Promise<void>,
  busy = false,
): Promise<'started' | 'busy' | 'missing_input'> {
  if (busy || meal.status === 'queued' || meal.status === 'analyzing' || pending.has(meal.id)) return 'busy';
  if (!hasMealInput(meal)) return 'missing_input';
  pending.add(meal.id);
  try {
    await retry(meal);
    return 'started';
  } finally { pending.delete(meal.id); }
}
