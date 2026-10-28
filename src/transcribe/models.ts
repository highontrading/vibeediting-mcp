import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirs } from '../util/config.js';
import { UserError } from '../util/errors.js';
import { ensureDir, exists } from '../util/fsx.js';

export type ModelId = 'tiny' | 'base' | 'small' | 'medium' | 'turbo' | 'large';

export interface ModelSpec {
  id: ModelId;
  file: string;
  bytes: number;
  sha256: string;
  label: string;
  hindi: string;
}

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

export const MODELS: Record<ModelId, ModelSpec> = {
  tiny: {
    id: 'tiny',
    file: 'ggml-tiny-q5_1.bin',
    bytes: 32152673,
    sha256: '818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7',
    label: 'Tiny (32 MB). Only for quick tests.',
    hindi: 'poor',
  },
  base: {
    id: 'base',
    file: 'ggml-base-q5_1.bin',
    bytes: 59707625,
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
    label: 'Base (60 MB). Fast, English only in practice.',
    hindi: 'poor (often writes Hindi in Urdu script)',
  },
  small: {
    id: 'small',
    file: 'ggml-small-q5_1.bin',
    bytes: 190085487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    label: 'Small (190 MB). Good for English, fast on older computers.',
    hindi: 'okay',
  },
  medium: {
    id: 'medium',
    file: 'ggml-medium-q5_0.bin',
    bytes: 539212467,
    sha256: '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f',
    label: 'Medium (540 MB). Slower than turbo, rarely better.',
    hindi: 'good',
  },
  turbo: {
    id: 'turbo',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    bytes: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    label: 'Large v3 Turbo (574 MB). Best balance. Recommended for Hindi and Hinglish.',
    hindi: 'good',
  },
  large: {
    id: 'large',
    file: 'ggml-large-v3-q5_0.bin',
    bytes: 1081140203,
    sha256: 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1',
    label: 'Large v3 (1.1 GB). Most accurate, slowest.',
    hindi: 'best',
  },
};

export function isModelId(v: string): v is ModelId {
  return v in MODELS;
}

/** turbo on Apple Silicon / Windows / Linux with 8 GB+ RAM; small on Intel Macs or low-RAM computers. */
export function defaultModel(): ModelId {
  const env = process.env.VIBE_WHISPER_MODEL?.trim().toLowerCase();
  if (env && isModelId(env)) return env;
  const lowRam = os.totalmem() < 7.5 * 1024 ** 3;
  if (lowRam) return 'small';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'small';
  return 'turbo';
}

export function modelPath(id: ModelId): string {
  return path.join(dirs.models(), MODELS[id].file);
}

export async function isModelReady(id: ModelId): Promise<boolean> {
  try {
    const st = await fs.stat(modelPath(id));
    return st.size === MODELS[id].bytes;
  } catch {
    return false;
  }
}

async function hashFile(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

const downloads = new Map<ModelId, Promise<string>>();

/**
 * Download a model once into ~/.vibeediting/models, with resume and SHA-256 check.
 * onProgress gets a 0..1 fraction.
 */
export function ensureModel(
  id: ModelId,
  onProgress?: (f: number, msg: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const running = downloads.get(id);
  if (running) return running;
  const p = downloadModel(id, onProgress, signal).finally(() => downloads.delete(id));
  downloads.set(id, p);
  return p;
}

async function downloadModel(
  id: ModelId,
  onProgress?: (f: number, msg: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const spec = MODELS[id];
  const target = modelPath(id);
  if (await isModelReady(id)) return target;
  await ensureDir(path.dirname(target));
  const free = await freeBytes(path.dirname(target));
  if (free !== null && free < spec.bytes * 1.1) {
    throw new UserError(
      `Not enough free disk space to download the ${id} model (${Math.round(spec.bytes / 1048576)} MB needed). Free some space, or choose a smaller model like "small".`,
    );
  }
  const part = `${target}.part`;
  const base = process.env.VIBE_MODEL_BASE_URL?.replace(/\/?$/, '/') ?? HF;
  let start = (await exists(part)) ? (await fs.stat(part)).size : 0;
  if (start >= spec.bytes) start = 0;
  const headers: Record<string, string> = { 'user-agent': 'vibeediting-mcp' };
  if (start > 0) headers.range = `bytes=${start}-`;
  let res: Response;
  try {
    res = await fetch(base + spec.file, { headers, signal, redirect: 'follow' });
  } catch (err) {
    throw new UserError(
      `I could not download the speech model (${spec.file}). Check your internet connection and try again. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (res.status === 200) start = 0;
  else if (res.status !== 206)
    throw new UserError(`The speech model download failed (HTTP ${res.status}). Try again in a few minutes.`);
  if (!res.body) throw new UserError('The speech model download returned no data. Try again.');

  let done = start;
  const msg = (n: number) =>
    `Downloading ${id} speech model: ${Math.round(n / 1048576)} of ${Math.round(spec.bytes / 1048576)} MB (one time only)`;
  const counter = new TransformStreamCounter((n) => {
    done += n;
    onProgress?.(done / spec.bytes, msg(done));
  });
  await pipeline(
    Readable.fromWeb(res.body as any),
    counter.stream,
    createWriteStream(part, { flags: start > 0 ? 'a' : 'w' }),
    { signal },
  );
  onProgress?.(1, 'Checking the downloaded model');
  const digest = await hashFile(part);
  if (digest !== spec.sha256) {
    await fs.rm(part, { force: true });
    throw new UserError(
      'The downloaded speech model was damaged (checksum mismatch). I deleted it. Please try again.',
    );
  }
  await fs.rename(part, target);
  return target;
}

class TransformStreamCounter {
  readonly stream: Transform;
  constructor(onBytes: (n: number) => void) {
    this.stream = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        onBytes(chunk.length);
        cb(null, chunk);
      },
    });
  }
}

async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await fs.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export { freeBytes };
