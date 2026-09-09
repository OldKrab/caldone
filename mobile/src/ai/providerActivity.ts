import { fetch as expoFetch } from 'expo/fetch';

import { providerActivityFromEvent, type ProviderToolActivity } from './providerActivityEvent';
import { searchActivityObserver } from './searchDiagnostics';
import { appendDiagnosticEvent } from '../data/mealRepository';

export type { ProviderToolActivity } from './providerActivityEvent';

/**
 * Mirrors only provider lifecycle metadata that Pi does not currently surface.
 * Response content and tool arguments are deliberately neither retained nor emitted.
 */
export function fetchWithProviderActivity(
  onActivity?: (activity: ProviderToolActivity) => void,
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await expoFetch(input as never, init as never);
    if (response.body && response.headers.get('content-type')?.includes('text/event-stream')) {
      try {
        const record = searchActivityObserver(activity => {
          void appendDiagnosticEvent({
            id: `${Date.now().toString(36)}-search-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(), operation: 'web_search', ...activity,
          }).catch(() => undefined);
        });
        void observeEventStream(response.clone() as unknown as Response, activity => {
          record(activity);
          onActivity?.(activity);
        });
      } catch {
        // The model response remains usable if this optional UI observer cannot clone it.
      }
    }
    return response as unknown as Response;
  }) as typeof globalThis.fetch;
}

async function observeEventStream(
  response: Response,
  onActivity: (activity: ProviderToolActivity) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) emitSseActivity(chunk, onActivity);
      if (done) break;
    }
    if (buffer) emitSseActivity(buffer, onActivity);
  } catch {
    // Activity visibility is best effort and must never interfere with the request.
  } finally {
    reader.releaseLock();
  }
}

function emitSseActivity(chunk: string, onActivity: (activity: ProviderToolActivity) => void): void {
  const payload = chunk.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!payload || payload === '[DONE]') return;
  try {
    const activity = providerActivityFromEvent(JSON.parse(payload));
    if (activity) onActivity(activity);
  } catch {
    // Ignore non-JSON keepalives and provider-specific frames.
  }
}
