import { submitMealAnswer } from './mealAnswerSubmission';
import type { MealRequestContext } from '../ai/mealRequestContext';
import { beginForegroundWork } from './foregroundWork';
import { hasMealInput } from '../ai/mealInput';
import { dishClarificationInput, mergeDishClarification } from '../domain/mealAddition';
import { File } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { analyzeMeal, correctMealAnalysis, refineMealAnalysis } from '../ai/piClient';
import {
  appendDiagnosticEvent,
  getMeal,
  getPreference,
  listProcessableMeals,
  recordMealFailure,
  saveMealAnalysis,
  savePreference,
  setMealStatus,
} from '../data/mealRepository';
import { appendInlineMealAnswer, ensureClarificationThread, syncMealQuestionsToThread } from '../data/chatRepository';
import { mealQuestions } from '../domain/meal';
import type { MealAnalysis } from '../domain/meal';
import { parseMealResult } from './mealWebImage';
import { mealAnalysisEvidenceJson } from '../domain/mealWebImage';
import {
  defaultNotificationPreferences,
  parsePreference,
  type NotificationPreferences,
} from '../domain/preferences';
import { locale, t } from '../i18n';
import { setMealActivity } from './mealActivity';

/** Keep lookup outcomes in the existing diagnostic export, without page paths. */
function imageLookupDiagnostics(mealId: string) {
  return (event: import('./mealWebImage').ImageLookupEvent) => {
    const createdAt = Date.now();
    void appendDiagnosticEvent({ id: `${createdAt}-image-${Math.random().toString(36).slice(2)}`, createdAt, mealId, operation: 'image_lookup', ...event }).catch(() => undefined);
  };
}

const processing = new Set<string>();
const REMINDER_ID_KEY = 'daily_reminder_notification_id';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function prepareMealNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('meal-results', {
      name: t('notificationChannel'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.setNotificationCategoryAsync('meal-clarification', [{
    identifier: 'answer',
    buttonTitle: t('answer'),
    options: { opensAppToForeground: true },
    textInput: {
      submitButtonTitle: t('answer'),
      placeholder: t('answerPlaceholder'),
    },
  }]);
  const current = await Notifications.getPermissionsAsync();
  if (!current.granted && current.canAskAgain) {
    await Notifications.requestPermissionsAsync();
  }
}

async function notificationPreferences(): Promise<NotificationPreferences> {
  return parsePreference(await getPreference('notification_preferences'), defaultNotificationPreferences);
}

export async function applyNotificationPreferences(
  preferences: NotificationPreferences,
  hasMealsToday = false,
): Promise<void> {
  await prepareMealNotifications();
  const existingId = await getPreference(REMINDER_ID_KEY);
  if (existingId) {
    await Notifications.cancelScheduledNotificationAsync(existingId).catch(() => undefined);
    await savePreference(REMINDER_ID_KEY, '');
  }
  if (!preferences.reminder) return;

  const now = new Date();
  const target = new Date(now);
  target.setHours(20, 0, 0, 0);
  if (hasMealsToday || target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: t('reminderNotificationTitle'),
      body: t('reminderNotificationBody'),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: target },
  });
  await savePreference(REMINDER_ID_KEY, identifier);
}

async function notifyResult(mealId: string, analysis: MealAnalysis): Promise<void> {
  if (AppState.currentState === 'active') return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const question = mealQuestions(analysis.clarification)[0];
  const preferences = await notificationPreferences();
  if (question ? !preferences.questions : !preferences.ready) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: question ? t('notificationQuestionTitle') : t('notificationReadyTitle'),
      body: question ?? t('notificationReadyBody'),
      categoryIdentifier: question ? 'meal-clarification' : undefined,
      data: { mealId },
    },
    trigger: null,
  });
}

