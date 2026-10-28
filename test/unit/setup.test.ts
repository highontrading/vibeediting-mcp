import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { launchSpec, mergeJsonConfig, upsertCodexToml } from '../../src/setup/apps.js';
import { parseSetupArgs, runSetup } from '../../src/setup/run.js';
import { tmpDir } from '../helpers/fixtures.js';
import { type MockLicense, startMockLicense, VALID_KEY } from '../helpers/mockLicense.js';

const spec = { command: '/x/node', args: ['/x/cli.js'], env: { PATH: '/x:/usr/bin' } };

describe('Codex config', () => {
  it('adds our table and keeps everything else', () => {
    const before = 'model = "o4"\n\n[mcp_servers.other]\ncommand = "foo"\n';
    const out = upsertCodexToml(before, spec);
    expect(out).toContain('model = "o4"');
    expect(out).toContain('[mcp_servers.other]\ncommand = "foo"');
    expect(out).toContain('[mcp_servers.vibeediting]\ncommand = "/x/node"\nargs = ["/x/cli.js"]');
    expect(out).toContain('env = { PATH = "/x:/usr/bin" }');
  });
  it('replaces an older vibeediting table instead of adding a second one', () => {
    const once = upsertCodexToml(
      '[mcp_servers.vibeediting]\ncommand = "old"\n\n[mcp_servers.vibeediting.env]\nA = "1"\n',
      spec,
    );
    const twice = upsertCodexToml(once, spec);
    expect(twice).toBe(once);
    expect(twice).not.toContain('old');
    expect(twice.match(/\[mcp_servers\.vibeediting/g)).toHaveLength(1);
  });
  it('quotes Windows paths correctly', () => {
    const out = upsertCodexToml('', { ...spec, command: 'C:\\Program Files\\nodejs\\node.exe' });
    expect(out).toContain('command = "C:\\\\Program Files\\\\nodejs\\\\node.exe"');
  });
});

describe('JSON app configs', () => {
  it('merges into mcpServers, keeps other servers and makes a backup', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'foo' } }, theme: 'dark' }));
    expect(mergeJsonConfig(file, { command: 'node' })).toBe('ok');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(data.theme).toBe('dark');
    expect(data.mcpServers.other.command).toBe('foo');
    expect(data.mcpServers.vibeediting.command).toBe('node');
    expect(fs.existsSync(`${file}.before-vibeediting`)).toBe(true);
  });
  it('creates a missing file and leaves broken JSON alone', () => {
    const dir = tmpDir();
    const fresh = path.join(dir, 'new', 'mcp.json');
    expect(mergeJsonConfig(fresh, { command: 'node' })).toBe('ok');
    expect(JSON.parse(fs.readFileSync(fresh, 'utf8')).mcpServers.vibeediting.command).toBe('node');
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ not json');
    expect(mergeJsonConfig(broken, { command: 'node' })).toBe('invalid');
    expect(fs.readFileSync(broken, 'utf8')).toBe('{ not json');
  });
});

describe('launch command', () => {
  it('starts the file directly from a local copy, with Node on PATH', () => {
    const s = launchSpec({ cliPath: '/opt/vibe/dist/cli.js' });
    expect(s.command).toBe(process.execPath);
    expect(s.args).toEqual(['/opt/vibe/dist/cli.js']);
    expect(s.env.PATH.split(path.delimiter)[0]).toBe(path.dirname(process.execPath));
  });
  it('goes through npx when setup itself ran from npx', () => {
    const s = launchSpec({ cliPath: '/home/a/.npm/_npx/123/node_modules/@vibeediting/mcp/dist/cli.js' });
    expect(s.args).toContain('-y');
    expect(s.args.at(-1)).toBe('@vibeediting/mcp');
  });
});

describe('setup command', () => {
  let lic: MockLicense;
  const saved = { ...process.env };
  beforeAll(async () => {
    lic = await startMockLicense();
  });
  afterAll(() => lic.close());
  afterEach(() => {
    // Mutate (not replace) process.env so os.homedir() keeps seeing HOME changes.
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    vi.restoreAllMocks();
  });

  it('reads its flags', () => {
    expect(parseSetupArgs(['--setup', '--license', 'VIBE-1', '--no-model', '--yes'])).toMatchObject({
      license: 'VIBE-1',
      noModel: true,
      noApps: false,
      yes: true,
    });
    expect(parseSetupArgs(['setup', '--model=small']).model).toBe('small');
  });

  it('saves the key, connects the apps it finds and reports the next steps', async () => {
    const home = tmpDir('setup-home-');
    fs.mkdirSync(path.join(home, '.codex'));
    fs.mkdirSync(path.join(home, '.cursor'));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
    process.env.CODEX_HOME = path.join(home, '.codex');
    process.env.VIBE_HOME = path.join(home, '.vibeediting');
    process.env.VIBE_API_URL = lic.url;
    process.env.VIBE_FFMPEG_BASE_URL = 'http://127.0.0.1:9/';
    process.env.PATH = tmpDir('empty-path-');
    delete process.env.VIBE_LICENSE_KEY;
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s: any) => {
      out += String(s);
      return true;
    });
    const code = await runSetup(['--setup', '--license', VALID_KEY.toLowerCase(), '--no-model', '--yes']);
    expect(code).toBe(0);
    const config = JSON.parse(fs.readFileSync(path.join(home, '.vibeediting', 'config.json'), 'utf8'));
    expect(config.licenseKey).toBe(VALID_KEY);
    expect(out).toContain('OK  Codex');
    expect(out).toContain('OK  Cursor');
    expect(out).toContain('Claude Code: not installed');
    expect(out).toContain('What to do now');
    expect(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')).toContain(
      '[mcp_servers.vibeediting]',
    );
    const cursor = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8'));
    expect(cursor.mcpServers.vibeediting.command).toBe(process.execPath);
  });

  it('does not stop when there is no key and nobody to ask', async () => {
    const home = tmpDir('setup-home-');
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.VIBE_HOME = path.join(home, '.vibeediting');
    process.env.VIBE_API_URL = lic.url;
    process.env.VIBE_FFMPEG_BASE_URL = 'http://127.0.0.1:9/';
    delete process.env.VIBE_LICENSE_KEY;
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s: any) => {
      out += String(s);
      return true;
    });
    expect(await runSetup(['--setup', '--no-model', '--no-apps', '--yes'])).toBe(0);
    expect(out).toContain('paste it in the chat');
  });
});
