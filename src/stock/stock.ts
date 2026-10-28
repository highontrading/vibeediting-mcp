import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirs, envSetting } from '../util/config.js';
import { UserError } from '../util/errors.js';
import { ensureDir, exists, readJson, sha256, writeJson } from '../util/fsx.js';

export type Provider = 'pexels' | 'pixabay';

export interface StockClip {
  ref: string;
  provider: Provider;
  id: string;
  duration: number;
  width: number;
  height: number;
  author: string;
  authorUrl: string;
  pageUrl: string;
  thumbnail: string;
  description: string;
  files: Array<{ url: string; width: number; height: number }>;
}

export const LICENSES: Record<Provider, { name: string; url: string }> = {
  pexels: {
    name: 'Pexels License (free to use; credit appreciated)',
    url: 'https://www.pexels.com/license/',
  },
  pixabay: {
    name: 'Pixabay Content License (free to use)',
    url: 'https://pixabay.com/service/license-summary/',
  },
};

export function stockKeys(): Record<Provider, string | undefined> {
  return {
    pexels: envSetting('PEXELS_API_KEY'),
    pixabay: envSetting('PIXABAY_API_KEY'),
  };
}

export const STOCK_HELP =
  'To search free stock videos, add a free API key to the vibeediting MCP settings: PEXELS_API_KEY (get one at https://www.pexels.com/api/) and/or PIXABAY_API_KEY (https://pixabay.com/api/docs/). Then restart your AI app.';

async function cachedJson(url: string, headers: Record<string, string>, provider: Provider): Promise<any> {
  // Pixabay asks API users to cache results for 24 hours. We do it for both.
  const file = path.join(dirs.cache(), 'stock', `${sha256(url).slice(0, 20)}.json`);
  const hit = await readJson<{ at: number; body: any }>(file);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.body;
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new UserError(`I could not reach ${provider}. Check your internet connection.`);
  }
  if (res.status === 401 || res.status === 403)
    throw new UserError(
      `${provider} rejected the API key. Check ${provider === 'pexels' ? 'PEXELS_API_KEY' : 'PIXABAY_API_KEY'} in your MCP settings.`,
    );
  if (res.status === 429)
    throw new UserError(
      `${provider} says too many searches. Wait a few minutes (free keys allow about ${provider === 'pexels' ? '200 per hour' : '100 per minute'}).`,
    );
  if (!res.ok) throw new UserError(`${provider} search failed (HTTP ${res.status}).`);
  const body = await res.json();
  await writeJson(file, { at: Date.now(), body });
  return body;
}

function slugWords(url: string): string {
  const m = /\/video\/([a-z0-9-]+?)-\d+\/?$/.exec(url);
  return m ? m[1].replace(/-/g, ' ') : '';
}

export async function searchPexels(
  query: string,
  opts: { orientation?: string; perPage: number; minDuration?: number },
): Promise<StockClip[]> {
  const key = stockKeys().pexels;
  if (!key) return [];
  const params = new URLSearchParams({ query, per_page: String(opts.perPage), size: 'medium' });
  if (opts.orientation && opts.orientation !== 'any') params.set('orientation', opts.orientation);
  if (opts.minDuration) params.set('min_duration', String(Math.floor(opts.minDuration)));
  const base = process.env.VIBE_PEXELS_URL ?? 'https://api.pexels.com';
  const j = await cachedJson(`${base}/videos/search?${params}`, { authorization: key }, 'pexels');
  return (j.videos ?? []).map((v: any) => ({
    ref: `pexels:${v.id}`,
    provider: 'pexels' as const,
    id: String(v.id),
    duration: Number(v.duration) || 0,
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    author: v.user?.name ?? 'Unknown',
    authorUrl: v.user?.url ?? '',
    pageUrl: v.url ?? '',
    thumbnail: v.image ?? '',
    description: slugWords(v.url ?? ''),
    files: (v.video_files ?? [])
      .filter((f: any) => f.link && (f.file_type ?? '').includes('mp4'))
      .map((f: any) => ({ url: f.link, width: Number(f.width) || 0, height: Number(f.height) || 0 })),
  }));
}

