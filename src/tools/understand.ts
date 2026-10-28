import * as z from 'zod/v4';
import { analyzeVideo } from '../analysis/analyze.js';
import { analyzeAudio } from '../media/audio.js';
import { contactSheet, evenlySpaced } from '../media/frames.js';
import { describeMedia, probeMedia } from '../media/probe.js';
import { cloudKey } from '../transcribe/cloud.js';
import { isModelId, MODELS } from '../transcribe/models.js';
import { type Engine, formatTranscript, loadTranscript, transcribeMedia } from '../transcribe/transcript.js';
import { UserError } from '../util/errors.js';
import { fmtDuration, fmtTime } from '../util/time.js';
import { lastOutputs, needTranscript, projectTranscript, resolveMedia } from './helpers.js';
import { type App, jpeg, runJob, t, text, tool, zProject, zTime } from './kit.js';

export function registerUnderstandTools(app: App): void {
  tool(
    app,
    'probe_media',
    {
      title: 'Probe media',
      description:
        'Quick facts about a video or audio file: duration, resolution, orientation, fps, rotation, audio. Fast; use before planning.',
      input: z.object({
        file: z
          .string()
          .optional()
          .describe('file path (relative to the working folder); default = project video'),
        project: zProject,
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { media, rel } = await resolveMedia(app, args.file, args.project);
      const tr = await loadTranscript(media);
      return text(
        `${describeMedia(media, rel)}${tr ? `\nTranscript: yes (${tr.language}, ${tr.words.length} words)` : media.audio ? '\nTranscript: not yet (call transcribe)' : ''}`,
      );
    },
  );

  tool(
    app,
    'transcribe',
    {
      title: 'Transcribe',
      description:
        'Speech to text with word timings, on this computer (no upload). Needed for captions, filler/retake removal and shorts. Results are cached. For Hindi or Hinglish set language "hi" (captions come out in Devanagari; you can rewrite lines in Roman script with set_caption_text). First use downloads the speech model once. Runs in the background for long videos.',
      input: z.object({
        file: z.string().optional().describe('default = all videos in the project'),
        project: zProject,
        language: z
          .string()
          .optional()
          .describe('"auto" (default), "hi" Hindi/Hinglish, "en" English, or another code'),
        model: z
          .enum(['tiny', 'base', 'small', 'medium', 'turbo', 'large'])
          .optional()
          .describe('default turbo (small on older computers); small is faster'),
        engine: z
          .enum(['local', 'deepgram', 'openai'])
          .optional()
          .describe(
            "local (default, private). Cloud engines need the user's own API key and upload the audio",
          ),
        keep_fillers: z
          .boolean()
          .optional()
          .describe('try to keep "umm/uh" in the text so they can be removed later (default true)'),
        quality: z.enum(['fast', 'best']).optional().describe('best = beam search, slower'),
        force: z.boolean().optional().describe('ignore the cached transcript'),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args, ctx) => {
      const engine: Engine = args.engine ?? 'local';
      if (engine !== 'local' && !cloudKey(engine))
        throw new UserError(
          `No ${engine === 'deepgram' ? 'DEEPGRAM_API_KEY' : 'OPENAI_API_KEY'} is set. Use engine "local" (free, private) or add the key to the MCP settings.`,
        );
      const targets: Array<{ media: Awaited<ReturnType<typeof probeMedia>>; rel: string }> = [];
      if (args.file) targets.push(await resolveMedia(app, args.file));
      else {
        const { project } = await resolveMedia(app, undefined, args.project);
        for (const s of project!.sources.filter((x) => x.hasAudio)) {
          const abs = app.store.sourcePath(project!, s.id);
          targets.push({ media: await probeMedia(abs), rel: app.ws.rel(abs) });
        }
      }
      if (targets.length === 0) throw new UserError('No audio to transcribe.');
      const model = args.model && isModelId(args.model) ? args.model : undefined;
      const label = `Transcribing ${targets.map((x) => x.rel).join(', ')}`;
      return runJob(app, ctx, 'transcribe', label, async (ctl) => {
        const parts: string[] = [];
        for (let i = 0; i < targets.length; i++) {
          const { media, rel } = targets[i];
          const { transcript, cached } = await transcribeMedia(media, rel, {
            language: args.language ?? 'auto',
            engine,
            model,
            keepFillers: args.keep_fillers,
            quality: args.quality,
            force: args.force,
            signal: ctl.signal,
            onProgress: (f, m) => ctl.progress((i + f) / targets.length, m),
          });
          const preview = transcript.segments
            .slice(0, 12)
            .map((s) => `[${fmtTime(s.s)}] ${s.text}`)
            .join('\n');
          parts.push(
            `${cached ? 'Using saved transcript' : 'Transcribed'} ${rel}: language ${transcript.language}, ${transcript.words.length} words, ${transcript.segments.length} lines (${transcript.engine}${transcript.model ? ` ${transcript.model}` : ''}).${transcript.notes.length ? `\nNotes: ${transcript.notes.join(' ')}` : ''}\n${preview}${transcript.segments.length > 12 ? '\n... (use get_transcript to read more)' : ''}`,
          );
        }
        return { content: [{ type: 'text', text: parts.join('\n\n') }] };
      });
    },
  );

  tool(
    app,
    'get_transcript',
    {
      title: 'Get transcript',
      description:
        'Read the transcript in pages, search it, or get a 1-line-per-minute outline of long videos. With a project (default), times are OUTPUT times of the current edit (cut words are gone) - use these times for edit tools. With file=..., times are the raw file times.',
      input: z.object({
        project: zProject,
        file: z.string().optional(),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(5).max(200).optional().describe('lines per page (default 60)'),
        search: z.string().optional().describe('find lines containing this text'),
        mode: z
          .enum(['segments', 'outline', 'words'])
          .optional()
          .describe('words = word-level timings between from and to'),
        from: zTime.optional(),
        to: zTime.optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const opts = {
        page: args.page,
        pageSize: args.page_size,
        search: args.search,
        mode: args.mode,
        from: args.from !== undefined ? t(args.from) : undefined,
        to: args.to !== undefined ? t(args.to) : undefined,
      };
      if (args.file) {
        const { media } = await resolveMedia(app, args.file);
        const tr = await loadTranscript(media);
        if (!tr) throw needTranscript([args.file]);
        return text(formatTranscript(tr, opts));
      }
      const { project } = await resolveMedia(app, undefined, args.project);
      const { transcript, missing } = await projectTranscript(app, project!);
      if (transcript.words.length === 0 && missing.length) throw needTranscript(missing);
      return text(
        formatTranscript(transcript, opts) +
          (missing.length ? `\n(Not transcribed yet: ${missing.join(', ')})` : ''),
      );
    },
  );

  tool(
    app,
    'analyze_video',
    {
      title: 'Analyze video',
      description:
        'Review a video like an editor: hook check (first 3 s), pacing, pauses, scene changes, slow parts, loudness (EBU R128), plus 1-2 small contact-sheet images and concrete suggestions. Transcribe first for the best result.',
      input: z.object({
        file: z.string().optional(),
        project: zProject,
        frames: z
          .number()
          .int()
          .min(4)
          .max(16)
          .optional()
          .describe('frames in the overview image (default 12)'),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) => {
      const { media, rel } = await resolveMedia(app, args.file, args.project);
      const tr = await loadTranscript(media);
      return runJob(app, ctx, 'analyze', `Analyzing ${rel}`, async (ctl) => {
        const r = await analyzeVideo(media, rel, tr, {
          frames: args.frames,
          signal: ctl.signal,
          onProgress: (f, m) => ctl.progress(f, m),
        });
        return { content: [{ type: 'text', text: r.text }, ...r.images.map(jpeg)] };
      });
    },
  );

  tool(
    app,
    'detect_silences',
    {
      title: 'Detect silences',
      description:
        'List the pauses in a video\'s audio (raw file times). Threshold "auto" adapts to the speaker\'s loudness. To remove them use cut_silences.',
      input: z.object({
        file: z.string().optional(),
        project: zProject,
        threshold_db: z.number().min(-70).max(-10).optional().describe('default auto'),
        min_silence: z.number().min(0.1).max(10).optional().describe('seconds, default 0.5'),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { media, rel } = await resolveMedia(app, args.file, args.project);
      if (!media.audio) throw new UserError(`${rel} has no audio.`);
      const a = await analyzeAudio(media.path, media.duration, {
        thresholdDb: args.threshold_db ?? 'auto',
        minSilence: args.min_silence ?? 0.5,
      });
      const total = a.silences.reduce((x, s) => x + s.end - s.start, 0);
      const list = a.silences
        .slice(0, 40)
        .map((s) => `${fmtTime(s.start)}-${fmtTime(s.end)} (${(s.end - s.start).toFixed(1)} s)`);
      return text(
        `${rel}: ${a.silences.length} pauses, ${fmtDuration(total)} in total, threshold ${a.thresholdDb} dB.\n${list.join('\n')}${a.silences.length > 40 ? `\n... and ${a.silences.length - 40} more` : ''}`,
      );
    },
  );

  tool(
    app,
    'view_frames',
    {
      title: 'View frames',
      description:
        'See the video: returns ONE small image grid of frames at the times you choose (or evenly spaced). Use target "preview" or "export" to look at the latest rendered file of the project.',
      input: z.object({
        file: z.string().optional(),
        project: zProject,
        target: z.enum(['source', 'preview', 'export']).optional().describe('default source'),
        times: z.array(zTime).max(12).optional().describe('up to 12 times; default 8 evenly spaced'),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let file: string;
      let rel: string;
      if (args.target === 'preview' || args.target === 'export') {
        const p = await app.store.load(args.project);
        const f = lastOutputs.get(p.name)?.[args.target];
        if (!f)
          throw new UserError(
            `There is no ${args.target} of ${p.name} yet. Call ${args.target === 'preview' ? 'preview_video' : 'export_video'} first.`,
          );
        file = f;
        rel = app.ws.rel(f);
      } else {
        const r = await resolveMedia(app, args.file, args.project);
        file = r.media.path;
        rel = r.rel;
      }
      const m = await probeMedia(file);
      if (!m.video) throw new UserError(`${rel} has no video.`);
      const times = args.times?.length ? args.times.map((x) => t(x)) : evenlySpaced(m.duration, 8);
      const vertical = m.video.height > m.video.width;
      const sheet = await contactSheet(file, times, {
        cols: Math.min(4, times.length),
        thumbWidth: vertical ? 200 : 280,
      });
      return {
        content: [
          { type: 'text', text: `${rel}: frames at ${sheet.times.map((x) => fmtTime(x)).join(', ')}` },
          jpeg(sheet.jpeg),
        ],
      };
    },
  );
}

export const MODEL_NOTES = Object.values(MODELS).map((m) => `${m.id}: ${m.label}`);
