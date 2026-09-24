/** Bound inference even if an interrupted native stream never closes. The
 * abandoned inference cannot mutate app data; callers save only the winning result. */
export async function requestWithDeadline<T>(request: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal, milliseconds = 180_000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => { controller.abort(); reject(new Error('Request cancelled')); };
    parent?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new Error('Meal analysis timed out. Please retry.')); }, milliseconds);
    if (parent?.aborted) cancel();
  });
  try {
    return await Promise.race([interrupted, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('Request cancelled');
      return request(controller.signal);
    })]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
  }
}
