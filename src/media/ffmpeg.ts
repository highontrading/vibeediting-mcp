import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envSetting } from '../util/config.js';
import { UserError } from '../util/errors.js';
import { log } from '../util/log.js';
import { run } from '../util/proc.js';
import {
  autoDownloadAllowed,
  downloadFfmpeg,
  downloadState,
  managedPaths,
  managedReady,
  platformKey,
} from './ffmpegDownload.js';

export interface FfmpegInfo {
  ffmpeg: string;
  ffprobe: string;
  version: string;
  /** libass: needed for captions and titles. */
  hasLibass: boolean;
  hasDrawtext: boolean;
  hasX264: boolean;
  filters: Set<string>;
}

const isWin = process.platform === 'win32';
const exe = (name: string) => (isWin ? `${name}.exe` : name);

export const INSTALL_HELP = {
  mac: 'On Mac run: brew install ffmpeg-full   (the plain "ffmpeg" Homebrew package has no caption support any more)',
  win: 'On Windows run: winget install Gyan.FFmpeg   then close and reopen your terminal and restart your AI app',
  linux: 'On Linux run: sudo apt install ffmpeg',
};

function installHelp(): string {
  if (process.platform === 'darwin') return INSTALL_HELP.mac;
  if (isWin) return INSTALL_HELP.win;
  return INSTALL_HELP.linux;
}

/** Folders where ffmpeg usually lives, in order of preference. */
export function candidateDirs(): string[] {
  const dirs: string[] = [];
  const envDir = process.env.VIBE_FFMPEG_PATH ? path.dirname(process.env.VIBE_FFMPEG_PATH) : null;
  if (envDir) dirs.push(envDir);
  if (process.platform === 'darwin') {
    // ffmpeg-full is keg-only: it is not on PATH, so look for it first.
    dirs.push('/opt/homebrew/opt/ffmpeg-full/bin', '/usr/local/opt/ffmpeg-full/bin');
  }
  for (const p of (process.env.PATH ?? '').split(path.delimiter)) if (p) dirs.push(p.replace(/^"|"$/g, ''));
  if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin');
  if (isWin) {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    dirs.push(path.join(local, 'Microsoft', 'WinGet', 'Links'));
    const pkgs = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of fs.readdirSync(pkgs)) {
        if (!/ffmpeg/i.test(d)) continue;
        const base = path.join(pkgs, d);
        for (const sub of fs.readdirSync(base)) dirs.push(path.join(base, sub, 'bin'));
      }
    } catch {
      /* winget not used */
    }
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    dirs.push(
      path.join(pf, 'ffmpeg', 'bin'),
      'C:\\ffmpeg\\bin',
      path.join(os.homedir(), 'scoop', 'shims'),
      'C:\\ProgramData\\chocolatey\\bin',
    );
  }
  if (process.platform === 'linux') dirs.push('/usr/bin', '/usr/local/bin', '/snap/bin');
  return [...new Set(dirs)];
}

async function inspect(ffmpeg: string, ffprobe: string): Promise<FfmpegInfo | null> {
  try {
    const v = await run(ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 15000 });
    if (v.code !== 0) return null;
    const version = /ffmpeg version (\S+)/.exec(v.stdout)?.[1] ?? 'unknown';
    const f = await run(ffmpeg, ['-hide_banner', '-filters'], { timeoutMs: 15000 });
    const filters = new Set<string>();
    for (const line of f.stdout.split('\n')) {
      const m = /^\s*[TSC.|]{2,3}\s+(\S+)\s+\S+->\S+/.exec(line);
      if (m) filters.add(m[1]);
    }
    const e = await run(ffmpeg, ['-hide_banner', '-encoders'], { timeoutMs: 15000 });
    return {
      ffmpeg,
      ffprobe,
      version,
      filters,
      hasLibass: filters.has('ass') && filters.has('subtitles'),
      hasDrawtext: filters.has('drawtext'),
      hasX264: /libx264/.test(e.stdout),
    };
  } catch {
    return null;
  }
}

let cached: Promise<FfmpegInfo | null> | null = null;

/** Find a working ffmpeg + ffprobe. Prefers a build with libass (captions). */
export function findFfmpeg(force = false): Promise<FfmpegInfo | null> {
  if (!cached || force) cached = locate();
  return cached;
}

