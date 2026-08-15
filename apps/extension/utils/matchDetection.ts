import type { MatchCode } from '@umalytics/shared';

const SPECTATE_ROUTE_PATTERN = /^\/spectate\/([^/?#]+)/;

export function extractMatchCodeFromUrl(url: string): MatchCode | undefined {
  const parsedUrl = new URL(url);
  const match = SPECTATE_ROUTE_PATTERN.exec(parsedUrl.pathname);
  const rawMatchCode = match?.[1];

  if (rawMatchCode === undefined || rawMatchCode.length === 0) {
    return undefined;
  }

  return rawMatchCode;
}
