import fs from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/v4';
import { findShortCandidates } from '../analysis/speech.js';
import { captionSettings, displayWord, groupLines, mapWordsToOutput } from '../captions/captions.js';
import { buildChapters, buildSrt, buildVtt } from '../captions/srt.js';
import { analyzeAudio } from '../media/audio.js';
import { contactSheet, evenlySpaced } from '../media/frames.js';
import { projectAss } from '../render/assFile.js';
import { type Preset, PRESET_SIZES, renderProject } from '../render/render.js';
import { formatFor } from '../timeline/store.js';
import { outputDuration, trimOutput } from '../timeline/ops.js';
import type { Project, VideoOverlay } from '../timeline/types.js';
import { resolveStyle } from '../styles/store.js';
import { formatTranscript } from '../transcribe/transcript.js';
import { UserError } from '../util/errors.js';
import { ensureDir, readJson, slugify, uniquePath, writeFileAtomic } from '../util/fsx.js';
import { chapterTime, fmtDuration, fmtTime } from '../util/time.js';
import { lastOutputs, needTranscript, projectTranscript, sourceWords } from './helpers.js';
import { type App, jpeg, runJob, summary, t, text, tool, zProject, zTime } from './kit.js';

function renderPaths(app: App, p: Project) {
  const dir = app.store.projectDir(p);
  return {
    sourcePath: (id: string) => app.store.sourcePath(p, id),
    overlayPath: (o: VideoOverlay) => (path.isAbsolute(o.path) ? o.path : path.resolve(dir, o.path)),
    musicPath: p.audio.music ? path.resolve(dir, p.audio.music.path) : null,
  };
}

function exportsDir(app: App, p: Project): string {
  return path.join(app.store.projectDir(p), 'exports');
}

/** Guard: never write over an original video. */
function assertNotSource(app: App, p: Project, out: string): void {
  for (const s of p.sources)
    if (path.resolve(app.store.sourcePath(p, s.id)) === path.resolve(out))
      throw new UserError('That output name would overwrite an original video. Choose another file name.');
}

