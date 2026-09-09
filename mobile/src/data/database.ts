import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

const connection = openDatabaseSync('caldone.db');
let pending: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => undefined);
  return result;
}

type Queries = Pick<SQLiteDatabase, 'execAsync' | 'runAsync' | 'getFirstAsync' | 'getAllAsync'>;

// All repositories share this queue, including reads and single-statement writes:
// Expo caches the native connection, so otherwise they can join another caller's transaction.
export const database = new Proxy({} as Queries, {
  get(_target, property: keyof Queries) {
    return (...args: unknown[]) => enqueue(() => Reflect.apply(connection[property], connection, args));
  },
});

/** Use only the supplied connection inside the callback; queued calls would deadlock. */
export function transaction<T>(operation: (database: Queries) => Promise<T>): Promise<T> {
  return enqueue(async () => {
    await connection.execAsync('BEGIN IMMEDIATE');
    try {
      const result = await operation(connection);
      await connection.execAsync('COMMIT');
      return result;
    } catch (error) {
      try { await connection.execAsync('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  });
}
