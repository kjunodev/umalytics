import type { PlayerProfileSummary, PlayerRecentMatchSummary, PlayerStatsScope, PrematchPlayer, PrematchTeam } from '@umalytics/shared';
import { useEffect, useRef, useState } from 'react';
import { cancelPlayerHistoryPageRequest, sendPlayerHistoryPageRequest } from '../../runtime/messaging';
import { recentHistoryEmptyMessage } from '../../profiles/profileMerge';
import { getNotableBadges, hasDisplayableProfileLists } from '../common/badges';
import { formatDecimal, formatNumber, formatPercent, formatRank, formatRecord, formatRelativeAge } from '../common/format';
import { getPlayerPartyVisual, getTeamPartyVisuals } from '../common/partyVisuals';
import { BestUmasList } from './BestUmasList';
import { RecentMatchesList } from './RecentMatchesList';
import { ScoutingReport } from './ScoutingReport';
import { TopUmasList, UmaResolutionNote } from './TopUmasList';

export function PlayerDetailScene({
  team,
  player,
  profile,
  isProfileLoading,
  statsScope,
  now,
  onBack,
  backLabel = 'Back to lobby'
}: {
  team?: PrematchTeam;
  backLabel?: string;
  player: PrematchPlayer;
  profile?: PlayerProfileSummary;
  isProfileLoading: boolean;
  statsScope: PlayerStatsScope;
  now: number;
  onBack: () => void;
}) {
  const displayedProfile = getDisplayedProfileStats(profile, statsScope);
  const rating = profile?.conservativeRating ?? profile?.rating ?? player.displayRatingSnapshot ?? player.ratingSnapshot;
  const discordId = getLookupDiscordId(player);
  const profileUrl = profile?.profileUrl ?? player.profileUrl;
  const note = getPlayerNote(profile, discordId);
  const statsMessage = getStatsMessage(displayedProfile, profile, isProfileLoading, discordId);
  const partyVisual = getPlayerPartyVisual(player, getTeamPartyVisuals(team?.players ?? []));
  const isCaptain = player.isCaptain === true || player.role === 'captain';
  const historyKey = `${player.discordId}:${statsScope}`;
  const pendingHistoryRequests = useRef(new Set<string>());
  const [historyPage, setHistoryPage] = useState<{
    key: string; page: number; total: number; matches: NonNullable<PlayerProfileSummary['recentMatches']>;
    firstPageMatches?: NonNullable<PlayerProfileSummary['recentMatches']>;
    summary?: PlayerProfileSummary['historySummary']; loading: boolean; error?: string;
  }>({ key: historyKey, page: 0, total: 0, matches: [], loading: false });
  const historyLoaded = historyPage.key === historyKey && historyPage.page > 0;
  const detailProfile = historyLoaded ? withDetailHistory(displayedProfile, historyPage.firstPageMatches ?? [], historyPage.total, historyPage.summary) : displayedProfile;
  const notableBadges = getNotableBadges(detailProfile === undefined ? undefined :
    historyLoaded ? detailProfile : { ...detailProfile, recentForm: undefined });

  useEffect(() => {
    setHistoryPage({ key: historyKey, page: 0, total: 0, matches: [], loading: true });
    if (discordId !== undefined) void loadHistoryPage(1);
    return () => {
      for (const requestId of pendingHistoryRequests.current) void cancelPlayerHistoryPageRequest(requestId).catch(() => {});
      pendingHistoryRequests.current.clear();
    };
  }, [historyKey]);

  async function loadHistoryPage(page: number): Promise<void> {
    if (discordId === undefined) return;
    const requestId = crypto.randomUUID();
    pendingHistoryRequests.current.add(requestId);
    setHistoryPage(previous => previous.key === historyKey ? { ...previous, loading: true, error: undefined } : previous);
    try {
      const result = await sendPlayerHistoryPageRequest(discordId, statsScope, page, requestId);
      setHistoryPage(previous => previous.key === historyKey ? {
        key: historyKey, page, total: result.total, summary: page === 1 ? result.summary : previous.summary,
        firstPageMatches: page === 1 ? result.matches : previous.firstPageMatches,
        matches: page === 1 ? result.matches : [...previous.matches, ...result.matches], loading: false
      } : previous);
    } catch (error) {
      setHistoryPage(previous => previous.key === historyKey ? {
        ...previous, loading: false, error: error instanceof Error ? error.message : 'History unavailable.'
      } : previous);
    } finally { pendingHistoryRequests.current.delete(requestId); }
  }

  return (
    <section className="player-detail-scene" aria-label={`${player.displayName} scouting details`}>
      <header className="detail-header">
        <button type="button" className="back-button" onClick={onBack}>
          {backLabel}
        </button>
        <div className="detail-title">
          <span>{team ? team.name ?? team.id : 'Player profile'}</span>
          {profileUrl === undefined ? (
            <h2>{profile?.displayName ?? player.displayName}</h2>
          ) : (
            <h2>
              <a href={profileUrl} target="_blank" rel="noreferrer">
                {profile?.displayName ?? player.displayName}
              </a>
            </h2>
          )}
          <p>{discordId ?? 'Profile unavailable from room page'}</p>
        </div>
      </header>

      <div className="detail-card detail-summary">
        <div className="detail-identity">
          <span className="player-title">{profile?.title ?? ' '}</span>
          <div className="player-meta">
            <span className="player-rank-line detail-rank-line">
              <span>{formatRank(profile, isProfileLoading && discordId !== undefined)}</span>
              <span>{rating === undefined || rating === null ? 'Rating unknown' : `${rating} rating`}</span>
            </span>
            <span className="player-badge-row detail-badge-row">
              {isCaptain ? <span className="player-tag notable-tag rank">Captain</span> : null}
              {partyVisual === undefined ? null : (
                <span className={`identity-tag ${partyVisual.className}`} title={partyVisual.title}>
                  {partyVisual.label}
                </span>
              )}
              {notableBadges.map((badge) => (
                <span
                  key={badge.label}
                  className={`player-tag notable-tag ${badge.tone}`}
                  title={badge.title}
                >
                  {badge.label}
                </span>
              ))}
            </span>
          </div>
          <ProfileDataStatus
            discordId={discordId}
            profile={profile}
            isProfileLoading={isProfileLoading}
            now={now}
          />
        </div>

        <div className="detail-stat-panel">
          <div className="scouting-grid detail-scouting-grid" aria-label={`${player.displayName} scouting summary`}>
            <StatCell
              label="W-L"
              value={formatRecord(displayedProfile)}
              title="Ranked win-loss record for the selected stat scope."
              variant="record"
            />
            <StatCell label="Win Rate" value={formatPercent(displayedProfile?.winRate)} title="Ranked win rate for the selected stat scope." />
            <StatCell label="Pts/GP" value={formatDecimal(displayedProfile?.pointsPerGame)} title="Average ranked points per game for the selected stat scope." />
            <StatCell label="MVP" value={formatNumber(displayedProfile?.mvpMatches)} title="Total ranked MVP games for the selected stat scope." />
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-card">
          <TopUmasList
            topUmas={displayedProfile?.topUmas}
            playerName={player.displayName}
            emptyMessage={statsMessage}
          />
          <UmaResolutionNote profile={displayedProfile} />
        </div>
        <div className="detail-card">
          <ScoutingReport profile={displayedProfile} emptyMessage={statsMessage} />
        </div>
        <div className="detail-card detail-wide">
          <RecentMatchesList
            recentMatches={historyLoaded ? historyPage.matches : []}
            playerName={player.displayName}
            emptyMessage={historyPage.loading ? 'Loading match history.' : historyPage.error ??
              (historyLoaded ? 'No recent match history found.' : recentHistoryEmptyMessage(displayedProfile))}
            total={historyLoaded ? historyPage.total : undefined}
            loading={historyPage.loading}
            error={historyPage.error}
            onLoadMore={historyLoaded ? () => void loadHistoryPage(historyPage.page + 1) : undefined}
          />
        </div>
        <div className="detail-card detail-full">
          <BestUmasList
            bestUmas={displayedProfile?.bestUmas}
            playerName={player.displayName}
            emptyMessage={statsMessage}
          />
        </div>
      </div>

      <p className={note === undefined ? 'player-note empty' : 'player-note'}>{note ?? ' '}</p>
    </section>
  );
}