export function registerOutputTools(app: App): void {
  tool(
    app,
    'preview_video',
    {
      title: 'Preview video',
      description:
        'Fast, small (480p) render of the current edit so the user can watch it before the final export. Optionally only a part (start/end in output time). Returns the file path and a few frames. Saves to exports/<project>-preview.mp4.',
      input: z.object({
        project: zProject,
        start: zTime.optional(),
        end: zTime.optional(),
        frames: z.boolean().optional().describe('return a small frame grid (default true)'),
      }),
    },
    async (args, ctx) => {
      let p = await app.store.load(args.project);
      const total = outputDuration(p.clips);
      const s = t(args.start, 0);
      const e = args.end === undefined ? total : t(args.end);
      if (s > 0 || e < total) p = previewSlice(p, s, e);
      const out = path.join(exportsDir(app, p), `${p.name}-preview.mp4`);
      assertNotSource(app, p, out);
      return runJob(app, ctx, 'preview', `Preview of ${p.name}`, async (ctl) => {
        const r = await renderProject(p, renderPaths(app, p), {
          mode: 'preview',
          output: out,
          signal: ctl.signal,
          onProgress: (f, m) => ctl.progress(f, m),
        });
        lastOutputs.set(p.name, { ...lastOutputs.get(p.name), preview: out });
        const content: any[] = [
          {
            type: 'text',
            text: `Preview ready: ${app.ws.rel(out)} (${fmtDuration(r.duration)}${s > 0 || e < total ? `, part ${fmtTime(s)}-${fmtTime(e)}` : ''}). Ask the user to open and watch it, then fix anything before export_video.`,
          },
        ];
        if (args.frames !== false) {
          const sheet = await contactSheet(out, evenlySpaced(r.duration, 4, 0.12), {
            cols: 4,
            thumbWidth: r.height > r.width ? 150 : 220,
          });
          content.push(jpeg(sheet.jpeg));
        }
        return { content };
      });
    },
  );

  tool(
    app,
    'export_video',
    {
      title: 'Export video',
      description:
        'Final render to an H.264 MP4 in the exports folder (never overwrites originals). Preset: auto (project format), reels, shorts, tiktok (1080x1920), youtube (1920x1080), square, portrait (1080x1350). Loudness is measured and normalized exactly. Runs in the background; render once after the user approved the preview.',
      input: z.object({
        project: zProject,
        preset: z.enum(['auto', 'reels', 'shorts', 'tiktok', 'youtube', 'square', 'portrait']).optional(),
        quality: z
          .enum(['high', 'standard', 'small'])
          .optional()
          .describe('standard (default), high = bigger file, small = for sharing'),
        filename: z.string().optional().describe('file name without folder'),
      }),
    },
    async (args, ctx) => {
      const p = await app.store.load(args.project);
      const preset = (args.preset ?? 'auto') as Preset;
      const dir = await ensureDir(exportsDir(app, p));
      const base = args.filename
        ? slugify(path.basename(args.filename))
        : `${p.name}${preset === 'auto' ? '' : `-${preset}`}`;
      const out = await uniquePath(path.join(dir, `${base}.mp4`));
      assertNotSource(app, p, out);
      let warn = '';
      if (preset !== 'auto') {
        const ps = PRESET_SIZES[preset];
        if (ps.w / ps.h !== p.format.width / p.format.height)
          warn = ` Note: the project is ${p.format.aspect}; the ${preset} preset changes the shape (fit: ${p.format.fit}).`;
      }
      return runJob(app, ctx, 'export', `Exporting ${p.name}`, async (ctl) => {
        const r = await renderProject(p, renderPaths(app, p), {
          mode: 'final',
          preset,
          quality: args.quality,
          output: out,
          signal: ctl.signal,
          onProgress: (f, m) => ctl.progress(f, m),
        });
        lastOutputs.set(p.name, { ...lastOutputs.get(p.name), export: out });
        const st = await fs.stat(out);
        const credits = p.overlays
          .filter((o): o is VideoOverlay => o.type === 'broll' && !!o.credit)
          .map((o) => o.credit!);
        let creditNote = '';
        if (credits.length) {
          const cfile = out.replace(/\.mp4$/, '.credits.txt');
          await writeFileAtomic(
            cfile,
            `Stock footage used in ${path.basename(out)}:\n${[...new Set(credits)].map((c) => `- ${c}`).join('\n')}\n`,
          );
          creditNote = ` Stock credits: ${app.ws.rel(cfile)} (add them to the post description).`;
        }
        return {
          content: [
            {
              type: 'text',
              text: `Exported ${app.ws.rel(out)}: ${r.width}x${r.height}, ${fmtDuration(r.duration)}, ${(st.size / 1048576).toFixed(1)} MB${r.loudness ? `, loudness ${r.loudness} LUFS` : ''}.${warn}${creditNote}`,
            },
          ],
        };
      });
    },
  );

  tool(
    app,
    'export_subtitles',
    {
      title: 'Export subtitles',
      description:
        'Write a subtitle file for the current edit (times match the exported video): srt (YouTube, Premiere), vtt (web) or ass (styled). Upload SRT to YouTube for searchable captions.',
      input: z.object({ project: zProject, format: z.enum(['srt', 'vtt', 'ass']).optional() }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const fmt = args.format ?? 'srt';
      const dir = await ensureDir(exportsDir(app, p));
      const out = path.join(dir, `${p.name}.${fmt}`);
      if (fmt === 'ass') {
        const ass = projectAss(p, p.format.width, p.format.height);
        if (!ass) throw new UserError('There are no captions or text graphics to export.');
        await writeFileAtomic(out, ass);
        return text(`Saved ${app.ws.rel(out)}.`);
      }
      let words;
      let cs;
      if (p.captions?.words.length) {
        words = mapWordsToOutput(p.clips, p.captions.words);
        cs = {
          ...captionSettings(p.style, p.captions.overrides),
          maxWordsPerLine: 7,
          lines: 2 as const,
          uppercase: false,
        };
      } else {
        const { transcript, missing } = await projectTranscript(app, p);
        if (!transcript.words.length) throw needTranscript(missing);
        words = transcript.words;
        cs = { maxWordsPerLine: 7, lines: 2 as const, uppercase: false, punctuation: true };
      }
      const lines = groupLines(words, cs, 0.8);
      const body =
        fmt === 'srt'
          ? buildSrt(lines, (w) => displayWord(w, { ...cs, punctuation: true }))
          : buildVtt(lines);
      await writeFileAtomic(out, body);
      return text(`Saved ${app.ws.rel(out)} (${lines.length} subtitles).`);
    },
  );

  tool(
    app,
    'export_chapters',
    {
      title: 'Export chapters',
      description:
        'YouTube chapters. Call with suggest=true to get a compact outline of the edit (1 line per minute) so you can write chapter titles; then call with chapters=[{time, title}] to save exports/<project>-chapters.txt ready to paste into the YouTube description. Rules: first at 0:00, at least 3, each at least 10 s long.',
      input: z.object({
        project: zProject,
        suggest: z.boolean().optional(),
        chapters: z.array(z.object({ time: zTime, title: z.string().min(1) })).optional(),
      }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      if (args.suggest || !args.chapters?.length) {
        const { transcript, missing } = await projectTranscript(app, p);
        if (!transcript.words.length) throw needTranscript(missing);
        return text(formatTranscript(transcript, { mode: 'outline' }));
      }
      const ch = args.chapters
        .map((c) => ({ time: t(c.time), title: c.title.trim() }))
        .sort((a, b) => a.time - b.time);
      if (ch[0].time > 0.5) ch.unshift({ time: 0, title: 'Intro' });
      ch[0].time = 0;
      const total = outputDuration(p.clips);
      const problems: string[] = [];
      if (ch.length < 3) problems.push('YouTube needs at least 3 chapters.');
      for (let i = 1; i < ch.length; i++)
        if (ch[i].time - ch[i - 1].time < 10) problems.push(`"${ch[i - 1].title}" is shorter than 10 s.`);
      if (ch[ch.length - 1].time > total) problems.push('A chapter starts after the end of the video.');
      const body = buildChapters(ch);
      const dir = await ensureDir(exportsDir(app, p));
      const out = path.join(dir, `${p.name}-chapters.txt`);
      await writeFileAtomic(out, body);
      return text(
        `Saved ${app.ws.rel(out)}:\n${body}${problems.length ? `\nWarnings: ${problems.join(' ')}` : ''}`,
      );
    },
  );

  tool(
    app,
    'make_shorts_from_long_video',
    {
      title: 'Make Shorts from a long video',
      description:
        'Find the best 30-60 s moments in a long video (complete sentences, strong first line, dense speech, few pauses) and create one 9:16 project per chosen moment with captions. Step 1: call without create to get ranked candidates with text; pick with the user. Step 2: call with create=[ids].',
      input: z.object({
        project: zProject,
        count: z.number().int().min(1).max(10).optional().describe('candidates to return (default 5)'),
        min_seconds: z.number().min(10).max(120).optional(),
        max_seconds: z.number().min(15).max(180).optional(),
        keywords: z.array(z.string()).optional().describe('topics the user cares about'),
        create: z
          .array(z.string())
          .optional()
          .describe('candidate ids to turn into projects, e.g. ["m1","m3"]'),
        style: z.string().optional(),
      }),
    },
    async (args, ctx) => {
      const p = await app.store.load(args.project);
      const main = p.sources.find((s) => s.hasAudio && s.hasVideo) ?? p.sources[0];
      const { bySource, missing } = await sourceWords(app, p);
      const tr = bySource.get(main.id);
      if (!tr) throw needTranscript(missing);
      return runJob(app, ctx, 'shorts', 'Finding the best moments', async (ctl) => {
        const a = await analyzeAudio(app.store.sourcePath(p, main.id), main.duration, {
          minSilence: 0.6,
          signal: ctl.signal,
          onProgress: (f) => ctl.progress(f * 0.8, 'Checking pauses'),
        });
        const cands = findShortCandidates(tr.segments, a.silences, {
          min: args.min_seconds,
          max: args.max_seconds,
          count: args.count ?? 5,
          keywords: args.keywords,
        });
        if (!args.create?.length) {
          if (!cands.length)
            return {
              content: [
                {
                  type: 'text',
                  text: 'No good 30-60 s moments found (the video may be too short, or the transcript too sparse).',
                },
              ],
            };
          return {
            content: [
              {
                type: 'text',
                text: `Best moments in ${main.path} (raw times). Read them, pick with the user, then call again with create=[ids]:\n${cands
                  .map(
                    (c) =>
                      `${c.id} ${fmtTime(c.start)}-${fmtTime(c.end)} (${Math.round(c.end - c.start)} s, score ${c.score}${c.reasons.length ? `; ${c.reasons.join(', ')}` : ''}): "${c.text.slice(0, 220)}${c.text.length > 220 ? '…' : ''}"`,
                  )
                  .join('\n')}`,
              },
            ],
          };
        }
        const made: string[] = [];
        for (const id of args.create) {
          const c = cands.find((x) => x.id === id);
          if (!c) continue;
          const name = `${p.name}-short-${id}`;
          const { project: sp } = await app.store.create({
            videos: [app.store.sourcePath(p, main.id)],
            name,
            aspect: '9:16',
            style: args.style ?? (p.styleName || undefined),
            replace: true,
          });
          sp.clips = [
            {
              id: 'c1',
              source: 's1',
              in: Math.max(0, c.start - 0.1),
              out: Math.min(main.duration, c.end + 0.3),
            },
          ];
          sp.format = { ...sp.format, ...formatFor('9:16', sp.sources[0]) };
          sp.captions = {
            enabled: true,
            words: tr.words.map((w) => ({ ...w, src: 's1' })),
            language: tr.language,
            overrides: {},
          };
          await app.store.save(sp, `Short from ${fmtTime(c.start)}-${fmtTime(c.end)} of ${p.name}.`);
          made.push(`${name}: ${fmtTime(c.start)}-${fmtTime(c.end)} -> ${summary(sp)}`);
        }
        if (!made.length)
          throw new UserError(
            `None of ${args.create.join(', ')} match the candidates. Call without create first.`,
          );
        return {
          content: [
            {
              type: 'text',
              text: `Created ${made.length} short project(s):\n${made.join('\n')}\nNext for each: cut_silences, add a title card hook, preview_video, then export_video preset shorts/reels.`,
            },
          ],
        };
      });
    },
  );
}

/** A copy of the project limited to output [s, e] for quick previews. */
export function previewSlice(p: Project, s: number, e: number): Project {
  const copy: Project = JSON.parse(JSON.stringify(p));
  copy.clips = trimOutput(p.clips, s, e);
  const len = e - s;
  copy.overlays = p.overlays
    .map((o) => ({ ...o, start: o.start - s }))
    .filter((o) => o.start + o.duration > 0 && o.start < len)
    .map((o) => (o.start < 0 ? { ...o, duration: o.duration + o.start, start: 0 } : o));
  return copy;
}

export { readJson, chapterTime, resolveStyle };
