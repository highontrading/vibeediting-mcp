import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeMedia } from '../../src/media/probe.js';
import { findBrowser, renderHtml } from '../../src/motion/browser.js';
import { hasFfmpeg, tmpDir } from '../helpers/fixtures.js';

describe('HTML motion graphics (needs Chrome/Edge/Chromium)', async () => {
  const browser = hasFfmpeg() ? await findBrowser() : null;
  it.skipIf(!browser)('renders a deterministic transparent animation', async () => {
    const dir = tmpDir('html-');
    const html = `<div id="b" style="width:100px;height:50px;background:#f00;animation:a 1s linear forwards"></div>
<style>@keyframes a{from{transform:translateX(0)}to{transform:translateX(200px)}}</style>
<script>window.seek=(t)=>{document.body.dataset.t=t}</script>`;
    const r = await renderHtml({
      html,
      width: 320,
      height: 120,
      fps: 10,
      duration: 1,
      outFile: path.join(dir, 'a.mov'),
    });
    expect(fs.existsSync(r.file)).toBe(true);
    const m = await probeMedia(r.file);
    expect(m.video?.width).toBe(320);
    expect(m.video?.pixFmt).toMatch(/rgba|argb|bgra/);
    expect(r.preview.subarray(1, 4).toString()).toBe('PNG');
    expect(r.warnings).toEqual([]);
  });
});
