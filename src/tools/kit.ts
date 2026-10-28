import type { McpServer, ServerContext, ToolAnnotations } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { isFinal, type JobContent, type JobControl, type JobManager, type JobResult } from '../jobs.js';
import type { LicenseClient } from '../license/client.js';
import type { ProjectStore } from '../timeline/store.js';
import { outputDuration } from '../timeline/ops.js';
import type { Project } from '../timeline/types.js';
import { toolWaitSeconds } from '../util/config.js';
import { errorMessage, UserError } from '../util/errors.js';
import { log } from '../util/log.js';
import { parseTime } from '../util/time.js';
import type { Workspace } from '../util/workspace.js';

export interface App {
  server: McpServer;
  ws: Workspace;
  store: ProjectStore;
  jobs: JobManager;
  license: LicenseClient;
  /** Only register these tools (smaller tool list for clients with limits). */
  only?: Set<string> | null;
}

export type Content = JobContent;
export interface ToolResult {
  content: Content[];
  isError?: boolean;
  [k: string]: unknown;
}

export const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
export const fail = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }], isError: true });
export const jpeg = (buf: Buffer): Content => ({
  type: 'image',
  data: buf.toString('base64'),
  mimeType: 'image/jpeg',
});
export const png = (buf: Buffer): Content => ({
  type: 'image',
  data: buf.toString('base64'),
  mimeType: 'image/png',
});

/** Time input: 12.5, "12.5", "1:05", "1:02:03". */
export const zTime = z.union([z.number(), z.string()]).describe('seconds (12.5) or m:ss (1:05)');
export const zProject = z.string().optional().describe('project name; default = the current project');
export const t = (v: number | string | undefined, d = 0): number => (v === undefined ? d : parseTime(v));

const UNGATED = new Set([
  'check_setup',
  'check_license',
  'activate_license',
  'deactivate_this_computer',
  'set_working_folder',
  'get_job_status',
  'list_styles',
]);

export interface ToolDef<S extends z.ZodObject<any>> {
  title: string;
  description: string;
  input: S;
  annotations?: ToolAnnotations;
}

/** Register a tool with license gate, working-folder detection and friendly errors. */
export function tool<S extends z.ZodObject<any>>(
  app: App,
  name: string,
  def: ToolDef<S>,
  handler: (args: z.infer<S>, ctx: ServerContext) => Promise<ToolResult>,
): void {
  if (app.only && !app.only.has(name)) return;
  app.server.registerTool(
    name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.input,
      annotations: { title: def.title, openWorldHint: false, ...def.annotations },
    },
    (async (args: z.infer<S>, ctx: ServerContext) => {
      try {
        if (!UNGATED.has(name)) {
          const lic = await app.license.check();
          if (!lic.ok) return fail(lic.message);
        }
        if (!app.ws.root) await tryRoots(app);
        return await handler(args, ctx);
      } catch (err) {
        if (!(err instanceof UserError)) log.error(`tool ${name} failed`, err);
        return fail(errorMessage(err));
      }
    }) as any,
  );
}

/** Ask the client for its workspace folders (MCP roots), if it supports that. */
async function tryRoots(app: App): Promise<void> {
  try {
    const caps = app.server.server.getClientCapabilities();
    if (!caps?.roots) return;
    const res = await app.server.server.listRoots(undefined, { timeout: 3000 } as any);
    for (const r of res.roots ?? []) {
      if (!r.uri.startsWith('file://')) continue;
      const p = decodeURIComponent(new URL(r.uri).pathname).replace(/^\/([A-Za-z]:)/, '$1');
      try {
        app.ws.setRoot(p, 'client workspace');
        return;
      } catch {
        /* try next root */
      }
    }
  } catch {
    /* client without roots */
  }
}

function makeNotifier(ctx: ServerContext): (f: number, msg: string) => void {
  const token = ctx.mcpReq._meta?.progressToken;
  let last = 0;
  return (f, msg) => {
    if (token === undefined) return;
    const now = Date.now();
    if (now - last < 1000 && f < 1) return;
    last = now;
    void ctx.mcpReq
      .notify({
        method: 'notifications/progress',
        params: { progressToken: token, progress: Math.round(f * 1000) / 10, total: 100, message: msg },
      })
      .catch(() => undefined);
  };
}

/**
 * Run long work as a background job. Waits up to VIBE_TOOL_WAIT_SECONDS (40 s) and
 * returns the result directly if it finishes; otherwise returns the job id.
 */
export async function runJob(
  app: App,
  ctx: ServerContext,
  kind: string,
  label: string,
  fn: (ctl: JobControl) => Promise<JobResult>,
  waitSeconds?: number,
): Promise<ToolResult> {
  const job = app.jobs.start(kind, label, fn);
  const notify = makeNotifier(ctx);
  const done = await app.jobs.wait(job.id, (waitSeconds ?? toolWaitSeconds()) * 1000, (j) =>
    notify(j.progress, j.message),
  );
  return jobResult(done.id, app);
}

export function jobResult(id: string, app: App): ToolResult {
  const j = app.jobs.get(id);
  if (!j) return fail(`There is no job ${id} (jobs are forgotten when the AI app restarts).`);
  if (j.status === 'done') return { content: j.result?.content ?? [{ type: 'text', text: 'Done.' }] };
  if (j.status === 'failed') return fail(j.error ?? 'The job failed.');
  if (j.status === 'cancelled') return text(`Job ${id} (${j.label}) was cancelled.`);
  const pct = Math.round(j.progress * 100);
  const elapsed = j.startedAt ? Math.round((Date.now() - j.startedAt) / 1000) : 0;
  let eta = '';
  if (j.progress > 0.05 && elapsed > 5)
    eta = ` About ${Math.max(1, Math.round((elapsed / j.progress - elapsed) / 60))} min left.`;
  return text(
    `${j.label} is still running in the background (${pct}%, ${j.message}).${eta}\nJob id: ${id}. Call get_job_status with job_id "${id}" to wait for the result. Tell the user it is working; do not start the same job again.`,
  );
}

export async function waitJob(
  app: App,
  ctx: ServerContext,
  id: string,
  seconds: number,
): Promise<ToolResult> {
  const j = app.jobs.get(id);
  if (!j) return fail(`There is no job ${id}.`);
  if (!isFinal(j.status)) {
    const notify = makeNotifier(ctx);
    await app.jobs.wait(id, seconds * 1000, (x) => notify(x.progress, x.message));
  }
  return jobResult(id, app);
}

/** One-line project summary returned after every edit. */
export function summary(p: Project): string {
  const d = outputDuration(p.clips);
  const ov = p.overlays.length;
  const cap = p.captions?.enabled ? `captions on (${p.captions.words.length} words)` : 'no captions';
  const music = p.audio.music ? ', music' : '';
  return `Project "${p.name}": ${d.toFixed(1)} s, ${p.clips.length} clip(s), ${p.format.aspect} ${p.format.width}x${p.format.height}, style ${p.styleName}, ${cap}, ${ov} overlay(s)${music}.`;
}

export function done(p: Project, what: string, next?: string): ToolResult {
  return text(`${what}\n${summary(p)}${next ? `\nNext: ${next}` : ''}`);
}

export async function loadProject(app: App, name?: string): Promise<Project> {
  return app.store.load(name);
}
