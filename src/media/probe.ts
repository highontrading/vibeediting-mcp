import fs from 'node:fs/promises';
import path from 'node:path';
import { UserError } from '../util/errors.js';
import { run } from '../util/proc.js';
import { round } from '../util/time.js';
import { requireFfmpeg } from './ffmpeg.js';

export interface MediaInfo {
  path: string;
  name: string;
  sizeBytes: number;
  mtimeMs: number;
  duration: number;
  container: string;
  video: null | {
    codec: string;
    /** Display size (after rotation). */
    width: number;
    height: number;
    fps: number;
    fpsText: string;
    rotation: number;
    pixFmt: string;
    bitrateKbps: number | null;
  };
  audio: null | {
    codec: string;
    sampleRate: number;
    channels: number;
  };
  isImage: boolean;
}

export const VIDEO_EXTS = [
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi',
  '.mts',
  '.m2ts',
  '.3gp',
  '.wmv',
  '.flv',
  '.mxf',
];
export const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma', '.aiff', '.aif'];
export const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic'];

function parseRate(r: string | undefined): number {
  if (!r) return 0;
  const [a, b] = r.split('/').map(Number);
  if (!b) return a || 0;
  return a / b;
}

/** 29.97 -> "30000/1001" so ffmpeg keeps exact timing. */
export function fpsToText(fps: number): string {
  const ntsc: Array<[number, string]> = [
    [23.976, '24000/1001'],
    [29.97, '30000/1001'],
    [59.94, '60000/1001'],
  ];
  for (const [v, t] of ntsc) if (Math.abs(fps - v) < 0.01) return t;
  return String(Math.round(fps * 1000) / 1000);
}

const cache = new Map<string, MediaInfo>();

export async function probeMedia(file: string): Promise<MediaInfo> {
  let st;
  try {
    st = await fs.stat(file);
  } catch {
    throw new UserError(`I cannot find the file "${file}".`);
  }
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { ffprobe } = await requireFfmpeg();
  const r = await run(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { timeoutMs: 60000 },
  );
  if (r.code !== 0) {
    throw new UserError(
      `I could not read "${path.basename(file)}". It may not be a video or audio file, or it may be damaged.`,
    );
  }
  const j = JSON.parse(r.stdout || '{}');
  const streams: any[] = j.streams ?? [];
  const vs = streams.find((s) => s.codec_type === 'video' && !(s.disposition?.attached_pic === 1));
  const as = streams.find((s) => s.codec_type === 'audio');
  const ext = path.extname(file).toLowerCase();
  const isImage =
    IMAGE_EXTS.includes(ext) ||
    (vs &&
      ['png', 'mjpeg', 'webp', 'bmp'].includes(vs.codec_name) &&
      !as &&
      Number(j.format?.duration ?? 0) < 0.1);

  let video: MediaInfo['video'] = null;
  if (vs) {
    let rotation = 0;
    for (const sd of vs.side_data_list ?? []) if (typeof sd.rotation === 'number') rotation = sd.rotation;
    if (!rotation && vs.tags?.rotate) rotation = Number(vs.tags.rotate) || 0;
    rotation = ((Math.round(rotation) % 360) + 360) % 360;
    const swap = rotation === 90 || rotation === 270;
    let fps = parseRate(vs.avg_frame_rate);
    if (!fps || fps > 240) fps = parseRate(vs.r_frame_rate);
    if (!fps || fps > 240) fps = 30;
    video = {
      codec: vs.codec_name ?? 'unknown',
      width: swap ? vs.height : vs.width,
      height: swap ? vs.width : vs.height,
      fps: round(fps, 3),
      fpsText: fpsToText(fps),
      rotation,
      pixFmt: vs.pix_fmt ?? '',
      bitrateKbps: vs.bit_rate ? Math.round(Number(vs.bit_rate) / 1000) : null,
    };
  }
  const audio: MediaInfo['audio'] = as
    ? {
        codec: as.codec_name ?? 'unknown',
        sampleRate: Number(as.sample_rate) || 48000,
        channels: Number(as.channels) || 2,
      }
    : null;
  let duration = Number(j.format?.duration);
  if (!Number.isFinite(duration)) duration = Number(vs?.duration ?? as?.duration ?? 0);
  const info: MediaInfo = {
    path: file,
    name: path.basename(file),
    sizeBytes: st.size,
    mtimeMs: st.mtimeMs,
    duration: round(duration || 0, 3),
    container: j.format?.format_name ?? '',
    video,
    audio,
    isImage: !!isImage,
  };
  cache.set(key, info);
  return info;
}

export function describeMedia(m: MediaInfo, relName?: string): string {
  const parts = [`${relName ?? m.name}: ${round(m.duration, 1)} s`];
  if (m.video) {
    const orient =
      m.video.height > m.video.width
        ? 'vertical'
        : m.video.height === m.video.width
          ? 'square'
          : 'horizontal';
    parts.push(
      `${m.video.width}x${m.video.height} (${orient})`,
      `${round(m.video.fps, 2)} fps`,
      m.video.codec,
    );
    if (m.video.rotation) parts.push(`rotated ${m.video.rotation}°`);
  } else parts.push('no video');
  parts.push(m.audio ? `audio ${m.audio.codec} ${m.audio.channels === 1 ? 'mono' : 'stereo'}` : 'no audio');
  parts.push(`${(m.sizeBytes / 1048576).toFixed(1)} MB`);
  return parts.join(', ');
}
