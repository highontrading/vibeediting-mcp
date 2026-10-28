import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeAudio } from '../../src/media/audio.js';
import { contactSheet } from '../../src/media/frames.js';
import { probeMedia } from '../../src/media/probe.js';
import { renderProject } from '../../src/render/render.js';
import {
  applyClips,
  outputDuration,
  reorderClips,
  silencesToCuts,
  splitAt,
  subtractRanges,
} from '../../src/timeline/ops.js';
import { formatFor, ProjectStore } from '../../src/timeline/store.js';
import type { Project } from '../../src/timeline/types.js';
import { Workspace } from '../../src/util/workspace.js';
import { hasFfmpeg, makeSilentVideo, makeSineVoice, makeToneVideo, tmpDir } from '../helpers/fixtures.js';

const run = hasFfmpeg() ? describe : describe.skip;

function loudness(file: string): number {
  // ffmpeg prints the ebur128 summary on stderr.
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const m = [...r.stderr.matchAll(/I:\s*(-?[\d.]+) LUFS/g)].at(-1);
  return Number(m?.[1]);
}

run('media + render (ffmpeg)', () => {
  let root: string;
  let ws: Workspace;
  let store: ProjectStore;
  let talk: string;
  let bars: string;

  beforeAll(() => {
    root = tmpDir('render-');
    process.env.VIBE_HOME = path.join(root, '.home');
    talk = makeToneVideo(path.join(root, 'talk video.mp4'));
    bars = makeSilentVideo(path.join(root, 'bars.mp4'), 6);
    makeSineVoice(path.join(root, 'music.wav'), 4);
    ws = new Workspace({ dir: root, source: 'test' });
    store = new ProjectStore(ws);
  });

  const paths = (p: Project) => ({
    sourcePath: (id: string) => store.sourcePath(p, id),
    overlayPath: (o: { path: string }) => path.resolve(store.projectDir(p), o.path),
    musicPath: p.audio.music ? path.resolve(store.projectDir(p), p.audio.music.path) : null,
  });

  it('probes media', async () => {
    const m = await probeMedia(talk);
    expect(m.duration).toBeCloseTo(12, 0);
    expect(m.video).toMatchObject({ width: 640, height: 360 });
    expect(m.audio).not.toBeNull();
    const b = await probeMedia(bars);
    expect(b.audio).toBeNull();
  });

  it('finds the silent gaps', async () => {
    const a = await analyzeAudio(talk, 12, {});
    expect(a.silences).toHaveLength(2);
    expect(a.silences[0].start).toBeCloseTo(3, 0);
    expect(a.silences[0].end).toBeCloseTo(5, 0);
    expect(a.silences[1].start).toBeCloseTo(8, 0);
    expect(a.loudness?.i).toBeLessThan(-5);
  });

  it('renders a full edit: cuts, captions, every graphic, B-roll, music', async () => {
    const { project: p } = await store.create({
      videos: [talk],
      aspect: '9:16',
      name: 'full',
      replace: true,
    });
    const a = await analyzeAudio(talk, 12, {});
    const cuts = silencesToCuts(a.silences, { minSilence: 0.4, keep: 0.1, duration: 12 });
    applyClips(
      p,
      subtractRanges(
        p.clips,
        cuts.map((c) => ({ source: 's1', ...c })),
        store.newId(p, 'c'),
      ),
    );
    const total = outputDuration(p.clips);
    expect(total).toBeCloseTo(12 - 1.8 - 1.3, 0);
    p.format = { ...p.format, ...formatFor('9:16', p.sources[0]), fit: 'blur' };
    const words = 'नमस्ते दोस्तों today we learn editing it is easy'
      .split(' ')
      .map((t, i) => ({ t, s: 0.2 + i * 0.9, e: 0.2 + i * 0.9 + 0.6, src: 's1' }));
    p.captions = { enabled: true, words, language: 'hi', overrides: {} };
    p.overlays.push(
      {
        id: 'o1',
        type: 'title',
        text: 'Edit faster',
        subtitle: 'आसान',
        start: 0,
        duration: 2,
        position: 'top',
        animation: 'typewriter',
        background: 'box',
      },
      { id: 'o2', type: 'lower_third', name: 'Asha', title: 'Creator', side: 'right', start: 1, duration: 2 },
      {
        id: 'o3',
        type: 'text',
        text: 'Tip #1',
        position: 'top-left',
        start: 2,
        duration: 1,
        box: true,
        animation: 'slide',
      },
      {
        id: 'o4',
        type: 'template',
        template: 'counter',
        params: { from: 0, to: 1499, prefix: '₹', label: 'only' },
        start: 2,
        duration: 1.5,
      },
      {
        id: 'o5',
        type: 'template',
        template: 'bar_chart',
        params: {
          bars: [
            { label: 'A', value: 1 },
            { label: 'B', value: 3 },
          ],
        },
        start: 3,
        duration: 1,
      },
      {
        id: 'o6',
        type: 'template',
        template: 'progress_bar',
        params: { percent: 60, label: 'Done' },
        start: 4,
        duration: 1,
      },
      {
        id: 'o7',
        type: 'template',
        template: 'checklist',
        params: { title: 'Steps', items: ['Record', 'Edit'] },
        start: 5,
        duration: 1,
      },
      {
        id: 'o8',
        type: 'template',
        template: 'quote',
        params: { text: 'Keep going', author: 'Me' },
        start: 6,
        duration: 1,
      },
      {
        id: 'o9',
        type: 'template',
        template: 'callout',
        params: { text: 'Look here', x: 0.5, y: 0.3 },
        start: 6.5,
        duration: 1,
      },
      { id: 'o10', type: 'zoom', start: 1, duration: 1.5, scale: 1.2, x: 0.5, y: 0.4 },
      { id: 'o11', type: 'broll', path: 'bars.mp4', trimStart: 1, mode: 'full', start: 4.2, duration: 1.2 },
      { id: 'o12', type: 'broll', path: 'bars.mp4', trimStart: 0, mode: 'pip', start: 5.5, duration: 1 },
    );
    p.audio = {
      normalize: true,
      target: -14,
      denoise: 'light',
      music: { path: 'music.wav', volume: 0.2, duck: true, fadeIn: 0.5, fadeOut: 0.5, start: 0 },
    };
    await store.save(p, 'test');

    const prev = path.join(root, 'exports', 'full-preview.mp4');
    const r1 = await renderProject(p, paths(p), { mode: 'preview', output: prev });
    const pm = await probeMedia(prev);
    expect(pm.video).toMatchObject({ width: 480, height: 854 });
    expect(pm.duration).toBeCloseTo(total, 0);
    expect(r1.duration).toBeCloseTo(total, 1);

    const fin = path.join(root, 'exports', 'full.mp4');
    const progress: number[] = [];
    await renderProject(p, paths(p), { mode: 'final', output: fin, onProgress: (f) => progress.push(f) });
    const fm = await probeMedia(fin);
    expect(fm.video).toMatchObject({ width: 1080, height: 1920, codec: 'h264' });
    expect(fm.audio?.codec).toBe('aac');
    expect(fm.duration).toBeCloseTo(total, 0);
    expect(Math.abs(loudness(fin) + 14)).toBeLessThan(1.0);
    expect(progress.at(-1)).toBe(1);
    // Originals untouched.
    expect((await probeMedia(talk)).duration).toBeCloseTo(12, 0);
    // A contact sheet is a JPEG.
    const sheet = await contactSheet(fin, [0.5, 2.5], { cols: 2, thumbWidth: 120 });
    expect(sheet.jpeg[0]).toBe(0xff);
    expect(sheet.jpeg[1]).toBe(0xd8);
  });

  it('renders several files, reordered, including one without audio', async () => {
    const { project: p } = await store.create({
      videos: [talk, bars],
      aspect: '16:9',
      name: 'multi',
      replace: true,
    });
    const s = splitAt(p.clips, 4, store.newId(p, 'c'));
    p.clips = s.clips;
    p.clips = reorderClips(p.clips, [p.clips[2].id, p.clips[1].id, p.clips[0].id]);
    p.audio.normalize = false;
    const total = outputDuration(p.clips);
    const out = path.join(root, 'exports', 'multi.mp4');
    await renderProject(p, paths(p), { mode: 'preview', output: out });
    const m = await probeMedia(out);
    expect(m.duration).toBeCloseTo(total, 0);
    expect(m.video).toMatchObject({ width: 854, height: 480 });
  });

  it('never leaves a half-written file when ffmpeg fails', async () => {
    const { project: p } = await store.create({ videos: [talk], name: 'broken', replace: true });
    p.overlays.push({
      id: 'b',
      type: 'broll',
      path: 'missing.mp4',
      trimStart: 0,
      mode: 'full',
      start: 1,
      duration: 1,
    });
    const out = path.join(root, 'exports', 'broken.mp4');
    await expect(renderProject(p, paths(p), { mode: 'preview', output: out })).rejects.toThrow(
      /render failed/i,
    );
    expect(fs.existsSync(out)).toBe(false);
  });
});
