import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;
export const SERVER_NAME = 'vibeediting';
export const DOCS_URL = 'https://vibeediting.app/docs';
export const ACTIVATE_URL = 'https://vibeediting.app/docs/activate-license';
export const SUPPORT_URL = 'https://vibeediting.app/support';

export function apiUrl(): string {
  const raw = process.env.VIBE_API_URL?.trim();
  return (raw && raw.length > 0 ? raw : 'https://vibeediting.app').replace(/\/+$/, '');
}

/** Our own folder: ~/.vibeediting (override with VIBE_HOME, used by tests). */
export function vibeHome(): string {
  const override = process.env.VIBE_HOME?.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), '.vibeediting');
}

export const dirs = {
  models: () => path.join(vibeHome(), 'models'),
  styles: () => path.join(vibeHome(), 'styles'),
  cache: () => path.join(vibeHome(), 'cache'),
  licenseFile: () => path.join(vibeHome(), 'license.json'),
};

let assetsCache: string | null = null;
/** Folder with our bundled assets (fonts). Works from src/ (tests) and dist/ (published). */
export function assetsDir(): string {
  if (assetsCache) return assetsCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/cli.js -> ../assets ; src/util/config.ts -> ../../assets
  const candidates = [path.resolve(here, '..', 'assets'), path.resolve(here, '..', '..', 'assets')];
  assetsCache = candidates.find((c) => existsSync(path.join(c, 'fonts'))) ?? candidates[0];
  return assetsCache;
}

export function fontsDir(): string {
  return path.join(assetsDir(), 'fonts');
}

/** Seconds a tool waits for a background job before handing back a job id. */
export function toolWaitSeconds(): number {
  const v = Number(process.env.VIBE_TOOL_WAIT_SECONDS);
  return Number.isFinite(v) && v >= 0 && process.env.VIBE_TOOL_WAIT_SECONDS !== undefined
    ? Math.min(v, MAX_WAIT_SECONDS)
    : 30;
}

/** Many MCP clients cancel a request after 60 seconds, so no tool waits longer than this. */
export const MAX_WAIT_SECONDS = 50;
