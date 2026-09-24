import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Android autolinking compiles the patched camera instead of loading the stock binary', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const resolved = JSON.parse(execFileSync(process.execPath, [
    'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js',
    'resolve', '--platform', 'android', '--json',
  ], { cwd: root, encoding: 'utf8' }));
  assert.ok(resolved.configuration?.buildFromSource?.includes('expo-camera'),
    'The native lens adapter is absent from stock expo-camera binaries');
});
