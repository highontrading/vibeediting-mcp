export const KEY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP = `[${KEY_ALPHABET}]{4}`;
const KEY_RE = new RegExp(`^VIBE-${GROUP}-${GROUP}-${GROUP}-${GROUP}$`);

/** Trim, upper-case and fix common paste problems (spaces, smart dashes, missing dashes). */
export function normalizeKey(raw: string | undefined | null): string {
  if (!raw) return '';
  let k = raw
    .normalize('NFKC')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212_]/g, '-')
    .replace(/\s+/g, '');
  // "VIBEABCD..." without dashes -> add them back.
  const compact = k.replace(/-/g, '');
  if (compact.startsWith('VIBE') && compact.length === 20) {
    const body = compact.slice(4);
    k = `VIBE-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
  }
  return k;
}

export function isValidKeyFormat(key: string): boolean {
  return KEY_RE.test(key);
}

/** VIBE-****-****-****-WXYZ, safe to show in chat. */
export function maskKey(key: string): string {
  if (!isValidKeyFormat(key)) return key ? `${key.slice(0, 5)}…` : '(none)';
  return `VIBE-****-****-****-${key.slice(-4)}`;
}
