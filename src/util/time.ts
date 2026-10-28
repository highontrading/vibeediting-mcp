/** 75.5 -> "1:15.5"; 3725 -> "1:02:05.0" */
export function fmtTime(sec: number, decimals = 1): string {
  if (!Number.isFinite(sec)) return '?';
  const neg = sec < 0;
  const pow = 10 ** decimals;
  // Round once, up front, so 59.96 becomes 1:00.0 (not 0:60.0 or 0:00.0).
  const totalUnits = Math.round(Math.abs(sec) * pow);
  const whole = Math.floor(totalUnits / pow);
  const frac = totalUnits % pow;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, '0') + (decimals > 0 ? `.${String(frac).padStart(decimals, '0')}` : '');
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  return (neg ? '-' : '') + body;
}

/** Human duration: 75 -> "1 min 15 s" */
export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '?';
  if (sec < 60) return `${Math.round(sec * 10) / 10} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  if (m < 60) return s > 0 ? `${m} min ${s} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m - h * 60} min`;
}

/**
 * Parse a time the agent or user gives us: 12, "12.5", "1:05", "1:02:03.5", "75s".
 */
export function parseTime(v: number | string): number {
  if (typeof v === 'number') return v;
  const t = v.trim().replace(/s$/i, '');
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p)))
    throw new Error(`Cannot read the time "${v}". Use seconds like 12.5 or m:ss like 1:05.`);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** SRT timestamp 00:01:02,345 */
export function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
}

/** ASS timestamp 0:01:02.34 (centiseconds) */
export function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const r = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(2, '0')}`;
}

/** YouTube chapter timestamp: 0:00, 1:05, 1:02:03 */
export function chapterTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

export const round = (n: number, d = 3): number => Math.round(n * 10 ** d) / 10 ** d;
