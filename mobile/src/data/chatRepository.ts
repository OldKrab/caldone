import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { Directory, File, Paths } from 'expo-file-system';
import { database, transaction } from './database';

import { newChatUserMessage, newMealQuestionMessage, type ChatAction, type ChatThread, type ChatUndo } from '../domain/chat';
import { getMeal } from './mealRepository';


type ThreadRow = { id: string; title: string; created_at: number; updated_at: number; meal_id?: string | null; purpose?: string | null };
type MessageRow = { message_json: string };
type ActionRow = { id: string; thread_id: string; label: string; created_at: number; undone: number; undo_json: string };

export async function initializeChat(): Promise<void> {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      thread_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      message_json TEXT NOT NULL,
      PRIMARY KEY (thread_id, position)
    );
    CREATE TABLE IF NOT EXISTS chat_actions (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      undone INTEGER NOT NULL DEFAULT 0,
      undo_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_tool_receipts (
      call_id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL,
      result_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_threads_updated_at ON chat_threads(updated_at DESC);
    CREATE INDEX IF NOT EXISTS chat_actions_thread_id ON chat_actions(thread_id, created_at DESC);
  `);
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(chat_threads)');
  if (!columns.some((column) => column.name === 'meal_id')) {
    await database.execAsync('ALTER TABLE chat_threads ADD COLUMN meal_id TEXT;');
  }
  if (!columns.some((column) => column.name === 'purpose')) {
    await database.execAsync('ALTER TABLE chat_threads ADD COLUMN purpose TEXT;');
  }
  await database.execAsync('CREATE INDEX IF NOT EXISTS chat_threads_meal_id ON chat_threads(meal_id, updated_at DESC);');
  await database.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_one_clarification
    ON chat_threads(meal_id) WHERE purpose = 'clarification';`);
}

export async function createChatThread(context?: { mealId?: string; purpose?: 'meal' | 'clarification'; title?: string }): Promise<ChatThread> {
  const now = Date.now();
  const thread: ChatThread = {
    id: randomId(),
    title: context?.title ?? '',
    createdAt: now,
    updatedAt: now,
    mealId: context?.mealId,
    purpose: context?.purpose,
  };
  await database.runAsync(`DELETE FROM chat_threads
    WHERE title = ''
      AND meal_id IS NULL
      AND id NOT IN (SELECT DISTINCT thread_id FROM chat_messages)
      AND id NOT IN (SELECT DISTINCT thread_id FROM chat_actions)`);
  await database.runAsync(
    'INSERT INTO chat_threads (id, title, created_at, updated_at, meal_id, purpose) VALUES (?, ?, ?, ?, ?, ?)',
    thread.id,
    thread.title,
    thread.createdAt,
    thread.updatedAt,
    thread.mealId ?? null,
    thread.purpose ?? null,
  );
  return thread;
}

export async function ensureClarificationThread(mealId: string, title: string): Promise<ChatThread> {
  const existing = await preferredMealThread(mealId, true);
  if (existing) return existing;
  try {
    return await createChatThread({ mealId, purpose: 'clarification', title: title.trim().slice(0, 64) });
  } catch (error) {
    const raced = await preferredMealThread(mealId, true);
    if (raced) return raced;
    throw error;
  }
}

/** Keeps model questions in the durable meal conversation, not only in meal UI state. */
export async function syncMealQuestionsToThread(
  threadId: string,
  mealId: string,
  questions: string[],
  timestamp = Date.now(),
): Promise<void> {
  const cleanQuestions = questions.map((question) => question.trim()).filter(Boolean);
  if (cleanQuestions.length === 0) return;
  await transaction(async (database) => {
    const messages = await readMessages(database, threadId);
    const existing = new Set(messages.flatMap((message) => message.role === 'mealQuestion' ? message.questions : []));
    const unseen = cleanQuestions.filter((question) => !existing.has(question));
    if (unseen.length === 0) return;
    await writeMessages(database, threadId, [...messages, newMealQuestionMessage({ mealId, questions: unseen, timestamp })]);
  });
}

export async function appendInlineMealAnswer(threadId: string, answer: string, timestamp = Date.now()): Promise<void> {
  const text = answer.trim();
  if (!text) return;
  await transaction(async (database) => {
    const messages = await readMessages(database, threadId);
    await writeMessages(database, threadId, [...messages, newChatUserMessage(text, timestamp)]);
  });
}

export async function preferredMealThread(mealId: string, clarification: boolean): Promise<ChatThread | undefined> {
  const row = await database.getFirstAsync<ThreadRow>(
    clarification
      ? `SELECT * FROM chat_threads WHERE meal_id = ? AND purpose = 'clarification'
         ORDER BY updated_at DESC LIMIT 1`
      : 'SELECT * FROM chat_threads WHERE meal_id = ? ORDER BY updated_at DESC LIMIT 1',
    mealId,
  );
  return row ? threadFromRow(row) : undefined;
}

