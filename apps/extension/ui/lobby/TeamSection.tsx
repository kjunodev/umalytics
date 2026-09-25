import { useMemo } from 'react';
import type { PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchTeam } from '@umalytics/shared';
import './lobby.css';
import { BadgeChipRow } from './BadgeChip';
import { getNotableBadges, hasDisplayableProfileLists } from '../common/badges';
import { formatDecimal, formatNumber, formatPercent, formatRank, formatRecord } from '../common/format';
import { TEAM_SLOT_COUNT, getPlayerKey } from '../common/roster';
import type { PartyVisual } from '../common/partyVisuals';
import { getPlayerPartyVisual, getTeamPartyVisuals } from '../common/partyVisuals';
import { StatCell, getDisplayedProfileStats, getLookupDiscordId, getPlayerNote, getStatsMessage } from '../player/playerProfileDisplay';
import { TopUmasList, UmaResolutionNote } from '../player/TopUmasList';
import { IS_PRIVATE_BUILD } from '../scoutData';

export type CardState = 'loading' | 'private' | 'estimated' | 'error' | 'loaded';

export function TeamSection({
  team,
  profiles,
  loadingDiscordIds,
  statsScope,
  onSelectPlayer,
  selectedPlayerKey,
  onRetryProfile,
  canRetryProfile = false
}: {
  team: PrematchTeam;
  profiles: Record<string, PlayerProfileSummary>;
  loadingDiscordIds: string[];
  statsScope: PlayerStatsScope;
  onSelectPlayer: (playerKey: string) => void;
  selectedPlayerKey?: string;
  onRetryProfile?: () => void;
  canRetryProfile?: boolean;
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
  partyVisual?: PartyVisual;
  isSelected?: boolean;
  onRetryProfile?: () => void;
  canRetryProfile?: boolean;
  onShowDetails: () => void;
}) {
  const displayedProfile = getCardProfile(profile, statsScope);
  const rating = profile?.conservativeRating ?? profile?.rating ?? player.displayRatingSnapshot ?? player.ratingSnapshot;
  const discordId = getLookupDiscordId(player);
  const note = getPlayerNote(profile, discordId);
  const statsMessage = getStatsMessage(displayedProfile, profile, isProfileLoading, discordId);
  const notableBadges = getNotableBadges(displayedProfile);
  const isCaptain = player.isCaptain === true || player.role === 'captain';
  const displayName = profile?.displayName ?? player.displayName;
  const cardState = getCardState(profile, displayedProfile, isProfileLoading, discordId);
  const isRefreshing = cardState === 'loaded' && isProfileLoading && discordId !== undefined;
  const estimatedFrom = profile?.historyTotal ?? profile?.matches ?? undefined;

  return (
    <li className={getPlayerRowClassName(partyVisual, isSelected)}>
      <button type="button" className="card-hit" onClick={onShowDetails} aria-label={`Open details for ${displayName}`} />
      <div className="card-name-row">
        <span className="card-name" title={displayName}>{displayName}</span>
        {isCaptain ? <CaptainCrown /> : null}
        <div className="card-name-spacer" />
        {partyVisual === undefined ? null : (
          <span className={`identity-tag ${partyVisual.className}`} title={partyVisual.title}>
            {partyVisual.label}
          </span>
        )}
        {cardState === 'estimated' ? (
          <span className="card-est-chip" title="Estimated from recent match history, not the profile API.">
            {estimatedFrom === undefined ? 'Estimated' : `Est. · ${estimatedFrom}`}
          </span>
        ) : null}
      </div>
      {cardState === 'loading' ? (
        <span className="card-skel card-skel-line" aria-hidden="true" />
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
        <div className="scouting-grid compact-scouting-grid" aria-hidden="true">
          <span className="card-skel" style={{ height: 38 }} />
          <span className="card-skel" style={{ height: 38 }} />
          <span className="card-skel" style={{ height: 38 }} />
          <span className="card-skel" style={{ height: 38 }} />
        </div>
        <div className="card-uma-skel" aria-hidden="true">
          <span className="card-skel" style={{ height: 12 }} />
          <span className="card-skel" style={{ height: 12, width: '80%' }} />
          <span className="card-skel" style={{ height: 12, width: '70%' }} />
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
      {state === 'estimated' ? (
        <span className="card-estimated-note">Estimated from recent match history</span>
      ) : (
        <>
          {statsMessage === 'Profile data has not loaded yet.' ? (
            <div className="card-message-box"><span className="card-message-title">{statsMessage}</span></div>
          ) : (
            <>
              <TopUmasList topUmas={displayedProfile?.topUmas} playerName={player.displayName} emptyMessage={statsMessage} />
              <UmaResolutionNote profile={displayedProfile} />
            </>
          )}
        </>
      )}
      {state !== 'estimated' && note !== undefined && note !== statsMessage ? <p className="player-note">{note}</p> : null}
    </>
  );
}

export function getCardState(
  profile: PlayerProfileSummary | undefined,
  displayedProfile: PlayerProfileSummary | undefined,
  isProfileLoading: boolean,
  discordId: string | undefined,
  privateBuild = IS_PRIVATE_BUILD
): CardState {
  if (discordId === undefined) {
    return 'loaded';
  }

  if (profile === undefined) {
    return isProfileLoading ? 'loading' : 'loaded';
  }

  if (profile.statsPrivate === true && !hasDisplayableProfileLists(displayedProfile)) {
    return privateBuild && profile.historyDerived === true ? 'estimated' : 'private';
  }

  if (profile.error !== undefined && !hasDisplayableProfileLists(displayedProfile)) {
    return 'error';
  }

  return 'loaded';
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
