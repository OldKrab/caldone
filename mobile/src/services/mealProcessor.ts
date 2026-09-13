import type { MealRequestContext } from '../ai/mealRequestContext';
import { beginForegroundWork } from './foregroundWork';
import { hasMealInput } from '../ai/mealInput';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { sendMealMessage, resumeMealConversation } from './mealConversation';
import { pendingAgentTurn, runnableAgentTurns } from '../data/agentTurnRepository';
import { mealActivityStartedAt } from './mealActivity';
import type { QuestionAnswer } from '../domain/chat';
import {
  getMeal,
  getPreference,
  listProcessableMeals,
  setMealStatus,
  savePreference,
} from '../data/mealRepository';
import { mealQuestions } from '../domain/meal';
import type { Meal } from '../domain/meal';
import {
  defaultNotificationPreferences,
  parsePreference,
  type NotificationPreferences,
} from '../domain/preferences';
import { locale, t } from '../i18n';

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
}

async function notificationPreferences(): Promise<NotificationPreferences> {
  return parsePreference(await getPreference('notification_preferences'), defaultNotificationPreferences);
}

/** Restoring preferences or updating reminders must never reopen a denied prompt.
 * Only setup completion or an explicit notification opt-in may request permission.
 */
export async function applyNotificationPreferences(
  preferences: NotificationPreferences,
  hasMealsToday = false,
  options: { requestPermission?: boolean } = {},
): Promise<void> {
  await prepareMealNotifications();
  if (options.requestPermission) {
    const current = await Notifications.getPermissionsAsync();
    if (!current.granted && current.canAskAgain) {
      await Notifications.requestPermissionsAsync();
    }
  }
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

async function notifyResult(meal: Meal): Promise<void> {
  if (AppState.currentState === 'active') return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const question = meal.questions?.find(question => question.state === 'open')?.question
    ?? mealQuestions(meal.analysis?.clarification)[0];
  if (!question && !meal.analysis) return;
  const preferences = await notificationPreferences();
  if (question ? !preferences.questions : !preferences.ready) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: question ? t('notificationQuestionTitle') : t('notificationReadyTitle'),
      body: question ?? t('notificationReadyBody'),
      categoryIdentifier: question ? 'meal-clarification' : undefined,
      data: { mealId: meal.id },
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
  try {
    const meal = await getMeal(id);
    if (!meal || !hasMealInput(meal)) throw new Error('Meal description or photos are unavailable');
    await sendMealMessage(id, `Оцени еду и сохрани запись. При существенной неопределённости задай уточнения.\nОписание пользователя: ${meal.note}`, meal.photos, {source:'capture',requestId:`capture:${id}`});
    const updated = await getMeal(id);
    if (updated) await notifyResult(updated);
  } catch (error) {
    const saved=await getMeal(id);
    // A failed final reply must not replace an already committed estimate or
    // question with a new queued analysis. The saved turn owns retries.
    if(saved && !saved.analysis && !saved.questions?.length){
      await setMealStatus(id,'failed',error instanceof Error?error.message:String(error));
      await notifyFailure(id);
    }
  } finally {processing.delete(id);}
}

export async function processPendingMeals(): Promise<void> {
  for(const turn of await runnableAgentTurns()){
    if(!turn.mealId || mealActivityStartedAt(turn.mealId)!==undefined)continue;
    await resumeMealConversation(turn.mealId).catch(()=>undefined);
  }
  const meals = await listProcessableMeals();
  if (!meals.length) return;
  const release = await beginForegroundWork();
  try {
    for (const meal of meals) {
      if(mealActivityStartedAt(meal.id)!==undefined || await pendingAgentTurn({mealId:meal.id}))continue;
      await processMeal(meal.id);
    }
  } finally { await release().catch(() => undefined); }
}

/** Compatibility entry for forms and notification replies; all interpretation
 * and persistence now belongs to the same agent as ordinary meal chat. */
export async function answerMealClarification(id: string, answer: string, questionAnswers?: QuestionAnswer[]): Promise<void> {
  await sendMealMessage(id, answer, [], {source:'form',questionAnswers});
}

export async function correctSavedMeal(id: string, correction: string): Promise<void> {
  await sendMealMessage(id, correction);
}

export async function reanalyzeSavedMeal(id: string, instruction?: string, _context?: MealRequestContext): Promise<void> {
  await sendMealMessage(id, instruction?.trim() || 'Заново оцени эту запись еды по сохранённым фото, описанию и ответам. Сохрани обновление.', [], {source: 'reanalyze'});
}
