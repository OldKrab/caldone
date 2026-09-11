import { requestMealReanalysis } from './src/services/mealReanalysis';
import appConfig from './app.json';
import { mealRequestDiagnostics } from './src/services/mealRequestTraceStore';
import { submitMealAnswer, subscribeMealAnswers } from './src/services/mealAnswerSubmission';
import { foregroundWorkActive, foregroundWorkBusy } from './src/services/foregroundWork';
import { useAppUpdates } from './src/features/settings/useAppUpdates';
import { DescribeMealScreen } from './src/features/capture/DescribeMealScreen';
import { hasMealInput } from './src/ai/mealInput';
import { discardAllDishAdditions, discardDishAddition, retryDishAddition, startDishAddition, stopDishAddition, subscribeDishAdditions, type DishAdditionState } from './src/services/backgroundDishAddition';
import { Ionicons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getSelectedModel,
  getSelectedProvider,
  getThinkingLevel,
  getWebSearchEnabled,
  isSignedIn,
} from './src/ai/piClient';
import {
  createMeal,
  deleteMeal,
  deleteAllMeals,
  finalizeExpiredClarifications,
  getDailyGoals,
  getGoalProfile,
  getPreference,
  appendDiagnosticEvent,
  initializeMeals,
  listDiagnosticEvents,
  listMeals,
  removeAllMealPhotos,
  queueMealRetry,
  saveDailyGoals,
  saveGoalSetup,
  saveMealRecord,
  savePreference,
  updateMeal,
} from './src/data/mealRepository';
import {
  createChatThread,
  deleteAllChatData,
  deleteChatThread,
  ensureClarificationThread,
  exportChatData,
  initializeChat,
  latestChatThread,
  listChatThreads,
  preferredMealThread,
  syncMealQuestionsToThread,
} from './src/data/chatRepository';
import { mergeCalDoneBackup } from './src/data/backupRepository';
import { color, type } from './src/design/tokens';
import { AppDialogProvider, useAppDialog } from './src/components/AppDialog';
import { mealQuestions, type DailyGoals, type Meal, type MealAnalysis, type MealPhoto } from './src/domain/meal';
import type { GoalProfile } from './src/domain/goalEstimator';
import { analysisFromItems } from './src/domain/mealOperations';
import type { ChatThread } from './src/domain/chat';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_BYTES,
  parseCalDoneBackup,
  summarizeBackup,
} from './src/domain/backup';
import {
  defaultNotificationPreferences,
  defaultNutritionUnits,
  parsePreference,
  type NotificationPreferences,
  type NutritionUnits,
} from './src/domain/preferences';
import { CaptureScreen } from './src/features/capture/CaptureScreen';
import { CaptureReviewScreen } from './src/features/capture/CaptureReviewScreen';
import { AssistantScreen, ChatHistoryScreen } from './src/features/chat/AssistantScreen';
import { HomeScreen } from './src/features/home/HomeScreen';
import { MealDetailScreen } from './src/features/meal/MealDetailScreen';
import { SetupScreen } from './src/features/onboarding/SetupScreen';
import { ProviderSetupScreen } from './src/features/provider/ProviderSetupScreen';
import { SettingsScreen } from './src/features/settings/SettingsScreen';
import { locale, setLocale, t, type Locale } from './src/i18n';
import { registerMealBackgroundTask } from './src/services/backgroundMeals';
import {
  answerMealClarification,
  applyNotificationPreferences,
  processMeal,
  processPendingMeals,
} from './src/services/mealProcessor';
import { undoAssistantAction } from './src/services/chatSession';
import { subscribeMealActivity, type MealActivityStage } from './src/services/mealActivity';
import { backDestination, type AppScreen } from './src/navigation/backNavigation';

type Screen = AppScreen;

export default function App() {
  return (
    <SafeAreaProvider>
      <AppDialogProvider>
        <CalDoneApp />
      </AppDialogProvider>
    </SafeAreaProvider>
  );
}

