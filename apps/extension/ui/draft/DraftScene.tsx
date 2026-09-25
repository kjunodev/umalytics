import { useEffect, useState, type ReactNode } from 'react';
import './draft.css';
import type {
  DraftSnapshot,
  DraftTeamSnapshot,
  DraftTiebreakerMap,
  DraftUmaAction,
  PlayerProfileSummary,
  PlayerStatsScope,
  PlayerTopUmaSummary,
  PrematchPlayer,
  PrematchRoster
} from '@umalytics/shared';
import { getUmaPortraitUrl, isKnownUmaOutfitId } from '../../umas/umaPortraits';
import { UmaImage } from '../common/UmaImage';
import { formatDecimal, formatPercent } from '../common/format';
import { TEAM_IDS, TEAM_SLOT_COUNT, getDraftRosterPlayersForTeam, getDraftSlots } from '../common/roster';
import { findScopedUmaEntry, getUmaExperience } from '../umas/umaCatalog';
import {
  buildDraftRaceCards,
  formatDraftMapDetails,
  formatDraftStatusText,
  formatRaceDistance,
  formatRaceTrackName,
  formatTeamName,
  getDraftGroundChip,
  getDraftInitialPickCount,
  getDraftRaceSlotCount,
  getDraftSeasonChip,
  getDraftStageIndex,
  getDraftStages,
  getDraftSurfaceChip,
  getDraftVetoedMaps,
  getDraftWeatherChip,
  getDraftWeatherIconKey,
  hasStructuredRaceModifiers,
  type DraftRaceCard,
  type DraftRaceMapFields,
  type DraftVetoedMap
} from './draftFormat';

export const DRAFT_MAP_SLOT_COUNT = 4;

export const DRAFT_PICK_SLOT_COUNT = 6;

export const DRAFT_BAN_SLOT_COUNT = 2;

export const DRAFT_VETO_SLOT_COUNT = 1;

export const DRAFT_MAP_VETO_COUNT = 1;

export function DraftScene({
  snapshot,
  roster,
  profiles,
  statsScope,
  historical = false
}: {
  historical?: boolean;
  snapshot: DraftSnapshot | undefined;
  roster: PrematchRoster | undefined;
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
}) {
  if (snapshot === undefined) {
    return (
      <section className="empty-state">
        <h2>No draft data detected</h2>
        <p>Open an active Uma Drafter draft to mirror maps, picks, and bans.</p>
      </section>
    );
  }

  const initialPickCount = getDraftInitialPickCount(snapshot.rules, DRAFT_PICK_SLOT_COUNT);
  const stageIndex = getDraftStageIndex(snapshot, initialPickCount);
  const raceSlotCount = getDraftRaceSlotCount(snapshot.rules, DRAFT_MAP_SLOT_COUNT, DRAFT_MAP_VETO_COUNT);
  const races = buildDraftRaceCards(snapshot.teams, raceSlotCount);
  const vetoedMaps = getDraftVetoedMaps(snapshot.teams);

  return (
    <section className="draft-scene" aria-label={historical ? 'Completed draft view' : 'Live draft view'}>
      <DraftPhaseBar snapshot={snapshot} historical={historical} initialPickCount={initialPickCount} stageIndex={stageIndex} />

      <div className="draft-columns">
        <DraftTeamPanel
          team={snapshot.teams.team1}
          rules={snapshot.rules}
          rosterPlayers={getDraftRosterPlayersForTeam(roster, 'team1')}
          profiles={profiles}
          statsScope={statsScope}
          historical={historical}
          isCurrentTeam={!historical && snapshot.currentTeam === 'team1'}
        />
        <DraftRacesPanel
          teams={snapshot.teams}
          races={races}
          tiebreakerMap={snapshot.tiebreakerMap}
          vetoedMaps={vetoedMaps}
        />
        <DraftTeamPanel
          team={snapshot.teams.team2}
          rules={snapshot.rules}
          rosterPlayers={getDraftRosterPlayersForTeam(roster, 'team2')}
          profiles={profiles}
          statsScope={statsScope}
          historical={historical}
          isCurrentTeam={!historical && snapshot.currentTeam === 'team2'}
        />
      </div>
    </section>
  );
}

