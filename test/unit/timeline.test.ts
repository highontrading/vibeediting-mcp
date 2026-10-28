import { describe, expect, it } from 'vitest';
import {
  outputDuration,
  outputRangeToSource,
  outputToSource,
  remapOverlays,
  reorderClips,
  silencesToCuts,
  sourceToOutput,
  splitAt,
  subtractRanges,
  trimOutput,
} from '../../src/timeline/ops.js';
import type { Clip, Overlay } from '../../src/timeline/types.js';

let n = 100;
const id = () => `c${n++}`;
const base: Clip[] = [{ id: 'c1', source: 's1', in: 0, out: 20 }];

describe('timeline maths', () => {
  it('subtracts ranges and splits clips', () => {
    const r = subtractRanges(base, [{ source: 's1', start: 5, end: 7 }], id);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ id: 'c1', in: 0, out: 5 });
    expect(r[1]).toMatchObject({ in: 7, out: 20 });
    expect(outputDuration(r)).toBeCloseTo(18);
  });

  it('removing the start keeps the clip id', () => {
    const r = subtractRanges(base, [{ source: 's1', start: 0, end: 2 }], id);
    expect(r).toEqual([{ id: 'c1', source: 's1', in: 2, out: 20 }]);
  });

  it('ignores ranges of other sources and empty ranges', () => {
    expect(
      subtractRanges(
        base,
        [
          { source: 's2', start: 1, end: 3 },
          { source: 's1', start: 4, end: 4 },
        ],
        id,
      ),
    ).toEqual(base);
  });

  it('drops slivers shorter than 50 ms', () => {
    const r = subtractRanges(base, [{ source: 's1', start: 0.02, end: 19.99 }], id);
    expect(r).toHaveLength(0);
  });

  it('maps output time to source time and back across cuts', () => {
    const clips = subtractRanges(
      base,
      [
        { source: 's1', start: 5, end: 7 },
        { source: 's1', start: 10, end: 12 },
      ],
      id,
    );
    // Output: [0-5]=s1 0-5, [5-8]=s1 7-10, [8-16]=s1 12-20
    expect(outputToSource(clips, 6)).toMatchObject({ source: 's1', time: 8 });
    expect(outputToSource(clips, 9)).toMatchObject({ time: 13 });
    expect(sourceToOutput(clips, 's1', 13)).toBeCloseTo(9);
    expect(sourceToOutput(clips, 's1', 6)).toBeNull(); // cut out
    expect(outputToSource(clips, 16)).toMatchObject({ time: 20 }); // very end
    expect(outputRangeToSource(clips, 4, 9)).toEqual([
      { source: 's1', start: 4, end: 5 },
      { source: 's1', start: 7, end: 10 },
      { source: 's1', start: 12, end: 13 },
    ]);
  });

  it('trims the output', () => {
    const clips = subtractRanges(base, [{ source: 's1', start: 5, end: 7 }], id);
    const t = trimOutput(clips, 3, 10);
    expect(outputDuration(t)).toBeCloseTo(7);
    expect(t[0]).toMatchObject({ in: 3, out: 5 });
    expect(t[1]).toMatchObject({ in: 7, out: 12 });
    expect(() => trimOutput(clips, 5, 5)).toThrow();
  });

  it('splits and reorders', () => {
    const { clips, newClipId } = splitAt(base, 8, id);
    expect(clips).toHaveLength(2);
    expect(clips[1]).toMatchObject({ id: newClipId, in: 8, out: 20 });
    const r = reorderClips(clips, [newClipId!]);
    expect(r[0].id).toBe(newClipId);
    expect(r[1].id).toBe('c1');
    expect(() => reorderClips(clips, ['nope'])).toThrow(/no clip/);
    expect(splitAt(base, 0.01, id).newClipId).toBeNull();
  });

  it('moves overlays with the cuts', () => {
    const overlays: Overlay[] = [
      { id: 'o1', type: 'title', text: 'Hi', position: 'center', start: 0, duration: 2 },
      { id: 'o2', type: 'text', text: 'At 10', position: 'center', start: 10, duration: 2 },
      { id: 'o3', type: 'text', text: 'In cut', position: 'center', start: 6, duration: 1 },
      { id: 'o4', type: 'text', text: 'End', position: 'center', start: 19.5, duration: 1 },
    ];
    const after = subtractRanges(
      base,
      [
        { source: 's1', start: 5, end: 7 },
        { source: 's1', start: 18, end: 20 },
      ],
      id,
    );
    const { overlays: moved, dropped } = remapOverlays(base, after, overlays);
    const byId = Object.fromEntries(moved.map((o) => [o.id, o]));
    expect(byId.o1.start).toBe(0);
    expect(byId.o2.start).toBeCloseTo(8); // 10 - 2 s cut before it
    expect(byId.o3.start).toBeCloseTo(5); // its moment was cut: moves to the next kept moment
    expect(byId.o4).toBeUndefined(); // tail was cut
    expect(dropped).toBe(1);
  });

  it('turns silences into cuts with natural pauses kept', () => {
    const cuts = silencesToCuts(
      [
        { start: 0, end: 1.2 },
        { start: 3, end: 3.3 },
        { start: 5, end: 6 },
        { start: 9.5, end: 10 },
      ],
      { minSilence: 0.4, keep: 0.1, duration: 10 },
    );
    expect(cuts).toEqual([
      { start: 0, end: 1.1 }, // leading silence cut fully, pause kept before speech
      { start: 5.1, end: 5.9 },
      { start: 9.6, end: 10 }, // trailing silence cut to the end
    ]);
  });
});
