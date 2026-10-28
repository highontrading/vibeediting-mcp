import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describeMedia, type MediaInfo, probeMedia } from '../media/probe.js';
import { resolveStyle } from '../styles/store.js';
import { UserError } from '../util/errors.js';
import { exists, readJson, slugify, writeJson } from '../util/fsx.js';
import type { Workspace } from '../util/workspace.js';
import type { Aspect, Format, Project, Source } from './types.js';

const HISTORY_LIMIT = 30;

export function formatFor(
  aspect: Aspect,
  main: Source | undefined,
): Pick<Format, 'aspect' | 'width' | 'height'> {
  switch (aspect) {
    case '9:16':
      return { aspect, width: 1080, height: 1920 };
    case '1:1':
      return { aspect, width: 1080, height: 1080 };
    case '4:5':
      return { aspect, width: 1080, height: 1350 };
    case '16:9':
      return { aspect, width: 1920, height: 1080 };
    default: {
      let w = main?.width || 1920;
      let h = main?.height || 1080;
      const scale = Math.min(1, 3840 / Math.max(w, h));
      w = Math.round((w * scale) / 2) * 2;
      h = Math.round((h * scale) / 2) * 2;
      return { aspect: 'original', width: w, height: h };
    }
  }
}

export function fpsFor(main: Source | undefined): { fps: number; fpsText: string } {
  const f = main?.fps && main.fps > 1 ? Math.min(main.fps, 60) : 30;
  const ntsc: Array<[number, string]> = [
    [23.976, '24000/1001'],
    [29.97, '30000/1001'],
    [59.94, '60000/1001'],
  ];
  for (const [v, t] of ntsc) if (Math.abs(f - v) < 0.01) return { fps: v, fpsText: t };
  const r = Math.round(f);
  return { fps: r, fpsText: String(r) };
}

export class ProjectStore {
  private dirsByName = new Map<string, string>();
  private current: string | null = null;

  constructor(private readonly ws: Workspace) {}

  /** The folder that holds .vibeediting/ and exports/ for this project (the main video's folder). */
  projectDir(p: Project): string {
    const d = this.dirsByName.get(p.name);
    if (!d)
      throw new UserError(
        `I lost track of the folder for project "${p.name}". Call get_project with its name.`,
      );
    return d;
  }

  file(dir: string, name: string): string {
    return path.join(dir, '.vibeediting', 'projects', `${name}.json`);
  }

  sourcePath(p: Project, sourceId: string): string {
    const s = p.sources.find((x) => x.id === sourceId);
    if (!s) throw new UserError(`Source ${sourceId} is not in project ${p.name}.`);
    return path.resolve(this.projectDir(p), s.path);
  }

  relToProject(p: Project, abs: string): string {
    const r = path.relative(this.projectDir(p), abs);
    return r.split(path.sep).join('/');
  }

  async create(opts: {
    videos: string[];
    name?: string;
    aspect?: Aspect;
    style?: string;
    replace?: boolean;
  }): Promise<{ project: Project; infos: MediaInfo[] }> {
    if (opts.videos.length === 0) throw new UserError('Give at least one video file.');
    const infos: MediaInfo[] = [];
    for (const v of opts.videos) {
      const m = await probeMedia(v);
      if (!m.video && !m.audio) throw new UserError(`${m.name} has no video or audio.`);
      if (m.isImage)
        throw new UserError(
          `${m.name} is an image. Start a project from a video (images can be added later as B-roll).`,
        );
      infos.push(m);
    }
    const dir = path.dirname(infos[0].path);
    const name = slugify(opts.name ?? path.basename(infos[0].path), 'project');
    if ((await exists(this.file(dir, name))) && !opts.replace) {
      throw new UserError(
        `A project called "${name}" already exists here. Use get_project to open it, or pass replace=true to start it again from scratch, or choose another name.`,
      );
    }
    const sources: Source[] = infos.map((m, i) => ({
      id: `s${i + 1}`,
      path: path.relative(dir, m.path).split(path.sep).join('/'),
      duration: m.duration,
      width: m.video?.width ?? 0,
      height: m.video?.height ?? 0,
      fps: m.video?.fps ?? 30,
      hasAudio: !!m.audio,
      hasVideo: !!m.video,
    }));
    const main = sources.find((s) => s.hasVideo);
    const aspect: Aspect = opts.aspect ?? 'original';
    const style = await resolveStyle(opts.style, this.ws.root);
    const now = new Date().toISOString();
    const project: Project = {
      schema: 1,
      id: randomBytes(6).toString('hex'),
      name,
      createdAt: now,
      updatedAt: now,
      sources,
      clips: sources.map((s, i) => ({ id: `c${i + 1}`, source: s.id, in: 0, out: s.duration })),
      format: { ...formatFor(aspect, main), ...fpsFor(main), fit: 'crop', cropX: 0.5, cropY: 0.5 },
      styleName: style.name,
      style,
      captions: null,
      overlays: [],
      audio: { normalize: true, target: -14, denoise: 'off', music: null },
      log: [`Created from ${infos.map((m) => describeMedia(m)).join('; ')}`],
      nextId: sources.length + 1,
    };
    if (opts.replace)
      await fs.rm(path.join(dir, '.vibeediting', 'history', name), { recursive: true, force: true });
    this.dirsByName.set(name, dir);
    await writeJson(this.file(dir, name), project);
    this.current = name;
    return { project, infos };
  }

