import fs from 'node:fs/promises';
import path from 'node:path';
import { dirs } from '../util/config.js';
import { UserError } from '../util/errors.js';
import { ensureDir, readJson, shortHash, writeJson } from '../util/fsx.js';
import { run, tailLines } from '../util/proc.js';
import { fmtTime } from '../util/time.js';
import { requireFfmpeg } from '../media/ffmpeg.js';
import { analyzeAudio } from '../media/audio.js';
import type { MediaInfo } from '../media/probe.js';
import { type CloudEngine, transcribeDeepgram, transcribeOpenAI } from './cloud.js';
import { transcribeLocal } from './local.js';
import { defaultModel, ensureModel, type ModelId } from './models.js';
import { buildSegments, cleanHallucinations, norm, type Segment, type Word } from './words.js';

export interface Transcript {
  v: 1;
  /** path relative to the working folder */
  source: string;
  sourceKey: string;
  language: string;
  engine: 'local' | CloudEngine;
  model: string;
  createdAt: string;
  duration: number;
  words: Word[];
  segments: Segment[];
  notes: string[];
}

export type Engine = 'local' | CloudEngine;

/** Cache key: changes when the file changes. */
export function sourceKey(m: MediaInfo): string {
  return shortHash(`${path.resolve(m.path)}|${m.sizeBytes}|${Math.round(m.mtimeMs)}`);
}

/** Transcripts live next to the video in .vibeediting/transcripts. */
export function transcriptPath(m: MediaInfo): string {
  return path.join(
    path.dirname(m.path),
    '.vibeediting',
    'transcripts',
    `${path.basename(m.path).replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '_')}.${sourceKey(m)}.json`,
  );
}

export async function loadTranscript(m: MediaInfo): Promise<Transcript | null> {
  const t = await readJson<Transcript>(transcriptPath(m));
  return t && t.v === 1 && t.sourceKey === sourceKey(m) ? t : null;
}

export async function saveTranscript(m: MediaInfo, t: Transcript): Promise<void> {
  await writeJson(transcriptPath(m), t);
}

/** Pull a 16 kHz mono audio track out of the video for speech recognition. */
async function extractAudio(
  m: MediaInfo,
  format: 'wav' | 'flac',
  signal?: AbortSignal,
  range?: { start: number; dur: number },
): Promise<string> {
  const { ffmpeg } = await requireFfmpeg();
  const dir = await ensureDir(path.join(dirs.cache(), 'audio'));
  const tag = range ? `.${Math.round(range.start)}-${Math.round(range.dur)}` : '';
  const out = path.join(dir, `${sourceKey(m)}${tag}.${format}`);
  try {
    if ((await fs.stat(out)).size > 1000) return out;
  } catch {
    /* not cached yet */
  }
  const args = ['-hide_banner', '-nostdin', '-y'];
  if (range) args.push('-ss', String(range.start), '-t', String(range.dur));
  args.push('-i', m.path, '-vn', '-sn', '-ac', '1', '-ar', '16000');
  args.push(...(format === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'flac']), `${out}.tmp.${format}`);
  const r = await run(ffmpeg, args, { signal });
  if (r.code !== 0)
    throw new UserError(`I could not extract the audio from ${m.name}. ${tailLines(r.stderr, 2)}`);
  await fs.rename(`${out}.tmp.${format}`, out);
  return out;
}

/** Light prompt that nudges Whisper to keep "umm", "uh" etc. (it drops them by default). */
function fillerPrompt(language: string): string | undefined {
  if (language === 'en') return 'Umm, so, uh, I mean, like, you know, we were, uh, going there.';
  if (language === 'hi') return 'हाँ, तो, उम्म, मतलब, basically, हम लोग, अं, वहाँ गए थे।';
  return undefined;
}

export interface TranscribeOptions {
  language: string;
  engine: Engine;
  model?: ModelId;
  keepFillers?: boolean;
  quality?: 'fast' | 'best';
  force?: boolean;
  onProgress?: (f: number, msg: string) => void;
  signal?: AbortSignal;
}

