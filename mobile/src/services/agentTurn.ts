import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { ChatUserMessage } from '../domain/chat';
import { beginAgentTurn, markAgentTurn, pendingAgentTurn, type AgentTurn } from '../data/agentTurnRepository';
import {
  getChatToolReceipt,
  loadChatMessages,
  saveChatMessages,
  sanitizeChatMessage,
} from '../data/chatRepository';
import { readAgentQuestions } from '../data/agentQuestionRepository';
import { isConnectionError } from './connectionRecovery';
import { waitForConnectionRecovery } from './foregroundRecovery';
import { setMealActivity } from './mealActivity';
import { getMeal, replaceMealIfRevision } from '../data/mealRepository';

/** One accepted message drives one recoverable agent turn. Persistence is
 * awaited before executing tools, so every committed mutation has a durable
 * call ID even if Android kills the process before its tool result is saved. */
export async function runAgentTurn(input: {
  agent: Agent;
  threadId: string;
  mealId?: string;
  message?: ChatUserMessage;
  signal?: AbortSignal;
}): Promise<void> {
  const { agent, threadId, mealId } = input;
  if (input.message?.questionAnswers?.length) {
    const questions = await readAgentQuestions({ threadId, mealId });
    for (const answer of input.message.questionAnswers) {
      if (!questions.some((question) => question.id === answer.questionId && question.state === 'open'))
        throw new Error('This question has already changed or closed. Your answer has not been sent.');
    }
  }
  const turn = input.message
    ? await beginAgentTurn(threadId, mealId, input.message)
    : await pendingAgentTurn({ threadId });
  if (!turn || turn.state === 'completed' || turn.state === 'cancelled') return;
  const unsubscribe = agent.subscribe(async (event) => {
    if (event.type === 'message_end' || event.type === 'agent_end')
      await saveChatMessages(threadId, agent.state.messages.map(sanitizeChatMessage));
  });
  await markAgentTurn(turn.id, 'running');
  if (mealId) setMealActivity(mealId, 'thinking');
  try {
    if (
      input.message &&
      !agent.state.messages.some((message) => message.role === 'chatUser' && message.id === turn.message.id)
    ) {
      await agent.prompt(turn.message);
    } else if (await restoreTurn(agent, turn)) await agent.continue();
    if (isConnectionError(agent.state.errorMessage) && !input.signal?.aborted) {
      await waitForConnectionRecovery(input.signal);
      if (await restoreTurn(agent, turn)) await agent.continue();
    }
    const last = agent.state.messages.at(-1);
    if (input.signal?.aborted || (last?.role === 'assistant' && last.stopReason === 'aborted')) {
      await markAgentTurn(turn.id, 'cancelled');
      return;
    }
    if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
    if (mealId) {
      const meal = await getMeal(mealId);
      // A final explanation may contain no usable estimate. The request has
      // still ended; do not leave the diary displaying work that cannot resume.
      if (meal && !meal.analysis && (meal.status === 'queued' || meal.status === 'analyzing'))
        await replaceMealIfRevision({ ...meal, status: 'needs_input' }, meal.revision);
    }
    await markAgentTurn(turn.id, 'completed');
  } catch (error) {
    await markAgentTurn(
      turn.id,
      input.signal?.aborted ? 'cancelled' : 'failed',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    unsubscribe();
    if (mealId) setMealActivity(mealId);
  }
}

async function restoreTurn(agent: Agent, turn: AgentTurn): Promise<boolean> {
  const messages = (await loadChatMessages(turn.threadId)).filter(
    (message) =>
      message.role !== 'assistant' || (message.stopReason !== 'error' && message.stopReason !== 'aborted'),
  );
  const start = messages.findIndex(
    (message) => message.role === 'chatUser' && message.id === turn.message.id,
  );
  if (start < 0) throw new Error('The saved request is missing from its conversation.');
  const results = new Set(
    messages.flatMap((message) => (message.role === 'toolResult' ? [message.toolCallId] : [])),
  );
  for (const message of messages.slice(start)) {
    if (message.role !== 'assistant') continue;
    for (const call of message.content) {
      if (call.type !== 'toolCall' || results.has(call.id)) continue;
      const receipt = (await getChatToolReceipt(call.id, turn.threadId)) as any;
      // Never guess whether an interrupted tool committed. Meal updates have
      // atomic receipts; an unknown result explicitly asks the agent to reread.
      const result = receipt?.meal
        ? {
            content: [{ type: 'text', text: JSON.stringify({ success: true, ...receipt }) }],
            details: receipt,
          }
        : receipt;
      messages.push({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        timestamp: Date.now(),
        isError: !result,
        content: result?.content ?? [
          {
            type: 'text',
            text: 'The previous tool was interrupted; its outcome is unknown. Read current data before deciding whether a change is still needed.',
          },
        ],
        details: result?.details,
      } as AgentMessage);
      results.add(call.id);
    }
  }
  agent.state.messages = messages;
  await saveChatMessages(turn.threadId, messages);
  const last = messages.at(-1);
  return !(last?.role === 'assistant' && last.stopReason === 'stop');
}
