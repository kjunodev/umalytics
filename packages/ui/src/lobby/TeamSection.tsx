import { useMemo } from 'react';
import type { EsportsTeamIcon, EsportsTeamIconMap, PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchTeam } from '@umalytics/shared';
import './lobby.css';
import { BadgeChipRow } from './BadgeChip';
import { getNotableBadges, hasDisplayableProfileLists } from '../common/badges';
import { formatDecimal, formatNumber, formatPercent, formatRank, formatRecord } from '../common/format';
import { TEAM_SLOT_COUNT, getPlayerKey } from '../common/roster';
import type { PartyVisual } from '../common/partyVisuals';
import { getPlayerPartyVisual, getTeamPartyVisuals } from '../common/partyVisuals';
import { TeamIcon } from '../common/TeamIcon';
import { StatCell, getDisplayedProfileStats, getLookupDiscordId, getPlayerNote, getStatsMessage } from '../player/playerProfileDisplay';
import { TopUmasList, UmaResolutionNote } from '../player/TopUmasList';

export type CardState = 'loading' | 'private' | 'error' | 'unavailable' | 'loaded';

export function TeamSection({
  team,
  profiles,
  loadingDiscordIds,
  statsScope,
  teamIcons = {},
  onSelectPlayer,
  selectedPlayerKey,
  onRetryProfile,
  canRetryProfile = false
}: {
  team: PrematchTeam;
  profiles: Record<string, PlayerProfileSummary>;
  loadingDiscordIds: string[];
  statsScope: PlayerStatsScope;
  teamIcons?: EsportsTeamIconMap;
  onSelectPlayer: (playerKey: string) => void;
  selectedPlayerKey?: string;
  onRetryProfile?: () => void;
  canRetryProfile?: boolean;
}) {
  const playerSlots = Array.from({ length: Math.max(TEAM_SLOT_COUNT, team.players.length) }, (_, index) => team.players[index]);
  const partyVisuals = useMemo(() => getTeamPartyVisuals(team.players), [team.players]);
  const averageRating = getTeamAverageRating(team, profiles);

  return (
    <section className={`team-section ${team.id}`}>
      <header className="team-header">
        <span className="team-header-accent" aria-hidden="true" />
        <h2>{team.name ?? team.id}</h2>
        <span className="team-header-count">{Math.min(team.players.length, TEAM_SLOT_COUNT)}/{TEAM_SLOT_COUNT} players</span>
        <span className="team-header-divider" aria-hidden="true" />
        <span className="team-header-avg">
          Avg rating <strong>{averageRating === undefined ? '—' : formatNumber(averageRating)}</strong>
        </span>
      </header>

      <ol className="player-list">
        {playerSlots.map((player, index) => (
          player === undefined ? (
            <EmptyPlayerSlot key={`${team.id}:empty:${index}`} slotNumber={index + 1} />
          ) : (
            <PlayerRow
              key={getPlayerKey(player)}
              player={player}
              profile={profiles[player.discordId]}
              isProfileLoading={loadingDiscordIds.includes(player.discordId)}
              statsScope={statsScope}
              teamIcon={teamIcons[player.discordId]}
              partyVisual={getPlayerPartyVisual(player, partyVisuals)}
              isSelected={selectedPlayerKey === getPlayerKey(player)}
              onRetryProfile={onRetryProfile}
              canRetryProfile={canRetryProfile}
              onShowDetails={() => {
                onSelectPlayer(getPlayerKey(player));
              }}
            />
          )
        ))}
      </ol>
    </section>
  );
}

