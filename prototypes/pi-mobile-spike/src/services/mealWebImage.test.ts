import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mealAnalysisEvidenceJson, publicWebUrl } from '../domain/mealWebImage.ts';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { parseMealResult, previewImageUrl } = await import('./mealWebImage.ts');
const { normalizeMealAnalysis } = await import('../domain/mealOperations.ts');
const { parseCalDoneBackup } = await import('../domain/backup.ts');

const sourceUrl = 'https://food.example.com/products/eggs';
const artwork = { url: 'https://cdn.example.com/eggs.jpg', sourceUrl };
const meal = { title: 'Eggs', mealType: 'breakfast', items: [{ name: 'Eggs', quantity: '2 eggs', calories: 140, protein: 12, carbs: 0, fat: 10 }], totals: { calories: 140, protein: 12, carbs: 0, fat: 10 } };
const result = { text: JSON.stringify({ ...meal, webImageSourceUrl: sourceUrl, webImage: { url: 'https://invented.example.com/fake.jpg', sourceUrl } }), research: { status: 'completed' as const, sources: [{ url: sourceUrl, title: 'Eggs' }] } };
const html = `<head><meta property="og:image" content="${artwork.url}"></head>`;
const page = (body = html) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

test('text research uses real cited page metadata, never model-authored image URLs', async () => {
  const analysis = await parseMealResult(result, false, async (url, init) => {
    assert.equal(url, sourceUrl);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    return page();
  });
  assert.deepEqual(analysis.webImage, artwork);
  assert.deepEqual(analysis.totals, meal.totals);
  assert.deepEqual(normalizeMealAnalysis(analysis).webImage, artwork);
  assert.ok(!mealAnalysisEvidenceJson(analysis).includes('eggs.jpg'));
  assert.ok(!mealAnalysisEvidenceJson(analysis).includes('webImage'));
});

test('user photos, missing search, and uncited candidate pages never trigger requests', async () => {
  const noFetch: typeof fetch = async () => { assert.fail('Must not fetch artwork'); };
  assert.equal((await parseMealResult(result, true, noFetch)).webImage, undefined);
  for (const status of ['not_searched', 'failed', 'unavailable', 'unobserved'] as const) {
    assert.equal((await parseMealResult({ ...result, research: { ...result.research, status } }, false, noFetch)).webImage, undefined);
  }
  assert.equal((await parseMealResult({ ...result, research: { status: 'completed', sources: [] } }, false, noFetch)).webImage, undefined);
  assert.equal((await parseMealResult({ text: JSON.stringify(meal), research: result.research }, false, noFetch)).webImage, undefined);
});

test('missing, non-HTML, oversized, and failed pages do not fail the meal', async () => {
  const cases: Array<typeof fetch> = [
    async () => page('<head><title>Eggs</title></head>'),
    async () => new Response(html, { status: 403 }),
    async () => new Response(html, { headers: { 'content-type': 'image/png' } }),
    async () => page(' '.repeat(256 * 1024) + html),
    async () => { throw new Error('Offline'); },
    async () => page('<head></head>' + html),
  ];
  for (const fetchPage of cases) {
    const analysis = await parseMealResult(result, false, fetchPage);
    assert.equal(analysis.webImage, undefined);
    assert.deepEqual(analysis.totals, meal.totals);
  }
});

test('a stalled artwork request is cancelled without losing nutrition', async () => {
  const analysis = await parseMealResult(result, false, async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }));
  assert.equal(analysis.webImage, undefined);
  assert.deepEqual(analysis.totals, meal.totals);
});

test('preview metadata handles attribute order, relative URLs and entities', () => {
  assert.equal(previewImageUrl(`<META content='/eggs.jpg?a=1&amp;b=2' PROPERTY='og:image'>`, sourceUrl), 'https://food.example.com/eggs.jpg?a=1&b=2');
  assert.equal(previewImageUrl(`<meta name="twitter:image" content="//cdn.example.com/eggs.jpg">`, sourceUrl), artwork.url);
  assert.equal(previewImageUrl(`<script>${html}</script><!--${html}-->`, sourceUrl), undefined);
  assert.equal(previewImageUrl(`<meta property="og:image" content="http://localhost/a.png">`, sourceUrl), undefined);
  assert.equal(previewImageUrl(`<img src="${artwork.url}">`, sourceUrl), undefined);
});

test('local, credentialed, non-HTTPS and malformed URLs are ineligible', () => {
  for (const url of ['file:///tmp/image.jpg', 'http://food.example.com/a', 'https://127.0.0.1/a', 'https://2130706433/a', 'https://[::1]/a', 'https://localhost/a', 'https://router.local/a', 'https://user:password@food.example.com/a', 'https://food.example.com:8443/a', 'invalid', null]) {
    assert.equal(publicWebUrl(url), undefined, String(url));
  }
});

test('backup retains display metadata without counting it as a user photo', async () => {
  const analysis = await parseMealResult(result, false, async () => page());
  const backup = { format: 'caldone-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), preferences: {}, meals: [{ id: 'm', revision: 1, capturedAt: 1, status: 'complete', photos: [], note: 'Two eggs', analysis }], conversations: [] };
  const restored = parseCalDoneBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(restored.meals[0].analysis?.webImage, artwork);
  assert.deepEqual(restored.meals[0].photos, []);
  backup.meals[0].analysis.webImage = { ...artwork, url: 'file:///tmp/private.jpg' };
  assert.equal(parseCalDoneBackup(backup).meals[0].analysis?.webImage, undefined);
});
