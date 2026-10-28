import { UserError } from '../util/errors.js';
import type { Clip, Overlay, Project } from './types.js';

export const MIN_CLIP = 0.05;

export function outputDuration(clips: Clip[]): number {
  return clips.reduce((a, c) => a + (c.out - c.in), 0);
}

/** Start time of every clip in the output. */
export function clipOffsets(clips: Clip[]): number[] {
  const offs: number[] = [];
  let t = 0;
  for (const c of clips) {
    offs.push(t);
    t += c.out - c.in;
  }
  return offs;
}

export interface SourcePoint {
  clipIndex: number;
  source: string;
  time: number;
}

/** Output time -> where it comes from in the sources. */
export function outputToSource(clips: Clip[], t: number): SourcePoint | null {
  let off = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const len = c.out - c.in;
    if (t < off + len || (i === clips.length - 1 && t <= off + len + 1e-6)) {
      return { clipIndex: i, source: c.source, time: c.in + Math.max(0, t - off) };
    }
    off += len;
  }
  return null;
}

/** Source time -> output time (first clip that contains it). */
export function sourceToOutput(clips: Clip[], source: string, time: number): number | null {
  let off = 0;
  for (const c of clips) {
    if (c.source === source && time >= c.in - 1e-6 && time <= c.out + 1e-6) return off + (time - c.in);
    off += c.out - c.in;
  }
  return null;
}

/** Like sourceToOutput, but if the moment was cut out, use the next moment that is still kept. */
export function sourceToOutputNearest(clips: Clip[], source: string, time: number): number | null {
  const exact = sourceToOutput(clips, source, time);
  if (exact !== null) return exact;
  let off = 0;
  let best: number | null = null;
  let bestIn = Infinity;
  for (const c of clips) {
    if (c.source === source && c.in >= time && c.in < bestIn) {
      bestIn = c.in;
      best = off;
    }
    off += c.out - c.in;
  }
  return best;
}

export type Range = { source: string; start: number; end: number };

/** Remove source ranges from the clips (splitting clips where needed). */
export function subtractRanges(clips: Clip[], ranges: Range[], newId: () => string): Clip[] {
  let result = clips.map((c) => ({ ...c }));
  for (const r of ranges) {
    if (r.end - r.start <= 0) continue;
    const next: Clip[] = [];
    for (const c of result) {
      if (c.source !== r.source || r.end <= c.in || r.start >= c.out) {
        next.push(c);
        continue;
      }
      if (r.start > c.in + MIN_CLIP) next.push({ ...c, out: r.start });
      if (r.end < c.out - MIN_CLIP) {
        const keepsId = !(r.start > c.in + MIN_CLIP);
        next.push({ ...c, id: keepsId ? c.id : newId(), in: r.end });
      }
    }
    result = next;
  }
  return result.filter((c) => c.out - c.in >= MIN_CLIP);
}

/** Output range -> the source ranges it covers. */
export function outputRangeToSource(clips: Clip[], start: number, end: number): Range[] {
  const out: Range[] = [];
  let off = 0;
  for (const c of clips) {
    const len = c.out - c.in;
    const a = Math.max(start, off);
    const b = Math.min(end, off + len);
    if (b > a) out.push({ source: c.source, start: c.in + (a - off), end: c.in + (b - off) });
    off += len;
  }
  return out;
}

/** Keep only [start, end] of the output. */
export function trimOutput(clips: Clip[], start: number, end: number): Clip[] {
  const total = outputDuration(clips);
  const s = Math.max(0, start);
  const e = Math.min(total, end);
  if (e - s < MIN_CLIP)
    throw new UserError('The trim would remove the whole video. Check the start and end times.');
  const out: Clip[] = [];
  let off = 0;
  for (const c of clips) {
    const len = c.out - c.in;
    const a = Math.max(s, off);
    const b = Math.min(e, off + len);
    if (b - a >= MIN_CLIP) out.push({ ...c, in: c.in + (a - off), out: c.in + (b - off) });
    off += len;
  }
  return out;
}

