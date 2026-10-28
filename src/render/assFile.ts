import { buildAss } from '../captions/ass.js';
import { captionEvents, captionSettings, groupLines, mapWordsToOutput } from '../captions/captions.js';
import { graphicEvents, graphicStyles } from '../motion/assGraphics.js';
import type { Project } from '../timeline/types.js';

/** Captions + text graphics for the whole project as one ASS file, or null if there is nothing to draw. */
export function projectAss(p: Project, W: number, H: number): string | null {
  const styles = graphicStyles(W, H, p.style);
  const events = graphicEvents(p.overlays, W, H, p.style);
  if (p.captions?.enabled && p.captions.words.length) {
    const cs = captionSettings(p.style, p.captions.overrides);
    const words = mapWordsToOutput(p.clips, p.captions.words);
    const lines = groupLines(words, cs);
    const cap = captionEvents(lines, W, H, p.style, p.captions.overrides);
    styles.push(...cap.styles);
    events.push(...cap.events);
  }
  if (events.length === 0) return null;
  return buildAss(W, H, styles, events);
}

export function captionLinesFor(p: Project) {
  if (!p.captions) return [];
  const cs = captionSettings(p.style, p.captions.overrides);
  return groupLines(mapWordsToOutput(p.clips, p.captions.words), cs);
}
