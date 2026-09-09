import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { DailyGoals, Meal, MealPhoto } from './meal';
import type { GoalProfile } from './goalEstimator';

export type ChatAttachment = MealPhoto;

export type ChatUserMessage = {
  role: 'chatUser';
  text: string;
  attachments: ChatAttachment[];
  timestamp: number;
};

export type ChatMealQuestionMessage = {
  role: 'mealQuestion';
  mealId: string;
  questions: string[];
  timestamp: number;
};

declare module '@earendil-works/pi-agent-core' {
  interface CustomAgentMessages {
    caldoneUser: ChatUserMessage;
    caldoneMealQuestion: ChatMealQuestionMessage;
  }
}

export function newMealQuestionMessage(input: Omit<ChatMealQuestionMessage, 'role'>): ChatMealQuestionMessage {
  return { role: 'mealQuestion', ...input };
}

export function newChatUserMessage(text: string, timestamp = Date.now()): ChatUserMessage {
  return { role: 'chatUser', text: text.trim(), attachments: [], timestamp };
}

/** A nested analysis may start while its parent tool call is unfinished.
 * Forward completed tool exchanges and original messages, never half a call. */
export function completedChatContext(messages: readonly AgentMessage[]): AgentMessage[] {
  const calls = new Set(messages.flatMap(message => message.role === 'assistant'
    ? message.content.flatMap(block => block.type === 'toolCall' ? [block.id] : []) : []));
  const completed = new Set(messages.flatMap(message => message.role === 'toolResult' && calls.has(message.toolCallId) ? [message.toolCallId] : []));
  return messages.flatMap((message): AgentMessage[] => {
    if (message.role === 'toolResult') return completed.has(message.toolCallId) ? [message] : [];
    if (message.role !== 'assistant') return [message];
    const content = message.content.filter(block => block.type !== 'thinking' && (block.type !== 'toolCall' || completed.has(block.id)));
    return content.length ? [{...message, content}] : [];
  });
}

export type ChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mealId?: string;
  purpose?: 'meal' | 'clarification';
};

export type ChatUndo =
  | { kind: 'restore_meal'; meal: Meal; expectedMeal?: Meal }
  | { kind: 'delete_meal'; mealId: string; expectedMeal?: Meal }
  | { kind: 'restore_goals'; goals: DailyGoals; expectedGoals?: DailyGoals }
  | { kind: 'restore_goal_profile'; profile?: GoalProfile; expectedProfile?: GoalProfile }
  | { kind: 'imported' };

export type ChatAction = {
  id: string;
  threadId: string;
  label: string;
  createdAt: number;
  undone: boolean;
  canUndo?: boolean;
  undo: ChatUndo;
};

export type ChatTranscript = AgentMessage[];
