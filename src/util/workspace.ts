import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vibeHome } from './config.js';
import { UserError } from './errors.js';

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';

function norm(p: string): string {
  const r = path.resolve(p);
  return caseInsensitive ? r.toLowerCase() : r;
}

/** True when `child` is `parent` or inside it. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolve symlinks for the longest existing part of the path. */
function realpathLoose(p: string): string {
  let current = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/** Folders we never accept as a working folder: home itself, drive roots, system folders. */
export function isUnsafeRoot(dir: string): boolean {
  const r = norm(dir);
  const home = norm(os.homedir());
  if (r === home) return true;
  if (path.parse(r).root === r) return true;
  // Exact system folders (never a sub folder like /private/var/folders/... temp dirs on macOS).
  const exact = [
    '/var',
    '/private',
    '/private/var',
    '/private/tmp',
    '/tmp',
    '/users',
    '/home',
    '/volumes',
    'c:\\users',
  ];
  if (exact.includes(r)) return true;
  const prefixes = [
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
    '/system',
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/library',
  ];
  return prefixes.some((b) => r === b || r.startsWith(b + path.sep));
}

/**
 * The working folder the agent was started in. We only read and write inside it,
 * plus our own ~/.vibeediting folder. Original videos are never modified.
 */
export class Workspace {
  private rootDir: string | null = null;
  private rootSource = '';

  constructor(initial?: { dir: string; source: string } | null) {
    if (initial) this.setRoot(initial.dir, initial.source);
  }

  static detect(): Workspace {
    const fromEnv: Array<[string | undefined, string]> = [
      [process.env.VIBE_PROJECT_DIR, 'VIBE_PROJECT_DIR'],
      [process.env.CLAUDE_PROJECT_DIR, 'CLAUDE_PROJECT_DIR'],
    ];
    for (const [dir, source] of fromEnv) {
      if (dir && dir.trim() && fs.existsSync(dir)) return new Workspace({ dir: dir.trim(), source });
    }
    const cwd = process.cwd();
    if (!isUnsafeRoot(cwd)) return new Workspace({ dir: cwd, source: 'current folder' });
    return new Workspace(null);
  }

  get root(): string | null {
    return this.rootDir;
  }

  get source(): string {
    return this.rootSource;
  }

  setRoot(dir: string, source: string): void {
    const resolved = realpathLoose(dir);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new UserError(
        `The folder "${dir}" does not exist. Give the full path of the folder with your videos.`,
      );
    }
    if (isUnsafeRoot(resolved)) {
      throw new UserError(
        `"${resolved}" is too broad to use as the working folder. Pick the folder that holds your videos (for example ${path.join(os.homedir(), 'Videos', 'my-reel')}).`,
      );
    }
    this.rootDir = resolved;
    this.rootSource = source;
  }

  requireRoot(): string {
    if (!this.rootDir) {
      throw new UserError(
        'I do not know which folder holds your videos yet. Ask the user for the folder path, then call set_working_folder with it. (Tip: start your AI app inside the video folder.)',
      );
    }
    return this.rootDir;
  }

  /**
   * Resolve a user-given path (absolute, or relative to the working folder) and
   * check it stays inside the working folder or ~/.vibeediting.
   */
  resolve(p: string, opts: { mustExist?: boolean; allowHome?: boolean } = {}): string {
    const root = this.requireRoot();
    if (!p || !p.trim()) throw new UserError('A file path is missing.');
    let cleaned = p.trim().replace(/^["']|["']$/g, '');
    if (cleaned.startsWith('file://'))
      cleaned = decodeURIComponent(new URL(cleaned).pathname).replace(/^\/([A-Za-z]:)/, '$1');
    if (cleaned === '~' || cleaned.startsWith('~/') || cleaned.startsWith('~\\'))
      cleaned = path.join(os.homedir(), cleaned.slice(1));
    const abs = path.isAbsolute(cleaned) ? cleaned : path.join(root, cleaned);
    const real = realpathLoose(abs);
    const okRoot = isInside(root, real);
    const okHome = opts.allowHome !== false && isInside(realpathLoose(vibeHome()), real);
    if (!okRoot && !okHome) {
      throw new UserError(
        `For safety I only work inside your working folder (${root}). "${p}" is outside it. Move the file into that folder, or call set_working_folder with the folder that holds it.`,
      );
    }
    if (opts.mustExist && !fs.existsSync(real)) {
      throw new UserError(
        `I cannot find "${p}" in ${root}. Check the file name (use list_media to see the videos here).`,
      );
    }
    return real;
  }

  /** Path relative to the working folder, with forward slashes (for messages and project files). */
  rel(abs: string): string {
    const root = this.rootDir;
    if (!root) return abs;
    const r = path.relative(root, abs);
    return r.startsWith('..') ? abs : r.split(path.sep).join('/') || '.';
  }
}
