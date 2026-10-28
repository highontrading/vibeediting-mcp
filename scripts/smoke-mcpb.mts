/**
 * Unpack build/vibeediting.mcpb and start it the way the Claude app does, with the
 * optional settings left blank. Checks that the server starts and lists its tools.
 *
 *   npx tsx scripts/smoke-mcpb.mts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = path.resolve(import.meta.dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-mcpb-'));
const mcpb = path.join(root, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');
execFileSync(process.execPath, [mcpb, 'unpack', path.join(root, 'build', 'vibeediting.mcpb'), dir], {
  stdio: 'inherit',
});
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const cfg = manifest.server.mcp_config;
const sub = (s: string) => s.replace('${__dirname}', dir);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: cfg.args.map(sub),
  cwd: os.homedir(),
  env: {
    ...(process.env as Record<string, string>),
    ...cfg.env,
    VIBE_HOME: path.join(dir, '.vibehome'),
    VIBE_AUTO_DOWNLOAD: '0',
  },
  stderr: 'inherit',
});
const client = new Client({ name: 'mcpb-smoke', version: '1.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
const setup: any = await client.callTool({ name: 'check_setup', arguments: {} });
const text = setup.content.map((c: any) => c.text).join('\n');
await client.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(text);
if (tools.length < 40) throw new Error(`only ${tools.length} tools`);
if (!/License \(none\)/.test(text)) throw new Error('blank license setting was not treated as empty');
if (['darwin', 'win32'].includes(process.platform) && !/OK {2}Local speech-to-text/.test(text))
  throw new Error('the speech-to-text addon did not load from the extension');
if (/Pexels yes/.test(text)) throw new Error('blank Pexels setting was treated as a key');
console.log(`\nOK: the extension starts and offers ${tools.length} tools.`);
