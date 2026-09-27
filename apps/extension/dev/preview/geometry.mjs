// Runs in the page. Check normal-flow siblings and containment throughout
// each component, including text nodes. Overlay hit targets and decorations
// are intentionally layered; hidden tooltips have no visible footprint.
export function checkGeometry() {
  const selectors = [
    '.app-header', '.team-list', '.team-section', '.player-list', '.player-row',
    '.card-name-row', '.card-badges', '.scouting-grid', '.stat-cell', '.top-umas', '.top-umas-rows',
    '.card-message-box', '.player-rank-line', '.player-badge-row',
    '.top-umas-rows li', '.draft-phase-bar', '.draft-columns', '.draft-team-panel',
    '.draft-pick-grid', '.draft-pick-tile', '.draft-pick-tile button',
    '.draft-ban-veto-rows', '.draft-ban-veto-row', '.draft-ban-veto-slot',
    '.draft-experience-panel', '.draft-experience-row', '.draft-races-panel',
    '.draft-race-list', '.draft-race-card', '.draft-vetoed-map-row',
    '.draft-team-header', '.draft-races-header', '.draft-race-title', '.draft-race-mods',
    '.player-drawer', '.player-drawer-head', '.player-drawer-identity',
    '.player-drawer-title-row', '.drawer-stat-row', '.drawer-stat-panel',
    '.drawer-section', '.drawer-section-head', '.uma-table-rows', '.uma-table-row',
    '.uma-table-name', '.drawer-history-rows', '.drawer-history-row', '.drawer-pager',
    '.uma-planner-layout', '.uma-catalog-grid', '.uma-catalog-button',
    '.uma-planning-panel', '.uma-planning-player', '.players-board', '.players-rows',
    '.players-row', '.players-name', '.players-cols'
  ];
  const failures = [];
  const counts = {};
  const tolerance = 1.1; // Fractional zoom and font rasterization.
  const label = el => `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, '.')}`;
  const visible = el => {
    const css = getComputedStyle(el);
    return css.display !== 'none' && css.visibility !== 'hidden' && css.opacity !== '0';
  };
  for (const selector of selectors) {
    const elements = [...document.querySelectorAll(selector)].filter(visible);
    counts[selector] = elements.length;
    for (const parent of elements) {
      const bounds = parent.getBoundingClientRect();
      const css = getComputedStyle(parent);
      const scrollsY = /auto|scroll/.test(css.overflowY);
      const children = [...parent.children].filter(el => visible(el)
        && !['absolute', 'fixed'].includes(getComputedStyle(el).position));
      const boxes = children.map(el => ({ el, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height > 0);
      for (const { el, box } of boxes) {
        if (box.left < bounds.left - tolerance || box.right > bounds.right + tolerance
          || (!scrollsY && (box.top < bounds.top - tolerance || box.bottom > bounds.bottom + tolerance))) {
          failures.push(`${label(parent)} contains overflow from ${label(el)}`);
        }
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > tolerance
            && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > tolerance) {
            failures.push(`${label(parent)} overlaps ${label(a.el)} / ${label(b.el)}`);
          }
        }
      }
      // Check leaf text against its own box, including line wrapping.
      for (const el of [parent, ...children]) {
        const rect = el.getBoundingClientRect();
        for (const node of el.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const textRect of range.getClientRects()) {
            if (textRect.left < rect.left - tolerance || textRect.right > rect.right + tolerance
              || textRect.top < rect.top - tolerance || textRect.bottom > rect.bottom + tolerance) {
              failures.push(`${label(el)} text overflow: ${node.textContent.trim()}`);
            }
          }
        }
      }
    }
  }
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + tolerance) {
    failures.push('Page horizontal overflow');
  }
  const scale = { small: 0.875, default: 1, large: 1.15 }[document.documentElement.dataset.uiSize];
  const dimensions = {};
  for (const [selector, expected] of [
    ['.top-umas-rows li', 40], ['.best-uma-portrait', 36], ['.card-badges', 49],
    ['.draft-pick-tile button', 128], ['.draft-pick-portrait', 64],
    ['.draft-ban-veto-slot', 36], ['.draft-experience-row:not(.draft-experience-header)', 30],
    ['.uma-table-row', 44], ['.drawer-history-row', 46]
  ]) {
    dimensions[selector] = [...document.querySelectorAll(selector)].map(el => {
      const height = el.getBoundingClientRect().height / scale;
      if (Math.abs(height - expected) > tolerance) failures.push(`${selector} height ${height.toFixed(2)}; expected ${expected}`);
      return Number(height.toFixed(2));
    });
  }
  return { counts, dimensions, failures: [...new Set(failures)] };
}