export async function latestChatThread(): Promise<ChatThread | undefined> {
  const row = await database.getFirstAsync<ThreadRow>('SELECT * FROM chat_threads ORDER BY updated_at DESC LIMIT 1');
  return row ? threadFromRow(row) : undefined;
}

/** Meal evidence can be spread across its clarification and regular chats.
 * Preserve each transcript's order, including tool call/result pairs. */
export async function loadMealChatMessages(mealId: string): Promise<AgentMessage[]> {
  const threads = (await listChatThreads()).filter(thread => thread.mealId === mealId)
    .sort((a, b) => a.createdAt - b.createdAt);
  return (await Promise.all(threads.map(thread => loadChatMessages(thread.id)))).flat();
}

export async function listChatThreads(): Promise<ChatThread[]> {
  const rows = await database.getAllAsync<ThreadRow>('SELECT * FROM chat_threads ORDER BY updated_at DESC');
  return rows.map(threadFromRow);
}

export async function renameChatThread(id: string, title: string): Promise<void> {
  await database.runAsync(
    'UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?',
    title.trim().slice(0, 64),
    Date.now(),
    id,
  );
}

export async function touchChatThread(id: string): Promise<void> {
  await database.runAsync('UPDATE chat_threads SET updated_at = ? WHERE id = ?', Date.now(), id);
}

export async function deleteChatThread(id: string): Promise<void> {
  const messages = await loadChatMessages(id);
  const actions = await listChatActions(id);
  await transaction(async (database) => {
    await database.runAsync('DELETE FROM chat_messages WHERE thread_id = ?', id);
    await database.runAsync('DELETE FROM chat_actions WHERE thread_id = ?', id);
    await database.runAsync('DELETE FROM chat_tool_receipts WHERE thread_id = ?', id);
    await database.runAsync('DELETE FROM chat_threads WHERE id = ?', id);
  });
  for (const uri of attachmentUris(messages)) {
    try { new File(uri).delete(); } catch { /* The attachment may already be absent. */ }
  }
  await discardDeletedMealPhotos(actions);
}

export async function loadChatMessages(threadId: string): Promise<AgentMessage[]> {
  return readMessages(database, threadId);
}

async function readMessages(database: typeof import('./database').database, threadId: string): Promise<AgentMessage[]> {
  const rows = await database.getAllAsync<MessageRow>(
    'SELECT message_json FROM chat_messages WHERE thread_id = ? ORDER BY position ASC',
    threadId,
  );
  return rows.flatMap((row) => {
    try { return [JSON.parse(row.message_json) as AgentMessage]; } catch { return []; }
  });
}

export async function saveChatMessages(threadId: string, messages: AgentMessage[]): Promise<void> {
  await transaction((database) => writeMessages(database, threadId, messages));
}

async function writeMessages(database: typeof import('./database').database, threadId: string, messages: AgentMessage[]): Promise<void> {
  // Only completed messages are persisted. Keep durable history and append unseen
  // messages: the active agent snapshot may not include externally added questions.
  // Compare the full payload, not timestamps alone (two messages can share a millisecond).
  const existing = await readMessages(database, threadId);
  const known = new Set(existing.map((message) => JSON.stringify(sanitizeChatMessage(message))));
  let position = existing.length;
  for (const message of messages) {
    const json = JSON.stringify(sanitizeChatMessage(message));
    if (known.has(json)) continue;
    await database.runAsync(
      'INSERT INTO chat_messages (thread_id, position, message_json) VALUES (?, ?, ?)',
      threadId, position++, json,
    );
    known.add(json);
  }
  await database.runAsync('UPDATE chat_threads SET updated_at = ? WHERE id = ?', Date.now(), threadId);
}

export async function recordChatAction(input: {
  id?: string;
  threadId: string;
  label: string;
  undo: ChatUndo;
}): Promise<ChatAction> {
  const action: ChatAction = {
    id: input.id ?? randomId(),
    threadId: input.threadId,
    label: input.label,
    createdAt: Date.now(),
    undone: false,
    undo: input.undo,
  };
  await database.runAsync(
    'INSERT OR IGNORE INTO chat_actions (id, thread_id, label, created_at, undone, undo_json) VALUES (?, ?, ?, ?, 0, ?)',
    action.id,
    action.threadId,
    action.label,
    action.createdAt,
    JSON.stringify(action.undo),
  );
  return await getChatAction(action.id) ?? action;
}

export async function getChatToolReceipt(callId: string, threadId: string): Promise<unknown | undefined> {
  const row = await database.getFirstAsync<{ result_json: string }>(
    'SELECT result_json FROM chat_tool_receipts WHERE call_id = ? AND thread_id = ?',
    callId,
    threadId,
  );
  if (!row) return undefined;
  try { return JSON.parse(row.result_json) as unknown; } catch { return undefined; }
}

