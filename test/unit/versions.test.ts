import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

describe('release files agree', () => {
  it('uses the same version everywhere', () => {
    const v = json('package.json').version;
    expect(json('plugin/.claude-plugin/plugin.json').version).toBe(v);
    expect(json('plugin/.mcp.json').mcpServers.vibeediting.args).toContain(`@vibeediting/mcp@${v}`);
    const server = json('server.json');
    expect(server.version).toBe(v);
    expect(server.packages[0].version).toBe(v);
    expect(json('package.json').mcpName).toBe(server.name);
  });
  it('keeps the website contract names', () => {
    const pkg = json('package.json');
    expect(pkg.name).toBe('@vibeediting/mcp');
    expect(Object.keys(pkg.bin)).toHaveLength(1);
    const mcp = json('plugin/.mcp.json').mcpServers.vibeediting;
    expect(mcp.env.VIBE_LICENSE_KEY).toBe('${user_config.vibe_license_key}');
    const plugin = json('plugin/.claude-plugin/plugin.json');
    for (const k of Object.values(mcp.env) as string[]) {
      const key = /\$\{user_config\.(\w+)\}/.exec(k)?.[1];
      expect(plugin.userConfig[key!]).toBeDefined();
    }
  });
  it('every skill has valid frontmatter', () => {
    const dir = path.join(root, 'plugin/skills');
    for (const name of fs.readdirSync(dir)) {
      const md = fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8');
      const fm = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
      expect(fm).toContain(`name: ${name}`);
      const desc = /description: (.+)/.exec(fm)?.[1] ?? '';
      expect(desc.length).toBeGreaterThan(30);
      expect(desc.length).toBeLessThanOrEqual(1024);
      expect(name).toMatch(/^[a-z0-9-]{1,64}$/);
    }
  });
});
