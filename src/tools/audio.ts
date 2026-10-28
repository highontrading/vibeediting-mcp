import * as z from 'zod/v4';
import { AUDIO_EXTS, probeMedia } from '../media/probe.js';
import { UserError } from '../util/errors.js';
import path from 'node:path';
import { type App, done, tool, zProject } from './kit.js';

export function registerAudioTools(app: App): void {
  tool(
    app,
    'add_music',
    {
      title: 'Add music',
      description:
        "Add background music from the user's own audio file (mp3/wav/m4a...). It loops to fit, fades in/out, and is automatically lowered while someone speaks (ducking). remove=true removes it. vibeediting never generates music.",
      input: z.object({
        project: zProject,
        file: z.string().optional(),
        volume: z.number().min(0.01).max(1).optional().describe('0.1 = 10% (default from style)'),
        duck: z.boolean().optional().describe('lower music under speech (default true)'),
        fade_in: z.number().min(0).max(10).optional(),
        fade_out: z.number().min(0).max(10).optional(),
        start: z.number().min(0).optional().describe('output second where music starts'),
        remove: z.boolean().optional(),
      }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      if (args.remove) {
        p.audio.music = null;
        await app.store.save(p, 'Music removed.');
        return done(p, 'Music removed.');
      }
      if (!args.file && !p.audio.music)
        throw new UserError('Give the music file (an mp3/wav/m4a in the working folder).');
      let rel = p.audio.music?.path ?? '';
      if (args.file) {
        const abs = app.ws.resolve(args.file, { mustExist: true });
        const m = await probeMedia(abs);
        if (!m.audio) throw new UserError(`${path.basename(abs)} has no audio.`);
        if (!AUDIO_EXTS.includes(path.extname(abs).toLowerCase()) && m.video) {
          /* a video file is fine: we only use its sound */
        }
        rel = app.store.relToProject(p, abs);
      }
      const prev = p.audio.music;
      p.audio.music = {
        path: rel,
        volume: args.volume ?? prev?.volume ?? p.style.music.volume,
        duck: args.duck ?? prev?.duck ?? p.style.music.duck,
        fadeIn: args.fade_in ?? prev?.fadeIn ?? 1,
        fadeOut: args.fade_out ?? prev?.fadeOut ?? 2,
        start: args.start ?? prev?.start ?? 0,
      };
      await app.store.save(p, `Music ${rel}.`);
      return done(
        p,
        `Music: ${rel} at ${Math.round(p.audio.music.volume * 100)}%${p.audio.music.duck ? ', lowered under speech' : ''}, fade in ${p.audio.music.fadeIn} s / out ${p.audio.music.fadeOut} s.`,
        'Remind the user to only use music they have the rights to.',
      );
    },
  );

  tool(
    app,
    'normalize_audio',
    {
      title: 'Normalize audio',
      description:
        'Make the final loudness even and platform-ready (EBU R128, default -14 LUFS, true peak -1.5 dB). On by default for new projects; measured exactly at export.',
      input: z.object({
        project: zProject,
        enabled: z.boolean().optional(),
        target_lufs: z.number().min(-30).max(-8).optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const p = await app.store.load(args.project);
      p.audio.normalize = args.enabled ?? true;
      if (args.target_lufs !== undefined) p.audio.target = args.target_lufs;
      await app.store.save(p, `Normalize ${p.audio.normalize ? `${p.audio.target} LUFS` : 'off'}.`);
      return done(
        p,
        p.audio.normalize
          ? `Audio will be normalized to ${p.audio.target} LUFS at export.`
          : 'Loudness normalization is off.',
      );
    },
  );

  tool(
    app,
    'denoise_audio',
    {
      title: 'Denoise audio',
      description:
        'Reduce steady background noise (fan, AC, hiss) in the voice. light / medium / strong, or off. Strong can make the voice sound thin: check with preview_video.',
      input: z.object({ project: zProject, strength: z.enum(['off', 'light', 'medium', 'strong']) }),
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const p = await app.store.load(args.project);
      p.audio.denoise = args.strength;
      await app.store.save(p, `Denoise ${args.strength}.`);
      return done(p, `Noise reduction: ${args.strength}.`);
    },
  );
}
