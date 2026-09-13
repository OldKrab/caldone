import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ChatAction } from '../../domain/chat';
import { normalizeQuestionChoices, type QuestionChoices } from '../../domain/questionChoices.ts';
import type { MealActivityStage } from '../../services/mealActivity';
import type { AgentQuestion } from '../../domain/agentQuestion';
import type { ChatProviderActivity } from '../../domain/chatActivity';

type ToolCall = Extract<Extract<AgentMessage, { role: 'assistant' }>['content'][number], { type: 'toolCall' }>;
export type ToolStatus = 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ToolExecution = { status: ToolStatus; arguments: Record<string, unknown>; name?: string };
export type ActivityTool = { call: ToolCall; status: ToolStatus; error?: string };
export type ActivityFeedItem =
  | { kind: 'message'; key: string; message: AgentMessage; activeQuestions?: string[] }
  | { kind: 'question'; key: string; questions: QuestionChoices[]; active: boolean }
  | { kind: 'activity'; key: string; tools: ActivityTool[] }
  | { kind: 'progress'; key: string; activity: {kind: 'meal'; stage: MealActivityStage} }
  | { kind: 'action'; key: string; action: ChatAction };

/** Tool-result boundaries are invisible. User messages and assistant prose break
 * activity groups so joining internal agent steps never reorders conversation text.
 * Receipts follow their activity section and remain outside its disclosure. */
export function buildActivityFeed(input: {
  messages: AgentMessage[];
  streamingMessage?: AgentMessage;
  actions: ChatAction[];
  busy: boolean;
  mealActivity?: MealActivityStage;
  toolExecutions?: Record<string, ToolExecution>;
  providerActivities?: ChatProviderActivity[];
  /** Current meal state controls actionable cards; durable history is not a pending queue. */
  pendingMealQuestions?: Record<string, string[]>;
  answeringMealIds?: ReadonlySet<string>;
  questions?: AgentQuestion[];
}): ActivityFeedItem[] {
  const messages = [...input.messages];
  if (input.streamingMessage && !messages.includes(input.streamingMessage)) messages.push(input.streamingMessage);
  for (const [index, message] of messages.entries()) if (message.role === 'assistant')
    messages[index] = { ...message, content: message.content.filter(block => block.type !== 'thinking') };
  const results = new Map(messages.flatMap(message => message.role === 'toolResult' ? [[message.toolCallId, message] as const] : []));
  const lastUser = messages.findLastIndex(message => message.role === 'chatUser' || message.role === 'user');
  const latestInput = messages[lastUser];
  const processingForm = input.busy && latestInput?.role === 'chatUser' && latestInput.source === 'form';
  const feed: ActivityFeedItem[] = [];
  let group: Extract<ActivityFeedItem, { kind: 'activity' }> | undefined;
  const addTool = (tool: ActivityTool) => {
    if (!group) {
      group = { kind: 'activity', key: `activity-${tool.call.id}`, tools: [] };
      feed.push(group);
    }
    group.tools.push(tool);
  };
  const insertProviderActivities = (messageIndex: number, blockIndex: number) => {
    for (const activity of input.providerActivities ?? []) {
      if (activity.messageIndex !== messageIndex || activity.blockIndex !== blockIndex) continue;
      addTool({ call: { type: 'toolCall', id: activity.id, name: activity.name, arguments: {} },
        status: activity.status === 'active' ? 'running' : activity.status === 'complete' ? 'completed' : activity.status === 'cancelled' ? 'cancelled' : 'failed' });
    }
  };
  const receipts = [...input.actions].sort((a, b) => a.createdAt - b.createdAt);
  const flushReceipts = (before: number) => {
    while (receipts.length && receipts[0].createdAt <= before) {
      const action = receipts.shift()!;
      feed.push({ kind: 'action', key: `action-${action.id}`, action });
    }
  };
  for (const [index, message] of messages.entries()) {
    insertProviderActivities(index, 0);
    if (message.role === 'toolResult') continue;
    const key = `message-${index}`;
    if (message.role !== 'assistant') {
      group = undefined;
      flushReceipts(message.timestamp);
      if (message.role === 'mealQuestion' && input.questions !== undefined) continue;
      if (message.role === 'mealQuestion') {
        const latest = !messages.slice(index + 1).some(value => value.role === 'mealQuestion' && value.mealId === message.mealId);
        const activeQuestions = latest && !processingForm && !input.answeringMealIds?.has(message.mealId)
          ? message.questions.filter(question => !input.pendingMealQuestions || (input.pendingMealQuestions[message.mealId] ?? []).includes(question)) : [];
        feed.push({ kind: 'message', key, message, activeQuestions });
      } else if (message.role === 'chatUser') feed.push({ kind: 'message', key, message });
      continue;
    }
    for (const [blockIndex, block] of message.content.entries()) {
      if (blockIndex > 0) insertProviderActivities(index, blockIndex);
      if (block.type === 'text' && block.text) {
        group = undefined;
        flushReceipts(message.timestamp);
        feed.push({ kind: 'message', key: `${key}-${blockIndex}`, message: { ...message, content: [block] } });
      } else if (block.type === 'toolCall') {
        const result = results.get(block.id);
        if (block.name === 'ask_question' && result && !result.isError) {
          if (input.questions !== undefined) continue;
          const questions = normalizeQuestionChoices((result.details as { questions?: unknown } | undefined)?.questions);
          if (questions.length) {
            group = undefined;
            flushReceipts(message.timestamp);
            feed.push({ kind: 'question', key: `question-${block.id}`, questions, active: index > lastUser && !input.busy });
            continue;
          }
        }
        const execution = input.toolExecutions?.[block.id];
        const status = execution?.status === 'cancelled' ? 'cancelled' : result ? (result.isError ? 'failed' : 'completed') : execution?.status ?? (input.busy && index > lastUser ? 'preparing' : 'cancelled');
        addTool({ call: { ...block, arguments: execution?.arguments ?? (status === 'preparing' ? {} : block.arguments) }, status,
          error: result?.isError ? result.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') : undefined });
      }
    }
    if (message.content.length) insertProviderActivities(index, message.content.length);
  }
  insertProviderActivities(messages.length, 0);
  flushReceipts(Infinity);
  // The accepted message is already durable. Keep the unresolved question state
  // for the agent, but replace the submitting form with that visible message.
  const openQuestions = processingForm ? [] : input.questions?.filter(question => question.state === 'open');
  if (openQuestions?.length) feed.push({kind:'question',key:'open-questions',questions:openQuestions,
    active:!input.busy && !input.mealActivity});
  const hasActiveTool = feed.some(item => item.kind === 'activity' && item.tools.some(tool => tool.status === 'running' || tool.status === 'preparing'));
  const hasStreamingText = input.streamingMessage?.role === 'assistant' && input.streamingMessage.content.some(block => block.type === 'text' && block.text);
  if ((input.mealActivity || input.busy) && !hasActiveTool && !hasStreamingText)
    feed.push({kind: 'progress', key: 'meal-progress', activity: {kind: 'meal', stage: input.mealActivity ?? 'thinking'}});
  return feed;
}
