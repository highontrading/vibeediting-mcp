import type { Segment, Word } from '../transcribe/words.js';
import { norm } from '../transcribe/words.js';

export const DEFAULT_FILLERS = [
  // English
  'um',
  'umm',
  'ummm',
  'uh',
  'uhh',
  'uhm',
  'erm',
  'er',
  'ah',
  'ahh',
  'hmm',
  'hmmm',
  'mm',
  'mmm',
  // Hindi / Hinglish (Roman)
  'matlab',
  'basically',
  // Hindi (Devanagari)
  'अं',
  'अ',
  'उम',
  'उम्म',
  'उम्',
  'हम्म',
  'हम्',
  'मतलब',
  'बेसिकली',
];

/** These are only fillers at the start of a sentence or between pauses, not inside normal speech. */
const SOFT = new Set(['matlab', 'basically', 'मतलब', 'बेसिकली']);

export interface FillerHit {
  index: number;
  word: Word;
  kind: 'filler' | 'stutter';
}

export function findFillers(
  words: Word[],
  opts: { extra?: string[]; only?: string[]; stutters?: boolean } = {},
): FillerHit[] {
  const list = new Set((opts.only ?? [...DEFAULT_FILLERS, ...(opts.extra ?? [])]).map(norm).filter(Boolean));
  const hits: FillerHit[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const n = norm(w.t);
    if (!n) continue;
    if (list.has(n)) {
      if (SOFT.has(n) && !opts.only) {
        const prev = words[i - 1];
        const next = words[i + 1];
        const pausedBefore = !prev || w.s - prev.e > 0.25 || /[.?!,।]$/.test(prev.t);
        const pausedAfter = !next || next.s - w.e > 0.25 || /[,.]$/.test(w.t);
        if (!(pausedBefore || pausedAfter)) continue;
      }
      hits.push({ index: i, word: w, kind: 'filler' });
      continue;
    }
    // "I I think", "the the": drop the first copy.
    if (
      opts.stutters !== false &&
      i + 1 < words.length &&
      norm(words[i + 1].t) === n &&
      n.length <= 6 &&
      words[i + 1].s - w.e < 0.6
    ) {
      hits.push({ index: i, word: w, kind: 'stutter' });
    }
  }
  return hits;
}

export interface Retake {
  id: string;
  start: number;
  end: number;
  text: string;
  repeatedAt: number;
  repeatedText: string;
}

function tokens(text: string): string[] {
  return text.split(/\s+/).map(norm).filter(Boolean);
}

/**
 * Find sentences the speaker started, then said again: the earlier attempt is
 * probably a retake to remove. Returns suggestions only.
 */
export function findRetakes(segments: Segment[], maxDistance = 20): Retake[] {
  const out: Retake[] = [];
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    const ta = tokens(a.text);
    if (ta.length < 2) continue;
    for (let j = i + 1; j < Math.min(segments.length, i + 4); j++) {
      const b = segments[j];
      if (b.s - a.e > maxDistance) break;
      const tb = tokens(b.text);
      if (tb.length < 2) continue;
      const head = ta.slice(0, Math.min(8, ta.length));
      const setB = new Set(tb.slice(0, Math.max(12, head.length + 4)));
      const overlap = head.filter((t) => setB.has(t)).length / head.length;
      const sameStart = ta[0] === tb[0] || ta.slice(0, 2).join(' ') === tb.slice(0, 2).join(' ');
      if (overlap >= 0.6 && sameStart) {
        // Remove everything from the first attempt up to the start of the good take.
        out.push({
          id: `r${out.length + 1}`,
          start: a.s,
          end: b.s,
          text: segments
            .slice(i, j)
            .map((s) => s.text)
            .join(' '),
          repeatedAt: b.s,
          repeatedText: b.text,
        });
        i = j - 1;
        break;
      }
    }
  }
  return out;
}

export interface ShortCandidate {
  id: string;
  start: number;
  end: number;
  score: number;
  reasons: string[];
  text: string;
}

const HOOK_WORDS = [
  'how',
  'why',
  'what',
  'secret',
  'mistake',
  'mistakes',
  'never',
  'always',
  'stop',
  'best',
  'worst',
  'truth',
  'nobody',
  'everyone',
  'tip',
  'tips',
  'hack',
  'free',
  'money',
  'first',
  'kaise',
  'kyun',
  'kya',
  'galti',
  'sach',
  'raaz',
  'paisa',
  'paise',
  'sabse',
  'कैसे',
  'क्यों',
  'क्या',
  'गलती',
  'सच',
  'राज़',
  'पैसा',
  'सबसे',
].map(norm);

/** Rank 30-60 s windows that start and end on sentence boundaries. The agent picks from these. */
export function findShortCandidates(
  segments: Segment[],
  silences: Array<{ start: number; end: number }>,
  opts: { min?: number; max?: number; count?: number; keywords?: string[] } = {},
): ShortCandidate[] {
  const min = opts.min ?? 30;
  const max = opts.max ?? 60;
  const kws = (opts.keywords ?? []).map(norm).filter(Boolean);
  const windows: ShortCandidate[] = [];
  for (let i = 0; i < segments.length; i++) {
    let j = i;
    while (j < segments.length && segments[j].e - segments[i].s < min) j++;
    if (j >= segments.length) break;
    for (let k = j; k < segments.length && segments[k].e - segments[i].s <= max; k++) {
      const start = segments[i].s;
      const end = segments[k].e;
      const segs = segments.slice(i, k + 1);
      const text = segs.map((s) => s.text).join(' ');
      const reasons: string[] = [];
      let score = 0;
      const first = tokens(segs[0].text);
      if (/\?/.test(segs[0].text)) {
        score += 2;
        reasons.push('starts with a question');
      }
      if (first.some((t) => HOOK_WORDS.includes(t))) {
        score += 1.5;
        reasons.push('hook word in the first line');
      }
      if (/\d/.test(segs[0].text)) {
        score += 1;
        reasons.push('number in the first line');
      }
      if (/[.?!।]$/.test(segs[segs.length - 1].text)) score += 1;
      const words = tokens(text).length;
      const rate = words / (end - start);
      score += Math.min(2, rate / 1.6);
      const silent = silences.reduce(
        (a, s) => a + Math.max(0, Math.min(end, s.end) - Math.max(start, s.start)),
        0,
      );
      score -= (silent / (end - start)) * 4;
      if (kws.length) {
        const ts = new Set(tokens(text));
        const hits = kws.filter((k2) => ts.has(k2)).length;
        if (hits) {
          score += hits * 3;
          reasons.push(`mentions ${hits} of your keywords`);
        }
      }
      if (rate > 2.2) reasons.push('fast, dense speech');
      windows.push({ id: '', start, end, score: Math.round(score * 100) / 100, reasons, text });
    }
  }
  windows.sort((a, b) => b.score - a.score);
  const picked: ShortCandidate[] = [];
  for (const w of windows) {
    if (picked.some((p) => w.start < p.end && p.start < w.end)) continue;
    picked.push({ ...w, id: `m${picked.length + 1}` });
    if (picked.length >= (opts.count ?? 5)) break;
  }
  return picked;
}

/** Sentence starts spaced about `every` seconds apart: good spots for punch-in zooms. */
export function emphasisPoints(segments: Segment[], every: number, from = 1.5): number[] {
  const pts: number[] = [];
  let last = -Infinity;
  for (const s of segments) {
    if (s.s < from) continue;
    if (s.s - last >= every) {
      pts.push(s.s);
      last = s.s;
    }
  }
  return pts;
}
