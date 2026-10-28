import * as z from 'zod/v4';
import { DEFAULT_FILLERS, findFillers, findRetakes } from '../analysis/speech.js';
import { analyzeAudio } from '../media/audio.js';
import {
  applyClips,
  clipOffsets,
  outputDuration,
  outputRangeToSource,
  reorderClips,
  type Range,
  silencesToCuts,
  sourceToOutput,
  splitAt,
  subtractRanges,
  trimOutput,
} from '../timeline/ops.js';
import { formatFor } from '../timeline/store.js';
import type { Aspect, Project } from '../timeline/types.js';
import { UserError } from '../util/errors.js';
import { fmtDuration, fmtTime } from '../util/time.js';
import { autoDownloadAllowed } from '../media/ffmpegDownload.js';
import { whisperAvailable } from '../transcribe/local.js';
import { defaultModel, ensureModel, isModelReady, MODELS } from '../transcribe/models.js';
import { log } from '../util/log.js';
import { listVideos, needTranscript, sourceWords } from './helpers.js';
import { type App, done, runJob, summary, t, text, tool, zProject, zTime } from './kit.js';

const zAspect = z.enum(['9:16', '1:1', '4:5', '16:9', 'original']);

function clipList(p: Project, max = 30): string {
  const offs = clipOffsets(p.clips);
  const lines = p.clips.slice(0, max).map((c, i) => {
    const src = p.sources.find((s) => s.id === c.source);
    return `${c.id}: out ${fmtTime(offs[i])}-${fmtTime(offs[i] + c.out - c.in)}  from ${src?.path ?? c.source} ${fmtTime(c.in)}-${fmtTime(c.out)}`;
  });
  return lines.join('\n') + (p.clips.length > max ? `\n... ${p.clips.length - max} more clips` : '');
}

function overlayList(p: Project): string {
  if (!p.overlays.length) return '(none)';
  return p.overlays
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((o) => {
      const what =
        o.type === 'title'
          ? `title "${o.text}"`
          : o.type === 'text'
            ? `text "${o.text}"`
            : o.type === 'lower_third'
              ? `lower third "${o.name}"`
              : o.type === 'template'
                ? `${o.template}`
                : o.type === 'zoom'
                  ? `zoom x${o.scale}`
                  : `${o.type} ${o.path}`;
      return `${o.id}: ${what} at ${fmtTime(o.start)} for ${o.duration.toFixed(1)} s`;
    })
    .join('\n');
}

