import fs from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/v4';
import { emphasisPoints } from '../analysis/speech.js';
import { captionSettings, groupLines, mapWordsToOutput } from '../captions/captions.js';
import { contactSheet } from '../media/frames.js';
import { requireFfmpeg } from '../media/ffmpeg.js';
import { FONTS } from '../styles/presets.js';
import { dirs } from '../util/config.js';
import { run } from '../util/proc.js';
import { IMAGE_EXTS, probeMedia } from '../media/probe.js';
import { renderHtml } from '../motion/browser.js';
import { downloadStock, searchStock } from '../stock/stock.js';
import { outputDuration } from '../timeline/ops.js';
import type { Overlay, Position, Project } from '../timeline/types.js';
import { buildSegments } from '../transcribe/words.js';
import { UserError } from '../util/errors.js';
import { ensureDir } from '../util/fsx.js';
import { fmtTime } from '../util/time.js';
import { needTranscript, projectTranscript, sourceWords } from './helpers.js';
import { type App, done, jpeg, runJob, summary, t, text, tool, zProject, zTime } from './kit.js';

const zColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
  .describe('#RRGGBB');
const zPosition = z.enum([
  'top',
  'center',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'left',
  'right',
]);

function clampTiming(p: Project, start: number, duration: number): { start: number; duration: number } {
  const total = outputDuration(p.clips);
  const s = Math.max(0, Math.min(start, Math.max(0, total - 0.2)));
  return { start: s, duration: Math.max(0.2, Math.min(duration, total - s)) };
}

type NewOverlay = Overlay extends infer O ? (O extends Overlay ? Omit<O, 'id'> : never) : never;

function addOverlay(p: Project, o: NewOverlay): Overlay {
  const ov = { ...o, id: `o${p.nextId++}` } as Overlay;
  p.overlays.push(ov);
  return ov;
}

