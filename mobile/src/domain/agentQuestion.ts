import type { QuestionChoices } from './questionChoices';

/** A question has one durable identity across chat, meal cards, and retries.
 * Answered means the user replied; uncertain answers do not become known facts. */
export type AgentQuestion = QuestionChoices & {
  id: string;
  mealId?: string;
  threadId?: string;
  state: 'open' | 'answered' | 'dismissed';
  answer?: string;
  uncertain?: boolean;
  createdAt: number;
};

export type QuestionResolution = Pick<AgentQuestion, 'id' | 'answer' | 'uncertain'> & {
  state: 'answered' | 'dismissed';
};
