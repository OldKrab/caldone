import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateDailyGoals, mergeGoalProfile, parseGoalProfile } from './goalEstimator.ts';

test('estimates maintenance goals from an adult profile', () => {
  assert.deepEqual(
    estimateDailyGoals({
      activity: 'moderate',
      age: 30,
      heightCm: 180,
      objective: 'maintain',
      sex: 'male',
      weightKg: 80,
    }),
    { calories: 2760, protein: 121, carbs: 380, fat: 84 },
  );
});

test('uses a restrained deficit for a lose-weight starting goal', () => {
  assert.deepEqual(
    estimateDailyGoals({
      activity: 'light',
      age: 30,
      heightCm: 165,
      objective: 'lose',
      sex: 'female',
      weightKg: 60,
    }),
    { calories: 1540, protein: 67, carbs: 212, fat: 47 },
  );
});

test('rejects profiles outside the adult scope of the estimator', () => {
  assert.throws(
    () => estimateDailyGoals({
      activity: 'sedentary',
      age: 17,
      heightCm: 170,
      objective: 'maintain',
      sex: 'male',
      weightKg: 70,
    }),
    /adults/i,
  );
});

test('saved goal profiles are validated before use', () => {
  const profile = {
    activity: 'light' as const,
    age: 42,
    heightCm: 174,
    objective: 'maintain' as const,
    sex: 'male' as const,
    weightKg: 78,
  };
  assert.deepEqual(parseGoalProfile(JSON.stringify(profile)), profile);
  assert.equal(parseGoalProfile('{"age":12}'), undefined);
});

test('goal profile updates preserve omitted fields and validate the result', () => {
  const profile = {
    activity: 'light' as const,
    age: 42,
    heightCm: 174,
    objective: 'maintain' as const,
    sex: 'male' as const,
    weightKg: 78,
  };
  assert.deepEqual(mergeGoalProfile(profile, { weightKg: 75, objective: 'lose' }), {
    ...profile,
    objective: 'lose',
    weightKg: 75,
  });
  assert.throws(() => mergeGoalProfile(profile, { age: 12 }), /adult/i);
});
