export function numberFieldValue(draft: string, min: number, max: number): number | undefined {
  if (!/^[+-]?\d+$/.test(draft.trim())) return undefined;
  const value = Number(draft);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}
