import { useState } from 'react';
import { parseHistoricalMatch } from '@umalytics/core/explorer/explorerData';
import { quickplayCode, quickplayMatch } from '../../../../tests/fixtures/quickplay-match.mts';
import type { PlayerStatsScope } from '@umalytics/shared';
import '@umalytics/ui/common/base.css';
import { DraftScene } from '@umalytics/ui/draft/DraftScene';
import { HistoricalScene, getSelectedPlayerContext, type AppScene } from '@umalytics/ui/history/HistoricalScene';
import { TeamSection } from '@umalytics/ui/lobby/TeamSection';
import { PlayerDrawer } from '@umalytics/ui/player/PlayerDrawer';
import { PlayersView } from '@umalytics/ui/players/PlayersView';
import { AppHeader, type AppMode } from '../../ui/shell/AppHeader';
import { UmasScene } from '@umalytics/ui/umas/UmasScene';
import {
  PREVIEW_DRAFT_ARABIAN,
  PREVIEW_DRAFT_BARB,
  PREVIEW_DRAFT_COMPLETE,
  PREVIEW_DRAFT_MID,
  PREVIEW_DRAFT_TURK,
  PREVIEW_LOADING_DISCORD_IDS,
  PREVIEW_PROFILES,
  PREVIEW_ROSTER,
  PREVIEW_TEAM_ICONS
} from './fixtures';

const PREVIEW_DRAFT_QUICKPLAY = parseHistoricalMatch(quickplayMatch(), quickplayCode).draft;
for (const team of Object.values(PREVIEW_DRAFT_QUICKPLAY.teams)) {
  for (const action of team.umas) action.imageUrl = '/portrait-fixture.svg';
}

type DraftVariant = 'mid' | 'complete' | 'barb' | 'arabian' | 'turk' | 'quickplay';
const DRAFT_VARIANTS: DraftVariant[] = ['mid', 'complete', 'barb', 'arabian', 'turk', 'quickplay'];
const DRAFT_FIXTURES = { mid: PREVIEW_DRAFT_MID, complete: PREVIEW_DRAFT_COMPLETE, barb: PREVIEW_DRAFT_BARB, arabian: PREVIEW_DRAFT_ARABIAN, turk: PREVIEW_DRAFT_TURK, quickplay: PREVIEW_DRAFT_QUICKPLAY };
const DRAFT_LABELS: Record<DraftVariant, string> = { mid: 'Mid-draft', complete: 'Complete', barb: 'Barb', arabian: 'Arabian', turk: 'Turk', quickplay: 'Quickplay' };

// Reads ?mode=&scene=&draft=&player= from the URL so pnpm preview:shots can
// deep-link straight to a scene/state instead of scripting header clicks.
// Manual use (npm run preview) ignores these and just starts on the lobby.
function initialStateFromQuery() {
  const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const scene = params.get('scene');
  const draft = params.get('draft');
  const player = params.get('player');
  return {
    mode: mode === 'history' || mode === 'profiles' ? (mode as AppMode) : 'live',
    scene: scene === 'draft' || scene === 'umas' ? (scene as AppScene) : 'lobby',
    draftVariant: DRAFT_VARIANTS.includes(draft as DraftVariant) ? draft as DraftVariant : 'mid',
    selectedPlayerKey: player ?? undefined
  };
}

