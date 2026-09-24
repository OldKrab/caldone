import type { DailyGoals, NutritionTotals } from '../../domain/meal';

export type MacroGoalRow = {
  key: 'protein' | 'carbs' | 'fat';
  current: number;
  goal?: number;
};

/** Shapes the home summary so every macro can present current intake beside its goal. */
export function macroGoalRows(totals: NutritionTotals, goals: DailyGoals): MacroGoalRow[] {
  return (['protein', 'carbs', 'fat'] as const).map((key) => ({
    key,
    current: totals[key],
    goal: goals[key],
  }));
}
