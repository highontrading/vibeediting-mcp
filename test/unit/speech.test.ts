import { describe, expect, it } from 'vitest';
import { emphasisPoints, findFillers, findRetakes, findShortCandidates } from '../../src/analysis/speech.js';
import { buildSegments } from '../../src/transcribe/words.js';

const W = (text: string, gap = 0.1, dur = 0.3) => {
  let t = 0;
  return text.split(' ').map((w) => {
    const word = { t: w, s: t, e: t + dur };
    t += dur + gap;
    return word;
  });
};

describe('fillers', () => {
  it('finds English and Hindi fillers and stutters', () => {
    const words = W('so um I I think uh matlab yeh अं theek hai');
    const hits = findFillers(words);
    expect(hits.map((h) => h.word.t)).toEqual(['um', 'I', 'uh', 'अं']);
    expect(hits.find((h) => h.word.t === 'I')?.kind).toBe('stutter');
  });
  it('removes soft fillers like "matlab" only next to a pause', () => {
    const words = W('matlab', 0, 0.3);
    words.push({ t: 'yeh', s: 1.0, e: 1.3 });
    expect(findFillers(words).map((h) => h.word.t)).toEqual(['matlab']);
  });
  it('supports a custom list', () => {
    expect(findFillers(W('like you know like'), { only: ['like'] }).length).toBe(2);
  });
});

describe('retakes', () => {
  it('finds a sentence said twice', () => {
    const words = [...W('Today I will show you how to').map((w) => w)];
    const segs = [
      { s: 0, e: 2, text: 'Today I will show you how to', w0: 0, w1: 7 },
      { s: 3, e: 6, text: 'Today I will show you how to edit videos fast.', w0: 7, w1: 16 },
      { s: 7, e: 9, text: 'Let us start.', w0: 16, w1: 19 },
    ];
    void words;
    const r = findRetakes(segs);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ start: 0, end: 3 });
  });
  it('does not flag different sentences', () => {
    const segs = [
      { s: 0, e: 2, text: 'I love editing.', w0: 0, w1: 3 },
      { s: 3, e: 5, text: 'Captions help reach.', w0: 3, w1: 6 },
    ];
    expect(findRetakes(segs)).toHaveLength(0);
  });
});

describe('shorts and emphasis', () => {
  it('ranks windows that start with a hook', () => {
    const segs: any[] = [];
    let t = 0;
    for (let i = 0; i < 30; i++) {
      const text = i === 10 ? 'Why do most creators fail?' : `This is sentence number ${i} about editing.`;
      segs.push({ s: t, e: t + 4, text, w0: 0, w1: 0 });
      t += 4.2;
    }
    const c = findShortCandidates(segs, [], { min: 20, max: 40, count: 3 });
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].text.startsWith('Why do most creators fail?')).toBe(true);
    expect(c[0].reasons).toContain('starts with a question');
    for (const x of c) expect(x.end - x.start).toBeLessThanOrEqual(40);
  });
  it('places emphasis points apart', () => {
    const segs = buildSegments(W('a. b. c. d. e. f. g. h. i. j. k. l.', 0.6, 0.4));
    const pts = emphasisPoints(segs, 3);
    for (let i = 1; i < pts.length; i++) expect(pts[i] - pts[i - 1]).toBeGreaterThanOrEqual(3);
  });
});
