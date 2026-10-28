import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasFfmpeg, makeToneVideo, tmpDir } from '../helpers/fixtures.js';
import { type MockLicense, startMockLicense, VALID_KEY } from '../helpers/mockLicense.js';

const CLI = path.resolve(__dirname, '../../dist/cli.js');

async function connect(cwd: string, env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI],
    cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      USERPROFILE: process.env.USERPROFILE ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      ...env,
    },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

const textOf = (r: any): string =>
  r.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');

describe.skipIf(!fs.existsSync(CLI) || !hasFfmpeg())('MCP server end to end (stdio)', () => {
  let lic: MockLicense;
  let root: string;
  let home: string;
  let client: Client;

  beforeAll(async () => {
    lic = await startMockLicense();
    root = tmpDir('e2e-');
    home = path.join(root, '.vibehome');
    makeToneVideo(path.join(root, 'my talk.mp4'), { duration: 10 });
    client = await connect(root, {
      VIBE_HOME: home,
      VIBE_API_URL: lic.url,
      VIBE_LICENSE_KEY: VALID_KEY,
      VIBE_TOOL_WAIT_SECONDS: '120',
    });
  });
  afterAll(async () => {
    await client?.close();
    await lic?.close();
  });

  it('advertises tools, prompts and instructions', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of [
      'analyze_video',
      'cut_silences',
      'add_captions',
      'render_motion_graphic',
      'export_video',
      'check_license',
      'deactivate_this_computer',
    ])
      expect(names).toContain(n);
    expect(tools.length).toBeGreaterThanOrEqual(40);
    for (const t of tools) {
      expect(t.title ?? t.annotations?.title).toBeTruthy();
      expect(t.description!.length).toBeGreaterThan(20);
    }
    expect(client.getInstructions()).toContain('WAIT for the user');
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'add-broll',
      'podcast-to-shorts',
      'talking-head-reel',
      'youtube-long-form',
    ]);
    const pr = await client.getPrompt({ name: 'talking-head-reel', arguments: { video: 'my talk.mp4' } });
    expect((pr.messages[0].content as any).text).toContain('my talk.mp4');
  });

  it('checks the license against the API', async () => {
    const r: any = await client.callTool({ name: 'check_license', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain('License OK');
    expect(lic.calls.some((c) => c.path === '/api/license/verify')).toBe(true);
  });

  it('edits, previews and exports a video', async () => {
    let r: any = await client.callTool({
      name: 'create_project',
      arguments: { videos: ['my talk.mp4'], aspect: '9:16' },
    });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain('Created project "my-talk"');

    r = await client.callTool({ name: 'create_project', arguments: { videos: ['../outside.mp4'] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/only work inside your working folder/);

    r = await client.callTool({ name: 'cut_silences', arguments: {} });
    expect(textOf(r)).toMatch(/Cut 2 pauses/);

    r = await client.callTool({ name: 'add_captions', arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('transcribe');

    r = await client.callTool({
      name: 'add_title_card',
      arguments: { text: 'Hello रील', start: '0:00', duration: 2 },
    });
    expect(r.isError).toBeFalsy();
    r = await client.callTool({
      name: 'render_motion_graphic',
      arguments: { template: 'counter', params: { to: 100, suffix: '%' }, start: 2, duration: 2 },
    });
    expect(textOf(r)).toContain('counter');
    r = await client.callTool({ name: 'add_zoom', arguments: { auto: true, every: 3 } });
    expect(textOf(r)).toMatch(/zoom/);

    r = await client.callTool({ name: 'undo', arguments: {} });
    expect(textOf(r)).toContain('Undid');
    r = await client.callTool({ name: 'get_project', arguments: {} });
    expect(textOf(r)).toContain('counter');
    expect(textOf(r)).not.toContain('zoom x');

    r = await client.callTool({ name: 'preview_video', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain('Preview ready');
    expect(r.content.some((c: any) => c.type === 'image' && c.mimeType === 'image/jpeg')).toBe(true);
    expect(fs.existsSync(path.join(root, 'exports', 'my-talk-preview.mp4'))).toBe(true);

    r = await client.callTool({ name: 'view_frames', arguments: { target: 'preview', times: [0.5, 3] } });
    expect(r.content.filter((c: any) => c.type === 'image')).toHaveLength(1);

    r = await client.callTool({ name: 'export_video', arguments: { preset: 'reels' } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/Exported exports\/my-talk-reels\.mp4: 1080x1920/);
    expect(fs.existsSync(path.join(root, 'exports', 'my-talk-reels.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'my talk.mp4'))).toBe(true);
  });

  it('returns a job id for long work and get_job_status waits for it', async () => {
    const c2 = await connect(root, {
      VIBE_HOME: home,
      VIBE_API_URL: lic.url,
      VIBE_LICENSE_KEY: VALID_KEY,
      VIBE_TOOL_WAIT_SECONDS: '0',
    });
    try {
      const r: any = await c2.callTool({
        name: 'preview_video',
        arguments: { project: 'my-talk', start: 0, end: 3 },
      });
      const m = /job_id "([^"]+)"/.exec(textOf(r));
      expect(m).not.toBeNull();
      const s: any = await c2.callTool({
        name: 'get_job_status',
        arguments: { job_id: m![1], wait_seconds: 120 },
      });
      expect(textOf(s)).toContain('Preview ready');
    } finally {
      await c2.close();
    }
  });

  it('blocks editing without a license but still starts and explains why', async () => {
    const c3 = await connect(root, { VIBE_HOME: path.join(root, '.nolicense'), VIBE_API_URL: lic.url });
    try {
      const r: any = await c3.callTool({ name: 'create_project', arguments: { videos: ['my talk.mp4'] } });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain('https://vibeediting.app/docs/activate-license');
      const s: any = await c3.callTool({ name: 'check_setup', arguments: {} });
      expect(textOf(s)).toContain('FFmpeg');
      expect(textOf(s)).toContain('FIX License');
    } finally {
      await c3.close();
    }
  });

  it('offers a smaller tool set with VIBE_TOOLSET=core', async () => {
    const c4 = await connect(root, {
      VIBE_HOME: home,
      VIBE_API_URL: lic.url,
      VIBE_LICENSE_KEY: VALID_KEY,
      VIBE_TOOLSET: 'core',
    });
    try {
      const { tools } = await c4.listTools();
      expect(tools.length).toBeLessThanOrEqual(30);
      expect(tools.map((t) => t.name)).toContain('export_video');
    } finally {
      await c4.close();
    }
  });
});
