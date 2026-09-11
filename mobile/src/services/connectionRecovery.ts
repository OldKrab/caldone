/** Only transport failures are retried; auth, validation, and user cancellation are not. */
export function isConnectionError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  if (isProviderMarkup(text)) return false;
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
  // Stored errors contain only text: markup identifies an upstream page, not its HTTP status.
  if (isProviderMarkup(error)) return language === 'ru'
    ? 'Не удалось подключиться к сервису ИИ. Проверьте интернет и настройки VPN, затем повторите. Уже сохранённые изменения останутся.'
    : 'Could not reach the AI service. Check your internet and VPN settings, then retry. Changes already saved are kept.';
  if (!isConnectionError(error)) return connectionErrorDetails(error);
  return language === 'ru'
    ? 'Соединение прервалось. Проверьте интернет или VPN и повторите. Уже сохранённые изменения останутся.'
    : 'The connection was interrupted. Check your internet or VPN and retry. Changes already saved are kept.';
}

function isProviderMarkup(error: string): boolean {
  return /<!doctype\s+html\b|<\/?(?:html|head|body|svg|script|style|title|div)(?:\s|\/?>)/i.test(error);
}

/** Display/copy only: retain the saved error, but conceal recognized credential fields. */
export function connectionErrorDetails(error: string): string {
  return error
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:[^\r\n]*/gi, '[redacted]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted]')
    .replace(/(["']?\b(?:authorization|proxy-authorization|cookie|set-cookie|access_token|refresh_token|id_token|api[_-]?key|token|password|client_secret)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&<>;,}]+)/gi, '$1[redacted]');
}
