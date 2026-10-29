export function cleanTeamName(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/\s*\[\s*edit\s*\]\s*$/i, '')
    .replace(/\s+\bedit\b\s*$/i, '')
    .trim();

  return cleaned === undefined || cleaned.length === 0 ? undefined : cleaned;
}
