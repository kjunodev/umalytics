import type { MatchCode } from './match';

export type TeamId = 'team1' | 'team2';

export interface PrematchPlayer {
  userId: string;
  discordId: string;
  displayName: string;
  partyId: string | null;
  partyRatingBonus: number;
  team?: TeamId;
  initialTeam?: TeamId;
  finalTeam?: TeamId;
  role?: string;
  isCaptain?: boolean;
  ratingSnapshot?: number;
  rdSnapshot?: number;
  displayRatingSnapshot?: number;
  displayRdSnapshot?: number;
  avatarUrl?: string;
  profileUrl?: string;
  source?: 'synced-draft-state' | 'room-lobby-dom';
  profileLookupUnavailable?: boolean;
}

export interface PrematchTeam {
  id: TeamId;
  name?: string;
  captainUserId?: string;
  players: PrematchPlayer[];
}

export interface PrematchRoster {
  matchCode?: MatchCode;
  phase?: string;
  currentTeam?: TeamId;
  players: PrematchPlayer[];
  teams?: Record<TeamId, PrematchTeam>;
}