export function PlayerRow({
  player,
  profile,
  isProfileLoading,
  statsScope,
  teamIcon,
  partyVisual,
  isSelected = false,
  onRetryProfile,
  canRetryProfile = false,
  onShowDetails
}: {
  player: PrematchPlayer;
  profile?: PlayerProfileSummary;
  isProfileLoading: boolean;
  statsScope: PlayerStatsScope;
  teamIcon?: EsportsTeamIcon;
  partyVisual?: PartyVisual;
  isSelected?: boolean;
  onRetryProfile?: () => void;
  canRetryProfile?: boolean;
  onShowDetails: () => void;
}) {
  const displayedProfile = getCardProfile(profile, statsScope);
  const rating = getPlayerDisplayRating(player, profile);
  const discordId = getLookupDiscordId(player);
  const note = getPlayerNote(profile, discordId);
  const statsMessage = getStatsMessage(displayedProfile, profile, isProfileLoading, discordId);
  const notableBadges = getNotableBadges(displayedProfile);
  const isCaptain = player.isCaptain === true || player.role === 'captain';
  const displayName = profile?.displayName ?? player.displayName;
  const cardState = getCardState(profile, displayedProfile, isProfileLoading, discordId);
  const isRefreshing = cardState === 'loaded' && isProfileLoading && discordId !== undefined;

  return (
    <li className={getPlayerRowClassName(partyVisual, isSelected)}>
      <button type="button" className="card-hit" onClick={onShowDetails} aria-label={`Open details for ${displayName}`} />
      <div className="card-name-row">
        <span className="card-name" title={displayName}>{displayName}</span>
        {isCaptain ? <CaptainCrown /> : null}
        {teamIcon === undefined ? null : <TeamIcon icon={teamIcon} />}
        <div className="card-name-spacer" />
        {partyVisual === undefined ? null : (
          <span className={`identity-tag ${partyVisual.className}`} title={partyVisual.title}>
            {partyVisual.label}
          </span>
        )}
      </div>
      {cardState === 'loading' ? (
        <span className="player-rank-line" aria-hidden="true">
          <span className="card-skel card-skel-line" />
        </span>
      ) : cardState === 'unavailable' ? (
        <span className="player-rank-line">
          <span>Profile unavailable</span>
        </span>
      ) : (
        <span className="player-rank-line">
          <span>{formatRank(profile, isProfileLoading && discordId !== undefined)}</span>
          <span>{rating === undefined || rating === null ? 'Rating unknown' : `${rating} rating`}</span>
          {isRefreshing ? <span className="card-refresh-pill">Refreshing</span> : null}
        </span>
      )}
      <CardBody
        state={cardState}
        player={player}
        displayedProfile={displayedProfile}
        notableBadges={notableBadges}
        note={note}
        statsMessage={statsMessage}
        onRetryProfile={onRetryProfile}
        canRetryProfile={canRetryProfile}
      />
    </li>
  );
}

