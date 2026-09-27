import { browser } from 'wxt/browser';

export type UiSize = 'small' | 'default' | 'large';
export const UI_SIZE_KEY = 'scoutUiSize';

export function isUiSize(value: unknown): value is UiSize {
  return value === 'small' || value === 'default' || value === 'large';
}

export function initialUiSize(height: number): UiSize {
  return height < 760 ? 'small' : height > 1200 ? 'large' : 'default';
}

export function applyUiSize(size: UiSize): void {
  document.documentElement.dataset.uiSize = size;
}

// Called before mounting React. Window height is consulted only when no
// valid preference exists; there is deliberately no resize subscription.
export async function initializeUiSize(height: number): Promise<UiSize> {
  const stored = (await browser.storage.local.get(UI_SIZE_KEY))[UI_SIZE_KEY];
  const size = isUiSize(stored) ? stored : initialUiSize(height);
  if (!isUiSize(stored)) await browser.storage.local.set({ [UI_SIZE_KEY]: size });
  applyUiSize(size);
  return size;
}

export async function saveUiSize(size: UiSize): Promise<void> {
  await browser.storage.local.set({ [UI_SIZE_KEY]: size });
  applyUiSize(size);
}
