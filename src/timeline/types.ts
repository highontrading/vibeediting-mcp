import type { StyleSpec } from '../styles/presets.js';
import type { Word } from '../transcribe/words.js';

export type Aspect = '9:16' | '1:1' | '4:5' | '16:9' | 'original';
export type Fit = 'crop' | 'blur' | 'pad';

export interface Source {
  id: string;
  /** relative to the project folder, forward slashes */
  path: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

/** A piece of a source, in source seconds. The output is all clips played in order. */
export interface Clip {
  id: string;
  source: string;
  in: number;
  out: number;
}

export interface Format {
  aspect: Aspect;
  width: number;
  height: number;
  fps: number;
  fpsText: string;
  fit: Fit;
  /** 0 = left/top, 0.5 = center, 1 = right/bottom (for crop) */
  cropX: number;
  cropY: number;
}

export interface CaptionTrack {
  enabled: boolean;
  /** Words in source time, so captions follow every cut. */
  words: Array<Word & { src: string }>;
  language: string;
  /** Per-project overrides of the style's caption settings. */
  overrides: Partial<StyleSpec['caption']> & { highlightColor?: string; textColor?: string; font?: string };
}

export type Position =
  'top' | 'center' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right';

interface OverlayBase {
  id: string;
  /** output seconds */
  start: number;
  duration: number;
}

export interface TitleOverlay extends OverlayBase {
  type: 'title';
  text: string;
  subtitle?: string;
  position: 'center' | 'top' | 'bottom';
  animation?: 'pop' | 'fade' | 'slide' | 'typewriter';
  background?: 'none' | 'box' | 'full';
  color?: string;
}

export interface LowerThirdOverlay extends OverlayBase {
  type: 'lower_third';
  name: string;
  title?: string;
  side: 'left' | 'right';
}

export interface TextOverlay extends OverlayBase {
  type: 'text';
  text: string;
  position: Position;
  /** fraction of the short side */
  size?: number;
  color?: string;
  box?: boolean;
  animation?: 'pop' | 'fade' | 'slide' | 'none';
  font?: string;
}

export interface TemplateOverlay extends OverlayBase {
  type: 'template';
  template: 'counter' | 'bar_chart' | 'progress_bar' | 'checklist' | 'quote' | 'callout';
  params: Record<string, unknown>;
}

export interface VideoOverlay extends OverlayBase {
  /** A rendered motion graphic (with transparency) or a B-roll clip. */
  type: 'graphic' | 'broll';
  /** relative to project folder, or absolute inside ~/.vibeediting */
  path: string;
  /** seconds into the file to start from */
  trimStart: number;
  /** 'full' covers the frame; 'pip' is a small window */
  mode: 'full' | 'pip' | 'box';
  box?: { x: number; y: number; w: number; h: number };
  credit?: string;
}

export interface ZoomOverlay extends OverlayBase {
  type: 'zoom';
  scale: number;
  /** where to zoom: 0..1 */
  x: number;
  y: number;
}

export type Overlay =
  TitleOverlay | LowerThirdOverlay | TextOverlay | TemplateOverlay | VideoOverlay | ZoomOverlay;

export interface AudioSettings {
  normalize: boolean;
  /** LUFS */
  target: number;
  denoise: 'off' | 'light' | 'medium' | 'strong';
  music: null | {
    path: string;
    volume: number;
    duck: boolean;
    fadeIn: number;
    fadeOut: number;
    start: number;
  };
}

export interface Project {
  schema: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sources: Source[];
  clips: Clip[];
  format: Format;
  styleName: string;
  style: StyleSpec;
  captions: CaptionTrack | null;
  overlays: Overlay[];
  audio: AudioSettings;
  /** short notes on what was done, newest last (shown to the agent) */
  log: string[];
  nextId: number;
}
