import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { completedChatContext } from '../domain/chat.ts';
import { explicitlyRequestsSearch } from '../domain/mealResearch.ts';

export type MealRequestContext = {
  userMessages: string[];
  assistantInterpretation?: string;
  requireSearch: boolean;
  conversation: AgentMessage[];
};

/** Resolve original messages in application code. A model may explain its
 * interpretation, but cannot author the field presented as the user's answer. */
export function mealRequestContext(messages: AgentMessage[], assistantInterpretation?: string, requireSearch = false, mealId?: string): MealRequestContext {
  const lastUser = messages.findLastIndex(message => message.role === 'chatUser');
  // A successful tool in this same turn does not consume the user's request.
  const lastUpdate = messages.slice(0, lastUser).findLastIndex(message => message.role === 'toolResult' && !message.isError &&
    ['answer_meal_question','reanalyze_meal','edit_meal','create_meal'].includes(message.toolName));
  const userMessages = messages.slice(lastUpdate + 1).flatMap(message => message.role === 'chatUser' ? [message.text] : []);
  if (!userMessages.length) throw new Error('No original user request is available for this meal change.');
  return {userMessages, assistantInterpretation, conversation: completedChatContext(messages), requireSearch:requireSearch || userMessages.some(explicitlyRequestsSearch) || failedAttemptRequiresSearch(messages.slice(lastUser + 1), mealId)};
}

/** A retry cannot weaken the research requirement of a failed attempt. Scope it
 * to this meal and user turn, so another meal or a new request stays independent. */
function failedAttemptRequiresSearch(messages: AgentMessage[], mealId?: string): boolean {
  if (!mealId) return false;
  const failures = new Set(messages.flatMap(message => message.role === 'toolResult' && message.isError ? [message.toolCallId] : []));
  return messages.some(message => message.role === 'assistant' && message.content.some(block =>
    block.type === 'toolCall' && failures.has(block.id) &&
    ['reanalyze_meal', 'answer_meal_question'].includes(block.name) &&
    block.arguments.mealId === mealId && block.arguments.requireSearch === true));
}
