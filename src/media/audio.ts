import { UserError } from '../util/errors.js';
import { run, tailLines } from '../util/proc.js';
import { requireFfmpeg } from './ffmpeg.js';

export interface Range {
  start: number;
  end: number;
}

export interface Loudness {
  /** integrated loudness, LUFS */
  i: number;
  /** true peak, dBTP */
  tp: number;
  lra: number;
  thresh: number;
  offset: number;
}

export interface AudioAnalysis {
  silences: Range[];
  loudness: Loudness | null;
  /** threshold used for silence, dB */
  thresholdDb: number;
}

/** Parse the JSON block that loudnorm prints at the end of stderr. */
export function parseLoudnorm(stderr: string): Loudness | null {
  const m = /\{\s*"input_i"[\s\S]*?\}/.exec(stderr);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const num = (v: string) => (v === '-inf' ? -70 : v === 'inf' ? 0 : Number(v));
    return {
      i: num(j.input_i),
      tp: num(j.input_tp),
      lra: num(j.input_lra),
      thresh: num(j.input_thresh),
      offset: num(j.target_offset),
    };
  } catch {
    return null;
  }
}

/** Parse silencedetect lines. Open silence at the end is closed with `duration`. */
export function parseSilences(stderr: string, duration: number): Range[] {
  const out: Range[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && open !== null) {
      out.push({ start: open, end: Number(e[1]) });
      open = null;
    }
  }
  if (open !== null && duration > open) out.push({ start: open, end: duration });
  return out;
}

/**
 * One pass over the audio: silences + loudness (EBU R128).
 * thresholdDb 'auto' = 18 dB under the speech loudness, kept between -50 and -25 dB.
 */
export async function analyzeAudio(
  file: string,
  duration: number,
  opts: {
    thresholdDb?: number | 'auto';
    minSilence?: number;
    signal?: AbortSignal;
    onProgress?: (f: number) => void;
  } = {},
): Promise<AudioAnalysis> {
  const { ffmpeg } = await requireFfmpeg();
  const minSil = opts.minSilence ?? 0.4;
  let threshold = typeof opts.thresholdDb === 'number' ? opts.thresholdDb : NaN;
  let loudness: Loudness | null = null;
  const progressLine = (l: string) => {
    const m = /time=(\d+):(\d+):([\d.]+)/.exec(l);
    if (m && duration > 0)
      opts.onProgress?.((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / duration);
  };
  if (!Number.isFinite(threshold)) {
    const r = await run(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-i',
        file,
        '-vn',
        '-sn',
        '-af',
        'loudnorm=print_format=json',
        '-f',
        'null',
        '-',
      ],
      {
        signal: opts.signal,
        onStderrLine: (l) => progressLine(l),
      },
    );
    if (r.code !== 0)
      throw new UserError(`I could not read the audio of this file. ${tailLines(r.stderr, 2)}`);
    loudness = parseLoudnorm(r.stderr);
    const base = loudness && loudness.i > -70 ? loudness.i : -23;
    threshold = Math.max(-50, Math.min(-25, Math.round(base - 18)));
  }
  const r = await run(
    ffmpeg,
    [
      '-hide_banner',
      '-nostdin',
      '-i',
      file,
      '-vn',
      '-sn',
      '-af',
      `silencedetect=noise=${threshold}dB:d=${minSil}${loudness ? '' : ',loudnorm=print_format=json'}`,
      '-f',
      'null',
      '-',
    ],
    { signal: opts.signal },
  );
  if (r.code !== 0) throw new UserError(`I could not read the audio of this file. ${tailLines(r.stderr, 2)}`);
  loudness ??= parseLoudnorm(r.stderr);
  return { silences: parseSilences(r.stderr, duration), loudness, thresholdDb: threshold };
}
