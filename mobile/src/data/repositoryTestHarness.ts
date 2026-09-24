import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Run the actual repositories against SQLite; only the Expo native bridge is replaced.
export function repositories() {
  const sqlite = new DatabaseSync(':memory:');
  const bridge = {
    async execAsync(sql: string) { sqlite.exec(sql); },
    async runAsync(sql: string, ...args: any[]) { return sqlite.prepare(sql).run(...args); },
    async getFirstAsync(sql: string, ...args: any[]) { return sqlite.prepare(sql).get(...args); },
    async getAllAsync(sql: string, ...args: any[]) { return sqlite.prepare(sql).all(...args); },
  };
  const cache = new Map<string, any>();
  const nativeRequire = createRequire(import.meta.url);
  function load(path: string): any {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const js = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(js, { exports, require(name: string) {
      if (name === 'expo-sqlite') return { openDatabaseSync: () => bridge };
      if (name === 'expo-file-system') return {};
      if (name.startsWith('.')) return load(resolve(dirname(path), name.endsWith('.ts') ? name : name + '.ts'));
      return nativeRequire(name);
    }, Date, Math, Set, Map, console, queueMicrotask });
    return exports;
  }
  return { chat: load(resolve(import.meta.dirname, 'chatRepository.ts')), sqlite, load };
}