/** Split the clip under output time t into two clips. */
export function splitAt(
  clips: Clip[],
  t: number,
  newId: () => string,
): { clips: Clip[]; newClipId: string | null } {
  let off = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const len = c.out - c.in;
    if (t > off + MIN_CLIP && t < off + len - MIN_CLIP) {
      const at = c.in + (t - off);
      const id = newId();
      const copy = [...clips];
      copy.splice(i, 1, { ...c, out: at }, { ...c, id, in: at });
      return { clips: copy, newClipId: id };
    }
    off += len;
  }
  return { clips, newClipId: null };
}

export function reorderClips(clips: Clip[], order: string[]): Clip[] {
  const byId = new Map(clips.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: Clip[] = [];
  for (const id of order) {
    const c = byId.get(id);
    if (!c) throw new UserError(`There is no clip "${id}". Clip ids: ${clips.map((x) => x.id).join(', ')}.`);
    if (seen.has(id)) throw new UserError(`Clip "${id}" is listed twice.`);
    seen.add(id);
    out.push(c);
  }
  // Clips not mentioned keep their relative order at the end. Use cut_range to delete clips.
  for (const c of clips) if (!seen.has(c.id)) out.push(c);
  return out;
}

/**
 * After the clips change, move overlays so they stay on the same moment of the
 * source. Overlays at the very start stay at 0. Overlays whose moment was cut move to
 * the next kept moment; overlays past the new end are dropped.
 */
export function remapOverlays(
  oldClips: Clip[],
  newClips: Clip[],
  overlays: Overlay[],
): { overlays: Overlay[]; dropped: number } {
  const total = outputDuration(newClips);
  const out: Overlay[] = [];
  let dropped = 0;
  for (const o of overlays) {
    let start = o.start;
    if (o.start > 0.01) {
      const p = outputToSource(oldClips, o.start);
      const mapped = p ? sourceToOutputNearest(newClips, p.source, p.time) : null;
      if (mapped === null) {
        dropped++;
        continue;
      }
      start = mapped;
    }
    if (start >= total - 0.05) {
      dropped++;
      continue;
    }
    out.push({ ...o, start: Math.round(start * 1000) / 1000, duration: Math.min(o.duration, total - start) });
  }
  return { overlays: out, dropped };
}

/** Apply a clip change to a project and keep overlays in place. Returns a note for the log. */
export function applyClips(p: Project, newClips: Clip[]): string {
  if (newClips.length === 0) throw new UserError('This edit would remove everything. Nothing was changed.');
  const before = outputDuration(p.clips);
  const { overlays, dropped } = remapOverlays(p.clips, newClips, p.overlays);
  p.clips = newClips;
  p.overlays = overlays;
  const after = outputDuration(newClips);
  return `Length ${before.toFixed(1)} s -> ${after.toFixed(1)} s.${dropped ? ` ${dropped} overlay(s) were on removed parts and were dropped.` : ''}`;
}

/** Shrink silences by `keep` seconds on each side; drop the ones that get too short. */
export function silencesToCuts(
  silences: Array<{ start: number; end: number }>,
  opts: { minSilence: number; keep: number; duration: number },
): Array<{ start: number; end: number }> {
  const cuts: Array<{ start: number; end: number }> = [];
  for (const s of silences) {
    if (s.end - s.start < opts.minSilence) continue;
    const atStart = s.start <= 0.05;
    const atEnd = s.end >= opts.duration - 0.05;
    const a = atStart ? 0 : s.start + opts.keep;
    const b = atEnd ? opts.duration : s.end - opts.keep;
    if (b - a >= 0.08) cuts.push({ start: Math.round(a * 1000) / 1000, end: Math.round(b * 1000) / 1000 });
  }
  return cuts;
}
