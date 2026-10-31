import { openUrl } from '@tauri-apps/plugin-opener';

export async function openDrafterUrl(input: string): Promise<void> {
  const url = new URL(input);
  if (url.origin !== 'https://drafter.uma.guide' || url.username || url.password) throw new Error('Only Uma Drafter links can be opened.');
  await openUrl(url.href);
}
