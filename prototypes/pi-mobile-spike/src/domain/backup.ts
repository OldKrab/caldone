import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { GoalProfile } from './goalEstimator.ts';
import { parseGoalProfile } from './goalEstimator.ts';
import type { ChatThread } from './chat.ts';
import type { DailyGoals, Meal, MealAnalysis, MealStatus } from './meal.ts';
import type { NotificationPreferences, NutritionUnits } from './preferences.ts';

export const BACKUP_FORMAT = 'caldone-backup';
export const BACKUP_SCHEMA_VERSION = 1;
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;

export type BackupPhoto = {
  id?: string;
  mimeType: string;
  createdAt?: number;
  base64?: string;
  unavailable?: boolean;
};

export type BackupMeal = Omit<Meal, 'photos'> & { photos: BackupPhoto[] };
export type BackupMessage = AgentMessage | (Record<string, unknown> & { role: 'chatUser'; text: string; timestamp: number; attachments: BackupPhoto[] });
export type BackupAction = { id: string; label: string; createdAt: number; undone: boolean };
export type BackupConversation = { thread: ChatThread; messages: BackupMessage[]; actions: BackupAction[] };

export type BackupPreferences = {
  goals?: DailyGoals;
  goalProfile?: GoalProfile;
  units?: NutritionUnits;
  notifications?: NotificationPreferences;
  locale?: 'en' | 'ru';
  assistantInstructions?: string;
};

export type CalDoneBackup = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  preferences: BackupPreferences;
  meals: BackupMeal[];
  conversations: BackupConversation[];
};

export type BackupSummary = {
  meals: number;
  conversations: number;
  photos: number;
};

export type BackupMergePlan = {
  meals: BackupMeal[];
  conversations: BackupConversation[];
  skippedMeals: number;
  skippedConversations: number;
};

/** Parses the current CalDone backup contract before any local data is changed. */
export function parseCalDoneBackup(value: unknown): CalDoneBackup {
  const root = record(value, 'backup');
  // The new package has separate storage; this legacy identifier is required
  // to transfer exports from installations released before the package rename.
  if (root.format !== BACKUP_FORMAT && root.format !== 'calodone-backup') throw new Error('Unsupported backup format');
  if (root.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error('Unsupported backup version');

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: text(root.exportedAt, 'exportedAt', 64),
    preferences: parsePreferences(root.preferences),
    meals: array(root.meals, 'meals', 20_000).map(parseMeal),
    conversations: array(root.conversations ?? [], 'conversations', 5_000).map(parseConversation),
  };
}

export function summarizeBackup(backup: CalDoneBackup): BackupSummary {
  const mealPhotos = backup.meals.reduce((count, meal) => count + meal.photos.filter(hasPhotoBytes).length, 0);
  const chatPhotos = backup.conversations.reduce((count, conversation) => count + conversation.messages.reduce((messageCount, message) => {
    if (message.role !== 'chatUser') return messageCount;
    return messageCount + message.attachments.filter(hasPhotoBytes).length;
  }, 0), 0);
  return { meals: backup.meals.length, conversations: backup.conversations.length, photos: mealPhotos + chatPhotos };
}

/** Merge imports are additive: existing record IDs always remain authoritative. */
export function planBackupMerge(backup: CalDoneBackup, existingMealIds: ReadonlySet<string>, existingThreadIds: ReadonlySet<string>): BackupMergePlan {
  const meals = backup.meals.filter((meal) => !existingMealIds.has(meal.id));
  const conversations = backup.conversations.filter((conversation) => !existingThreadIds.has(conversation.thread.id));
  return {
    meals,
    conversations,
    skippedMeals: backup.meals.length - meals.length,
    skippedConversations: backup.conversations.length - conversations.length,
  };
}

