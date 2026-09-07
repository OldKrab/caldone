import { normalizeMealAnalysis } from './mealOperations';
import { normalizeClarification, type LegacyMealClarification, type MealClarification } from './mealQuestions';

export { mealQuestions } from './mealQuestions';

export type MealStatus = 'queued' | 'analyzing' | 'needs_input' | 'complete' | 'estimated' | 'failed';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type NutritionTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type MealItem = NutritionTotals & { name: string; quantity: string };

export type MealAnalysis = {
  /** Optional display-only artwork; never part of the user's photo evidence. */
  webImage?: import('./mealWebImage').MealWebImage;
  /** While an added dish has open questions, protect the original item prefix
   * and send only the addition's evidence to clarification requests. Persisted
   * with the analysis so answering after an app restart has the same scope. */
  dishAddition?: { originalItemCount: number; photoIds: string[]; note: string };
  /** Provider-observed research from this calculation, not model-supplied evidence. */
  research?: import('./mealResearch').MealResearch;
  title: string;
  mealType: MealType;
  items: MealItem[];
  totals: NutritionTotals;
  clarification?: MealClarification | LegacyMealClarification;
};

export type MealPhoto = {
  id: string;
  uri: string;
  mimeType: string;
  createdAt: number;
};

export type Meal = {
  id: string;
  /** Monotonic record version used to reject stale Assistant mutations. */
  revision: number;
  capturedAt: number;
  status: MealStatus;
  note: string;
  photos: MealPhoto[];
  analysis?: MealAnalysis;
  error?: string;
};

export type DailyGoals = {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
};

export const emptyGoals: DailyGoals = {};

export function emptyTotals(): NutritionTotals {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

export function totalsFor(meals: Meal[]): NutritionTotals {
  return meals.reduce((total, meal) => {
    const next = meal.analysis?.totals;
    if (!next) return total;
    return {
      calories: total.calories + next.calories,
      protein: total.protein + next.protein,
      carbs: total.carbs + next.carbs,
      fat: total.fat + next.fat,
    };
  }, emptyTotals());
}

export function parseMealAnalysis(text: string): MealAnalysis {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value = JSON.parse(normalized) as Partial<MealAnalysis>;
  const clarification = normalizeClarification(value.clarification);
  if (
    typeof value.title !== 'string' ||
    !['breakfast', 'lunch', 'dinner', 'snack'].includes(value.mealType ?? '') ||
    !Array.isArray(value.items) ||
    !value.totals ||
    !validTotals(value.totals) ||
    !value.items.every((item) => (
      typeof item?.name === 'string' &&
      typeof item?.quantity === 'string' &&
      validTotals(item)
    )) ||
    (value.clarification !== undefined && !clarification)
  ) {
    throw new Error('The model returned an invalid meal result');
  }
  return normalizeMealAnalysis({ ...value, webImage: undefined, research: undefined, clarification } as MealAnalysis);
}

function validTotals(value: Partial<NutritionTotals>): boolean {
  return validNumber(value.calories) && validNumber(value.protein) &&
    validNumber(value.carbs) && validNumber(value.fat);
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