export async function transcribeMedia(
  m: MediaInfo,
  relSource: string,
  opts: TranscribeOptions,
): Promise<{ transcript: Transcript; cached: boolean }> {
  if (!m.audio) throw new UserError(`${m.name} has no audio track, so there is nothing to transcribe.`);
  if (!opts.force) {
    const existing = await loadTranscript(m);
    if (
      existing &&
      (opts.language === 'auto' || existing.language === opts.language) &&
      (!opts.model || existing.model === opts.model || existing.engine !== 'local')
    ) {
      return { transcript: existing, cached: true };
    }
  }
  const progress = opts.onProgress ?? (() => undefined);
  let words: Word[] = [];
  let language = opts.language;
  let model: string;
  const notes: string[] = [];

  if (opts.engine === 'local') {
    const id = opts.model ?? defaultModel();
    model = id;
    await ensureModel(id, (f, msg) => progress(f * 0.25, msg), opts.signal);
    progress(0.26, 'Preparing audio');
    const wav = await extractAudio(m, 'wav', opts.signal);
    progress(0.3, `Transcribing with the ${id} model`);
    const r = await transcribeLocal(wav, {
      model: id,
      language: opts.language,
      prompt: opts.keepFillers === false ? undefined : fillerPrompt(opts.language),
      quality: opts.quality,
      signal: opts.signal,
      onProgress: (f) =>
        progress(0.3 + f * 0.6, `Transcribing with the ${id} model: ${Math.round(f * 100)}%`),
    });
    words = r.words;
    language = r.language;
    notes.push(...r.notes);
  } else {
    model = opts.engine === 'deepgram' ? 'nova-3' : 'whisper-1';
    progress(0.05, 'Preparing audio');
    if (opts.engine === 'deepgram') {
      const flac = await extractAudio(m, 'flac', opts.signal);
      progress(0.2, 'Sending audio to Deepgram (your key)');
      const r = await transcribeDeepgram(flac, opts.language, opts.signal);
      words = r.words;
      language = r.language;
    } else {
      // OpenAI accepts 25 MB per request: send 20-minute chunks.
      const chunk = 1200;
      for (let start = 0; start < m.duration; start += chunk) {
        const flac = await extractAudio(m, 'flac', opts.signal, { start, dur: chunk });
        progress(0.1 + (0.8 * start) / m.duration, 'Sending audio to OpenAI (your key)');
        const r = await transcribeOpenAI(flac, opts.language, start, opts.signal);
        words.push(...r.words);
        language = r.language;
      }
    }
    notes.push(`Transcribed in the cloud with ${opts.engine} using your own API key.`);
  }

  progress(0.92, 'Cleaning up the transcript');
  try {
    const a = await analyzeAudio(m.path, m.duration, { minSilence: 2, signal: opts.signal });
    const c = cleanHallucinations(words, a.silences);
    if (c.removed > 0)
      notes.push(`Removed ${c.removed} words that Whisper heard in silent parts (hallucinations).`);
    words = c.words;
  } catch {
    /* cleanup is optional */
  }
  if (words.length === 0) notes.push('No speech was found in this file.');
  const transcript: Transcript = {
    v: 1,
    source: relSource,
    sourceKey: sourceKey(m),
    language,
    engine: opts.engine,
    model,
    createdAt: new Date().toISOString(),
    duration: m.duration,
    words,
    segments: buildSegments(words),
    notes,
  };
  await saveTranscript(m, transcript);
  progress(1, 'Done');
  return { transcript, cached: false };
}

/** Compact, paginated view of a transcript for the agent. */
export function formatTranscript(
  t: Transcript,
  opts: {
    page?: number;
    pageSize?: number;
    search?: string;
    mode?: 'segments' | 'outline' | 'words';
    from?: number;
    to?: number;
  },
): string {
  const mode = opts.mode ?? 'segments';
  let segs = t.segments;
  if (opts.from !== undefined) segs = segs.filter((s) => s.e > opts.from!);
  if (opts.to !== undefined) segs = segs.filter((s) => s.s < opts.to!);
  const head = `Transcript of ${t.source} (${t.language}, ${t.engine}${t.model ? ` ${t.model}` : ''}): ${t.segments.length} lines, ${t.words.length} words.`;
  if (opts.search) {
    const q = norm(opts.search);
    const hits = segs.filter((s) => norm(s.text).includes(q));
    const lines = hits.slice(0, 40).map((s) => `[${fmtTime(s.s)}-${fmtTime(s.e)}] ${s.text}`);
    return `${head}\n${hits.length} line(s) contain "${opts.search}"${hits.length > 40 ? ' (first 40 shown)' : ''}:\n${lines.join('\n') || '(none)'}`;
  }
  if (mode === 'outline') {
    // One line per ~60 s block: good for long videos.
    const blocks: string[] = [];
    let blockStart = -1;
    for (const s of segs) {
      if (blockStart < 0 || s.s - blockStart >= 60) {
        blockStart = s.s;
        blocks.push(`[${fmtTime(s.s, 0)}] ${s.text.slice(0, 140)}`);
      }
    }
    return `${head}\nOutline (first line of every minute):\n${blocks.join('\n')}`;
  }
  if (mode === 'words') {
    const from = opts.from ?? 0;
    const to = opts.to ?? from + 30;
    const ws = t.words.filter((w) => w.e > from && w.s < to).slice(0, 400);
    return `${head}\nWords ${fmtTime(from)}-${fmtTime(to)}:\n${ws.map((w) => `${w.t}@${w.s.toFixed(2)}`).join(' ')}`;
  }
  const pageSize = Math.max(5, Math.min(200, opts.pageSize ?? 60));
  const pages = Math.max(1, Math.ceil(segs.length / pageSize));
  const page = Math.max(1, Math.min(pages, opts.page ?? 1));
  const slice = segs.slice((page - 1) * pageSize, page * pageSize);
  const lines = slice.map((s) => `[${fmtTime(s.s)}-${fmtTime(s.e)}] ${s.text}`);
  const more =
    page < pages
      ? `\n(page ${page} of ${pages}. Ask for page ${page + 1} to read more, or use search.)`
      : pages > 1
        ? `\n(page ${page} of ${pages})`
        : '';
  const notes = t.notes.length ? `\nNotes: ${t.notes.join(' ')}` : '';
  return `${head}${notes}\n${lines.join('\n')}${more}`;
}
