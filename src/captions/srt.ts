import { chapterTime, srtTime } from '../util/time.js';
import type { CaptionLine } from './captions.js';

export function buildSrt(lines: CaptionLine[], wordText: (t: string) => string = (t) => t): string {
  return (
    lines
      .map((l, i) => {
        const text = l.words
          .map((w, j) => (l.breakAt && j === l.breakAt ? '\n' : j > 0 ? ' ' : '') + wordText(w.t))
          .join('');
        return `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${text}\n`;
      })
      .join('\n') + '\n'
  );
}

export function buildVtt(lines: CaptionLine[]): string {
  const body = buildSrt(lines).replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
  return `WEBVTT\n\n${body}`;
}

export function buildChapters(chapters: Array<{ time: number; title: string }>): string {
  return chapters.map((c) => `${chapterTime(c.time)} ${c.title}`).join('\n') + '\n';
}
