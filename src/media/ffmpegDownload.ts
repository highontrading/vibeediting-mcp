import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { vibeHome } from '../util/config.js';
import { UserError } from '../util/errors.js';
import { ensureDir, exists } from '../util/fsx.js';

/**
 * FFmpeg 6.1.1 static builds with libass (captions), published on GitHub by the
 * ffmpeg-static project. GPL-3.0: we download them on the user's computer, we do
 * not ship them in our package. Source: https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz
 */
export const FFMPEG_BUILD = {
  version: '6.1.1',
  baseUrl: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/',
  sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz',
  licenseUrl: 'https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1',
};

export interface Asset {
  file: string;
  bytes: number;
  sha256: string;
}

export const ASSETS: Record<string, { ffmpeg: Asset; ffprobe: Asset }> = {
  'darwin-arm64': {
    ffmpeg: {
      file: 'ffmpeg-darwin-arm64.gz',
      bytes: 19246198,
      sha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
    },
    ffprobe: {
      file: 'ffprobe-darwin-arm64.gz',
      bytes: 19207077,
      sha256: 'd986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be',
    },
  },
  'darwin-x64': {
    ffmpeg: {
      file: 'ffmpeg-darwin-x64.gz',
      bytes: 25296431,
      sha256: '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106',
    },
    ffprobe: {
      file: 'ffprobe-darwin-x64.gz',
      bytes: 25239438,
      sha256: 'd4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186',
    },
  },
  'win32-x64': {
    ffmpeg: {
      file: 'ffmpeg-win32-x64.gz',
      bytes: 29581307,
      sha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
    },
    ffprobe: {
      file: 'ffprobe-win32-x64.gz',
      bytes: 29521644,
      sha256: 'f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d',
    },
  },
  'linux-x64': {
    ffmpeg: {
      file: 'ffmpeg-linux-x64.gz',
      bytes: 29354986,
      sha256: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
    },
    ffprobe: {
      file: 'ffprobe-linux-x64.gz',
      bytes: 29276839,
      sha256: '25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067',
    },
  },
  'linux-arm64': {
    ffmpeg: {
      file: 'ffmpeg-linux-arm64.gz',
      bytes: 25568691,
      sha256: '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0',
    },
    ffprobe: {
      file: 'ffprobe-linux-arm64.gz',
      bytes: 25493573,
      sha256: '2ab6aba60ee84412dff9188720703376cb4e7aaf7e0b5e43aa8249f2acae5bf8',
    },
  },
};

/** Windows on ARM runs the x64 build through Windows' built-in emulation. */
export function platformKey(platform = process.platform, arch = process.arch): string | null {
  const a = platform === 'win32' && arch === 'arm64' ? 'x64' : arch;
  const key = `${platform}-${a}`;
  return key in ASSETS ? key : null;
}

export function managedDir(): string {
  return path.join(vibeHome(), 'bin', `ffmpeg-${FFMPEG_BUILD.version}`);
}

export function managedPaths(platform = process.platform): { ffmpeg: string; ffprobe: string } {
  const exe = platform === 'win32' ? '.exe' : '';
  return {
    ffmpeg: path.join(managedDir(), `ffmpeg${exe}`),
    ffprobe: path.join(managedDir(), `ffprobe${exe}`),
  };
}

export function autoDownloadAllowed(): boolean {
  const v = process.env.VIBE_AUTO_DOWNLOAD?.trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no');
}

export async function managedReady(): Promise<boolean> {
  const p = managedPaths();
  return (await exists(p.ffmpeg)) && (await exists(p.ffprobe));
}

export interface DownloadState {
  running: boolean;
  fraction: number;
  error?: string;
}

const state: DownloadState = { running: false, fraction: 0 };
let current: Promise<{ ffmpeg: string; ffprobe: string }> | null = null;

export function downloadState(): DownloadState {
  return { ...state };
}

/** Download FFmpeg + ffprobe once (about 40-60 MB), verify the checksums, unpack. */
export function downloadFfmpeg(
  onProgress?: (f: number, msg: string) => void,
  opts: { baseUrl?: string; assets?: { ffmpeg: Asset; ffprobe: Asset } } = {},
): Promise<{ ffmpeg: string; ffprobe: string }> {
  if (current) return current;
  state.running = true;
  state.fraction = 0;
  state.error = undefined;
  current = doDownload(onProgress, opts)
    .then((r) => {
      state.fraction = 1;
      return r;
    })
    .catch((err) => {
      state.error = err instanceof Error ? err.message : String(err);
      throw err;
    })
    .finally(() => {
      state.running = false;
      current = null;
    });
  return current;
}

async function doDownload(
  onProgress: ((f: number, msg: string) => void) | undefined,
  opts: { baseUrl?: string; assets?: { ffmpeg: Asset; ffprobe: Asset } },
) {
  const key = platformKey();
  const assets = opts.assets ?? (key ? ASSETS[key] : undefined);
  if (!assets) {
    throw new UserError(
      `I cannot download FFmpeg for this computer (${process.platform} ${process.arch}). Please install FFmpeg yourself: https://vibeediting.app/docs/install-ffmpeg`,
    );
  }
  const base = (opts.baseUrl ?? process.env.VIBE_FFMPEG_BASE_URL ?? FFMPEG_BUILD.baseUrl).replace(
    /\/?$/,
    '/',
  );
  const dir = await ensureDir(managedDir());
  const out = managedPaths();
  const total = assets.ffmpeg.bytes + assets.ffprobe.bytes;
  let done = 0;
  const report = (n: number) => {
    done += n;
    state.fraction = Math.min(0.99, done / total);
    onProgress?.(
      state.fraction,
      `Downloading video tools (FFmpeg): ${Math.round(done / 1048576)} of ${Math.round(total / 1048576)} MB (one time only)`,
    );
  };
  for (const [name, asset] of [
    ['ffmpeg', assets.ffmpeg],
    ['ffprobe', assets.ffprobe],
  ] as const) {
    const target = out[name];
    if (await exists(target)) {
      report(asset.bytes);
      continue;
    }
    const tmp = path.join(dir, `.${name}.${process.pid}.part`);
    let res: Response;
    try {
      res = await fetch(base + asset.file, {
        redirect: 'follow',
        headers: { 'user-agent': 'vibeediting-mcp' },
      });
    } catch (err) {
      throw new UserError(
        `I could not download the video tools (FFmpeg). Check your internet connection and try again. (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (!res.ok || !res.body)
      throw new UserError(`Downloading FFmpeg failed (HTTP ${res.status}). Try again in a few minutes.`);
    const hash = createHash('sha256');
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        report(chunk.length);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(res.body as any),
        meter,
        createGunzip(),
        createWriteStream(tmp, { mode: 0o755 }),
      );
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw new UserError(
        `The FFmpeg download was interrupted. Try again. (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (hash.digest('hex') !== asset.sha256) {
      await fs.rm(tmp, { force: true });
      throw new UserError(
        'The downloaded FFmpeg did not match its checksum, so I deleted it. Please try again.',
      );
    }
    await fs.chmod(tmp, 0o755).catch(() => undefined);
    await fs.rename(tmp, target);
  }
  await fs.writeFile(
    path.join(dir, 'README.txt'),
    `FFmpeg ${FFMPEG_BUILD.version} downloaded by vibeediting from ${FFMPEG_BUILD.licenseUrl}\nFFmpeg is free software under the GNU GPL v3. Source code: ${FFMPEG_BUILD.sourceUrl}\n`,
  );
  onProgress?.(1, 'Video tools ready');
  return out;
}
