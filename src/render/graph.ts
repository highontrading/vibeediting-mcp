import type { Loudness } from '../media/audio.js';
import { outputDuration } from '../timeline/ops.js';
import type { Clip, Fit, Project, Source, VideoOverlay, ZoomOverlay } from '../timeline/types.js';

export interface GraphInput {
  args: string[];
}

export interface BuildOptions {
  project: Project;
  sourcePath: (sourceId: string) => string;
  overlayPath: (o: VideoOverlay) => string;
  musicPath?: string | null;
  width: number;
  height: number;
  fpsText: string;
  /** ASS file name relative to ffmpeg's working folder, or null for no text layer */
  assFile: string | null;
  fontsDir: string;
  video: boolean;
  audio: boolean;
  /** 'measure' prints loudness JSON; an object applies two-pass normalisation */
  loudnorm?: 'measure' | Loudness | null;
  /** media type of overlay files, so images loop */
  isImage?: (path: string) => boolean;
}

export interface BuiltGraph {
  inputs: GraphInput[];
  filter: string;
  videoOut: string | null;
  audioOut: string | null;
  duration: number;
}

interface Group {
  source: Source;
  start: number;
  end: number;
  clips: Array<{ clip: Clip; index: number }>;
}

const n3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

/** Group consecutive clips of the same file that move forward, so each group is one decode pass. */
export function groupClips(clips: Clip[], sources: Source[], maxGap = 20): Group[] {
  const groups: Group[] = [];
  clips.forEach((clip, index) => {
    const source = sources.find((s) => s.id === clip.source);
    if (!source) throw new Error(`clip ${clip.id} refers to unknown source ${clip.source}`);
    const g = groups[groups.length - 1];
    if (g && g.source.id === source.id && clip.in >= g.end - 1e-6 && clip.in - g.end <= maxGap) {
      g.end = Math.max(g.end, clip.out);
      g.clips.push({ clip, index });
    } else {
      groups.push({ source, start: clip.in, end: clip.out, clips: [{ clip, index }] });
    }
  });
  return groups;
}

/** Scale/crop/pad one stream into W x H. Returns filter text that reads [inL] and writes [outL]. */
export function fitFilter(
  inL: string,
  outL: string,
  sw: number,
  sh: number,
  W: number,
  H: number,
  fit: Fit,
  cropX: number,
  cropY: number,
  tag: string,
): string {
  if (!sw || !sh)
    return `[${inL}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black[${outL}]`;
  const srcR = sw / sh;
  const dstR = W / H;
  if (Math.abs(srcR - dstR) < 0.01) return `[${inL}]scale=${W}:${H}:flags=lanczos[${outL}]`;
  if (fit === 'pad') {
    return `[${inL}]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black[${outL}]`;
  }
  if (fit === 'blur') {
    const bw = even(W / 8);
    const bh = even(H / 8);
    return [
      `[${inL}]split=2[${tag}bg][${tag}fg]`,
      `[${tag}bg]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=6:2,scale=${W}:${H}[${tag}bgb]`,
      `[${tag}fg]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[${tag}fgs]`,
      `[${tag}bgb][${tag}fgs]overlay=(W-w)/2:(H-h)/2[${outL}]`,
    ].join(';');
  }
  let cw: number;
  let ch: number;
  if (srcR > dstR) {
    ch = sh;
    cw = Math.min(sw, even(sh * dstR));
  } else {
    cw = sw;
    ch = Math.min(sh, even(sw / dstR));
  }
  const x = Math.round((sw - cw) * Math.max(0, Math.min(1, cropX)));
  const y = Math.round((sh - ch) * Math.max(0, Math.min(1, cropY)));
  return `[${inL}]crop=${cw}:${ch}:${x}:${y},scale=${W}:${H}:flags=lanczos[${outL}]`;
}

/** Smooth punch-in zoom envelope as an ffmpeg expression of time t (seconds). */
export function zoomExpr(zooms: ZoomOverlay[], tVar: string): { z: string; x: string; y: string } {
  const ease = 0.15;
  const terms = zooms.map((z) => {
    const s = n3(z.start);
    const e = n3(z.start + z.duration);
    return `${n3(z.scale - 1)}*clip((${tVar}-${s})/${ease},0,1)*clip((${e}-${tVar})/${ease},0,1)`;
  });
  const z = `1+${terms.join('+')}`;
  // Zoom centre: use the first zoom's point while any zoom is active.
  const fx = zooms.length ? n3(zooms[0].x) : '0.5';
  const fy = zooms.length ? n3(zooms[0].y) : '0.5';
  return { z, x: `(iw-iw/zoom)*${fx}`, y: `(ih-ih/zoom)*${fy}` };
}

