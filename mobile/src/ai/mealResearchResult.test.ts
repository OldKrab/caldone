import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptMealResearch } from './mealResearchResult.ts';

test('explicit research cannot silently finish with no search or broken observation', () => {
  for (const status of ['not_searched','unobserved'] as const) {
    assert.throws(()=>acceptMealResearch({status,sources:[]},true),/search/i);
  }
  assert.doesNotThrow(()=>acceptMealResearch({status:'not_searched',sources:[]},false));
  assert.doesNotThrow(()=>acceptMealResearch({status:'unavailable',sources:[]},true));
  assert.doesNotThrow(()=>acceptMealResearch({status:'completed',sources:[]},true));
});
