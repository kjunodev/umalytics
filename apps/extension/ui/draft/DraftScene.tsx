import { useEffect, useState } from 'react';
import './draft.css';
import type {
  DraftSnapshot,
  DraftTeamSnapshot,
  DraftUmaAction,
  PlayerProfileSummary,
  PlayerStatsScope,
  PlayerTopUmaSummary,
  PrematchPlayer,
  PrematchRoster,
  TeamId
} from '@umalytics/shared';
import { missingUmaHistoryLabel } from '../../profiles/profileAvailability';
import { getUmaPortraitUrl, isKnownUmaOutfitId } from '../../umas/umaPortraits';
import { UmaImage } from '../common/UmaImage';
import { formatDecimal, formatStatsScopeShortLabel } from '../common/format';
import { TEAM_IDS, TEAM_SLOT_COUNT, getDraftRosterPlayersForTeam, getDraftSlots } from '../common/roster';
import { findScopedUmaEntry, getUmaExperience } from '../umas/umaCatalog';
import {
  formatDraftMapDetails,
  formatDraftMapTitle,
  formatDraftPhase,
  formatDraftUmaKind,
  formatTeamName,
  formatTiebreakerMap
} from './draftFormat';

export const DRAFT_MAP_SLOT_COUNT = 4;

export const DRAFT_PICK_SLOT_COUNT = 6;

export const DRAFT_BAN_SLOT_COUNT = 2;

export const DRAFT_VETO_SLOT_COUNT = 1;

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
  const scopeLabel = statsScope === 'currentSeason' ? 'current season' : 'all-time';

  if (snapshot === undefined) {
    return (
      <section className="empty-state">
        <h2>No draft data detected</h2>
        <p>Open an active Uma Drafter draft to mirror maps, picks, and bans.</p>
      </section>
    );
  }

  return (
    <section className="draft-scene" aria-label={historical ? 'Completed draft view' : 'Live draft view'}>
      <header className="draft-scene-header">
        <div>
          <h2>{historical ? 'Completed Draft' : 'Live Draft'}</h2>
          <p>
            {snapshot.phase === undefined ? 'Draft phase unknown' : formatDraftPhase(snapshot.phase)}
            {snapshot.currentTeam === undefined ? '' : ` - ${formatTeamName(snapshot.teams[snapshot.currentTeam])} turn`}
          </p>
          {snapshot.tiebreakerMap === undefined ? null : (
            <p className="draft-tiebreaker">
              Tiebreaker: <strong>{formatTiebreakerMap(snapshot.tiebreakerMap)}</strong>
            </p>
          )}
        </div>
        <span title={`Uma experience checks each team's loaded ${scopeLabel} ranked Uma history.`}>
          {historical ? 'Current team' : 'Using team'} {formatStatsScopeShortLabel(statsScope)} history
        </span>
      </header>

      <div className="draft-team-grid">
        {TEAM_IDS.map((teamId) => (
          <DraftTeamPanel
            key={teamId}
            team={snapshot.teams[teamId]}
            rules={snapshot.rules}
            rosterPlayers={getDraftRosterPlayersForTeam(roster, teamId)}
            profiles={profiles}
            statsScope={statsScope}
          />
        ))}
      </div>
    </section>
  );
}

export function DraftTeamPanel({
  team,
  rules,
  rosterPlayers,
  profiles,
  statsScope
}: {
  team: DraftTeamSnapshot;
  rules?: DraftSnapshot['rules'];
  rosterPlayers: PrematchPlayer[];
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
}) {
  const picks = team.umas.filter((uma) => uma.kind === 'pick');
  const bans = team.umas.filter((uma) => uma.kind === 'ban');
  const vetoes = team.umas.filter((uma) => uma.kind === 'veto');
  const pickSignature = picks.map(getDraftActionKey).join('|');
  const [selectedPickKey, setSelectedPickKey] = useState<string | undefined>();

  useEffect(() => {
    const latestPick = picks.at(-1);

    setSelectedPickKey(latestPick === undefined ? undefined : getDraftActionKey(latestPick));
  }, [pickSignature]);

  return (
    <article className={`draft-team-panel ${team.id}`}>
      <header>
        <h3>{formatTeamName(team)}</h3>
        <p>{team.maps.length} maps - {picks.length} picks</p>
      </header>

      <DraftMapList teamId={team.id} maps={team.maps} count={rules?.maps} />
      <DraftPickBoard
        picks={picks}
        count={rules?.picks}
        selectedPickKey={selectedPickKey}
        onSelectPick={setSelectedPickKey}
        rosterPlayers={rosterPlayers}
        profiles={profiles}
        statsScope={statsScope}
      />
      <DraftBanRow bans={bans} vetoes={vetoes} rules={rules} />
    </article>
  );
}

