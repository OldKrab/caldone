import type { MealResearch } from '../domain/mealResearch.ts';

export class MealResearchError extends Error {
  readonly research: MealResearch;
  constructor(research: MealResearch) {
    super('The requested web search could not be verified. The saved nutrition was not changed. Read the meal again before retrying with web search still required.');
    this.research = research;
  }
}

/** Unavailable/failed search can yield an honestly labelled estimate. A provider
 * ignoring a required search, or missing observation, must not silently pass. */
export function acceptMealResearch(research: MealResearch, required: boolean): void {
  if (required && (research.status === 'not_searched' || research.status === 'unobserved')) throw new MealResearchError(research);
}
