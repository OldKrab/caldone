import * as ExpoCrypto from 'expo-crypto';

type PartialCrypto = {
  getRandomValues?: Crypto['getRandomValues'];
  subtle?: Partial<SubtleCrypto>;
};

type MutableGlobal = Omit<typeof globalThis, 'crypto'> & {
  crypto?: PartialCrypto;
};

/** Install only the Web Crypto surface used by Pi's device-code PKCE flow. */
export function installPiMobileRuntime(): void {
  const signal = new AbortController().signal;
  if (typeof signal.throwIfAborted !== 'function') {
    Object.defineProperty(Object.getPrototypeOf(signal), 'throwIfAborted', {
      configurable: true,
      value(this: AbortSignal) {
        if (!this.aborted) return;
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      },
    });
  }

  const root = globalThis as unknown as MutableGlobal;
  const currentCrypto = root.crypto;

  if (currentCrypto?.getRandomValues && currentCrypto.subtle?.digest) return;

  const subtle = {
    ...(currentCrypto?.subtle ?? {}),
    digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
      if (name.toUpperCase().replace('-', '') !== 'SHA256') {
        throw new Error(`Unsupported mobile digest algorithm: ${name}`);
      }
      return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
    },
  } as SubtleCrypto;

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      ...(currentCrypto ?? {}),
      getRandomValues: ExpoCrypto.getRandomValues,
      subtle,
    } as Crypto,
  });
}

export type RuntimeCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export async function checkPiMobileRuntime(): Promise<RuntimeCheck[]> {
  const checks: RuntimeCheck[] = [];
  const record = (name: string, ok: boolean, detail: string) =>
    checks.push({ name, ok, detail });

  record('atob / btoa', typeof atob === 'function' && typeof btoa === 'function',
    `${typeof atob} / ${typeof btoa}`);
  record('TextEncoder', typeof TextEncoder === 'function', typeof TextEncoder);
  record('AbortController', typeof AbortController === 'function', typeof AbortController);
  record(
    'AbortSignal.throwIfAborted',
    typeof new AbortController().signal.throwIfAborted === 'function',
    typeof new AbortController().signal.throwIfAborted,
  );
  record('ReadableStream', typeof ReadableStream === 'function', typeof ReadableStream);
  record('crypto.getRandomValues', typeof crypto?.getRandomValues === 'function',
    typeof crypto?.getRandomValues);

  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('caldone'),
    );
    record('crypto.subtle.digest', digest.byteLength === 32, `${digest.byteLength} bytes`);
  } catch (error) {
    record('crypto.subtle.digest', false, String(error));
  }

  return checks;
}
