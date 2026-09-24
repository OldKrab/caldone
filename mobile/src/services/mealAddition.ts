import { getMeal } from '../data/mealRepository';
import { pendingAgentTurn } from '../data/agentTurnRepository';
import { hasMealInput } from '../ai/mealInput';
import { canAddDish } from '../domain/mealAddition';
import type { MealPhoto } from '../domain/meal';
import { sendMealMessage, resumeMealConversation } from './mealConversation';
import { t } from '../i18n';

/** An addition is a message in the meal's conversation. Once accepted, its
 * photos belong to that durable input even if inference later fails. */
export async function addDishToMeal(
  id: string,
  input: { photos: MealPhoto[]; note: string; signal?: AbortSignal },
): Promise<void> {
  input.signal?.throwIfAborted();
  const meal = await getMeal(id);
  if (!meal || !hasMealInput(input)) throw new Error(t('addDishError'));
  const text = `Добавь к этой записи только новую еду из этого сообщения. Сохрани прежние позиции и их значения, название, описание, время и тип приёма пищи. Описание добавления: ${input.note}`;
  const pending = await pendingAgentTurn({ mealId: id });
  if (
    pending?.message.source === 'addition' &&
    pending.message.text === text &&
    JSON.stringify(pending.message.attachments.map((photo) => photo.id)) ===
      JSON.stringify(input.photos.map((photo) => photo.id))
  ) {
    await resumeMealConversation(id, input.signal);
    return;
  }
  if (!canAddDish(meal)) throw new Error(t('addDishNotReady'));
  await sendMealMessage(id, text, input.photos, { source: 'addition', signal: input.signal });
}
