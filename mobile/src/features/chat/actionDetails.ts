import type { ChatAction } from '../../domain/chat';
import type { Meal } from '../../domain/meal';
import { mealQuestions } from '../../domain/mealQuestions.ts';

export type ActionDetail = { label: string; before?: string; after?: string };

/** Historical receipts use the action's snapshots, never today's mutable meal. */
export function actionDetails(action: ChatAction, language: 'en' | 'ru'): ActionDetail[] {
  const ru = language === 'ru';
  const rows: ActionDetail[] = [];
  const add = (label: string, before: unknown, after: unknown) => {
    if (before === after) return;
    rows.push({
      label,
      before: before === undefined ? undefined : String(before),
      after: after === undefined ? undefined : String(after),
    });
  };
  const mealValues = (meal?: Meal): Record<string, string | undefined> => {
    if (!meal) return {};
    const a = meal.analysis;
    const values: Record<string, string | undefined> = {
      [ru ? 'Название' : 'Title']: a?.title,
      [ru ? 'Тип приёма пищи' : 'Meal type']: a
        ? ru
          ? { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' }[a.mealType]
          : a.mealType
        : undefined,
      [ru ? 'Время' : 'Time']: new Date(meal.capturedAt).toLocaleString(ru ? 'ru-RU' : 'en-GB'),
      [ru ? 'Заметка' : 'Note']: meal.note || undefined,
      [ru ? 'Фото' : 'Photos']: String(meal.photos.length),
      [ru ? 'Калории' : 'Calories']: a ? `${a.totals.calories} kcal` : undefined,
      [ru ? 'Белки' : 'Protein']: a ? `${a.totals.protein} g` : undefined,
      [ru ? 'Углеводы' : 'Carbs']: a ? `${a.totals.carbs} g` : undefined,
      [ru ? 'Жиры' : 'Fat']: a ? `${a.totals.fat} g` : undefined,
      [ru ? 'Уточнения' : 'Questions']: mealQuestions(a?.clarification).join('\n') || undefined,
    };
    a?.items.forEach((item, index) => {
      const prefix = `${ru ? 'Продукт' : 'Item'} ${index + 1}`;
      values[prefix] = item.name;
      values[`${prefix} · ${ru ? 'порция' : 'portion'}`] = item.quantity;
      values[`${prefix} · ${ru ? 'состав' : 'nutrition'}`] =
        `${item.calories} kcal · ${ru ? 'Б' : 'P'} ${item.protein} g · ${ru ? 'У' : 'C'} ${item.carbs} g · ${ru ? 'Ж' : 'F'} ${item.fat} g`;
    });
    return values;
  };
  const compare = (before: Record<string, unknown>, after: Record<string, unknown>) => {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      add(key, before[key], after[key]);
  };
  const undo = action.undo;
  // Older receipts may omit after-snapshots; absence is not proof of removal.
  if (undo.kind === 'restore_goals' && !undo.expectedGoals) return [];
  if (undo.kind === 'restore_goal_profile' && !('expectedProfile' in undo)) return [];
  if (undo.kind === 'restore_meal') compare(mealValues(undo.meal), mealValues(undo.expectedMeal));
  else if (undo.kind === 'delete_meal') compare({}, mealValues(undo.expectedMeal));
  else if (undo.kind === 'restore_goals') {
    for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) {
      const labels = {
        calories: ru ? 'Калории' : 'Calories',
        protein: ru ? 'Белки' : 'Protein',
        carbs: ru ? 'Углеводы' : 'Carbs',
        fat: ru ? 'Жиры' : 'Fat',
      };
      const unit = key === 'calories' ? 'kcal' : 'g';
      add(
        labels[key],
        undo.goals[key] === undefined ? undefined : `${undo.goals[key]} ${unit}`,
        undo.expectedGoals?.[key] === undefined ? undefined : `${undo.expectedGoals[key]} ${unit}`,
      );
    }
  } else if (undo.kind === 'restore_goal_profile') {
    const labels = {
      age: ru ? 'Возраст' : 'Age',
      heightCm: ru ? 'Рост, см' : 'Height, cm',
      weightKg: ru ? 'Вес, кг' : 'Weight, kg',
      sex: ru ? 'Формула' : 'Equation',
      activity: ru ? 'Активность' : 'Activity',
      objective: ru ? 'Цель' : 'Objective',
    };
    for (const key of Object.keys(labels) as Array<keyof typeof labels>)
      add(labels[key], undo.profile?.[key], undo.expectedProfile?.[key]);
  }
  return rows;
}
