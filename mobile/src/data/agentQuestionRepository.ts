import { database } from './database';
import type { AgentQuestion, QuestionResolution } from '../domain/agentQuestion';
import type { QuestionChoices } from '../domain/questionChoices';
import {
  mealQuestionChoices,
  type MealClarification,
  type LegacyMealClarification,
} from '../domain/mealQuestions';

type Connection = typeof database;
const listeners = new Set<() => void>();
export function subscribeAgentQuestions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function notifyAgentQuestions(): void {
  // Repository reads share the transaction queue, so observers see committed
  // state (or the unchanged state after rollback), never a half-applied update.
  queueMicrotask(() => listeners.forEach((listener) => listener()));
}

export async function initializeAgentQuestions(): Promise<void> {
  await database.execAsync(`CREATE TABLE IF NOT EXISTS agent_questions (
    id TEXT PRIMARY KEY NOT NULL, meal_id TEXT, thread_id TEXT, question_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_questions_meal ON agent_questions(meal_id);
  CREATE INDEX IF NOT EXISTS agent_questions_thread ON agent_questions(thread_id);`);
}

export async function readAgentQuestions(
  scope: { mealId?: string; threadId?: string },
  connection: Connection = database,
): Promise<AgentQuestion[]> {
  const rows = await connection.getAllAsync<{ question_json: string }>(
    'SELECT question_json FROM agent_questions WHERE meal_id = ? OR thread_id = ? ORDER BY rowid',
    scope.mealId ?? null,
    scope.threadId ?? null,
  );
  return rows.map((row) => JSON.parse(row.question_json) as AgentQuestion);
}

export async function writeAgentQuestion(question: AgentQuestion, connection: Connection): Promise<void> {
  const existing = await connection.getFirstAsync<{ meal_id: string | null; thread_id: string | null }>(
    'SELECT meal_id,thread_id FROM agent_questions WHERE id=?',
    question.id,
  );
  if (
    existing &&
    (existing.meal_id !== (question.mealId ?? null) || existing.thread_id !== (question.threadId ?? null))
  )
    throw new Error('Question ID already belongs to another record.');
  await connection.runAsync(
    `INSERT INTO agent_questions (id,meal_id,thread_id,question_json) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET question_json=excluded.question_json`,
    question.id,
    question.mealId ?? null,
    question.threadId ?? null,
    JSON.stringify(question),
  );
  notifyAgentQuestions();
}

/** Import old meal clarification once. Closed records remain, so old analysis
 * JSON cannot resurrect an answered question when the app is restarted. */
export async function readMealQuestions(
  mealId: string,
  legacy: MealClarification | LegacyMealClarification | undefined,
  connection: Connection = database,
): Promise<AgentQuestion[]> {
  const existing = await readAgentQuestions({ mealId }, connection);
  if (existing.length || !legacy) return existing;
  const imported: AgentQuestion[] = mealQuestionChoices(legacy).map((choice, index) => ({
    ...choice,
    id: `legacy:${mealId}:${index}`,
    mealId,
    state: 'open',
    createdAt: 0,
  }));
  for (const question of imported)
    await connection.runAsync(
      'INSERT OR IGNORE INTO agent_questions (id,meal_id,thread_id,question_json) VALUES (?,?,NULL,?)',
      question.id,
      mealId,
      JSON.stringify(question),
    );
  return imported;
}

export async function changeAgentQuestions(
  input: {
    callId: string;
    mealId?: string;
    threadId: string;
    questions?: QuestionChoices[];
    resolutions?: QuestionResolution[];
  },
  connection: Connection,
): Promise<AgentQuestion[]> {
  if (!(await connection.getFirstAsync('SELECT id FROM chat_threads WHERE id = ?', input.threadId)))
    throw new Error('Conversation no longer exists.');
  const current = await readAgentQuestions(input, connection);
  for (const resolution of input.resolutions ?? []) {
    const question = current.find((question) => question.id === resolution.id);
    if (!question)
      throw new Error(
        'Question is unavailable in this conversation. Read current questions before retrying.',
      );
    if (question.state !== 'open')
      throw new Error('This question has already been answered or dismissed. Read current questions.');
    if (!resolution.answer?.trim())
      throw new Error('Provide the user answer or the reason this question no longer applies.');
    Object.assign(question, resolution, { answer: resolution.answer.trim() });
    await writeAgentQuestion(question, connection);
  }
  for (const [index, choice] of (input.questions ?? []).entries()) {
    if (!choice.question.trim()) throw new Error('A question must not be empty.');
    const options = [...new Set(choice.options.map((option) => option.trim()).filter(Boolean))];
    if (choice.options.length && options.length < 2)
      throw new Error('Provide at least two distinct choices, or no options for a free-text question.');
    // A repeated ask in the same turn must not create another actionable card.
    if (current.some((question) => question.state === 'open' && question.question === choice.question.trim()))
      continue;
    const question: AgentQuestion = {
      ...choice,
      options,
      question: choice.question.trim(),
      id: `${input.callId}:${index}`,
      mealId: input.mealId,
      threadId: input.mealId ? undefined : input.threadId,
      state: 'open',
      createdAt: Date.now(),
    };
    await writeAgentQuestion(question, connection);
    current.push(question);
  }
  return current;
}
