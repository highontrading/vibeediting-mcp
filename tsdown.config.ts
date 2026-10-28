import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  dts: false,
  shims: false,
  fixedExtension: false,
  banner: { js: '#!/usr/bin/env node' },
  // Runtime dependencies stay external; npm installs them next to the package.
  deps: { neverBundle: [/^@modelcontextprotocol\//, 'zod', /^zod\//, 'playwright-core', /^@fugood\//] },
});
