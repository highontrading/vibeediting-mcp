import { createRequire } from 'node:module';
import os from 'node:os';
import { UserError } from '../util/errors.js';
import { log } from '../util/log.js';
import { type ModelId, modelPath } from './models.js';
import { arabicShare, type RawToken, type Word, wordsFromTokens } from './words.js';

interface WhisperCtx {
  transcribeFile(
    file: string,
    opts: Record<string, unknown>,
  ): {
    stop: () => Promise<void>;
    promise: Promise<{ language?: string; result: string; segments: RawToken[]; isAborted: boolean }>;
  };
  release(): Promise<void>;
}
interface WhisperModule {
  WhisperContext: new (opts: {
    filePath: string;
    useGpu?: boolean;
    useFlashAttn?: boolean;
  }) => WhisperCtx | Promise<WhisperCtx>;
}

const require = createRequire(import.meta.url);
let mod: WhisperModule | null = null;

export function platformPackage(): string {
  return `@fugood/node-whisper-${process.platform}-${process.arch}`;
}

/** Load the prebuilt whisper.cpp addon for this computer (no compiler needed). */
export function loadWhisper(): WhisperModule {
  if (mod) return mod;
  try {
    mod = require(platformPackage()) as WhisperModule;
    return mod;
  } catch (err) {
    log.error('could not load whisper addon', err);
    throw new UserError(
      `Local speech-to-text is not available on this computer (${process.platform} ${process.arch}). Re-install with: npx -y @vibeediting/mcp@latest . If it still fails, you can use a cloud transcription key instead (see transcribe engine option).`,
    );
  }
}

export function whisperAvailable(): boolean {
  try {
    loadWhisper();
    return true;
  } catch {
    return false;
  }
}

let ctxCache: { model: ModelId; ctx: WhisperCtx; timer?: NodeJS.Timeout } | null = null;

async function getContext(model: ModelId): Promise<WhisperCtx> {
  if (ctxCache && ctxCache.model === model) {
    armIdleRelease();
    return ctxCache.ctx;
  }
  if (ctxCache) {
    await ctxCache.ctx.release().catch(() => undefined);
    ctxCache = null;
  }
  const m = loadWhisper();
  const useGpu = process.env.VIBE_WHISPER_GPU
    ? process.env.VIBE_WHISPER_GPU === '1'
    : process.platform === 'darwin' && process.arch === 'arm64';
  const ctx = await new m.WhisperContext({ filePath: modelPath(model), useGpu, useFlashAttn: useGpu });
  ctxCache = { model, ctx };
  armIdleRelease();
  return ctx;
}

/** Free the model memory after 10 idle minutes. */
function armIdleRelease(): void {
  if (!ctxCache) return;
  if (ctxCache.timer) clearTimeout(ctxCache.timer);
  ctxCache.timer = setTimeout(
    () => {
      const c = ctxCache;
      ctxCache = null;
      void c?.ctx.release().catch(() => undefined);
    },
    10 * 60 * 1000,
  );
  ctxCache.timer.unref();
}

export interface LocalOptions {
  model: ModelId;
  /** Whisper language code ('hi', 'en', ...) or 'auto'. */
  language: string;
  prompt?: string;
  quality?: 'fast' | 'best';
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface LocalResult {
  words: Word[];
  language: string;
  text: string;
  notes: string[];
}

export async function transcribeLocal(wavPath: string, opts: LocalOptions): Promise<LocalResult> {
  const notes: string[] = [];
  const first = await runOnce(wavPath, opts, opts.language);
  // Whisper sometimes labels Hindi as Urdu and writes it in Arabic script.
  if (
    (opts.language === 'auto' && first.language === 'ur') ||
    (opts.language === 'hi' && arabicShare(first.text) > 0.3)
  ) {
    if (opts.language === 'auto') {
      notes.push(
        'Speech was detected as Urdu; re-transcribed as Hindi (Devanagari). Pass language "ur" if it really is Urdu.',
      );
      return { ...(await runOnce(wavPath, opts, 'hi')), notes };
    }
    notes.push('The model wrote Hindi in Urdu script. Use a bigger model: transcribe with model "turbo".');
  }
  return { ...first, notes };
}

async function runOnce(
  wavPath: string,
  opts: LocalOptions,
  language: string,
): Promise<Omit<LocalResult, 'notes'>> {
  const ctx = await getContext(opts.model);
  const threads = Math.max(1, Math.min(8, (os.availableParallelism?.() ?? os.cpus().length) - 1));
  const handle = ctx.transcribeFile(wavPath, {
    language,
    tokenTimestamps: true,
    maxLen: 1,
    maxThreads: threads,
    prompt: opts.prompt,
    ...(opts.quality === 'best' ? { beamSize: 5, bestOf: 5 } : {}),
    onProgress: (p: number) => opts.onProgress?.(p / 100),
  });
  const onAbort = () => void handle.stop();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    const r = await handle.promise;
    if (r.isAborted || opts.signal?.aborted) throw new UserError('Transcription was cancelled.');
    return {
      words: wordsFromTokens(r.segments, r.result),
      language: r.language || language,
      text: r.result.trim(),
    };
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
