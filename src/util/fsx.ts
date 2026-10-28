import fs from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

export async function ensureDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Write a file atomically (temp file + rename) so a crash never leaves half-written JSON. */
export async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    // Windows can refuse rename over a file that another process has open; retry with copy.
    await fs.copyFile(tmp, file);
    await fs.rm(tmp, { force: true });
    if (!(await exists(file))) throw err;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function shortHash(data: string): string {
  return sha256(data).slice(0, 12);
}

/** A file name that does not exist yet: name.mp4, name-2.mp4, name-3.mp4 ... */
export async function uniquePath(file: string): Promise<string> {
  if (!(await exists(file))) return file;
  const ext = path.extname(file);
  const base = file.slice(0, file.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

/** Safe file-name slug: keeps letters (any script), digits, dash and underscore. */
export function slugify(name: string, fallback = 'project'): string {
  const s = name
    .normalize('NFKC')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return s.length > 0 ? s : fallback;
}
