import {
  type AssEvent,
  type AssStyle,
  assAlphaTag,
  assColor,
  assColorTag,
  assEscape,
  DEVANAGARI,
} from '../captions/ass.js';
import { fontHasDevanagari, type StyleSpec } from '../styles/presets.js';
import type {
  LowerThirdOverlay,
  Overlay,
  Position,
  TemplateOverlay,
  TextOverlay,
  TitleOverlay,
} from '../timeline/types.js';

interface Ctx {
  W: number;
  H: number;
  short: number;
  style: StyleSpec;
  vertical: boolean;
  safe: { top: number; bottom: number; side: number };
}

const r = Math.round;

/** Styles for graphics: plain text (outline) and boxed text. Everything else is set inline. */
export function graphicStyles(W: number, H: number, style: StyleSpec): AssStyle[] {
  const base = {
    font: style.fonts.title,
    size: Math.min(W, H) * 0.06,
    primary: assColor(style.colors.text),
    outlineColor: assColor(style.colors.outline),
    back: assColor(style.colors.shadow, 110),
    alignment: 5,
    marginL: W * 0.06,
    marginR: W * 0.06,
    marginV: 0,
  };
  return [
    { ...base, name: 'Gfx', borderStyle: 1, outline: Math.min(W, H) * 0.004, shadow: Math.min(W, H) * 0.003 },
    {
      ...base,
      name: 'GfxBox',
      borderStyle: 3,
      outlineColor: assColor(style.colors.box),
      back: assColor('#00000000'),
      outline: Math.min(W, H) * 0.014,
      shadow: 0,
    },
    { ...base, name: 'Shape', borderStyle: 1, outline: 0, shadow: 0, alignment: 7, marginL: 0, marginR: 0 },
  ];
}

function fontFor(ctx: Ctx, wanted: string, text: string): string {
  return DEVANAGARI.test(text) && !fontHasDevanagari(wanted) ? ctx.style.fonts.devanagari : wanted;
}

function anchor(pos: Position, ctx: Ctx): { an: number; x: number; y: number } {
  const { W, H, safe } = ctx;
  const left = W * safe.side;
  const right = W * (1 - safe.side);
  const top = H * (safe.top + 0.02);
  const bottom = H * (1 - safe.bottom - 0.02);
  switch (pos) {
    case 'top':
      return { an: 8, x: W / 2, y: top };
    case 'bottom':
      return { an: 2, x: W / 2, y: bottom };
    case 'top-left':
      return { an: 7, x: left, y: top };
    case 'top-right':
      return { an: 9, x: right, y: top };
    case 'bottom-left':
      return { an: 1, x: left, y: bottom };
    case 'bottom-right':
      return { an: 3, x: right, y: bottom };
    case 'left':
      return { an: 4, x: left, y: H / 2 };
    case 'right':
      return { an: 6, x: right, y: H / 2 };
    default:
      return { an: 5, x: W / 2, y: H * 0.45 };
  }
}

function animTags(anim: string | undefined, x: number, y: number, ctx: Ctx, durMs: number): string {
  const out = Math.min(250, durMs / 4);
  switch (anim) {
    case 'pop':
      return `\\pos(${r(x)},${r(y)})\\fscx20\\fscy20\\alpha&HFF&\\t(0,170,\\fscx110\\fscy110\\alpha&H00&)\\t(170,260,\\fscx100\\fscy100)\\fad(0,${r(out)})`;
    case 'slide':
      return `\\move(${r(x - ctx.W * 0.12)},${r(y)},${r(x)},${r(y)},0,320)\\fad(160,${r(out)})`;
    case 'none':
      return `\\pos(${r(x)},${r(y)})`;
    default:
      return `\\pos(${r(x)},${r(y)})\\fad(250,${r(out)})`;
  }
}

function rect(w: number, h: number): string {
  return `m 0 0 l ${r(w)} 0 ${r(w)} ${r(h)} 0 ${r(h)}`;
}