export function withDetailHistory(
  profile: PlayerProfileSummary | undefined, firstPageMatches: PlayerRecentMatchSummary[],
  total: number, summary?: PlayerProfileSummary['historySummary']
): PlayerProfileSummary | undefined {
  if (profile === undefined) return undefined;
  const recentMatches = firstPageMatches.filter(match =>
    ['confirmed', 'corrected', 'reported'].includes(match.verificationState)).slice(0, 5);
  const confirmed = recentMatches.filter(match => match.verificationState === 'confirmed');
  const matches = confirmed.length;
  const scoredMatches = confirmed.filter(match => match.pointsScored > 0).length;
  const wins = confirmed.filter(match => match.isWinner === true).length;
  const points = confirmed.reduce((sum, match) => sum + match.pointsScored, 0);
  return {
    ...profile, recentMatches, historyTotal: total, historySummary: summary,
    recentHistoryStatus: 'loaded',
    recentForm: {
      matches, scoredMatches, scoringRate: matches > 0 ? scoredMatches / matches : null,
      wins, winRate: matches > 0 ? wins / matches : null, points,
      pointsPerGame: matches > 0 ? points / matches : null,
      podiums: confirmed.reduce((sum, match) => sum + match.podiums, 0),
      mvpMatches: confirmed.filter(match => match.isMvp).length
    }
  };
}

