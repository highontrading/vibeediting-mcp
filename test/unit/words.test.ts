import { describe, expect, it } from 'vitest';
import {
  arabicShare,
  buildSegments,
  cleanHallucinations,
  devanagariShare,
  wordsFromTokens,
} from '../../src/transcribe/words.js';

describe('word timestamps from whisper tokens', () => {
  it('merges tokens into words using leading spaces (English)', () => {
    const tokens = [
      { text: '', t0: 0, t1: 200 },
      { text: ' And', t0: 220, t1: 330 },
      { text: ' fell', t0: 450, t1: 600 },
      { text: 'ow', t0: 600, t1: 700 },
      { text: ' Americans', t0: 700, t1: 1500 },
      { text: ',', t0: 1500, t1: 1600 },
    ];
    const w = wordsFromTokens(tokens, ' And fellow Americans,');
    expect(w.map((x) => x.t)).toEqual(['And', 'fellow', 'Americans,']);
    expect(w[1]).toMatchObject({ s: 0.45, e: 0.7 });
    expect(w[2].e).toBeCloseTo(1.6);
  });

  it('takes Hindi text from the full result when tokens split letters', () => {
    // Token text is broken UTF-8 (shown as U+FFFD) but the full result is correct.
    const tokens = [
      { text: ' म', t0: 50, t1: 130 },
      { text: 'े', t0: 130, t1: 410 },
      { text: ' �', t0: 1170, t1: 1430 },
      { text: '�ा', t0: 1430, t1: 1690 },
      { text: 'ना', t0: 1690, t1: 1820 },
    ];
    const w = wordsFromTokens(tokens, ' मे खाना');
    expect(w.map((x) => x.t)).toEqual(['मे', 'खाना']);
    expect(w[1].s).toBeCloseTo(1.17);
    expect(w[1].e).toBeCloseTo(1.82);
  });

  it('falls back to spreading words if counts do not match', () => {
    const w = wordsFromTokens([{ text: 'abc', t0: 0, t1: 1000 }], 'one two');
    expect(w).toHaveLength(2);
    expect(w[0].s).toBe(0);
    expect(w[1].e).toBeCloseTo(1);
  });

  it('builds sentence segments', () => {
    const w = [
      { t: 'Hi', s: 0, e: 0.3 },
      { t: 'there.', s: 0.3, e: 0.6 },
      { t: 'New', s: 0.7, e: 0.9 },
      { t: 'line', s: 2.5, e: 2.8 },
    ];
    expect(buildSegments(w).map((s) => s.text)).toEqual(['Hi there.', 'New', 'line']);
  });

  it('removes hallucinations in long silences and runaway repeats', () => {
    const w = [
      { t: 'real', s: 0, e: 0.5 },
      { t: 'ghost', s: 5, e: 5.5 },
      ...Array.from({ length: 10 }, (_, i) => ({ t: 'la', s: 10 + i * 0.2, e: 10.1 + i * 0.2 })),
    ];
    const r = cleanHallucinations(w, [{ start: 3, end: 8 }]);
    expect(r.words.map((x) => x.t)).not.toContain('ghost');
    expect(r.words.filter((x) => x.t === 'la').length).toBe(6);
  });

  it('detects Urdu script output for Hindi audio', () => {
    expect(arabicShare('مجر کنگھانا مدیساگر')).toBeGreaterThan(0.9);
    expect(arabicShare('नमस्ते दोस्तों')).toBe(0);
    expect(devanagariShare('नमस्ते friends')).toBeGreaterThan(0.3);
  });
});
