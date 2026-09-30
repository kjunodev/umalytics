import { browser } from 'wxt/browser';
import { headerStateForWidth, headerContentWidth } from './headerLayout';

export type UiSize = 'small' | 'default' | 'large';
export const UI_SIZE_KEY = 'scoutUiSize';

export function isUiSize(value: unknown): value is UiSize {
  return value === 'small' || value === 'default' || value === 'large';
}

// Height picks the size first; width then steps it down (large, default,
// small) so the header never starts out needing its two-row layout.
export function initialUiSize(height: number, width: number): UiSize {
  const byHeight: UiSize = height < 760 ? 'small' : height > 1200 ? 'large' : 'default';
  const candidates: UiSize[] = byHeight === 'large' ? ['large', 'default', 'small'] : byHeight === 'default' ? ['default', 'small'] : ['small'];
  return candidates.find(size => headerStateForWidth(headerContentWidth(width, size)) !== 'two-row') ?? 'small';
}

export function applyUiSize(size: UiSize): void {
  document.documentElement.dataset.uiSize = size;
}

// Called before mounting React. Window size is consulted only when no
// valid preference exists; there is deliberately no resize subscription.
export async function initializeUiSize(height: number, width: number): Promise<UiSize> {
  const stored = (await browser.storage.local.get(UI_SIZE_KEY))[UI_SIZE_KEY];
  const size = isUiSize(stored) ? stored : initialUiSize(height, width);
  if (!isUiSize(stored)) await browser.storage.local.set({ [UI_SIZE_KEY]: size });
  applyUiSize(size);
  return size;
}

export async function saveUiSize(size: UiSize): Promise<void> {
  await browser.storage.local.set({ [UI_SIZE_KEY]: size });
  applyUiSize(size);
}
