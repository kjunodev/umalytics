// Runs in the page. Check normal-flow siblings and containment throughout
// each component, including text nodes. Overlay hit targets and decorations
// are intentionally layered; hidden tooltips have no visible footprint.
export function checkGeometry() {
  const selectors = [
    '.app-header', '.app-header-grid', '.team-list', '.team-section', '.player-list', '.player-row',
    '.card-name-row', '.card-badges', '.scouting-grid', '.stat-cell', '.top-umas', '.top-umas-rows',
    '.card-message-box', '.player-rank-line', '.player-badge-row',
    '.top-umas-rows li', '.draft-phase-bar', '.draft-columns', '.draft-team-panel',
    '.draft-pick-grid', '.draft-pick-tile', '.draft-pick-tile button',
    '.draft-ban-veto-rows', '.draft-ban-veto-row', '.draft-ban-veto-slot',
    '.draft-experience-panel', '.draft-experience-row', '.draft-races-panel',
    '.draft-race-list', '.draft-race-card', '.draft-vetoed-map-row',
    '.draft-team-header', '.draft-races-header', '.draft-races-legend', '.draft-team-legend',
    '.draft-race-title', '.draft-race-mods',
    '.player-drawer', '.player-drawer-head', '.player-drawer-identity',
    '.player-drawer-title-row', '.drawer-stat-row', '.drawer-stat-panel',
    '.drawer-section', '.drawer-section-head', '.uma-table-rows', '.uma-table-row',
    '.uma-table-name', '.drawer-history-rows', '.drawer-history-row', '.drawer-pager',
    '.umas-layout', '.uma-catalog-grid', '.uma-catalog-button',
    '.uma-detail-panel', '.uma-detail-player', '.players-board', '.players-rows',
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
  // Draft scene balance: side by side, the three column panels end on the same
  // line, and every race card's chips (surface, season, weather, ground) are
  // one line. Stacked single-column layouts (narrow scene) have no shared edge.
  const draftPanels = [...document.querySelectorAll('.draft-columns > .draft-team-panel, .draft-columns > .draft-races-panel')].filter(visible);
  if (draftPanels.length === 3) {
    const boxes = draftPanels.map(el => el.getBoundingClientRect());
    const sideBySide = boxes.every(box => Math.abs(box.top - boxes[0].top) <= tolerance);
    counts['draft column panels side by side'] = sideBySide ? 1 : 0;
    if (sideBySide && Math.max(...boxes.map(box => box.bottom)) - Math.min(...boxes.map(box => box.bottom)) > tolerance) {
      failures.push(`Draft column panels end at different heights: ${boxes.map(box => box.bottom.toFixed(1)).join(', ')}`);
    }
  }
  const modRows = [...document.querySelectorAll('.draft-race-mods')].filter(visible);
  counts['.draft-race-mods single line'] = modRows.length;
  for (const row of modRows) {
    const chips = [...row.querySelectorAll('.draft-mod')].filter(visible).map(el => el.getBoundingClientRect());
    if (chips.some(chip => Math.abs(chip.top - chips[0].top) > tolerance)
      || row.getBoundingClientRect().height > Math.max(...chips.map(chip => chip.height)) + tolerance) {
      failures.push('Race card chips wrap onto a second line');
    }
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

// Runs in the page. The header picks full, compact or two-row from its own
// width, so this derives the expected state from the measured container width
// and the thresholds passed in, then checks what that state must guarantee:
// every child inside the header box, no overlaps, the menu button right-most
// on the first row, a fixed height per state, and (one-row states) that the
// children fit with `slack` px to spare rather than by shrinking. `rect`
// values are viewport px; dividing by the UI scale gives layout px.
export function checkHeader({ fullMin, compactMin, rowHeight, minSlack }) {
  const tolerance = 1.1;
  const failures = [];
  const header = document.querySelector('.app-header');
  const grid = header.querySelector('.app-header-grid');
  const scale = { small: 0.875, default: 1, large: 1.15 }[document.documentElement.dataset.uiSize];
  const box = header.getBoundingClientRect();
  // The lead and tail groups only wrap these controls in the two-row layout.
  const children = [...grid.querySelectorAll('.app-logo, .mode-toggle, .scene-toggle, .scope-toggle, .status-pill, .app-menu-wrap')]
    .map(el => ({ el, box: el.getBoundingClientRect(), name: el.className.split(' ').find(name => name !== 'seg') }))
    .filter(({ box }) => box.width > 0 && box.height > 0);
  const menu = children.find(child => child.name === 'app-menu-wrap');
  const button = menu?.el.querySelector('.iconbtn').getBoundingClientRect();
  if (button === undefined) return { state: 'unknown', failures: ['Header has no menu button'] };

  for (const { box: b, name } of children) {
    if (b.left < box.left - tolerance || b.right > box.right + tolerance || b.top < box.top - tolerance || b.bottom > box.bottom + tolerance) {
      failures.push(`Header child ${name} extends past the header box`);
    }
  }
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i].box, b = children[j].box;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance) {
        failures.push(`Header children ${children[i].name} and ${children[j].name} overlap`);
      }
    }
  }
  const firstRow = children.filter(({ box: b }) => b.top < button.bottom - tolerance && b.bottom > button.top + tolerance);
  if (firstRow.some(({ box: b }) => b.right > button.right + tolerance) || children.some(({ box: b }) => b.right > button.right + tolerance)) {
    failures.push('The menu button is not the right-most header element');
  }
  if (!firstRow.some(child => child.name === 'app-logo')) failures.push('The menu button is not on the first header row');

  const rows = children.filter(({ box: b }) => b.top >= button.bottom - tolerance).length > 0 ? 2 : 1;
  const word = header.querySelector('.app-logo-word');
  const wordHidden = getComputedStyle(word).position === 'absolute';
  const state = rows === 2 ? 'two-row' : wordHidden ? 'compact' : 'full';
  const width = grid.getBoundingClientRect().width / scale;
  const expected = width >= fullMin ? 'full' : width >= compactMin ? 'compact' : 'two-row';
  if (state !== expected) failures.push(`Header is ${state} at ${width.toFixed(1)}px; expected ${expected}`);
  const height = box.height / scale;
  const expectedHeight = 2 + 20 + rowHeight * (rows === 2 ? 2 : 1) + (rows === 2 ? 10 : 0);
  if (Math.abs(height - expectedHeight) > tolerance) failures.push(`Header height ${height.toFixed(1)} in ${state}; expected ${expectedHeight}`);
  if (state !== 'full' && word.getBoundingClientRect().width > 2 && rows === 1) failures.push('Compact header still shows the wordmark');
  if (header.querySelector('.app-logo').title !== 'UmaLytics') failures.push('Logo has no UmaLytics title');
  const tabs = [...header.querySelectorAll('.mode-toggle button, .scene-toggle button, .scope-toggle button')];
  if (tabs.length !== 8 || tabs.some(tab => tab.scrollWidth > tab.clientWidth + tolerance || tab.getBoundingClientRect().width < 30)) {
    failures.push('A header tab label is clipped or missing');
  }
  const pill = header.querySelector('.status-pill');
  if (!pill.title) failures.push('Status pill has no title');
  if (!/\S/.test(pill.textContent)) failures.push('Status pill has no accessible text');
  if (rows === 1 && state !== 'two-row') {
    const used = children.reduce((sum, child) => sum + child.box.width, 0) / scale + 16 * 6;
    const slack = width - used;
    if (slack < minSlack) failures.push(`Header ${state} has only ${slack.toFixed(1)}px of slack at ${width.toFixed(1)}px`);
    return { state, width, slack, failures };
  }
  return { state, width, failures };
}

