import fs from 'node:fs/promises';
import path from 'node:path';
import { type FfmpegInfo, requireFfmpeg } from '../media/ffmpeg.js';
import { parseLoudnorm } from '../media/audio.js';
import { IMAGE_EXTS } from '../media/probe.js';
import type { Project, VideoOverlay } from '../timeline/types.js';
import { dirs, fontsDir } from '../util/config.js';
import { UserError } from '../util/errors.js';
import { ensureDir, exists } from '../util/fsx.js';
import { run, tailLines } from '../util/proc.js';
import { projectAss } from './assFile.js';
import { buildGraph, type BuiltGraph } from './graph.js';

export type Preset = 'auto' | 'reels' | 'shorts' | 'tiktok' | 'youtube' | 'square' | 'portrait';
export type Quality = 'high' | 'standard' | 'small';

export const PRESET_SIZES: Record<Exclude<Preset, 'auto'>, { w: number; h: number; label: string }> = {
  reels: { w: 1080, h: 1920, label: 'Instagram Reels 1080x1920' },
  shorts: { w: 1080, h: 1920, label: 'YouTube Shorts 1080x1920' },
  tiktok: { w: 1080, h: 1920, label: 'TikTok 1080x1920' },
  youtube: { w: 1920, h: 1080, label: 'YouTube 1920x1080' },
  square: { w: 1080, h: 1080, label: 'Square 1080x1080' },
  portrait: { w: 1080, h: 1350, label: 'Instagram feed 1080x1350' },
};

export interface RenderPaths {
  sourcePath: (id: string) => string;
  overlayPath: (o: VideoOverlay) => string;
  musicPath: string | null;
}

export interface RenderOptions {
  mode: 'preview' | 'final';
  preset?: Preset;
  quality?: Quality;
  output: string;
  onProgress?: (f: number, msg: string) => void;
  signal?: AbortSignal;
}

/** Folder for temporary render files. Outside the user's video folder (OneDrive etc.). */
async function workDir(p: Project): Promise<string> {
  const d = await ensureDir(path.join(dirs.cache(), 'projects', p.id));
  const fonts = await ensureDir(path.join(d, 'fonts'));
  for (const f of await fs.readdir(fontsDir())) {
    if (!f.endsWith('.ttf')) continue;
    const target = path.join(fonts, f);
    if (!(await exists(target))) await fs.copyFile(path.join(fontsDir(), f), target);
  }
  return d;
}

function filterArgs(ff: FfmpegInfo, file: string): string[] {
  const major = Number(/^n?(\d+)/.exec(ff.version)?.[1] ?? 0);
  // -filter_complex_script is deprecated since FFmpeg 7; "-/filter_complex file" reads the value from a file.
  return major >= 7 ? ['-/filter_complex', file] : ['-filter_complex_script', file];
}

function progressParser(total: number, onP: (f: number) => void): (line: string) => void {
  return (line: string) => {
    const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
    if (m && total > 0) onP(Math.min(1, Number(m[1]) / 1e6 / total));
  };
}