export function DraftMapList({ maps, count, teamId }: { maps: DraftTeamSnapshot['maps']; count?: number; teamId: TeamId }) {
  const slots = getDraftSlots(maps, count ?? DRAFT_MAP_SLOT_COUNT);

  return (
    <section className="draft-card-section draft-map-section">
      <p>Maps</p>
      <ol className="draft-map-list">
        {slots.map((map, index) => (
          map === undefined ? (
            <li key={`map-placeholder:${index}`} className="placeholder">
              <span className="draft-map-order">{index * 2 + (teamId === 'team1' ? 1 : 2)}</span>
              <strong>Pending map</strong>
              <small>Waiting for draft update</small>
            </li>
          ) : (
            <li
              key={`${map.team}:${map.mapId ?? map.order ?? map.details ?? index}:${map.name}`}
              className={map.status === 'vetoed' ? 'vetoed' : ''}
            >
              <span className="draft-map-order">{map.order ?? '-'}</span>
              <strong title={formatDraftMapTitle(map)}>
                {map.name}
              </strong>
              {formatDraftMapDetails(map) === undefined ? null : <small>{formatDraftMapDetails(map)}</small>}
              {map.status === 'vetoed' ? <span className="draft-map-status">Vetoed</span> : null}
            </li>
          )
        ))}
      </ol>
    </section>
  );
}

export function DraftBanRow({
  rules,
  bans,
  vetoes
}: {
  rules?: DraftSnapshot['rules'];
  bans: DraftUmaAction[];
  vetoes: DraftUmaAction[];
}) {
  const slots = [
    ...getDraftSlots(bans, rules?.bans ?? DRAFT_BAN_SLOT_COUNT).map((action) => ({
      action,
      kind: 'ban' as const,
      label: 'Pending ban'
    })),
    ...getDraftSlots(vetoes, rules?.vetoes ?? DRAFT_VETO_SLOT_COUNT).map((action) => ({
      action,
      kind: 'veto' as const,
      label: 'Pending veto'
    }))
  ];

  return (
    <section className="draft-card-section draft-ban-section">
      <p>Banned</p>
      <ol className="draft-uma-list">
        {slots.map(({ action, kind, label }, index) => (
          action === undefined ? (
            <DraftUmaPlaceholderRow
              key={`${kind}:placeholder:${index}`}
              kind={kind}
              label={label}
            />
          ) : (
            <DraftUmaActionRow
              key={`${action.kind}:${action.team}:${action.order ?? action.umaId ?? action.name}`}
              action={action}
            />
          )
        ))}
      </ol>
    </section>
  );
}

export function DraftPickBoard({
  count,
  picks,
  selectedPickKey,
  onSelectPick,
  rosterPlayers,
  profiles,
  statsScope
}: {
  count?: number;
  picks: DraftUmaAction[];
  selectedPickKey: string | undefined;
  onSelectPick: (key: string) => void;
  rosterPlayers: PrematchPlayer[];
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
}) {
  const slots = getDraftSlots(picks, count ?? DRAFT_PICK_SLOT_COUNT);
  const selectedPick = picks.find((pick) => getDraftActionKey(pick) === selectedPickKey);

  return (
    <section className="draft-card-section draft-pick-section">
      <p>Picked Umas</p>
      <ol className="draft-pick-slots">
        {slots.map((action, index) => (
          action === undefined ? (
            <li key={`pick-placeholder:${index}`} className="draft-pick-slot placeholder">
              <span className="draft-pick-icon">
                <span>?</span>
              </span>
              <small>Pending</small>
            </li>
          ) : (
            <DraftPickSlot
              key={getDraftActionKey(action)}
              action={action}
              experienceCount={getUmaExperience(action, rosterPlayers, profiles, statsScope).length}
              isSelected={getDraftActionKey(action) === selectedPickKey}
              onSelect={() => onSelectPick(getDraftActionKey(action))}
            />
          )
        ))}
      </ol>
      <DraftPickExperiencePanel
        action={selectedPick}
        rosterPlayers={rosterPlayers}
        profiles={profiles}
        statsScope={statsScope}
      />
    </section>
  );
}

