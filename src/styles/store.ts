import fs from 'node:fs/promises';
import path from 'node:path';
import { dirs } from '../util/config.js';
import { UserError } from '../util/errors.js';
import { readJson, slugify, writeJson } from '../util/fsx.js';
import { cloneStyle, DEFAULT_STYLE, findPreset, FONTS, PRESETS, type StyleSpec } from './presets.js';

/** Deep-merge a partial style over a full one. Unknown keys are ignored. */
export function mergeStyle(base: StyleSpec, patch: any): StyleSpec {
  const out: any = cloneStyle(base);
  const walk = (target: any, src: any) => {
    if (!src || typeof src !== 'object') return;
    for (const [k, v] of Object.entries(src)) {
      if (!(k in target)) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object')
        walk(target[k], v);
      else if (v !== undefined && v !== null) target[k] = v;
    }
  };
  walk(out, patch);
  if (typeof patch?.name === 'string') out.name = patch.name;
  if (typeof patch?.description === 'string') out.description = patch.description;
  validateStyle(out);
  return out as StyleSpec;
}

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

export function validateStyle(s: StyleSpec): void {
  for (const [k, v] of Object.entries(s.colors)) {
    if (!HEX.test(v))
      throw new UserError(
        `Style colour "${k}" must look like #FFD400 (or #FFD400CC with transparency). Got "${v}".`,
      );
  }
  for (const [k, v] of Object.entries(s.fonts)) {
    if (!FONTS[v])
      throw new UserError(
        `Style font "${k}" = "${v}" is not available. Available fonts: ${Object.keys(FONTS).join(', ')}.`,
      );
  }
}

/** All styles: built-in presets, ~/.vibeediting/styles/*.json, and my-style.json in the working folder. */
export async function listStyles(
  projectRoot?: string | null,
): Promise<Array<{ style: StyleSpec; origin: string }>> {
  const out: Array<{ style: StyleSpec; origin: string }> = PRESETS.map((p) => ({
    style: cloneStyle(p),
    origin: 'built-in',
  }));
  try {
    for (const f of await fs.readdir(dirs.styles())) {
      if (!f.endsWith('.json') || f === 'default.json') continue;
      const raw = await readJson<any>(path.join(dirs.styles(), f));
      if (!raw) continue;
      try {
        out.push({ style: mergeStyle(findPreset(raw.extends ?? '') ?? PRESETS[0], raw), origin: 'saved' });
      } catch {
        /* skip broken style files */
      }
    }
  } catch {
    /* no saved styles */
  }
  if (projectRoot) {
    const raw = await readJson<any>(path.join(projectRoot, 'my-style.json'));
    if (raw) {
      try {
        out.push({
          style: mergeStyle(findPreset(raw.extends ?? '') ?? PRESETS[0], {
            ...raw,
            name: raw.name ?? 'my-style',
          }),
          origin: 'my-style.json',
        });
      } catch {
        /* reported by resolveStyle */
      }
    }
  }
  return out;
}

export async function resolveStyle(
  name: string | undefined,
  projectRoot?: string | null,
): Promise<StyleSpec> {
  const all = await listStyles(projectRoot);
  if (name) {
    const n = slugify(name).toLowerCase();
    const hit = all.find(
      (s) => s.style.name.toLowerCase() === n || s.style.name.toLowerCase() === name.toLowerCase(),
    );
    if (!hit)
      throw new UserError(
        `I do not know the style "${name}". Styles: ${all.map((s) => s.style.name).join(', ')}.`,
      );
    return cloneStyle(hit.style);
  }
  // Default order: my-style.json, then the user's saved default, then the built-in default.
  const mine = all.find((s) => s.origin === 'my-style.json');
  if (mine) return cloneStyle(mine.style);
  const def = await readJson<{ name: string }>(path.join(dirs.styles(), 'default.json'));
  if (def?.name) {
    const hit = all.find((s) => s.style.name === def.name);
    if (hit) return cloneStyle(hit.style);
  }
  return cloneStyle(findPreset(DEFAULT_STYLE)!);
}

export async function saveStyle(style: StyleSpec, opts: { asDefault?: boolean }): Promise<string> {
  const name = slugify(style.name, 'my-style').toLowerCase();
  if (PRESETS.some((p) => p.name === name))
    throw new UserError(`"${name}" is a built-in style name. Pick another name, like "my-${name}".`);
  const file = path.join(dirs.styles(), `${name}.json`);
  await writeJson(file, { ...style, name });
  if (opts.asDefault) await writeJson(path.join(dirs.styles(), 'default.json'), { name });
  return file;
}
