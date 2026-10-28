import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../util/proc.js';

export const SERVER_KEY = 'vibeediting';

export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** System folders kept on PATH for the server (so npx can find node, and macOS tools keep working). */
function basePath(): string[] {
  if (process.platform === 'win32') {
    const sr = process.env.SystemRoot ?? 'C:\\Windows';
    return [
      path.join(sr, 'System32'),
      sr,
      path.join(sr, 'System32', 'Wbem'),
      path.join(sr, 'System32', 'WindowsPowerShell', 'v1.0'),
    ];
  }
  return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
}

function npxCli(nodeDir: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js')]
      : [
          path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
          path.join(nodeDir, '..', 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
        ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/**
 * How AI apps should start vibeediting. Uses the absolute path of the Node.js that runs
 * this setup, so it also works when Node.js was installed privately by our installer.
 * When we run from the npx cache we launch through npx (always the latest version);
 * from a local checkout we launch the file directly.
 */
export function launchSpec(
  opts: { packageSpec?: string; cliPath?: string; mode?: 'npx' | 'direct' } = {},
): LaunchSpec {
  const node = process.execPath;
  const nodeDir = path.dirname(node);
  const cli = opts.cliPath ?? fileURLToPath(new URL(import.meta.url));
  const fromNpx = /[\\/]_npx[\\/]/.test(cli);
  const mode = opts.mode ?? (fromNpx ? 'npx' : 'direct');
  const env = { PATH: [nodeDir, ...basePath()].join(path.delimiter) };
  if (mode === 'npx') {
    const pkg = opts.packageSpec ?? process.env.VIBE_PACKAGE ?? '@vibeediting/mcp';
    // A registry name runs as "npx -y <pkg>"; a tarball or folder (tests) needs --package.
    const npxArgs = /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~<>=-]+)?$/.test(pkg)
      ? ['-y', pkg]
      : ['-y', '--package', pkg, '--', 'vibeediting-mcp'];
    const npx = npxCli(nodeDir);
    if (npx) return { command: node, args: [npx, ...npxArgs], env };
    return {
      command: process.platform === 'win32' ? 'npx.cmd' : path.join(nodeDir, 'npx'),
      args: npxArgs,
      env,
    };
  }
  return { command: node, args: [cli], env };
}

export interface AppResult {
  app: string;
  status: 'connected' | 'not-found' | 'failed' | 'skipped';
  detail?: string;
}

/** Find a program on PATH (and a few usual places), like `which`. */
export function which(name: string, extra: string[] = []): string | null {
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
      : [''];
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...extra];
  for (const d of dirs) {
    if (!d) continue;
    for (const e of exts) {
      const p = path.join(d, name + e);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

async function runCli(exe: string, args: string[]): Promise<{ code: number | null; out: string }> {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    // .cmd files need the shell on Windows; quote every argument.
    const quoted = [exe, ...args].map((a) => `"${a.replace(/"/g, '""')}"`).join(' ');
    const r = await run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${quoted}"`], {
      timeoutMs: 60_000,
    });
    return { code: r.code, out: r.stdout + r.stderr };
  }
  const r = await run(exe, args, { timeoutMs: 60_000 });
  return { code: r.code, out: r.stdout + r.stderr };
}

/** Claude Code: via its own `claude mcp add` command (user scope = every folder). */
export async function connectClaudeCode(spec: LaunchSpec): Promise<AppResult> {
  const home = os.homedir();
  const exe = which('claude', [path.join(home, '.claude', 'local'), path.join(home, '.local', 'bin')]);
  if (!exe) return { app: 'Claude Code', status: 'not-found' };
  await runCli(exe, ['mcp', 'remove', SERVER_KEY, '--scope', 'user']).catch(() => undefined);
  const envArgs = Object.entries(spec.env).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  const r = await runCli(exe, [
    'mcp',
    'add',
    SERVER_KEY,
    '--scope',
    'user',
    ...envArgs,
    '--',
    spec.command,
    ...spec.args,
  ]).catch((e) => ({ code: 1, out: String(e) }));
  return r.code === 0
    ? { app: 'Claude Code', status: 'connected' }
    : { app: 'Claude Code', status: 'failed', detail: r.out.trim().split('\n').slice(-2).join(' ') };
}