function CardBody({
  state,
  player,
  displayedProfile,
  notableBadges,
  note,
  statsMessage,
  onRetryProfile,
  canRetryProfile
}: {
  state: CardState;
  player: PrematchPlayer;
  displayedProfile: PlayerProfileSummary | undefined;
  notableBadges: ReturnType<typeof getNotableBadges>;
  note?: string;
  statsMessage?: string;
  onRetryProfile?: () => void;
  canRetryProfile: boolean;
}) {
  if (state === 'loading') {
    return (
      <>
        <div className="card-badges" aria-hidden="true">
          <span className="card-skel" style={{ width: 62, height: 22 }} />
          <span className="card-skel" style={{ width: 76, height: 22 }} />
        </div>
        {/* height matches a real .stat-cell's rendered height (padding plus its
            two text lines), so the loading card is the same height as a loaded one. */}
        <div className="scouting-grid compact-scouting-grid" aria-hidden="true">
          <span className="card-skel" style={{ height: 41.390625 }} />
          <span className="card-skel" style={{ height: 41.390625 }} />
          <span className="card-skel" style={{ height: 41.390625 }} />
          <span className="card-skel" style={{ height: 41.390625 }} />
        </div>
        <div className="top-umas" aria-hidden="true">
          <p>Most Played</p>
          <div className="top-umas-rows-skel">
            <span className="card-skel" />
            <span className="card-skel" />
            <span className="card-skel" />
          </div>
        </div>
      </>
    );
  }

  if (state === 'private') {
    return (
      <div className="card-message-box">
        <LockIcon />
        <span className="card-message-title">Stats are private</span>
        <span className="card-message-subtitle">Open details for match history</span>
      </div>
    );
  }

  if (state === 'unavailable') {
    // No Discord ID in the room data, so there is nothing to look up (and no request is made).
    return (
      <div className="card-message-box">
        <span className="card-message-title">No Discord account</span>
        <span className="card-message-subtitle">Stats can&apos;t be looked up for this player</span>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="card-message-box">
        <span className="card-message-title">Couldn&apos;t load stats</span>
        <span className="card-message-subtitle">{note ?? 'Something went wrong loading this profile.'}</span>
        {onRetryProfile === undefined ? null : (
          <button type="button" className="card-retry-button" disabled={!canRetryProfile} onClick={onRetryProfile}>
            Retry now
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <BadgeChipRow badges={notableBadges} />
      <div className="scouting-grid compact-scouting-grid" aria-label={`${player.displayName} scouting summary`}>
        <StatCell
          label="W-L"
          value={formatRecord(displayedProfile)}
          title="Ranked win-loss record for the selected stat scope."
          variant="record"
        />
        <StatCell label="Win" value={formatPercent(displayedProfile?.winRate)} title="Ranked win rate for the selected stat scope." />
        <StatCell label="PPG" value={formatDecimal(displayedProfile?.pointsPerGame)} title="Average ranked points per game for the selected stat scope." />
        <StatCell label="MVP" value={formatNumber(displayedProfile?.mvpMatches)} title="Total ranked MVP games for the selected stat scope." />
      </div>
      <TopUmasList
        topUmas={displayedProfile?.topUmas}
        allUmas={displayedProfile?.allUmas}
        playerName={player.displayName}
        emptyMessage={statsMessage}
      />
      <UmaResolutionNote profile={displayedProfile} />
      {note !== undefined && note !== statsMessage ? <p className="player-note">{note}</p> : null}
    </>
  );
}

export function getCardState(
  profile: PlayerProfileSummary | undefined,
  displayedProfile: PlayerProfileSummary | undefined,
  isProfileLoading: boolean,
  discordId: string | undefined
): CardState {
  if (discordId === undefined) {
    return 'unavailable';
  }

  if (profile === undefined) {
    return isProfileLoading ? 'loading' : 'loaded';
  }

  if (profile.statsPrivate === true && !hasDisplayableProfileLists(displayedProfile)) {
    return 'private';
  }

  if (profile.error !== undefined && !hasDisplayableProfileLists(displayedProfile)) {
    return 'error';
  }

  return 'loaded';
}

export function getCardProfile(
  profile: PlayerProfileSummary | undefined, statsScope: PlayerStatsScope
): PlayerProfileSummary | undefined {
  const selectedProfile = getDisplayedProfileStats(profile, statsScope);
  return selectedProfile === undefined ? selectedProfile : {
    ...selectedProfile, recentMatches: [],
    historyTotal: undefined, historySummary: undefined
  };
}

export function getPlayerDisplayRating(player: PrematchPlayer, profile: PlayerProfileSummary | undefined): number | undefined {
  return profile?.conservativeRating ?? profile?.rating ?? player.displayRatingSnapshot ?? player.ratingSnapshot;
}

export function getTeamAverageRating(team: PrematchTeam, profiles: Record<string, PlayerProfileSummary>): number | undefined {
  const ratings = team.players
    .map((player) => getPlayerDisplayRating(player, profiles[player.discordId]))
    .filter((rating): rating is number => rating !== undefined && rating !== null);

  if (ratings.length === 0) {
    return undefined;
  }

  return Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length);
}

export function getPlayerRowClassName(partyVisual?: PartyVisual, isSelected = false): string {
  const classes = ['player-row'];

  if (partyVisual !== undefined) {
    classes.push(partyVisual.className);
  }

  if (isSelected) {
    classes.push('is-selected');
  }

  return classes.join(' ');
}

export function CaptainCrown() {
  return (
    <span className="captain-crown" title="Captain" aria-label="Captain">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3.8 8.8 8.7 13.2 12 5.8l3.3 7.4 4.9-4.4-1.8 9.1H5.6L3.8 8.8Z" />
      </svg>
    </span>
  );
}

function LockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10V7.5a3 3 0 016 0V10" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function EmptyPlayerSlot({ slotNumber }: { slotNumber: number }) {
  return (
    <li className="player-row empty-player-row">
      <div className="card-name-row">
        <span className="card-name">Waiting for player</span>
      </div>
      <div className="card-message-box">
        <span className="card-message-subtitle">Slot {slotNumber}</span>
      </div>
    </li>
  );
}