  /** Find project files in the working folder and its direct subfolders. */
  async discover(): Promise<Array<{ name: string; dir: string; updatedAt: string }>> {
    const root = this.ws.requireRoot();
    const dirs = [root];
    try {
      for (const e of await fs.readdir(root, { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'exports')
          dirs.push(path.join(root, e.name));
      }
    } catch {
      /* unreadable */
    }
    const found: Array<{ name: string; dir: string; updatedAt: string }> = [];
    for (const d of dirs) {
      const pdir = path.join(d, '.vibeediting', 'projects');
      let files: string[];
      try {
        files = await fs.readdir(pdir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const p = await readJson<Project>(path.join(pdir, f));
        if (p?.schema === 1) {
          found.push({ name: p.name, dir: d, updatedAt: p.updatedAt });
          if (!this.dirsByName.has(p.name)) this.dirsByName.set(p.name, d);
        }
      }
    }
    return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Load by name, or the current project, or the only/most recent one. */
  async load(name?: string): Promise<Project> {
    let target = name ? slugify(name) : this.current;
    if (!target || !this.dirsByName.has(target)) {
      const all = await this.discover();
      if (!target) {
        if (all.length === 0)
          throw new UserError('There is no editing project yet. Call create_project with your video first.');
        target = all[0].name;
      }
      if (!this.dirsByName.has(target)) {
        throw new UserError(
          `There is no project called "${name}". Projects here: ${all.map((a) => a.name).join(', ') || 'none'}.`,
        );
      }
    }
    const dir = this.dirsByName.get(target)!;
    const p = await readJson<Project>(this.file(dir, target));
    if (!p || p.schema !== 1)
      throw new UserError(
        `The project file for "${target}" is missing or damaged. Create the project again.`,
      );
    this.current = p.name;
    return p;
  }

  async save(p: Project, note?: string): Promise<void> {
    const dir = this.projectDir(p);
    const file = this.file(dir, p.name);
    // Keep the previous version for undo.
    const prev = await readJson<Project>(file);
    if (prev) {
      const hdir = path.join(dir, '.vibeediting', 'history', p.name);
      const stamp = `${Date.now()}`;
      await writeJson(path.join(hdir, `${stamp}.json`), prev);
      const all = (await fs.readdir(hdir)).filter((f) => f.endsWith('.json')).sort();
      for (const old of all.slice(0, Math.max(0, all.length - HISTORY_LIMIT)))
        await fs.rm(path.join(hdir, old), { force: true });
    }
    if (note) {
      p.log.push(note);
      if (p.log.length > 40) p.log = p.log.slice(-40);
    }
    p.updatedAt = new Date().toISOString();
    await writeJson(file, p);
    this.current = p.name;
  }

  async undo(name?: string): Promise<{ project: Project; undone: string }> {
    const p = await this.load(name);
    const dir = this.projectDir(p);
    const hdir = path.join(dir, '.vibeediting', 'history', p.name);
    let files: string[];
    try {
      files = (await fs.readdir(hdir)).filter((f) => f.endsWith('.json')).sort();
    } catch {
      files = [];
    }
    const last = files.pop();
    if (!last) throw new UserError('There is nothing to undo.');
    const prev = await readJson<Project>(path.join(hdir, last));
    if (!prev) throw new UserError('The undo history is damaged.');
    const undone = p.log[p.log.length - 1] ?? 'last change';
    await writeJson(this.file(dir, p.name), prev);
    await fs.rm(path.join(hdir, last), { force: true });
    return { project: prev, undone };
  }

  newId(p: Project, prefix: string): () => string {
    return () => `${prefix}${p.nextId++}`;
  }
}
