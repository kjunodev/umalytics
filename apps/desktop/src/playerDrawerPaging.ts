export const DRAWER_PAGE_SIZE = 8;
const HISTORY_API_PAGE_SIZE = 20;

// End is exclusive. Each slice keeps its API offset, including partial final pages.
export function getHistoryPageSlices(page: number, total: number) {
  const start = (Math.max(1, page) - 1) * DRAWER_PAGE_SIZE;
  const end = Math.min(start + DRAWER_PAGE_SIZE, total);
  const slices: Array<{ apiPage: number; start: number; end: number }> = [];
  for (let offset = start; offset < end;) {
    const apiPage = Math.floor(offset / HISTORY_API_PAGE_SIZE) + 1;
    const base = (apiPage - 1) * HISTORY_API_PAGE_SIZE;
    const sliceEnd = Math.min(end, base + HISTORY_API_PAGE_SIZE);
    slices.push({ apiPage, start: offset - base, end: sliceEnd - base });
    offset = sliceEnd;
  }
  return slices;
}

export function getHistoryPageRows<T>(pages: Record<number, { matches: T[] }>, page: number, total: number): T[] {
  const slices = getHistoryPageSlices(page, total);
  if (slices.some(slice => !pages[slice.apiPage])) return [];
  return slices.flatMap(slice => pages[slice.apiPage]!.matches.slice(slice.start, slice.end));
}
