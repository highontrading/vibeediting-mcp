import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASSETS, downloadFfmpeg, managedPaths, platformKey } from '../../src/media/ffmpegDownload.js';
import { tmpDir } from '../helpers/fixtures.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('FFmpeg auto-download', () => {
  let server: http.Server;
  let base: string;
  const ff = gzipSync(Buffer.from('#!/bin/sh\necho fake ffmpeg\n'));
  const fp = gzipSync(Buffer.from('#!/bin/sh\necho fake ffprobe\n'));
  let flakyHits = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ff.gz') return res.end(ff);
      if (req.url === '/fp.gz') return res.end(fp);
      // Drops the connection halfway the first time, works the second time.
      if (req.url === '/flaky.gz') {
        if (flakyHits++ === 0) {
          res.writeHead(200, { 'content-length': String(ff.length) });
          res.write(ff.subarray(0, 10));
          return res.destroy();
        }
        return res.end(ff);
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('maps platforms to builds (Windows on ARM uses the x64 build)', () => {
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64');
    expect(platformKey('win32', 'arm64')).toBe('win32-x64');
    expect(platformKey('freebsd', 'x64')).toBeNull();
    for (const a of Object.values(ASSETS)) {
      expect(a.ffmpeg.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.ffprobe.bytes).toBeGreaterThan(10_000_000);
    }
  });

  it('downloads, checks the checksum and unpacks', async () => {
    process.env.VIBE_HOME = tmpDir('ffdl-');
    const progress: number[] = [];
    const out = await downloadFfmpeg((f) => progress.push(f), {
      baseUrl: base,
      assets: {
        ffmpeg: { file: 'ff.gz', bytes: ff.length, sha256: sha(ff) },
        ffprobe: { file: 'fp.gz', bytes: fp.length, sha256: sha(fp) },
      },
    });
    expect(out).toEqual(managedPaths());
    expect(fs.readFileSync(out.ffmpeg, 'utf8')).toContain('fake ffmpeg');
    expect(fs.readFileSync(out.ffprobe, 'utf8')).toContain('fake ffprobe');
    expect(progress.at(-1)).toBe(1);
    expect(fs.existsSync(path.join(path.dirname(out.ffmpeg), 'README.txt'))).toBe(true);
  });

  it('refuses a download whose checksum does not match', async () => {
    process.env.VIBE_HOME = tmpDir('ffdl-bad-');
    await expect(
      downloadFfmpeg(undefined, {
        baseUrl: base,
        assets: {
          ffmpeg: { file: 'ff.gz', bytes: ff.length, sha256: '0'.repeat(64) },
          ffprobe: { file: 'fp.gz', bytes: fp.length, sha256: sha(fp) },
        },
        retryDelayMs: 1,
      }),
    ).rejects.toThrow(/checksum/);
    expect(fs.existsSync(managedPaths().ffmpeg)).toBe(false);
    expect(fs.readdirSync(path.dirname(managedPaths().ffmpeg)).filter((f) => f.endsWith('.part'))).toEqual(
      [],
    );
  });

  it('tries again when the connection drops', async () => {
    process.env.VIBE_HOME = tmpDir('ffdl-flaky-');
    const out = await downloadFfmpeg(undefined, {
      baseUrl: base,
      assets: {
        ffmpeg: { file: 'flaky.gz', bytes: ff.length, sha256: sha(ff) },
        ffprobe: { file: 'fp.gz', bytes: fp.length, sha256: sha(fp) },
      },
      retryDelayMs: 1,
    });
    expect(flakyHits).toBe(2);
    expect(fs.readFileSync(out.ffmpeg, 'utf8')).toContain('fake ffmpeg');
  });
});
