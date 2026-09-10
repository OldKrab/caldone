export type AppRelease = {
  id: string; version: string; title: string; notes: string; url: string;
  downloadUrl: string; size: number; sha256: string;
};

const repository = 'https://github.com/OldKrab/caldone/releases/';
const checkInterval = 8 * 60 * 60 * 1000;
export type UpdateCheck = { checkedAt: number; retryAt: number; release?: AppRelease; error?: 'network' | 'rateLimit' };

/** One request owner per app process; persist attempts before networking so
 * process death, offline launches and repeated taps cannot create a retry loop. */
export function createUpdateChecker(deps: {
  installedVersion: string; abis: string[]; now: () => number;
  read: () => Promise<string | null>; write: (value: string) => Promise<void>;
  fetch: typeof fetch;
}) {
  let pending: Promise<UpdateCheck> | undefined;
  async function run(manual: boolean): Promise<UpdateCheck> {
    let previous: UpdateCheck = { checkedAt: 0, retryAt: 0 };
    try {
      const value = JSON.parse(await deps.read() ?? 'null');
      if (value && Number.isFinite(value.checkedAt) && Number.isFinite(value.retryAt)) previous = value;
    } catch { /* A missing or damaged cache must not prevent a fresh check. */ }
    if (previous.release && (typeof previous.release.version !== 'string'
      || !newer(previous.release.version, deps.installedVersion))) previous.release = undefined;
    const now = deps.now();
    if (previous.checkedAt > 0 && now >= previous.checkedAt
      && (now < previous.retryAt || now - previous.checkedAt < (manual ? 60_000 : checkInterval))) return previous;
    const result: UpdateCheck = { checkedAt: now, retryAt: 0, release: previous.release };
    await deps.write(JSON.stringify(result));
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15_000);
    try {
      // Public endpoint; this transport never receives AI credentials or user data.
      const response = await deps.fetch('https://api.github.com/repos/OldKrab/caldone/releases?per_page=20', {
        signal: abort.signal, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (response.status === 403 || response.status === 429) {
        const retry = Number(response.headers.get('retry-after')) * 1000;
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        result.retryAt = Math.max(now + 60_000, now + (Number.isFinite(retry) ? retry : 0), Number.isFinite(reset) ? reset : 0);
        result.error = 'rateLimit';
        throw new Error('rateLimit');
      }
      if (!response.ok) throw new Error('network');
      const body = await response.text();
      if (body.length > 1_000_000) throw new Error('network');
      result.release = selectRelease(JSON.parse(body), deps.installedVersion, deps.abis);
    } catch {
      result.error ??= 'network';
      result.release = previous.release;
    } finally { clearTimeout(timeout); }
    await deps.write(JSON.stringify(result));
    return result;
  }
  return { check(manual = false) {
    if (!pending) pending = run(manual).finally(() => { pending = undefined; });
    return pending;
  } };
}
const versionParts = (value: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
function newer(candidate: string, installed: string) {
  const a = versionParts(candidate), b = versionParts(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

/** Release names only discover candidates. Android verifies the downloaded APK's
 * actual package, signer, SDK, ABI and versionCode before installer handoff. */
export function selectRelease(value: unknown, installedVersion: string, abis: string[]): AppRelease | undefined {
  if (!Array.isArray(value) || !abis.includes('arm64-v8a')) return;
  const candidates: AppRelease[] = [];
  for (const entry of value) {
    if (!entry || entry.draft !== false || entry.prerelease !== false || !Number.isSafeInteger(entry.id)
      || typeof entry.tag_name !== 'string' || !newer(entry.tag_name, installedVersion) || !Array.isArray(entry.assets)) continue;
    const version = entry.tag_name.replace(/^v/, '');
    const downloadUrl = `${repository}download/${entry.tag_name}/caldone-${version}-arm64.apk`;
    const matches = entry.assets.filter((asset: Record<string, unknown>) => asset?.name === `caldone-${version}-arm64.apk`
      && asset.state === 'uploaded' && asset.browser_download_url === downloadUrl
      && Number.isSafeInteger(asset.size) && Number(asset.size) > 0 && Number(asset.size) <= 512 * 1024 * 1024
      && typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest));
    if (matches.length !== 1) continue;
    const asset = matches[0];
    const body = typeof entry.body === 'string' ? entry.body : '';
    const heading = /^# ([^\n]+)\n/.exec(body)?.[1];
    const title = heading ?? (typeof entry.name === 'string' && !versionParts(entry.name) ? entry.name : '');
    // Display the authored opening; never invent or machine-summarize release claims.
    const notes = body.replace(/^# [^\n]+\n+/, '').split(/\n## /)[0]!
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|`/g, '').trim();
    candidates.push({ id: String(entry.id), version, title: title.slice(0, 100),
      notes: notes.length > 700 ? `${notes.slice(0, 697)}…` : notes,
      url: `${repository}tag/${entry.tag_name}`, downloadUrl, size: asset.size, sha256: asset.digest.slice(7) });
  }
  return candidates.sort((a, b) => newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0)[0];
}
