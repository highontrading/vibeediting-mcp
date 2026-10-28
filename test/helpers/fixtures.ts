import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpDir(prefix = 'vibe-test-'): string {
  const base = path.join(os.tmpdir(), 'vibeediting-tests');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

function ff(args: string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

/**
 * A test "talking head": colour bars + a 440 Hz tone with silent gaps at 3-5 s and 8-9.5 s.
 * Made with ffmpeg lavfi, no real footage needed.
 */
export function makeToneVideo(
  file: string,
  opts: { duration?: number; width?: number; height?: number } = {},
): string {
  const d = opts.duration ?? 12;
  const w = opts.width ?? 640;
  const h = opts.height ?? 360;
  ff([
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=${w}x${h}:r=30:d=${d}`,
    '-f',
    'lavfi',
    '-i',
    `sine=f=440:d=${d}`,
    '-filter_complex',
    "[1:a]volume='if(between(t,3,5)+between(t,8,9.5),0,1)':eval=frame[a]",
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    file,
  ]);
  return file;
}

/** Colour bars without audio. */
export function makeSilentVideo(file: string, duration = 4): string {
  ff([
    '-f',
    'lavfi',
    '-i',
    `smptebars=s=640x360:r=25:d=${duration}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    file,
  ]);
  return file;
}

/** A "voice" made of a modulated sine, for loudness and silence tests. */
export function makeSineVoice(file: string, duration = 6): string {
  ff([
    '-f',
    'lavfi',
    '-i',
    `sine=f=220:d=${duration}`,
    '-af',
    "volume='0.3+0.2*sin(2*PI*3*t)':eval=frame",
    '-c:a',
    'pcm_s16le',
    file,
  ]);
  return file;
}

export function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
