/**
 * Build the one-click Claude app extension: build/vibeediting.mcpb
 *
 *   npm run build:mcpb
 *
 * The extension carries everything except FFmpeg and the speech model (both download
 * on first use): our server, its npm dependencies and the speech-to-text addon for
 * macOS (Apple Silicon + Intel) and Windows (x64 + ARM). The Claude app runs it with
 * its own built-in Node.js, so buyers install nothing else.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import pkg from '../package.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '..');
const buildDir = path.join(root, 'build');
const stage = path.join(buildDir, 'mcpb');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const WHISPER_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64'];

function sh(cmd: string, args: string[], cwd = root): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  });
}

/** Unpack an npm tarball (files under "package/") into dest. No external tar needed. */
function extractTgz(file: string, dest: string): void {
  const buf = gunzipSync(fs.readFileSync(file));
  const str = (o: number, n: number) => buf.toString('utf8', o, o + n).replace(/\0.*$/s, '');
  for (let off = 0; off + 512 <= buf.length;) {
    const name = str(off, 100);
    if (!name) break;
    const size = parseInt(str(off + 124, 12).trim() || '0', 8);
    const type = str(off + 156, 1) || '0';
    const prefix = str(off + 345, 155);
    const full = (prefix ? `${prefix}/` : '') + name;
    const rel = full.split('/').slice(1).join('/');
    if ((type === '0' || type === '') && rel && !rel.split('/').includes('..')) {
      const target = path.join(dest, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buf.subarray(off + 512, off + 512 + size));
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
}

if (!fs.existsSync(path.join(root, 'dist', 'cli.js'))) throw new Error('Run npm run build first.');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// 1. Our code and files.
fs.cpSync(path.join(root, 'dist'), path.join(stage, 'server'), { recursive: true });
fs.cpSync(path.join(root, 'assets'), path.join(stage, 'assets'), { recursive: true });
for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'])
  fs.copyFileSync(path.join(root, f), path.join(stage, f));
fs.copyFileSync(path.join(root, 'packaging', 'icon.png'), path.join(stage, 'icon.png'));

// 2. Runtime dependencies (no dev tools, no install scripts).
fs.writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'vibeediting-extension',
      version: pkg.version,
      private: true,
      type: 'module',
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ),
);
sh(
  npm,
  [
    'install',
    '--omit=dev',
    '--omit=optional',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
  ],
  stage,
);

// 3. Speech-to-text addon for every computer the Claude app runs on.
const whisperVersion = pkg.optionalDependencies['@fugood/node-whisper-darwin-arm64'];
const tmp = path.join(buildDir, 'tgz');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
for (const p of WHISPER_PLATFORMS) {
  const name = `@fugood/node-whisper-${p}`;
  const file = sh(npm, ['pack', `${name}@${whisperVersion}`, '--pack-destination', tmp, '--silent'], root)
    .trim()
    .split('\n')
    .pop()!;
  const dest = path.join(stage, 'node_modules', name);
  fs.mkdirSync(dest, { recursive: true });
  extractTgz(path.join(tmp, file), dest);
  if (!fs.existsSync(path.join(dest, 'index.node'))) throw new Error(`${name}: index.node missing`);
}
fs.rmSync(tmp, { recursive: true, force: true });

// 4. The manifest the Claude app reads.
const manifest = {
  manifest_version: '0.3',
  name: 'vibeediting',
  display_name: 'vibeediting',
  version: pkg.version,
  description:
    'Edit your videos by talking to Claude: cut silences, add captions, titles and B-roll, export Reels, Shorts and YouTube videos.',
  long_description:
    'vibeediting turns Claude into a video editor that works on your own computer. Say what you want ("make this a Reel with Hinglish captions") and it cuts silences and filler words, adds animated captions, titles, charts and stock B-roll, reframes for 9:16, 1:1 or 16:9, and exports a finished MP4. Your footage never leaves your computer and your original files are never changed. The video tools (FFmpeg) and the speech-to-text model download automatically the first time you need them.',
  author: { name: 'vibeediting', url: 'https://vibeediting.app' },
  homepage: 'https://vibeediting.app',
  documentation: 'https://vibeediting.app/docs',
  support: 'https://vibeediting.app/support',
  icon: 'icon.png',
  license: 'SEE LICENSE IN LICENSE',
  keywords: ['video', 'editing', 'captions', 'reels', 'shorts', 'youtube', 'ffmpeg', 'whisper'],
  privacy_policies: ['https://vibeediting.app/privacy'],
  server: {
    type: 'node',
    entry_point: 'server/cli.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/cli.js'],
      env: {
        VIBE_LICENSE_KEY: '${user_config.license_key}',
        VIBE_PROJECT_DIR: '${user_config.videos_folder}',
        PEXELS_API_KEY: '${user_config.pexels_api_key}',
        PIXABAY_API_KEY: '${user_config.pixabay_api_key}',
      },
    },
  },
  tools_generated: true,
  compatibility: {
    platforms: ['darwin', 'win32'],
    runtimes: { node: '>=22.12.0' },
  },
  user_config: {
    license_key: {
      type: 'string',
      title: 'License key',
      description:
        'From your purchase email: VIBE-XXXX-XXXX-XXXX-XXXX. You can also leave this empty and paste the key in the chat.',
      sensitive: true,
      required: false,
    },
    videos_folder: {
      type: 'directory',
      title: 'Videos folder',
      description:
        'The folder that has your videos. Finished videos are saved in an "exports" folder next to each video. You can also tell Claude the folder in the chat.',
      required: false,
    },
    pexels_api_key: {
      type: 'string',
      title: 'Pexels API key (optional)',
      description: 'Free key from pexels.com/api for stock B-roll footage.',
      sensitive: true,
      required: false,
    },
    pixabay_api_key: {
      type: 'string',
      title: 'Pixabay API key (optional)',
      description: 'Free key from pixabay.com/api/docs for more stock footage.',
      sensitive: true,
      required: false,
    },
  },
};
fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// 5. Validate and pack with the official tool.
const mcpb = path.join(root, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');
const mcpbCli = fs.existsSync(mcpb) ? [process.execPath, mcpb] : ['npx', '-y', '@anthropic-ai/mcpb'];
const run = (args: string[]) =>
  execFileSync(mcpbCli[0], [...mcpbCli.slice(1), ...args], { stdio: 'inherit', cwd: root });
run(['validate', path.join(stage, 'manifest.json')]);
const out = path.join(buildDir, 'vibeediting.mcpb');
fs.rmSync(out, { force: true });
run(['pack', stage, out]);
const mb = (fs.statSync(out).size / 1048576).toFixed(1);
console.log(`\nBuilt ${path.relative(root, out)} (${mb} MB)`);