export async function saveChatToolReceipt(callId: string, threadId: string, result: unknown): Promise<void> {
  await database.runAsync(
    'INSERT OR REPLACE INTO chat_tool_receipts (call_id, thread_id, result_json) VALUES (?, ?, ?)',
    callId,
    threadId,
    JSON.stringify(result),
  );
}

export async function listChatActions(threadId: string): Promise<ChatAction[]> {
  const rows = await database.getAllAsync<ActionRow>(
    'SELECT * FROM chat_actions WHERE thread_id = ? ORDER BY created_at ASC',
    threadId,
  );
  return rows.flatMap((row) => {
    try {
      return [{
        id: row.id,
        threadId: row.thread_id,
        label: row.label,
        createdAt: row.created_at,
        undone: row.undone === 1,
        canUndo: row.undone !== 2,
        undo: JSON.parse(row.undo_json) as ChatUndo,
      }];
    } catch {
      return [];
    }
  });
}

export async function getChatAction(id: string): Promise<ChatAction | undefined> {
  const row = await database.getFirstAsync<ActionRow>('SELECT * FROM chat_actions WHERE id = ?', id);
  if (!row) return undefined;
  return {
    id: row.id,
    threadId: row.thread_id,
    label: row.label,
    createdAt: row.created_at,
    undone: row.undone === 1,
    canUndo: row.undone !== 2,
    undo: JSON.parse(row.undo_json) as ChatUndo,
  };
}

export async function markChatActionUndone(id: string): Promise<void> {
  await database.runAsync('UPDATE chat_actions SET undone = 1 WHERE id = ?', id);
}

export async function exportChatData(includePhotos = false): Promise<unknown> {
  const threads = await listChatThreads();
  return Promise.all(threads.map(async (thread) => ({
    thread,
    messages: await Promise.all((await loadChatMessages(thread.id)).map((message) => exportableMessage(message, includePhotos))),
    actions: await listChatActions(thread.id),
  })));
}

export async function deleteAllChatData(): Promise<void> {
  const threads = await listChatThreads();
  const actions = (await Promise.all(threads.map((thread) => listChatActions(thread.id)))).flat();
  await database.execAsync('DELETE FROM chat_messages; DELETE FROM chat_actions; DELETE FROM chat_threads; DELETE FROM chat_tool_receipts;');
  try {
    const directory = new Directory(Paths.document, 'chat-attachments');
    if (directory.exists) directory.delete();
  } catch {
    // Database deletion remains authoritative when file cleanup is unavailable.
  }
  await discardDeletedMealPhotos(actions);
}

function threadFromRow(row: ThreadRow): ChatThread {
  const purpose = row.purpose === 'meal' || row.purpose === 'clarification' ? row.purpose : undefined;
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at, mealId: row.meal_id ?? undefined, purpose };
}

export function sanitizeChatMessage(message: AgentMessage): AgentMessage {
  if (message.role === 'assistant') {
    return { ...message, content: message.content.filter((block) => block.type !== 'thinking') };
  }
  if (message.role === 'toolResult') {
    const hadImages = message.content.some((block) => block.type === 'image');
    return {
      ...message,
      content: [
        ...message.content.filter((block) => block.type !== 'image'),
        ...(hadImages ? [{ type: 'text' as const, text: '[Meal photo was shown to the assistant.]' }] : []),
      ],
    };
  }
  return message;
}

async function exportableMessage(message: AgentMessage, includePhotos: boolean): Promise<unknown> {
  if (message.role !== 'chatUser') return sanitizeChatMessage(message);
  return {
    ...message,
    attachments: await Promise.all(message.attachments.map(async (attachment) => {
      if (!includePhotos) return { id: attachment.id, mimeType: attachment.mimeType };
      try {
        return { id: attachment.id, mimeType: attachment.mimeType, base64: await new File(attachment.uri).base64() };
      } catch {
        return { id: attachment.id, mimeType: attachment.mimeType, unavailable: true };
      }
    })),
  };
}

function attachmentUris(messages: AgentMessage[]): string[] {
  return messages.flatMap((message) => message.role === 'chatUser'
    ? message.attachments.map((attachment) => attachment.uri)
    : []);
}

async function discardDeletedMealPhotos(actions: ChatAction[]): Promise<void> {
  for (const action of actions) {
    if (action.undone || action.undo.kind !== 'restore_meal') continue;
    const current = await getMeal(action.undo.meal.id);
    const retained = new Set(current?.photos.map((photo) => photo.uri) ?? []);
    for (const photo of action.undo.meal.photos) {
      if (retained.has(photo.uri)) continue;
      try { new File(photo.uri).delete(); } catch { /* The photo may already be absent. */ }
    }
  }
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
