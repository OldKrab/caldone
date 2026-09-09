/** Only transport failures are retried; auth, validation, and user cancellation are not. */
export function isConnectionError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /UnknownHostException|Unable to resolve host|Software caused connection abort|Network request failed|fetch failed|ECONNRESET|network connection.*lost/i.test(text);
}

/** For inference requests without app mutations. A retry never repeats a tool action. */
export async function retryConnection<T>(request: () => Promise<T>, beforeRetry: () => Promise<void>): Promise<T> {
  try { return await request(); }
  catch (error) {
    if (!isConnectionError(error)) throw error;
    await beforeRetry();
    return request();
  }
}

/** Resume after an incomplete response, preserving all committed tool results. */
export function continuationMessages<T extends { role: string; stopReason?: string }>(messages: T[]): T[] | undefined {
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || last.stopReason !== 'error') return undefined;
  const previous = messages.slice(0, -1);
  if (!previous.length || previous.at(-1)?.role === 'assistant') return undefined;
  return previous;
}

export function connectionErrorText(error: string, language: string): string {
  if (!isConnectionError(error)) return error;
  return language === 'ru'
    ? 'Соединение прервалось. Проверьте интернет или VPN и повторите. Уже сохранённые изменения останутся.'
    : 'The connection was interrupted. Check your internet or VPN and retry. Changes already saved are kept.';
}
