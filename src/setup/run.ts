import readline from 'node:readline/promises';
import { findFfmpeg, usable } from '../media/ffmpeg.js';
import { downloadFfmpeg, platformKey } from '../media/ffmpegDownload.js';
import { isValidKeyFormat, maskKey, normalizeKey } from '../license/key.js';
import { LicenseClient } from '../license/client.js';
import { whisperAvailable } from '../transcribe/local.js';
import {
  defaultModel,
  ensureModel,
  isModelId,
  isModelReady,
  MODELS,
  type ModelId,
} from '../transcribe/models.js';
import { VERSION } from '../util/config.js';
import { readUserConfig, writeUserConfig } from '../util/userConfig.js';
import {
  type AppResult,
  connectClaudeCode,
  connectClaudeDesktop,
  connectCodex,
  connectCursor,
  launchSpec,
} from './apps.js';

export interface SetupOptions {
  license?: string;
  model?: string;
  noModel: boolean;
  noApps: boolean;
  yes: boolean;
}

export function parseSetupArgs(argv: string[]): SetupOptions {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`${flag}=`));
    return eq ? eq.slice(flag.length + 1) : undefined;
  };
  return {
    license: value('--license'),
    model: value('--model'),
    noModel: argv.includes('--no-model'),
    noApps: argv.includes('--no-apps'),
    yes: argv.includes('--yes') || argv.includes('-y'),
  };
}

const tty = !!process.stdout.isTTY;
const c = (code: string) => (s: string) => (tty ? `\u001b[${code}m${s}\u001b[0m` : s);
const bold = c('1');
const green = c('32');
const yellow = c('33');
const red = c('31');
const dim = c('2');

const say = (s = '') => process.stdout.write(`${s}\n`);

function progressBar(label: string): { update: (f: number) => void; done: (msg: string) => void } {
  let last = -1;
  return {
    update(f) {
      const pct = Math.max(0, Math.min(100, Math.floor(f * 100)));
      if (pct === last) return;
      last = pct;
      if (tty) {
        const width = 28;
        const fill = Math.round((pct / 100) * width);
        process.stdout.write(`\r  ${label} [${'#'.repeat(fill)}${'.'.repeat(width - fill)}] ${pct}%  `);
      } else if (pct % 10 === 0) {
        say(`  ${label} ${pct}%`);
      }
    },
    done(msg) {
      if (tty) process.stdout.write('\r\u001b[2K');
      say(msg);
    },
  };
}

async function ask(rl: readline.Interface | null, question: string): Promise<string> {
  if (!rl) return '';
  return (await rl.question(question)).trim();
}

async function setupLicense(opts: SetupOptions, rl: readline.Interface | null): Promise<boolean> {
  say(bold('1. License key'));
  const client = new LicenseClient();
  let candidate = normalizeKey(opts.license ?? '');
  if (!candidate) {
    const existing = await client.key();
    if (existing && isValidKeyFormat(existing)) {
      const s = await client.check({ force: true });
      if (s.ok) {
        say(green(`  OK  ${maskKey(existing)} is active on this computer.`));
        return true;
      }
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!candidate) {
      if (!rl) {
        say(
          yellow('  Skipped: no key given. You can paste it in the chat later and the AI will activate it.'),
        );
        return false;
      }
      candidate = normalizeKey(
        await ask(rl, '  Paste your license key from the purchase email (VIBE-XXXX-XXXX-XXXX-XXXX): '),
      );
      if (!candidate) {
        say(yellow('  Skipped. You can paste the key in the chat later and the AI will activate it.'));
        return false;
      }
    }
    if (!isValidKeyFormat(candidate)) {
      say(red('  That does not look like a vibeediting key. Copy it again from your purchase email.'));
      candidate = '';
      continue;
    }
    await writeUserConfig({ licenseKey: candidate });
    const s = await client.check({ force: true });
    if (s.ok) {
      say(green(`  OK  ${s.message.split('\n')[0]}`));
      return true;
    }
    if (s.state === 'offline') {
      say(
        yellow(
          `  Saved, but I could not reach the license server right now. It will be checked again later.`,
        ),
      );
      return true;
    }
    say(red(`  ${s.message.split('\n')[0]}`));
    candidate = '';
  }
  return false;
}

function appLine(r: AppResult): string {
  if (r.status === 'connected') return green(`  OK  ${r.app}${r.detail ? dim(` (${r.detail})`) : ''}`);
  if (r.status === 'skipped') return green(`  OK  ${r.app}${r.detail ? dim(` (${r.detail})`) : ''}`);
  if (r.status === 'not-found') return dim(`  --  ${r.app}: not installed on this computer`);
  return red(`  !!  ${r.app}: could not connect${r.detail ? ` (${r.detail})` : ''}`);
}