export function DraftPickSlot({
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
    <li className="draft-pick-slot">
      <button
        type="button"
        className={isSelected ? 'selected' : ''}
        onClick={onSelect}
        title={action.name}
      >
        <span className="draft-pick-icon">
          <UmaImage imageUrl={imageUrl} name={action.name} />
        </span>
        {experienceCount > 0 ? <span className="draft-pick-count">{experienceCount}</span> : null}
      </button>
      <small>{action.name}</small>
    </li>
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
  const experienceCount = action === undefined
    ? 0
    : playerSlots.filter((player) =>
      player !== undefined && getUmaExperienceForPlayer(action, player, profiles, statsScope) !== undefined
    ).length;

  return (
    <div className="draft-pick-experience-panel">
      <div className="draft-pick-experience-heading">
        <strong>{action?.name ?? 'Select a picked Uma'}</strong>
        <span>
          {action === undefined
            ? 'Waiting for picks'
            : `${experienceCount} players with ${formatStatsScopeShortLabel(statsScope)} history`}
        </span>
      </div>
      {action === undefined ? (
        <small className="draft-empty-history">Pick history appears here after an Uma is selected.</small>
      ) : (
        <ol className="draft-pick-experience-list">
          {playerSlots.map((player, index) => {
            const experience = player === undefined
              ? undefined
              : getUmaExperienceForPlayer(action, player, profiles, statsScope);
            const displayName = player === undefined
              ? ''
              : profiles[player.discordId]?.displayName ?? player.displayName;

            return (
              <li
                key={player === undefined ? `experience-slot:${index}` : `${player.discordId}:${player.userId}`}
                className={experience === undefined ? 'no-history' : ''}
              >
                <strong title={displayName}>{displayName}</strong>
                {experience === undefined ? (
                  <span className="draft-no-history-text">{player === undefined ? 'Open slot' : missingUmaHistoryLabel(profiles[player.discordId], statsScope)}</span>
                ) : (
                  <span>{experience.matches} GP - {formatDecimal(experience.pointsPerGame)} PPG</span>
                )}
              </li>
            );
          })}
        </ol>
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

export function DraftUmaPlaceholderRow({
  kind,
  label
}: {
  kind?: DraftUmaAction['kind'];
  label: string;
}) {
  return (
    <li className={`draft-uma-row placeholder ${kind ?? ''} no-history`}>
      <span className="draft-uma-main">
        <span className="draft-uma-portrait">
          <span>?</span>
        </span>
        <span className="draft-uma-copy">
          <strong>{label}</strong>
          <small>Waiting for draft update</small>
        </span>
      </span>
    </li>
  );
}

export function DraftUmaActionRow({
  action
}: {
  action: DraftUmaAction;
}) {
  const imageUrl = action.imageUrl ?? (action.umaId === undefined ? undefined : getUmaPortraitUrl(action.umaId));

  return (
    <li className={`draft-uma-row ${action.kind} no-history`}>
      <span className="draft-uma-main">
        <span className="draft-uma-portrait">
          <UmaImage imageUrl={imageUrl} name={action.name} />
        </span>
        <span className="draft-uma-copy">
          <strong>{action.name}</strong>
          <small>{formatDraftUmaKind(action.kind)}</small>
        </span>
      </span>
    </li>
  );
}

export function getDraftActionKey(action: DraftUmaAction): string {
  return `${action.kind}:${action.team}:${action.order ?? 'pending'}:${action.umaId ?? action.name}`;
}
