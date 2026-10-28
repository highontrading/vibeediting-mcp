export interface Word {
  /** text */
  t: string;
  /** start, seconds (source time) */
  s: number;
  /** end, seconds */
  e: number;
}

export interface Segment {
  s: number;
  e: number;
  text: string;
  /** word index range [w0, w1) */
  w0: number;
  w1: number;
}

export interface RawToken {
  text: string;
  t0: number; // ms
  t1: number; // ms
}

/**
 * whisper.cpp with maxLen=1 gives one "segment" per token. Hindi letters are often split
 * across tokens, so per-token text can be broken UTF-8. The full result text is always
 * correct, and every token that starts a word begins with a space. So we take word
 * TEXT from the full result and word TIMING from the tokens.
 */
export function wordsFromTokens(tokens: RawToken[], fullText: string, offsetSec = 0): Word[] {
  const clean = tokens.filter((t) => t.text.length > 0 && !/^\s*\[_?[A-Z_]+[^\]]*\]\s*$/.test(t.text));
  const groups: RawToken[][] = [];
  for (const tok of clean) {
    if (groups.length === 0 || /^\s/.test(tok.text)) groups.push([tok]);
    else groups[groups.length - 1].push(tok);
  }
  const texts = fullText.trim().split(/\s+/).filter(Boolean);
  const words: Word[] = [];
  if (groups.length === texts.length) {
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      words.push({ t: texts[i], s: g[0].t0 / 1000 + offsetSec, e: g[g.length - 1].t1 / 1000 + offsetSec });
    }
  } else if (clean.length > 0 && texts.length > 0) {
    // Fallback: spread the words over the spoken span by character length.
    const start = clean[0].t0 / 1000;
    const end = clean[clean.length - 1].t1 / 1000;
    const total = texts.reduce((a, w) => a + w.length + 1, 0);
    let pos = start;
    for (const w of texts) {
      const d = ((w.length + 1) / total) * (end - start);
      words.push({ t: w, s: pos + offsetSec, e: pos + d + offsetSec });
      pos += d;
    }
  }
  return fixWordTimes(words);
}

/** Make times monotonic and give every word a minimum length. */
export function fixWordTimes(words: Word[]): Word[] {
  let last = 0;
  for (const w of words) {
    if (!Number.isFinite(w.s)) w.s = last;
    if (w.s < last) w.s = last;
    if (!Number.isFinite(w.e) || w.e < w.s + 0.04) w.e = w.s + 0.04;
    w.s = Math.round(w.s * 1000) / 1000;
    w.e = Math.round(w.e * 1000) / 1000;
    last = w.s;
  }
  return words;
}

const SENTENCE_END = /[.?!।॥]["')\]]*$/;

/** Group words into sentence-like segments for reading and searching. */
export function buildSegments(
  words: Word[],
  opts: { maxGap?: number; maxDur?: number; maxWords?: number } = {},
): Segment[] {
  const maxGap = opts.maxGap ?? 0.8;
  const maxDur = opts.maxDur ?? 12;
  const maxWords = opts.maxWords ?? 30;
  const segs: Segment[] = [];
  let w0 = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const dur = w.e - words[w0].s;
    const gap = next ? next.s - w.e : Infinity;
    if (!next || SENTENCE_END.test(w.t) || gap > maxGap || dur > maxDur || i + 1 - w0 >= maxWords) {
      segs.push({
        s: words[w0].s,
        e: w.e,
        text: words
          .slice(w0, i + 1)
          .map((x) => x.t)
          .join(' '),
        w0,
        w1: i + 1,
      });
      w0 = i + 1;
    }
  }
  return segs;
}

const HALLUCINATIONS = [
  /thank(s| you) for watching/i,
  /please subscribe/i,
  /subtitles? (by|created)/i,
  /amara\.org/i,
  /transcribed by/i,
  /सब्सक्राइब/,
];

/** Remove typical Whisper hallucinations in silent parts and runaway repeats. */
export function cleanHallucinations(
  words: Word[],
  silences: Array<{ start: number; end: number }> = [],
): { words: Word[]; removed: number } {
  const longSil = silences.filter((s) => s.end - s.start >= 2);
  const inSilence = (w: Word) => longSil.some((s) => w.s >= s.start + 0.2 && w.e <= s.end - 0.2);
  let kept = words.filter((w) => !inSilence(w));
  // Phrase-level hallucinations.
  const segs = buildSegments(kept);
  const drop = new Set<number>();
  for (const seg of segs) {
    if (HALLUCINATIONS.some((re) => re.test(seg.text)) && seg.w1 - seg.w0 <= 8)
      for (let i = seg.w0; i < seg.w1; i++) drop.add(i);
  }
  // The same word repeated more than 6 times in a row.
  let run = 1;
  for (let i = 1; i < kept.length; i++) {
    if (norm(kept[i].t) === norm(kept[i - 1].t) && norm(kept[i].t) !== '') {
      run++;
      if (run > 6) drop.add(i);
    } else run = 1;
  }
  kept = kept.filter((_, i) => !drop.has(i));
  return { words: kept, removed: words.length - kept.length };
}

export function norm(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}

/** Share of letters that are Arabic script (Whisper sometimes writes Hindi in Urdu script). */
export function arabicShare(text: string): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return 0;
  const arabic = text.match(/[؀-ۿݐ-ݿ]/g)?.length ?? 0;
  return arabic / letters;
}

export function devanagariShare(text: string): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return 0;
  return (text.match(/[ऀ-ॿ]/g)?.length ?? 0) / letters;
}
