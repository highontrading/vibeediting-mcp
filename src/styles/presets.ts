export type CaptionPosition = 'bottom' | 'lower' | 'middle' | 'top';
export type HighlightMode = 'color' | 'karaoke' | 'single' | 'none';

export interface StyleSpec {
  name: string;
  description: string;
  fonts: {
    /** Font full names as in the bundled files, e.g. "Poppins ExtraBold". */
    caption: string;
    title: string;
    body: string;
    /** Used for Devanagari text when the main font has no Devanagari letters. */
    devanagari: string;
  };
  colors: {
    text: string;
    highlight: string;
    outline: string;
    shadow: string;
    accent: string;
    /** caption/title box background, #RRGGBB or #RRGGBBAA */
    box: string;
  };
  caption: {
    /** font size as a fraction of the short side of the video */
    size: number;
    position: CaptionPosition;
    maxWordsPerLine: number;
    lines: 1 | 2;
    uppercase: boolean;
    punctuation: boolean;
    highlight: HighlightMode;
    pop: boolean;
    /** outline width as a fraction of the font size */
    outline: number;
    shadow: number;
    box: boolean;
  };
  title: {
    size: number;
    uppercase: boolean;
    animation: 'pop' | 'fade' | 'slide' | 'typewriter';
    background: 'none' | 'box' | 'full';
  };
  pacing: {
    /** "auto" = 18 dB under the speech loudness */
    silenceThresholdDb: number | 'auto';
    /** pauses shorter than this stay */
    minSilence: number;
    /** natural pause kept on each side of a cut */
    keepPause: number;
    /** seconds between automatic punch-in zooms (0 = off) */
    zoomEvery: number;
    zoomScale: number;
  };
  music: { volume: number; duck: boolean };
  /** fractions of the frame kept clear of platform buttons */
  safeMargins: {
    vertical: { top: number; bottom: number; side: number };
    horizontal: { top: number; bottom: number; side: number };
  };
}

const baseSafe = {
  vertical: { top: 0.12, bottom: 0.2, side: 0.07 },
  horizontal: { top: 0.07, bottom: 0.08, side: 0.06 },
};
const basePacing: StyleSpec['pacing'] = {
  silenceThresholdDb: 'auto',
  minSilence: 0.45,
  keepPause: 0.12,
  zoomEvery: 0,
  zoomScale: 1.12,
};