function titleEvents(o: TitleOverlay, ctx: Ctx): AssEvent[] {
  const { W, H, short, style } = ctx;
  const events: AssEvent[] = [];
  const end = o.start + o.duration;
  const anim = o.animation ?? style.title.animation;
  const bg = o.background ?? style.title.background;
  const size = style.title.size * short * (ctx.vertical ? 1 : 0.8);
  const y = o.position === 'top' ? H * (ctx.safe.top + 0.1) : o.position === 'bottom' ? H * 0.7 : H * 0.42;
  const x = W / 2;
  const text = style.title.uppercase ? o.text.toLocaleUpperCase('en') : o.text;
  const color = o.color ?? style.colors.text;
  const font = fontFor(ctx, style.fonts.title, text);
  const durMs = o.duration * 1000;
  if (bg === 'full') {
    events.push({
      layer: 0,
      start: o.start,
      end,
      style: 'Shape',
      text: `{\\an7\\pos(0,0)\\c${assColorTag(style.colors.accent)}\\alpha&H20&\\fad(200,250)\\p1}${rect(W, H)}`,
    });
  }
  let body: string;
  if (anim === 'typewriter') {
    // Reveal word by word (per-letter tags would break Hindi letter shaping).
    const words = text.split(/\s+/);
    const step = Math.min(220, (durMs * 0.5) / Math.max(1, words.length));
    body = words
      .map((w, i) => `{\\alpha&HFF&\\t(${r(i * step)},${r(i * step + 60)},\\alpha&H00&)}${assEscape(w)}`)
      .join(' ');
    events.push({
      layer: 2,
      start: o.start,
      end,
      style: bg === 'box' ? 'GfxBox' : 'Gfx',
      text: `{\\an5\\pos(${r(x)},${r(y)})\\fn${font}\\fs${r(size)}\\c${assColorTag(color)}\\fad(0,200)}${body}`,
    });
  } else {
    body = assEscape(text);
    events.push({
      layer: 2,
      start: o.start,
      end,
      style: bg === 'box' ? 'GfxBox' : 'Gfx',
      text: `{\\an5${animTags(anim, x, y, ctx, durMs)}\\fn${font}\\fs${r(size)}\\c${assColorTag(color)}\\bord${r(size * (bg === 'box' ? 0.25 : 0.07))}\\shad${r(size * 0.04)}}${body}`,
    });
  }
  if (o.subtitle) {
    const sub = o.subtitle;
    const sfont = fontFor(ctx, style.fonts.body, sub);
    const ssize = size * 0.5;
    const sy = y + size * 0.85 + ssize * 0.6;
    events.push({
      layer: 2,
      start: o.start + 0.25,
      end,
      style: 'Gfx',
      text: `{\\an5\\pos(${r(x)},${r(sy)})\\fn${sfont}\\fs${r(ssize)}\\c${assColorTag(style.colors.accent)}\\bord${r(ssize * 0.08)}\\fad(250,200)}${assEscape(sub)}`,
    });
  }
  return events;
}

function lowerThirdEvents(o: LowerThirdOverlay, ctx: Ctx): AssEvent[] {
  const { W, H, short, style } = ctx;
  const end = o.start + o.duration;
  const nameSize = short * 0.06;
  const titleSize = short * 0.042;
  const blockH = nameSize * 1.15 + (o.title ? titleSize * 1.3 : 0);
  const yTop = H * (1 - ctx.safe.bottom) - blockH - H * 0.04;
  const barW = Math.max(6, short * 0.012);
  const left = o.side !== 'right';
  const xEdge = left ? W * ctx.safe.side : W * (1 - ctx.safe.side);
  const textX = left ? xEdge + barW * 2.4 : xEdge - barW * 2.4;
  const an = left ? 7 : 9;
  const clipFrom = left ? `\\clip(${r(textX)},0,${r(textX)},${H})` : `\\clip(${r(textX)},0,${r(textX)},${H})`;
  const clipTo = left ? `\\clip(${r(textX)},0,${W},${H})` : `\\clip(0,0,${r(textX)},${H})`;
  const nameFont = fontFor(ctx, style.fonts.title, o.name);
  const events: AssEvent[] = [
    {
      layer: 1,
      start: o.start,
      end,
      style: 'Shape',
      text: `{\\an7\\pos(${r(left ? xEdge : xEdge - barW)},${r(yTop)})\\c${assColorTag(style.colors.accent)}\\fscy0\\t(0,200,\\fscy100)\\fad(0,250)\\p1}${rect(barW, blockH)}`,
    },
    {
      layer: 2,
      start: o.start + 0.1,
      end,
      style: 'Gfx',
      text: `{\\an${an}\\pos(${r(textX)},${r(yTop - nameSize * 0.08)})\\fn${nameFont}\\fs${r(nameSize)}\\c${assColorTag(style.colors.text)}\\bord${r(nameSize * 0.06)}\\shad${r(nameSize * 0.05)}${clipFrom}\\t(0,380,${clipTo})\\fad(0,250)}${assEscape(o.name)}`,
    },
  ];
  if (o.title) {
    const tFont = fontFor(ctx, style.fonts.body, o.title);
    events.push({
      layer: 2,
      start: o.start + 0.25,
      end,
      style: 'Gfx',
      text: `{\\an${an}\\pos(${r(textX)},${r(yTop + nameSize * 1.12)})\\fn${tFont}\\fs${r(titleSize)}\\c${assColorTag(style.colors.accent)}\\bord${r(titleSize * 0.07)}\\shad${r(titleSize * 0.05)}${clipFrom}\\t(0,380,${clipTo})\\fad(0,250)}${assEscape(o.title)}`,
    });
  }
  return events;
}