async function notifyFailure(mealId: string): Promise<void> {
  if (AppState.currentState === 'active') return;
  const preferences = await notificationPreferences();
  if (!preferences.failed) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: t('failedNotificationTitle'),
      body: t('failedNotificationBody'),
      data: { mealId },
    },
    trigger: null,
  });
}

export async function processMeal(id: string): Promise<void> {
  if (processing.has(id)) return;
  processing.add(id);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await beginForegroundWork();
    const meal = await getMeal(id);
    if (!meal || !hasMealInput(meal)) throw new Error('Meal description or photos are unavailable');
    await setMealStatus(id, 'analyzing');
    setMealActivity(id, meal.photos.length > 0 ? 'reading_photos' : 'reviewing_meal');
    const photos = await Promise.all(meal.photos.map(async (photo) => ({
      base64: await new File(photo.uri).base64(),
      mimeType: photo.mimeType,
    })));
    setMealActivity(id, 'reviewing_meal');
    const result = await analyzeMeal({
      mealId: id,
      photos,
      note: meal.note,
      language: locale === 'ru' ? 'Russian' : 'English',
      onActivity: (activity) => setMealActivity(id, activity),
    });
    const analysis = await parseMealResult(result, meal.photos.length > 0, undefined, imageLookupDiagnostics(id));
    setMealActivity(id, 'saving_result');
    await saveMealAnalysis(id, analysis);
    const questions = mealQuestions(analysis.clarification);
    if (questions.length > 0) {
      const thread = await ensureClarificationThread(id, analysis.title);
      await syncMealQuestionsToThread(thread.id, id, questions);
    }
    await notifyResult(id, analysis);
  } catch (error) {
    const terminal = await recordMealFailure(id, error instanceof Error ? error.message : String(error));
    if (terminal) await notifyFailure(id);
  } finally {
    await release?.().catch(() => undefined);
    setMealActivity(id);
    processing.delete(id);
  }
}

export async function processPendingMeals(): Promise<void> {
  const meals = await listProcessableMeals();
  if (!meals.length) return;
  const release = await beginForegroundWork();
  try {
    for (const meal of meals) await processMeal(meal.id);
  } finally { await release().catch(() => undefined); }
}

