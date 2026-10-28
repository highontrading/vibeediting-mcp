import fs from 'node:fs';
import { UserError } from '../util/errors.js';
import { fixWordTimes, type Word } from './words.js';

export type CloudEngine = 'deepgram' | 'openai';

export function cloudKey(engine: CloudEngine): string | undefined {
  return engine === 'deepgram' ? process.env.DEEPGRAM_API_KEY?.trim() : process.env.OPENAI_API_KEY?.trim();
}

export interface CloudResult {
  words: Word[];
  language: string;
  text: string;
}

/** Deepgram Nova-3. language "multi" handles Hindi-English code switching. */
export async function transcribeDeepgram(
  audioFile: string,
  language: string,
  signal?: AbortSignal,
): Promise<CloudResult> {
  const key = cloudKey('deepgram');
  if (!key)
    throw new UserError(
      'DEEPGRAM_API_KEY is not set. Add it to the MCP settings to use Deepgram, or use the local engine.',
    );
  const lang = !language || language === 'auto' ? 'multi' : language;
  const url = `https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&filler_words=true&language=${encodeURIComponent(lang)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Token ${key}`, 'content-type': 'audio/flac' },
    body: fs.createReadStream(audioFile) as any,
    // @ts-expect-error Node fetch needs duplex for streaming bodies
    duplex: 'half',
    signal,
  });
  if (!res.ok)
    throw new UserError(
      `Deepgram returned an error (HTTP ${res.status}). Check your DEEPGRAM_API_KEY and account balance.`,
    );
  const j: any = await res.json();
  const ch = j?.results?.channels?.[0];
  const alt = ch?.alternatives?.[0];
  const words: Word[] = (alt?.words ?? []).map((w: any) => ({
    t: String(w.punctuated_word ?? w.word),
    s: Number(w.start),
    e: Number(w.end),
  }));
  return {
    words: fixWordTimes(words),
    language: ch?.detected_language ?? (lang === 'multi' ? 'multi' : lang),
    text: alt?.transcript ?? '',
  };
}

/** OpenAI whisper-1 (the only OpenAI model that returns word timestamps). Max 25 MB per request. */
export async function transcribeOpenAI(
  audioFile: string,
  language: string,
  offsetSec = 0,
  signal?: AbortSignal,
): Promise<CloudResult> {
  const key = cloudKey('openai');
  if (!key)
    throw new UserError(
      'OPENAI_API_KEY is not set. Add it to the MCP settings to use OpenAI, or use the local engine.',
    );
  const form = new FormData();
  form.append('file', await fs.openAsBlob(audioFile), 'audio.flac');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (language && language !== 'auto') form.append('language', language);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal,
  });
  if (!res.ok)
    throw new UserError(
      `OpenAI returned an error (HTTP ${res.status}). Check your OPENAI_API_KEY and billing.`,
    );
  const j: any = await res.json();
  const words: Word[] = (j.words ?? []).map((w: any) => ({
    t: String(w.word),
    s: Number(w.start) + offsetSec,
    e: Number(w.end) + offsetSec,
  }));
  return { words: fixWordTimes(words), language: languageCode(j.language) ?? language, text: j.text ?? '' };
}

const NAMES: Record<string, string> = {
  hindi: 'hi',
  english: 'en',
  urdu: 'ur',
  marathi: 'mr',
  bengali: 'bn',
  tamil: 'ta',
  telugu: 'te',
  gujarati: 'gu',
  punjabi: 'pa',
  kannada: 'kn',
  malayalam: 'ml',
};
function languageCode(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return NAMES[name.toLowerCase()] ?? name;
}
