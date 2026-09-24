import { browser } from 'wxt/browser';
import type { DraftSnapshot, PlayerProfileSummary, PlayerStatsScope, PrematchRoster, PrematchTeam } from '@umalytics/shared';
import { latestStatsCheckAt } from '../profiles/profileTiming';
import { BEST_UMA_SCORE_VERSION, RECENT_HISTORY_VERSION } from '../profiles/profileConstants';
import { normalizeRosterForDisplay } from '../room/rosterDisplay';
import { filterSnapshotForBuild } from '../storage/profileStorage';
import type { PlayerProfileLoadState, PlayerProfileSummariesSnapshot } from '../profiles/profileTypes';
import type { LobbyLockState } from '../storage/lobbyLockStorage';
import { formatRelativeAge, formatStatsScopeShortLabel } from './common/format';
import { getDisplayedProfileStats } from './player/PlayerDetailScene';

export const APP_MANIFEST = browser.runtime.getManifest();
export const APP_VERSION_LABEL = formatAppVersionLabel(APP_MANIFEST);
export const IS_PRIVATE_BUILD = isPrivateBuild(APP_MANIFEST);

export interface DiagnosticRow {
  label: string;
  value: string;
}

export function normalizeProfileSnapshotForDisplay(
  snapshot: PlayerProfileSummariesSnapshot | undefined
): PlayerProfileSummariesSnapshot | undefined {
  snapshot = filterSnapshotForBuild(snapshot);
  if (snapshot === undefined) {
    return undefined;
  }

  return {
    ...snapshot,
    profiles: Object.fromEntries(
      Object.entries(snapshot.profiles).filter((entry): entry is [string, PlayerProfileSummary] =>
        isDisplayableStoredProfile(entry[1])
      )
    ),
    profileStates: filterProfileStatesForDisplay(snapshot.profileStates),
    loadingDiscordIds: getLoadingDiscordIdsForDisplay(snapshot)
  };
}

export function filterProfileStatesForDisplay(
  profileStates: Record<string, PlayerProfileLoadState> | undefined
): Record<string, PlayerProfileLoadState> | undefined {
  if (profileStates === undefined) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(profileStates).filter((entry): entry is [string, PlayerProfileLoadState] =>
      isProfileLoadState(entry[1])
    )
  );
}

export function normalizeLobbyLockForDisplay(lockState: LobbyLockState | undefined): LobbyLockState | undefined {
  if (lockState?.locked !== true) {
    return lockState;
  }

  const roster = normalizeRosterForDisplay(lockState.roster);

  return roster === undefined
    ? undefined
    : {
        ...lockState,
        roster
      };
}

export function isDisplayableStoredProfile(profile: PlayerProfileSummary): boolean {
  return (
    profile.bestUmaScoreVersion === BEST_UMA_SCORE_VERSION &&
    profile.recentHistoryVersion === RECENT_HISTORY_VERSION &&
    profile.currentSeasonStats?.recentHistoryVersion === RECENT_HISTORY_VERSION &&
    profile.allTimeStats?.recentHistoryVersion === RECENT_HISTORY_VERSION
  );
}

export function isPrematchRoster(value: unknown): value is PrematchRoster {
  return (
    typeof value === 'object' &&
    value !== null &&
    'players' in value &&
    Array.isArray(value.players)
  );
}

export function isDraftSnapshot(value: unknown): value is DraftSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'teams' in value &&
    typeof value.teams === 'object' &&
    value.teams !== null &&
    'team1' in value.teams &&
    'team2' in value.teams
  );
}

export function isProfileSnapshot(value: unknown): value is PlayerProfileSummariesSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'profiles' in value &&
    typeof value.profiles === 'object' &&
    value.profiles !== null &&
    'loadingDiscordIds' in value &&
    Array.isArray(value.loadingDiscordIds) &&
    (
      !('profileStates' in value) ||
      value.profileStates === undefined ||
      (
        typeof value.profileStates === 'object' &&
        value.profileStates !== null
      )
    )
  );
}

