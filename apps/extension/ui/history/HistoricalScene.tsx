import { useEffect, useState } from 'react';
import type { DraftSnapshot, PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchRoster, PrematchTeam } from '@umalytics/shared';
import { getTeamGroups } from '../../room/rosterDisplay';
import { getPlayerKey } from '../common/roster';
import { DraftScene } from '../draft/DraftScene';
import { TeamSection } from '../lobby/TeamSection';
import { PlayerDetailScene } from '../player/PlayerDetailScene';
import { UmaPlannerScene } from '../umas/UmaPlannerScene';

export type AppScene = 'lobby' | 'draft' | 'umas';

export interface SelectedPlayerContext {
  team: PrematchTeam;
  player: PrematchPlayer;
}

export function HistoricalScene({ snapshot, roster, profiles, statsScope, scene, loading, navigation }: {
  snapshot: DraftSnapshot; roster: PrematchRoster; profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope; scene: AppScene; loading: boolean; navigation: number;
}) {
  const [selected, setSelected] = useState<string>();
  useEffect(() => setSelected(undefined), [scene, navigation]);
  const teams = getTeamGroups(roster);
  const context = getSelectedPlayerContext(teams, selected);
  if (context && scene === 'lobby') return <PlayerDetailScene team={context.team} player={context.player} profile={profiles[context.player.discordId]} isProfileLoading={loading && !profiles[context.player.discordId]} statsScope={statsScope} now={Date.now()} onBack={() => setSelected(undefined)} />;
  if (scene === 'draft') return <DraftScene snapshot={snapshot} roster={roster} profiles={profiles} statsScope={statsScope} historical />;
  if (scene === 'umas') return <UmaPlannerScene roster={roster} profiles={profiles} statsScope={statsScope} />;
  return <section className="team-list" aria-label="Historical lobby teams">{teams.map(team => <TeamSection key={team.id} team={team} profiles={profiles} loadingDiscordIds={loading ? roster.players.filter(player => !profiles[player.discordId]).map(player => player.discordId) : []} statsScope={statsScope} onSelectPlayer={setSelected} />)}</section>;
}

export function getSelectedPlayerContext(
  teams: PrematchTeam[],
  selectedPlayerKey: string | undefined
): SelectedPlayerContext | undefined {
  if (selectedPlayerKey === undefined) {
    return undefined;
  }

  for (const team of teams) {
    const player = team.players.find((player) => getPlayerKey(player) === selectedPlayerKey);

    if (player !== undefined) {
      return { team, player };
    }
  }

  return undefined;
}
