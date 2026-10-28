import { type AudioAnalysis, analyzeAudio } from '../media/audio.js';
import { contactSheet, evenlySpaced } from '../media/frames.js';
import type { MediaInfo } from '../media/probe.js';
import type { Transcript } from '../transcribe/transcript.js';
import { fmtDuration, fmtTime } from '../util/time.js';
import { detectScenes } from './scenes.js';

export interface AnalyzeResult {
  text: string;
  images: Buffer[];
  audio: AudioAnalysis;
  scenes: number[];
}

export async function analyzeVideo(
  m: MediaInfo,
  rel: string,
  transcript: Transcript | null,
  opts: { frames?: number; signal?: AbortSignal; onProgress?: (f: number, msg: string) => void } = {},
): Promise<AnalyzeResult> {
  const progress = opts.onProgress ?? (() => undefined);
  const D = m.duration;
  const lines: string[] = [];
  const suggestions: string[] = [];

  progress(0.02, 'Checking audio: silences and loudness');
  const audio = m.audio
    ? await analyzeAudio(m.path, D, {
        minSilence: 0.5,
        signal: opts.signal,
        onProgress: (f) => progress(0.02 + f * 0.3, 'Checking audio'),
      })
    : { silences: [], loudness: null, thresholdDb: -40 };
  progress(0.35, 'Finding scene changes');
  const scenes = m.video
    ? await detectScenes(m.path, D, {
        signal: opts.signal,
        onProgress: (f) => progress(0.35 + f * 0.4, 'Finding scene changes'),
      })
    : [];

  lines.push(
    `Analysis of ${rel} (${fmtDuration(D)}${m.video ? `, ${m.video.width}x${m.video.height}` : ''})`,
  );

  // Hook: the first 3 seconds decide if people keep watching.
  const speechStart = transcript?.words[0]?.s ?? firstSound(audio, D);
  const hookWords = transcript
    ? transcript.words
        .filter((w) => w.s < 3)
        .map((w) => w.t)
        .join(' ')
    : '';
  lines.push('', 'HOOK (first 3 seconds)');
  lines.push(`- Speech starts at ${fmtTime(speechStart)}.`);
  if (speechStart > 0.6)
    suggestions.push(
      `Cut the first ${speechStart.toFixed(1)} s: the video starts with ${speechStart.toFixed(1)} s of silence before you speak (use trim with start=${Math.max(0, speechStart - 0.15).toFixed(2)}).`,
    );
  if (hookWords) {
    lines.push(`- First words: "${hookWords}"`);
    if (!/\?|\d|how|why|kaise|kyun|kya|secret|mistake|stop/i.test(hookWords))
      suggestions.push(
        'The opening line is not a strong hook. Consider starting with a question, a number or a bold claim, or add a title card with the promise of the video.',
      );
  } else if (!transcript && m.audio) lines.push('- (Run transcribe to check the opening words.)');
  const earlyCuts = scenes.filter((t) => t < 3).length;
  lines.push(`- Visual changes in the first 3 s: ${earlyCuts}.`);
  if (earlyCuts === 0 && D < 120)
    suggestions.push(
      'Nothing changes on screen in the first 3 s. Add a title card or a punch-in zoom at 0-2 s to grab attention.',
    );

  // Pacing.
  lines.push('', 'PACING');
  const silentTotal = audio.silences.reduce((a, s) => a + (s.end - s.start), 0);
  lines.push(
    `- Silence/pauses (≥0.5 s): ${audio.silences.length}, total ${fmtDuration(silentTotal)} (${Math.round((silentTotal / Math.max(1, D)) * 100)}% of the video).`,
  );
  if (silentTotal / Math.max(1, D) > 0.08)
    suggestions.push(`Run cut_silences: about ${fmtDuration(silentTotal)} of pauses can be tightened.`);
  if (transcript && transcript.words.length > 5) {
    const speaking = Math.max(1, D - silentTotal);
    const wpm = Math.round((transcript.words.length / speaking) * 60);
    lines.push(`- Speaking speed: about ${wpm} words per minute.`);
  }
  const shotLen = D / (scenes.length + 1);
  lines.push(`- Scene changes: ${scenes.length} (average shot ${shotLen.toFixed(1)} s).`);
  const slow = slowParts(scenes, D, D < 120 ? 8 : 20);
  if (slow.length) {
    lines.push(
      `- Long stretches with no visual change: ${slow.map((s) => `${fmtTime(s.start, 0)}-${fmtTime(s.end, 0)}`).join(', ')}.`,
    );
    suggestions.push(
      `Add a zoom, text or B-roll in the slow parts: ${slow
        .slice(0, 3)
        .map((s) => `${fmtTime(s.start, 0)}-${fmtTime(s.end, 0)}`)
        .join(', ')}.`,
    );
  }

  // Loudness.
  lines.push('', 'AUDIO');
  if (audio.loudness) {
    lines.push(
      `- Loudness ${audio.loudness.i.toFixed(1)} LUFS (platforms like about -14), peak ${audio.loudness.tp.toFixed(1)} dBTP, range ${audio.loudness.lra.toFixed(1)} LU.`,
    );
    if (Math.abs(audio.loudness.i + 14) > 2)
      suggestions.push(
        `Loudness is ${audio.loudness.i.toFixed(1)} LUFS. normalize_audio (on by default) will bring it to -14 LUFS at export.`,
      );
    if (audio.loudness.lra > 12)
      suggestions.push(
        'Volume changes a lot during the video. Normalizing will help; also consider denoise_audio if there is background noise.',
      );
  } else lines.push('- No audio track.');

  if (!transcript && m.audio)
    suggestions.push(
      'Run transcribe to unlock captions, filler removal, retake detection and hook text checks.',
    );

  lines.push('', 'SUGGESTIONS');
  lines.push(
    ...(suggestions.length
      ? suggestions.map((s, i) => `${i + 1}. ${s}`)
      : ['Looks good. No obvious problems found.']),
  );

  progress(0.8, 'Making contact sheets');
  const images: Buffer[] = [];
  if (m.video) {
    const n = Math.max(4, Math.min(16, opts.frames ?? 12));
    const sheet = await contactSheet(m.path, evenlySpaced(D, n), {
      cols: 4,
      thumbWidth: m.video.height > m.video.width ? 180 : 256,
      signal: opts.signal,
    });
    images.push(sheet.jpeg);
    if (D > 4) {
      const hook = await contactSheet(m.path, [0.05, 0.8, 1.6, 2.6], {
        cols: 4,
        thumbWidth: m.video.height > m.video.width ? 160 : 220,
        signal: opts.signal,
      });
      images.push(hook.jpeg);
    }
    lines.push(
      '',
      `Images: overview of ${n} frames${images.length > 1 ? ', then the first 3 seconds' : ''}.`,
    );
  }
  progress(1, 'Done');
  return { text: lines.join('\n'), images, audio, scenes };
}

function firstSound(a: AudioAnalysis, D: number): number {
  const first = a.silences[0];
  if (first && first.start <= 0.05) return Math.min(D, first.end);
  return 0;
}

function slowParts(scenes: number[], D: number, minLen: number): Array<{ start: number; end: number }> {
  const cuts = [0, ...scenes, D];
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 1; i < cuts.length; i++)
    if (cuts[i] - cuts[i - 1] >= minLen) out.push({ start: cuts[i - 1], end: cuts[i] });
  return out.sort((a, b) => b.end - b.start - (a.end - a.start));
}
