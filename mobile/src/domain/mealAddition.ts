import type { Meal } from './meal';

/** Resolve the original analysis/questions before extending it, so clarification
 * answers cannot accidentally re-estimate an unrelated, newly added dish. */
export function canAddDish(meal: Meal): boolean {
  return Boolean(meal.analysis && !meal.analysis.clarification &&
    (meal.status === 'complete' || meal.status === 'estimated'));
}

