import { matchingProductImage, matchesMeal } from './mealImagePage.ts';
import { parseMealAnalysis, type MealAnalysis } from '../domain/meal.ts';
import type { MealResearch } from '../domain/mealResearch.ts';
import { publicWebUrl, type MealWebImage } from '../domain/mealWebImage.ts';

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 3000;

export type ImageLookupEvent = {
  outcome: 'user_photos' | 'not_searched' | 'no_sources' | 'fetch_failed' | 'no_match' | 'found';
  sourceHost?: string;
  durationMs: number;
};

/** Observed search sources supply candidate pages; actual page markup
 * supplies the image URL. Artwork failure must never fail nutrition processing. */
export async function parseMealResult(
  result: { text: string; research?: MealResearch },
  hasUserPhotos: boolean,
  fetchPage?: typeof globalThis.fetch,
  onLookup?: (event: ImageLookupEvent) => void,
): Promise<MealAnalysis> {
  const analysis = { ...parseMealAnalysis(result.text), research: result.research };
  const startedAt = Date.now();
  const report = (outcome: ImageLookupEvent['outcome'], sourceUrl?: string) => {
    try { onLookup?.({ outcome, ...(sourceUrl ? { sourceHost: new URL(sourceUrl).hostname } : {}), durationMs: Date.now() - startedAt }); }
    catch { /* Diagnostics cannot affect a saved meal. */ }
  };
  if (hasUserPhotos) { report('user_photos'); return analysis; }
  if (result.research?.status !== 'completed') { report('not_searched'); return analysis; }
  const raw = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  const names = [analysis.title, ...analysis.items.map(item => item.name)];
  const observed = new Set(result.research.sources.map(source => publicWebUrl(source.url)).filter((url): url is string => Boolean(url)));
  const hinted = [raw.webImageSourceUrl, ...(Array.isArray(raw.webImageSourceUrls) ? raw.webImageSourceUrls.slice(0, 3) : [])]
    .map(publicWebUrl).filter((url): url is string => Boolean(url && observed.has(url)));
  const relevant = result.research.sources.filter(source => matchesMeal(source.title, names))
    .map(source => publicWebUrl(source.url)).filter((url): url is string => Boolean(url));
  // Three sequential, individually bounded requests keep a broken source from
  // defeating the lookup without allowing an unbounded background crawl.
  const candidates = [...new Set([...hinted, ...relevant, ...observed])].slice(0, 3);
  if (!candidates.length) { report('no_sources'); return analysis; }
  try {
    const fetch = fetchPage ?? (await import('expo/fetch')).fetch as typeof globalThis.fetch;
    for (const sourceUrl of candidates) {
      try {
        const webImage = await fetchPreviewImage(sourceUrl, fetch, names, hinted.includes(sourceUrl) || relevant.includes(sourceUrl));
        if (webImage) { report('found', sourceUrl); return { ...analysis, webImage }; }
        report('no_match', sourceUrl);
      } catch { report('fetch_failed', sourceUrl); }
    }
  } catch { report('fetch_failed'); }
  return analysis;
}

async function fetchPreviewImage(sourceUrl: string, fetchPage: typeof globalThis.fetch, names: string[], allowPreview: boolean): Promise<MealWebImage | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    // No app credentials, cookies, or redirects to unvalidated destinations.
    const response = await fetchPage(sourceUrl, {
      signal: controller.signal, redirect: 'error', credentials: 'omit',
      headers: { Accept: 'text/html' },
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel();
      throw new Error('Image source did not return an HTML page');
    }
    const reader = response.body?.getReader();
    if (!reader) return undefined;
    const decoder = new TextDecoder();
    let html = '';
    let bytes = 0;
    try {
      while (bytes < MAX_PAGE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value.subarray(0, MAX_PAGE_BYTES - bytes), { stream: true });
        bytes += value.byteLength;
      }
    } finally { await reader.cancel(); }
    const url = matchingProductImage(html, sourceUrl, names) ?? (allowPreview ? previewImageUrl(html.split(/<\/head\s*>/i)[0], sourceUrl) : undefined);
    return url ? { url, sourceUrl } : undefined;
  } finally { clearTimeout(timeout); }
}

/** Read quoted HTML metadata, not arbitrary img tags, scripts or page text. */
export function previewImageUrl(html: string, sourceUrl: string): string | undefined {
  const candidates = new Map<string, string>();
  const head = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  for (const tag of head.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3]);
    }
    const name = (attributes.get('property') ?? attributes.get('name'))?.toLowerCase();
    const content = attributes.get('content');
    if (!name || !content || !['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'].includes(name)) continue;
    try {
      const decoded = content.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
        const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
        const key = entity.toLowerCase();
        if (named[key]) return named[key];
        const code = key.startsWith('&#x') ? parseInt(key.slice(3, -1), 16) : parseInt(key.slice(2, -1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      });
      const url = publicWebUrl(new URL(decoded, sourceUrl).href);
      if (url && !/(?:logo|icon|placeholder|gray[_-]?bg)/i.test(url) && !candidates.has(name)) candidates.set(name, url);
    } catch { /* Invalid optional artwork is omitted. */ }
  }
  return candidates.get('og:image:secure_url') ?? candidates.get('og:image') ?? candidates.get('twitter:image') ?? candidates.get('twitter:image:src');
}
