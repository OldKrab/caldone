type Listener = (mealIds: ReadonlySet<string>) => void;
const submissions = new Map<string, number>();
const listeners = new Set<Listener>();
const publish = () => listeners.forEach(listener => listener(new Set(submissions.keys())));

/** Hide actionable questions while their answer is being processed, without
 * deleting durable conversation history. Nested UI/processor owners release
 * independently; the UI owner includes refreshing the saved meal in its work. */
export async function submitMealAnswer<T>(mealId: string, work: () => Promise<T>): Promise<T> {
  submissions.set(mealId, (submissions.get(mealId) ?? 0) + 1);
  publish();
  try { return await work(); }
  finally {
    const remaining = (submissions.get(mealId) ?? 1) - 1;
    if (remaining) submissions.set(mealId, remaining);
    else submissions.delete(mealId);
    publish();
  }
}

export function subscribeMealAnswers(listener: Listener): () => void {
  listeners.add(listener);
  listener(new Set(submissions.keys()));
  return () => { listeners.delete(listener); };
}
