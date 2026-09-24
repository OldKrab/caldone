import { database, transaction } from './database';

import type {
  DailyGoals,
  Meal,
  MealAnalysis,
  MealPhoto,
  MealStatus,
} from '../domain/meal';
import { parseGoalProfile, type GoalProfile } from '../domain/goalEstimator';
import { normalizeMealPhotos } from '../domain/mealOperations';
import { normalizeClarification } from '../domain/mealQuestions';
import { initializeAgentQuestions, readMealQuestions, writeAgentQuestion, notifyAgentQuestions } from './agentQuestionRepository';


type MealRow = {
  id: string;
  revision: number;
  captured_at: number;
  status: MealStatus;
  note: string;
  photos_json: string;
  analysis_json: string | null;
  error: string | null;
};

export type AiDiagnosticEvent = {
  id: string;
  createdAt: number;
  operation: 'analyze' | 'clarify' | 'correct' | 'chat';
  phase?: 'started';
  appState?: string;
  mealId?: string;
  threadId?: string;
  provider: string;
  model: string;
  api: string;
  promptVersion: string;
  thinkingLevel?: string;
  webSearchEnabled: boolean;
  searchStatus?: import('../domain/mealResearch').MealResearch['status'];
  durationMs: number;
  responseId?: string;
  stopReason?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contentTypes?: string[];
  toolNames?: string[];
  outputText?: string;
  error?: string;
};

export type LayoutDiagnosticEvent = {
  id: string;
  createdAt: number;
  operation: 'layout';
  traceVersion: 'assistant-layout-v1';
  phase: 'input_focus' | 'keyboard_show' | 'keyboard_hide';
  platform: string;
  platformVersion: string | number;
  window: { width: number; height: number };
  screen?: { x: number; y: number; width: number; height: number };
  composer?: { x: number; y: number; width: number; height: number };
  keyboard?: { height: number; screenY: number };
  keyboardEventVisible: boolean;
  effectiveKeyboardVisible: boolean;
  restingWindowHeight: number;
  navigationInset: number;
  safeAreaBottom: number;
};

export type LifecycleDiagnosticEvent = {
  id: string;
  createdAt: number;
  operation: 'lifecycle';
  previousState: string;
  appState: string;
};

export type CameraDiagnosticEvent = {
  id: string;
  createdAt: number;
  operation: 'camera';
  lenses: Array<{ id: string; scale: number; min: number; max: number; primary: boolean }>;
  error?: string;
};

export type SearchDiagnosticEvent = {
  id: string;
  createdAt: number;
  operation: 'web_search';
  activityId: string;
  status: 'active' | 'complete' | 'error';
};

/** Non-authoritative work must not turn a committed mutation into a failure.
 * Record the boundary, without exporting observer errors or meal contents. */
export type ObserverDiagnosticEvent = {
  id: string; createdAt: number; operation: 'observer_error'; threadId: string;
  stage: 'screen_refresh' | 'post_commit_refresh' | 'photo_cleanup'; toolCallId?: string;
};
export type DiagnosticEvent = AiDiagnosticEvent | LayoutDiagnosticEvent | LifecycleDiagnosticEvent | CameraDiagnosticEvent | SearchDiagnosticEvent | ObserverDiagnosticEvent | import('../ai/requestDiagnostics').RequestDiagnostic | import('../ai/requestDiagnostics').ToolDiagnostic;

async function fromRow(row: MealRow, connection = database): Promise<Meal> {
  const parsedPhotos = JSON.parse(row.photos_json) as Array<Partial<MealPhoto> & Pick<MealPhoto, 'uri' | 'mimeType'>>;
  const parsedAnalysis = row.analysis_json ? (JSON.parse(row.analysis_json) as MealAnalysis) : undefined;
  const analysis = parsedAnalysis ? {
    ...parsedAnalysis,
    clarification: normalizeClarification(parsedAnalysis.clarification),
  } : undefined;
  const questions = await readMealQuestions(row.id, analysis?.clarification, connection);
  const open = questions.filter(question => question.state === 'open');
  if (analysis && questions.length) {
    // Compatibility view for existing meal screens and backups. The shared
    // question records are authoritative, including after all questions close.
    analysis.clarification = open.length ? {
      questions: open.map(question => question.question), choices: open,
      impactCalories: analysis.clarification?.impactCalories ?? 0,
    } : undefined;
  }
  return {
    id: row.id,
    revision: row.revision,
    capturedAt: row.captured_at,
    status: row.status==='complete' && open.length?'needs_input':row.status,
    note: row.note,
    photos: normalizeMealPhotos(row.id, row.captured_at, parsedPhotos),
    analysis,
    error: row.error ?? undefined,
    questions,
  };
}