export function registerGraphicsTools(app: App): void {
  tool(
    app,
    'add_captions',
    {
      title: 'Add captions',
      description:
        'Turn on burned-in captions from the transcript, word by word with the current word highlighted (style from the project style; override anything here). Captions follow every cut automatically. Call again to change settings; enabled=false turns them off.',
      input: z.object({
        project: zProject,
        enabled: z.boolean().optional(),
        position: z.enum(['bottom', 'lower', 'middle', 'top']).optional(),
        max_words_per_line: z.number().int().min(1).max(12).optional(),
        lines: z.union([z.literal(1), z.literal(2)]).optional(),
        highlight: z
          .enum(['color', 'karaoke', 'single', 'none'])
          .optional()
          .describe('color = current word coloured; single = one word at a time; karaoke = fill sweep'),
        highlight_color: zColor.optional(),
        text_color: zColor.optional(),
        uppercase: z.boolean().optional(),
        punctuation: z.boolean().optional(),
        pop: z.boolean().optional().describe('current word pops bigger'),
        size: z
          .number()
          .min(0.02)
          .max(0.2)
          .optional()
          .describe('font size as a fraction of the short side (0.08 = big)'),
        font: z.string().optional().describe('e.g. "Poppins ExtraBold", "Mukta ExtraBold", "Anton Regular"'),
        box: z.boolean().optional().describe('dark box behind the text'),
      }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      if (args.enabled === false) {
        if (p.captions) p.captions.enabled = false;
        await app.store.save(p, 'Captions off.');
        return done(p, 'Captions turned off.');
      }
      const { bySource, missing } = await sourceWords(app, p);
      if (bySource.size === 0) throw needTranscript(missing);
      const words = [...bySource.entries()].flatMap(([src, tr]) => tr.words.map((w) => ({ ...w, src })));
      const language = [...bySource.values()][0]?.language ?? '';
      const prev = p.captions?.overrides ?? {};
      const o: Record<string, unknown> = { ...prev };
      const set = (k: string, v: unknown) => {
        if (v !== undefined) o[k] = v;
      };
      set('position', args.position);
      set('maxWordsPerLine', args.max_words_per_line);
      set('lines', args.lines);
      set('highlight', args.highlight);
      set('highlightColor', args.highlight_color);
      set('textColor', args.text_color);
      set('uppercase', args.uppercase);
      set('punctuation', args.punctuation);
      set('pop', args.pop);
      set('size', args.size);
      set('font', args.font);
      set('box', args.box);
      if (typeof o.font === 'string') {
        if (!FONTS[o.font])
          throw new UserError(`Unknown font "${o.font}". Fonts: ${Object.keys(FONTS).join(', ')}.`);
      }
      // Keep edits made with set_caption_text when the transcript did not change.
      const keepWords = p.captions?.words?.length && p.captions.words.some((w) => (w as any).edited);
      p.captions = {
        enabled: true,
        words: keepWords ? p.captions!.words : words,
        language,
        overrides: o as any,
      };
      await app.store.save(p, 'Captions on.');
      const cs = captionSettings(p.style, p.captions.overrides);
      const lines = groupLines(mapWordsToOutput(p.clips, p.captions.words), cs);
      const sample = lines
        .slice(0, 6)
        .map((l) => `[${fmtTime(l.start)}] ${l.words.map((w) => w.t).join(' ')}`)
        .join('\n');
      const hindi = /^(hi|mr|ne)$/.test(language)
        ? '\nThe transcript is in Devanagari. If the user wants Roman-script Hinglish captions, rewrite lines with set_caption_text.'
        : '';
      return done(
        p,
        `Captions on: ${lines.length} caption lines, ${cs.maxWordsPerLine} words per line, ${cs.highlight} highlight ${cs.highlightColor}, position ${cs.position}.\nFirst lines:\n${sample}${hindi}`,
        'preview_video to check how they look.',
      );
    },
  );

  tool(
    app,
    'set_caption_text',
    {
      title: 'Set caption text',
      description:
        'Replace the caption words between start and end (OUTPUT time) with new text: fix a wrong word, a brand name, or rewrite Hindi lines in Roman-script Hinglish. Timing is spread over the original words. Does not change the audio.',
      input: z.object({ project: zProject, start: zTime, end: zTime, text: z.string().min(1) }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      if (!p.captions) throw new UserError('Captions are not on. Call add_captions first.');
      const s = t(args.start);
      const e = t(args.end);
      // Which caption words fall in the range (by their output time)?
      const inRange: number[] = [];
      p.captions.words.forEach((w, i) => {
        const mid = mapWordsToOutput(p.clips, [w])[0];
        if (mid && (mid.s + mid.e) / 2 >= s && (mid.s + mid.e) / 2 <= e) inRange.push(i);
      });
      if (inRange.length === 0)
        throw new UserError(
          `No caption words between ${fmtTime(s)} and ${fmtTime(e)}. Use get_transcript to see output times.`,
        );
      const old = inRange.map((i) => p.captions!.words[i]);
      const tokens = args.text.trim().split(/\s+/);
      const slots: Array<{ s: number; e: number; src: string }> = [];
      if (tokens.length <= old.length) {
        for (let k = 0; k < tokens.length; k++) {
          const a = Math.floor((k * old.length) / tokens.length);
          const b = Math.floor(((k + 1) * old.length) / tokens.length) - 1;
          slots.push({ s: old[a].s, e: old[Math.max(a, b)].e, src: old[a].src });
        }
      } else {
        const per = tokens.length / old.length;
        for (let k = 0; k < tokens.length; k++) {
          const w = old[Math.min(old.length - 1, Math.floor(k / per))];
          const part = k - Math.floor(k / per) * per;
          const n = Math.ceil(per);
          const d = (w.e - w.s) / n;
          slots.push({ s: w.s + d * Math.floor(part), e: w.s + d * (Math.floor(part) + 1), src: w.src });
        }
      }
      const replacement = tokens.map((tok, k) => ({
        t: tok,
        s: slots[k].s,
        e: slots[k].e,
        src: slots[k].src,
        edited: true,
      }));
      const keep = p.captions.words.filter((_, i) => !inRange.includes(i));
      p.captions.words = [...keep, ...replacement].sort((a, b) =>
        a.src === b.src ? a.s - b.s : a.src.localeCompare(b.src),
      );
      await app.store.save(p, `Caption text ${fmtTime(s)}-${fmtTime(e)} changed.`);
      return done(
        p,
        `Captions ${fmtTime(s)}-${fmtTime(e)}: "${old.map((w) => w.t).join(' ')}" -> "${args.text}".`,
      );
    },
  );

  tool(
    app,
    'add_title_card',
    {
      title: 'Add title card',
      description:
        'Big animated title text (e.g. the hook or the video topic) at a time, drawn on top of the video. Optional smaller subtitle. Animations: pop, fade, slide, typewriter.',
      input: z.object({
        project: zProject,
        text: z.string().min(1),
        subtitle: z.string().optional(),
        start: zTime.optional().describe('default 0'),
        duration: z.number().min(0.3).max(30).optional().describe('seconds, default 2.5'),
        position: z.enum(['center', 'top', 'bottom']).optional(),
        animation: z.enum(['pop', 'fade', 'slide', 'typewriter']).optional(),
        background: z
          .enum(['none', 'box', 'full'])
          .optional()
          .describe('full = solid colour card over the whole frame'),
        color: zColor.optional(),
      }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const tm = clampTiming(p, t(args.start, 0), args.duration ?? 2.5);
      const ov = addOverlay(p, {
        type: 'title',
        text: args.text,
        subtitle: args.subtitle,
        position: args.position ?? 'center',
        animation: args.animation,
        background: args.background,
        color: args.color,
        ...tm,
      });
      await app.store.save(p, `Title "${args.text}" at ${fmtTime(tm.start)}.`);
      return done(
        p,
        `Added title ${ov.id} "${args.text}" at ${fmtTime(tm.start)} for ${tm.duration.toFixed(1)} s.`,
      );
    },
  );

  tool(
    app,
    'add_lower_third',
    {
      title: 'Add lower third',
      description:
        'Name tag in the lower part of the frame (name + optional role), sliding in with an accent bar.',
      input: z.object({
        project: zProject,
        name: z.string().min(1),
        title: z.string().optional().describe('role, e.g. "Founder, Acme"'),
        start: zTime.optional(),
        duration: z.number().min(1).max(30).optional(),
        side: z.enum(['left', 'right']).optional(),
      }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const tm = clampTiming(p, t(args.start, 1), args.duration ?? 4);
      const ov = addOverlay(p, {
        type: 'lower_third',
        name: args.name,
        title: args.title,
        side: args.side ?? 'left',
        ...tm,
      });
      await app.store.save(p, `Lower third "${args.name}".`);
      return done(p, `Added lower third ${ov.id} "${args.name}" at ${fmtTime(tm.start)}.`);
    },
  );

  tool(
    app,
    'add_zoom',
    {
      title: 'Add zoom',
      description:
        'Punch-in zoom for emphasis. Give start (+duration), or auto=true to place zooms at sentence starts every N seconds (uses the transcript; good for talking-head reels).',
      input: z.object({
        project: zProject,
        start: zTime.optional(),
        duration: z.number().min(0.4).max(20).optional().describe('default 2'),
        scale: z.number().min(1.03).max(2).optional().describe('default from style, about 1.12'),
        x: z.number().min(0).max(1).optional().describe('zoom towards: 0 left .. 1 right (default 0.5)'),
        y: z.number().min(0).max(1).optional().describe('0 top .. 1 bottom (default 0.4, the face)'),
        auto: z.boolean().optional(),
        every: z
          .number()
          .min(2)
          .max(60)
          .optional()
          .describe('auto: seconds between zooms (default from style, 7)'),
      }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const scale = args.scale ?? p.style.pacing.zoomScale;
      const dur = args.duration ?? 2;
      const x = args.x ?? 0.5;
      const y = args.y ?? 0.4;
      const times: number[] = [];
      if (args.auto) {
        const every = args.every ?? (p.style.pacing.zoomEvery || 7);
        const { transcript } = await projectTranscript(app, p);
        if (transcript.words.length) times.push(...emphasisPoints(buildSegments(transcript.words), every));
        else for (let s = 2; s < outputDuration(p.clips) - dur; s += every) times.push(s);
        p.overlays = p.overlays.filter((o) => o.type !== 'zoom');
      } else {
        if (args.start === undefined) throw new UserError('Give start, or set auto=true.');
        times.push(t(args.start));
      }
      for (const s of times) addOverlay(p, { type: 'zoom', scale, x, y, ...clampTiming(p, s, dur) });
      await app.store.save(p, `${times.length} zoom(s).`);
      return done(
        p,
        `Added ${times.length} zoom(s) x${scale} at ${times.map((s) => fmtTime(s, 0)).join(', ')}.`,
      );
    },
  );

  tool(
    app,
    'add_text_overlay',
    {
      title: 'Add text overlay',
      description: 'Any text on screen (key point, emoji-free label, call to action) at a position and time.',
      input: z.object({
        project: zProject,
        text: z.string().min(1),
        start: zTime,
        duration: z.number().min(0.3).max(120).optional(),
        position: zPosition.optional(),
        size: z.number().min(0.02).max(0.2).optional().describe('fraction of the short side, default 0.06'),
        color: zColor.optional(),
        box: z.boolean().optional(),
        animation: z.enum(['pop', 'fade', 'slide', 'none']).optional(),
        font: z.string().optional(),
      }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const tm = clampTiming(p, t(args.start), args.duration ?? 3);
      const ov = addOverlay(p, {
        type: 'text',
        text: args.text,
        position: (args.position ?? 'center') as Position,
        size: args.size,
        color: args.color,
        box: args.box,
        animation: args.animation,
        font: args.font,
        ...tm,
      });
      await app.store.save(p, `Text "${args.text}".`);
      return done(p, `Added text ${ov.id} at ${fmtTime(tm.start)}.`);
    },
  );

  tool(
    app,
    'render_motion_graphic',
    {
      title: 'Render motion graphic',
      description: [
        'Add an animated graphic (B-roll made with code, no AI generation). Two ways:',
        '1) template (instant, no browser): counter {from,to,prefix,suffix,decimals,label}, bar_chart {title,bars:[{label,value}],prefix,suffix}, progress_bar {percent,label}, checklist {title,items:[...]}, quote {text,author}, callout {text,x,y}.',
        '2) html: write a small self-contained HTML/CSS/JS animation. Transparent background by default. Animate with CSS animations, requestAnimationFrame, or define window.seek = (t) => {...} (t in seconds) to draw each frame. The clock is virtual, so animations are smooth. Fonts available: Poppins, Mukta, Anton, Bebas Neue, Noto Sans Devanagari. Needs Chrome or Edge installed.',
      ].join('\n'),
      input: z.object({
        project: zProject,
        template: z
          .enum(['counter', 'bar_chart', 'progress_bar', 'checklist', 'quote', 'callout'])
          .optional(),
        params: z.record(z.string(), z.any()).optional(),
        html: z.string().optional().describe('full HTML document or body content'),
        html_file: z.string().optional().describe('or a .html file in the working folder'),
        start: zTime,
        duration: z.number().min(0.3).max(60).optional().describe('default 3'),
        placement: z.enum(['full', 'box']).optional().describe('html: full frame (default) or a box'),
        box: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            w: z.number().min(0.05).max(1),
            h: z.number().min(0.05).max(1),
          })
          .optional()
          .describe('fractions of the frame'),
      }),
    },
    async (args, ctx) => {
      const p = await app.store.load(args.project);
      const tm = clampTiming(p, t(args.start), args.duration ?? 3);
      if (args.template) {
        const ov = addOverlay(p, {
          type: 'template',
          template: args.template,
          params: args.params ?? {},
          ...tm,
        } as NewOverlay);
        await app.store.save(p, `Graphic ${args.template}.`);
        return done(
          p,
          `Added ${args.template} graphic ${ov.id} at ${fmtTime(tm.start)} for ${tm.duration.toFixed(1)} s.`,
          'preview_video to see it.',
        );
      }
      let html = args.html;
      if (!html && args.html_file)
        html = await fs.readFile(app.ws.resolve(args.html_file, { mustExist: true }), 'utf8');
      if (!html) throw new UserError('Give a template, or html / html_file.');
      const placement = args.placement ?? 'full';
      const box =
        placement === 'box' ? (args.box ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.3 }) : { x: 0, y: 0, w: 1, h: 1 };
      const W = Math.round((p.format.width * box.w) / 2) * 2;
      const H = Math.round((p.format.height * box.h) / 2) * 2;
      const id = `o${p.nextId++}`;
      await app.store.save(p);
      const dir = await ensureDir(path.join(app.store.projectDir(p), '.vibeediting', 'graphics'));
      const out = path.join(dir, `${p.name}-${id}.mov`);
      return runJob(app, ctx, 'graphic', `Rendering animation ${id}`, async (ctl) => {
        const r = await renderHtml({
          html: html!,
          width: W,
          height: H,
          fps: Math.min(30, p.format.fps),
          duration: tm.duration,
          outFile: out,
          signal: ctl.signal,
          onProgress: (f, m) => ctl.progress(f, m),
        });
        const fresh = await app.store.load(p.name);
        fresh.overlays.push({
          id,
          type: 'graphic',
          path: app.store.relToProject(fresh, out),
          trimStart: 0,
          mode: placement === 'box' ? 'box' : 'full',
          box,
          ...tm,
        });
        await app.store.save(fresh, `Animation ${id}.`);
        const sheet = await contactSheet(out, [tm.duration * 0.25, tm.duration * 0.5, tm.duration * 0.9], {
          cols: 3,
          thumbWidth: 200,
        });
        const warn = r.warnings.length ? `\nPage errors: ${r.warnings.join(' | ')}` : '';
        return {
          content: [
            {
              type: 'text',
              text: `Rendered animation ${id} (${W}x${H}, ${tm.duration.toFixed(1)} s, browser: ${r.browser}) and placed it at ${fmtTime(tm.start)}.${warn}\n${summary(fresh)}\nFrames at 25%, 50%, 90% (transparent areas show black):`,
            },
            jpeg(sheet.jpeg),
          ],
        };
      });
    },
  );

  tool(
    app,
    'update_overlay',
    {
      title: 'Update overlay',
      description:
        'Move, retime, change text or remove an overlay (title, text, lower third, graphic, zoom, B-roll). Get ids from get_project.',
      input: z.object({
        project: zProject,
        id: z.string(),
        remove: z.boolean().optional(),
        start: zTime.optional(),
        duration: z.number().min(0.2).max(600).optional(),
        text: z.string().optional(),
        subtitle: z.string().optional(),
        position: z.string().optional(),
        color: zColor.optional(),
        scale: z.number().min(1.01).max(2).optional(),
        params: z.record(z.string(), z.any()).optional().describe('template parameters to merge'),
      }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const idx = p.overlays.findIndex((o) => o.id === args.id);
      if (idx < 0)
        throw new UserError(
          `No overlay "${args.id}". Overlays: ${p.overlays.map((o) => o.id).join(', ') || 'none'}.`,
        );
      if (args.remove) {
        const [o] = p.overlays.splice(idx, 1);
        await app.store.save(p, `Removed ${o.id}.`);
        return done(p, `Removed ${o.type} ${o.id}.`);
      }
      const o: any = p.overlays[idx];
      if (args.start !== undefined) o.start = t(args.start);
      if (args.duration !== undefined) o.duration = args.duration;
      Object.assign(o, clampTiming(p, o.start, o.duration));
      if (args.text !== undefined) {
        if (o.type === 'lower_third') o.name = args.text;
        else if (o.type === 'template') o.params = { ...o.params, text: args.text };
        else o.text = args.text;
      }
      if (args.subtitle !== undefined) {
        if (o.type === 'lower_third') o.title = args.subtitle;
        else o.subtitle = args.subtitle;
      }
      if (args.position !== undefined) o.position = args.position;
      if (args.color !== undefined) o.color = args.color;
      if (args.scale !== undefined && o.type === 'zoom') o.scale = args.scale;
      if (args.params && o.type === 'template') o.params = { ...o.params, ...args.params };
      await app.store.save(p, `Updated ${o.id}.`);
      return done(p, `Updated ${o.type} ${o.id}: at ${fmtTime(o.start)} for ${o.duration.toFixed(1)} s.`);
    },
  );

  tool(
    app,
    'search_stock_footage',
    {
      title: 'Search stock footage',
      description:
        'Search free stock videos on Pexels and/or Pixabay with the user\'s own free API keys. Returns ids like "pexels:12345" for add_broll. Use short English queries ("city traffic night", "typing on laptop").',
      input: z.object({
        query: z.string().min(2),
        provider: z.enum(['pexels', 'pixabay', 'both']).optional(),
        orientation: z
          .enum(['portrait', 'landscape', 'square', 'any'])
          .optional()
          .describe('default: matches the project'),
        min_duration: z.number().min(1).max(120).optional(),
        per_page: z.number().int().min(1).max(15).optional().describe('default 6'),
        show_thumbnails: z
          .boolean()
          .optional()
          .describe('return one small image with the thumbnails (costs tokens)'),
        project: zProject,
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      let orientation = args.orientation;
      if (!orientation) {
        try {
          const p = await app.store.load(args.project);
          orientation =
            p.format.height > p.format.width
              ? 'portrait'
              : p.format.height === p.format.width
                ? 'square'
                : 'landscape';
        } catch {
          orientation = 'any';
        }
      }
      const clips = await searchStock(args.query, {
        provider: args.provider ?? 'both',
        orientation,
        perPage: args.per_page,
        minDuration: args.min_duration,
      });
      if (!clips.length)
        return text(
          `No results for "${args.query}" (${orientation}). Try a simpler query or orientation "any".`,
        );
      const lines = clips.map(
        (c, i) =>
          `${i + 1}. ${c.ref}: ${c.duration}s ${c.width}x${c.height} by ${c.author}${c.description ? ` - ${c.description}` : ''}`,
      );
      const content: any[] = [
        {
          type: 'text',
          text: `Results for "${args.query}":\n${lines.join('\n')}\nUse add_broll with ref=<id>. Credits are saved automatically.`,
        },
      ];
      if (args.show_thumbnails) {
        const sheet = await thumbnailSheet(clips.map((c) => c.thumbnail).filter(Boolean)).catch(() => null);
        if (sheet) content.push(jpeg(sheet));
      }
      return { content };
    },
  );

  tool(
    app,
    'add_broll',
    {
      title: 'Add B-roll',
      description:
        'Put a cutaway clip over the video while the voice continues: a stock clip from search_stock_footage (ref="pexels:123") or the user\'s own video/image file. mode full = covers the frame, pip = small window. Images get a slow zoom.',
      input: z.object({
        project: zProject,
        ref: z.string().optional().describe('stock id from search_stock_footage'),
        file: z.string().optional().describe('or a video/image file in the working folder'),
        start: zTime,
        duration: z.number().min(0.5).max(60).optional().describe('default 3'),
        trim_start: z.number().min(0).optional().describe('seconds into the B-roll clip to start from'),
        mode: z.enum(['full', 'pip']).optional(),
      }),
    },
    async (args, ctx) => {
      if (!args.ref && !args.file) throw new UserError('Give ref (from search_stock_footage) or file.');
      const p = await app.store.load(args.project);
      const tm = clampTiming(p, t(args.start), args.duration ?? 3);
      return runJob(app, ctx, 'broll', 'Adding B-roll', async (ctl) => {
        let abs: string;
        let credit: string | undefined;
        if (args.ref) {
          ctl.progress(0.1, `Downloading ${args.ref}`);
          const d = await downloadStock(
            args.ref,
            app.store.projectDir(p),
            Math.max(p.format.width, p.format.height),
            ctl.signal,
          );
          abs = d.file;
          credit = `${d.credit.provider} / ${d.credit.author} (${d.credit.pageUrl})`;
        } else abs = app.ws.resolve(args.file!, { mustExist: true });
        const isImage = IMAGE_EXTS.includes(path.extname(abs).toLowerCase());
        if (!isImage) {
          const m = await probeMedia(abs);
          if (!m.video) throw new UserError(`${path.basename(abs)} has no video.`);
          if (m.duration < (args.trim_start ?? 0) + 0.5)
            throw new UserError(`${path.basename(abs)} is only ${m.duration.toFixed(1)} s long.`);
          tm.duration = Math.min(tm.duration, m.duration - (args.trim_start ?? 0));
        }
        const fresh = await app.store.load(p.name);
        const id = `o${fresh.nextId++}`;
        fresh.overlays.push({
          id,
          type: 'broll',
          path: app.store.relToProject(fresh, abs),
          trimStart: args.trim_start ?? 0,
          mode: args.mode ?? 'full',
          credit,
          ...tm,
        });
        await app.store.save(fresh, `B-roll ${path.basename(abs)}.`);
        return {
          content: [
            {
              type: 'text',
              text: `Added B-roll ${id} (${path.basename(abs)}) at ${fmtTime(tm.start)} for ${tm.duration.toFixed(1)} s.${credit ? ` Credit saved in broll/credits.json: ${credit}.` : ''}\n${summary(fresh)}`,
            },
          ],
        };
      });
    },
  );
}

/** Download a few thumbnails and tile them into one numbered JPEG. */
async function thumbnailSheet(urls: string[]): Promise<Buffer | null> {
  const dir = await fs.mkdtemp(path.join(await ensureDir(dirs.cache()), 'thumbs-'));
  try {
    const files: string[] = [];
    for (const [i, u] of urls.slice(0, 8).entries()) {
      const res = await fetch(u, { signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!res?.ok) continue;
      const f = path.join(dir, `t${i}.jpg`);
      await fs.writeFile(f, Buffer.from(await res.arrayBuffer()));
      files.push(f);
    }
    if (!files.length) return null;
    const sheet = await contactSheetFromImages(files);
    return sheet;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function contactSheetFromImages(files: string[]): Promise<Buffer> {
  const { ffmpeg } = await requireFfmpeg();
  const dir = path.dirname(files[0]);
  for (const [i, f] of files.entries()) {
    await run(ffmpeg, [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      f,
      '-vf',
      'scale=200:200:force_original_aspect_ratio=decrease,pad=200:200:(ow-iw)/2:(oh-ih)/2',
      path.join(dir, `n${String(i).padStart(2, '0')}.jpg`),
    ]);
  }
  const cols = Math.min(4, files.length);
  const rows = Math.ceil(files.length / cols);
  await run(ffmpeg, [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-framerate',
    '1',
    '-i',
    path.join(dir, 'n%02d.jpg'),
    '-vf',
    `tile=${cols}x${rows}:padding=4:color=black`,
    '-frames:v',
    '1',
    '-q:v',
    '6',
    path.join(dir, 'sheet.jpg'),
  ]);
  return fs.readFile(path.join(dir, 'sheet.jpg'));
}
