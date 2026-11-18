import type { MatchCode } from './match';
import type { TeamId } from './prematch';

export type DraftSnapshotSource = 'synced-draft-state' | 'draft-dom' | 'match-history';

export type DraftUmaActionKind = 'pick' | 'ban' | 'veto';

export interface DraftUmaAction {
  kind: DraftUmaActionKind;
  team: TeamId;
  umaId?: string;
  name: string;
  imageUrl?: string;
  order?: number;
  /** Season 3 lobby running style of a picked Uma. Known values are front,
   * pace, late, end and runaway; anything else passes through as text. */
  runningStyle?: string;
}

export interface DraftMapSelection {
  mapId?: string;
  team: TeamId;
  name: string;
  details?: string;
  track?: string;
  distance?: number;
  surface?: string;
  variant?: string;
  direction?: string;
  season?: string;
  weather?: string;
  ground?: string;
  order?: number;
  status?: 'selected' | 'vetoed' | 'unknown';
}

export interface DraftTiebreakerMap {
  name: string;
  details?: string;
  track?: string;
  distance?: number;
  surface?: string;
  variant?: string;
  direction?: string;
  season?: string;
  weather?: string;
  ground?: string;
}

export interface DraftBlessingMap {
  mapId?: string;
  name: string;
  track?: string;
  distance?: number;
  surface?: string;
  variant?: string;
  direction?: string;
  season?: string;
  weather?: string;
  ground?: string;
}

export interface DraftBlessingBan {
  mapId?: string;
  automatic?: boolean;
}

/** Season 3 "Three Goddesses' Blessing". The goddess id is kept as text so a
 * goddess this build does not know still displays. */
export interface DraftBlessing {
  goddess: string;
  status?: string;
  /** Darley Arabian: the distance category whose per-team limit is raised. */
  arabianCategory?: string;
  /** Byerley Turk: the three tiebreaker candidates, each team's sealed ban and the final pick. */
  candidates?: DraftBlessingMap[];
  bans?: Partial<Record<TeamId, DraftBlessingBan>>;
  lockedTeams?: TeamId[];
  selectedMapId?: string;
}

/** Map limits from the draft rules after any blessing was applied. */
export interface DraftMapRules {
  maxDirtPerTeam?: number;
  maxPerDistanceCategory?: number;
  /** Per-category limits that replace maxPerDistanceCategory (Darley Arabian). */
  distanceCategoryOverrides?: Record<string, number>;
}

export interface DraftTeamSnapshot {
  id: TeamId;
  name?: string;
  maps: DraftMapSelection[];
  umas: DraftUmaAction[];
}

export interface DraftSnapshot {
  matchCode?: MatchCode;
  queueContext?: 'quickplay';
  version?: number;
  rules?: { maps: number; picks: number; bans: number; vetoes: number; mapVetoes: number };
  phase?: string;
  currentTeam?: TeamId;
  tiebreakerMap?: DraftTiebreakerMap;
  blessing?: DraftBlessing;
  mapRules?: DraftMapRules;
  source: DraftSnapshotSource;
  teams: Record<TeamId, DraftTeamSnapshot>;
  updatedAt: number;
}