function CalDoneApp() {
  const dialog = useAppDialog();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [meals, setMeals] = useState<Meal[]>([]);
  const [goals, setGoals] = useState<DailyGoals>({});
  const [goalProfile, setGoalProfile] = useState<GoalProfile>();
  const [units, setUnits] = useState<NutritionUnits>(defaultNutritionUnits);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [includePhotosInExport, setIncludePhotosInExport] = useState(true);
  const [importingData, setImportingData] = useState(false);
  const [, setLocaleVersion] = useState(0);
  const [selectedDay, setSelectedDay] = useState(startOfDay(Date.now()));
  const [selectedMealId, setSelectedMealId] = useState<string>();
  const [manualMeal, setManualMeal] = useState<Meal>();
  const [photos, setPhotos] = useState<MealPhoto[]>([]);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const sendInFlight = useRef(false);
  const [additionMealId, setAdditionMealId] = useState<string>();
  const [dishAdditions, setDishAdditions] = useState<ReadonlyMap<string, DishAdditionState>>(new Map());
  useEffect(() => subscribeDishAdditions(setDishAdditions), []);
  const [savingGoals, setSavingGoals] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [chatThread, setChatThread] = useState<ChatThread>();
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [assistantMealId, setAssistantMealId] = useState<string>();
  const [mealActivities, setMealActivities] = useState<ReadonlyMap<string, MealActivityStage>>(new Map());

  useEffect(() => subscribeMealActivity(setMealActivities), []);
  const [answeringMealIds, setAnsweringMealIds] = useState<ReadonlySet<string>>(new Set());
  const dataWork = useRef(0);
  const settingsSafe = useRef(false);
  const updateSettingsSafety = useCallback((safe: boolean) => { settingsSafe.current = safe; }, []);
  // Home and read-only Settings pages have no local editor drafts. Recheck at
  // both download completion and system confirmation; work can start meanwhile.
  const updateIdle = () => ready && !showSetup && AppState.currentState === 'active'
    && !sending && !sendInFlight.current && !importingData && !savingGoals && dataWork.current === 0
    && photos.length === 0 && !note.trim() && !manualMeal && !additionMealId
    && mealActivities.size === 0 && answeringMealIds.size === 0 && !foregroundWorkBusy()
    && !meals.some(meal => meal.status === 'analyzing');
  const updates = useAppUpdates({
    ready,
    canPrompt: () => authenticated && screen === 'home' && updateIdle(),
    canInstall: () => authenticated
      && (screen === 'home' || (screen === 'settings' && settingsSafe.current))
      && updateIdle(),
  });
  const runDataWork = async (action: () => Promise<void>) => {
    dataWork.current++;
    try { await action(); } finally { dataWork.current--; }
  };
  useEffect(() => subscribeMealAnswers(setAnsweringMealIds), []);
  useEffect(() => {
    if (!ready) return;
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (appState) => {
      const createdAt = Date.now();
      void appendDiagnosticEvent({
        id: `${createdAt.toString(36)}-lifecycle`, createdAt,
        operation: 'lifecycle', previousState, appState,
      }).catch(() => undefined);
      previousState = appState;
    });
    return () => subscription.remove();
  }, [ready]);

  const refresh = useCallback(async () => {
    await finalizeExpiredClarifications();
    const [nextMeals, nextGoals, nextGoalProfile] = await Promise.all([listMeals(), getDailyGoals(), getGoalProfile()]);
    await Promise.all(nextMeals.flatMap((meal) => {
      const questions = mealQuestions(meal.analysis?.clarification);
      if (questions.length === 0) return [];
      return [ensureClarificationThread(meal.id, meal.analysis?.title ?? t('meal'))
        .then((thread) => syncMealQuestionsToThread(thread.id, meal.id, questions, meal.capturedAt))
        .catch(() => undefined)];
    }));
    setMeals(nextMeals);
    setGoals(nextGoals);
    setGoalProfile(nextGoalProfile);
  }, []);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const resume = () => {
      if (AppState.currentState === 'active') void processPendingMeals().catch(() => undefined).finally(refresh);
    };
    const subscription = AppState.addEventListener('change', resume);
    // A transport failure queues a delayed retry. Revisit that queue while the
    // app is open instead of leaving it idle until WorkManager's periodic run.
    const timer = setInterval(resume, 15_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [ready, authenticated, refresh]);

  const refreshChats = useCallback(async () => {
    setChatThreads(await listChatThreads());
  }, []);

  const openMeal = useCallback((mealId: string) => {
    setManualMeal(undefined);
    setSelectedMealId(mealId);
    setScreen('detail');
  }, []);

  useEffect(() => {
    const routeUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'caldone:' && parsed.hostname === 'capture') {
          // Widget capture has no journal-date context and always starts today.
          setSelectedDay(startOfDay(Date.now()));
          setScreen('camera');
        }
      } catch {
        // Ignore unrelated or malformed deep links.
      }
    };
    void Linking.getInitialURL().then(routeUrl);
    const subscription = Linking.addEventListener('url', ({ url }) => routeUrl(url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const routeNotification = async (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const mealId = response.notification.request.content.data?.mealId;
      if (typeof mealId !== 'string') return;
      if (response.actionIdentifier === 'answer' && response.userText?.trim()) {
        try {
          await answerMealClarification(mealId, response.userText.trim());
          await refresh();
        } catch {
          // The relevant meal opens below so the user can retry in context.
        }
      }
      openMeal(mealId);
    };
    void Notifications.getLastNotificationResponseAsync().then(async (response) => {
      await routeNotification(response);
      if (response) await Notifications.clearLastNotificationResponseAsync();
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(routeNotification);
    return () => subscription.remove();
  }, [openMeal, refresh]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'settings') return false;
      if (['camera', 'capture_review', 'describe'].includes(screen)) {
        if (sendInFlight.current) {
          return true;
        }
        if (additionMealId && screen !== 'capture_review') {
          if (screen === 'camera' && photos.length > 0) setScreen('capture_review');
          else discardCapture();
          return true;
        }
      }
      const destination = backDestination(screen, photos.length > 0);
      if (destination === 'exit') return false;
      if (screen === 'detail' && manualMeal) {
        setManualMeal(undefined);
        setSelectedMealId(undefined);
      }
      if (screen === 'describe') {
        if (sending) return true;
        setNote('');
        setCaptureError('');
      }
      setScreen(destination);
      return true;
    });
    return () => subscription.remove();
  }, [additionMealId, manualMeal, photos, screen, sending]);

  useEffect(() => {
    void (async () => {
      await initializeMeals();
      await initializeChat();
      const [storedUnits, storedNotifications, storedExportPhotos, storedLocale] = await Promise.all([
        getPreference('nutrition_units'),
        getPreference('notification_preferences'),
        getPreference('export_photos'),
        getPreference('locale'),
      ]);
      const nextUnits = parsePreference(storedUnits, defaultNutritionUnits);
      const nextNotifications = parsePreference(storedNotifications, defaultNotificationPreferences);
      setUnits(nextUnits);
      setNotificationPreferences(nextNotifications);
      setIncludePhotosInExport(storedExportPhotos !== 'false');
      if (storedLocale === 'en' || storedLocale === 'ru') setLocale(storedLocale);
      const setupComplete = (await SecureStore.getItemAsync('caldone.setup.v2.complete')) === 'true';
      setShowSetup(!setupComplete);
      const signedIn = await isSignedIn();
      setAuthenticated(signedIn);
      const existingThread = await latestChatThread();
      const initialThread = existingThread ?? await createChatThread();
      setChatThread(initialThread);
      await refreshChats();
      await refresh();
      const currentMeals = await listMeals();
      if (setupComplete) {
        await applyNotificationPreferences(
          nextNotifications,
          currentMeals.some((meal) => meal.capturedAt >= startOfDay(Date.now())),
        );
      }
      setReady(true);
      try {
        await registerMealBackgroundTask();
      } catch {
        // Foreground processing still works when a platform refuses background registration.
      }
      if (signedIn) await processPendingMeals();
      await refresh();
    })().catch(() => setReady(true));
  }, [refresh, refreshChats]);

  // Refresh after completion even when the user has navigated away from capture.
  useEffect(() => {
    if (ready) void refresh().catch(() => undefined);
  }, [dishAdditions, ready, refresh]);

  const dayMeals = useMemo(() => {
    const end = nextDay(selectedDay);
    return meals.filter((meal) => meal.capturedAt >= selectedDay && meal.capturedAt < end);
  }, [meals, selectedDay]);
  const selectedMeal = manualMeal?.id === selectedMealId ? manualMeal : meals.find((meal) => meal.id === selectedMealId);
  const canGoNext = selectedDay < startOfDay(Date.now());

  useEffect(() => {
    if (screen !== 'detail' || !selectedMeal || !['queued', 'analyzing'].includes(selectedMeal.status)) return;
    const timer = setInterval(() => void refresh(), 1200);
    return () => clearInterval(timer);
  }, [refresh, screen, selectedMeal?.id, selectedMeal?.status]);

  const openCapture = () => {
    setAdditionMealId(undefined);
    setCaptureError('');
    setScreen('camera');
  };

  const captured = (photo: MealPhoto) => {
    setPhotos((current) => [...current, photo]);
    setScreen('capture_review');
  };

  const addManualMeal = () => {
    const capturedAt = mealTimeOnDay(selectedDay);
    const meal: Meal = {
      id: `${capturedAt.toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      revision: 1,
      capturedAt,
      status: 'complete',
      note: '',
      photos: [],
      analysis: {
        title: t('meal'),
        mealType: mealTypeFor(capturedAt),
        items: [{ name: '', quantity: '', calories: 0, protein: 0, carbs: 0, fat: 0 }],
        totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      },
    };
    setManualMeal(meal);
    setSelectedMealId(meal.id);
    setScreen('detail');
  };

  const deletePhoto = (photo: MealPhoto) => {
    try {
      const file = new File(photo.uri);
      if (file.exists) file.delete();
    } catch {
      // Camera cache cleanup is best effort.
    }
  };

  const removePhoto = (index: number) => {
    const removed = photos[index];
    if (removed) deletePhoto(removed);
    const remaining = photos.filter((_, photoIndex) => photoIndex !== index);
    setPhotos(remaining);
    if (remaining.length === 0) setScreen('camera');
  };

  const discardCapture = () => {
    if (sendInFlight.current) return;
    photos.forEach(deletePhoto);
    setPhotos([]);
    setNote('');
    setCaptureError('');
    setScreen(additionMealId ? 'detail' : 'home');
    setAdditionMealId(undefined);
  };

  const openDescription = () => {
    if (sendInFlight.current) return;
    photos.forEach(deletePhoto);
    setPhotos([]);
    setCaptureError('');
    setScreen('describe');
  };

  const sendMeal = async () => {
    if (!hasMealInput({ photos, note }) || sendInFlight.current) return;
    sendInFlight.current = true;
    setSending(true);
    setCaptureError('');
    const storedPhotos: MealPhoto[] = [];
    let mealSaved = false;
    try {
      const mealId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      const photoDirectory = new Directory(Paths.document, 'meal-photos');
      photoDirectory.create({ idempotent: true, intermediates: true });
      for (const [index, photo] of photos.entries()) {
        const source = new File(photo.uri);
        const destination = new File(photoDirectory, `${mealId}-${index}.jpg`);
        await source.copy(destination);
        storedPhotos.push({ ...photo, uri: destination.uri });
      }
      if (additionMealId) {
        // The service owns the copied input now; capture can close before AI finishes.
        startDishAddition(additionMealId, { photos: storedPhotos, note: note.trim() });
        mealSaved = true;
        photos.forEach(deletePhoto);
        setPhotos([]);
        setNote('');
        setSelectedMealId(additionMealId);
        setAdditionMealId(undefined);
        setScreen('detail');
        await refresh();
        return;
      }
      const meal = await createMeal({
        id: mealId,
        capturedAt: mealTimeOnDay(selectedDay),
        note: note.trim(),
        photos: storedPhotos,
      });
      mealSaved = true;
      photos.forEach(deletePhoto);
      setPhotos([]);
      setNote('');
      setSelectedDay(startOfDay(meal.capturedAt));
      setScreen('home');
      await refresh();
      void applyNotificationPreferences(notificationPreferences, true);
      void processMeal(meal.id).finally(refresh);
    } catch (error) {
      if (!mealSaved) storedPhotos.forEach(deletePhoto);
      setCaptureError(additionMealId
        ? [t('addDishError'), error instanceof Error && [t('addDishChanged'), t('addDishNotReady')].includes(error.message) ? error.message : ''].filter(Boolean).join(' ')
        : t('saveError'));
    } finally {
      sendInFlight.current = false;
      setSending(false);
    }
  };

  const retry = async (meal: Meal) => {
    await queueMealRetry(meal.id);
    await refresh();
    await processMeal(meal.id).finally(refresh);
  };

  const answer = (meal: Meal, value: string) => submitMealAnswer(meal.id, async () => {
    try { await answerMealClarification(meal.id, value); }
    finally { await refresh(); }
  });

  const saveMeal = async (capturedAt: number, analysis: MealAnalysis) => {
    if (!selectedMeal) return;
    const normalizedAnalysis = analysisFromItems({ title: analysis.title, mealType: analysis.mealType, items: analysis.items });
    if (manualMeal?.id === selectedMeal.id) {
      await saveMealRecord({ ...manualMeal, capturedAt, analysis: normalizedAnalysis });
      setManualMeal(undefined);
    } else {
      await updateMeal(selectedMeal.id, { capturedAt, analysis: normalizedAnalysis });
    }
    await refresh();
  };

  const removeMeal = async () => {
    if (!selectedMeal) return;
    if (manualMeal?.id === selectedMeal.id) {
      setManualMeal(undefined);
      setSelectedMealId(undefined);
      setScreen('home');
      return;
    }
    selectedMeal.photos.forEach(deletePhoto);
    await deleteMeal(selectedMeal.id);
    discardDishAddition(selectedMeal.id);
    setSelectedMealId(undefined);
    setScreen('home');
    await refresh();
  };

  const removeMealFromHome = async (meal: Meal) => {
    await deleteMeal(meal.id);
    discardDishAddition(meal.id);
    meal.photos.forEach(deletePhoto);
    if (selectedMealId === meal.id) setSelectedMealId(undefined);
    await refresh();
  };

  const showInfo = (title: string, message?: string) => dialog.show({
    title,
    message,
    actions: [{ label: t('close'), role: 'cancel' }],
  });

  const confirmMealDeletion = (meal: Meal) => dialog.show({
    title: t('deleteConfirmTitle'),
    message: t('deleteConfirmBody'),
    actions: [
      { label: t('delete'), role: 'destructive', onPress: () => removeMealFromHome(meal) },
      { label: t('cancel'), role: 'cancel' },
    ],
  });

  const reanalyzeMeal = async (meal: Meal) => {
    const current = meals.find(value => value.id === meal.id);
    if (!current) return;
    try {
      const result = await requestMealReanalysis(current, retry,
        answeringMealIds.has(current.id) || mealActivities.has(current.id));
      if (result === 'busy') showInfo(t('analysisAlreadyRunning'));
      if (result === 'missing_input') showInfo(t('reanalyzeUnavailable'));
    } catch {
      showInfo(t('reanalyzeError'));
    }
  };

  const showMealActions = (meal: Meal) => dialog.show({
    title: meal.analysis?.title ?? t('meal'),
    actions: [
      { label: t('askAssistant'), onPress: () => openAssistant(meal.id) },
      { label: t('reanalyzeMeal'), onPress: () => reanalyzeMeal(meal) },
      { label: t('delete'), role: 'destructive', onPress: () => confirmMealDeletion(meal) },
      { label: t('cancel'), role: 'cancel' },
    ],
  });

  const persistGoals = async (nextGoals: DailyGoals) => {
    setSavingGoals(true);
    try {
      await saveDailyGoals(nextGoals);
      await refresh();
    } finally {
      setSavingGoals(false);
    }
  };

  const persistGoalSetup = async (profile: GoalProfile, nextGoals: DailyGoals) => {
    setSavingGoals(true);
    try {
      await saveGoalSetup(profile, nextGoals);
      setGoalProfile(profile);
      setGoals(nextGoals);
      await refresh();
    } finally {
      setSavingGoals(false);
    }
  };

  const finishSetup = async (nextGoals: DailyGoals, profile: GoalProfile) => {
    setSavingGoals(true);
    try {
      await saveGoalSetup(profile, nextGoals);
      setGoalProfile(profile);
      setGoals(nextGoals);
      setAuthenticated(true);
      setShowSetup(false);
      await SecureStore.setItemAsync('caldone.setup.v2.complete', 'true');
      await applyNotificationPreferences(notificationPreferences, false, { requestPermission: true });
      await processPendingMeals();
      await refresh();
    } finally {
      setSavingGoals(false);
    }
  };

  const providerConnected = async () => {
    setAuthenticated(true);
    setScreen('home');
    await processPendingMeals();
    await refresh();
  };

  const persistUnits = async (nextUnits: NutritionUnits) => {
    await savePreference('nutrition_units', JSON.stringify(nextUnits));
    setUnits(nextUnits);
  };

  const persistNotifications = async (preferences: NotificationPreferences) => {
    const requestPermission = Object.entries(preferences).some(
      ([key, enabled]) => enabled && !notificationPreferences[key as keyof NotificationPreferences],
    );
    await savePreference('notification_preferences', JSON.stringify(preferences));
    setNotificationPreferences(preferences);
    await applyNotificationPreferences(
      preferences,
      meals.some((meal) => meal.capturedAt >= startOfDay(Date.now())),
      { requestPermission },
    );
  };

  const persistLocale = async (nextLocale: Locale) => {
    await savePreference('locale', nextLocale);
    setLocale(nextLocale);
    setLocaleVersion((version) => version + 1);
  };

  const persistExportPhotos = async (include: boolean) => {
    await savePreference('export_photos', String(include));
    setIncludePhotosInExport(include);
  };

  const exportData = async () => {
    try {
      const assistantInstructions = await getPreference('assistant_custom_instructions');
      await shareJsonExport('caldone-export.json', t('exportMyData'), {
        format: BACKUP_FORMAT,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        preferences: {
          goals,
          goalProfile,
          units,
          notifications: notificationPreferences,
          locale,
          assistantInstructions: assistantInstructions ?? '',
        },
        meals: await Promise.all(meals.map((meal) => exportableMeal(meal, includePhotosInExport))),
        conversations: await exportChatData(includePhotosInExport),
      });
    } catch {
      showInfo(t('exportFailedTitle'), t('exportFailedBody'));
    }
  };

  const importData = async () => {
    try {
      const selection = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/json'] });
      if (selection.canceled) return;
      if (selection.result.size > MAX_BACKUP_BYTES) {
        showInfo(t('importFailedTitle'), t('importTooLarge'));
        return;
      }
      const backup = parseCalDoneBackup(await selection.result.json());
      const summary = summarizeBackup(backup);
      dialog.show({
        title: t('importPreviewTitle'),
        message: t('importPreviewBody', summary),
        actions: [
          { label: t('importAction'), onPress: () => performImport(backup) },
          { label: t('cancel'), role: 'cancel' },
        ],
      });
    } catch {
      showInfo(t('importFailedTitle'), t('importFailedBody'));
    }
  };

  const performImport = async (backup: ReturnType<typeof parseCalDoneBackup>) => {
    dataWork.current++;
    setImportingData(true);
    try {
      const result = await mergeCalDoneBackup(backup);
      if (backup.preferences.units) setUnits(backup.preferences.units);
      if (backup.preferences.notifications) setNotificationPreferences(backup.preferences.notifications);
      if (backup.preferences.locale) {
        setLocale(backup.preferences.locale);
        setLocaleVersion((version) => version + 1);
      }
      await Promise.all([refresh(), refreshChats()]);
      if (backup.preferences.notifications) {
        const importedMeals = await listMeals();
        await applyNotificationPreferences(
          backup.preferences.notifications,
          importedMeals.some((meal) => meal.capturedAt >= startOfDay(Date.now())),
        );
      }
      if (authenticated) void processPendingMeals().finally(refresh);
      showInfo(t('importCompleteTitle'), t('importCompleteBody', {
        meals: result.mealsImported,
        conversations: result.conversationsImported,
        photos: result.photosImported,
        skipped: result.mealsSkipped + result.conversationsSkipped,
      }));
    } catch {
      showInfo(t('importFailedTitle'), t('importFailedBody'));
    } finally {
      setImportingData(false);
      dataWork.current--;
    }
  };

  const exportDiagnostics = async () => {
    try {
      const provider = await getSelectedProvider();
      const model = await getSelectedModel(provider);
      const [thinkingLevel, webSearchEnabled, events] = await Promise.all([
        getThinkingLevel(provider, model),
        getWebSearchEnabled(provider),
        listDiagnosticEvents(),
      ]);
      const directory = await Directory.pickDirectoryAsync();
      const filename = `caldone-diagnostics-${Date.now()}.json`;
      const file = directory.createFile(filename, 'application/json');
      file.write(JSON.stringify({
        exportedAt: new Date().toISOString(),
        processing: { foregroundServiceActive: foregroundWorkActive(), meals: (await listMeals()).map(meal => ({ status: meal.status, capturedAt: meal.capturedAt, error: meal.error })) },
        testRequest: mealRequestDiagnostics.read(),
        app: { version: appConfig.expo.version, platform: Platform.OS, platformVersion: Platform.Version },
        ai: { provider, model: model ?? 'automatic', thinkingLevel: thinkingLevel ?? 'automatic', webSearchEnabled },
        events: events.map((event) => {
          if (event.operation === 'layout' || event.operation === 'lifecycle' || event.operation === 'camera' || event.operation === 'web_search') return event;
          if (event.operation === 'image_lookup') {
            const { mealId: _mealId, ...metadata } = event;
            return metadata;
          }
          const { outputText: _outputText, mealId: _mealId, threadId: _threadId, ...metadata } = event;
          return metadata;
        }),
      }, null, 2));
      showInfo(t('diagnosticsSaved'), filename);
    } catch (error) {
      if (/picker.*cancel/i.test(String(error))) return;
      showInfo(t('exportFailedTitle'), t('diagnosticsExportFailedBody'));
    }
  };

  const removeSavedPhotos = async () => {
    discardAllDishAdditions();
    mealRequestDiagnostics.clear();
    const removed = await removeAllMealPhotos();
    removed.forEach(deletePhoto);
    await refresh();
  };

  const removeAllSavedMeals = async () => {
    discardAllDishAdditions();
    mealRequestDiagnostics.clear();
    const removed = await deleteAllMeals();
    removed.forEach(deletePhoto);
    await deleteAllChatData();
    const thread = await createChatThread();
    setChatThread(thread);
    await refreshChats();
    setSelectedMealId(undefined);
    setGoalProfile(undefined);
    setGoals({});
    await refresh();
  };

  const openAssistant = async (mealId?: string) => {
    if (mealId) {
      const meal = meals.find((item) => item.id === mealId);
      const clarification = Boolean(meal?.analysis?.clarification);
      const thread = clarification
        ? await ensureClarificationThread(mealId, meal?.analysis?.title ?? t('meal'))
        : await preferredMealThread(mealId, false) ?? await createChatThread({ mealId, purpose: 'meal' });
      const questions = mealQuestions(meal?.analysis?.clarification);
      if (questions.length > 0) await syncMealQuestionsToThread(thread.id, mealId, questions, meal?.capturedAt);
      setChatThread(thread);
      await refreshChats();
    }
    setAssistantMealId(mealId);
    setScreen('assistant');
  };

  const createConversation = async (mealId?: string) => {
    const thread = await createChatThread(mealId ? { mealId, purpose: 'meal' } : undefined);
    setChatThread(thread);
    setAssistantMealId(mealId);
    await refreshChats();
    setScreen('assistant');
  };

  const openConversation = (thread: ChatThread) => {
    setChatThread(thread);
    setAssistantMealId(thread.mealId);
    setScreen('assistant');
  };

  const removeConversation = async (thread: ChatThread) => {
    await deleteChatThread(thread.id);
    const remaining = await listChatThreads();
    let next = remaining[0];
    if (!next) next = await createChatThread();
    if (chatThread?.id === thread.id) setChatThread(next);
    await refreshChats();
  };

  if (!ready) {
    return <View style={styles.loading}><StatusBar style="dark" /><ActivityIndicator color={color.action} /></View>;
  }

  if (showSetup) {
    return (
      <>
        <StatusBar style="dark" />
        <SetupScreen saving={savingGoals} onComplete={finishSetup} />
      </>
    );
  }

  if (!authenticated) {
    return (
      <>
        <StatusBar style="dark" />
        <ProviderSetupScreen completionLabel={t('continue')} onComplete={providerConnected} />
      </>
    );
  }

  if (screen === 'camera') {
    return (
      <>
        <StatusBar style="dark" />
        <CaptureScreen
          error={captureError}
          photos={photos}
          onDescribe={openDescription}
          onCancel={() => photos.length > 0 ? setScreen('capture_review') : discardCapture()}
          onCaptured={captured}
        />
      </>
    );
  }

  if (screen === 'describe') {
    return <>
      <StatusBar style="dark" />
      <DescribeMealScreen addingDish={Boolean(additionMealId)} note={note} sending={sending} error={additionMealId ? captureError : captureError ? t('descriptionSaveError') : undefined} onChange={setNote} onCancel={discardCapture} onManual={additionMealId ? undefined : () => { discardCapture(); addManualMeal(); }} onSend={() => void sendMeal()} />
    </>;
  }

  if (screen === 'capture_review') {
    return (
      <>
        <StatusBar style="light" />
        <CaptureReviewScreen
          addingDish={Boolean(additionMealId)}
          error={captureError}
          note={note}
          photos={photos}
          sending={sending}
          onAddPhoto={() => setScreen('camera')}
          onCancel={discardCapture}
          onNoteChange={setNote}
          onRemovePhoto={removePhoto}
          onSend={sendMeal}
        />
      </>
    );
  }

  if (screen === 'settings') {
    return (
      <>
      <StatusBar style="dark" />
      <SettingsScreen
        updates={updates}
        onUpdateSafetyChange={updateSettingsSafety}
        goals={goals}
        goalProfile={goalProfile}
        includePhotosInExport={includePhotosInExport}
        importingData={importingData}
        locale={locale}
        notifications={notificationPreferences}
        saving={savingGoals}
        units={units}
        onBack={() => setScreen('home')}
        onChangeLocale={persistLocale}
        onDeleteAllMeals={() => runDataWork(removeAllSavedMeals)}
        onExport={() => runDataWork(exportData)}
        onImport={() => runDataWork(importData)}
        onExportDiagnostics={() => runDataWork(exportDiagnostics)}
        onIncludePhotosInExport={persistExportPhotos}
        onManageProvider={() => setScreen('providers')}
        onRemoveAllPhotos={() => runDataWork(removeSavedPhotos)}
        onSaveGoalSetup={persistGoalSetup}
        onSaveGoals={persistGoals}
        onSaveNotifications={persistNotifications}
        onSaveUnits={persistUnits}
      />
      </>
    );
  }

  if (screen === 'providers') {
    return (
      <>
        <StatusBar style="dark" />
        <ProviderSetupScreen
          onBack={() => setScreen('settings')}
        />
      </>
    );
  }

  if (screen === 'assistant_provider') {
    return (
      <>
        <StatusBar style="dark" />
        <ProviderSetupScreen
          onBack={() => setScreen('assistant')}
        />
      </>
    );
  }

  if (screen === 'chat_history') {
    return (
      <>
        <StatusBar style="dark" />
        <ChatHistoryScreen
          threads={chatThreads}
          onBack={() => setScreen('assistant')}
          onDelete={(thread) => void removeConversation(thread)}
          onNewChat={() => void createConversation()}
          onOpen={openConversation}
        />
      </>
    );
  }

  const navigationHeight = 60 + insets.bottom;

  if (screen === 'assistant' && chatThread) {
    return (
      <View style={styles.appShell}>
        <StatusBar style="dark" />
        <AssistantScreen
          answeringMealIds={answeringMealIds}
          meals={meals}
          bottomInset={navigationHeight}
          selectedMeal={meals.find((meal) => meal.id === assistantMealId)}
          thread={chatThread}
          onClearMealContext={() => setAssistantMealId(undefined)}
          onDataChanged={async () => { await refresh(); await refreshChats(); }}
          onHistory={() => { void refreshChats(); setScreen('chat_history'); }}
          onNewChat={() => void createConversation(assistantMealId)}
          onModelSettings={() => setScreen('assistant_provider')}
          onUndo={undoAssistantAction}
        />
        <PrimaryNavigation active="assistant" bottomInset={insets.bottom} onAssistant={() => undefined} onToday={() => setScreen('home')} />
      </View>
    );
  }

  if (screen === 'detail' && selectedMeal) {
    return (
      <>
        <StatusBar style="dark" />
        <MealDetailScreen
          answerSubmitting={answeringMealIds.has(selectedMeal.id)}
          activity={mealActivities.get(selectedMeal.id)}
          dishAddition={dishAdditions.get(selectedMeal.id)}
          onStopDishAddition={() => stopDishAddition(selectedMeal.id)}
          onRetryDishAddition={() => retryDishAddition(selectedMeal.id)}
          onDiscardDishAddition={() => discardDishAddition(selectedMeal.id)}
          initialEditing={Boolean(manualMeal)}
          creating={Boolean(manualMeal)}
          meal={selectedMeal}
          onReanalyze={() => reanalyzeMeal(selectedMeal)}
          onAddDish={() => {
            setAdditionMealId(selectedMeal.id);
            setPhotos([]);
            setNote('');
            setCaptureError('');
            setScreen('camera');
          }}
          units={units}
          onAnswer={(value) => answer(selectedMeal, value)}
          onAskAssistant={() => openAssistant(selectedMeal.id)}
          onBack={() => {
            setManualMeal(undefined);
            setSelectedMealId(undefined);
            setScreen('home');
          }}
          onDelete={removeMeal}
          onSave={saveMeal}
        />
      </>
    );
  }

  return (
    <View style={styles.appShell}>
      <StatusBar style="dark" />
      <HomeScreen
        failedDishAdditionIds={new Set([...dishAdditions].filter(([, state]) => state.status === 'failed').map(([id]) => id))}
        answeringMealIds={answeringMealIds}
        activities={mealActivities}
        bottomInset={navigationHeight}
        canGoNext={canGoNext}
        day={selectedDay}
        goals={goals}
        meals={dayMeals}
        units={units}
        onAnswer={answer}
        onAskAssistant={(meal) => void openAssistant(meal.id)}
        onCapture={openCapture}
        onNextDay={() => canGoNext && setSelectedDay(nextDay(selectedDay))}
        onOpen={(meal) => openMeal(meal.id)}
        onMealLongPress={showMealActions}
        onPreviousDay={() => setSelectedDay(previousDay(selectedDay))}
        onRetry={retry}
        onSettings={() => setScreen('settings')}
      />
      <PrimaryNavigation active="home" bottomInset={insets.bottom} onAssistant={() => openAssistant()} onToday={() => setScreen('home')} />
    </View>
  );
}

function PrimaryNavigation(props: {
  active: 'home' | 'assistant';
  bottomInset: number;
  onToday: () => void;
  onAssistant: () => void;
}) {
  return (
    <View style={[styles.navigation, { height: 60 + props.bottomInset, paddingBottom: props.bottomInset }]}>
      <NavigationItem active={props.active === 'home'} icon="today-outline" label={t('today')} onPress={props.onToday} />
      <NavigationItem active={props.active === 'assistant'} icon="chatbox-ellipses-outline" label={t('assistant')} onPress={props.onAssistant} />
    </View>
  );
}

function NavigationItem(props: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: props.active }} onPress={props.onPress} style={styles.navigationItem}>
      {({ pressed }) => <>
        <View collapsable={false} style={[styles.navigationIcon, (props.active || pressed) && styles.navigationIconActive, pressed && styles.navigationIconPressed]}><Ionicons name={props.icon} size={22} color={props.active || pressed ? color.action : color.muted} /></View>
        <Text style={[styles.navigationLabel, props.active && styles.navigationLabelActive]}>{props.label}</Text>
      </>}
    </Pressable>
  );
}

// The journal owns the meal date; the current local clock supplies only its time.
// Set calendar fields instead of adding milliseconds so DST days remain correct.
function mealTimeOnDay(day: number): number {
  const clock = new Date();
  const date = new Date(day);
  date.setHours(clock.getHours(), clock.getMinutes(), clock.getSeconds(), clock.getMilliseconds());
  return date.getTime();
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

async function exportableMeal(meal: Meal, includePhotos: boolean) {
  const exportedPhotos = includePhotos
    ? await Promise.all(meal.photos.map(async (photo) => {
      try {
        return { mimeType: photo.mimeType, base64: await new File(photo.uri).base64() };
      } catch {
        return { mimeType: photo.mimeType, unavailable: true };
      }
    }))
    : [];
  return { ...meal, photos: exportedPhotos };
}

async function shareJsonExport(fileName: string, title: string, value: unknown): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true, intermediates: true });
  file.write(JSON.stringify(value, null, 2));
  await Sharing.shareAsync(file.uri, { dialogTitle: title, mimeType: 'application/json' });
}

function nextDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + 1);
  return startOfDay(date.getTime());
}

function previousDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setDate(date.getDate() - 1);
  return startOfDay(date.getTime());
}

function mealTypeFor(timestamp: number): MealAnalysis['mealType'] {
  const hour = new Date(timestamp).getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

const styles = StyleSheet.create({
  appShell: { backgroundColor: color.canvas, flex: 1 },
  loading: { alignItems: 'center', backgroundColor: color.canvas, flex: 1, justifyContent: 'center' },
  navigation: { alignItems: 'flex-start', backgroundColor: color.surface, borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth, bottom: 0, flexDirection: 'row', left: 0, paddingHorizontal: 28, position: 'absolute', right: 0 },
  navigationIcon: { alignItems: 'center', justifyContent: 'center', width: 58, height: 30, borderRadius: 999, overflow: 'hidden' },
  navigationIconActive: { backgroundColor: color.actionSoft },
  navigationItem: { alignItems: 'center', flex: 1, height: 60, justifyContent: 'center', minWidth: 72 },
  navigationIconPressed: { backgroundColor: color.surfacePressed },
  navigationLabel: { color: color.muted, fontFamily: type.ticket, fontSize: 12, marginTop: 2 },
  navigationLabelActive: { color: color.action, fontFamily: type.ticketBold },
});
