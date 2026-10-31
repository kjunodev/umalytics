export interface RecentMatch { code: string; label: string }
export function restoreRecentMatches(value: unknown): RecentMatch[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(entry => {
    if (!entry || typeof entry.code !== 'string' || !/^[A-Z0-9]{6}$/.test(entry.code) || seen.has(entry.code)) return [];
    seen.add(entry.code);
    return [{ code: entry.code, label: typeof entry.label === 'string' ? entry.label.slice(0, 200) : entry.code }];
  }).slice(0, 20);
}
export function rememberMatch(recent: RecentMatch[], entry: RecentMatch): RecentMatch[] {
  return restoreRecentMatches([entry, ...recent.filter(match => match.code !== entry.code)]);
}
