import { McpServer } from '@modelcontextprotocol/server';
import { INSTRUCTIONS } from './instructions.js';
import { JobManager } from './jobs.js';
import { LicenseClient } from './license/client.js';
import { registerPrompts } from './prompts.js';
import { ProjectStore } from './timeline/store.js';
import { registerAudioTools } from './tools/audio.js';
import { registerGraphicsTools } from './tools/graphics.js';
import type { App } from './tools/kit.js';
import { registerOutputTools } from './tools/output.js';
import { registerProjectTools } from './tools/project.js';
import { registerSetupTools } from './tools/setup.js';
import { registerStyleTools } from './tools/style.js';
import { registerUnderstandTools } from './tools/understand.js';
import { SERVER_NAME, VERSION } from './util/config.js';
import { Workspace } from './util/workspace.js';

/** A smaller tool set for clients that limit the number of tools (VIBE_TOOLSET=core). */
export const CORE_TOOLS = [
  'check_setup',
  'check_license',
  'deactivate_this_computer',
  'set_working_folder',
  'get_job_status',
  'probe_media',
  'transcribe',
  'get_transcript',
  'analyze_video',
  'view_frames',
  'create_project',
  'get_project',
  'undo',
  'cut_silences',
  'remove_fillers',
  'cut_range',
  'trim',
  'set_aspect_ratio',
  'add_captions',
  'set_caption_text',
  'add_title_card',
  'add_text_overlay',
  'add_zoom',
  'render_motion_graphic',
  'update_overlay',
  'add_music',
  'preview_video',
  'export_video',
  'export_subtitles',
  'apply_style',
];

export interface Shared {
  ws: Workspace;
  store: ProjectStore;
  jobs: JobManager;
  license: LicenseClient;
}

export function createShared(opts: Partial<Shared> = {}): Shared {
  const ws = opts.ws ?? Workspace.detect();
  return {
    ws,
    store: opts.store ?? new ProjectStore(ws),
    jobs: opts.jobs ?? new JobManager(1),
    license: opts.license ?? new LicenseClient(),
  };
}

export function createServer(shared: Shared): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: VERSION,
      title: 'vibeediting',
      websiteUrl: 'https://vibeediting.app',
    } as any,
    { instructions: INSTRUCTIONS, capabilities: { tools: {}, prompts: {} } },
  );
  const toolset = process.env.VIBE_TOOLSET?.trim().toLowerCase();
  const app: App = { server, ...shared, only: toolset === 'core' ? new Set(CORE_TOOLS) : null };
  registerSetupTools(app);
  registerUnderstandTools(app);
  registerProjectTools(app);
  registerGraphicsTools(app);
  registerAudioTools(app);
  registerOutputTools(app);
  registerStyleTools(app);
  registerPrompts(server);
  return server;
}
