export interface TooltipRect { left: number; top: number; right: number; bottom: number }
export interface TooltipSize { width: number; height: number }
export type TooltipSide = 'below' | 'above' | 'right' | 'left';
export interface TooltipPlacement { side: TooltipSide; left: number; top: number }

const SIDES: TooltipSide[] = ['below', 'above', 'right', 'left'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/**
 * Picks where a tooltip goes relative to its anchor so it stays inside
 * `bounds` (the card, table row or drawer the icon lives in). Preference
 * order is below, above, then beside the anchor; a side is used only when the
 * tooltip fits there entirely. Below/above align the tooltip's left edge with
 * the anchor and slide it sideways to stay in bounds; right/left centre it
 * vertically on the anchor. When no side fits, the one that overflows least
 * is used and the result is clamped into bounds. Every rect is in viewport
 * pixels.
 */
export function computeTooltipPlacement(
  anchor: TooltipRect, size: TooltipSize, bounds: TooltipRect, gap: number, margin: number
): TooltipPlacement {
  const minLeft = bounds.left + margin;
  const maxLeft = bounds.right - margin - size.width;
  const minTop = bounds.top + margin;
  const maxTop = bounds.bottom - margin - size.height;
  const candidates = SIDES.map(side => {
    let left: number;
    let top: number;
    if (side === 'below' || side === 'above') {
      left = clamp(anchor.left, minLeft, maxLeft);
      top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - size.height;
    } else {
      left = side === 'right' ? anchor.right + gap : anchor.left - gap - size.width;
      top = clamp((anchor.top + anchor.bottom) / 2 - size.height / 2, minTop, maxTop);
    }
    const overflow = Math.max(0, minLeft - left) + Math.max(0, left - maxLeft)
      + Math.max(0, minTop - top) + Math.max(0, top - maxTop);
    return { side, left, top, overflow };
  });
  const best = candidates.find(candidate => candidate.overflow === 0)
    ?? candidates.reduce((least, candidate) => candidate.overflow < least.overflow ? candidate : least);
  return {
    side: best.side,
    left: clamp(best.left, minLeft, maxLeft),
    top: clamp(best.top, minTop, maxTop)
  };
}

// Containers a team-icon tooltip must stay inside: a lobby/history card, a
// Players leaderboard row, or the details drawer.
export const TEAM_ICON_TOOLTIP_BOUNDS = '.player-row, .players-row, .player-drawer';
const TOOLTIP_GAP = 6;
const TOOLTIP_MARGIN = 4;

/**
 * Places a team-icon tooltip next to its icon. The tooltip is absolutely
 * positioned inside the icon (left/top are relative to the icon's padding
 * box), so this measures the real on-screen scale first: the UI-size setting
 * applies CSS zoom, which makes viewport pixels differ from the pixels
 * left/top/max-width are written in.
 */
export function positionTeamIconTooltip(anchor: HTMLElement, tooltip: HTMLElement): void {
  const container = anchor.closest<HTMLElement>(TEAM_ICON_TOOLTIP_BOUNDS);
  const view = anchor.ownerDocument.documentElement;
  const bounds: TooltipRect = container?.getBoundingClientRect()
    ?? { left: 0, top: 0, right: view.clientWidth, bottom: view.clientHeight };
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';
  const origin = tooltip.getBoundingClientRect();
  tooltip.style.left = '100px';
  const scale = (tooltip.getBoundingClientRect().left - origin.left) / 100 || 1;
  tooltip.style.maxWidth = `${Math.max(0, (bounds.right - bounds.left - 2 * TOOLTIP_MARGIN) / scale)}px`;
  const size = tooltip.getBoundingClientRect();
  const placement = computeTooltipPlacement(
    anchor.getBoundingClientRect(), { width: size.width, height: size.height }, bounds, TOOLTIP_GAP, TOOLTIP_MARGIN
  );
  tooltip.style.left = `${(placement.left - origin.left) / scale}px`;
  tooltip.style.top = `${(placement.top - origin.top) / scale}px`;
  tooltip.dataset.side = placement.side;
}
