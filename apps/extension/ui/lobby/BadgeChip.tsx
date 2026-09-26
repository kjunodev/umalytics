import type { NotableBadge, NotableBadgeKind } from '../common/badges';

const RANK_KINDS = new Set<NotableBadgeKind>(['top10', 'top25']);

// Card-only display order: rank first, then playstyle, then sample size.
// This is presentational only; it never changes getNotableBadges() itself,
// which other consumers (the drawer, diagnostics) rely on as-is.
const CARD_BADGE_PRIORITY: Partial<Record<NotableBadgeKind, number>> = {
  top10: 0, top25: 1,
  oneTrick: 2, deepPool: 2,
  eliteScoring: 3, highScoring: 3, mvpMenace: 3, podiumRegular: 3, underrated: 3,
  newcomer: 4,
  consistent: 5,
  established: 6
};

const ICON_KIND_STYLE: Partial<Record<NotableBadgeKind, { background: string; color: string }>> = {
  mvpMenace: { background: 'var(--tone-mvp-bg)', color: 'var(--tone-mvp-fg)' },
  eliteScoring: { background: 'var(--tone-skill-bg)', color: 'var(--tone-skill-fg)' },
  highScoring: { background: 'var(--tone-skill-bg)', color: 'var(--tone-skill-fg)' },
  consistent: { background: 'var(--tone-skill-bg)', color: 'var(--tone-skill-fg)' },
  established: { background: 'var(--tone-sample-bg)', color: 'var(--tone-sample-fg)' },
  podiumRegular: { background: 'var(--tone-skill-bg)', color: 'var(--tone-skill-fg)' },
  underrated: { background: 'var(--tone-skill-bg)', color: 'var(--tone-skill-fg)' },
  oneTrick: { background: 'var(--tone-style-bg)', color: 'var(--tone-style-fg)' },
  deepPool: { background: 'var(--tone-style-bg)', color: 'var(--tone-style-fg)' },
  newcomer: { background: 'var(--tone-sample-bg)', color: 'var(--tone-sample-fg)' }
};

const MAX_CARD_BADGES = 7;

export function sortBadgesForCard(badges: NotableBadge[]): NotableBadge[] {
  return [...badges].sort((a, b) => (CARD_BADGE_PRIORITY[a.kind] ?? 9) - (CARD_BADGE_PRIORITY[b.kind] ?? 9));
}

// Fixed two-row (49px) badge area: rank stays a short text chip, every other
// badge is an icon chip keyed by NotableBadge.kind, with a hover/focus-only
// tooltip carrying its label and real numbers. Chips wrap inside the area so
// stats below always line up across cards. Beyond 7, extras collapse to +N.
// Every tooltip is positioned against the .card-badges row (not the chip
// itself), spanning the row's own width, so it can never extend past the
// card regardless of which chip in the row is hovered.
export function BadgeChipRow({ badges }: { badges: NotableBadge[] }) {
  const ordered = sortBadgesForCard(badges);
  const shown = ordered.slice(0, MAX_CARD_BADGES);
  const overflow = ordered.slice(MAX_CARD_BADGES);

  return (
    <div className="card-badges">
      {shown.map((badge) => (
        <BadgeChip key={badge.kind} badge={badge} />
      ))}
      {overflow.length > 0 ? (
        <span
          className="chip chip-more"
          tabIndex={0}
          aria-label={`${overflow.length} more badges: ${overflow.map((badge) => badge.label).join(', ')}`}
        >
          <span>{`+${overflow.length}`}</span>
          <span className="chip-tooltip" role="tooltip">
            <b>{`${overflow.length} more`}</b>
            {`${overflow.map((badge) => badge.label).join(', ')}. All badges are listed in details.`}
          </span>
        </span>
      ) : null}
    </div>
  );
}

function BadgeChip({ badge }: { badge: NotableBadge }) {
  if (RANK_KINDS.has(badge.kind)) {
    return (
      <span className="chip chip-rank" tabIndex={0} aria-label={`${badge.label}: ${badge.title}`}>
        <span>{badge.label}</span>
        <span className="chip-tooltip" role="tooltip">
          <b>{badge.label}</b>
          {badge.title}
        </span>
      </span>
    );
  }

  const style = ICON_KIND_STYLE[badge.kind];

  return (
    <span className="chip chip-icon" style={style} tabIndex={0} aria-label={`${badge.label}: ${badge.title}`}>
      <BadgeIcon kind={badge.kind} />
      <span className="chip-tooltip" role="tooltip">
        <b>{badge.label}</b>
        {badge.title}
      </span>
    </span>
  );
}

export function BadgeIcon({ kind }: { kind: NotableBadgeKind }) {
  switch (kind) {
    case 'mvpMenace':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 1.8l1.6 3.3 3.6.5-2.6 2.5.6 3.6L7 10l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5L7 1.8z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'eliteScoring':
    case 'highScoring':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5.3" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="7" cy="7" r="2.6" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="7" cy="7" r=".8" fill="currentColor" />
        </svg>
      );
    case 'consistent':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M1.5 9.5c1.5-2 3-2 4.5 0s3 2 4.5 0 2-2 2-2M1.5 5c1.5-2 3-2 4.5 0s3 2 4.5 0 2-2 2-2"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'established':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 1.5l4.5 1.8v3.4c0 2.8-2 4.6-4.5 5.8-2.5-1.2-4.5-3-4.5-5.8V3.3L7 1.5z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M4.8 7l1.6 1.6L9.3 5.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'podiumRegular':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2 12.3V8.3h3v4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M5.5 12.3V5.7h3v6.6" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M9 12.3V9.3h3v3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    case 'underrated':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 5.2 5.4 1.8h3.2l2.4 3.4-4 7-4-7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M3 5.2h8" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case 'oneTrick':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 1.5c-2.2 0-4 1.7-4 3.9 0 2.9 4 7.1 4 7.1s4-4.2 4-7.1c0-2.2-1.8-3.9-4-3.9z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <circle cx="7" cy="5.4" r="1.3" fill="currentColor" />
        </svg>
      );
    case 'deepPool':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="3.2" cy="3.2" r="1" fill="currentColor" />
          <circle cx="7" cy="3.2" r="1" fill="currentColor" />
          <circle cx="10.8" cy="3.2" r="1" fill="currentColor" />
          <circle cx="3.2" cy="7" r="1" fill="currentColor" />
          <circle cx="7" cy="7" r="1" fill="currentColor" />
          <circle cx="10.8" cy="7" r="1" fill="currentColor" />
          <circle cx="3.2" cy="10.8" r="1" fill="currentColor" />
          <circle cx="7" cy="10.8" r="1" fill="currentColor" />
          <circle cx="10.8" cy="10.8" r="1" fill="currentColor" />
        </svg>
      );
    case 'newcomer':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 12.3V7.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M7 7.2c0-2.6-2-4-4.3-3.9 0 2.6 1.9 4.2 4.3 3.9z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M7 8.6c0-2.4 1.8-3.7 3.9-3.6 0 2.4-1.7 3.8-3.9 3.6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}
