import type { PlayerProfileSummary, PlayerTopUmaSummary } from '@umalytics/shared';
import { BEST_UMA_MIN_MATCHES } from '../../profiles/profileConstants';
import { isHashedUmaAssetUrl } from '../../umas/umaPortraits';
import { formatDecimal, formatNumber, formatPercent } from '../common/format';
import { UmaImage, getFallbackUmaImageUrl } from '../common/UmaImage';
import { getSampleConfidence } from './ScoutingReport';

export type UmaBadgeTone = 'scoring' | 'winrate' | 'sample' | 'caution';

export interface UmaBadge {
  label: string;
  value: string;
  tone: UmaBadgeTone;
  title: string;
}

export function BestUmasList({
  bestUmas,
  playerName,
  emptyMessage
}: {
  bestUmas?: PlayerProfileSummary['bestUmas'];
  playerName: string;
  emptyMessage?: string;
}) {
  const slots = Array.from({ length: 5 }, (_, index) => bestUmas?.[index]);
  const shouldShowMessage = bestUmas === undefined || bestUmas.length === 0;

  return (
    <div
      className="top-umas best-umas"
      aria-label={`${playerName} best performing Umas`}
      title={`Best ranked Uma results with at least ${BEST_UMA_MIN_MATCHES} games. Score favors PPG, then win rate and sample size.`}
    >
      <p>Best Performing</p>
      {shouldShowMessage ? (
        <span className="section-message">
          {emptyMessage ?? `No Umas meet the ${BEST_UMA_MIN_MATCHES} game sample yet.`}
        </span>
      ) : (
        <ol>
          {slots.map((uma, index) => (
            uma === undefined ? (
              <li key={`empty-best-uma:${index}`} className="empty-uma-row">
                <span className="uma-name">-</span>
                <span className="uma-meta">-</span>
              </li>
            ) : (
              <li key={uma.umaId} className="best-uma-row">
                <span className="best-uma-heading">
                  <BestUmaPortrait uma={uma} />
                  <span className="best-uma-copy">
                    <span className="uma-name" title={uma.name}>
                      {uma.name}
                    </span>
                    <span className="best-uma-badges">
                      {getUmaBadges(uma).map((badge) => (
                        <span
                          key={badge.label}
                          className={`uma-badge ${badge.tone}`}
                          title={badge.title}
                        >
                          <small>{badge.label}</small>
                          <strong>{badge.value}</strong>
                        </span>
                      ))}
                    </span>
                  </span>
                </span>
                <span className="best-uma-stats">
                  <span>
                    <small>Score</small>
                    <strong>{formatNumber(uma.performanceScore)}</strong>
                  </span>
                  <span>
                    <small>PPG</small>
                    <strong>{formatDecimal(uma.pointsPerGame)}</strong>
                  </span>
                  <span>
                    <small>WR</small>
                    <strong>{formatPercent(uma.winRate)}</strong>
                  </span>
                  <span>
                    <small>GP</small>
                    <strong>{uma.matches}</strong>
                  </span>
                </span>
              </li>
            )
          ))}
        </ol>
      )}
    </div>
  );
}

export function BestUmaPortrait({ uma }: { uma: PlayerTopUmaSummary }) {
  const fallbackImageUrl = getFallbackUmaImageUrl(uma.umaId);
  const imageUrl = isHashedUmaAssetUrl(uma.imageUrl)
    ? fallbackImageUrl
    : uma.imageUrl ?? fallbackImageUrl;

  return (
    <span className="best-uma-portrait" aria-hidden="true">
      <UmaImage imageUrl={imageUrl} name={uma.name} />
    </span>
  );
}

export function getUmaBadges(uma: PlayerTopUmaSummary): UmaBadge[] {
  const badges: UmaBadge[] = [];
  const confidence = getSampleConfidence(uma.matches);

  if (uma.pointsPerGame !== null && uma.pointsPerGame >= 7) {
    badges.push({
      label: 'Scoring',
      value: 'Elite',
      tone: 'scoring',
      title: 'Averages at least 7.0 points per ranked game on this Uma.'
    });
  } else if (uma.pointsPerGame !== null && uma.pointsPerGame >= 6.5) {
    badges.push({
      label: 'Scoring',
      value: 'High',
      tone: 'scoring',
      title: 'Averages at least 6.5 points per ranked game on this Uma.'
    });
  } else if (uma.pointsPerGame !== null && uma.pointsPerGame >= 5.5) {
    badges.push({
      label: 'Scoring',
      value: 'Solid',
      tone: 'scoring',
      title: 'Averages at least 5.5 points per ranked game on this Uma.'
    });
  }

  if (uma.winRate !== null && uma.winRate >= 0.7 && uma.matches >= 10) {
    badges.push({
      label: 'Wins',
      value: '70%+',
      tone: 'winrate',
      title: 'At least 10 ranked games and a 70% or higher win rate on this Uma.'
    });
  } else if (uma.winRate !== null && uma.winRate >= 0.65 && uma.matches >= 10) {
    badges.push({
      label: 'Wins',
      value: '65%+',
      tone: 'winrate',
      title: 'At least 10 ranked games and a 65% or higher win rate on this Uma.'
    });
  }

  if (confidence === 'small') {
    badges.push({
      label: 'Sample',
      value: 'Small',
      tone: 'caution',
      title: 'Fewer than 10 ranked games on this Uma. Treat the result as a hint, not a conclusion.'
    });
  } else if (confidence === 'proven') {
    badges.push({
      label: 'Sample',
      value: 'Established',
      tone: 'sample',
      title: 'At least 25 ranked games on this Uma.'
    });
  } else {
    badges.push({
      label: 'Sample',
      value: 'Steady',
      tone: 'sample',
      title: 'At least 10 ranked games on this Uma.'
    });
  }

  return badges.slice(0, 3);
}
