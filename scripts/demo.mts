/**
 * Before/after demo: drives the built server (dist/cli.js) through the MCP client,
 * exactly like an AI agent would, on a video you choose.
 *
 *   npm run build
 *   npx tsx scripts/demo.mts "/path/to/folder" "my video.mp4" [--mock-license] [--model base] [--language en]
 *
 * Results: <folder>/exports/ and <folder>/demo-report.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startMockLicense, VALID_KEY } from '../test/helpers/mockLicense.js';

const [folder, video] = process.argv.slice(2);
const flag = (n: string) => process.argv.includes(n);
const opt = (n: string, d: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
if (!folder || !video) {
  console.error(
    'usage: tsx scripts/demo.mts <folder> <video> [--mock-license] [--model base] [--language en]',
  );
  process.exit(1);
}

const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  VIBE_TOOL_WAIT_SECONDS: '5',
};
let mock: Awaited<ReturnType<typeof startMockLicense>> | null = null;
if (flag('--mock-license')) {
  mock = await startMockLicense();
  env.VIBE_API_URL = mock.url;
  env.VIBE_LICENSE_KEY = VALID_KEY;
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve(import.meta.dirname, '../dist/cli.js')],
  cwd: folder,
  env,
  stderr: 'inherit',
});
const client = new Client({ name: 'vibeediting-demo', version: '1.0.0' });
await client.connect(transport);

const report: string[] = [`# vibeediting demo\n\nVideo: ${video}\n`];
let imageNo = 0;

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const t0 = Date.now();
  let r: any = await client.callTool({ name, arguments: args }, { timeout: 120_000 });
  let text = r.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');
  // Long jobs: keep waiting like an agent would.
  for (let m = /job_id "([^"]+)"/.exec(text); m && !r.isError; m = /job_id "([^"]+)"/.exec(text)) {
    r = await client.callTool(
      { name: 'get_job_status', arguments: { job_id: m[1], wait_seconds: 45 } },
      { timeout: 120_000 },
    );
    text = r.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`\n=== ${name} (${secs} s)${r.isError ? ' ERROR' : ''}\n${text}`);
  report.push(`## ${name} ${JSON.stringify(args)} (${secs} s)\n\n\`\`\`\n${text}\n\`\`\`\n`);
  for (const c of r.content) {
    if (c.type === 'image') {
      const f = `demo-image-${++imageNo}-${name}.jpg`;
      fs.writeFileSync(path.join(folder, f), Buffer.from(c.data, 'base64'));
      report.push(`![${name}](${f})\n`);
    }
  }
  if (r.isError) throw new Error(`${name} failed`);
  return text;
}

try {
  await call('check_setup');
  await call('create_project', {
    videos: [video],
    name: 'demo',
    aspect: '9:16',
    style: opt('--style', 'bold-yellow-pop'),
    replace: true,
  });
  await call('transcribe', { language: opt('--language', 'en'), model: opt('--model', 'turbo') });
  await call('analyze_video', { frames: 8 });
  await call('cut_silences');
  await call('remove_fillers');
  await call('add_captions');
  await call('add_title_card', {
    text: opt('--title', 'Stand like a pro speaker'),
    start: 0,
    duration: 2.6,
    position: 'top',
    animation: 'pop',
  });
  await call('add_zoom', { auto: true, every: 6 });
  await call('render_motion_graphic', {
    template: 'checklist',
    params: { title: '3 posture tips', items: ['Stand tall', 'Feet apart', 'Hands relaxed'] },
    start: 12,
    duration: 4,
  });
  await call('get_project');
  await call('preview_video');
  await call('export_video', { preset: 'reels' });
  await call('export_subtitles', { format: 'srt' });
} finally {
  fs.writeFileSync(path.join(folder, 'demo-report.md'), report.join('\n'));
  await client.close();
  await mock?.close();
}