export async function initializeMeals(): Promise<void> {
  await initializeAgentQuestions();
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      captured_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL,
      photos_json TEXT NOT NULL,
      analysis_json TEXT,
      error TEXT,
      clarification_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS diagnostic_events (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      event_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS meals_captured_at ON meals(captured_at DESC);
  `);
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(meals)');
  if (!columns.some((column) => column.name === 'revision')) {
    await database.execAsync('ALTER TABLE meals ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;');
  }
  if (!columns.some((column) => column.name === 'clarification_at')) {
    await database.execAsync('ALTER TABLE meals ADD COLUMN clarification_at INTEGER;');
  }
  if (!columns.some((column) => column.name === 'attempts')) {
    await database.execAsync('ALTER TABLE meals ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;');
  }
  if (!columns.some((column) => column.name === 'next_attempt_at')) {
    await database.execAsync('ALTER TABLE meals ADD COLUMN next_attempt_at INTEGER;');
  }
}

/** Stores only sanitized AI request metadata; credentials and image bytes never enter this table. */
export async function appendDiagnosticEvent(event: DiagnosticEvent): Promise<void> {
  await database.runAsync(
    'INSERT INTO diagnostic_events (id, created_at, event_json) VALUES (?, ?, ?)',
    event.id,
    event.createdAt,
    JSON.stringify(event),
  );
  await database.runAsync(
    `DELETE FROM diagnostic_events
     WHERE id NOT IN (SELECT id FROM diagnostic_events ORDER BY created_at DESC LIMIT 250)`,
  );
}

export async function listDiagnosticEvents(): Promise<DiagnosticEvent[]> {
  const rows = await database.getAllAsync<{ event_json: string }>(
    'SELECT event_json FROM diagnostic_events ORDER BY created_at DESC',
  );
  return rows.flatMap((row) => {
    try { return [JSON.parse(row.event_json) as DiagnosticEvent]; } catch { return []; }
  });
}

export async function createMeal(input: {
  id: string;
  capturedAt: number;
  note: string;
  photos: MealPhoto[];
}): Promise<Meal> {
  await database.runAsync(
    `INSERT INTO meals (id, revision, captured_at, status, note, photos_json)
     VALUES (?, 1, ?, 'queued', ?, ?)`,
    input.id,
    input.capturedAt,
    input.note,
    JSON.stringify(input.photos),
  );
  return { ...input, revision: 1, status: 'queued' };
}

/** Restores a complete meal snapshot for assistant undo and recovery flows. */
export async function saveMealRecord(meal: Meal): Promise<void> {
  await transaction(async connection => {
  await connection.runAsync(
    `INSERT INTO meals (
       id, revision, captured_at, status, note, photos_json, analysis_json, error,
       clarification_at, attempts, next_attempt_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
     ON CONFLICT(id) DO UPDATE SET
       revision = meals.revision + 1,
       captured_at = excluded.captured_at,
       status = excluded.status,
       note = excluded.note,
       photos_json = excluded.photos_json,
       analysis_json = excluded.analysis_json,
       error = excluded.error,
       clarification_at = excluded.clarification_at,
       attempts = 0,
       next_attempt_at = NULL`,
    meal.id,
    meal.revision,
    meal.capturedAt,
    meal.status,
    meal.note,
    JSON.stringify(meal.photos),
    meal.analysis ? JSON.stringify(meal.analysis) : null,
    meal.error ?? null,
    meal.analysis?.clarification ? Date.now() : null,
  );
  if (meal.questions !== undefined) {
    await connection.runAsync('DELETE FROM agent_questions WHERE meal_id = ?', meal.id);
    for (const question of meal.questions) await writeAgentQuestion({...question, mealId:meal.id}, connection);
    notifyAgentQuestions();
  }
  });
}

export async function replaceMeal(input: Meal): Promise<void> {
  await saveMealRecord(input);
}

/** Replaces a meal only if no UI or background analysis changed it since it was read. */
export async function replaceMealIfRevision(input: Meal, expectedRevision: number): Promise<Meal | undefined> {
  return writeMealIfRevision(database, input, expectedRevision);
}

/** The caller owns the transaction when a meal and its tool receipt commit together. */
export async function writeMealIfRevision(connection: typeof database, input: Meal, expectedRevision: number): Promise<Meal | undefined> {
  const result = await connection.runAsync(
    `UPDATE meals SET
       revision = revision + 1,
       captured_at = ?, status = ?, note = ?, photos_json = ?, analysis_json = ?, error = ?,
       clarification_at = ?, attempts = 0, next_attempt_at = NULL
     WHERE id = ? AND revision = ?`,
    input.capturedAt,
    input.status,
    input.note,
    JSON.stringify(input.photos),
    input.analysis ? JSON.stringify(input.analysis) : null,
    input.error ?? null,
    input.analysis?.clarification ? Date.now() : null,
    input.id,
    expectedRevision,
  );
  return result.changes === 1 ? readMeal(connection, input.id) : undefined;
}

export async function listMeals(): Promise<Meal[]> {
  const rows = await database.getAllAsync<MealRow>('SELECT * FROM meals ORDER BY captured_at DESC');
  return Promise.all(rows.map(row => fromRow(row)));
}

export async function getMeal(id: string): Promise<Meal | undefined> {
  return readMeal(database, id);
}

export async function readMeal(connection: typeof database, id: string): Promise<Meal | undefined> {
  const row = await connection.getFirstAsync<MealRow>('SELECT * FROM meals WHERE id = ?', id);
  return row ? fromRow(row, connection) : undefined;
}

export async function setMealStatus(id: string, status: MealStatus, error?: string): Promise<void> {
  await database.runAsync(
    'UPDATE meals SET revision = revision + 1, status = ?, error = ? WHERE id = ?',
    status,
    error ?? null,
    id,
  );
}

export async function queueMealRetry(id: string): Promise<void> {
  await database.runAsync(
    `UPDATE meals
     SET revision = revision + 1, status = 'queued', error = NULL, attempts = 0, next_attempt_at = NULL
     WHERE id = ?`,
    id,
  );
}

export async function recordMealFailure(id: string, error: string): Promise<boolean> {
  const row = await database.getFirstAsync<{ attempts: number }>(
    'SELECT attempts FROM meals WHERE id = ?',
    id,
  );
  const attempts = (row?.attempts ?? 0) + 1;
  const terminal = attempts >= 5;
  const retryDelay = Math.min(2 ** (attempts - 1) * 60_000, 6 * 60 * 60 * 1000);
  await database.runAsync(
    `UPDATE meals
     SET revision = revision + 1, status = ?, error = ?, attempts = ?, next_attempt_at = ?
     WHERE id = ?`,
    terminal ? 'failed' : 'queued',
    error,
    attempts,
    terminal ? null : Date.now() + retryDelay,
    id,
  );
  return terminal;
}

export async function listProcessableMeals(now = Date.now()): Promise<Meal[]> {
  const rows = await database.getAllAsync<MealRow>(
    `SELECT * FROM meals
     WHERE status IN ('queued', 'analyzing')
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY captured_at ASC`,
    now,
  );
  return Promise.all(rows.map(row => fromRow(row)));
}

export async function saveMealAnalysis(id: string, analysis: MealAnalysis): Promise<void> {
  await database.runAsync(
    `UPDATE meals
     SET revision = revision + 1, status = ?, analysis_json = ?, error = NULL, clarification_at = ?,
         attempts = 0, next_attempt_at = NULL
     WHERE id = ?`,
    analysis.clarification ? 'needs_input' : 'complete',
    JSON.stringify(analysis),
    analysis.clarification ? Date.now() : null,
    id,
  );
}

export async function updateMeal(id: string, input: {
  capturedAt: number;
  analysis: MealAnalysis;
}): Promise<void> {
  await database.runAsync(
    `UPDATE meals
     SET revision = revision + 1, captured_at = ?, status = 'complete', analysis_json = ?, error = NULL,
         clarification_at = NULL
     WHERE id = ?`,
    input.capturedAt,
    JSON.stringify({ ...input.analysis, clarification: undefined }),
    id,
  );
}

export async function deleteMeal(id: string): Promise<void> {
  await transaction(async connection=>{
    await connection.runAsync('DELETE FROM meals WHERE id = ?', id);
    await connection.runAsync('DELETE FROM agent_questions WHERE meal_id = ?', id);
    await connection.runAsync('DELETE FROM agent_turns WHERE meal_id = ?', id);
  });
  notifyAgentQuestions();
}

export async function deleteMealIfRevision(id: string, expectedRevision: number): Promise<boolean> {
  return transaction(async connection=>{
    const result=await connection.runAsync('DELETE FROM meals WHERE id = ? AND revision = ?', id, expectedRevision);
    if(result.changes!==1)return false;
    await connection.runAsync('DELETE FROM agent_questions WHERE meal_id = ?', id);
    await connection.runAsync('DELETE FROM agent_turns WHERE meal_id = ?', id);
    notifyAgentQuestions();
    return true;
  });
}

export async function getDailyGoals(): Promise<DailyGoals> {
  const row = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM preferences WHERE key = 'daily_goals'`,
  );
  return row ? JSON.parse(row.value) as DailyGoals : {};
}

export async function saveDailyGoals(goals: DailyGoals): Promise<void> {
  await database.runAsync(
    `INSERT INTO preferences (key, value) VALUES ('daily_goals', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    JSON.stringify(goals),
  );
}

export async function getGoalProfile(): Promise<GoalProfile | undefined> {
  return parseGoalProfile(await getPreference('goal_profile'));
}

export async function saveGoalProfile(profile: GoalProfile): Promise<void> {
  await savePreference('goal_profile', JSON.stringify(profile));
}

/** Persists profile inputs and their reviewed goals as one setup decision. */
export async function saveGoalSetup(profile: GoalProfile, goals: DailyGoals): Promise<void> {
  await transaction(async (database) => {
    await database.runAsync(
      `INSERT INTO preferences (key, value) VALUES ('goal_profile', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(profile),
    );
    await database.runAsync(
      `INSERT INTO preferences (key, value) VALUES ('daily_goals', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(goals),
    );
  });
}

export async function getPreference(key: string): Promise<string | undefined> {
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM preferences WHERE key = ?',
    key,
  );
  return row?.value;
}

export async function savePreference(key: string, value: string): Promise<void> {
  await database.runAsync(
    `INSERT INTO preferences (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

export async function removePreference(key: string): Promise<void> {
  await database.runAsync('DELETE FROM preferences WHERE key = ?', key);
}

export async function removeAllMealPhotos(): Promise<MealPhoto[]> {
  const meals = await listMeals();
  await database.runAsync('UPDATE meals SET revision = revision + 1, photos_json = ?', '[]');
  return meals.flatMap((meal) => meal.photos);
}

export async function deleteAllMeals(): Promise<MealPhoto[]> {
  const meals = await listMeals();
  // Diagnostic outputs can contain meal details, so "all meal data" includes them.
  await database.execAsync(`
    DELETE FROM meals;
    DELETE FROM diagnostic_events;
    DELETE FROM agent_questions WHERE meal_id IS NOT NULL;
    DELETE FROM agent_turns WHERE meal_id IS NOT NULL;
    DELETE FROM preferences WHERE key IN ('goal_profile', 'daily_goals');
  `);
  return meals.flatMap((meal) => meal.photos);
}

export async function finalizeExpiredClarifications(now = Date.now()): Promise<void> {
  const cutoff = now - 24 * 60 * 60 * 1000;
  await database.runAsync(
    `UPDATE meals
     SET revision = revision + 1, status = 'estimated'
     WHERE status = 'needs_input' AND clarification_at IS NOT NULL AND clarification_at <= ?`,
    cutoff,
  );
}

export async function saveClarificationAnswer(id: string, answer: string): Promise<void> {
  const meal = await getMeal(id);
  if (!meal?.analysis) return;
  const analysis = { ...meal.analysis, clarification: undefined };
  await database.runAsync(
    'UPDATE meals SET revision = revision + 1, status = ?, analysis_json = ?, note = ? WHERE id = ?',
    'complete',
    JSON.stringify(analysis),
    [meal.note, answer].filter(Boolean).join('\n'),
    id,
  );
}
