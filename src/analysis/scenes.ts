import { requireFfmpeg } from '../media/ffmpeg.js';
import { run } from '../util/proc.js';

/** Times (seconds) where the picture changes a lot: camera cuts, new shots. */
export async function detectScenes(
  file: string,
  duration: number,
  opts: { threshold?: number; signal?: AbortSignal; onProgress?: (f: number) => void } = {},
): Promise<number[]> {
  const { ffmpeg } = await requireFfmpeg();
  const thr = opts.threshold ?? 0.3;
  const times: number[] = [];
  await run(
    ffmpeg,
    [
      '-hide_banner',
      '-nostdin',
      '-i',
      file,
      '-an',
      '-sn',
      '-vf',
      `scale=160:-2,select='gt(scene,${thr})',showinfo`,
      '-f',
      'null',
      '-',
    ],
    {
      signal: opts.signal,
      onStderrLine: (l) => {
        const m = /pts_time:([\d.]+)/.exec(l);
        if (m && l.includes('Parsed_showinfo')) times.push(Number(m[1]));
        const p = /time=(\d+):(\d+):([\d.]+)/.exec(l);
        if (p && duration > 0)
          opts.onProgress?.((Number(p[1]) * 3600 + Number(p[2]) * 60 + Number(p[3])) / duration);
      },
    },
  );
  // Merge cuts closer than 0.5 s (flashes, fast pans).
  const merged: number[] = [];
  for (const t of times)
    if (merged.length === 0 || t - merged[merged.length - 1] > 0.5) merged.push(Math.round(t * 100) / 100);
  return merged;
}
