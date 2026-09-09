import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMealAnalysisPrompt, buildMealRefinementPrompt, buildMealCorrectionPrompt, MEAL_ANALYSIS_PROMPT_VERSION } from './mealAnalysisPrompt.ts';

test('analysis contract handles material visual uncertainty without food-specific rules', () => {
  const prompt = buildMealAnalysisPrompt('English');

  assert.match(prompt, /low, central, and high plausible quantity/);
  assert.match(prompt, /MUST return one to three clarification questions/);
  assert.match(prompt, /Never substitute a familiar or default serving/);
  assert.match(prompt, /Never transfer nutrition from a different variant or serving size/);
  assert.doesNotMatch(prompt, /Snickers|candy bar|mini bar/i);
});

test('analysis prompt has a stable diagnostic version', () => {
  assert.match(MEAL_ANALYSIS_PROMPT_VERSION, /^meal-evidence-v\d+$/);
});

test('addition system instructions limit calculation and questions to new food', () => {
  const prompt = buildMealAnalysisPrompt('English', true);
  assert.match(prompt, /ONLY newly added food/);
  assert.match(prompt, /Ask questions only about the addition/);
  assert.doesNotMatch(prompt, /Recognize the whole meal/);
});


test('descriptions are sufficient evidence and missing portions do not require a photo', () => {
  const prompt = buildMealAnalysisPrompt('English');
  assert.match(prompt, /A text description alone is sufficient input/);
  assert.match(prompt, /ask about the food or portion instead/);
});

test('initial analysis, clarification and correction research products before asking for labels', () => {
  for (const build of [buildMealAnalysisPrompt, buildMealRefinementPrompt, buildMealCorrectionPrompt]) {
    const prompt = build('English');
    assert.match(prompt, /Research nutrition proactively/);
    assert.match(prompt, /search BEFORE asking the user/);
    assert.match(prompt, /alternative queries/);
    assert.match(prompt, /per 100 g.*per serving/);
    assert.match(prompt, /Never claim.*searched.*unless/);
  }
});


test('unknown portions and refusal to answer end clarification in every meal path', () => {
  for (const build of [buildMealAnalysisPrompt, buildMealRefinementPrompt, buildMealCorrectionPrompt]) {
    const prompt=build('English');
    assert.match(prompt,/If the user does not know the portion/);
    assert.match(prompt,/do not ask for weight, dimensions, counts/);
    assert.match(prompt,/omit clarification entirely/);
    assert.match(prompt,/explicitly approximate/);
  }
});

test('recognition treats disputed names and echoed questions as hypotheses, not label evidence', () => {
  for (const build of [buildMealAnalysisPrompt, buildMealRefinementPrompt]) {
    const prompt = build('English');
    assert.match(prompt, /Only quote packaging text you can actually read in the attached photos/);
    assert.match(prompt, /If the user disputes.*re-examine the attached photos/);
    assert.match(prompt, /Repeated question wording is not user confirmation/);
  }
});


test('history photos remain references and never become additional current food', () => {
  for (const addingDish of [false, true]) {
    const prompt = buildMealAnalysisPrompt('English', addingDish);
    assert.doesNotMatch(prompt, /All (supplied|attached) photos/);
    assert.match(prompt, /Photos in conversation history and tool results belong to the meals identified there/);
    assert.match(prompt, /do not add their food or portions to the current meal/);
  }
});
