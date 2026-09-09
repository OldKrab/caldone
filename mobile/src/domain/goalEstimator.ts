import type { DailyGoals } from './meal';

export type GoalProfile = {
  age: number;
  sex: 'female' | 'male';
  heightCm: number;
  weightKg: number;
  activity: 'sedentary' | 'light' | 'moderate' | 'very_active';
  objective: 'lose' | 'maintain' | 'gain';
};

const activityFactors: Record<GoalProfile['activity'], number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very_active: 1.725,
};

const objectiveFactors: Record<GoalProfile['objective'], number> = {
  lose: 0.85,
  maintain: 1,
  gain: 1.1,
};

/**
 * Produces editable starting targets for non-pregnant adults.
 *
 * Energy uses the Mifflin–St Jeor resting-energy equation, scaled by the
 * selected activity and a restrained objective adjustment. Macro targets use
 * the midpoint of the National Academies' adult AMDR ranges: 17.5% protein,
 * 55% carbohydrate, and 27.5% fat.
 */
export function estimateDailyGoals(profile: GoalProfile): Required<DailyGoals> {
  assertGoalProfile(profile);

  const sexConstant = profile.sex === 'male' ? 5 : -161;
  const restingEnergy =
    (10 * profile.weightKg) +
    (6.25 * profile.heightCm) -
    (5 * profile.age) +
    sexConstant;
  const calories = roundToTen(
    restingEnergy *
    activityFactors[profile.activity] *
    objectiveFactors[profile.objective],
  );

  return {
    calories,
    protein: Math.round((calories * 0.175) / 4),
    carbs: Math.round((calories * 0.55) / 4),
    fat: Math.round((calories * 0.275) / 9),
  };
}

export function parseGoalProfile(raw?: string): GoalProfile | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as GoalProfile;
    assertGoalProfile(value);
    return value;
  } catch {
    return undefined;
  }
}

export function mergeGoalProfile(profile: GoalProfile, patch: Partial<GoalProfile>): GoalProfile {
  const next = { ...profile, ...patch };
  assertGoalProfile(next);
  return next;
}

function assertGoalProfile(profile: GoalProfile): void {
  if (
    !profile ||
    !Number.isFinite(profile.age) ||
    profile.age < 18 ||
    profile.age > 100 ||
    !Number.isFinite(profile.heightCm) ||
    profile.heightCm < 120 ||
    profile.heightCm > 230 ||
    !Number.isFinite(profile.weightKg) ||
    profile.weightKg < 35 ||
    profile.weightKg > 350 ||
    !['female', 'male'].includes(profile.sex) ||
    !['sedentary', 'light', 'moderate', 'very_active'].includes(profile.activity) ||
    !['lose', 'maintain', 'gain'].includes(profile.objective)
  ) {
    throw new Error('Goal estimates are available for adults with valid measurements');
  }
}

function roundToTen(value: number): number {
  return Math.round(value / 10) * 10;
}