// Every scene and state the layout foundation touches, driven from static
// fixtures instead of a live lobby. Never bundled into the extension (see
// dev/preview/README.md for how it's kept out of the build and zips).
export default function PreviewApp() {
  const initial = useState(initialStateFromQuery)[0];
  const [mode, setMode] = useState<AppMode>(initial.mode);
  const [scene, setScene] = useState<AppScene>(initial.scene);
  const [statsScope, setStatsScope] = useState<PlayerStatsScope>('currentSeason');
  const [draftVariant, setDraftVariant] = useState<DraftVariant>(initial.draftVariant);
  const [selectedPlayerKey, setSelectedPlayerKey] = useState<string | undefined>(initial.selectedPlayerKey);
  // The harness has no History input box; a clicked match code just switches
  // to History mode and shows that code in the header, like the real app.
  const [openedMatchCode, setOpenedMatchCode] = useState<string>();
  const openMatch = (code: string) => { setOpenedMatchCode(code); setSelectedPlayerKey(undefined); setMode('history'); };
  const draftSnapshot = DRAFT_FIXTURES[draftVariant];
  const draftCode = draftVariant === 'quickplay' && scene === 'draft' ? draftSnapshot.matchCode : undefined;

  const teams = [PREVIEW_ROSTER.teams!.team1, PREVIEW_ROSTER.teams!.team2];
  const selectedContext = getSelectedPlayerContext(teams, selectedPlayerKey);
  const showDraftVariantToggle = scene === 'draft' && (mode === 'live' || mode === 'history');

  return (
    <main className="app-shell surface-scout">
      <AppHeader
        mode={mode}
        onModeChange={setMode}
        visibleScene={scene}
        onSceneChange={setScene}
        sceneDimmed={mode === 'profiles'}
        visibleScope={statsScope}
        onScopeChange={setStatsScope}
        matchCode={draftCode ?? PREVIEW_ROSTER.matchCode}
        historicalMatchCode={mode === 'history' ? openedMatchCode ?? draftCode ?? 'PVW999' : undefined}
        hasRoster
        isLive={mode === 'live'}
        profileStatusLabel="Latest stats check just now"
        isLobbyLocked={false}
        lobbyPlayerCount={PREVIEW_ROSTER.players.length}
        onToggleLobbyLock={() => {}}
        canRefresh={false}
        isRefreshing={false}
        refreshCooldownSeconds={0}
        onRefresh={() => {}}
        diagnosticsCopied={false}
        onCopyDiagnostics={() => {}}
      />

      {/* Preview-only control (never shipped): DraftScene takes one snapshot,
          so a mid-draft and a complete-with-tiebreaker-and-vetoes fixture
          need a toggle the real app doesn't have. Sits in normal flow, above
          .app-scene-area, so it can never overlap the phase bar's stage
          track (which spans the scene's full width) the way an absolutely
          positioned overlay did before. */}
      {showDraftVariantToggle ? (
        <div className="seg" style={{ marginBottom: 8, alignSelf: 'flex-end' }} role="group" aria-label="Preview draft fixture">
          {DRAFT_VARIANTS.map((variant) => (
            <button key={variant} type="button" className={draftVariant === variant ? 'on' : ''} onClick={() => setDraftVariant(variant)}>{DRAFT_LABELS[variant]}</button>
          ))}
        </div>
      ) : null}

      <div className="app-scene-area">
        {mode === 'profiles' ? (
          <PlayersView roster={PREVIEW_ROSTER} statsScope={statsScope} active teamIcons={PREVIEW_TEAM_ICONS} onOpenMatch={openMatch} />
        ) : mode === 'history' ? (
          <HistoricalScene
            snapshot={draftSnapshot}
            roster={PREVIEW_ROSTER}
            profiles={PREVIEW_PROFILES}
            statsScope={statsScope}
            scene={scene}
            loading={false}
            navigation={0}
            onOpenMatch={openMatch}
            teamIcons={PREVIEW_TEAM_ICONS}
          />
        ) : scene === 'draft' ? (
          <DraftScene snapshot={draftSnapshot} roster={PREVIEW_ROSTER} profiles={PREVIEW_PROFILES} statsScope={statsScope} />
        ) : scene === 'umas' ? (
          <UmasScene roster={PREVIEW_ROSTER} profiles={PREVIEW_PROFILES} statsScope={statsScope} />
        ) : (
          <>
            <section className="team-list" aria-label="Preview lobby teams">
              {teams.map((team) => (
                <TeamSection
                  key={team.id}
                  team={team}
                  profiles={PREVIEW_PROFILES}
                  loadingDiscordIds={PREVIEW_LOADING_DISCORD_IDS}
                  statsScope={statsScope}
                  teamIcons={PREVIEW_TEAM_ICONS}
                  selectedPlayerKey={selectedPlayerKey}
                  onSelectPlayer={setSelectedPlayerKey}
                  onRetryProfile={() => {}}
                  canRetryProfile
                />
              ))}
            </section>
            {selectedContext === undefined ? null : (
              <PlayerDrawer
                player={selectedContext.player}
                profile={PREVIEW_PROFILES[selectedContext.player.discordId]}
                onClose={() => setSelectedPlayerKey(undefined)}
                context={{
                  team: selectedContext.team, statsScope, isProfileLoading: false, now: Date.now(), inLobby: true,
                  teamIcon: PREVIEW_TEAM_ICONS[selectedContext.player.discordId],
                  onOpenMatch: openMatch
                }}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}
