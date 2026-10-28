import type { StyleSpec } from '../styles/presets.js';
import { fontHasDevanagari } from '../styles/presets.js';
import type { Clip, Project } from '../timeline/types.js';
import { type AssEvent, type AssStyle, assColor, assColorTag, assEscape, DEVANAGARI } from './ass.js';

export interface OutWord {
  t: string;
  s: number;
  e: number;
}

export interface CaptionLine {
  words: OutWord[];
  start: number;
  end: number;
  /** index where the second row starts (2-line captions) */
  breakAt?: number;
}

/** Map caption words (source time) through the clips into output time. Cut words disappear. */
export function mapWordsToOutput(
  clips: Clip[],
  words: Array<{ t: string; s: number; e: number; src: string }>,
): OutWord[] {
  const out: OutWord[] = [];
  let off = 0;
  for (const c of clips) {
    for (const w of words) {
      if (w.src !== c.source) continue;
      const mid = (w.s + w.e) / 2;
      if (mid < c.in || mid >= c.out) continue;
      const s = off + Math.max(w.s, c.in) - c.in;
      const e = off + Math.min(w.e, c.out) - c.in;
      out.push({ t: w.t, s, e: Math.max(e, s + 0.05) });
    }
    off += c.out - c.in;
  }
  return out.sort((a, b) => a.s - b.s);
}

export interface CaptionSettings {
  maxWordsPerLine: number;
  lines: 1 | 2;
  uppercase: boolean;
  punctuation: boolean;
}

export function displayWord(t: string, cs: CaptionSettings): string {
  let w = t;
  if (!cs.punctuation) w = w.replace(/^[,.;:"'“”‘’]+|[,.;:"'“”‘’।]+$/g, '');
  if (cs.uppercase) w = w.toLocaleUpperCase('en');
  return w;
}

/** Group words into caption lines: by word count, pauses and sentence ends. */
export function groupLines(words: OutWord[], cs: CaptionSettings, maxGap = 0.6): CaptionLine[] {
  const perLine = Math.max(1, cs.maxWordsPerLine);
  const perGroup = perLine * cs.lines;
  const maxChars = perLine * 9;
  const lines: CaptionLine[] = [];
  let cur: OutWord[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    lines.push({ words: cur, start: cur[0].s, end: cur[cur.length - 1].e });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((a, x) => a + x.t.length + 1, 0) + w.t.length;
    if (
      prev &&
      (w.s - prev.e > maxGap ||
        /[.?!।]$/.test(prev.t) ||
        cur.length >= perGroup ||
        chars > maxChars * cs.lines)
    )
      flush();
    cur.push(w);
  }
  flush();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1];
    l.end = Math.max(l.end + 0.25, l.start + 0.4);
    if (next && l.end > next.start) l.end = next.start;
    if (cs.lines === 2 && l.words.length > perLine) l.breakAt = Math.ceil(l.words.length / 2);
  }
  return lines;
}

export interface CaptionLayout {
  width: number;
  height: number;
  style: StyleSpec;
  overrides?: Project['captions'] extends infer C ? (C extends { overrides: infer O } ? O : never) : never;
}

/** Resolved caption settings: style + per-project overrides. */
export function captionSettings(style: StyleSpec, overrides: Record<string, any> = {}) {
  const c = { ...style.caption, ...stripUndefined(overrides) };
  return {
    ...c,
    font: (overrides.font as string) ?? style.fonts.caption,
    textColor: (overrides.textColor as string) ?? style.colors.text,
    highlightColor: (overrides.highlightColor as string) ?? style.colors.highlight,
  };
}

function stripUndefined(o: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
}

