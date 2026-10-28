import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isInside, isUnsafeRoot, Workspace } from '../../src/util/workspace.js';
import { tmpDir } from '../helpers/fixtures.js';

describe('path safety', () => {
  let root: string;
  let outside: string;
  let ws: Workspace;
  beforeAll(() => {
    root = tmpDir('root-');
    outside = tmpDir('outside-');
    fs.mkdirSync(path.join(root, 'sub folder'), { recursive: true });
    fs.writeFileSync(path.join(root, 'sub folder', 'my clip.mp4'), 'x');
    fs.writeFileSync(path.join(outside, 'secret.mp4'), 'x');
    process.env.VIBE_HOME = path.join(outside, 'vibehome');
    fs.mkdirSync(process.env.VIBE_HOME, { recursive: true });
    ws = new Workspace({ dir: root, source: 'test' });
  });
  afterAll(() => {
    delete process.env.VIBE_HOME;
  });

  it('resolves relative paths with spaces inside the root', () => {
    const p = ws.resolve('sub folder/my clip.mp4', { mustExist: true });
    expect(p).toBe(path.join(fs.realpathSync(root), 'sub folder', 'my clip.mp4'));
    expect(ws.rel(p)).toBe('sub folder/my clip.mp4');
  });

  it('accepts absolute paths inside the root and quoted paths', () => {
    const abs = path.join(root, 'sub folder', 'my clip.mp4');
    expect(ws.resolve(`"${abs}"`)).toBe(fs.realpathSync(abs));
  });

  it('rejects paths outside the root', () => {
    expect(() => ws.resolve(path.join(outside, 'secret.mp4'))).toThrow(
      /only work inside your working folder/,
    );
    expect(() => ws.resolve('../' + path.basename(outside) + '/secret.mp4')).toThrow(/only work inside/);
  });

  it('rejects symlinks that point outside', () => {
    const link = path.join(root, 'link.mp4');
    try {
      fs.symlinkSync(path.join(outside, 'secret.mp4'), link);
    } catch {
      return; // symlinks need admin rights on some Windows setups
    }
    expect(() => ws.resolve('link.mp4')).toThrow(/only work inside/);
  });

  it('allows our own ~/.vibeediting folder', () => {
    const p = path.join(process.env.VIBE_HOME!, 'cache', 'x.mov');
    expect(() => ws.resolve(p)).not.toThrow();
  });

  it('reports missing files clearly', () => {
    expect(() => ws.resolve('nope.mp4', { mustExist: true })).toThrow(/cannot find/);
  });

  it('refuses unsafe working folders', () => {
    expect(isUnsafeRoot(os.homedir())).toBe(true);
    expect(isUnsafeRoot(path.parse(process.cwd()).root)).toBe(true);
    expect(isUnsafeRoot(root)).toBe(false);
    expect(() => new Workspace({ dir: os.homedir(), source: 't' })).toThrow(/too broad/);
    const empty = new Workspace(null);
    expect(() => empty.requireRoot()).toThrow(/set_working_folder/);
  });

  it('isInside handles prefixes correctly', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(isInside('/a/b', '/a/b')).toBe(true);
  });
});