export function DraftPhaseBar({
  snapshot,
  historical,
  initialPickCount,
  stageIndex
}: {
  snapshot: DraftSnapshot;
  historical: boolean;
  initialPickCount: number;
  stageIndex: number;
}) {
  const statusText = historical ? undefined : formatDraftStatusText(snapshot, stageIndex, DRAFT_PICK_SLOT_COUNT);
  const stages = getDraftStages(initialPickCount);

  return (
    <div className="draft-phase-bar">
      <span className="draft-phase-dot" aria-hidden="true" />
      <strong className="draft-phase-title">{stages[stageIndex]?.label ?? 'Draft'}</strong>
      {statusText === undefined ? null : <span className="draft-phase-status">{statusText}</span>}
      <div className="draft-phase-bar-spacer" />
      <DraftStageTrack stages={stages} stageIndex={stageIndex} />
    </div>
  );
}

export function DraftStageTrack({ stages, stageIndex }: { stages: { key: string; label: string }[]; stageIndex: number }) {
  const items: ReactNode[] = [];

  stages.forEach((stage, index) => {
    if (index > 0) {
      items.push(<li key={`sep:${stage.key}`} className="draft-stage-sep" aria-hidden="true" />);
    }

    const status = index < stageIndex ? 'done' : index === stageIndex ? 'current' : 'pending';

    items.push(
      <li
        key={stage.key}
        className={`draft-stage ${status}`}
        aria-current={index === stageIndex ? 'step' : undefined}
      >
        <span className="draft-stage-marker">{status === 'done' ? '✓' : index + 1}</span>
        {stage.label}
      </li>
    );
  });

  return (
    <ol className="draft-stage-track" aria-label="Draft stages">
      {items}
    </ol>
  );
}

export function DraftTeamPanel({
  team,
  rules,
  rosterPlayers,
  profiles,
  statsScope,
  historical,
  isCurrentTeam
}: {
  team: DraftTeamSnapshot;
  rules?: DraftSnapshot['rules'];
  rosterPlayers: PrematchPlayer[];
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
  historical: boolean;
  isCurrentTeam: boolean;
}) {
  const picks = team.umas.filter((uma) => uma.kind === 'pick');
  const bans = team.umas.filter((uma) => uma.kind === 'ban');
  const vetoes = team.umas.filter((uma) => uma.kind === 'veto');
  const pickSignature = picks.map(getDraftActionKey).join('|');
  const [selectedPickKey, setSelectedPickKey] = useState<string | undefined>();

  useEffect(() => {
    const latestPick = picks.at(-1);

    setSelectedPickKey(latestPick === undefined ? undefined : getDraftActionKey(latestPick));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickSignature]);

  const selectedPick = picks.find((pick) => getDraftActionKey(pick) === selectedPickKey);

  return (
    <article className={`draft-team-panel ${team.id}`}>
      <header className="draft-team-header">
        <h2>{formatTeamName(team)}</h2>
        {isCurrentTeam ? <span className="draft-picking-badge">Picking</span> : null}
        <div className="draft-team-header-spacer" />
        <span className="draft-team-pick-count">{picks.length}/{DRAFT_PICK_SLOT_COUNT} picks</span>
      </header>

      <ol className="draft-pick-grid">
        {getDraftSlots(picks, DRAFT_PICK_SLOT_COUNT).map((action, index) =>
          action === undefined ? (
            <DraftPickPlaceholder
              key={`pick-placeholder:${index}`}
              isNext={isCurrentTeam && index === picks.length}
            />
          ) : (
            <DraftPickTile
              key={getDraftActionKey(action)}
              action={action}
              experienceCount={getUmaExperience(action, rosterPlayers, profiles, statsScope).length}
              isSelected={getDraftActionKey(action) === selectedPickKey}
              onSelect={() => setSelectedPickKey(getDraftActionKey(action))}
            />
          )
        )}
      </ol>

      <div className="draft-ban-veto-rows">
        {getDraftSlots(bans, rules?.bans ?? DRAFT_BAN_SLOT_COUNT).map((action, index) => (
          <DraftBanVetoRow key={`ban:${index}`} kind="ban" action={action} />
        ))}
        {getDraftSlots(vetoes, rules?.vetoes ?? DRAFT_VETO_SLOT_COUNT).map((action, index) => (
          <DraftBanVetoRow key={`veto:${index}`} kind="veto" action={action} />
        ))}
      </div>

      <DraftPickExperiencePanel
        action={selectedPick}
        rosterPlayers={rosterPlayers}
        profiles={profiles}
        statsScope={statsScope}
      />
    </article>
  );
}

