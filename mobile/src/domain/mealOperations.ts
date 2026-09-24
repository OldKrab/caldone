import type { DailyGoals, Meal, MealAnalysis, MealItem, MealPhoto, MealType, NutritionTotals } from './meal';
import { parseMealWebImage } from './mealWebImage.ts';

export type MealEdit = {
  capturedAt?: number;
  note?: string;
  title?: string;
  mealType?: MealType;
  items?: MealItem[];
  addPhotos?: MealPhoto[];
  removePhotoIds?: string[];
};

export function normalizeMealPhotos(
  mealId: string,
  capturedAt: number,
  photos: Array<Partial<MealPhoto> & Pick<MealPhoto, 'uri' | 'mimeType'>>,
): MealPhoto[] {
  return photos.map((photo, index) => ({
    id: photo.id ?? `${mealId}-photo-${index}`,
    uri: photo.uri,
    mimeType: photo.mimeType,
    createdAt: photo.createdAt ?? capturedAt,
  }));
}

export function analysisFromItems(input: {
  title: string;
  mealType: MealType;
  items: MealItem[];
}): MealAnalysis {
  return {
    title: input.title.trim(),
    mealType: input.mealType,
    items: input.items,
    totals: sumMealItems(input.items),
  };
}

export function normalizeMealAnalysis(analysis: MealAnalysis): MealAnalysis {
  const webImage = parseMealWebImage(analysis.webImage);
  return {
    ...analysisFromItems(analysis),
    clarification: analysis.clarification,
    research: analysis.research,
    ...(webImage ? { webImage } : {}),
  };
}

export function sumMealItems(items: MealItem[]): NutritionTotals {
  return items.reduce((sum, item) => ({
    calories: sum.calories + item.calories,
    protein: sum.protein + item.protein,
    carbs: sum.carbs + item.carbs,
    fat: sum.fat + item.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

/** Applies one user-requested patch without changing unrelated analysis state. */
export function applyMealEdit(meal: Meal, edit: MealEdit): Meal {
  const removed = new Set(edit.removePhotoIds ?? []);
  const photos = deduplicatePhotos([
    ...meal.photos.filter((photo) => !removed.has(photo.id)),
    ...(edit.addPhotos ?? []),
  ]);
  const analysis = meal.analysis
    ? {
      ...meal.analysis,
      title: edit.title?.trim() || meal.analysis.title,
      mealType: edit.mealType ?? meal.analysis.mealType,
      items: edit.items ?? meal.analysis.items,
      totals: edit.items ? sumMealItems(edit.items) : meal.analysis.totals,
      ...(edit.items ? { clarification: undefined, research: undefined } : {}),
    }
    : undefined;
  return {
    ...meal,
    capturedAt: edit.capturedAt ?? meal.capturedAt,
    note: edit.note === undefined ? meal.note : edit.note.trim(),
    photos,
    analysis,
    ...(edit.items ? { status: 'complete' as const, error: undefined } : {}),
  };
}

function deduplicatePhotos(photos: MealPhoto[]): MealPhoto[] {
  const seen = new Set<string>();
  return photos.filter((photo) => {
    if (seen.has(photo.id)) return false;
    seen.add(photo.id);
    return true;
  });
}

export type NutritionSummary = {
  totals: NutritionTotals;
  mealCount: number;
  daysWithMeals: number;
  averagePerLoggedDay: NutritionTotals;
  goalDifferencePerLoggedDay?: DailyGoals;
  days: Array<{ date: string; totals: NutritionTotals; mealCount: number }>;
};

export function summarizeNutrition(meals: Meal[], input: {
  from: number;
  to: number;
  goals?: DailyGoals;
  groupByDay?: boolean;
}): NutritionSummary {
  const included = meals.filter((meal) => meal.capturedAt >= input.from && meal.capturedAt <= input.to && meal.analysis);
  const totals = included.reduce((sum, meal) => addTotals(sum, meal.analysis!.totals), zeroTotals());
  const grouped = new Map<string, { totals: NutritionTotals; mealCount: number }>();
  for (const meal of included) {
    const date = localDate(meal.capturedAt);
    const current = grouped.get(date) ?? { totals: zeroTotals(), mealCount: 0 };
    grouped.set(date, { totals: addTotals(current.totals, meal.analysis!.totals), mealCount: current.mealCount + 1 });
  }
  const daysWithMeals = grouped.size;
  const divisor = Math.max(daysWithMeals, 1);
  const averagePerLoggedDay = mapTotals(totals, (value) => value / divisor);
  const goalDifferencePerLoggedDay = input.goals
    ? Object.fromEntries((['calories', 'protein', 'carbs', 'fat'] as const).flatMap((key) =>
      input.goals?.[key] === undefined ? [] : [[key, averagePerLoggedDay[key] - input.goals[key]!]],
    )) as DailyGoals
    : undefined;
  return {
    totals,
    mealCount: included.length,
    daysWithMeals,
    averagePerLoggedDay,
    goalDifferencePerLoggedDay,
    days: input.groupByDay
      ? [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({ date, ...value }))
      : [],
  };
}

function zeroTotals(): NutritionTotals {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

function addTotals(left: NutritionTotals, right: NutritionTotals): NutritionTotals {
  return mapTotals(left, (value, key) => value + right[key]);
}

function mapTotals(totals: NutritionTotals, mapper: (value: number, key: keyof NutritionTotals) => number): NutritionTotals {
  return {
    calories: mapper(totals.calories, 'calories'),
    protein: mapper(totals.protein, 'protein'),
    carbs: mapper(totals.carbs, 'carbs'),
    fat: mapper(totals.fat, 'fat'),
  };
}

function localDate(timestamp: number): string {
  const date = new Date(timestamp);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