export function isProfileLoadState(value: unknown): value is PlayerProfileLoadState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'discordId' in value &&
    typeof value.discordId === 'string' &&
    'status' in value &&
    typeof value.status === 'string' &&
    ['queued', 'loading', 'loaded', 'private', 'timeout', 'error'].includes(value.status)
  );
}

export function isLobbyLockState(value: unknown): value is LobbyLockState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'locked' in value &&
    typeof value.locked === 'boolean' &&
    (
      !('roster' in value) ||
      value.roster === undefined ||
      isPrematchRoster(value.roster)
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatAppVersionLabel(manifest: unknown): string {
  const version = isRecord(manifest) && typeof manifest.version === 'string'
    ? manifest.version
    : 'unknown';

  return version;
}

function isPrivateBuild(manifest: unknown): boolean {
  if (!isRecord(manifest)) {
    return false;
  }

  return [manifest.name, manifest.version_name, manifest.description]
    .some((value) => typeof value === 'string' && /\bprivate\b/i.test(value));
}

export function getProfileLoadStates(
  snapshot: PlayerProfileSummariesSnapshot | undefined
): PlayerProfileLoadState[] {
  return Object.values(snapshot?.profileStates ?? {})
    .filter(isProfileLoadState);
}

export function getLoadingProfileCount(snapshot: PlayerProfileSummariesSnapshot | undefined): number {
  const loadStates = getProfileLoadStates(snapshot);

  if (loadStates.length > 0) {
    return loadStates.filter(isPendingProfileLoadState).length;
  }

  return snapshot?.loadingDiscordIds.length ?? 0;
}

export function getLoadingDiscordIdsForDisplay(snapshot: PlayerProfileSummariesSnapshot | undefined): string[] {
  const loadStates = getProfileLoadStates(snapshot);

  if (loadStates.length > 0) {
    return loadStates
      .filter(isPendingProfileLoadState)
      .map((state) => state.discordId);
  }

  return snapshot?.loadingDiscordIds ?? [];
}

export function isProfileLoading(
  snapshot: PlayerProfileSummariesSnapshot | undefined,
  discordId: string
): boolean {
  const state = snapshot?.profileStates?.[discordId];

  if (isProfileLoadState(state)) {
    return isPendingProfileLoadState(state);
  }

  return snapshot?.loadingDiscordIds.includes(discordId) ?? false;
}

export function isPendingProfileLoadState(state: PlayerProfileLoadState): boolean {
  return state.status === 'loading' || state.status === 'queued';
}

export function getDiagnostics(
  roster: PrematchRoster | undefined,
  draftSnapshot: DraftSnapshot | undefined,
  profileSnapshot: PlayerProfileSummariesSnapshot | undefined,
  teams: PrematchTeam[],
  loadingProfiles: number,
  statsScope: PlayerStatsScope,
  now: number,
  isLobbyLocked: boolean,
  lockedAt: number | undefined
): DiagnosticRow[] {
  const profiles = profileSnapshot?.profiles ?? {};
  const profileValues = Object.values(profiles);
  const profileStates = getProfileLoadStates(profileSnapshot);
  const profileErrors = profileStates.length > 0
    ? profileStates.filter((state) => state.status === 'error').length
    : profileValues.filter((profile) => profile.error !== undefined).length;
  const timedOutProfiles = profileStates.filter((state) => state.status === 'timeout').length;
  const queuedProfiles = profileStates.filter((state) => state.status === 'queued').length;
  const activelyLoadingProfiles = profileStates.filter((state) => state.status === 'loading').length;
  const readyProfiles = profileStates.length > 0
    ? profileStates.filter((state) => ['loaded', 'private'].includes(state.status)).length
    : profileValues.length;
  const privateProfiles = profileValues.filter((profile) => profile.statsPrivate === true).length;
  const unresolvedUmaMatches = profileValues.reduce(
    (total, profile) => total + (getDisplayedProfileStats(profile, statsScope)?.unresolvedUmaMatches ?? 0),
    0
  );
  const disqualifiedMatches = profileValues.reduce(
    (total, profile) => total + (getDisplayedProfileStats(profile, statsScope)?.disqualifiedMatches ?? 0),
    0
  );

  return [
    { label: 'Version', value: `v${APP_VERSION_LABEL}${IS_PRIVATE_BUILD ? ' (private)' : ''}` },
    { label: 'Build', value: IS_PRIVATE_BUILD ? 'Private full-profile' : 'Public safe' },
    { label: 'Scene Scope', value: formatStatsScopeShortLabel(statsScope) },
    {
      label: 'Lobby Lock',
      value: isLobbyLocked
        ? `locked${lockedAt === undefined ? '' : ` ${formatRelativeAge(lockedAt, now)}`}`
        : 'unlocked'
    },
    { label: 'Match Code', value: roster?.matchCode ?? draftSnapshot?.matchCode ?? 'none' },
    { label: 'Roster Source', value: getRosterSourceLabel(roster) },
    { label: 'Roster Transport', value: roster?.observationSource ?? 'DOM or older snapshot' },
    { label: 'Draft Source', value: draftSnapshot?.source ?? 'none' },
    { label: 'Teams', value: formatDiagnosticTeamCounts(teams) },
    { label: 'Players', value: roster === undefined ? '0' : String(roster.players.length) },
    { label: 'Profiles', value: `${readyProfiles} ready, ${activelyLoadingProfiles} loading, ${queuedProfiles} queued, ${profileErrors} errors, ${timedOutProfiles} timed out` },
    { label: 'Profile Match', value: profileSnapshot?.matchCode ?? 'none' },
    { label: 'Load Run', value: String(profileSnapshot?.runId ?? 'unknown') },
    { label: 'Load Stages', value: [...new Set(profileStates.filter(isPendingProfileLoadState).map(state => state.stage ?? 'Queued'))].join(', ') || 'Idle' },
    { label: 'Last Errors', value: [...new Set(profileStates.map(state => state.error).filter(Boolean))].join(' | ') || 'none' },
    { label: 'Automatic Retry', value: profileStates.some(state => state.retryAt !== undefined) ? `${Math.max(0, Math.ceil((Math.max(...profileStates.map(state => state.retryAt ?? 0)) - now) / 1000))}s` : 'none' },
    { label: 'Private Profiles', value: String(privateProfiles) },
    { label: 'Uma Gaps', value: `${unresolvedUmaMatches} unresolved, ${disqualifiedMatches} disqualified` },
    {
      label: 'Latest Stats Check',
      value: latestStatsCheckAt(profileSnapshot, statsScope) === undefined ? 'never' : formatRelativeAge(latestStatsCheckAt(profileSnapshot, statsScope)!, now)
    },
    {
      label: 'Draft Updated',
      value: draftSnapshot === undefined ? 'never' : `${formatRelativeAge(draftSnapshot.updatedAt, now)}`
    }
  ];
}

export function getRosterSourceLabel(roster: PrematchRoster | undefined): string {
  if (roster === undefined) {
    return 'none';
  }

  const sources = new Set(roster.players.map((player) => player.source ?? 'unknown'));

  return Array.from(sources).sort().join(', ');
}

export function formatDiagnosticTeamCounts(teams: PrematchTeam[]): string {
  if (teams.length === 0) {
    return 'none';
  }

  return teams.map((team) => `${team.name ?? team.id} ${team.players.length}/5`).join(' | ');
}

export function formatDiagnosticsForClipboard(diagnostics: DiagnosticRow[]): string {
  return diagnostics.map((item) => `${item.label}: ${item.value}`).join('\n');
}