function readJsonFile(file: string): any | null | 'invalid' {
  if (!fs.existsSync(file)) return null;
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    return text ? JSON.parse(text) : {};
  } catch {
    return 'invalid';
  }
}

/** Add or replace our server in an app's JSON config ({ "mcpServers": { ... } }). */
export function mergeJsonConfig(file: string, entry: Record<string, unknown>): 'ok' | 'invalid' {
  const current = readJsonFile(file);
  if (current === 'invalid') return 'invalid';
  const data = current ?? {};
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.before-vibeediting`);
  data.mcpServers = { ...(data.mcpServers ?? {}), [SERVER_KEY]: entry };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return 'ok';
}

export function cursorConfigFile(): string {
  return path.join(os.homedir(), '.cursor', 'mcp.json');
}

export function connectCursor(spec: LaunchSpec): AppResult {
  if (!fs.existsSync(path.dirname(cursorConfigFile()))) return { app: 'Cursor', status: 'not-found' };
  const r = mergeJsonConfig(cursorConfigFile(), { command: spec.command, args: spec.args, env: spec.env });
  return r === 'ok'
    ? { app: 'Cursor', status: 'connected' }
    : {
        app: 'Cursor',
        status: 'failed',
        detail: `${cursorConfigFile()} is not valid JSON; left it unchanged`,
      };
}

export function claudeDesktopConfigFile(): string | null {
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'win32')
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'Claude',
      'claude_desktop_config.json',
    );
  return null;
}

/** Claude app (chat): skipped when the vibeediting extension (.mcpb) is already installed there. */
export function connectClaudeDesktop(spec: LaunchSpec): AppResult {
  const file = claudeDesktopConfigFile();
  if (!file || !fs.existsSync(path.dirname(file))) return { app: 'Claude app', status: 'not-found' };
  const extDir = path.join(path.dirname(file), 'Claude Extensions');
  try {
    if (fs.readdirSync(extDir).some((d) => /vibeediting/i.test(d)))
      return {
        app: 'Claude app',
        status: 'skipped',
        detail: 'the vibeediting extension is already installed',
      };
  } catch {
    /* no extensions folder */
  }
  const r = mergeJsonConfig(file, { command: spec.command, args: spec.args, env: spec.env });
  return r === 'ok'
    ? { app: 'Claude app', status: 'connected', detail: 'restart the Claude app to load it' }
    : { app: 'Claude app', status: 'failed', detail: `${file} is not valid JSON; left it unchanged` };
}

export function codexConfigFile(): string {
  return path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'config.toml');
}

/** Replace our [mcp_servers.vibeediting] table in a Codex config.toml text. */
export function upsertCodexToml(text: string, spec: LaunchSpec): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header)
      skipping =
        header[1].trim() === `mcp_servers.${SERVER_KEY}` ||
        header[1].trim().startsWith(`mcp_servers.${SERVER_KEY}.`);
    if (!skipping) out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  const q = (s: string) => JSON.stringify(s);
  const env = Object.entries(spec.env)
    .map(([k, v]) => `${k} = ${q(v)}`)
    .join(', ');
  const block = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${q(spec.command)}`,
    `args = [${spec.args.map(q).join(', ')}]`,
    `env = { ${env} }`,
    'startup_timeout_sec = 60',
    'tool_timeout_sec = 300',
  ];
  return [...out, ...(out.length ? [''] : []), ...block, ''].join('\n');
}

export function connectCodex(spec: LaunchSpec): AppResult {
  const file = codexConfigFile();
  if (!fs.existsSync(path.dirname(file)) && !which('codex')) return { app: 'Codex', status: 'not-found' };
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (before) fs.copyFileSync(file, `${file}.before-vibeediting`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, upsertCodexToml(before, spec));
  return { app: 'Codex', status: 'connected' };
}