export const PRESETS: StyleSpec[] = [
  {
    name: 'bold-yellow-pop',
    description: 'Big bold white captions, current word in yellow with a pop. The classic Reels/Shorts look.',
    fonts: {
      caption: 'Poppins ExtraBold',
      title: 'Poppins Black',
      body: 'Poppins SemiBold',
      devanagari: 'Mukta ExtraBold',
    },
    colors: {
      text: '#FFFFFF',
      highlight: '#FFE600',
      outline: '#000000',
      shadow: '#000000',
      accent: '#FFE600',
      box: '#000000B3',
    },
    caption: {
      size: 0.08,
      position: 'lower',
      maxWordsPerLine: 3,
      lines: 1,
      uppercase: true,
      punctuation: false,
      highlight: 'color',
      pop: true,
      outline: 0.09,
      shadow: 0.04,
      box: false,
    },
    title: { size: 0.1, uppercase: true, animation: 'pop', background: 'none' },
    pacing: { ...basePacing, minSilence: 0.4, keepPause: 0.1, zoomEvery: 7 },
    music: { volume: 0.12, duck: true },
    safeMargins: baseSafe,
  },
  {
    name: 'hinglish-pop',
    description: 'Made for Hindi + English. Bold font with full Devanagari support, current word in orange.',
    fonts: {
      caption: 'Mukta ExtraBold',
      title: 'Mukta ExtraBold',
      body: 'Mukta Bold',
      devanagari: 'Mukta ExtraBold',
    },
    colors: {
      text: '#FFFFFF',
      highlight: '#FF9F1C',
      outline: '#000000',
      shadow: '#000000',
      accent: '#FF9F1C',
      box: '#000000B3',
    },
    caption: {
      size: 0.078,
      position: 'lower',
      maxWordsPerLine: 3,
      lines: 1,
      uppercase: false,
      punctuation: false,
      highlight: 'color',
      pop: true,
      outline: 0.09,
      shadow: 0.04,
      box: false,
    },
    title: { size: 0.1, uppercase: false, animation: 'pop', background: 'none' },
    pacing: { ...basePacing, minSilence: 0.4, keepPause: 0.1, zoomEvery: 7 },
    music: { volume: 0.12, duck: true },
    safeMargins: baseSafe,
  },
  {
    name: 'clean-minimal',
    description:
      'Calm white captions with a soft shadow, sentence case, two short lines. Good for brands and tutorials.',
    fonts: {
      caption: 'Poppins SemiBold',
      title: 'Poppins Bold',
      body: 'Poppins Medium',
      devanagari: 'Mukta Bold',
    },
    colors: {
      text: '#FFFFFF',
      highlight: '#FFFFFF',
      outline: '#000000',
      shadow: '#000000',
      accent: '#FFFFFF',
      box: '#00000099',
    },
    caption: {
      size: 0.052,
      position: 'bottom',
      maxWordsPerLine: 6,
      lines: 2,
      uppercase: false,
      punctuation: true,
      highlight: 'none',
      pop: false,
      outline: 0.04,
      shadow: 0.06,
      box: false,
    },
    title: { size: 0.075, uppercase: false, animation: 'fade', background: 'none' },
    pacing: basePacing,
    music: { volume: 0.1, duck: true },
    safeMargins: baseSafe,
  },
  {
    name: 'podcast',
    description: 'Captions on a dark box, current word in mint green. Easy to read over busy podcast shots.',
    fonts: {
      caption: 'Poppins Bold',
      title: 'Poppins ExtraBold',
      body: 'Poppins SemiBold',
      devanagari: 'Mukta Bold',
    },
    colors: {
      text: '#FFFFFF',
      highlight: '#7CFFB2',
      outline: '#000000',
      shadow: '#000000',
      accent: '#7CFFB2',
      box: '#000000C0',
    },
    caption: {
      size: 0.058,
      position: 'lower',
      maxWordsPerLine: 5,
      lines: 2,
      uppercase: false,
      punctuation: true,
      highlight: 'color',
      pop: false,
      outline: 0.0,
      shadow: 0,
      box: true,
    },
    title: { size: 0.08, uppercase: false, animation: 'slide', background: 'box' },
    pacing: { ...basePacing, minSilence: 0.6, keepPause: 0.15 },
    music: { volume: 0.08, duck: true },
    safeMargins: baseSafe,
  },
  {
    name: 'youtube-clean',
    description: 'For long YouTube videos: small, readable captions at the bottom, simple fade titles.',
    fonts: {
      caption: 'Poppins SemiBold',
      title: 'Poppins Bold',
      body: 'Poppins Medium',
      devanagari: 'Mukta Bold',
    },
    colors: {
      text: '#FFFFFF',
      highlight: '#FFFFFF',
      outline: '#000000',
      shadow: '#000000',
      accent: '#FF3B30',
      box: '#000000A0',
    },
    caption: {
      size: 0.05,
      position: 'bottom',
      maxWordsPerLine: 8,
      lines: 2,
      uppercase: false,
      punctuation: true,
      highlight: 'none',
      pop: false,
      outline: 0.06,
      shadow: 0.03,
      box: false,
    },
    title: { size: 0.07, uppercase: false, animation: 'fade', background: 'box' },
    pacing: { ...basePacing, minSilence: 0.7, keepPause: 0.18 },
    music: { volume: 0.07, duck: true },
    safeMargins: baseSafe,
  },
  {
    name: 'impact-red',
    description: 'Tall condensed ALL CAPS captions, current word in red. Punchy and loud.',
    fonts: {
      caption: 'Anton Regular',
      title: 'Anton Regular',
      body: 'Poppins SemiBold',
      devanagari: 'Mukta ExtraBold',
    },
    colors: {
      text: '#FFFFFF',
      highlight: '#FF3B30',
      outline: '#000000',
      shadow: '#000000',
      accent: '#FF3B30',
      box: '#000000B3',
    },
    caption: {
      size: 0.085,
      position: 'lower',
      maxWordsPerLine: 2,
      lines: 1,
      uppercase: true,
      punctuation: false,
      highlight: 'color',
      pop: true,
      outline: 0.07,
      shadow: 0.04,
      box: false,
    },
    title: { size: 0.12, uppercase: true, animation: 'pop', background: 'none' },
    pacing: { ...basePacing, minSilence: 0.35, keepPause: 0.08, zoomEvery: 6 },
    music: { volume: 0.12, duck: true },
    safeMargins: baseSafe,
  },
];

export const DEFAULT_STYLE = 'bold-yellow-pop';

/** Fonts we ship, by full name, with the file and whether it has Devanagari letters. */
export const FONTS: Record<string, { file: string; family: string; devanagari: boolean }> = {
  'Poppins Medium': { file: 'Poppins-Medium.ttf', family: 'Poppins', devanagari: true },
  'Poppins SemiBold': { file: 'Poppins-SemiBold.ttf', family: 'Poppins', devanagari: true },
  'Poppins Bold': { file: 'Poppins-Bold.ttf', family: 'Poppins', devanagari: true },
  'Poppins ExtraBold': { file: 'Poppins-ExtraBold.ttf', family: 'Poppins', devanagari: true },
  'Poppins Black': { file: 'Poppins-Black.ttf', family: 'Poppins', devanagari: true },
  'Mukta Bold': { file: 'Mukta-Bold.ttf', family: 'Mukta', devanagari: true },
  'Mukta ExtraBold': { file: 'Mukta-ExtraBold.ttf', family: 'Mukta', devanagari: true },
  'Noto Sans Devanagari Bold': {
    file: 'NotoSansDevanagari-Bold.ttf',
    family: 'Noto Sans Devanagari',
    devanagari: true,
  },
  'Anton Regular': { file: 'Anton-Regular.ttf', family: 'Anton', devanagari: false },
  'Bebas Neue Regular': { file: 'BebasNeue-Regular.ttf', family: 'Bebas Neue', devanagari: false },
};

export function fontHasDevanagari(name: string): boolean {
  return FONTS[name]?.devanagari ?? false;
}

export function findPreset(name: string): StyleSpec | undefined {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return PRESETS.find((p) => p.name === n);
}

export function cloneStyle(s: StyleSpec): StyleSpec {
  return JSON.parse(JSON.stringify(s)) as StyleSpec;
}