export async function answerMealClarification(id: string, answer: string, answeredInThreadId?: string, signal?: AbortSignal, context?: MealRequestContext): Promise<void> {
  return submitMealAnswer(id, async () => {
    // Background recovery must not restart this meal without the user's answer.
    if (processing.has(id)) throw new Error('This meal is already being analyzed');
    processing.add(id);
    try {
      const meal = await getMeal(id);
      const clarification = meal?.analysis?.clarification;
      if (!meal?.analysis || !clarification) return;

      const questions = mealQuestions(clarification);
      const evidence = dishClarificationInput(meal);
      const thread = await ensureClarificationThread(id, meal.analysis.title);
      await syncMealQuestionsToThread(thread.id, id, questions, meal.capturedAt);
      if (answeredInThreadId !== thread.id) await appendInlineMealAnswer(thread.id, answer);

      await setMealStatus(id, 'analyzing');
      let release: (() => Promise<void>) | undefined;
      try {
        release = await beginForegroundWork();
        setMealActivity(id, 'reviewing_meal');
        // Clarification is a fresh provider request: the prior analysis does not
        // carry image bytes forward. Reload the saved meal's visual evidence.
        const photos = await Promise.all(evidence.photos.map(async (photo) => ({
          base64: await new File(photo.uri).base64(),
          mimeType: photo.mimeType,
        })));
        const result = await refineMealAnalysis({
          mealId: id,
          signal,
          photos,
          note: evidence.note,
          previousJson: mealAnalysisEvidenceJson(evidence.analysis),
          question: questions.join('\n'),
          answer,
          assistantInterpretation: context?.assistantInterpretation,
          conversation: context?.conversation,
          requireSearch: context?.requireSearch,
          language: locale === 'ru' ? 'Russian' : 'English',
          onActivity: (activity) => setMealActivity(id, activity),
        });
        const analysis = mergeDishClarification(meal.analysis, await parseMealResult(result, meal.photos.length > 0, undefined, imageLookupDiagnostics(id)));
        setMealActivity(id, 'saving_result');
        await saveMealAnalysis(id, analysis);
        const remainingQuestions = mealQuestions(analysis.clarification);
        if (remainingQuestions.length > 0) {
          const thread = await ensureClarificationThread(id, analysis.title);
          await syncMealQuestionsToThread(thread.id, id, remainingQuestions);
          if (answeredInThreadId && answeredInThreadId !== thread.id) {
            await syncMealQuestionsToThread(answeredInThreadId, id, remainingQuestions);
          }
        }
      } catch (error) {
        await setMealStatus(
          id,
          'needs_input',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      } finally {
        await release?.().catch(() => undefined);
        setMealActivity(id);
      }
    } finally { processing.delete(id); }
  });
}

export async function correctSavedMeal(id: string, correction: string, context?: MealRequestContext): Promise<void> {
  const meal = await getMeal(id);
  if (!meal?.analysis) return;

  await setMealStatus(id, 'analyzing');
  let release: (() => Promise<void>) | undefined;
  try {
    release = await beginForegroundWork();
    setMealActivity(id, 'reviewing_meal');
    const result = await correctMealAnalysis({
      mealId: id,
      previousJson: mealAnalysisEvidenceJson(meal.analysis),
      correction,
      conversation: context?.conversation,
      language: locale === 'ru' ? 'Russian' : 'English',
      onActivity: (activity) => setMealActivity(id, activity),
    });
    const analysis = await parseMealResult(result, meal.photos.length > 0, undefined, imageLookupDiagnostics(id));
    delete analysis.clarification;
    setMealActivity(id, 'saving_result');
    await saveMealAnalysis(id, analysis);
  } catch (error) {
    await setMealStatus(id, meal.status, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await release?.().catch(() => undefined);
    setMealActivity(id);
  }
}

/** Re-runs the canonical meal analyzer so Assistant corrections can use saved descriptions and photos. */
export async function reanalyzeSavedMeal(id: string, instruction?: string, context?: MealRequestContext): Promise<void> {
  const meal = await getMeal(id);
  if (!meal) throw new Error('Meal was not found');
  if (!hasMealInput(meal)) {
    if (meal.analysis && instruction?.trim()) return correctSavedMeal(id, instruction, context);
    throw new Error('This meal has no saved description or photos to analyze');
  }
  if (processing.has(id)) throw new Error('This meal is already being analyzed');
  processing.add(id);
  await setMealStatus(id, 'analyzing');
  let release: (() => Promise<void>) | undefined;
  try {
    release = await beginForegroundWork();
    setMealActivity(id, meal.photos.length > 0 ? 'reading_photos' : 'reviewing_meal');
    const photos = await Promise.all(meal.photos.map(async (photo) => ({
      base64: await new File(photo.uri).base64(),
      mimeType: photo.mimeType,
    })));
    const note = [meal.note, instruction?.trim() ? `User correction: ${instruction.trim()}` : '']
      .filter(Boolean).join('\n');
    setMealActivity(id, 'reviewing_meal');
    const result = await analyzeMeal({
      mealId: id,
      photos,
      note,
      requireSearch: context?.requireSearch,
      assistantInterpretation: context?.assistantInterpretation,
      conversation: context?.conversation,
      language: locale === 'ru' ? 'Russian' : 'English',
      onActivity: (activity) => setMealActivity(id, activity),
    });
    const analysis = await parseMealResult(result, meal.photos.length > 0, undefined, imageLookupDiagnostics(id));
    setMealActivity(id, 'saving_result');
    await saveMealAnalysis(id, analysis);
  } catch (error) {
    await setMealStatus(id, meal.status, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await release?.().catch(() => undefined);
    setMealActivity(id);
    processing.delete(id);
  }
}