/** Build the caption style + events. */
export function captionEvents(
  lines: CaptionLine[],
  width: number,
  height: number,
  style: StyleSpec,
  overrides: Record<string, any> = {},
): { styles: AssStyle[]; events: AssEvent[] } {
  const cs = captionSettings(style, overrides);
  const vertical = height > width;
  const short = Math.min(width, height);
  const size = cs.size * short * (vertical ? 1 : 0.85);
  const safe = vertical ? style.safeMargins.vertical : style.safeMargins.horizontal;
  let alignment = 2;
  let marginV = safe.bottom * height;
  if (cs.position === 'lower') marginV = (vertical ? 0.3 : 0.16) * height;
  if (cs.position === 'middle') {
    alignment = 5;
    marginV = 0;
  }
  if (cs.position === 'top') {
    alignment = 8;
    marginV = safe.top * height + size * 0.3;
  }
  const side = safe.side * width;
  const capStyle: AssStyle = {
    name: 'Caption',
    font: cs.font,
    size,
    primary: cs.highlight === 'karaoke' ? assColor(cs.highlightColor) : assColor(cs.textColor),
    secondary: assColor(cs.textColor),
    outlineColor: cs.box ? assColor(style.colors.box) : assColor(style.colors.outline),
    back: cs.box ? assColor(style.colors.box) : assColor(style.colors.shadow, 96),
    borderStyle: cs.box ? 3 : 1,
    outline: cs.box ? size * 0.22 : cs.outline * size,
    shadow: cs.box ? 0 : cs.shadow * size,
    alignment,
    marginL: side,
    marginR: side,
    marginV,
  };
  const needsDeva = !fontHasDevanagari(cs.font);
  const fnFor = (t: string) => (needsDeva && DEVANAGARI.test(t) ? style.fonts.devanagari : null);
  const wordText = (raw: string, active: boolean, popNow: boolean): string => {
    const shown = assEscape(displayWord(raw, cs));
    const fn = fnFor(raw);
    let open = '';
    let close = '';
    if (fn) {
      open += `{\\fn${fn}}`;
      close = `{\\fn${cs.font}}` + close;
    }
    if (active) {
      const pop = popNow ? `\\t(0,70,\\fscx116\\fscy116)\\t(70,150,\\fscx108\\fscy108)` : '';
      open += `{\\c${assColorTag(cs.highlightColor)}${pop}}`;
      close = `{\\c${assColorTag(cs.textColor)}\\fscx100\\fscy100}` + close;
    }
    return open + shown + close;
  };
  const joinWords = (l: CaptionLine, render: (w: OutWord, i: number) => string) =>
    l.words.map((w, i) => (l.breakAt && i === l.breakAt ? '\\N' : i > 0 ? ' ' : '') + render(w, i)).join('');

  const events: AssEvent[] = [];
  for (const l of lines) {
    const visible = l.words.filter((w) => displayWord(w.t, cs).length > 0);
    if (visible.length === 0) continue;
    if (cs.highlight === 'none') {
      events.push({
        start: l.start,
        end: l.end,
        style: 'Caption',
        text: joinWords(l, (w) => wordText(w.t, false, false)),
      });
    } else if (cs.highlight === 'karaoke') {
      let k = '';
      let t = l.start;
      l.words.forEach((w, i) => {
        const lead = Math.max(0, Math.round((w.s - t) * 100));
        const dur = Math.max(1, Math.round((w.e - Math.max(w.s, t)) * 100));
        if (lead > 0) k += `{\\k${lead}}`;
        k +=
          (l.breakAt && i === l.breakAt ? '\\N' : i > 0 ? ' ' : '') +
          `{\\kf${dur}}` +
          wordText(w.t, false, false);
        t = w.e;
      });
      events.push({ start: l.start, end: l.end, style: 'Caption', text: k });
    } else {
      // One event per word: the line stays, the current word changes colour (and pops).
      for (let i = 0; i < l.words.length; i++) {
        const w = l.words[i];
        const s = i === 0 ? l.start : w.s;
        const e = i + 1 < l.words.length ? l.words[i + 1].s : l.end;
        if (e - s < 0.01) continue;
        if (cs.highlight === 'single') {
          const pop = cs.pop
            ? '{\\fscx70\\fscy70\\t(0,90,\\fscx108\\fscy108)\\t(90,160,\\fscx100\\fscy100)}'
            : '';
          events.push({ start: s, end: e, style: 'Caption', text: pop + wordText(w.t, true, false) });
        } else {
          events.push({
            start: s,
            end: e,
            style: 'Caption',
            text: joinWords(l, (x, j) => wordText(x.t, j === i, cs.pop && j === i)),
          });
        }
      }
    }
  }
  return { styles: [capStyle], events };
}
