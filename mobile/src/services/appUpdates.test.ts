import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateChecker, selectRelease } from './appUpdates.ts';
import { createWorkLease } from './workLease.ts';

const asset = { name: 'caldone-1.3.0-arm64.apk', state: 'uploaded', size: 47_000_000,
  digest: `sha256:${'a'.repeat(64)}`,
  browser_download_url: 'https://github.com/OldKrab/caldone/releases/download/v1.3.0/caldone-1.3.0-arm64.apk' };
const release = { id: 13, tag_name: 'v1.3.0', name: 'Easier meal corrections', body: 'Correct a meal without starting over.',
  draft: false, prerelease: false, html_url: 'https://github.com/OldKrab/caldone/releases/tag/v1.3.0', assets: [asset] };

test('installer safety sees work immediately, before its foreground service has started', async () => {
  let finish!: () => void;
  const lease = createWorkLease(() => new Promise<void>(resolve => { finish = resolve; }), async () => {});
  const pending = lease.acquire();
  assert.equal(lease.busy(), true);
  await Promise.resolve();
  finish();
  const release = await pending;
  assert.equal(lease.busy(), true);
  await release();
  assert.equal(lease.busy(), false);
});

test('finds a newer stable ARM64 release, skipping previews and incomplete or untrusted assets', () => {
  const selected = selectRelease([
    { ...release, id: 14, prerelease: true },
    { ...release, assets: [{ ...asset, digest: null }] },
    { ...release, assets: [{ ...asset, browser_download_url: 'https://example.org/update.apk' }] },
    release,
  ], '1.2.9', ['arm64-v8a']);
  assert.equal(selected?.id, '13');
  assert.equal(selected?.title, 'Easier meal corrections');
  assert.equal(selectRelease([release], '1.3.0', ['arm64-v8a']), undefined);
  assert.equal(selectRelease([release], '1.4.0', ['arm64-v8a']), undefined);
  assert.equal(selectRelease([release], '1.2.9', ['x86_64']), undefined);
});

test('checks once across concurrent launches and process restarts within eight hours', async () => {
  let stored: string | null = null, calls = 0, now = 1_000_000;
  const dependencies = {
    installedVersion: '1.2.9', abis: ['arm64-v8a'], now: () => now,
    read: async () => stored, write: async (value: string) => { stored = value; },
    fetch: async () => { calls++; return new Response(JSON.stringify([release])); },
  };
  const checker = createUpdateChecker(dependencies);
  const results = await Promise.all([checker.check(), checker.check()]);
  assert.equal(calls, 1);
  assert.equal(results[0].release?.id, '13');
  await createUpdateChecker(dependencies).check();
  assert.equal(calls, 1);
  now += 8 * 60 * 60 * 1000;
  await createUpdateChecker(dependencies).check();
  assert.equal(calls, 2);
});

test('respects GitHub retry time even for manual checks, and offline attempts are throttled', async () => {
  let stored: string | null = null, calls = 0, now = 1_000_000;
  const checker = createUpdateChecker({
    installedVersion: '1.2.9', abis: ['arm64-v8a'], now: () => now,
    read: async () => stored, write: async value => { stored = value; },
    fetch: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '3600' } }); },
  });
  assert.equal((await checker.check()).error, 'rateLimit');
  now += 120_000;
  await checker.check(true);
  assert.equal(calls, 1);
  now += 3_600_000;
  await checker.check(true);
  assert.equal(calls, 2);
});

test('a successful upgrade cannot offer the cached equal-version release again', async () => {
  let stored = JSON.stringify({ checkedAt: 1_000_000, retryAt: 0, release: selectRelease([release], '1.2.9', ['arm64-v8a']) });
  const checker = createUpdateChecker({ installedVersion: '1.3.0', abis: ['arm64-v8a'], now: () => 1_001_000,
    read: async () => stored, write: async value => { stored = value; },
    fetch: async () => { throw new Error('must use recent cache'); },
  });
  assert.equal((await checker.check()).release, undefined);
});
