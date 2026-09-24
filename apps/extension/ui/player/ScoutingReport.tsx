import type { PlayerProfileSummary, PlayerTopUmaSummary } from '@umalytics/shared';
import { hasDisplayableProfileLists } from '../common/badges';
import { formatDecimal, formatNumber, formatPercent, formatRecord } from '../common/format';

export type SampleConfidence = 'small' | 'steady' | 'proven';

export function ScoutingReport({
  profile,
  emptyMessage
}: {
  profile: PlayerProfileSummary | undefined;
  emptyMessage?: string;
}) {
  if (profile === undefined || !hasDisplayableProfileLists(profile) || profile.error !== undefined) {
    return (
      <section className="scouting-report" aria-label="Player scouting report">
        <p>Scouting Report</p>
        <span className="section-message">{emptyMessage ?? 'No profile summary available.'}</span>
      </section>
    );
  }

  const comfortPick = profile.topUmas?.[0];
  const bestPick = profile.bestUmas?.[0];
  const sampleConfidence = getSampleConfidence(profile.matches);

  return (
    <section className="scouting-report" aria-label="Player scouting report">
      <p>Scouting Report</p>
      <div className="report-grid">
        <ReportMetric
          label="Comfort"
          value={comfortPick?.name ?? '-'}
          detail={formatUmaLine(comfortPick)}
          title="Most played Uma in ranked games for the selected stat scope."
        />
        <ReportMetric
          label="Best"
          value={bestPick?.name ?? '-'}
          detail={formatBestUmaLine(bestPick)}
          title="Best result signal using scoring first, with win rate and sample size as context."
        />
        <ReportMetric
          label="Sample"
          value={formatSampleConfidence(sampleConfidence)}
          detail={formatSampleDetail(profile)}
          title="How much ranked data this profile has in the selected stat scope."
        />
        <ReportMetric
          label="Scoring"
          value={formatScoringValue(profile.pointsPerGame)}
          detail={formatWinRateDetail(profile.winRate)}
          title="Average ranked points per game. Higher scoring is usually more draft-relevant than win rate alone."
        />
      </div>
    </section>
  );
}

export function ReportMetric({
  label,
  value,
  detail,
  title
}: {
  label: string;
  value: string;
  detail: string;
  title: string;
}) {
  return (
    <div className="report-metric" title={title}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function formatUmaLine(uma: PlayerTopUmaSummary | undefined): string {
  if (uma === undefined) {
    return 'No data';
  }

  return `${uma.matches} GP - ${formatDecimal(uma.pointsPerGame)} PPG`;
}

export function formatBestUmaLine(uma: PlayerTopUmaSummary | undefined): string {
  if (uma === undefined) {
    return 'No data';
  }

  if (uma.performanceScore === undefined) {
    return `${formatDecimal(uma.pointsPerGame)} PPG - ${uma.matches} GP`;
  }

  return `${formatNumber(uma.performanceScore)} score - ${formatSampleConfidence(getSampleConfidence(uma.matches))}`;
}

export function formatRecordDetail(profile: PlayerProfileSummary): string {
  const record = formatRecord(profile);

  return record === '-' ? 'Record unknown' : `${record} W-L`;
}

export function formatSampleDetail(profile: PlayerProfileSummary): string {
  const matches = formatNumber(profile.matches);
  const record = formatRecordDetail(profile);

  return matches === '-' ? record : `${matches} GP - ${record}`;
}

export function formatScoringValue(pointsPerGame: number | null | undefined): string {
  const formattedScoring = formatDecimal(pointsPerGame);

  return formattedScoring === '-' ? '-' : `${formattedScoring} PPG`;
}

export function formatWinRateDetail(winRate: number | null | undefined): string {
  const formattedWinRate = formatPercent(winRate);

  return formattedWinRate === '-' ? 'Win rate unknown' : `${formattedWinRate} win`;
}

export function getSampleConfidence(matches: number | null | undefined): SampleConfidence {
  if (matches === undefined || matches === null || matches < 10) {
    return 'small';
  }

  if (matches < 25) {
    return 'steady';
  }

  return 'proven';
}

export function formatSampleConfidence(confidence: SampleConfidence): string {
  switch (confidence) {
    case 'proven':
      return 'Established';
    case 'steady':
      return 'Steady';
    case 'small':
      return 'Small';
  }
}
