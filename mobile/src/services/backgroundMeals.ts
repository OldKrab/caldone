import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { initializeMeals } from '../data/mealRepository';
import { initializeChat } from '../data/chatRepository';
import { processPendingMeals } from './mealProcessor';

const TASK_NAME = 'caldone-process-meals';

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    await initializeMeals();
    await initializeChat();
    await processPendingMeals();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerMealBackgroundTask(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (registered) return;
  await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 });
}