export async function searchPixabay(
  query: string,
  opts: { orientation?: string; perPage: number; minDuration?: number },
): Promise<StockClip[]> {
  const key = stockKeys().pixabay;
  if (!key) return [];
  const params = new URLSearchParams({
    key,
    q: query.slice(0, 100),
    per_page: String(Math.max(3, opts.perPage)),
    safesearch: 'true',
  });
  const base = process.env.VIBE_PIXABAY_URL ?? 'https://pixabay.com';
  const j = await cachedJson(`${base}/api/videos/?${params}`, {}, 'pixabay');
  let clips: StockClip[] = (j.hits ?? []).map((h: any) => {
    const sizes = ['large', 'medium', 'small', 'tiny'].map((k) => h.videos?.[k]).filter((x: any) => x?.url);
    const big = sizes[0] ?? {};
    return {
      ref: `pixabay:${h.id}`,
      provider: 'pixabay' as const,
      id: String(h.id),
      duration: Number(h.duration) || 0,
      width: Number(big.width) || 0,
      height: Number(big.height) || 0,
      author: h.user ?? 'Unknown',
      authorUrl: h.user_id ? `https://pixabay.com/users/${h.user}-${h.user_id}/` : '',
      pageUrl: h.pageURL ?? '',
      thumbnail: h.videos?.medium?.thumbnail ?? h.videos?.small?.thumbnail ?? '',
      description: h.tags ?? '',
      files: sizes.map((s: any) => ({
        url: s.url,
        width: Number(s.width) || 0,
        height: Number(s.height) || 0,
      })),
    };
  });
  if (opts.orientation === 'portrait') clips = clips.filter((c) => c.height > c.width);
  if (opts.orientation === 'landscape') clips = clips.filter((c) => c.width > c.height);
  if (opts.minDuration) clips = clips.filter((c) => c.duration >= opts.minDuration!);
  return clips;
}

const lastResults = new Map<string, StockClip>();

export async function searchStock(
  query: string,
  opts: { provider: Provider | 'both'; orientation?: string; perPage?: number; minDuration?: number },
): Promise<StockClip[]> {
  const keys = stockKeys();
  if (!keys.pexels && !keys.pixabay) throw new UserError(STOCK_HELP);
  const perPage = Math.max(1, Math.min(15, opts.perPage ?? 6));
  const tasks: Array<Promise<StockClip[]>> = [];
  if ((opts.provider === 'pexels' || opts.provider === 'both') && keys.pexels)
    tasks.push(searchPexels(query, { ...opts, perPage }));
  if ((opts.provider === 'pixabay' || opts.provider === 'both') && keys.pixabay)
    tasks.push(searchPixabay(query, { ...opts, perPage }));
  if (tasks.length === 0) throw new UserError(`No API key for ${opts.provider}. ${STOCK_HELP}`);
  const lists = await Promise.all(tasks);
  const merged: StockClip[] = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++)
    for (const l of lists) if (l[i]) merged.push(l[i]);
  for (const c of merged) lastResults.set(c.ref, c);
  return merged.slice(0, perPage * tasks.length);
}

/** Pick the rendition closest to the output size (avoid 4K: big and slow). */
export function pickFile(c: StockClip, target: number): { url: string; width: number; height: number } {
  if (c.files.length === 0) throw new UserError(`No downloadable file for ${c.ref}.`);
  const scored = c.files.map((f) => ({
    f,
    d:
      Math.abs(Math.max(f.width, f.height) - target) +
      (Math.max(f.width, f.height) < target * 0.6 ? 5000 : 0),
  }));
  scored.sort((a, b) => a.d - b.d);
  return scored[0].f;
}

export interface Credit {
  file: string;
  provider: Provider;
  id: string;
  author: string;
  authorUrl: string;
  pageUrl: string;
  license: string;
  licenseUrl: string;
  downloadedAt: string;
}

/** Download a stock clip into <projectDir>/broll and record it in broll/credits.json. */
export async function downloadStock(
  ref: string,
  projectDir: string,
  target: number,
  signal?: AbortSignal,
): Promise<{ file: string; clip: StockClip; credit: Credit }> {
  const clip = lastResults.get(ref);
  if (!clip)
    throw new UserError(
      `I do not have "${ref}" from a recent search. Run search_stock_footage first, then use one of its ids (like pexels:12345).`,
    );
  const dir = await ensureDir(path.join(projectDir, 'broll'));
  const file = path.join(dir, `${clip.provider}-${clip.id}.mp4`);
  if (!(await exists(file))) {
    const f = pickFile(clip, target);
    const res = await fetch(f.url, { signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new UserError(`Downloading ${ref} failed (HTTP ${res.status}).`);
    const tmp = `${file}.part`;
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp), { signal });
    await fs.rename(tmp, file);
  }
  const lic = LICENSES[clip.provider];
  const credit: Credit = {
    file: path.basename(file),
    provider: clip.provider,
    id: clip.id,
    author: clip.author,
    authorUrl: clip.authorUrl,
    pageUrl: clip.pageUrl,
    license: lic.name,
    licenseUrl: lic.url,
    downloadedAt: new Date().toISOString(),
  };
  const creditsFile = path.join(dir, 'credits.json');
  const all = (await readJson<Credit[]>(creditsFile)) ?? [];
  await writeJson(creditsFile, [...all.filter((c) => c.file !== credit.file), credit]);
  return { file, clip, credit };
}

export function rememberForTest(c: StockClip): void {
  lastResults.set(c.ref, c);
}