function parsePreferences(value: unknown): BackupPreferences {
  if (value === undefined) return {};
  const source = record(value, 'preferences');
  const result: BackupPreferences = {};
  if (source.goals !== undefined) result.goals = parseGoals(source.goals);
  if (source.goalProfile !== undefined && source.goalProfile !== null) {
    const profile = parseGoalProfile(JSON.stringify(source.goalProfile));
    if (!profile) throw new Error('Invalid goal profile');
    result.goalProfile = profile;
  }
  if (source.units !== undefined) {
    const units = record(source.units, 'preferences.units');
    if (!['kcal', 'kj'].includes(String(units.energy)) || !['g', 'oz'].includes(String(units.weight))) throw new Error('Invalid nutrition units');
    result.units = { energy: units.energy as NutritionUnits['energy'], weight: units.weight as NutritionUnits['weight'] };
  }
  if (source.notifications !== undefined) {
    const notifications = record(source.notifications, 'preferences.notifications');
    const keys: Array<keyof NotificationPreferences> = ['questions', 'failed', 'ready', 'reminder'];
    if (keys.some((key) => typeof notifications[key] !== 'boolean')) throw new Error('Invalid notification preferences');
    result.notifications = Object.fromEntries(keys.map((key) => [key, notifications[key]])) as unknown as NotificationPreferences;
  }
  if (source.locale !== undefined) {
    if (source.locale !== 'en' && source.locale !== 'ru') throw new Error('Invalid locale');
    result.locale = source.locale;
  }
  if (source.assistantInstructions !== undefined) result.assistantInstructions = text(source.assistantInstructions, 'assistantInstructions', 20_000);
  return result;
}

function parseGoals(value: unknown): DailyGoals {
  const source = record(value, 'preferences.goals');
  const goals: DailyGoals = {};
  for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) {
    if (source[key] === undefined) continue;
    goals[key] = nonNegativeNumber(source[key], `goals.${key}`);
  }
  return goals;
}

function parseMeal(value: unknown): BackupMeal {
  const source = record(value, 'meal');
  const status = text(source.status, 'meal.status', 32) as MealStatus;
  if (!['queued', 'analyzing', 'needs_input', 'complete', 'estimated', 'failed'].includes(status)) throw new Error('Invalid meal status');
  let analysis: MealAnalysis | undefined;
  if (source.analysis !== undefined && source.analysis !== null) analysis = parseAnalysis(source.analysis);
  return {
    id: text(source.id, 'meal.id', 160),
    revision: positiveInteger(source.revision ?? 1, 'meal.revision'),
    capturedAt: positiveNumber(source.capturedAt, 'meal.capturedAt'),
    status,
    note: text(source.note ?? '', 'meal.note', 100_000),
    photos: array(source.photos ?? [], 'meal.photos', 100).map(parsePhoto),
    analysis,
    error: source.error === undefined || source.error === null ? undefined : text(source.error, 'meal.error', 20_000),
  };
}

function parseConversation(value: unknown): BackupConversation {
  const source = record(value, 'conversation');
  const threadSource = record(source.thread, 'conversation.thread');
  const purpose = threadSource.purpose;
  if (purpose !== undefined && purpose !== 'meal' && purpose !== 'clarification') throw new Error('Invalid conversation purpose');
  const thread: ChatThread = {
    id: text(threadSource.id, 'thread.id', 160),
    title: text(threadSource.title ?? '', 'thread.title', 256),
    createdAt: positiveNumber(threadSource.createdAt, 'thread.createdAt'),
    updatedAt: positiveNumber(threadSource.updatedAt, 'thread.updatedAt'),
    mealId: threadSource.mealId === undefined ? undefined : text(threadSource.mealId, 'thread.mealId', 160),
    purpose,
  };
  return {
    thread,
    messages: array(source.messages ?? [], 'conversation.messages', 20_000).map(parseMessage),
    actions: array(source.actions ?? [], 'conversation.actions', 20_000).map(parseAction),
  };
}

function parseMessage(value: unknown): BackupMessage {
  const source = record(value, 'message');
  if (source.role === 'chatUser') {
    return {
      ...source,
      role: 'chatUser',
      text: text(source.text ?? '', 'message.text', 1_000_000),
      timestamp: positiveNumber(source.timestamp, 'message.timestamp'),
      attachments: array(source.attachments ?? [], 'message.attachments', 100).map(parsePhoto),
    };
  }
  if (source.role === 'mealQuestion') {
    return {
      role: 'mealQuestion',
      mealId: text(source.mealId, 'message.mealId', 160),
      questions: array(source.questions, 'message.questions', 3)
        .map((question, index) => text(question, `message.questions.${index}`, 20_000)),
      timestamp: positiveNumber(source.timestamp, 'message.timestamp'),
    };
  }
  if (!['user', 'assistant', 'toolResult'].includes(String(source.role))) throw new Error('Invalid message role');
  if (!Array.isArray(source.content) && !(source.role === 'user' && typeof source.content === 'string')) throw new Error('Invalid message content');
  positiveNumber(source.timestamp, 'message.timestamp');
  return source as BackupMessage;
}