export function buildGraph(o: BuildOptions): BuiltGraph {
  const p = o.project;
  const W = even(o.width);
  const H = even(o.height);
  const F = o.fpsText;
  const inputs: GraphInput[] = [];
  const parts: string[] = [];
  const groups = groupClips(p.clips, p.sources);
  const vLabels: string[] = new Array(p.clips.length);
  const aLabels: string[] = new Array(p.clips.length);

  groups.forEach((g, gi) => {
    const idx = inputs.length;
    const span = g.end - g.start;
    inputs.push({ args: ['-ss', n3(g.start), '-t', n3(span + 0.2), '-i', o.sourcePath(g.source.id)] });
    const k = g.clips.length;
    let vIns: string[] = [];
    let aIns: string[] = [];
    if (o.video && g.source.hasVideo) {
      if (k === 1) vIns = [`${idx}:v:0`];
      else {
        vIns = g.clips.map((_, j) => `g${gi}v${j}`);
        parts.push(`[${idx}:v:0]split=${k}${vIns.map((l) => `[${l}]`).join('')}`);
      }
    }
    if (o.audio && g.source.hasAudio) {
      if (k === 1) aIns = [`${idx}:a:0`];
      else {
        aIns = g.clips.map((_, j) => `g${gi}a${j}`);
        parts.push(`[${idx}:a:0]asplit=${k}${aIns.map((l) => `[${l}]`).join('')}`);
      }
    }
    g.clips.forEach(({ clip, index }, j) => {
      const a = n3(clip.in - g.start);
      const b = n3(clip.out - g.start);
      const len = n3(clip.out - clip.in);
      if (o.video) {
        const out = `v${index}`;
        if (g.source.hasVideo) {
          const pre = `c${index}t`;
          parts.push(`[${vIns[j]}]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[${pre}]`);
          const fitted = `c${index}f`;
          parts.push(
            fitFilter(
              pre,
              fitted,
              g.source.width,
              g.source.height,
              W,
              H,
              p.format.fit,
              p.format.cropX,
              p.format.cropY,
              `c${index}`,
            ),
          );
          parts.push(`[${fitted}]fps=${F},setsar=1,format=yuv420p[${out}]`);
        } else {
          parts.push(`color=c=black:s=${W}x${H}:r=${F}:d=${len},format=yuv420p[${out}]`);
        }
        vLabels[index] = out;
      }
      if (o.audio) {
        const out = `a${index}`;
        if (g.source.hasAudio) {
          parts.push(
            `[${aIns[j]}]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[${out}]`,
          );
        } else {
          parts.push(`aevalsrc=0|0:s=48000:d=${len},aformat=sample_fmts=fltp:channel_layouts=stereo[${out}]`);
        }
        aLabels[index] = out;
      }
    });
  });

  const n = p.clips.length;
  let v: string | null = null;
  let a: string | null = null;
  if (o.video && o.audio) {
    parts.push(
      `${p.clips.map((_, i) => `[${vLabels[i]}][${aLabels[i]}]`).join('')}concat=n=${n}:v=1:a=1[vcat][acat]`,
    );
    v = 'vcat';
    a = 'acat';
  } else if (o.video) {
    parts.push(`${p.clips.map((_, i) => `[${vLabels[i]}]`).join('')}concat=n=${n}:v=1:a=0[vcat]`);
    v = 'vcat';
  } else if (o.audio) {
    parts.push(`${p.clips.map((_, i) => `[${aLabels[i]}]`).join('')}concat=n=${n}:v=0:a=1[acat]`);
    a = 'acat';
  }
  const duration = outputDuration(p.clips);

  if (o.video && v) {
    // Punch-in zooms.
    const zooms = p.overlays.filter((x): x is ZoomOverlay => x.type === 'zoom');
    if (zooms.length) {
      const fpsNum = evalRate(F);
      const ze = zoomExpr(zooms, `(on/${n3(fpsNum)})`);
      parts.push(`[${v}]zoompan=z='${ze.z}':x='${ze.x}':y='${ze.y}':d=1:s=${W}x${H}:fps=${F},setsar=1[vz]`);
      v = 'vz';
    }
    // B-roll and rendered motion graphics.
    const vids = p.overlays
      .filter((x): x is VideoOverlay => x.type === 'broll' || x.type === 'graphic')
      .sort((x, y) => x.start - y.start);
    vids.forEach((ov, i) => {
      const idx = inputs.length;
      const file = o.overlayPath(ov);
      const image = o.isImage?.(file) ?? false;
      const d = Math.max(0.1, Math.min(ov.duration, duration - ov.start));
      if (image) inputs.push({ args: ['-loop', '1', '-framerate', F, '-t', n3(d), '-i', file] });
      else inputs.push({ args: ['-ss', n3(ov.trimStart || 0), '-t', n3(d), '-i', file] });
      const box = overlayBox(ov, W, H);
      const lbl = `ov${i}`;
      const fitted = `ov${i}f`;
      if (ov.type === 'graphic') {
        parts.push(`[${idx}:v:0]scale=${box.w}:${box.h},fps=${F},format=yuva420p[${fitted}]`);
      } else {
        parts.push(
          `[${idx}:v:0]scale=${box.w}:${box.h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${box.w}:${box.h}[${lbl}s]`,
        );
        const kb = image
          ? `,zoompan=z='1+0.06*on/${Math.max(1, Math.round(d * evalRate(F)))}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${box.w}x${box.h}:fps=${F}`
          : '';
        const fd = Math.min(0.2, d / 4);
        parts.push(
          `[${lbl}s]fps=${F}${kb},setsar=1,format=yuva420p,fade=t=in:st=0:d=${n3(fd)}:alpha=1,fade=t=out:st=${n3(d - fd)}:d=${n3(fd)}:alpha=1[${fitted}]`,
        );
      }
      parts.push(`[${fitted}]setpts=PTS-STARTPTS+${n3(ov.start)}/TB[${lbl}]`);
      const outL = `vo${i}`;
      parts.push(
        `[${v}][${lbl}]overlay=x=${box.x}:y=${box.y}:eof_action=pass:enable='between(t,${n3(ov.start)},${n3(ov.start + d)})'[${outL}]`,
      );
      v = outL;
    });
    // Captions, titles and text graphics (libass).
    if (o.assFile) {
      parts.push(`[${v}]ass=filename=${o.assFile}:fontsdir=${o.fontsDir}:shaping=complex[vass]`);
      v = 'vass';
    }
    parts.push(`[${v}]format=yuv420p[vout]`);
    v = 'vout';
  }

  if (o.audio && a) {
    const den = p.audio.denoise;
    if (den !== 'off') {
      const nr = den === 'light' ? 6 : den === 'medium' ? 12 : 20;
      parts.push(`[${a}]highpass=f=70,afftdn=nr=${nr}:nf=-35:tn=1[aden]`);
      a = 'aden';
    }
    const music = p.audio.music;
    if (music && o.musicPath) {
      const idx = inputs.length;
      inputs.push({ args: ['-stream_loop', '-1', '-i', o.musicPath] });
      const start = Math.max(0, Math.min(music.start ?? 0, duration - 0.5));
      const len = Math.max(0.5, duration - start);
      const fo = Math.min(music.fadeOut, len / 3);
      const fi = Math.min(music.fadeIn, len / 3);
      const delayMs = Math.round(start * 1000);
      parts.push(
        `[${idx}:a:0]atrim=0:${n3(len)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${n3(music.volume)},afade=t=in:st=0:d=${n3(fi)},afade=t=out:st=${n3(len - fo)}:d=${n3(fo)}${delayMs ? `,adelay=${delayMs}|${delayMs}` : ''}[mus]`,
      );
      if (music.duck) {
        parts.push(`[${a}]asplit=2[vo1][vokey]`);
        parts.push(
          `[mus][vokey]sidechaincompress=threshold=0.015:ratio=12:attack=20:release=450:makeup=1[musd]`,
        );
        parts.push(`[vo1][musd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amx]`);
      } else {
        parts.push(`[${a}][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amx]`);
      }
      a = 'amx';
    }
    if (o.loudnorm === 'measure') {
      parts.push(`[${a}]loudnorm=I=${p.audio.target}:TP=-1.5:LRA=11:print_format=json[aout]`);
    } else if (o.loudnorm && typeof o.loudnorm === 'object' && p.audio.normalize) {
      const m = o.loudnorm;
      parts.push(
        `[${a}]loudnorm=I=${p.audio.target}:TP=-1.5:LRA=11:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`,
      );
    } else if (p.audio.normalize && o.loudnorm === undefined) {
      // One-pass (preview): good enough to judge.
      parts.push(
        `[${a}]loudnorm=I=${p.audio.target}:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`,
      );
    } else {
      parts.push(`[${a}]anull[aout]`);
    }
    a = 'aout';
  }
  return { inputs, filter: parts.join(';\n'), videoOut: v, audioOut: a, duration };
}

export function overlayBox(
  ov: VideoOverlay,
  W: number,
  H: number,
): { x: number; y: number; w: number; h: number } {
  if (ov.mode === 'full') return { x: 0, y: 0, w: W, h: H };
  if (ov.mode === 'box' && ov.box) {
    const w = even(ov.box.w * W);
    const h = even(ov.box.h * H);
    return { x: Math.round(ov.box.x * W), y: Math.round(ov.box.y * H), w, h };
  }
  // Picture in picture: top right, 42% of the width.
  const w = even(W * 0.42);
  const h = even((w * 9) / 16);
  return { x: Math.round(W - w - W * 0.05), y: Math.round(H * 0.1), w, h };
}

export function evalRate(r: string): number {
  const [a, b] = r.split('/').map(Number);
  return b ? a / b : a;
}
