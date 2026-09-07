import type { Meal, MealAnalysis, MealPhoto } from './meal';
import { sumMealItems } from './mealOperations';

/** Resolve the original analysis/questions before extending it, so clarification
 * answers cannot accidentally re-estimate an unrelated, newly added dish. */
export function canAddDish(meal: Meal): boolean {
  return Boolean(meal.analysis && !meal.analysis.clarification &&
    (meal.status === 'complete' || meal.status === 'estimated'));
}

/** Append evidence and items without trusting model output to rewrite the meal. */
export function appendMealDish(meal: Meal, addition: { analysis: MealAnalysis; photos: MealPhoto[]; note: string }): Meal {
  if (!canAddDish(meal)) throw new Error('The original meal must finish analysis and clarification first');
  const previous = meal.analysis!;
  const items = [...previous.items, ...addition.analysis.items];
  return {
    ...meal,
    photos: [...meal.photos, ...addition.photos],
    note: [meal.note, addition.note.trim()].filter(Boolean).join('\n'),
    status: addition.analysis.clarification ? 'needs_input' : 'complete',
    error: undefined,
    analysis: {
      ...previous,
      items,
      totals: sumMealItems(items),
      clarification: addition.analysis.clarification,
      dishAddition: addition.analysis.clarification ? {
        originalItemCount: previous.items.length,
        photoIds: addition.photos.map(photo => photo.id),
        note: addition.note.trim(),
      } : undefined,
      // A combined meal has no single research execution. Do not attribute the
      // entire estimate to either dish's provider response or search status.
      research: undefined,
    },
  };
}

/** Model clarification sees only the dish that owns the question. */
export function dishClarificationInput(meal: Meal): { analysis: MealAnalysis; photos: MealPhoto[]; note: string } {
  const analysis = meal.analysis!;
  const scope = analysis.dishAddition;
  if (!scope) return { analysis, photos: meal.photos, note: meal.note };
  const items = analysis.items.slice(scope.originalItemCount);
  return {
    analysis: { ...analysis, items, totals: sumMealItems(items), dishAddition: undefined },
    photos: meal.photos.filter(photo => scope.photoIds.includes(photo.id)),
    note: scope.note,
  };
}

/** Enforce preservation in application code, including when the model rewrites
 * its entire result or the user added a second serving of an existing food. */
export function mergeDishClarification(previous: MealAnalysis, answer: MealAnalysis): MealAnalysis {
  const scope = previous.dishAddition;
  if (!scope) return answer;
  const items = [...previous.items.slice(0, scope.originalItemCount), ...answer.items];
  return {
    ...previous, items, totals: sumMealItems(items),
    clarification: answer.clarification,
    dishAddition: answer.clarification ? scope : undefined,
    research: undefined,
  };
}
