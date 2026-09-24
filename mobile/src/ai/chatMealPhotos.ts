import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { File } from 'expo-file-system';
import { getMeal } from '../data/mealRepository';

/** History stores photo IDs, not image bytes. Rehydrate only photos the
 * assistant previously opened, at the provider boundary on every later turn.
 * Keep the stored message unchanged and never substitute another meal's photo. */
export async function restoreChatMealPhotos(message: AgentMessage): Promise<AgentMessage> {
  if (message.role !== 'toolResult' || message.toolName !== 'view_meal_photos' || message.isError ||
      message.content.some(block => block.type === 'image')) return message;

  const details = message.details as { mealId?: unknown; photoIds?: unknown } | undefined;
  const ids = Array.isArray(details?.photoIds)
    ? details.photoIds.filter((id): id is string => typeof id === 'string') : [];
  const meal = typeof details?.mealId === 'string' ? await getMeal(details.mealId) : undefined;
  const photos = await Promise.all([...new Set(ids)].map(async id => {
    const photo = meal?.photos.find(photo => photo.id === id);
    if (!photo) return undefined;
    try {
      return { type: 'image' as const, data: await new File(photo.uri).base64(), mimeType: photo.mimeType };
    } catch {
      // A deleted/unreadable local photo must not abort an otherwise usable chat.
      return undefined;
    }
  }));
  const images = photos.filter(photo => photo !== undefined);
  return {
    ...message,
    content: [
      ...message.content.filter(block => block.type !== 'text' || block.text !== '[Meal photo was shown to the assistant.]'),
      ...images,
      ...(images.length === 0 || images.length < ids.length ? [{ type: 'text' as const,
        text: 'Some previously viewed meal photos are no longer available. Do not claim to see the missing photos.' }] : []),
    ],
  };
}