function parseAction(value: unknown): BackupAction {
  const source = record(value, 'action');
  return {
    id: text(source.id, 'action.id', 160),
    label: text(source.label, 'action.label', 1_000),
    createdAt: positiveNumber(source.createdAt, 'action.createdAt'),
    undone: Boolean(source.undone),
  };
}

function parsePhoto(value: unknown): BackupPhoto {
  const source = record(value, 'photo');
  const mimeType = text(source.mimeType, 'photo.mimeType', 128);
  if (!mimeType.startsWith('image/')) throw new Error('Invalid photo type');
  const base64 = source.base64 === undefined ? undefined : text(source.base64, 'photo.base64', 48 * 1024 * 1024);
  return {
    id: source.id === undefined ? undefined : text(source.id, 'photo.id', 160),
    mimeType,
    createdAt: source.createdAt === undefined ? undefined : positiveNumber(source.createdAt, 'photo.createdAt'),
    base64,
    unavailable: source.unavailable === true,
  };
}

function parseAnalysis(value: unknown): MealAnalysis {
  const source = record(value, 'meal.analysis');
  const mealType = text(source.mealType, 'meal.analysis.mealType', 32);
  if (!['breakfast', 'lunch', 'dinner', 'snack'].includes(mealType)) throw new Error('Invalid meal type');
  const totals = parseNutrition(source.totals, 'meal.analysis.totals');
  const items = array(source.items, 'meal.analysis.items', 1_000).map((item) => {
    const row = record(item, 'meal.analysis.item');
    return {
      name: text(row.name, 'meal.analysis.item.name', 10_000),
      quantity: text(row.quantity, 'meal.analysis.item.quantity', 10_000),
      ...parseNutrition(row, 'meal.analysis.item'),
    };
  });
  let clarification: MealAnalysis['clarification'];
  if (source.clarification !== undefined && source.clarification !== null) {
    const detail = record(source.clarification, 'meal.analysis.clarification');
    const questions = detail.questions === undefined
      ? [text(detail.question, 'meal.analysis.clarification.question', 20_000)]
      : array(detail.questions, 'meal.analysis.clarification.questions', 3)
        .map((question, index) => text(question, `meal.analysis.clarification.questions.${index}`, 20_000));
    clarification = {
      questions,
      impactCalories: nonNegativeNumber(detail.impactCalories, 'meal.analysis.clarification.impactCalories'),
    };
  }
  let dishAddition: MealAnalysis['dishAddition'];
  if (source.dishAddition !== undefined && source.dishAddition !== null) {
    const scope = record(source.dishAddition, 'meal.analysis.dishAddition');
    const originalItemCount = nonNegativeNumber(scope.originalItemCount, 'dishAddition.originalItemCount');
    if (!Number.isInteger(originalItemCount) || originalItemCount > items.length) throw new Error('Invalid dish addition item boundary');
    dishAddition = {
      originalItemCount,
      photoIds: array(scope.photoIds, 'dishAddition.photoIds', 100).map(id => text(id, 'dishAddition.photoId', 160)),
      note: text(scope.note, 'dishAddition.note', 100_000),
    };
  }
  return { title: text(source.title, 'meal.analysis.title', 10_000), mealType: mealType as MealAnalysis['mealType'], items, totals, clarification, ...(dishAddition ? { dishAddition } : {}) };
}

function parseNutrition(value: unknown, name: string) {
  const source = record(value, name);
  return {
    calories: nonNegativeNumber(source.calories, `${name}.calories`),
    protein: nonNegativeNumber(source.protein, `${name}.protein`),
    carbs: nonNegativeNumber(source.carbs, `${name}.carbs`),
    fat: nonNegativeNumber(source.fat, `${name}.fat`),
  };
}

function hasPhotoBytes(photo: BackupPhoto): boolean {
  return Boolean(photo.base64);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${name}`);
  return value as Record<string, unknown>;
}

function array(value: unknown, name: string, maxLength: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`Invalid ${name}`);
  return value;
}

function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`Invalid ${name}`);
  return value;
}

function positiveNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}

function nonNegativeNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  const result = positiveNumber(value, name);
  if (!Number.isInteger(result)) throw new Error(`Invalid ${name}`);
  return result;
}
