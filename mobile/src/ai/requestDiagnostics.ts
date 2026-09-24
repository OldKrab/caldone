export type RequestImageDiagnostic = {mimeType: string; bytes: number; sha256: string};
export type RequestDiagnostic = {
  id: string;
  createdAt: number;
  operation: 'ai_request';
  requestId: string;
  phase: 'sent' | 'received' | 'failed';
  provider: string;
  model: string;
  api: string;
  mealId?: string;
  threadId?: string;
  payloadSha256?: string;
  images?: RequestImageDiagnostic[];
  captureError?: boolean;
  httpStatus?: number;
  /** Null distinguishes a headerless response from older diagnostic records. */
  responseContentType?: string | null;
  serverRequestId?: string;
};

export type ToolDiagnostic = {
  id: string;
  createdAt: number;
  operation: 'ai_tool';
  threadId: string;
  toolCallId: string;
  toolName: string;
  phase: 'started' | 'completed';
  isError?: boolean;
  valueSha256?: string;
  images?: RequestImageDiagnostic[];
  captureError?: boolean;
};

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Hash exact decoded image bytes at the provider payload boundary. Never retain
 * URLs, prompt text, tool arguments, auth headers, image bytes or reasoning. */
async function payloadImages(value: unknown): Promise<RequestImageDiagnostic[]> {
  const images: RequestImageDiagnostic[] = [];
  const add = async (mimeType: string, data: string) => {
    const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    images.push({mimeType, bytes: bytes.length, sha256: await sha256(bytes)});
  };
  const visit = async (item: unknown): Promise<void> => {
    if (typeof item === 'string') {
      const match = /^data:(image\/[^;,]+);base64,([\s\S]+)$/.exec(item);
      if (match) await add(match[1], match[2]);
    } else if (Array.isArray(item)) {
      for (const child of item) await visit(child);
    } else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const mimeType = record.media_type ?? record.mimeType;
      if (typeof mimeType === 'string' && mimeType.startsWith('image/') && typeof record.data === 'string') {
        await add(mimeType, record.data);
      } else {
        for (const child of Object.values(record)) await visit(child);
      }
    }
  };
  await visit(value);
  return images;
}

/** Observe the real tool result before chat persistence strips image bytes.
 * Matching hashes link photo lookup to the next request without exporting food text. */
export async function recordToolDiagnostic(
  input: Pick<ToolDiagnostic, 'threadId' | 'toolCallId' | 'toolName' | 'phase' | 'isError'> & {value: unknown},
  record: (event: ToolDiagnostic) => Promise<void>,
): Promise<void> {
  const {value, ...metadata} = input;
  const event: ToolDiagnostic = {
    id: `${Date.now().toString(36)}-${input.toolCallId}-${input.phase}`,
    createdAt: Date.now(), operation: 'ai_tool', ...metadata,
  };
  try {
    event.valueSha256 = await sha256(new TextEncoder().encode(JSON.stringify(value)));
    event.images = await payloadImages(value);
  } catch { event.captureError = true; }
  try { await record(event); } catch { /* Diagnostics must not change tool outcomes. */ }
}

/** Payload observation happens before transport compression. Each HTTP attempt
 * gets its own ID and server request ID; reading diagnostics never consumes SSE. */
export function requestDiagnostics(
  context: Pick<RequestDiagnostic, 'provider' | 'model' | 'api' | 'mealId' | 'threadId'>,
  record: (event: RequestDiagnostic) => Promise<void>,
) {
  let payload: Pick<RequestDiagnostic, 'payloadSha256' | 'images' | 'captureError'> = {captureError: true};
  const save = async (requestId: string, phase: RequestDiagnostic['phase'], fields: Partial<RequestDiagnostic> = {}) => {
    try {
      await record({id: `${requestId}-${phase}`, createdAt: Date.now(), operation: 'ai_request', requestId, phase, ...context, ...fields});
    } catch { /* Diagnostic storage must never fail an AI request. */ }
  };
  return {
    async onPayload(value: unknown): Promise<void> {
      try {
        payload = {payloadSha256: await sha256(new TextEncoder().encode(JSON.stringify(value))), images: await payloadImages(value)};
      } catch { payload = {captureError: true}; }
    },
    wrapFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
      return async (input, init) => {
        const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
        await save(requestId, 'sent', payload);
        try {
          const response = await fetch(input, init);
          await save(requestId, 'received', {
            httpStatus: response.status,
            responseContentType: response.headers.get('content-type'),
            serverRequestId: response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined,
          });
          return response;
        } catch (error) {
          await save(requestId, 'failed');
          throw error;
        }
      };
    },
  };
}
