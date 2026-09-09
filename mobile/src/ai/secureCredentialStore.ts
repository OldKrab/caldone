import type {
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';
import * as SecureStore from 'expo-secure-store';

const KEY_PREFIX = 'caldone.ai.credentials';
const INDEX_KEY = `${KEY_PREFIX}.index`;

// SecureStore values can be rejected around 2 KiB on some iOS versions. OAuth
// credentials are therefore split into independently encrypted chunks.
const CHUNK_SIZE = 1_800;

type CredentialIndex = Record<string, { chunks: number; type: Credential['type'] }>;

function providerKey(providerId: string): string {
  return providerId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function chunkKey(providerId: string, index: number): string {
  return `${KEY_PREFIX}.${providerKey(providerId)}.${index}`;
}

async function readIndex(): Promise<CredentialIndex> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  return raw ? (JSON.parse(raw) as CredentialIndex) : {};
}

async function writeIndex(index: CredentialIndex): Promise<void> {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(index));
}

async function readCredential(
  providerId: string,
  index: CredentialIndex,
): Promise<Credential | undefined> {
  const metadata = index[providerId];
  if (!metadata) return undefined;

  const chunks = await Promise.all(
    Array.from({ length: metadata.chunks }, (_, chunkIndex) =>
      SecureStore.getItemAsync(chunkKey(providerId, chunkIndex)),
    ),
  );

  if (chunks.some((chunk) => chunk === null)) {
    throw new Error(`Credential ${providerId} is missing an encrypted chunk`);
  }

  return JSON.parse(chunks.join('')) as Credential;
}

/**
 * Native CredentialStore implementation for CalDone.
 *
 * The store keeps Pi's tokens in Android Keystore/iOS Keychain-backed storage,
 * and serializes refresh writes per provider as required by Pi's public store
 * contract. It deliberately contains no UI or provider-specific behavior so it
 * can later move into the shared AI library.
 */
export class SecureCredentialStore implements CredentialStore {
  private readonly pending = new Map<string, Promise<unknown>>();

  async read(providerId: string): Promise<Credential | undefined> {
    return readCredential(providerId, await readIndex());
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const index = await readIndex();
    return Object.entries(index).map(([providerId, metadata]) => ({
      providerId,
      type: metadata.type,
    }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const previous = this.pending.get(providerId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const index = await readIndex();
      const current = await readCredential(providerId, index);
      const next = await fn(current);
      if (!next) return current;

      const serialized = JSON.stringify(next);
      const chunks = Array.from(
        { length: Math.ceil(serialized.length / CHUNK_SIZE) },
        (_, chunkIndex) =>
          serialized.slice(chunkIndex * CHUNK_SIZE, (chunkIndex + 1) * CHUNK_SIZE),
      );

      await Promise.all(
        chunks.map((chunk, chunkIndex) =>
          SecureStore.setItemAsync(chunkKey(providerId, chunkIndex), chunk),
        ),
      );

      const oldChunkCount = index[providerId]?.chunks ?? 0;
      index[providerId] = { chunks: chunks.length, type: next.type };
      await writeIndex(index);

      await Promise.all(
        Array.from(
          { length: Math.max(0, oldChunkCount - chunks.length) },
          (_, offset) =>
            SecureStore.deleteItemAsync(
              chunkKey(providerId, chunks.length + offset),
            ),
        ),
      );

      return next;
    });

    this.pending.set(providerId, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(providerId) === operation) {
        this.pending.delete(providerId);
      }
    }
  }

  async delete(providerId: string): Promise<void> {
    const previous = this.pending.get(providerId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const index = await readIndex();
      const chunkCount = index[providerId]?.chunks ?? 0;

      await Promise.all(
        Array.from({ length: chunkCount }, (_, chunkIndex) =>
          SecureStore.deleteItemAsync(chunkKey(providerId, chunkIndex)),
        ),
      );

      delete index[providerId];
      await writeIndex(index);
    });

    this.pending.set(providerId, operation);
    try {
      await operation;
    } finally {
      if (this.pending.get(providerId) === operation) {
        this.pending.delete(providerId);
      }
    }
  }
}
