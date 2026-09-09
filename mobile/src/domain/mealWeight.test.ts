import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mealWeightGrams, scaleSingleItemPortion } from './mealWeight.ts';

test('totals explicit ingredient masses without counting portions or volumes as grams', () => {
  assert.equal(mealWeightGrams(['примерно 80 г', '150 г', 'около 70 г', '50 g', '0,1 кг']), 450);
  assert.equal(mealWeightGrams(['80 г', '1 порция']), null);
  assert.equal(mealWeightGrams(['80 г', '100 мл']), null);
  assert.equal(mealWeightGrams(['2 × 50 г']), null);
  assert.equal(mealWeightGrams(['50–70 г']), null);
  assert.equal(mealWeightGrams([]), null);
});

test('calories per 100 g use the portion mass, including zero-calorie products', async () => {
  const { caloriesPer100Grams } = await import('./mealWeight.ts');
  assert.ok(Math.abs(caloriesPer100Grams(166, 'примерно 80 г')! - 207.5) < 1e-9);
  assert.equal(caloriesPer100Grams(195, '0,15 кг'), 130);
  assert.equal(caloriesPer100Grams(0, '100 г'), 0);
  assert.equal(caloriesPer100Grams(5, '500 мл'), null);
  assert.equal(caloriesPer100Grams(150, '1 порция'), null);
  assert.equal(caloriesPer100Grams(150, '50–70 г'), null);
  assert.equal(caloriesPer100Grams(150, '0 г'), null);
});

test('recognizes explicit total mass after a portion description', async () => {
  const { caloriesPer100Grams } = await import('./mealWeight.ts');
  assert.equal(mealWeightGrams(['1 упаковка, 130 г']), 130);
  assert.equal(caloriesPer100Grams(702, '1 упаковка, 130 г'), 540);
  assert.equal(mealWeightGrams(['2 бургера, 604 г', '1 порция (около 100 г)']), 704);
  assert.equal(mealWeightGrams(['1 pack, 130 g']), 130);
  assert.equal(mealWeightGrams(['2 упаковки по 130 г']), null);
  assert.equal(mealWeightGrams(['1 упаковка, 100–130 г']), null);
  assert.equal(mealWeightGrams(['1 бутылка, 500 мл']), null);
  assert.equal(mealWeightGrams(['100 граммов, 130 г']), null);
  assert.equal(mealWeightGrams(['1 pack per, 130 g']), null);
});

test('direct portion scaling refuses unknown masses, mixed foods and invalid weights', () => {
  const item={name:'Chips',quantity:'38 g',calories:190,protein:1.9,carbs:19,fat:11.4};
  for(const quantity of ['1 plate','100 ml','30–50 g']) assert.throws(()=>scaleSingleItemPortion([{...item,quantity}],80),/no known weight/);
  assert.throws(()=>scaleSingleItemPortion([item,item],80),/one saved food/);
  for(const grams of [0,-1,NaN,Infinity,100001]) assert.throws(()=>scaleSingleItemPortion([item],grams),/Portion weight/);
  const scaled=scaleSingleItemPortion([item],80)[0];
  assert.deepEqual([scaled.calories,scaled.protein,scaled.carbs,scaled.fat],[400,4,40,24]);
  assert.equal(item.quantity,'38 g');
});
