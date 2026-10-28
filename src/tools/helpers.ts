import fs from 'node:fs/promises';
import path from 'node:path';
import { mapWordsToOutput } from '../captions/captions.js';
import { type MediaInfo, probeMedia, VIDEO_EXTS } from '../media/probe.js';
import type { Project } from '../timeline/types.js';
import { loadTranscript, type Transcript } from '../transcribe/transcript.js';
import { buildSegments } from '../transcribe/words.js';
import { UserError } from '../util/errors.js';
import type { App } from './kit.js';

export async function listVideos(root: string): Promise<string[]> {
  const out: string[] = [];
  const scan = async (dir: string, depth: number) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'exports' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth > 0) await scan(p, depth - 1);
      else if (e.isFile() && VIDEO_EXTS.includes(path.extname(e.name).toLowerCase()))
        out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  await scan(root, 1);
  return out.slice(0, 40);
}

/** A file the user named, or the main video of the project. */
export async function resolveMedia(
  app: App,
  file?: string,
  project?: string,
): Promise<{ media: MediaInfo; rel: string; project?: Project }> {
  if (file) {
    let abs: string;
    try {
      abs = app.ws.resolve(file, { mustExist: true });
    } catch (err) {
      const vids = app.ws.root ? await listVideos(app.ws.root) : [];
      if (err instanceof UserError && vids.length)
        throw new UserError(`${err.message}\nVideos in the working folder: ${vids.join(', ')}`);
      throw err;
    }
    return { media: await probeMedia(abs), rel: app.ws.rel(abs) };
  }
  let p: Project;
  try {
    p = await app.store.load(project);
  } catch (err) {
    const vids = app.ws.root ? await listVideos(app.ws.root) : [];
    throw new UserError(
      `${err instanceof Error ? err.message : String(err)}${vids.length ? `\nOr pass file=... Videos here: ${vids.join(', ')}` : ''}`,
    );
  }
  const main = p.sources.find((s) => s.hasVideo) ?? p.sources[0];
  const abs = app.store.sourcePath(p, main.id);
  return { media: await probeMedia(abs), rel: app.ws.rel(abs), project: p };
}

/** Transcript of the current edit: words of all sources, mapped to output time (cut words removed). */
export async function projectTranscript(
  app: App,
  p: Project,
): Promise<{ transcript: Transcript; missing: string[] }> {
  const words: Array<{ t: string; s: number; e: number; src: string }> = [];
  const missing: string[] = [];
  let language = '';
  for (const s of p.sources) {
    if (!s.hasAudio) continue;
    const m = await probeMedia(app.store.sourcePath(p, s.id));
    const tr = await loadTranscript(m);
    if (!tr) {
      missing.push(s.path);
      continue;
    }
    language ||= tr.language;
    for (const w of tr.words) words.push({ ...w, src: s.id });
  }
  const out = mapWordsToOutput(p.clips, words);
  const transcript: Transcript = {
    v: 1,
    source: `project ${p.name} (edited timeline, output times)`,
    sourceKey: '',
    language,
    engine: 'local',
    model: '',
    createdAt: '',
    duration: 0,
    words: out,
    segments: buildSegments(out),
    notes: [],
  };
  return { transcript, missing };
}

/** Source words with their source id, for features that edit in source time. */
export async function sourceWords(
  app: App,
  p: Project,
): Promise<{ bySource: Map<string, Transcript>; missing: string[] }> {
  const bySource = new Map<string, Transcript>();
  const missing: string[] = [];
  for (const s of p.sources) {
    if (!s.hasAudio) continue;
    const tr = await loadTranscript(await probeMedia(app.store.sourcePath(p, s.id)));
    if (tr) bySource.set(s.id, tr);
    else missing.push(s.path);
  }
  return { bySource, missing };
}

export function needTranscript(missing: string[]): UserError {
  return new UserError(
    `This needs a transcript first. Call transcribe (it covers the project's videos: ${missing.join(', ')}).`,
  );
}

/** Most recent preview/export of a project. */
export const lastOutputs = new Map<string, { preview?: string; export?: string }>();
