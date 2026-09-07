import { parseMealAnalysis, type MealAnalysis } from '../domain/meal.ts';
import type { MealResearch } from '../domain/mealResearch.ts';
import { publicWebUrl, type MealWebImage } from '../domain/mealWebImage.ts';

const MAX_PAGE_BYTES = 256 * 1024;
const PAGE_TIMEOUT_MS = 3000;

/** The model selects a relevant cited page, but only its actual preview metadata
 * supplies the image URL. Artwork failure must never fail nutrition processing. */
export async function parseMealResult(
  result: { text: string; research?: MealResearch },
  hasUserPhotos: boolean,
  fetchPage?: typeof globalThis.fetch,
): Promise<MealAnalysis> {
  const analysis = { ...parseMealAnalysis(result.text), research: result.research };
  if (hasUserPhotos || result.research?.status !== 'completed') return analysis;
  const raw = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  const sourceUrl = publicWebUrl(raw.webImageSourceUrl);
  if (!sourceUrl || !result.research.sources.some(source => publicWebUrl(source.url) === sourceUrl)) return analysis;
  try {
    // Expo fetch provides streaming on native; stop after the page head/size cap.
    const fetch = fetchPage ?? (await import('expo/fetch')).fetch as typeof globalThis.fetch;
    const webImage = await fetchPreviewImage(sourceUrl, fetch);
    return webImage ? { ...analysis, webImage } : analysis;
  } catch { return analysis; }
}

async function fetchPreviewImage(sourceUrl: string, fetchPage: typeof globalThis.fetch): Promise<MealWebImage | undefined> {
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
      return undefined;
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
        if (/<\/head\s*>/i.test(html)) break;
      }
    } finally { await reader.cancel(); }
    const url = previewImageUrl(html.split(/<\/head\s*>/i)[0], sourceUrl);
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
      if (url && !candidates.has(name)) candidates.set(name, url);
    } catch { /* Invalid optional artwork is omitted. */ }
  }
  return candidates.get('og:image:secure_url') ?? candidates.get('og:image') ?? candidates.get('twitter:image') ?? candidates.get('twitter:image:src');
}
