import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { Directory, File, Paths } from 'expo-file-system';
import { database, transaction } from './database';

import type { BackupConversation, BackupMessage, BackupPhoto, CalDoneBackup } from '../domain/backup';
import { planBackupMerge } from '../domain/backup';
import type { Meal, MealPhoto } from '../domain/meal';
import { sanitizeChatMessage } from './chatRepository';


export type BackupImportResult = {
  mealsImported: number;
  mealsSkipped: number;
  conversationsImported: number;
  conversationsSkipped: number;
  photosImported: number;
};

/**
 * Adds backup records without replacing any existing meal or conversation ID.
 * Preferences are restored only when present in the backup; provider credentials
 * and diagnostics are intentionally outside the backup contract.
 */
export async function mergeCalDoneBackup(backup: CalDoneBackup): Promise<BackupImportResult> {
  const [mealRows, threadRows] = await Promise.all([
    database.getAllAsync<{ id: string }>('SELECT id FROM meals'),
    database.getAllAsync<{ id: string }>('SELECT id FROM chat_threads'),
  ]);
  const plan = planBackupMerge(
    backup,
    new Set(mealRows.map((row) => row.id)),
    new Set(threadRows.map((row) => row.id)),
  );
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const writtenFiles: File[] = [];
  const restoredMeals: Meal[] = [];
  const restoredConversations: Array<{ conversation: BackupConversation; messages: AgentMessage[]; files: File[] }> = [];

  try {
    for (const [mealIndex, meal] of plan.meals.entries()) {
      const photos = await restorePhotos(meal.photos, 'meal-photos', `${runId}-meal-${mealIndex}`, meal.capturedAt, writtenFiles);
      restoredMeals.push({ ...meal, photos });
    }
    for (const [conversationIndex, conversation] of plan.conversations.entries()) {
      const conversationFiles: File[] = [];
      const messages = await Promise.all(conversation.messages.map((message, messageIndex) => (
        restoreMessage(message, `${runId}-chat-${conversationIndex}-${messageIndex}`, conversationFiles)
      )));
      writtenFiles.push(...conversationFiles);
      restoredConversations.push({ conversation, messages, files: conversationFiles });
    }

    let mealsImported = 0;
    let conversationsImported = 0;
    let photosImported = 0;
    await transaction(async (database) => {
      for (const meal of restoredMeals) {
        const result = await database.runAsync(
          `INSERT OR IGNORE INTO meals (
             id, revision, captured_at, status, note, photos_json, analysis_json, error,
             clarification_at, attempts, next_attempt_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
          meal.id,
          meal.revision,
          meal.capturedAt,
          meal.status,
          meal.note,
          JSON.stringify(meal.photos),
          meal.analysis ? JSON.stringify(meal.analysis) : null,
          meal.error ?? null,
          meal.analysis?.clarification ? meal.capturedAt : null,
        );
        if (result.changes === 1) {
          mealsImported += 1;
          photosImported += meal.photos.length;
        } else {
          cleanupFiles(meal.photos.map((photo) => new File(photo.uri)));
        }
      }

      await restorePreferences(database, backup);

      for (const restored of restoredConversations) {
        const { thread } = restored.conversation;
        const result = await database.runAsync(
          'INSERT OR IGNORE INTO chat_threads (id, title, created_at, updated_at, meal_id, purpose) VALUES (?, ?, ?, ?, ?, ?)',
          thread.id,
          thread.title,
          thread.createdAt,
          thread.updatedAt,
          thread.mealId ?? null,
          thread.purpose ?? null,
        );
        if (result.changes !== 1) {
          cleanupFiles(restored.files);
          continue;
        }
        conversationsImported += 1;
        photosImported += restored.files.length;
        for (const [position, message] of restored.messages.entries()) {
          await database.runAsync(
            'INSERT INTO chat_messages (thread_id, position, message_json) VALUES (?, ?, ?)',
            thread.id,
            position,
            JSON.stringify(sanitizeChatMessage(message)),
          );
        }
        for (const action of restored.conversation.actions) {
          await database.runAsync(
            `INSERT OR IGNORE INTO chat_actions (id, thread_id, label, created_at, undone, undo_json)
             VALUES (?, ?, ?, ?, 2, ?)`,
            action.id,
            thread.id,
            action.label,
            action.createdAt,
            JSON.stringify({ kind: 'imported' }),
          );
        }
      }
    });

    return {
      mealsImported,
      mealsSkipped: plan.skippedMeals + restoredMeals.length - mealsImported,
      conversationsImported,
      conversationsSkipped: plan.skippedConversations + restoredConversations.length - conversationsImported,
      photosImported,
    };
  } catch (error) {
    cleanupFiles(writtenFiles);
    throw error;
  }
}

async function restorePreferences(database: typeof import('./database').database, backup: CalDoneBackup): Promise<void> {
  const preferences = backup.preferences;
  const values: Array<[string, string]> = [];
  if (preferences.goals) values.push(['daily_goals', JSON.stringify(preferences.goals)]);
  if (preferences.goalProfile) values.push(['goal_profile', JSON.stringify(preferences.goalProfile)]);
  if (preferences.units) values.push(['nutrition_units', JSON.stringify(preferences.units)]);
  if (preferences.notifications) values.push(['notification_preferences', JSON.stringify(preferences.notifications)]);
  if (preferences.locale) values.push(['locale', preferences.locale]);
  if (preferences.assistantInstructions !== undefined) values.push(['assistant_custom_instructions', preferences.assistantInstructions]);
  for (const [key, value] of values) {
    await database.runAsync(
      `INSERT INTO preferences (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }
}

async function restoreMessage(message: BackupMessage, prefix: string, writtenFiles: File[]): Promise<AgentMessage> {
  if (message.role !== 'chatUser') return message as AgentMessage;
  const attachments = await restorePhotos(message.attachments, 'chat-attachments', prefix, message.timestamp, writtenFiles);
  return { ...message, attachments } as AgentMessage;
}

async function restorePhotos(
  photos: BackupPhoto[],
  directoryName: string,
  prefix: string,
  fallbackTimestamp: number,
  writtenFiles: File[],
): Promise<MealPhoto[]> {
  const directory = new Directory(Paths.document, directoryName);
  directory.create({ idempotent: true, intermediates: true });
  const restored: MealPhoto[] = [];
  for (const [index, photo] of photos.entries()) {
    if (!photo.base64) continue;
    const file = new File(directory, `${prefix}-${index}.${extensionFor(photo.mimeType)}`);
    file.create({ intermediates: true });
    file.write(photo.base64, { encoding: 'base64' });
    writtenFiles.push(file);
    restored.push({
      id: photo.id ?? `${prefix}-${index}`,
      uri: file.uri,
      mimeType: photo.mimeType,
      createdAt: photo.createdAt ?? fallbackTimestamp,
    });
  }
  return restored;
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic';
  return 'jpg';
}

function cleanupFiles(files: File[]): void {
  for (const file of files) {
    try { if (file.exists) file.delete(); } catch { /* Database state remains authoritative. */ }
  }
}
