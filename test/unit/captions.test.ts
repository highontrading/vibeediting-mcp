import { describe, expect, it } from 'vitest';
import { assColor, assColorTag, assEscape, buildAss } from '../../src/captions/ass.js';
import { captionEvents, displayWord, groupLines, mapWordsToOutput } from '../../src/captions/captions.js';
import { buildChapters, buildSrt } from '../../src/captions/srt.js';
import { findPreset } from '../../src/styles/presets.js';
import { assTime, chapterTime, srtTime } from '../../src/util/time.js';

const words = (texts: string[], step = 0.5, src = 's1') =>
  texts.map((t, i) => ({ t, s: i * step, e: i * step + step * 0.8, src }));

describe('caption timing', () => {
  it('maps words through cuts and drops cut words', () => {
    const clips = [
      { id: 'c1', source: 's1', in: 0, out: 1.0 },
      { id: 'c2', source: 's1', in: 2.0, out: 3.0 },
    ];
    const out = mapWordsToOutput(clips, words(['a', 'b', 'c', 'd', 'e', 'f']));
    // words at 0, .5 (kept, clip1), 1.0, 1.5 (cut), 2.0, 2.5 (clip2 -> output 1.0, 1.5)
    expect(out.map((w) => w.t)).toEqual(['a', 'b', 'e', 'f']);
    expect(out[2].s).toBeCloseTo(1.0);
    expect(out[3].s).toBeCloseTo(1.5);
  });

  it('groups lines by word count, pauses and sentence ends', () => {
    const w = [
      { t: 'one', s: 0, e: 0.3 },
      { t: 'two', s: 0.35, e: 0.6 },
      { t: 'three.', s: 0.65, e: 0.9 },
      { t: 'four', s: 1.0, e: 1.2 },
      { t: 'five', s: 3.0, e: 3.2 }, // long pause before
    ];
    const lines = groupLines(w, { maxWordsPerLine: 5, lines: 1, uppercase: false, punctuation: true });
    expect(lines.map((l) => l.words.map((x) => x.t).join(' '))).toEqual(['one two three.', 'four', 'five']);
    // A line never overlaps the next one.
    for (let i = 0; i + 1 < lines.length; i++) expect(lines[i].end).toBeLessThanOrEqual(lines[i + 1].start);
  });

  it('respects max words per line', () => {
    const w = words(['a', 'b', 'c', 'd', 'e', 'f', 'g']).map(({ src: _src, ...x }) => x);
    const lines = groupLines(w, { maxWordsPerLine: 3, lines: 1, uppercase: false, punctuation: true });
    expect(lines.map((l) => l.words.length)).toEqual([3, 3, 1]);
  });

  it('formats display words', () => {
    expect(displayWord('hello,', { maxWordsPerLine: 3, lines: 1, uppercase: true, punctuation: false })).toBe(
      'HELLO',
    );
    expect(
      displayWord('नमस्ते।', { maxWordsPerLine: 3, lines: 1, uppercase: true, punctuation: false }),
    ).toBe('नमस्ते');
    expect(displayWord('why?', { maxWordsPerLine: 3, lines: 1, uppercase: false, punctuation: false })).toBe(
      'why?',
    );
  });

  it('makes one event per word with the active word highlighted', () => {
    const style = findPreset('bold-yellow-pop')!;
    const lines = groupLines(
      words(['hey', 'there', 'friend']).map(({ src: _s, ...x }) => x),
      { ...style.caption, maxWordsPerLine: 3 },
    );
    const { events, styles } = captionEvents(lines, 1080, 1920, style);
    expect(styles[0].name).toBe('Caption');
    expect(events).toHaveLength(3);
    expect(events[1].text).toContain(assColorTag(style.colors.highlight));
    expect(events[1].text).toContain('THERE');
    expect(events[0].end).toBeCloseTo(events[1].start);
  });

  it('switches to a Devanagari font when the caption font has none', () => {
    const style = findPreset('impact-red')!; // Anton: Latin only
    const lines = groupLines([{ t: 'नमस्ते', s: 0, e: 0.5 }], { ...style.caption });
    const { events } = captionEvents(lines, 1080, 1920, style);
    expect(events[0].text).toContain(`\\fn${style.fonts.devanagari}`);
  });

  it('karaoke mode writes \\kf tags in one event', () => {
    const style = findPreset('bold-yellow-pop')!;
    const lines = groupLines(
      words(['a', 'b']).map(({ src: _s, ...x }) => x),
      { ...style.caption },
    );
    const { events } = captionEvents(lines, 1080, 1920, style, { highlight: 'karaoke' });
    expect(events).toHaveLength(1);
    expect(events[0].text).toMatch(/\\kf\d+/);
  });
});

describe('ASS and subtitle formats', () => {
  it('converts colours to ASS order', () => {
    expect(assColor('#FFE600')).toBe('&H0000E6FF&');
    expect(assColor('#000000B3')).toBe('&H4C000000&');
    expect(assColorTag('#123456')).toBe('&H563412&');
  });
  it('escapes braces and backslashes', () => {
    expect(assEscape('a{b}c\\N\nx')).toBe('a(b)c⧵N\\Nx');
  });
  it('writes valid times', () => {
    expect(assTime(3725.456)).toBe('1:02:05.46');
    expect(srtTime(3725.456)).toBe('01:02:05,456');
    expect(chapterTime(65.9)).toBe('1:05');
    expect(chapterTime(3725)).toBe('1:02:05');
  });
  it('builds an ASS file with sorted events', () => {
    const ass = buildAss(
      1080,
      1920,
      [],
      [
        { start: 2, end: 3, style: 'X', text: 'second' },
        { start: 1, end: 2, style: 'X', text: 'first' },
        { start: 5, end: 5, style: 'X', text: 'empty' },
      ],
    );
    expect(ass).toContain('PlayResX: 1080');
    expect(ass.indexOf('first')).toBeLessThan(ass.indexOf('second'));
    expect(ass).not.toContain('empty');
  });
  it('builds SRT and chapters', () => {
    const srt = buildSrt([
      {
        words: [
          { t: 'Hello', s: 0, e: 0.5 },
          { t: 'world', s: 0.5, e: 1 },
        ],
        start: 0,
        end: 1.2,
      },
    ]);
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,200\nHello world\n\n');
    expect(
      buildChapters([
        { time: 0, title: 'Intro' },
        { time: 75, title: 'Tips' },
      ]),
    ).toBe('0:00 Intro\n1:15 Tips\n');
  });
});