// Runs in the page with the menu open: the menu must sit fully inside the
// viewport (excluding the scrollbar) without scrolling the page sideways.
export function checkOpenMenu() {
  const tolerance = 1.1;
  const failures = [];
  const menu = document.querySelector('.app-menu');
  if (menu === null) return { failures: ['The menu did not open'] };
  const box = menu.getBoundingClientRect();
  const root = document.documentElement;
  if (box.left < -tolerance || box.top < -tolerance || box.right > root.clientWidth + tolerance || box.bottom > innerHeight + tolerance) {
    failures.push(`Open menu is outside the viewport: ${[box.left, box.top, box.right, box.bottom].map(Math.round).join(', ')} in ${root.clientWidth}x${innerHeight}`);
  }
  const button = document.querySelector('.app-menu-wrap .iconbtn').getBoundingClientRect();
  if (Math.abs(box.right - button.right) > tolerance && box.width > tolerance) failures.push('Open menu is not right-anchored to its button');
  if (root.scrollWidth > root.clientWidth + tolerance) failures.push('Opening the menu causes horizontal page overflow');
  return { failures };
}

// Runs in the page while a team-icon tooltip is open (hovered or focused).
// `boundsSelector` is the card, row or drawer the tooltip has to stay inside;
// `siblingSelector` matches the neighbouring cards/rows it must not cover;
// `baseline` is the page's scroll size measured before the hover, so a page
// that already scrolls for other reasons is not blamed on the tooltip.
export function checkTeamIconTooltip({ boundsSelector, siblingSelector, baseline }) {
  const tolerance = 1.1;
  const failures = [];
  const icon = [...document.querySelectorAll('.team-icon')]
    .find(el => el.matches(':hover') || el.matches(':focus-visible'));
  if (icon === undefined) return { failures: ['No team icon is hovered or focused'] };
  const tooltip = icon.querySelector('.team-icon-tooltip');
  const css = getComputedStyle(tooltip);
  if (css.visibility !== 'visible' || Number(css.opacity) < 1) failures.push('Tooltip is not visible on hover/focus');
  const box = tooltip.getBoundingClientRect();
  const anchor = icon.getBoundingClientRect();
  const container = icon.closest(boundsSelector);
  if (container === null) return { failures: [`Icon is not inside ${boundsSelector}`] };
  const bounds = container.getBoundingClientRect();
  if (box.left < bounds.left - tolerance || box.right > bounds.right + tolerance
    || box.top < bounds.top - tolerance || box.bottom > bounds.bottom + tolerance) {
    failures.push(`Tooltip leaves ${boundsSelector}`);
  }
  // Anchored to the icon: touching it on at least one axis, within a small gap.
  const gapX = Math.max(anchor.left - box.right, box.left - anchor.right, 0);
  const gapY = Math.max(anchor.top - box.bottom, box.top - anchor.bottom, 0);
  if (gapX > 12 || gapY > 12) failures.push(`Tooltip is not next to its icon (${gapX.toFixed(1)}, ${gapY.toFixed(1)})`);
  for (const other of document.querySelectorAll(siblingSelector)) {
    if (other === container) continue;
    const rect = other.getBoundingClientRect();
    if (Math.min(box.right, rect.right) - Math.max(box.left, rect.left) > tolerance
      && Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top) > tolerance) {
      failures.push(`Tooltip covers a neighbouring ${siblingSelector}`);
      break;
    }
  }
  const root = document.documentElement;
  if (root.scrollWidth > baseline.width + tolerance || root.scrollHeight > baseline.height + tolerance) {
    failures.push(`Tooltip caused page scroll (${baseline.width}x${baseline.height} -> ${root.scrollWidth}x${root.scrollHeight})`);
  }
  return { failures, width: box.width, containerWidth: bounds.width, side: tooltip.dataset.side };
}
