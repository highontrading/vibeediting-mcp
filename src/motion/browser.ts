import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { requireFfmpeg } from '../media/ffmpeg.js';
import { FONTS } from '../styles/presets.js';
import { fontsDir } from '../util/config.js';
import { UserError } from '../util/errors.js';
import { ensureDir } from '../util/fsx.js';
import { log } from '../util/log.js';
import { run, tailLines } from '../util/proc.js';
import { SHIM } from './browserShim.js';

type Browser = import('playwright-core').Browser;

let found: { label: string; launch: () => Promise<Browser> } | null = null;

export const BROWSER_HELP =
  'Custom animations need Google Chrome or Microsoft Edge on this computer (Edge comes with Windows). Install Chrome from https://www.google.com/chrome, then try again. Titles, lower thirds, counters, charts and checklists work without a browser.';

async function tryLaunch(
  label: string,
  opts: Record<string, unknown>,
): Promise<{ label: string; launch: () => Promise<Browser> } | null> {
  const { chromium } = await import('playwright-core');
  try {
    const b = await chromium.launch({ headless: true, timeout: 30000, ...opts });
    await b.close();
    return { label, launch: () => chromium.launch({ headless: true, timeout: 30000, ...opts }) };
  } catch (err) {
    log.debug(
      `browser ${label} not usable: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
    );
    return null;
  }
}

/** Find a Chromium-based browser we can drive: env override, Chrome, Edge, or Playwright's own. */
export async function findBrowser(): Promise<{ label: string; launch: () => Promise<Browser> } | null> {
  if (found) return found;
  const attempts: Array<[string, Record<string, unknown>]> = [];
  if (process.env.VIBE_BROWSER_PATH)
    attempts.push([
      `custom (${process.env.VIBE_BROWSER_PATH})`,
      { executablePath: process.env.VIBE_BROWSER_PATH },
    ]);
  attempts.push(['Google Chrome', { channel: 'chrome' }]);
  if (process.platform !== 'linux') attempts.push(['Microsoft Edge', { channel: 'msedge' }]);
  attempts.push(['Playwright Chromium', {}]);
  for (const [label, opts] of attempts) {
    const r = await tryLaunch(label, opts);
    if (r) {
      found = r;
      return r;
    }
  }
  return null;
}

function fontFaceCss(): string {
  const dir = fontsDir();
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const [full, f] of Object.entries(FONTS)) {
    const weight = /Black/.test(full)
      ? 900
      : /ExtraBold/.test(full)
        ? 800
        : /SemiBold/.test(full)
          ? 600
          : /Bold/.test(full)
            ? 700
            : /Medium/.test(full)
              ? 500
              : 400;
    const key = `${f.family}-${weight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(
      `@font-face{font-family:'${f.family}';src:url('${pathToFileURL(path.join(dir, f.file)).href}');font-weight:${weight};}`,
    );
  }
  return rules.join('\n');
}

export function wrapHtml(html: string, width: number, height: number): string {
  const head = `<meta charset="utf-8"><style>${fontFaceCss()}\nhtml,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent;}</style>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

export interface HtmlRenderOptions {
  html: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  outFile: string;
  signal?: AbortSignal;
  onProgress?: (f: number, msg: string) => void;
}

/** Render an HTML animation to a video with transparency (.mov, PNG codec). Returns a middle-frame PNG preview. */
export async function renderHtml(
  o: HtmlRenderOptions,
): Promise<{ file: string; preview: Buffer; browser: string; warnings: string[] }> {
  const b = await findBrowser();
  if (!b) throw new UserError(BROWSER_HELP);
  const { ffmpeg } = await requireFfmpeg();
  const W = Math.max(2, Math.round(o.width / 2) * 2);
  const H = Math.max(2, Math.round(o.height / 2) * 2);
  const frames = Math.max(1, Math.round(o.duration * o.fps));
  const work = await ensureDir(path.dirname(o.outFile));
  const htmlFile = o.outFile.replace(/\.mov$/i, '.html');
  await fs.writeFile(htmlFile, wrapHtml(o.html, W, H), 'utf8');

  const browser = await b.launch();
  const warnings: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => warnings.push(e.message));
    await page.addInitScript(SHIM);
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => (document as any).fonts?.ready);
    const stdin = new PassThrough();
    const tmp = `${o.outFile}.part.mov`;
    const ff = run(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f',
        'image2pipe',
        '-framerate',
        String(o.fps),
        '-c:v',
        'png',
        '-i',
        '-',
        '-c:v',
        'png',
        '-pix_fmt',
        'rgba',
        '-an',
        tmp,
      ],
      {
        input: stdin,
        cwd: work,
        signal: o.signal,
      },
    );
    let preview: Buffer | null = null;
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) break;
      const t = i / o.fps;
      await page.evaluate((tt) => (window as any).__vibeSeek(tt), t);
      const png = await page.screenshot({ type: 'png', omitBackground: true });
      if (i === Math.floor(frames / 2)) preview = png;
      if (!stdin.write(png)) await new Promise((r) => stdin.once('drain', r));
      if (i % 5 === 0) o.onProgress?.(i / frames, `Rendering animation frame ${i + 1} of ${frames}`);
    }
    stdin.end();
    const res = await ff;
    if (o.signal?.aborted) throw new UserError('Cancelled.');
    if (res.code !== 0) throw new UserError(`Could not encode the animation. ${tailLines(res.stderr, 3)}`);
    await fs.rename(tmp, o.outFile);
    const errs = await page.evaluate(() => (window as any).__vibeErrors as string[]);
    warnings.push(...errs);
    return {
      file: o.outFile,
      preview: preview ?? Buffer.alloc(0),
      browser: b.label,
      warnings: [...new Set(warnings)].slice(0, 5),
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
