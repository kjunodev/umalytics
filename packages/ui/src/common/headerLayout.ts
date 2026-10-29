// Width limits for the header's three layouts, in layout px (after the root UI
// zoom), which is what the header's container query measures. They mirror the
// `@container header` rules in ui/shell/shell.css; tests/ui-size.test.mjs keeps
// the two in step, and dev/preview/shots.mjs checks the widest pill variants
// still fit with HEADER_MIN_SLACK to spare at each threshold.
//
// Measured natural one-row widths (logo, three tab groups, status pill, menu
// button and six 16px gaps), widest status pill ("Past match" + room code):
//   full     976px  -> full one-row layout from 985px
//   compact  750px  -> icon-only logo, dot + room code, tighter tabs from 760px
// Below 760px the header uses two rows.
export const UI_SCALES = { small: 0.875, default: 1, large: 1.15 } as const;
export type HeaderUiSize = keyof typeof UI_SCALES;

export const HEADER_FULL_MIN_WIDTH = 985;
export const HEADER_COMPACT_MIN_WIDTH = 760;
export const HEADER_ROW_HEIGHT = 42;
export const HEADER_MIN_SLACK = 8;

// Space around the header's content box: shell padding (2 x 20px) plus the
// header's border and padding (2 x 17px), and the classic scrollbar gutter that
// `scrollbar-gutter: stable` reserves on the root.
const SHELL_AND_HEADER_CHROME = 40 + 34;
const SCROLLBAR_GUTTER = 15;

export type HeaderState = 'full' | 'compact' | 'two-row';

export function headerContentWidth(viewportWidth: number, size: HeaderUiSize): number {
  return (viewportWidth - SCROLLBAR_GUTTER) / UI_SCALES[size] - SHELL_AND_HEADER_CHROME;
}

export function headerStateForWidth(contentWidth: number): HeaderState {
  return contentWidth >= HEADER_FULL_MIN_WIDTH ? 'full' : contentWidth >= HEADER_COMPACT_MIN_WIDTH ? 'compact' : 'two-row';
}
