export interface EsportsTeamIcon {
  teamId: string;
  teamName: string;
  logoUrl: string;
}

export type EsportsTeamIconMap = Record<string, EsportsTeamIcon>;
