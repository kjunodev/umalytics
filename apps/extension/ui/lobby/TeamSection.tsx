import { useMemo } from 'react';
import type { PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchTeam } from '@umalytics/shared';
import { getNotableBadges } from '../common/badges';
import { formatDecimal, formatNumber, formatPercent, formatRank, formatRecord } from '../common/format';
import { TEAM_SLOT_COUNT, getPlayerKey } from '../common/roster';
import type { PartyVisual } from '../common/partyVisuals';
import { getPlayerPartyVisual, getPlayerRowClassName, getTeamPartyVisuals } from '../common/partyVisuals';
import { StatCell, getDisplayedProfileStats, getLookupDiscordId, getPlayerNote, getStatsMessage } from '../player/PlayerDetailScene';
import { TopUmasList, UmaResolutionNote } from '../player/TopUmasList';
import { IS_PRIVATE_BUILD } from '../scoutData';

export function TeamSection({
  team,
  profiles,
  loadingDiscordIds,
  statsScope,
  onSelectPlayer
}: {
  team: PrematchTeam;
  profiles: Record<string, PlayerProfileSummary>;
  loadingDiscordIds: string[];
  statsScope: PlayerStatsScope;
  onSelectPlayer: (playerKey: string) => void;
}) {
  const playerSlots = Array.from({ length: Math.max(TEAM_SLOT_COUNT, team.players.length) }, (_, index) => team.players[index]);
  const partyVisuals = useMemo(() => getTeamPartyVisuals(team.players), [team.players]);

  return (
    <section className="team-section">
      <header className="team-header">
        <div>
          <h2>{team.name ?? team.id}</h2>
          <p>{Math.min(team.players.length, TEAM_SLOT_COUNT)}/{TEAM_SLOT_COUNT} players</p>
        </div>
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
              partyVisual={getPlayerPartyVisual(player, partyVisuals)}
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
  partyVisual,
  onShowDetails
}: {
  player: PrematchPlayer;
  profile?: PlayerProfileSummary;
  isProfileLoading: boolean;
  statsScope: PlayerStatsScope;
  partyVisual?: PartyVisual;
  onShowDetails: () => void;
}) {
  const displayedProfile = getCardProfile(profile, statsScope);
  const rating = profile?.conservativeRating ?? profile?.rating ?? player.displayRatingSnapshot ?? player.ratingSnapshot;
  const discordId = getLookupDiscordId(player);
  const profileUrl = profile?.profileUrl ?? player.profileUrl;
  const note = getPlayerNote(profile, discordId);
  const statsMessage = getStatsMessage(displayedProfile, profile, isProfileLoading, discordId);
  const notableBadges = getNotableBadges(displayedProfile);
  const isCaptain = player.isCaptain === true || player.role === 'captain';
  const displayName = profile?.displayName ?? player.displayName;

  return (
    <li className={getPlayerRowClassName(partyVisual)}>
      <div className="player-main">
        {profileUrl === undefined ? (
          <span className="player-name-row">
            <span className="player-identity">
              <span className="player-name" title={displayName}>{displayName}</span>
            </span>
            <span className="player-actions">
              {isCaptain ? <CaptainCrown /> : null}
              <button type="button" className="expand-button" onClick={onShowDetails}>
                Details
              </button>
              {isProfileLoading && discordId !== undefined ? (
                <span className="player-inline-status">Refreshing</span>
              ) : null}
            </span>
          </span>
        ) : (
          <span className="player-name-row">
            <span className="player-identity">
              <a className="player-name" href={profileUrl} target="_blank" rel="noreferrer" title={displayName}>
                {displayName}
              </a>
            </span>
            <span className="player-actions">
              {isCaptain ? <CaptainCrown /> : null}
              <button type="button" className="expand-button" onClick={onShowDetails}>
                Details
              </button>
              {isProfileLoading && discordId !== undefined ? (
                <span className="player-inline-status">Refreshing</span>
              ) : null}
            </span>
          </span>
        )}
        <span className="player-id">{discordId ?? 'Profile unavailable from room page'}</span>
      </div>
      <div className="player-meta">
        <span className="player-rank-line">
          <span>{formatRank(profile, isProfileLoading && discordId !== undefined)}</span>
          <span>{rating === undefined || rating === null ? 'Rating unknown' : `${rating} rating`}</span>
        </span>
        <span className="player-badge-row">
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
        playerName={player.displayName}
        emptyMessage={statsMessage}
      />
      <UmaResolutionNote profile={displayedProfile} />
      <p className={note === undefined ? 'player-note empty' : 'player-note'}>{note ?? ' '}</p>
    </li>
  );
}

export function getCardProfile(
  profile: PlayerProfileSummary | undefined, statsScope: PlayerStatsScope, privateBuild = IS_PRIVATE_BUILD
): PlayerProfileSummary | undefined {
  const selectedProfile = getDisplayedProfileStats(profile, statsScope);
  return privateBuild || selectedProfile === undefined ? selectedProfile : {
    ...selectedProfile, recentMatches: [], recentForm: undefined,
    historyTotal: undefined, historySummary: undefined
  };
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

export function EmptyPlayerSlot({ slotNumber }: { slotNumber: number }) {
  return (
    <li className="player-row empty-player-row">
      <div className="player-main">
        <span className="player-name">Waiting for player</span>
        <span className="player-id">Slot {slotNumber}</span>
      </div>
      <div className="player-meta">
        <span>Open slot</span>
      </div>
      <div className="scouting-grid compact-scouting-grid" aria-label={`Empty player slot ${slotNumber}`}>
        <StatCell label="W-L" value="-" title="No player in this slot yet." variant="record" />
        <StatCell label="Win" value="-" title="No player in this slot yet." />
        <StatCell label="PPG" value="-" title="No player in this slot yet." />
        <StatCell label="MVP" value="-" title="No player in this slot yet." />
      </div>
      <TopUmasList playerName={`empty slot ${slotNumber}`} emptyMessage="Waiting for player." />
      <p className="player-note empty"> </p>
    </li>
  );
}
