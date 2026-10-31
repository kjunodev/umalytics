import type { Page } from './preferences';

const paths: Record<Page, string> = {
  Live: 'M3 18v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2m4 0v-2a4 4 0 0 0-3-3.9M8 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6m7-5a3 3 0 0 1 0 6',
  Stamina: 'M2 12h5l3-7 4 14 3-7h5',
  Players: 'M8 3h8v5a4 4 0 0 1-8 0zM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v6m-4 3h8m-4-3v3',
  History: 'M3 4v6h6M3 10a9 9 0 1 1 1 8m8-12v6l4 2',
  Settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0-6v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2'
};

export function RailIcon({ page }: { page: Page }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[page]}/></svg>;
}
