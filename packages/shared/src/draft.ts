import type { MatchCode } from './match';
import type { TeamId } from './prematch';

export type DraftSnapshotSource = 'synced-draft-state' | 'draft-dom';

export type DraftUmaActionKind = 'pick' | 'ban' | 'veto';

export interface DraftUmaAction {
  kind: DraftUmaActionKind;
  team: TeamId;
  umaId?: string;
  name: string;
  imageUrl?: string;
  order?: number;
}

export interface DraftMapSelection {
  team: TeamId;
  name: string;
  details?: string;
  order?: number;
  status?: 'selected' | 'vetoed' | 'unknown';
}

export interface DraftTiebreakerMap {
  name: string;
  details?: string;
}

export interface DraftTeamSnapshot {
  id: TeamId;
  name?: string;
  maps: DraftMapSelection[];
  umas: DraftUmaAction[];
}

export interface DraftSnapshot {
  matchCode?: MatchCode;
  phase?: string;
  currentTeam?: TeamId;
  tiebreakerMap?: DraftTiebreakerMap;
  source: DraftSnapshotSource;
  teams: Record<TeamId, DraftTeamSnapshot>;
  updatedAt: number;
}
