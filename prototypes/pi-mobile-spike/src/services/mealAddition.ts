import { File } from 'expo-file-system';
import { analyzeMeal } from '../ai/piClient';
import { hasMealInput } from '../ai/mealInput';
import { getMeal, replaceMealIfRevision } from '../data/mealRepository';
import { parseMealAnalysis, type MealPhoto } from '../domain/meal';
import { appendMealDish, canAddDish } from '../domain/mealAddition';
import { locale, t } from '../i18n';
import { beginForegroundWork } from './foregroundWork';

const adding = new Set<string>();

/** The caller owns draft photos until this atomic save succeeds. A failed or
 * stale request leaves the original meal intact and the draft available to retry.
 * No pending meal status is written: restart recovery must never analyze the
 * original evidence as if it were the new dish. */
export async function addDishToMeal(id: string, input: { photos: MealPhoto[]; note: string; signal?: AbortSignal }): Promise<void> {
  if (adding.has(id)) throw new Error(t('analysisAlreadyRunning'));
  if (!hasMealInput(input)) throw new Error(t('addDishError'));
  adding.add(id);
  let release: (() => Promise<void>) | undefined;
  try {
    input.signal?.throwIfAborted();
    const meal = await getMeal(id);
    if (!meal || !canAddDish(meal)) throw new Error(t('addDishNotReady'));
    release = await beginForegroundWork();
    const photos = await Promise.all(input.photos.map(async photo => ({
      base64: await new File(photo.uri).base64(), mimeType: photo.mimeType,
    })));
    const result = await analyzeMeal({
      mealId: id, photos, note: input.note, existingMeal: meal.analysis,
      signal: input.signal,
      language: locale === 'ru' ? 'Russian' : 'English',
    });
    const analysis = parseMealAnalysis(result.text);
    if (!analysis.items.length) throw new Error(t('addDishError'));
    const updated = appendMealDish(meal, { ...input, analysis });
    input.signal?.throwIfAborted();
    if (!await replaceMealIfRevision(updated, meal.revision)) throw new Error(t('addDishChanged'));
  } finally {
    adding.delete(id);
    await release?.().catch(() => undefined);
  }
}
