import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Enumerate explicitly so nested feature tests run on every shell and CI host.
const root = new URL('../', import.meta.url);
const files = readdirSync(new URL('src/', root), { recursive: true })
  .filter(name => name.endsWith('.test.ts'))
  .sort()
  .map(name => `src/${name}`);
if (!files.length) throw new Error('No test files found');
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: fileURLToPath(root), stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
