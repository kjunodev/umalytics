import type { MatchCode } from '@umalytics/shared';
export function normalizeMatchCode(value: unknown): MatchCode | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(code)) return undefined;
  return code.replace('-', '');
}
export function extractMatchCodeFromUrl(url: string): MatchCode | undefined {
  try { return normalizeMatchCode(/^\/(?:spectate|join)\/([^/?#]+)/.exec(new URL(url).pathname)?.[1]); }
  catch { return undefined; }
}