export function registerProjectTools(app: App): void {
  tool(
    app,
    'create_project',
    {
      title: 'Create project',
      description:
        'Start an edit. Makes an edit plan (project) for one or more videos; the originals are never changed. Several videos are joined in order. Creates .vibeediting/ next to the video. Set aspect "9:16" for Reels/Shorts.',
      input: z.object({
        videos: z.array(z.string()).min(1).describe('video file paths, in order'),
        name: z.string().optional().describe('project name (default: video file name)'),
        aspect: zAspect.optional().describe('default original'),
        style: z
          .string()
          .optional()
          .describe(
            "style preset name (see list_styles); default bold-yellow-pop or the user's saved default",
          ),
        replace: z.boolean().optional().describe('start an existing project again from scratch'),
      }),
      annotations: { idempotentHint: false },
    },
    async (args) => {
      const root = app.ws.requireRoot();
      const abs: string[] = [];
      for (const v of args.videos) {
        try {
          abs.push(app.ws.resolve(v, { mustExist: true }));
        } catch (err) {
          const vids = await listVideos(root);
          throw new UserError(
            `${err instanceof Error ? err.message : String(err)}${vids.length ? `\nVideos here: ${vids.join(', ')}` : ''}`,
          );
        }
      }
      const { project: p } = await app.store.create({
        videos: abs,
        name: args.name,
        aspect: args.aspect,
        style: args.style,
        replace: args.replace,
      });
      const modelNote = await prefetchSpeechModel();
      return done(
        p,
        `Created project "${p.name}". ${p.log[0]}${modelNote}`,
        'transcribe (for captions/fillers), then cut_silences, set_aspect_ratio, add_captions... Show the user the plan before rendering.',
      );
    },
  );

  tool(
    app,
    'get_project',
    {
      title: 'Get project',
      description:
        'Show the edit plan: clips, overlays (with ids), captions, audio, format, style and recent changes. Without a name, shows the current project (and lists other projects).',
      input: z.object({ project: zProject }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const others = (await app.store.discover()).filter((x) => x.name !== p.name).map((x) => x.name);
      const cap = p.captions
        ? `Captions: ${p.captions.enabled ? 'on' : 'off'}, ${p.captions.words.length} words, language ${p.captions.language}, overrides ${JSON.stringify(p.captions.overrides)}`
        : 'Captions: none';
      const a = p.audio;
      const lines = [
        summary(p),
        `Folder: ${app.ws.rel(app.store.projectDir(p))}`,
        `Format: ${p.format.aspect} ${p.format.width}x${p.format.height} ${p.format.fpsText} fps, fit ${p.format.fit} (crop x ${p.format.cropX}, y ${p.format.cropY})`,
        `Sources: ${p.sources.map((s) => `${s.id}=${s.path} (${s.duration.toFixed(1)} s)`).join(', ')}`,
        'Clips:',
        clipList(p),
        'Overlays:',
        overlayList(p),
        cap,
        `Audio: normalize ${a.normalize ? `on (${a.target} LUFS)` : 'off'}, denoise ${a.denoise}, music ${a.music ? `${a.music.path} at ${Math.round(a.music.volume * 100)}%${a.music.duck ? ', ducked under speech' : ''}` : 'none'}`,
        `Recent changes: ${p.log.slice(-5).join(' | ')}`,
      ];
      if (others.length) lines.push(`Other projects here: ${others.join(', ')}`);
      return text(lines.join('\n'));
    },
  );

  tool(
    app,
    'undo',
    {
      title: 'Undo',
      description: 'Undo the last change to the project (can be repeated).',
      input: z.object({ project: zProject }),
    },
    async (args) => {
      const { project, undone } = await app.store.undo(args.project);
      return done(project, `Undid: ${undone}`);
    },
  );

  tool(
    app,
    'cut_silences',
    {
      title: 'Cut silences',
      description:
        'Remove pauses from the edit and keep a short natural pause at each cut. Defaults come from the style (fast for Reels, calmer for podcasts). Use dry_run to only report. Change is undoable.',
      input: z.object({
        project: zProject,
        threshold_db: z
          .number()
          .min(-70)
          .max(-10)
          .optional()
          .describe('quieter than this = silence; default auto (adapts to the voice)'),
        min_silence: z.number().min(0.15).max(10).optional().describe('only cut pauses longer than this (s)'),
        keep_pause: z.number().min(0).max(1).optional().describe('pause kept on each side of a cut (s)'),
        dry_run: z.boolean().optional(),
      }),
    },
    async (args, ctx) => {
      const p = await app.store.load(args.project);
      const pace = p.style.pacing;
      const minSilence = args.min_silence ?? pace.minSilence;
      const keep = args.keep_pause ?? pace.keepPause;
      return runJob(app, ctx, 'silences', `Finding pauses in ${p.name}`, async (ctl) => {
        const ranges: Range[] = [];
        let thr = 0;
        const srcs = p.sources.filter((s) => s.hasAudio);
        for (let i = 0; i < srcs.length; i++) {
          const s = srcs[i];
          const a = await analyzeAudio(app.store.sourcePath(p, s.id), s.duration, {
            thresholdDb: args.threshold_db ?? pace.silenceThresholdDb,
            minSilence: Math.max(0.15, minSilence),
            signal: ctl.signal,
            onProgress: (f) => ctl.progress((i + f) / srcs.length, 'Finding pauses'),
          });
          thr = a.thresholdDb;
          for (const c of silencesToCuts(a.silences, { minSilence, keep, duration: s.duration }))
            ranges.push({ source: s.id, ...c });
        }
        const fresh = await app.store.load(p.name);
        const before = outputDuration(fresh.clips);
        const newClips = subtractRanges(fresh.clips, ranges, app.store.newId(fresh, 'c'));
        const saved = before - outputDuration(newClips);
        if (args.dry_run) {
          return {
            content: [
              {
                type: 'text',
                text: `Dry run: would cut ${ranges.length} pauses and save ${fmtDuration(saved)} (threshold ${thr} dB, pauses over ${minSilence} s, keeping ${keep} s). Nothing changed.`,
              },
            ],
          };
        }
        if (ranges.length === 0 || saved < 0.05)
          return {
            content: [
              {
                type: 'text',
                text: `No pauses longer than ${minSilence} s found (threshold ${thr} dB). Nothing changed.`,
              },
            ],
          };
        const note = applyClips(fresh, newClips);
        await app.store.save(fresh, `Cut ${ranges.length} pauses (${fmtDuration(saved)} saved).`);
        return {
          content: [
            {
              type: 'text',
              text: `Cut ${ranges.length} pauses, saved ${fmtDuration(saved)} (threshold ${thr} dB). ${note}\n${summary(fresh)}`,
            },
          ],
        };
      });
    },
  );

  tool(
    app,
    'remove_fillers',
    {
      title: 'Remove fillers',
      description: `Cut filler words ("umm", "uh", "matlab", "basically"...) and stutters ("I I") using the transcript. Best effort: Whisper leaves out many fillers by itself. Default list: ${DEFAULT_FILLERS.slice(0, 18).join(', ')}... "matlab" and "basically" are only cut when said as a filler (next to a pause). Add words like "achha" or "like" with extra_words. Use dry_run to review first.`,
      input: z.object({
        project: zProject,
        extra_words: z.array(z.string()).optional().describe('more words to treat as fillers'),
        only_words: z
          .array(z.string())
          .optional()
          .describe('use exactly these words instead of the default list'),
        stutters: z.boolean().optional().describe('remove repeated words like "the the" (default true)'),
        dry_run: z.boolean().optional(),
      }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const { bySource, missing } = await sourceWords(app, p);
      if (bySource.size === 0) throw needTranscript(missing);
      const ranges: Range[] = [];
      const found: string[] = [];
      for (const [src, tr] of bySource) {
        const hits = findFillers(tr.words, {
          extra: args.extra_words,
          only: args.only_words,
          stutters: args.stutters,
        });
        for (const h of hits) {
          const prev = tr.words[h.index - 1];
          const next = tr.words[h.index + 1];
          const start = Math.max(h.word.s - 0.03, prev ? prev.e : 0);
          const end = Math.min(h.word.e + 0.03, next ? next.s : h.word.e + 0.1);
          const at = sourceToOutput(p.clips, src, (h.word.s + h.word.e) / 2);
          if (at === null) continue;
          ranges.push({ source: src, start, end });
          found.push(`"${h.word.t}" at ${fmtTime(at)}${h.kind === 'stutter' ? ' (repeat)' : ''}`);
        }
      }
      if (!ranges.length)
        return text(
          'No filler words found in the transcript. (Whisper often drops "umm/uh" by itself; cut_silences removes the pauses they leave.)',
        );
      if (args.dry_run)
        return text(
          `Would remove ${ranges.length}: ${found.slice(0, 60).join(', ')}${found.length > 60 ? ' ...' : ''}. Nothing changed.`,
        );
      const note = applyClips(p, subtractRanges(p.clips, ranges, app.store.newId(p, 'c')));
      await app.store.save(p, `Removed ${ranges.length} filler words.`);
      return done(
        p,
        `Removed ${ranges.length} fillers: ${found.slice(0, 30).join(', ')}${found.length > 30 ? ' ...' : ''}. ${note}`,
      );
    },
  );

  tool(
    app,
    'remove_retakes',
    {
      title: 'Remove retakes',
      description:
        'Find places where the speaker started a sentence and said it again (a retake). First call without apply to get suggestions with ids; show them to the user; then call again with apply=[ids] to cut the earlier attempts.',
      input: z.object({
        project: zProject,
        apply: z.array(z.string()).optional().describe('ids of suggestions to cut, e.g. ["s1-r1"]'),
      }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const { bySource, missing } = await sourceWords(app, p);
      if (bySource.size === 0) throw needTranscript(missing);
      const all: Array<{
        id: string;
        src: string;
        start: number;
        end: number;
        text: string;
        again: string;
        at: number;
      }> = [];
      for (const [src, tr] of bySource) {
        for (const r of findRetakes(tr.segments)) {
          const at = sourceToOutput(p.clips, src, r.start + 0.01);
          if (at === null) continue;
          all.push({
            id: `${src}-${r.id}`,
            src,
            start: r.start,
            end: r.end,
            text: r.text,
            again: r.repeatedText,
            at,
          });
        }
      }
      if (!args.apply?.length) {
        if (!all.length) return text('No retakes found.');
        return text(
          `Possible retakes (earlier attempt -> repeated later). Ask the user which to cut, then call remove_retakes with apply=[ids]:\n${all
            .map(
              (r) =>
                `${r.id} at ${fmtTime(r.at)} (${(r.end - r.start).toFixed(1)} s): "${r.text.slice(0, 120)}" -> again: "${r.again.slice(0, 80)}"`,
            )
            .join('\n')}`,
        );
      }
      const chosen = all.filter((r) => args.apply!.includes(r.id));
      const unknown = args.apply.filter((id) => !all.some((r) => r.id === id));
      if (!chosen.length)
        throw new UserError(
          `None of these ids match current suggestions: ${unknown.join(', ')}. Call remove_retakes without apply to see them.`,
        );
      const note = applyClips(
        p,
        subtractRanges(
          p.clips,
          chosen.map((r) => ({ source: r.src, start: r.start, end: r.end })),
          app.store.newId(p, 'c'),
        ),
      );
      await app.store.save(p, `Removed ${chosen.length} retake(s).`);
      return done(
        p,
        `Removed ${chosen.length} retake(s).${unknown.length ? ` Unknown ids skipped: ${unknown.join(', ')}.` : ''} ${note}`,
      );
    },
  );

  tool(
    app,
    'cut_range',
    {
      title: 'Cut range',
      description:
        'Delete a part of the edit, given in OUTPUT time (as shown by get_transcript/get_project). Later parts move up. Undoable.',
      input: z.object({ project: zProject, start: zTime, end: zTime }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const s = t(args.start);
      const e = t(args.end);
      if (e <= s) throw new UserError('end must be after start.');
      const ranges = outputRangeToSource(p.clips, s, e);
      const note = applyClips(p, subtractRanges(p.clips, ranges, app.store.newId(p, 'c')));
      await app.store.save(p, `Cut ${fmtTime(s)}-${fmtTime(e)}.`);
      return done(p, `Cut ${fmtTime(s)}-${fmtTime(e)}. ${note}`);
    },
  );

  tool(
    app,
    'trim',
    {
      title: 'Trim',
      description:
        'Keep only the part between start and end (OUTPUT time). Use start to remove a slow beginning, end to cut the tail.',
      input: z.object({ project: zProject, start: zTime.optional(), end: zTime.optional() }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const total = outputDuration(p.clips);
      const s = t(args.start, 0);
      const e = args.end === undefined ? total : t(args.end);
      const note = applyClips(p, trimOutput(p.clips, s, e));
      await app.store.save(p, `Trimmed to ${fmtTime(s)}-${fmtTime(e)}.`);
      return done(p, `Kept ${fmtTime(s)}-${fmtTime(e)}. ${note}`);
    },
  );

  tool(
    app,
    'split',
    {
      title: 'Split',
      description: 'Split the clip at an OUTPUT time into two clips (for reordering).',
      input: z.object({ project: zProject, at: zTime }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const r = splitAt(p.clips, t(args.at), app.store.newId(p, 'c'));
      if (!r.newClipId)
        throw new UserError(
          'There is no clip to split at that time (too close to an existing cut, or past the end).',
        );
      p.clips = r.clips;
      await app.store.save(p, `Split at ${fmtTime(t(args.at))}.`);
      return done(p, `Split at ${fmtTime(t(args.at))}. New clip ${r.newClipId}.\n${clipList(p)}`);
    },
  );

  tool(
    app,
    'reorder_clips',
    {
      title: 'Reorder clips',
      description:
        'Change the order of clips. Give clip ids (from get_project) in the new order; clips you leave out stay at the end.',
      input: z.object({ project: zProject, order: z.array(z.string()).min(1) }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const note = applyClips(p, reorderClips(p.clips, args.order));
      await app.store.save(p, `Reordered clips: ${args.order.join(', ')}.`);
      return done(p, `Reordered. ${note}\n${clipList(p)}`);
    },
  );

  tool(
    app,
    'set_aspect_ratio',
    {
      title: 'Set aspect ratio',
      description:
        'Set the output shape: 9:16 (Reels/Shorts/TikTok), 1:1, 4:5 (feed), 16:9 (YouTube) or original. fit: crop (fill the frame; move the crop with crop_x 0=left..1=right), blur (whole picture over a blurred background), pad (black bars).',
      input: z.object({
        project: zProject,
        ratio: zAspect,
        fit: z.enum(['crop', 'blur', 'pad']).optional(),
        crop_x: z.number().min(0).max(1).optional().describe('0 = left, 0.5 = center, 1 = right'),
        crop_y: z.number().min(0).max(1).optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const main = p.sources.find((s) => s.hasVideo);
      p.format = {
        ...p.format,
        ...formatFor(args.ratio as Aspect, main),
        fit: args.fit ?? p.format.fit,
        cropX: args.crop_x ?? p.format.cropX,
        cropY: args.crop_y ?? p.format.cropY,
      };
      await app.store.save(p, `Aspect ${args.ratio} (${p.format.fit}).`);
      const hint =
        main && main.width > main.height && args.ratio === '9:16' && p.format.fit === 'crop'
          ? ' The wide video is cropped to the center; if the speaker is off-center, set crop_x (check with preview_video).'
          : '';
      return done(
        p,
        `Output is now ${p.format.aspect} ${p.format.width}x${p.format.height}, fit ${p.format.fit}.${hint}`,
      );
    },
  );
}

/** Start downloading the speech model in the background, so it is ready when captions are needed. */
async function prefetchSpeechModel(): Promise<string> {
  const id = defaultModel();
  if (!autoDownloadAllowed() || !whisperAvailable() || (await isModelReady(id))) return '';
  void ensureModel(id).catch((err) => log.error('speech model prefetch failed', err));
  return `\nDownloading the speech model in the background (${Math.round(MODELS[id].bytes / 1048576)} MB, one time only). Transcription waits for it if needed.`;
}