export async function renderProject(
  p: Project,
  paths: RenderPaths,
  opts: RenderOptions,
): Promise<{ output: string; duration: number; width: number; height: number; loudness?: number }> {
  const ff = await requireFfmpeg({ needLibass: true });
  for (const s of p.sources) {
    if (!(await exists(paths.sourcePath(s.id))))
      throw new UserError(
        `The source video ${s.path} is missing. Put it back in the folder or create a new project.`,
      );
  }
  const progress = opts.onProgress ?? (() => undefined);
  let W = p.format.width;
  let H = p.format.height;
  if (opts.preset && opts.preset !== 'auto') {
    W = PRESET_SIZES[opts.preset].w;
    H = PRESET_SIZES[opts.preset].h;
  }
  const assW = W;
  const assH = H;
  if (opts.mode === 'preview') {
    const scale = Math.min(1, 854 / Math.max(W, H));
    W = Math.round((W * scale) / 2) * 2;
    H = Math.round((H * scale) / 2) * 2;
  }
  const work = await workDir(p);
  const tag = opts.mode === 'preview' ? 'preview' : 'final';
  const ass = projectAss(p, assW, assH);
  const assName = `${tag}.ass`;
  if (ass) await fs.writeFile(path.join(work, assName), ass, 'utf8');
  const isImage = (f: string) => IMAGE_EXTS.includes(path.extname(f).toLowerCase());
  const base = {
    project: p,
    sourcePath: paths.sourcePath,
    overlayPath: paths.overlayPath,
    musicPath: paths.musicPath,
    width: W,
    height: H,
    fpsText: p.format.fpsText,
    assFile: ass ? assName : null,
    fontsDir: 'fonts',
    isImage,
  };

  // Pass 1 (final only): measure loudness of the finished mix for exact -14 LUFS.
  let measured = null;
  const total = p.clips.reduce((a, c) => a + c.out - c.in, 0);
  const wantAudio = p.sources.some((s) => s.hasAudio) || !!p.audio.music;
  if (opts.mode === 'final' && p.audio.normalize && wantAudio) {
    progress(0.01, 'Measuring loudness');
    const g = buildGraph({ ...base, video: false, audio: true, loudnorm: 'measure' });
    const gfile = path.join(work, `${tag}-measure.txt`);
    await fs.writeFile(gfile, g.filter, 'utf8');
    const args = [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-progress',
      'pipe:1',
      '-nostats',
      ...g.inputs.flatMap((i) => i.args),
      ...filterArgs(ff, gfile),
      '-map',
      `[${g.audioOut}]`,
      '-t',
      String(total),
      '-f',
      'null',
      '-',
    ];
    const r = await run(ff.ffmpeg, args, {
      cwd: work,
      signal: opts.signal,
      onStdoutLine: progressParser(total, (f) => progress(0.01 + f * 0.14, 'Measuring loudness')),
    });
    if (opts.signal?.aborted) throw new UserError('Render cancelled.');
    measured = r.code === 0 ? parseLoudnorm(r.stderr) : null;
  }

  const g: BuiltGraph = buildGraph({
    ...base,
    video: true,
    audio: wantAudio,
    loudnorm: opts.mode === 'final' ? (measured ?? null) : undefined,
  });
  const gfile = path.join(work, `${tag}-graph.txt`);
  await fs.writeFile(gfile, g.filter, 'utf8');
  const q = opts.quality ?? 'standard';
  const crf = opts.mode === 'preview' ? 30 : q === 'high' ? 18 : q === 'small' ? 24 : 20;
  const x264preset = opts.mode === 'preview' ? 'veryfast' : q === 'high' ? 'slow' : 'medium';
  const outDir = await ensureDir(path.dirname(opts.output));
  const tmp = path.join(outDir, `.${path.basename(opts.output)}.part.mp4`);
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-progress',
    'pipe:1',
    '-nostats',
    ...g.inputs.flatMap((i) => i.args),
    ...filterArgs(ff, gfile),
    '-map',
    `[${g.videoOut}]`,
    ...(g.audioOut ? ['-map', `[${g.audioOut}]`] : []),
    '-c:v',
    'libx264',
    '-preset',
    x264preset,
    '-crf',
    String(crf),
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-r',
    p.format.fpsText,
    ...(g.audioOut ? ['-c:a', 'aac', '-b:a', opts.mode === 'preview' ? '96k' : '192k', '-ar', '48000'] : []),
    '-movflags',
    '+faststart',
    '-t',
    String(g.duration),
    tmp,
  ];
  const startF = opts.mode === 'final' && measured ? 0.15 : 0.02;
  const label = opts.mode === 'preview' ? 'Rendering preview' : 'Rendering final video';
  const r = await run(ff.ffmpeg, args, {
    cwd: work,
    signal: opts.signal,
    onStdoutLine: progressParser(g.duration, (f) =>
      progress(startF + f * (0.98 - startF), `${label}: ${Math.round(f * 100)}%`),
    ),
  });
  if (opts.signal?.aborted) {
    await fs.rm(tmp, { force: true });
    throw new UserError('Render cancelled.');
  }
  if (r.code !== 0) {
    await fs.rm(tmp, { force: true });
    await fs.writeFile(path.join(work, `${tag}-error.log`), r.stderr, 'utf8');
    throw new UserError(
      `The render failed. FFmpeg said:\n${tailLines(r.stderr, 6)}\n(Full log: ${path.join(work, `${tag}-error.log`)})`,
    );
  }
  await fs.rm(opts.output, { force: true });
  await fs.rename(tmp, opts.output);
  progress(1, 'Done');
  return {
    output: opts.output,
    duration: g.duration,
    width: W,
    height: H,
    loudness: measured ? p.audio.target : undefined,
  };
}
