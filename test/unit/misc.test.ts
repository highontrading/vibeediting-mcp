import { describe, expect, it } from 'vitest';
import { JobManager } from '../../src/jobs.js';
import { FONTS, PRESETS } from '../../src/styles/presets.js';
import { mergeStyle, validateStyle } from '../../src/styles/store.js';
import { slugify } from '../../src/util/fsx.js';
import { fmtTime, parseTime } from '../../src/util/time.js';
import { INSTRUCTIONS } from '../../src/instructions.js';

describe('styles', () => {
  it('every preset is valid and uses bundled fonts', () => {
    for (const p of PRESETS) {
      expect(() => validateStyle(p)).not.toThrow();
      for (const f of Object.values(p.fonts)) expect(FONTS[f]).toBeDefined();
      expect(FONTS[p.fonts.devanagari].devanagari).toBe(true);
    }
    expect(PRESETS.length).toBeGreaterThanOrEqual(4);
  });
  it('merges partial styles and rejects bad colours', () => {
    const s = mergeStyle(PRESETS[0], {
      colors: { highlight: '#00FF00' },
      caption: { maxWordsPerLine: 2 },
      unknown: 1,
    });
    expect(s.colors.highlight).toBe('#00FF00');
    expect(s.caption.maxWordsPerLine).toBe(2);
    expect(s.caption.size).toBe(PRESETS[0].caption.size);
    expect(() => mergeStyle(PRESETS[0], { colors: { text: 'yellow' } })).toThrow(/#FFD400/);
    expect(() => mergeStyle(PRESETS[0], { fonts: { caption: 'Comic Sans' } })).toThrow(/not available/);
  });
});

describe('small helpers', () => {
  it('parses times', () => {
    expect(parseTime(12.5)).toBe(12.5);
    expect(parseTime('1:05')).toBe(65);
    expect(parseTime('1:02:03.5')).toBe(3723.5);
    expect(parseTime('75s')).toBe(75);
    expect(() => parseTime('abc')).toThrow();
    expect(fmtTime(75.5)).toBe('1:15.5');
    expect(fmtTime(59.96)).toBe('1:00.0');
  });
  it('slugifies names in any script', () => {
    expect(slugify('My Reel (final).mp4')).toBe('My-Reel-final');
    expect(slugify('मेरा वीडियो.mov')).toBe('मेरा-वीडियो');
    expect(slugify('***')).toBe('project');
  });
  it('server instructions fit the 4,096 character limit', () => {
    expect(INSTRUCTIONS.length).toBeLessThan(4000);
  });
});

describe('jobs', () => {
  it('runs jobs one at a time and reports progress', async () => {
    const jm = new JobManager(1);
    const order: string[] = [];
    const a = jm.start('t', 'A', async (ctl) => {
      order.push('a-start');
      ctl.progress(0.5, 'half');
      await new Promise((r) => setTimeout(r, 50));
      order.push('a-end');
      return { content: [{ type: 'text', text: 'A done' }] };
    });
    const b = jm.start('t', 'B', async () => {
      order.push('b-start');
      return { content: [{ type: 'text', text: 'B done' }] };
    });
    expect(jm.get(b.id)?.status).toBe('queued');
    await jm.wait(b.id, 2000);
    expect(order).toEqual(['a-start', 'a-end', 'b-start']);
    expect(jm.get(a.id)?.result?.content[0].text).toBe('A done');
  });
  it('returns early when waiting times out, and can cancel', async () => {
    const jm = new JobManager(1);
    const j = jm.start('t', 'slow', async (ctl) => {
      await new Promise((r, rej) => {
        const t = setTimeout(r, 5000);
        ctl.signal.addEventListener('abort', () => {
          clearTimeout(t);
          rej(new Error('stop'));
        });
      });
      return { content: [] };
    });
    const w = await jm.wait(j.id, 30);
    expect(w.status).toBe('running');
    expect(jm.cancel(j.id)).toBe(true);
    await jm.wait(j.id, 1000);
    expect(jm.get(j.id)?.status).toBe('cancelled');
  });
  it('turns errors into failed jobs with the message', async () => {
    const jm = new JobManager(1);
    const j = jm.start('t', 'bad', async () => {
      throw new Error('boom');
    });
    await jm.wait(j.id, 1000);
    expect(jm.get(j.id)?.status).toBe('failed');
    expect(jm.get(j.id)?.error).toContain('boom');
  });
});
