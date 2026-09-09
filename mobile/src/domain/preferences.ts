export type NutritionUnits = {
  energy: 'kcal' | 'kj';
  weight: 'g' | 'oz';
};

export type NotificationPreferences = {
  questions: boolean;
  failed: boolean;
  ready: boolean;
  reminder: boolean;
};

export const defaultNutritionUnits: NutritionUnits = { energy: 'kcal', weight: 'g' };

export const defaultNotificationPreferences: NotificationPreferences = {
  questions: true,
  failed: true,
  ready: false,
  reminder: false,
};

export function parsePreference<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function displayEnergy(kcal: number, units: NutritionUnits): number {
  return units.energy === 'kj' ? kcal * 4.184 : kcal;
}

export function displayWeight(grams: number, units: NutritionUnits): number {
  return units.weight === 'oz' ? grams / 28.3495 : grams;
}
