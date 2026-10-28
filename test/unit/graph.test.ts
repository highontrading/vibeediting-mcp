import { describe, expect, it } from 'vitest';
import { buildGraph, fitFilter, groupClips, zoomExpr } from '../../src/render/graph.js';
import { findPreset } from '../../src/styles/presets.js';
import type { Project } from '../../src/timeline/types.js';

function project(over: Partial<Project> = {}): Project {
  return {
    schema: 1,
    id: 'x',
    name: 'p',
    createdAt: '',
    updatedAt: '',
    sources: [
      {
        id: 's1',
        path: 'a.mp4',
        duration: 60,
        width: 1920,
        height: 1080,
        fps: 30,
        hasAudio: true,
        hasVideo: true,
      },
      {
        id: 's2',
        path: 'b.mp4',
        duration: 30,
        width: 1080,
        height: 1920,
        fps: 30,
        hasAudio: false,
        hasVideo: true,
      },
    ],
    clips: [{ id: 'c1', source: 's1', in: 0, out: 10 }],
    format: {
      aspect: '9:16',
      width: 1080,
      height: 1920,
      fps: 30,
      fpsText: '30',
      fit: 'crop',
      cropX: 0.5,
      cropY: 0.5,
    },
    styleName: 'bold-yellow-pop',
    style: findPreset('bold-yellow-pop')!,
    captions: null,
    overlays: [],
    audio: { normalize: true, target: -14, denoise: 'off', music: null },
    log: [],
    nextId: 10,
    ...over,
  };
}

describe('render graph', () => {
  it('groups forward clips of one file into one decode pass', () => {
    const p = project({
      clips: [
        { id: 'c1', source: 's1', in: 0, out: 5 },
        { id: 'c2', source: 's1', in: 6, out: 9 },
        { id: 'c3', source: 's1', in: 50, out: 55 }, // far jump -> new group
        { id: 'c4', source: 's1', in: 1, out: 2 }, // backwards -> new group
        { id: 'c5', source: 's2', in: 0, out: 3 },
      ],
    });
    const g = groupClips(p.clips, p.sources);
    expect(g.map((x) => x.clips.length)).toEqual([2, 1, 1, 1]);
  });

  it('crops 16:9 to 9:16 around the chosen x', () => {
    const f = fitFilter('in', 'out', 1920, 1080, 1080, 1920, 'crop', 0.5, 0.5, 't');
    expect(f).toBe('[in]crop=608:1080:656:0,scale=1080:1920:flags=lanczos[out]');
    const left = fitFilter('in', 'out', 1920, 1080, 1080, 1920, 'crop', 0, 0.5, 't');
    expect(left).toContain('crop=608:1080:0:0');
    expect(fitFilter('in', 'out', 1080, 1920, 1080, 1920, 'crop', 0.5, 0.5, 't')).toBe(
      '[in]scale=1080:1920:flags=lanczos[out]',
    );
    expect(fitFilter('in', 'out', 1920, 1080, 1080, 1920, 'blur', 0.5, 0.5, 't')).toContain('boxblur');
  });

  it('builds a full graph with silent sources, zooms, captions and music', () => {
    const p = project({
      clips: [
        { id: 'c1', source: 's1', in: 0, out: 5 },
        { id: 'c2', source: 's2', in: 0, out: 3 },
      ],
      overlays: [{ id: 'z', type: 'zoom', start: 1, duration: 2, scale: 1.2, x: 0.5, y: 0.4 }],
      audio: {
        normalize: true,
        target: -14,
        denoise: 'medium',
        music: { path: 'm.mp3', volume: 0.1, duck: true, fadeIn: 1, fadeOut: 2, start: 0 },
      },
    });
    const g = buildGraph({
      project: p,
      sourcePath: (id) => `/v/${id}.mp4`,
      overlayPath: () => '',
      musicPath: '/v/m.mp3',
      width: 1080,
      height: 1920,
      fpsText: '30',
      assFile: 'final.ass',
      fontsDir: 'fonts',
      video: true,
      audio: true,
      loudnorm: { i: -20, tp: -3, lra: 5, thresh: -30, offset: 0.1 },
    });
    expect(g.duration).toBe(8);
    expect(g.inputs).toHaveLength(3);
    expect(g.inputs[0].args).toEqual(['-ss', '0', '-t', '5.2', '-i', '/v/s1.mp4']);
    expect(g.filter).toContain('aevalsrc=0|0:s=48000:d=3'); // s2 has no audio
    expect(g.filter).toContain('concat=n=2:v=1:a=1');
    expect(g.filter).toContain('zoompan=');
    expect(g.filter).toContain('ass=filename=final.ass:fontsdir=fonts:shaping=complex');
    expect(g.filter).toContain('sidechaincompress');
    expect(g.filter).toContain('afftdn');
    expect(g.filter).toContain('measured_I=-20');
    expect(g.videoOut).toBe('vout');
    expect(g.audioOut).toBe('aout');
  });

  it('zoom expression eases in and out', () => {
    const z = zoomExpr([{ id: 'z', type: 'zoom', start: 2, duration: 1, scale: 1.1, x: 0.5, y: 0.4 }], 't');
    expect(z.z).toBe('1+0.1*clip((t-2)/0.15,0,1)*clip((3-t)/0.15,0,1)');
  });
});
