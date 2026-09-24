import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { explicitlyRequestsSearch } from '../domain/mealResearch.ts';

export type MealRequestContext = {
  userMessages: string[];
  assistantInterpretation?: string;
  requireSearch: boolean;
};

/** Resolve original messages in application code. A model may explain its
 * interpretation, but cannot author the field presented as the user's answer. */
export function mealRequestContext(messages: AgentMessage[], assistantInterpretation?: string, requireSearch = false): MealRequestContext {
  const lastUser = messages.findLastIndex(message => message.role === 'chatUser');
  // A successful tool in this same turn does not consume the user's request.
  const lastUpdate = messages.slice(0, lastUser).findLastIndex(message => message.role === 'toolResult' && !message.isError &&
    ['answer_meal_question','reanalyze_meal','edit_meal','create_meal'].includes(message.toolName));
  const userMessages = messages.slice(lastUpdate + 1).flatMap(message => message.role === 'chatUser' ? [message.text] : []);
  if (!userMessages.length) throw new Error('No original user request is available for this meal change.');
  return {userMessages, assistantInterpretation, requireSearch:requireSearch || userMessages.some(explicitlyRequestsSearch)};
}
