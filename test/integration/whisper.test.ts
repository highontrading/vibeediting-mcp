import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeMedia } from '../../src/media/probe.js';
import { transcribeMedia } from '../../src/transcribe/transcript.js';
import { tmpDir } from '../helpers/fixtures.js';

// Downloads a 60 MB model and the JFK sample: opt in with VIBE_TEST_WHISPER=1.
describe.skipIf(process.env.VIBE_TEST_WHISPER !== '1')('local Whisper', () => {
  it('transcribes English with word timestamps', async () => {
    const dir = tmpDir('whisper-');
    process.env.VIBE_HOME = process.env.VIBE_TEST_MODELS_HOME ?? path.join(dir, '.home');
    const wav = path.join(dir, 'jfk.wav');
    const res = await fetch('https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav');
    fs.writeFileSync(wav, Buffer.from(await res.arrayBuffer()));
    const m = await probeMedia(wav);
    const { transcript } = await transcribeMedia(m, 'jfk.wav', {
      language: 'en',
      engine: 'local',
      model: 'base',
    });
    const text = transcript.words
      .map((w) => w.t)
      .join(' ')
      .toLowerCase();
    expect(text).toContain('what your country can do for you');
    const country = transcript.words.find((w) => /country/i.test(w.t))!;
    expect(country.s).toBeGreaterThan(4);
    expect(country.s).toBeLessThan(7);
    for (let i = 1; i < transcript.words.length; i++)
      expect(transcript.words[i].s).toBeGreaterThanOrEqual(transcript.words[i - 1].s);
  }, 600_000);
});