async function setupApps(): Promise<AppResult[]> {
  say(bold('2. Connecting your AI apps'));
  const spec = launchSpec();
  const results: AppResult[] = [];
  const attempt = async (name: string, fn: () => AppResult | Promise<AppResult>) => {
    try {
      results.push(await fn());
    } catch (err) {
      results.push({ app: name, status: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
    say(appLine(results[results.length - 1]));
  };
  await attempt('Claude Code', () => connectClaudeCode(spec));
  await attempt('Codex', () => connectCodex(spec));
  await attempt('Cursor', () => connectCursor(spec));
  await attempt('Claude app', () => connectClaudeDesktop(spec));
  if (!results.some((r) => r.status === 'connected' || r.status === 'skipped'))
    say(yellow('  No AI app found. Install Claude Code, Codex or Cursor, then run this installer again.'));
  return results;
}

async function setupFfmpeg(): Promise<boolean> {
  say(bold('3. Video tools (FFmpeg)'));
  const found = await findFfmpeg(true);
  if (found && usable(found)) {
    say(green(`  OK  FFmpeg ${found.version} is ready.`));
    return true;
  }
  if (!platformKey()) {
    say(
      red(
        '  I cannot download FFmpeg for this computer. Install it: https://vibeediting.app/docs/install-ffmpeg',
      ),
    );
    return false;
  }
  const bar = progressBar('Downloading FFmpeg (about 50 MB)');
  try {
    await downloadFfmpeg((f) => bar.update(f));
    const now = await findFfmpeg(true);
    bar.done(green(`  OK  FFmpeg ${now?.version ?? ''} downloaded.`));
    return true;
  } catch (err) {
    bar.done(red(`  !!  ${err instanceof Error ? err.message : String(err)}`));
    say('      It will be downloaded again automatically the first time you edit.');
    return false;
  }
}

async function setupModel(opts: SetupOptions): Promise<boolean> {
  say(bold('4. Speech-to-text model (for captions and cuts)'));
  if (opts.noModel) {
    say(dim('  Skipped. It downloads the first time you transcribe.'));
    return true;
  }
  if (!whisperAvailable()) {
    say(
      yellow(
        '  Local speech-to-text is not available on this computer. Cloud transcription can be used instead.',
      ),
    );
    return false;
  }
  const id: ModelId = opts.model && isModelId(opts.model) ? opts.model : defaultModel();
  if (await isModelReady(id)) {
    say(green(`  OK  The ${id} model is ready.`));
    return true;
  }
  const mb = Math.round(MODELS[id].bytes / 1048576);
  const bar = progressBar(`Downloading the ${id} model (${mb} MB)`);
  try {
    await ensureModel(id, (f) => bar.update(f));
    bar.done(green(`  OK  The ${id} model is ready.`));
    return true;
  } catch (err) {
    bar.done(red(`  !!  ${err instanceof Error ? err.message : String(err)}`));
    say('      It will be downloaded again automatically the first time you transcribe.');
    return false;
  }
}

/** `npx -y @vibeediting/mcp --setup`: everything a buyer needs, in one go. */
export async function runSetup(argv: string[]): Promise<number> {
  const opts = parseSetupArgs(argv);
  const interactive = !opts.yes && !!process.stdin.isTTY;
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  rl?.on('SIGINT', () => {
    say();
    say('Setup cancelled. Run the same command again any time.');
    process.exit(130);
  });
  say();
  say(bold(`vibeediting ${VERSION} setup`));
  say(dim('Everything stays on this computer. Your videos are never uploaded.'));
  say();
  try {
    const licensed = await setupLicense(opts, rl);
    rl?.close();
    say();
    const apps = opts.noApps ? [] : await setupApps();
    if (!opts.noApps) say();
    const ff = await setupFfmpeg();
    say();
    const model = await setupModel(opts);
    say();
    const connected = apps
      .filter((a) => a.status === 'connected' || a.status === 'skipped')
      .map((a) => a.app);
    say(bold(ff && model ? green('All set!') : 'Almost done.'));
    if (!licensed)
      say('  - Your license key is not active yet. Paste it in the chat and the AI will activate it.');
    if (connected.length) say(`  - Connected to: ${connected.join(', ')}.`);
    say();
    say(bold('What to do now:'));
    say('  1. Close and reopen your AI app (Claude Code, Codex, Cursor or the Claude app).');
    say('  2. Open the folder that has your video.');
    say('  3. Say: "Edit my-video.mp4 into a Reel with captions"');
    say();
    const saved = (await readUserConfig()).licenseKey;
    if (saved) say(dim(`Key ${maskKey(saved)} is saved in your home folder (.vibeediting).`));
    return 0;
  } catch (err) {
    rl?.close();
    say(red(`Setup stopped: ${err instanceof Error ? err.message : String(err)}`));
    return 1;
  }
}
