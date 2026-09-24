import { database, transaction } from './database';
import { sanitizeChatMessage, writeMessages } from './chatRepository';
import type { ChatUserMessage } from '../domain/chat';
import type { MealResearch } from '../domain/mealResearch';
import { readMeal } from './mealRepository';

export type AgentTurn = {
  id: string;
  threadId: string;
  mealId?: string;
  message: ChatUserMessage;
  state: 'queued' | 'running' | 'failed' | 'completed' | 'cancelled';
  research?: MealResearch;
  error?: string;
};
type Row = {
  id: string;
  thread_id: string;
  meal_id: string | null;
  message_json: string;
  state: AgentTurn['state'];
  research_json?: string | null;
  error?: string | null;
};
const fromRow = (row: Row): AgentTurn => ({
  id: row.id,
  threadId: row.thread_id,
  mealId: row.meal_id ?? undefined,
  message: JSON.parse(row.message_json),
  state: row.state,
  research: row.research_json ? JSON.parse(row.research_json) : undefined,
  error: row.error ?? undefined,
});

/** The accepted input and its recovery marker become durable in the same commit. */
export async function beginAgentTurn(
  threadId: string,
  mealId: string | undefined,
  message: ChatUserMessage,
): Promise<AgentTurn> {
  if (!message.id) throw new Error('A submitted message needs a stable request ID.');
  return transaction(async (connection) => {
    if (!(await connection.getFirstAsync('SELECT id FROM chat_threads WHERE id = ?', threadId)))
      throw new Error('Conversation no longer exists.');
    const existing = await connection.getFirstAsync<Row>(
      'SELECT * FROM agent_turns WHERE id = ?',
      message.id!,
    );
    if (existing) {
      if (existing.thread_id !== threadId) throw new Error('Request belongs to another conversation.');
      return fromRow(existing);
    }
    const active = await connection.getFirstAsync<Row>(
      `SELECT * FROM agent_turns
      WHERE (thread_id = ? OR meal_id = ?) AND state IN ('queued','running') LIMIT 1`,
      threadId,
      mealId ?? null,
    );
    if (active)
      throw new Error(
        'A request for this meal is already pending. Resume or stop it before sending another.',
      );
    if (message.source === 'addition') {
      const meal = mealId ? await readMeal(connection, mealId) : undefined;
      if (!meal?.analysis) throw new Error('An addition needs an existing meal estimate.');
      message = { ...message, additionOriginalItemCount: meal.analysis.items.length };
    }
    // A deliberate new message supersedes a failed attempt, while its history
    // and any already committed changes remain available to the agent.
    await connection.runAsync(
      `UPDATE agent_turns SET state='cancelled' WHERE thread_id=? AND state='failed'`,
      threadId,
    );
    await writeMessages(connection, threadId, [message]);
    await connection.runAsync(
      `INSERT INTO agent_turns (id,thread_id,meal_id,message_json,state,created_at)
      VALUES (?,?,?,?,'queued',?)`,
      message.id!,
      threadId,
      mealId ?? null,
      JSON.stringify(sanitizeChatMessage(message)),
      message.timestamp,
    );
    return { id: message.id!, threadId, mealId, message, state: 'queued' };
  });
}

export async function pendingAgentTurn(scope: {
  threadId?: string;
  mealId?: string;
}): Promise<AgentTurn | undefined> {
  const row = await database.getFirstAsync<Row>(
    `SELECT * FROM agent_turns WHERE (thread_id=? OR meal_id=?)
    AND state IN ('queued','running','failed') ORDER BY created_at DESC LIMIT 1`,
    scope.threadId ?? null,
    scope.mealId ?? null,
  );
  return row ? fromRow(row) : undefined;
}

export async function markAgentTurn(id: string, state: AgentTurn['state'], error?: string): Promise<void> {
  if (state === 'failed') {
    await database.runAsync(
      `UPDATE agent_turns SET state='failed',error=?,attempts=attempts+1,
      next_attempt_at=CASE WHEN attempts<4 THEN ? + MIN(3600000,60000*(1 << attempts)) ELSE NULL END WHERE id=?`,
      error ?? null,
      Date.now(),
      id,
    );
  } else
    await database.runAsync(
      'UPDATE agent_turns SET state=?,error=?,next_attempt_at=NULL WHERE id=?',
      state,
      error ?? null,
      id,
    );
}

export async function runnableAgentTurns(): Promise<AgentTurn[]> {
  const rows = await database.getAllAsync<Row>(
    `SELECT * FROM agent_turns WHERE state IN ('queued','running')
    OR (state='failed' AND next_attempt_at IS NOT NULL AND next_attempt_at<=?) ORDER BY created_at`,
    Date.now(),
  );
  return rows.map(fromRow);
}

/** Multiple provider requests are one agent turn. Preserve observed sources
 * when a later tool-only response contains no new web search. */
export async function recordAgentResearch(threadId: string, research: MealResearch): Promise<void> {
  await transaction(async (connection) => {
    const row = await connection.getFirstAsync<Row>(
      "SELECT * FROM agent_turns WHERE thread_id=? AND state='running' ORDER BY created_at DESC LIMIT 1",
      threadId,
    );
    if (!row) return;
    const previous = fromRow(row).research;
    const sources = [
      ...new Map(
        [...(previous?.sources ?? []), ...research.sources].map((source) => [source.url, source]),
      ).values(),
    ];
    const next =
      previous?.status === 'completed' && research.status === 'not_searched'
        ? previous
        : { ...research, sources: research.status === 'completed' ? sources : research.sources };
    await connection.runAsync(
      'UPDATE agent_turns SET research_json=? WHERE id=?',
      JSON.stringify(next),
      row.id,
    );
  });
}
