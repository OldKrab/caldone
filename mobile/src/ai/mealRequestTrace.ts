/** Explicit, one-analysis capture. Never persist request headers or credentials.
 * Source photos and allowed wire-body fields are private test data, exported only
 * after the user arms capture and chooses to save diagnostics. */
export type MealRequestTrace = {
  schema: 'meal-request-trace-v1';
  id: string;
  state: 'armed' | 'recording' | 'complete' | 'failed';
  startedAt: number;
  finishedAt?: number;
  metadata?: Record<string, unknown>;
  attempts: number;
  requests: { endpoint: string; body?: unknown; captureError?: string; httpStatus?: number }[];
  responses: { text: string; responseId?: string; stopReason?: string; error?: string }[];
  error?: string;
};

type Store = { read(): MealRequestTrace | undefined; write(value: MealRequestTrace | undefined): void };
const bodyFields = new Set(['model', 'input', 'messages', 'contents', 'instructions', 'system', 'systemInstruction', 'reasoning', 'thinking', 'tools', 'tool_choice', 'text', 'response_format', 'max_output_tokens', 'max_tokens', 'temperature', 'stream', 'include', 'store']);

export class MealRequestDiagnostics {
  private store: Store;
  constructor(store: Store) { this.store = store; }

  arm(): void {
    this.store.write({ schema: 'meal-request-trace-v1', id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, state: 'armed', startedAt: Date.now(), attempts: 0, requests: [], responses: [] });
  }

  clear(): void { this.store.write(undefined); }
  read(): MealRequestTrace | undefined { return this.store.read(); }

  /** Claim synchronously before any awaits: concurrent meals cannot consume the same capture. */
  begin(metadata: Record<string, unknown>) {
    const trace = this.store.read();
    if (trace?.state !== 'armed') return undefined;
    trace.state = 'recording';
    trace.startedAt = Date.now();
    trace.metadata = metadata;
    this.store.write(trace);
    const save = () => {
      // Rearming/deleting a trace invalidates callbacks from an older request.
      if (this.store.read()?.id === trace.id) this.store.write(trace);
    };
    const bestEffortSave = () => { try { save(); } catch { /* Diagnostic IO must not fail the meal request. */ } };
    return {
      wrapFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
        return async (input, init) => {
          const request: MealRequestTrace['requests'][number] = { endpoint: '' };
          try {
            const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
            request.endpoint = url.origin + url.pathname;
            const body = init?.body ?? (typeof input === 'object' && 'clone' in input ? await input.clone().text() : undefined);
            if (typeof body !== 'string') throw new Error('Request body is not text');
            const parsed = JSON.parse(body);
            request.body = Object.fromEntries(Object.entries(parsed).filter(([key]) => bodyFields.has(key)));
          } catch {
            request.captureError = 'Could not capture the JSON request body';
          }
          trace.attempts += 1;
          trace.requests = [...trace.requests, request].slice(-3);
          bestEffortSave();
          const response = await fetch(input, init);
          request.httpStatus = response.status;
          bestEffortSave();
          // Forward the original streaming response without reading its body.
          return response;
        };
      },
      response(response: MealRequestTrace['responses'][number]): void {
        trace.responses = [...trace.responses, response].slice(-3);
        bestEffortSave();
      },
      finish(error?: unknown): void {
        trace.state = error === undefined ? 'complete' : 'failed';
        trace.finishedAt = Date.now();
        trace.error = error === undefined ? undefined : String(error).slice(0, 1000);
        bestEffortSave();
      },
    };
  }
}

export type MealRequestCapture = NonNullable<ReturnType<MealRequestDiagnostics['begin']>>;
