import os from 'node:os';
import * as z from 'zod/v4';
import { findFfmpeg, INSTALL_HELP, prefetchFfmpeg, usable } from '../media/ffmpeg.js';
import { autoDownloadAllowed, downloadState, managedPaths, platformKey } from '../media/ffmpegDownload.js';
import { findBrowser } from '../motion/browser.js';
import { stockKeys } from '../stock/stock.js';
import { cloudKey } from '../transcribe/cloud.js';
import { whisperAvailable } from '../transcribe/local.js';
import {
  defaultModel,
  ensureModel,
  freeBytes,
  isModelId,
  isModelReady,
  MODELS,
  type ModelId,
} from '../transcribe/models.js';
import { dirs, MAX_WAIT_SECONDS, VERSION, vibeHome } from '../util/config.js';
import { ensureDir } from '../util/fsx.js';
import { isValidKeyFormat, normalizeKey } from '../license/key.js';
import { writeUserConfig } from '../util/userConfig.js';
import { type App, fail, runJob, text, tool, waitJob } from './kit.js';

export function registerSetupTools(app: App): void {
  tool(
    app,
    'check_setup',
    {
      title: 'Check setup',
      description:
        'Check that everything vibeediting needs is ready: FFmpeg (with caption support), license, speech models, browser for custom animations, stock-footage keys, disk space and the working folder. Run this first if anything fails. Set prepare_model=true to download the speech model now (one time, can take a few minutes).',
      input: z.object({
        prepare_model: z.boolean().optional().describe('download the default speech model now'),
        model: z
          .string()
          .optional()
          .describe('which model to prepare: tiny, base, small, medium, turbo, large'),
      }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args, ctx) => {
      if (args.prepare_model) {
        const id: ModelId = args.model && isModelId(args.model) ? args.model : defaultModel();
        return runJob(app, ctx, 'model', `Downloading the ${id} speech model`, async (ctl) => {
          const file = await ensureModel(id, (f, m) => ctl.progress(f, m), ctl.signal);
          return { content: [{ type: 'text', text: `The ${id} speech model is ready (${file}).` }] };
        });
      }
      const lines: string[] = [
        `vibeediting ${VERSION} on ${process.platform} ${process.arch}, Node ${process.versions.node}`,
      ];
      const ok = (b: boolean) => (b ? 'OK  ' : 'FIX ');
      const ff = await findFfmpeg(true);
      const dl = downloadState();
      const managed = ff && ff.ffmpeg === managedPaths().ffmpeg;
      if (ff && usable(ff)) {
        lines.push(
          `OK  FFmpeg ${ff.version}${managed ? ' (downloaded by vibeediting)' : ''} at ${ff.ffmpeg}`,
        );
      } else if (dl.running) {
        lines.push(
          `... FFmpeg: downloading the video tools now (${Math.round(dl.fraction * 100)}%, one time only). Editing works as soon as this finishes.`,
        );
      } else if (autoDownloadAllowed() && platformKey()) {
        void prefetchFfmpeg();
        lines.push(
          `... FFmpeg: ${ff ? 'the installed FFmpeg has no caption support, so ' : ''}I started downloading the video tools (about 50 MB, one time only).${dl.error ? ` Last try failed: ${dl.error}` : ''}`,
        );
      } else if (!ff) {
        lines.push(
          `${ok(false)}FFmpeg: not found. ${process.platform === 'darwin' ? INSTALL_HELP.mac : process.platform === 'win32' ? INSTALL_HELP.win : INSTALL_HELP.linux}`,
        );
      } else {
        lines.push(`${ok(false)}FFmpeg ${ff.version} at ${ff.ffmpeg}`);
        if (!ff.hasLibass)
          lines.push(
            `     It has no caption support (libass). ${process.platform === 'darwin' ? INSTALL_HELP.mac : INSTALL_HELP.win}`,
          );
        if (!ff.hasX264) lines.push('     It cannot write H.264 MP4. Install a full FFmpeg build.');
      }
      const lic = await app.license.check();
      lines.push(`${ok(lic.ok)}License ${lic.keyMasked}: ${lic.message.split('\n')[0]}`);
      const w = whisperAvailable();
      lines.push(`${ok(w)}Local speech-to-text: ${w ? 'available' : 'not available on this computer'}`);
      const def = defaultModel();
      for (const id of Object.keys(MODELS) as ModelId[]) {
        const ready = await isModelReady(id);
        if (ready || id === def)
          lines.push(
            `${ready ? 'OK  ' : '    '}Model ${id}${id === def ? ' (default)' : ''}: ${ready ? 'downloaded' : `not downloaded yet (${Math.round(MODELS[id].bytes / 1048576)} MB, downloads on first transcribe)`}`,
          );
      }
      const cloud = (['deepgram', 'openai'] as const).filter((e) => cloudKey(e));
      lines.push(`    Cloud transcription keys: ${cloud.length ? cloud.join(', ') : 'none (optional)'}`);
      const keys = stockKeys();
      lines.push(
        `    Stock footage keys: Pexels ${keys.pexels ? 'yes' : 'no'}, Pixabay ${keys.pixabay ? 'yes' : 'no'} (optional)`,
      );
      const b = await findBrowser().catch(() => null);
      lines.push(
        `${b ? 'OK  ' : '    '}Browser for custom animations: ${b ? b.label : 'none found (optional; built-in titles and charts still work)'}`,
      );
      await ensureDir(vibeHome());
      const free = await freeBytes(vibeHome());
      if (free !== null)
        lines.push(`${ok(free > 3 * 1024 ** 3)}Free disk space: ${(free / 1024 ** 3).toFixed(1)} GB`);
      lines.push(
        `    RAM: ${(os.totalmem() / 1024 ** 3).toFixed(0)} GB, CPU threads: ${os.availableParallelism?.() ?? os.cpus().length}`,
      );
      lines.push(
        app.ws.root
          ? `OK  Working folder: ${app.ws.root} (from ${app.ws.source})`
          : 'FIX Working folder: unknown. Ask the user which folder holds the videos and call set_working_folder.',
      );
      lines.push(`    Data folder: ${vibeHome()} (models in ${dirs.models()})`);
      return text(lines.join('\n'));
    },
  );

  tool(
    app,
    'check_license',
    {
      title: 'Check license',
      description:
        'Check the vibeediting license on this computer (use when the user says "Check my vibeediting license"). Contacts the license server.',
      input: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const s = await app.license.check({ force: true });
      const source = await app.license.keySource();
      const from =
        source === 'saved'
          ? ' (saved on this computer)'
          : source === 'settings'
            ? ' (from the app settings)'
            : '';
      const extra =
        (s.checkedAt ? `\nLast successful check: ${s.checkedAt}` : '') +
        (s.ok ? '' : '\nTo use a different key, ask the user for it and call activate_license.');
      return {
        content: [{ type: 'text', text: `Key: ${s.keyMasked}${from}\n${s.message}${extra}` }],
        isError: !s.ok,
      };
    },
  );

  tool(
    app,
    'activate_license',
    {
      title: 'Activate license',
      description:
        'Activate vibeediting with the license key the user gives you (VIBE-XXXX-XXXX-XXXX-XXXX, from their purchase email). Saves it on this computer, so it is only needed once. Use when a tool says no license key was found, or the user wants to change their key.',
      input: z.object({ key: z.string().min(4).describe('the license key exactly as the user gave it') }),
      annotations: { idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const key = normalizeKey(args.key);
      if (!isValidKeyFormat(key)) {
        return fail(
          `"${args.key.slice(0, 40)}" does not look like a vibeediting key. It should look like VIBE-XXXX-XXXX-XXXX-XXXX (letters and numbers, no 0, 1, O or I). Ask the user to copy it again from their purchase email.`,
        );
      }
      await writeUserConfig({ licenseKey: key });
      const s = await app.license.check({ force: true });
      if (s.ok)
        return text(
          `Activated. ${s.message} The key is saved on this computer, so you will not be asked again.`,
        );
      if (s.state === 'offline')
        return text(`I saved the key, but could not reach the license server to confirm it. ${s.message}`);
      return fail(`I saved the key, but the license server did not accept it. ${s.message}`);
    },
  );

  tool(
    app,
    'deactivate_this_computer',
    {
      title: 'Deactivate this computer',
      description:
        'Free this computer\'s license slot so the key can be used on another computer (use when the user says "Deactivate vibeediting on this computer"). Ask the user to confirm first.',
      input: z.object({ confirm: z.boolean().describe('must be true: the user confirmed') }),
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async (args) => {
      if (!args.confirm) return text('Not done. Ask the user to confirm, then call again with confirm=true.');
      const r = await app.license.deactivate();
      return { content: [{ type: 'text', text: r.message }], isError: !r.ok };
    },
  );

  tool(
    app,
    'set_working_folder',
    {
      title: 'Set working folder',
      description:
        "Set the folder that holds the user's videos. vibeediting only reads and writes inside this folder (and its own ~/.vibeediting). Use the full path the user gives you.",
      input: z.object({ path: z.string().describe('absolute folder path') }),
      annotations: { idempotentHint: true },
    },
    async (args) => {
      app.ws.setRoot(args.path, 'set_working_folder');
      return text(
        `Working folder set to ${app.ws.root}. Finished videos will go to an "exports" folder next to each video.`,
      );
    },
  );

  tool(
    app,
    'get_job_status',
    {
      title: 'Get job status',
      description:
        'Wait for a background job (render, transcription, analysis) and get its result. Waits up to wait_seconds (default 45, max 50) before answering; call again if it is still running. Set cancel=true to stop the job.',
      input: z.object({
        job_id: z.string().optional().describe('job id; omit to list recent jobs'),
        wait_seconds: z.number().min(0).max(MAX_WAIT_SECONDS).optional(),
        cancel: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) => {
      if (!args.job_id) {
        const list = app.jobs.list().slice(0, 10);
        if (!list.length) return text('No jobs yet.');
        return text(
          list.map((j) => `${j.id}: ${j.label} - ${j.status} ${Math.round(j.progress * 100)}%`).join('\n'),
        );
      }
      if (args.cancel)
        return text(
          app.jobs.cancel(args.job_id)
            ? `Cancelling job ${args.job_id}.`
            : `Job ${args.job_id} is not running.`,
        );
      return waitJob(app, ctx, args.job_id, Math.min(MAX_WAIT_SECONDS, args.wait_seconds ?? 45));
    },
  );
}
