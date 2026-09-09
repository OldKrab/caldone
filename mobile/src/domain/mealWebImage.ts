/** Illustrative web artwork is display metadata, never evidence of food eaten. */
export type MealWebImage = { url: string; sourceUrl: string };

/** Only public HTTPS names are eligible for automatic page/image requests. */
export function publicWebUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !host.includes('.') || /[^a-z0-9.-]/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|arpa)\.?$/.test(host)) return undefined;
    url.hash = '';
    return url.href;
  } catch { return undefined; }
}

/** Also validate restored metadata before a backup can cause remote requests. */
export function parseMealWebImage(value: unknown): MealWebImage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<MealWebImage>;
  const url = publicWebUrl(candidate.url);
  const sourceUrl = publicWebUrl(candidate.sourceUrl);
  return url && sourceUrl ? { url, sourceUrl } : undefined;
}

export function mealAnalysisEvidenceJson(analysis: unknown): string {
  return JSON.stringify(analysis, (key, value) => key === 'webImage' ? undefined : value);
}
