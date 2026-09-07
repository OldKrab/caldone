import { publicWebUrl } from '../domain/mealWebImage.ts';

const STOP_WORDS = new Set('the and with from food meal portion dish без для под или это порция блюдо еда'.split(' '));
const words = (value: string) => [...new Set(value.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}]{3,}/gu) ?? [])].filter(word => !STOP_WORDS.has(word));

/** Require descriptive overlap, not just a brand or one word from a long dish
 * name. This is a conservative label match, not visual recognition. */
export function matchesMeal(label: string, names: string[]): boolean {
  const labelWords = new Set(words(decodeHtml(label)));
  return names.some(name => {
    const wanted = words(name);
    const count = wanted.filter(word => labelWords.has(word)).length;
    return wanted.length > 0 && count >= Math.min(2, wanted.length) && count / wanted.length >= 0.7;
  });
}

export function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    const code = key.startsWith('&#x') ? parseInt(key.slice(3, -1), 16) : parseInt(key.slice(2, -1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** Only labelled images can be selected from a multi-product page. Lazy image
 * attributes precede src, which commonly contains a placeholder. */
export function matchingProductImage(html: string, sourceUrl: string, names: string[]): string | undefined {
  const body = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  for (const tag of body.match(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs.set(match[1].toLowerCase(), match[2] ?? match[3]);
    if (!matchesMeal(attrs.get('alt') || attrs.get('title') || '', names)) continue;
    const values = [attrs.get('data-src'), attrs.get('data-fancybox-src'), attrs.get('data-original'), attrs.get('src'), attrs.get('data-srcset')?.split(',')[0]?.trim().split(/\s+/)[0]];
    for (const value of values) {
      if (!value || /(?:logo|icon|placeholder|gray[_-]?bg)/i.test(value)) continue;
      try {
        const url = publicWebUrl(new URL(decodeHtml(value), sourceUrl).href);
        if (url) return url;
      } catch { /* A malformed optional image cannot block the meal. */ }
    }
  }
}
