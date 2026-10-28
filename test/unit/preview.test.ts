import { describe, expect, it } from 'vitest';
import { previewSlice } from '../../src/tools/output.js';
import { findPreset } from '../../src/styles/presets.js';
import type { Project } from '../../src/timeline/types.js';

const p: Project = {
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
  ],
  clips: [
    { id: 'c1', source: 's1', in: 0, out: 10 },
    { id: 'c2', source: 's1', in: 20, out: 40 },
  ],
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
  overlays: [
    { id: 'a', type: 'title', text: 'Before', position: 'center', start: 0, duration: 2 },
    { id: 'b', type: 'text', text: 'Spans', position: 'center', start: 8, duration: 4 },
    { id: 'c', type: 'zoom', start: 15, duration: 2, scale: 1.2, x: 0.5, y: 0.5 },
    { id: 'd', type: 'text', text: 'After', position: 'center', start: 25, duration: 2 },
  ],
  audio: { normalize: true, target: -14, denoise: 'off', music: null },
  log: [],
  nextId: 1,
};

describe('partial preview', () => {
  it('keeps only overlays in range and shifts them', () => {
    const s = previewSlice(p, 9, 20);
    expect(s.clips).toEqual([
      { id: 'c1', source: 's1', in: 9, out: 10 },
      { id: 'c2', source: 's1', in: 20, out: 30 },
    ]);
    const byId = Object.fromEntries(s.overlays.map((o) => [o.id, o]));
    expect(Object.keys(byId).sort()).toEqual(['b', 'c']);
    expect(byId.b).toMatchObject({ start: 0, duration: 3 });
    expect(byId.c).toMatchObject({ start: 6, duration: 2 });
    // The original project is not changed.
    expect(p.clips[0].in).toBe(0);
    expect(p.overlays).toHaveLength(4);
  });
});