export function getLookupDiscordId(player: PrematchPlayer): string | undefined {
  return /^\d{16,20}$/.test(player.discordId) ? player.discordId : undefined;
}

export function StatCell({
  label,
  value,
  title,
  variant
}: {
  label: string;
  value: string;
  title: string;
  variant?: 'record';
}) {
  return (
    <span className={variant === 'record' ? 'stat-cell record-stat-cell' : 'stat-cell'} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

export function ProfileDataStatus({
  discordId,
  profile,
  isProfileLoading,
  now
}: {
  discordId: string | undefined;
  profile: PlayerProfileSummary | undefined;
  isProfileLoading: boolean;
  now: number;
}) {
  const status = getProfileDataStatus(discordId, profile, isProfileLoading, now);

  return (
    <div className={`profile-data-status ${status.tone}`}>
      <span>{status.label}</span>
    </div>
  );
}

export function getDisplayedProfileStats(
  profile: PlayerProfileSummary | undefined,
  statsScope: PlayerStatsScope
): PlayerProfileSummary | undefined {
  if (profile === undefined) {
    return undefined;
  }

  const stats = statsScope === 'allTime' ? profile.allTimeStats : profile.currentSeasonStats;

  if (stats === undefined) {
    return profile;
  }

  return {
    ...profile,
    ...stats,
    statsScope,
    ...(profile.scopeFetchedAt && profile.scopeFetchedAt[statsScope] === undefined ? { matches: null, wins: null, losses: null, winRate: null, points: null, pointsPerGame: null, mvpMatches: null, allUmas: [], bestUmas: [], topUmas: [], recentMatches: [], recentHistoryStatus: 'unavailable' as const } : {})
  };
}

export function getProfileDataStatus(
  discordId: string | undefined,
  profile: PlayerProfileSummary | undefined,
  isProfileLoading: boolean,
  now: number
): { label: string; tone: 'fresh' | 'loading' | 'warning' | 'muted' } {
  if (discordId === undefined) {
    return {
      label: 'Profile link unavailable from room page',
      tone: 'muted'
    };
  }

  if (isProfileLoading) {
    return {
      label: 'Refreshing profile data',
      tone: 'loading'
    };
  }

  if (profile === undefined) {
    return {
      label: 'Profile data not loaded yet',
      tone: 'muted'
    };
  }

  if (profile.statsPrivate === true && !hasDisplayableProfileLists(profile)) {
    return {
      label: `Stats private - checked ${formatRelativeAge(profile.fetchedAt, now)}`,
      tone: 'warning'
    };
  }

  if (profile.error !== undefined) {
    return {
      label: `Profile unavailable - checked ${formatRelativeAge(profile.fetchedAt, now)}`,
      tone: 'warning'
    };
  }

  return {
    label: `Profile data current - updated ${formatRelativeAge(profile.fetchedAt, now)}`,
    tone: 'fresh'
  };
}

export function getPlayerNote(
  profile: PlayerProfileSummary | undefined,
  discordId: string | undefined
): string | undefined {
  if (discordId === undefined) {
    return 'Open their Uma profile once available to scout detailed stats.';
  }

  if (profile === undefined) {
    return 'Profile data has not loaded yet.';
  }

  if (profile.statsPrivate === true && !hasDisplayableProfileLists(profile)) {
    return 'Stats are private.';
  }

  if (profile.error === undefined) return undefined;
  if (/API paused|HTTP (429|5\d\d)/.test(profile.error)) return 'The stats API is temporarily unavailable. Check Diagnostics for the retry status.';
  if (/timed out/i.test(profile.error)) return 'Stats request timed out. You can retry with Refresh.';
  return 'Some profile data could not load. See Diagnostics for details.';
}

export function getStatsMessage(
  displayedProfile: PlayerProfileSummary | undefined,
  profile: PlayerProfileSummary | undefined,
  isProfileLoading: boolean,
  discordId: string | undefined
): string | undefined {
  if (isProfileLoading && discordId !== undefined) {
    return 'Loading ranked Uma stats.';
  }

  if (discordId === undefined) {
    return 'Profile lookup is unavailable from this room page.';
  }

  if (profile?.statsPrivate === true && !hasDisplayableProfileLists(displayedProfile)) {
    return 'Ranked Uma stats are private.';
  }

  if (profile?.error !== undefined) {
    return 'Unable to load ranked Uma stats.';
  }

  if (profile === undefined) {
    return 'Profile data has not loaded yet.';
  }

  return undefined;
}
