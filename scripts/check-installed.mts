/**
 * After the installer ran: start vibeediting exactly the way Cursor would (from
 * ~/.cursor/mcp.json) and check that the license, FFmpeg and tools are ready.
 * Used by CI on fresh macOS, Windows and Linux machines.
 *
 *   npx tsx scripts/check-installed.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const file = path.join(os.homedir(), '.cursor', 'mcp.json');
const entry = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.vibeediting;
if (!entry) throw new Error(`no vibeediting entry in ${file}`);
console.log(`Launching: ${entry.command} ${entry.args.join(' ')}`);
const transport = new StdioClientTransport({
  command: entry.command,
  args: entry.args,
  cwd: process.cwd(),
  // Like an app started from the dock: only what the config gives, plus the basics.
  env: {
    ...entry.env,
    HOME: os.homedir(),
    USERPROFILE: process.env.USERPROFILE ?? '',
    APPDATA: process.env.APPDATA ?? '',
    LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    TEMP: process.env.TEMP ?? '',
    TMP: process.env.TMP ?? '',
    VIBE_API_URL: process.env.VIBE_API_URL ?? '',
    VIBE_FFMPEG: process.env.VIBE_FFMPEG ?? '',
  },
  stderr: 'inherit',
});
const client = new Client({ name: 'install-check', version: '1.0.0' });
await client.connect(transport);
const r: any = await client.callTool({ name: 'check_setup', arguments: {} });
const text = r.content.map((c: any) => c.text).join('\n');
await client.close();
console.log(text);
for (const want of [/OK {2}FFmpeg .*downloaded by vibeediting/, /OK {2}License/]) {
  if (!want.test(text)) throw new Error(`check_setup is missing ${want}`);
}
console.log('\nOK: installed and working.');