function textEvents(o: TextOverlay, ctx: Ctx): AssEvent[] {
  const { short, style } = ctx;
  const a = anchor(o.position, ctx);
  const size = (o.size ?? 0.06) * short;
  const font = fontFor(ctx, o.font ?? style.fonts.body, o.text);
  const color = o.color ?? style.colors.text;
  const tags = animTags(o.animation ?? 'fade', a.x, a.y, ctx, o.duration * 1000);
  return [
    {
      layer: 3,
      start: o.start,
      end: o.start + o.duration,
      style: o.box ? 'GfxBox' : 'Gfx',
      text: `{\\an${a.an}${tags}\\fn${font}\\fs${r(size)}\\c${assColorTag(color)}\\bord${r(size * (o.box ? 0.25 : 0.07))}\\shad${r(size * 0.04)}}${assEscape(o.text)}`,
    },
  ];
}

function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function str(v: unknown, d = ''): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? d : String(v);
}

function formatNumber(v: number, decimals: number): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function templateEvents(o: TemplateOverlay, ctx: Ctx): AssEvent[] {
  const { W, H, short, style } = ctx;
  const p = o.params ?? {};
  const end = o.start + o.duration;
  const accent = str(p.color, style.colors.accent);
  const events: AssEvent[] = [];
  const fontT = style.fonts.title;
  const fontB = style.fonts.body;
  switch (o.template) {
    case 'counter': {
      const from = num(p.from, 0);
      const to = num(p.to, 100);
      const decimals = Math.max(0, Math.min(3, num(p.decimals, 0)));
      const prefix = str(p.prefix);
      const suffix = str(p.suffix);
      const pos = anchor((str(p.position, 'center') as Position) || 'center', ctx);
      const size = num(p.size, 0.14) * short;
      const countDur = Math.min(o.duration * 0.7, num(p.count_seconds, 1.6));
      const steps = Math.max(2, Math.min(60, Math.round(countDur * 20)));
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const ease = 1 - Math.pow(1 - f, 3);
        const v = from + (to - from) * ease;
        const s = o.start + countDur * f;
        const e = i === steps ? end : o.start + countDur * ((i + 1) / steps);
        const fade = i === steps ? `\\fad(0,250)` : '';
        events.push({
          layer: 3,
          start: s,
          end: e,
          style: 'Gfx',
          text: `{\\an${pos.an}\\pos(${r(pos.x)},${r(pos.y)})\\fn${fontT}\\fs${r(size)}\\c${assColorTag(accent)}\\bord${r(size * 0.06)}\\shad${r(size * 0.03)}${fade}}${assEscape(prefix + formatNumber(v, decimals) + suffix)}`,
        });
      }
      if (p.label) {
        const ls = size * 0.32;
        const label = str(p.label);
        events.push({
          layer: 3,
          start: o.start + 0.15,
          end,
          style: 'Gfx',
          text: `{\\an8\\pos(${r(pos.x)},${r(pos.y + size * (pos.an <= 3 ? 0.1 : 0.6))})\\fn${fontFor(ctx, fontB, label)}\\fs${r(ls)}\\c${assColorTag(style.colors.text)}\\bord${r(ls * 0.08)}\\fad(250,250)}${assEscape(label)}`,
        });
      }
      break;
    }
    case 'bar_chart': {
      const bars = (Array.isArray(p.bars) ? p.bars : [])
        .slice(0, 8)
        .map((b: any) => ({ label: str(b?.label), value: num(b?.value, 0) }));
      if (bars.length === 0) break;
      const max = num(p.max, Math.max(...bars.map((b) => b.value), 1));
      const areaW = W * (1 - ctx.safe.side * 2 - 0.06);
      const areaH = H * (ctx.vertical ? 0.3 : 0.45);
      const x0 = (W - areaW) / 2;
      const base = H * (ctx.vertical ? 0.62 : 0.78);
      const slot = areaW / bars.length;
      const bw = slot * 0.62;
      const ls = Math.min(short * 0.045, slot * 0.24);
      if (p.title) {
        const t = str(p.title);
        const ts = short * 0.055;
        events.push({
          layer: 3,
          start: o.start,
          end,
          style: 'Gfx',
          text: `{\\an2\\pos(${r(W / 2)},${r(base - areaH - ts * 0.9)})\\fn${fontFor(ctx, fontT, t)}\\fs${r(ts)}\\c${assColorTag(style.colors.text)}\\bord${r(ts * 0.07)}\\fad(250,250)}${assEscape(t)}`,
        });
      }
      bars.forEach((b, i) => {
        const cx = x0 + slot * i + slot / 2;
        const bh = Math.max(4, (b.value / max) * areaH);
        const delay = r(150 + i * 120);
        events.push({
          layer: 2,
          start: o.start,
          end,
          style: 'Shape',
          text: `{\\an2\\pos(${r(cx)},${r(base)})\\c${assColorTag(accent)}\\fscy0\\t(${delay},${delay + 550},0.6,\\fscy100)\\fad(0,250)\\p1}${rect(bw, bh)}`,
        });
        const vs = ls * 1.15;
        events.push({
          layer: 3,
          start: o.start + (delay + 450) / 1000,
          end,
          style: 'Gfx',
          text: `{\\an2\\pos(${r(cx)},${r(base - bh - vs * 0.3)})\\fn${fontT}\\fs${r(vs)}\\c${assColorTag(style.colors.text)}\\bord${r(vs * 0.08)}\\fad(200,250)}${assEscape(str(p.prefix) + formatNumber(b.value, num(p.decimals, 0)) + str(p.suffix))}`,
        });
        events.push({
          layer: 3,
          start: o.start + 0.1,
          end,
          style: 'Gfx',
          text: `{\\an8\\pos(${r(cx)},${r(base + ls * 0.4)})\\fn${fontFor(ctx, fontB, b.label)}\\fs${r(ls)}\\c${assColorTag(style.colors.text)}\\bord${r(ls * 0.08)}\\fad(250,250)}${assEscape(b.label)}`,
        });
      });
      break;
    }
    case 'progress_bar': {
      const pct = Math.max(0, Math.min(100, num(p.percent, 75)));
      const w = W * (1 - ctx.safe.side * 2 - 0.1);
      const h = Math.max(10, short * 0.035);
      const x = (W - w) / 2;
      const y = H * (ctx.vertical ? 0.55 : 0.6);
      const fillW = (w * pct) / 100;
      events.push({
        layer: 1,
        start: o.start,
        end,
        style: 'Shape',
        text: `{\\an7\\pos(${r(x)},${r(y)})\\c&HFFFFFF&\\alpha&HB0&\\fad(200,250)\\p1}${rect(w, h)}`,
      });
      events.push({
        layer: 2,
        start: o.start,
        end,
        style: 'Shape',
        text: `{\\an7\\pos(${r(x)},${r(y)})\\c${assColorTag(accent)}\\clip(${r(x)},0,${r(x)},${H})\\t(200,1300,0.5,\\clip(${r(x)},0,${r(x + fillW)},${H}))\\fad(0,250)\\p1}${rect(w, h)}`,
      });
      const label = str(p.label);
      const ls = short * 0.045;
      events.push({
        layer: 3,
        start: o.start,
        end,
        style: 'Gfx',
        text: `{\\an1\\pos(${r(x)},${r(y - h * 0.4)})\\fn${fontFor(ctx, fontT, label)}\\fs${r(ls)}\\c${assColorTag(style.colors.text)}\\bord${r(ls * 0.07)}\\fad(250,250)}${assEscape(label)}`,
      });
      events.push({
        layer: 3,
        start: o.start + 1.2,
        end,
        style: 'Gfx',
        text: `{\\an3\\pos(${r(x + w)},${r(y - h * 0.4)})\\fn${fontT}\\fs${r(ls)}\\c${assColorTag(accent)}\\bord${r(ls * 0.07)}\\fad(200,250)}${pct}%`,
      });
      break;
    }
    case 'checklist': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 8).map((i: unknown) => str(i));
      if (items.length === 0) break;
      const fs = short * num(p.size, 0.05);
      const gap = fs * 1.7;
      const x = W * (ctx.safe.side + 0.05);
      let y = H * 0.5 - ((items.length - 1) * gap) / 2;
      if (p.title) {
        const t = str(p.title);
        const ts = fs * 1.25;
        events.push({
          layer: 3,
          start: o.start,
          end,
          style: 'Gfx',
          text: `{\\an1\\pos(${r(x)},${r(y - gap * 0.8)})\\fn${fontFor(ctx, fontT, t)}\\fs${r(ts)}\\c${assColorTag(accent)}\\bord${r(ts * 0.07)}\\fad(250,250)}${assEscape(t)}`,
        });
      }
      const interval = Math.min(0.8, (o.duration * 0.6) / items.length);
      items.forEach((item, i) => {
        const s = o.start + 0.2 + i * interval;
        const ck = fs * 0.9;
        const scale = r((ck / 100) * 100);
        events.push({
          layer: 3,
          start: s,
          end,
          style: 'Shape',
          text: `{\\an4\\pos(${r(x)},${r(y)})\\c${assColorTag(accent)}\\fscx${scale}\\fscy${scale}\\fad(150,250)\\p1}m 0 55 l 14 40 36 60 86 8 100 22 36 88`,
        });
        events.push({
          layer: 3,
          start: s,
          end,
          style: 'Gfx',
          text: `{\\an4\\pos(${r(x + ck * 1.4)},${r(y)})\\fn${fontFor(ctx, fontB, item)}\\fs${r(fs)}\\c${assColorTag(style.colors.text)}\\bord${r(fs * 0.07)}\\shad${r(fs * 0.04)}\\fad(200,250)}${assEscape(item)}`,
        });
        y += gap;
      });
      break;
    }
    case 'quote': {
      const text = str(p.text);
      const fs = short * num(p.size, 0.065);
      const x = W / 2;
      const y = H * 0.45;
      events.push({
        layer: 3,
        start: o.start,
        end,
        style: 'Gfx',
        text: `{\\an5\\pos(${r(x)},${r(y)})\\fn${fontFor(ctx, fontT, text)}\\fs${r(fs)}\\c${assColorTag(style.colors.text)}\\bord${r(fs * 0.07)}\\shad${r(fs * 0.04)}\\fad(350,300)}${assEscape(`“${text}”`)}`,
      });
      if (p.author) {
        const a = `— ${str(p.author)}`;
        const as = fs * 0.5;
        events.push({
          layer: 3,
          start: o.start + 0.5,
          end,
          style: 'Gfx',
          text: `{\\an8\\pos(${r(x)},${r(y + fs * 1.6)})\\fn${fontFor(ctx, fontB, a)}\\fs${r(as)}\\c${assColorTag(style.colors.accent)}\\bord${r(as * 0.08)}\\fad(300,300)}${assEscape(a)}`,
        });
      }
      break;
    }
    case 'callout': {
      const text = str(p.text);
      const fs = short * num(p.size, 0.05);
      const x = Math.max(0.05, Math.min(0.95, num(p.x, 0.5))) * W;
      const y = Math.max(0.05, Math.min(0.95, num(p.y, 0.3))) * H;
      events.push({
        layer: 3,
        start: o.start,
        end,
        style: 'GfxBox',
        text: `{\\an5\\pos(${r(x)},${r(y)})\\fscx20\\fscy20\\alpha&HFF&\\t(0,160,\\fscx108\\fscy108\\alpha&H00&)\\t(160,240,\\fscx100\\fscy100)\\fad(0,200)\\fn${fontFor(ctx, fontT, text)}\\fs${r(fs)}\\c${assColorTag(str(p.text_color, '#000000'))}\\3c${assColorTag(accent)}\\3a${assAlphaTag(accent)}\\bord${r(fs * 0.3)}}${assEscape(text)}`,
      });
      break;
    }
  }
  return events;
}

/** All ASS events for title, lower third, text and template overlays. */
export function graphicEvents(overlays: Overlay[], W: number, H: number, style: StyleSpec): AssEvent[] {
  const vertical = H > W;
  const ctx: Ctx = {
    W,
    H,
    short: Math.min(W, H),
    style,
    vertical,
    safe: vertical ? style.safeMargins.vertical : style.safeMargins.horizontal,
  };
  const out: AssEvent[] = [];
  for (const o of overlays) {
    if (o.type === 'title') out.push(...titleEvents(o, ctx));
    else if (o.type === 'lower_third') out.push(...lowerThirdEvents(o, ctx));
    else if (o.type === 'text') out.push(...textEvents(o, ctx));
    else if (o.type === 'template') out.push(...templateEvents(o, ctx));
  }
  return out;
}
