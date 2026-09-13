import { ensureMealThread } from '../data/chatRepository';
import { getMeal } from '../data/mealRepository';
import { openChatSession, type ChatSessionSnapshot } from './chatSession';
import type { ChatAttachment, ChatSendOptions } from '../domain/chat';
import { mealQuestions } from '../domain/meal';

/** Capture, forms and chat use the same retained agent conversation. A headless
 * caller attaches only for this turn; screen navigation does not own the work. */
export async function sendMealMessage(
  mealId: string,
  text: string,
  attachments: ChatAttachment[] = [],
  options?: ChatSendOptions,
): Promise<void> {
  return mealConversationAction(
    mealId,
    (session) => session.send(text, attachments, options),
    options?.signal,
  );
}

export async function resumeMealConversation(mealId: string, signal?: AbortSignal): Promise<void> {
  return mealConversationAction(mealId, (session) => session.retry(), signal);
}

async function mealConversationAction(
  mealId: string,
  action: (session: Awaited<ReturnType<typeof openChatSession>>) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const meal = await getMeal(mealId);
  if (!meal) throw new Error('Meal no longer exists.');
  const thread = await ensureMealThread(mealId, meal.analysis?.title ?? 'Meal');
  let snapshot: ChatSessionSnapshot | undefined;
  const session = await openChatSession({
    thread,
    selectedMealId: mealId,
    selectedMealQuestions: mealQuestions(meal.analysis?.clarification),
    onChanged: (value) => {
      snapshot = value;
    },
    onDataChanged: async () => {},
  });
  const abort = () => session.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    await action(session);
    if (snapshot?.error) throw new Error(snapshot.error);
  } finally {
    signal?.removeEventListener('abort', abort);
    await session.close();
  }
}