export function DraftPickTile({
  action,
  experienceCount,
  isSelected,
  onSelect
}: {
  action: DraftUmaAction;
  experienceCount: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const imageUrl = (action.umaId !== undefined && isKnownUmaOutfitId(action.umaId)
    ? getUmaPortraitUrl(action.umaId) : undefined) ?? action.imageUrl;

  return (
    <li className={`draft-pick-tile ${isSelected ? 'selected' : ''}`}>
      <button type="button" onClick={onSelect} aria-pressed={isSelected} title={action.name}>
        <span className="draft-pick-portrait">
          <UmaImage imageUrl={imageUrl} name={action.name} />
        </span>
        <span className="draft-pick-name">{action.name}</span>
        <span className={`draft-pick-exp ${experienceCount > 0 ? 'some' : 'none'}`}>
          {experienceCount > 0 ? `${experienceCount} played` : 'New'}
        </span>
      </button>
    </li>
  );
}

export function DraftPickPlaceholder({ isNext }: { isNext: boolean }) {
  return (
    <li className={`draft-pick-tile placeholder ${isNext ? 'next' : ''}`}>
      <span className="draft-pick-portrait empty" aria-hidden="true" />
      <small>{isNext ? 'Picking now' : 'Open pick'}</small>
    </li>
  );
}

export function DraftBanVetoRow({ kind, action }: { kind: 'ban' | 'veto'; action: DraftUmaAction | undefined }) {
  const label = kind === 'ban' ? 'Ban' : 'Veto';

  if (action === undefined) {
    return (
      <div className="draft-ban-veto-row">
        <span className="draft-ban-veto-label">{label}</span>
        <span className="draft-ban-veto-slot empty">Pending</span>
      </div>
    );
  }

  const imageUrl = action.imageUrl ?? (action.umaId === undefined ? undefined : getUmaPortraitUrl(action.umaId));

  return (
    <div className="draft-ban-veto-row">
      <span className="draft-ban-veto-label">{label}</span>
      <span className="draft-ban-veto-slot" aria-label={`${kind === 'ban' ? 'Banned' : 'Vetoed'}: ${action.name}`}>
        <span className="draft-ban-veto-avatar">
          <UmaImage imageUrl={imageUrl} name={action.name} />
        </span>
        <span className="draft-ban-veto-name">{action.name}</span>
      </span>
    </div>
  );
}

export function DraftPickExperiencePanel({
  action,
  rosterPlayers,
  profiles,
  statsScope
}: {
  action: DraftUmaAction | undefined;
  rosterPlayers: PrematchPlayer[];
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
}) {
  const playerSlots = getDraftSlots(rosterPlayers, TEAM_SLOT_COUNT);
  const rows = playerSlots.map((player, index) => {
    if (player === undefined) {
      return { key: `experience-slot:${index}`, displayName: '', experience: undefined };
    }

    return {
      key: `${player.discordId}:${player.userId}`,
      displayName: profiles[player.discordId]?.displayName ?? player.displayName,
      experience: action === undefined ? undefined : getUmaExperienceForPlayer(action, player, profiles, statsScope)
    };
  }).sort((left, right) => (right.experience?.matches ?? -1) - (left.experience?.matches ?? -1));

  return (
    <div className="draft-experience-panel">
      <div className="draft-experience-heading">
        <strong>{action?.name ?? 'Experience'}</strong>
      </div>
      <div className="draft-experience-row draft-experience-header">
        <span>Player</span>
        <span>GP</span>
        <span>WR</span>
        <span>PPG</span>
      </div>
      {action === undefined ? (
        <small className="draft-empty-history">Select a pick to see who on this team has played it.</small>
      ) : (
        rows.map((row) => (
          <div key={row.key} className={`draft-experience-row ${row.experience === undefined ? 'no-history' : ''}`}>
            <span title={row.displayName}>{row.displayName}</span>
            <span>{row.experience === undefined ? '—' : row.experience.matches}</span>
            <span>{row.experience === undefined ? '—' : formatPercent(row.experience.winRate)}</span>
            <span>{row.experience === undefined ? '—' : formatDecimal(row.experience.pointsPerGame)}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function getUmaExperienceForPlayer(
  action: DraftUmaAction,
  player: PrematchPlayer,
  profiles: Record<string, PlayerProfileSummary>,
  statsScope: PlayerStatsScope
): PlayerTopUmaSummary | undefined {
  return findScopedUmaEntry(action, profiles[player.discordId], statsScope);
}

export function DraftRacesPanel({
  teams,
  races,
  tiebreakerMap,
  vetoedMaps
}: {
  teams: DraftSnapshot['teams'];
  races: Array<DraftRaceCard | undefined>;
  tiebreakerMap: DraftTiebreakerMap | undefined;
  vetoedMaps: DraftVetoedMap[];
}) {
  return (
    <section className="draft-races-panel" aria-label="Races">
      <div className="draft-races-header">
        <h2>Races</h2>
        <div className="draft-races-header-spacer" />
        {TEAM_IDS.map((teamId) => (
          <span key={teamId} className={`draft-team-legend ${teamId}`}>
            <span className="draft-team-legend-dot" aria-hidden="true" />
            {formatTeamName(teams[teamId])}
          </span>
        ))}
      </div>
      <ol className="draft-race-list">
        {races.map((race, index) => (
          <DraftRaceCardItem
            key={race === undefined ? `race-placeholder:${index}` : `race:${race.n}`}
            race={race}
            n={index + 1}
            teamName={race === undefined || race.team === 'tiebreaker' ? undefined : formatTeamName(teams[race.team])}
          />
        ))}
        {tiebreakerMap === undefined ? null : (
          <DraftRaceCardItem race={{ n: 0, team: 'tiebreaker', tiebreaker: true, map: tiebreakerMap }} teamName={undefined} />
        )}
        {vetoedMaps.length === 0 ? null : (
          <>
            <li className="draft-vetoed-heading">Vetoed</li>
            {vetoedMaps.map((vetoed, index) => (
              <DraftVetoedMapRow key={`vetoed-map:${index}`} vetoed={vetoed} />
            ))}
          </>
        )}
      </ol>
    </section>
  );
}

export function DraftRaceCardItem({ race, n, teamName }: { race: DraftRaceCard | undefined; n?: number; teamName: string | undefined }) {
  if (race === undefined) {
    return (
      <li className="draft-race-card placeholder">
        <span className="draft-race-number">{n}</span>
        <span className="draft-race-pending">Pending race</span>
      </li>
    );
  }

  const map: DraftRaceMapFields = race.map;
  const distance = formatRaceDistance(map.distance);
  const structured = hasStructuredRaceModifiers(map);
  const weatherIconKey = getDraftWeatherIconKey(map.weather);

  return (
    <li
      className={`draft-race-card ${race.team}`}
      aria-label={`${race.tiebreaker ? 'Tiebreaker' : `Race ${n}, ${teamName} pick`}: ${formatRaceTrackName(map)}`}
    >
      <span className={`draft-race-number ${race.tiebreaker ? 'tiebreaker' : ''}`}>{race.tiebreaker ? 'TB' : n}</span>
      <div className="draft-race-title">
        <span className="draft-race-track">{formatRaceTrackName(map)}</span>
        {map.variant === undefined ? null : <span className="draft-race-layout">({map.variant})</span>}
        {distance === undefined ? null : <span className="draft-race-distance">{distance}</span>}
        <div className="draft-race-title-spacer" />
      </div>
      {structured ? (
        <div className="draft-race-mods">
          <DraftModChipView chip={getDraftSurfaceChip(map.surface)} />
          <DraftModChipView chip={getDraftSeasonChip(map.season)} />
          <DraftModChipView chip={getDraftWeatherChip(map.weather)} iconKey={weatherIconKey} />
          <DraftModChipView chip={getDraftGroundChip(map.ground)} />
        </div>
      ) : formatDraftMapDetails(map) === undefined ? null : (
        <p className="draft-race-details">{formatDraftMapDetails(map)}</p>
      )}
    </li>
  );
}

export function DraftVetoedMapRow({ vetoed }: { vetoed: DraftVetoedMap }) {
  const map = vetoed.map;
  const distance = formatRaceDistance(map.distance);

  return (
    <li
      className={`draft-vetoed-map-row ${vetoed.team}`}
      aria-label={`Vetoed: ${formatRaceTrackName(map)}${distance === undefined ? '' : `, ${distance}`}, picked by ${vetoed.team}`}
    >
      <span className="draft-vetoed-map-label">Veto</span>
      <span className="draft-vetoed-map-name">
        {formatRaceTrackName(map)}
        {distance === undefined ? null : ` (${distance})`}
      </span>
    </li>
  );
}

export function DraftModChipView({
  chip,
  iconKey
}: {
  chip: { label: string; tone: string } | undefined;
  iconKey?: 'sunny' | 'cloudy' | 'rainy' | 'snowy';
}) {
  if (chip === undefined) {
    return null;
  }

  return (
    <span className="draft-mod" data-tone={chip.tone}>
      {iconKey === undefined ? null : <DraftWeatherIcon iconKey={iconKey} />}
      {chip.label}
    </span>
  );
}

export function DraftWeatherIcon({ iconKey }: { iconKey: 'sunny' | 'cloudy' | 'rainy' | 'snowy' }) {
  switch (iconKey) {
    case 'sunny':
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 .8v1.5M6 9.7v1.5M.8 6h1.5M9.7 6h1.5M2.3 2.3l1 1M8.7 8.7l1 1M9.7 2.3l-1 1M3.3 8.7l-1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'cloudy':
      return (
        <svg width="12" height="11" viewBox="0 0 13 12" fill="none" aria-hidden="true">
          <path d="M3.5 9.5h6a2.5 2.5 0 00.2-5A3.3 3.3 0 003.4 5 2.3 2.3 0 003.5 9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case 'snowy':
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M6 1v10M1.7 3.5l8.6 5M1.7 8.5l8.6-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'rainy':
      return (
        <svg width="12" height="11" viewBox="0 0 13 12" fill="none" aria-hidden="true">
          <path d="M3.5 7h6a2.5 2.5 0 00.2-5A3.3 3.3 0 003.4 2.5 2.3 2.3 0 003.5 7zM4 9l-.6 1.5M7 9l-.6 1.5M10 9l-.6 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

export function getDraftActionKey(action: DraftUmaAction): string {
  return `${action.kind}:${action.team}:${action.order ?? 'pending'}:${action.umaId ?? action.name}`;
}
