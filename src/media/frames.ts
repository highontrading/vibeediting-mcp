import fs from 'node:fs/promises';
import path from 'node:path';
import { dirs, fontsDir } from '../util/config.js';
import { ensureDir } from '../util/fsx.js';
import { run } from '../util/proc.js';
import { requireFfmpeg } from './ffmpeg.js';

/** 65.2 -> "1m05s" (no colons: they are special in ffmpeg filters). */
function label(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${(Math.round(t * 10) / 10).toFixed(1)}s`;
}

export function evenlySpaced(duration: number, count: number, margin = 0.04): number[] {
  if (duration <= 0) return [0];
  const a = duration * margin;
  const b = duration * (1 - margin);
  if (count <= 1) return [duration / 2];
  return Array.from({ length: count }, (_, i) => a + ((b - a) * i) / (count - 1));
}

/**
 * A grid of small frames with time labels, as one JPEG. Used so the agent can "see"
 * the video with very few tokens.
 */
export async function contactSheet(
  video: string,
  times: number[],
  opts: { cols?: number; thumbWidth?: number; signal?: AbortSignal } = {},
): Promise<{ jpeg: Buffer; times: number[] }> {
  const info = await requireFfmpeg();
  const cols = opts.cols ?? Math.min(4, times.length);
  const rows = Math.ceil(times.length / cols);
  const tw = opts.thumbWidth ?? 256;
  const work = await fs.mkdtemp(path.join(await ensureDir(dirs.cache()), 'sheet-'));
  try {
    const fontFile = 'label.ttf';
    if (info.hasDrawtext)
      await fs.copyFile(path.join(fontsDir(), 'Poppins-Bold.ttf'), path.join(work, fontFile));
    let i = 0;
    for (const t of times) {
      const vf = [`scale=${tw}:-2`];
      if (info.hasDrawtext) {
        vf.push(
          `drawtext=fontfile=${fontFile}:text=${label(t)}:x=6:y=6:fontsize=${Math.round(tw / 11)}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`,
        );
      }
      const out = `f${String(i).padStart(3, '0')}.jpg`;
      const r = await run(
        info.ffmpeg,
        [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-ss',
          String(Math.max(0, t)),
          '-i',
          video,
          '-frames:v',
          '1',
          '-vf',
          vf.join(','),
          '-q:v',
          '5',
          out,
        ],
        { cwd: work, signal: opts.signal },
      );
      if (r.code === 0) i++;
    }
    if (i === 0) throw new Error('could not grab frames');
    // Pad missing tiles by repeating the last frame so the grid is complete.
    const total = cols * rows;
    for (let j = i; j < total; j++)
      await fs.copyFile(
        path.join(work, `f${String(i - 1).padStart(3, '0')}.jpg`),
        path.join(work, `f${String(j).padStart(3, '0')}.jpg`),
      );
    const r = await run(
      info.ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-framerate',
        '1',
        '-i',
        'f%03d.jpg',
        '-vf',
        `tile=${cols}x${rows}:padding=4:margin=4:color=black`,
        '-frames:v',
        '1',
        '-q:v',
        '6',
        'sheet.jpg',
      ],
      { cwd: work, signal: opts.signal },
    );
    if (r.code !== 0) throw new Error('could not build the contact sheet');
    return { jpeg: await fs.readFile(path.join(work, 'sheet.jpg')), times: times.slice(0, i) };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/** One frame as JPEG (for checking a single moment). */
export async function grabFrame(video: string, t: number, width = 540): Promise<Buffer> {
  const { jpeg } = await contactSheet(video, [t], { cols: 1, thumbWidth: width });
  return jpeg;
}