async function locate(): Promise<FfmpegInfo | null> {
  if (process.env.VIBE_FFMPEG_PATH && process.env.VIBE_FFPROBE_PATH) {
    const info = await inspect(process.env.VIBE_FFMPEG_PATH, process.env.VIBE_FFPROBE_PATH);
    if (info) return info;
  }
  let fallback: FfmpegInfo | null = null;
  // VIBE_FFMPEG=managed: ignore FFmpeg installed elsewhere and use (or download) our own copy.
  const managedOnly = envSetting('VIBE_FFMPEG')?.toLowerCase() === 'managed';
  for (const dir of managedOnly ? [] : candidateDirs()) {
    const ff = path.join(dir, exe('ffmpeg'));
    const fp = path.join(dir, exe('ffprobe'));
    if (!fs.existsSync(ff) || !fs.existsSync(fp)) continue;
    const info = await inspect(ff, fp);
    if (!info) continue;
    if (usable(info)) {
      log.debug(`using ffmpeg ${info.version} at ${ff}`);
      return info;
    }
    fallback ??= info;
  }
  // Our own downloaded copy (has captions support).
  if (await managedReady()) {
    const m = managedPaths();
    const info = await inspect(m.ffmpeg, m.ffprobe);
    if (info) return info;
  }
  return fallback;
}

export function usable(info: FfmpegInfo | null): boolean {
  return !!info && info.hasLibass && info.hasX264;
}

/** Start downloading FFmpeg in the background if this computer has no usable one. */
export async function prefetchFfmpeg(): Promise<void> {
  try {
    if (usable(await findFfmpeg()) || !autoDownloadAllowed()) return;
    log.info('no FFmpeg with caption support found; downloading it in the background');
    await downloadFfmpeg();
    await findFfmpeg(true);
    log.info('FFmpeg downloaded');
  } catch (err) {
    log.error('background FFmpeg download failed', err);
  }
}

/**
 * A usable FFmpeg: the one on this computer, or our own copy (downloaded on first
 * use). Waits up to `waitMs` for a download in progress, then explains and asks to retry.
 */
export async function ensureFfmpeg(
  opts: { waitMs?: number; onProgress?: (f: number, msg: string) => void } = {},
): Promise<FfmpegInfo | null> {
  const found = await findFfmpeg();
  if (found && usable(found)) return found;
  if (!autoDownloadAllowed() || !platformKey()) return found;
  const waitMs = opts.waitMs ?? 25_000;
  const dl = downloadFfmpeg(opts.onProgress).then(() => findFfmpeg(true));
  const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), waitMs).unref());
  const r = await Promise.race([dl, timeout]);
  if (r === 'timeout') {
    dl.catch(() => undefined);
    const pct = Math.round(downloadState().fraction * 100);
    throw new UserError(
      `Getting ready: I am downloading the video tools vibeediting needs (FFmpeg, about 50 MB, one time only). ${pct}% done. Tell the user it takes a minute or two, then try again.`,
    );
  }
  return r;
}

/** ffmpeg info, or a friendly error telling the user how to install it. */
export async function requireFfmpeg(
  opts: { needLibass?: boolean; waitMs?: number } = {},
): Promise<FfmpegInfo> {
  let info = await findFfmpeg();
  if (!usable(info)) info = await ensureFfmpeg({ waitMs: opts.waitMs });
  if (!info) {
    // Maybe it was installed after we started: look again once.
    const again = await findFfmpeg(true);
    if (!again)
      throw new UserError(
        `FFmpeg is not installed (or I cannot find it). ${installHelp()}. Guide: https://vibeediting.app/docs/install-ffmpeg`,
      );
    info = again;
  }
  if (opts.needLibass && !info.hasLibass) {
    throw new UserError(
      `Your FFmpeg (${info.ffmpeg}) has no caption support (libass), so I cannot draw captions or titles. ${installHelp()}. Guide: https://vibeediting.app/docs/install-ffmpeg`,
    );
  }
  if (!info.hasX264) {
    throw new UserError(`Your FFmpeg (${info.ffmpeg}) cannot make MP4 (H.264) files. ${installHelp()}.`);
  }
  return info;
}
