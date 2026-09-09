import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ChatAction } from '../../domain/chat';
import { normalizeQuestionChoices, type QuestionChoices } from '../../domain/questionChoices.ts';

type ToolCall = Extract<Extract<AgentMessage, { role: 'assistant' }>['content'][number], { type: 'toolCall' }>;
export type ToolStatus = 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ToolExecution = { status: ToolStatus; arguments: Record<string, unknown> };
export type ActivityTool = { call: ToolCall; status: ToolStatus; error?: string };
export type ActivityFeedItem =
  | { kind: 'message'; key: string; message: AgentMessage; activeQuestions?: string[] }
  | { kind: 'question'; key: string; questions: QuestionChoices[]; active: boolean }
  | { kind: 'activity'; key: string; tools: ActivityTool[] }
  | { kind: 'action'; key: string; action: ChatAction };

/** Tool-result boundaries are invisible. User messages and assistant prose break
 * activity groups so joining internal agent steps never reorders conversation text.
 * Receipts follow their activity section and remain outside its disclosure. */
export function buildActivityFeed(input: {
  messages: AgentMessage[];
  streamingMessage?: AgentMessage;
  actions: ChatAction[];
  busy: boolean;
  toolExecutions?: Record<string, ToolExecution>;
  /** Retained for callers supplying current meal state. History remains visible
   * regardless of whether a question is still actionable or being answered. */
  pendingMealQuestions?: Record<string, string[]>;
  answeringMealIds?: ReadonlySet<string>;
}): ActivityFeedItem[] {
  const messages = [...input.messages];
  if (input.streamingMessage && !messages.includes(input.streamingMessage)) messages.push(input.streamingMessage);
  const results = new Map(messages.flatMap(message => message.role === 'toolResult' ? [[message.toolCallId, message] as const] : []));
  const lastUser = messages.findLastIndex(message => message.role === 'chatUser' || message.role === 'user');
  const latestQuestion = new Map(messages.flatMap((message, index) => message.role === 'mealQuestion' ? [[message.mealId, index] as const] : []));
  const feed: ActivityFeedItem[] = [];
  let group: Extract<ActivityFeedItem, { kind: 'activity' }> | undefined;
  const receipts = [...input.actions].sort((a, b) => a.createdAt - b.createdAt);
  const flushReceipts = (before: number) => {
    while (receipts.length && receipts[0].createdAt <= before) {
      const action = receipts.shift()!;
      feed.push({ kind: 'action', key: `action-${action.id}`, action });
    }
  };
  for (const [index, message] of messages.entries()) {
    if (message.role === 'toolResult') continue;
    const key = `message-${index}`;
    if (message.role !== 'assistant') {
      group = undefined;
      flushReceipts(message.timestamp);
      if (message.role === 'chatUser' || message.role === 'mealQuestion') {
        const activeQuestions = message.role === 'mealQuestion'
          ? latestQuestion.get(message.mealId) === index && !input.answeringMealIds?.has(message.mealId)
            ? message.questions.filter(question => !input.pendingMealQuestions || input.pendingMealQuestions[message.mealId]?.includes(question)) : []
          : undefined;
        feed.push({ kind: 'message', key, message, activeQuestions });
      }
      continue;
    }
    for (const [blockIndex, block] of message.content.entries()) {
      if (block.type === 'text' && block.text) {
        group = undefined;
        flushReceipts(message.timestamp);
        feed.push({ kind: 'message', key: `${key}-${blockIndex}`, message: { ...message, content: [block] } });
      } else if (block.type === 'toolCall') {
        const result = results.get(block.id);
        if (block.name === 'ask_question' && result && !result.isError) {
          const questions = normalizeQuestionChoices((result.details as { questions?: unknown } | undefined)?.questions);
          if (questions.length) {
            group = undefined;
            flushReceipts(message.timestamp);
            feed.push({ kind: 'question', key: `question-${block.id}`, questions, active: index > lastUser && !input.busy });
            continue;
          }
        }
        if (!group) {
          group = { kind: 'activity', key: `activity-${block.id}`, tools: [] };
          feed.push(group);
        }
        const execution = input.toolExecutions?.[block.id];
        const status = execution?.status === 'cancelled' ? 'cancelled' : result ? (result.isError ? 'failed' : 'completed') : execution?.status ?? (input.busy && index > lastUser ? 'preparing' : 'cancelled');
        const error = result?.isError ? result.content?.filter(block => block.type === 'text').map(block => block.text).join('\n').slice(0, 1000) : undefined;
        group.tools.push({ ...(error ? { error } : {}), call: { ...block, arguments: execution?.arguments ?? (status === 'preparing' ? {} : block.arguments) }, status });
      }
    }
  }
  flushReceipts(Infinity);
  return feed;
}
