import { useEffect, useRef, useState } from 'react';
import type { PlayerStatsScope } from '@umalytics/shared';
import type { AppScene } from '../history/HistoricalScene';
import { APP_VERSION_LABEL, IS_PRIVATE_BUILD } from '../scoutData';
import './shell.css';

export type AppMode = 'live' | 'history' | 'profiles';

const MODES: { value: AppMode; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'history', label: 'History' },
  { value: 'profiles', label: 'Players' }
];

const SCENES: { value: AppScene; label: string }[] = [
  { value: 'lobby', label: 'Lobby' },
  { value: 'draft', label: 'Draft' },
  { value: 'umas', label: 'Umas' }
];

export function AppHeader({
  mode,
  onModeChange,
  visibleScene,
  onSceneChange,
  sceneDimmed,
  visibleScope,
  onScopeChange,
  matchCode,
  hasRoster,
  isLive,
  profileStatusLabel,
  isLobbyLocked,
  lobbyPlayerCount,
  onToggleLobbyLock,
  canRefresh,
  isRefreshing,
  refreshCooldownSeconds,
  onRefresh,
  diagnosticsCopied,
  onCopyDiagnostics
}: {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  visibleScene: AppScene;
  onSceneChange: (scene: AppScene) => void;
  sceneDimmed: boolean;
  visibleScope: PlayerStatsScope;
  onScopeChange: (scope: PlayerStatsScope) => void;
  matchCode: string | undefined;
  hasRoster: boolean;
  isLive: boolean;
  profileStatusLabel: string | undefined;
  isLobbyLocked: boolean;
  lobbyPlayerCount: number;
  onToggleLobbyLock: () => void;
  canRefresh: boolean;
  isRefreshing: boolean;
  refreshCooldownSeconds: number;
  onRefresh: () => void;
  diagnosticsCopied: boolean;
  onCopyDiagnostics: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const statusLabel = isLive ? (hasRoster ? 'Live' : 'Waiting') : mode === 'history' ? 'History' : 'Players';

  return (
    <header className="app-header">
      <div className="app-logo">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="24" height="24" rx="7" stroke="#6a9bff" strokeWidth="2" />
          <path d="M8 17V9m5 8v-5m5 5v-8" stroke="#f0a05a" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span>UmaLytics</span>
      </div>

      <nav className="seg" aria-label="UmaLytics mode">
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            className={mode === value ? 'on' : ''}
            onClick={() => {
              onModeChange(value);
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <nav
        className={sceneDimmed ? 'seg scene-toggle dimmed' : 'seg scene-toggle'}
        aria-label="UmaLytics scene"
        aria-hidden={sceneDimmed}
        inert={sceneDimmed}
      >
        {SCENES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={visibleScene === value}
            className={visibleScene === value ? 'on' : ''}
            onClick={() => {
              onSceneChange(value);
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="app-header-spacer" />

      <div className="seg" role="group" aria-label="Stats time window">
        <button
          type="button"
          aria-pressed={visibleScope === 'currentSeason'}
          className={visibleScope === 'currentSeason' ? 'on' : ''}
          title="Show current season records, scoring, and Uma stats."
          onClick={() => {
            onScopeChange('currentSeason');
          }}
        >
          Season
        </button>
        <button
          type="button"
          aria-pressed={visibleScope === 'allTime'}
          className={visibleScope === 'allTime' ? 'on' : ''}
          title="Show all-time ranked records, scoring, and Uma stats. Rank still uses the active season leaderboard."
          onClick={() => {
            onScopeChange('allTime');
          }}
        >
          All-time
        </button>
      </div>

      <div
        className={isLive && hasRoster ? 'status-pill' : 'status-pill idle'}
        title={isLive ? profileStatusLabel ?? 'Waiting for lobby data' : undefined}
      >
        <span className="status-pill-dot" aria-hidden="true" />
        <span>{statusLabel}</span>
        {isLive && matchCode !== undefined ? <span className="status-pill-code">{matchCode}</span> : null}
      </div>

      <div className="app-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className={menuOpen ? 'iconbtn active' : 'iconbtn'}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((open) => !open);
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {menuOpen ? (
          <div className="app-menu" role="menu">
            <div className="app-menu-header">
              <span>UmaLytics</span>
              <span className="app-menu-badge">
                v{APP_VERSION_LABEL}
                {IS_PRIVATE_BUILD ? ' (private)' : ''}
              </span>
            </div>
            {hasRoster ? (
              <button
                type="button"
                className="menuitem"
                role="menuitem"
                disabled={!canRefresh}
                onClick={() => {
                  onRefresh();
                  setMenuOpen(false);
                }}
              >
                Refresh profiles
                {isRefreshing ? (
                  <span className="menuitem-hint">Refreshing</span>
                ) : refreshCooldownSeconds > 0 ? (
                  <span className="menuitem-hint">Wait {refreshCooldownSeconds}s</span>
                ) : null}
              </button>
            ) : null}
            {hasRoster ? (
              <button
                type="button"
                className="menuitem"
                role="menuitem"
                onClick={() => {
                  onToggleLobbyLock();
                }}
                title={
                  isLobbyLocked
                    ? 'Unlock live lobby player updates.'
                    : 'Freeze the current players while draft data keeps updating.'
                }
              >
                {isLobbyLocked ? 'Unlock lobby' : 'Lock lobby'}
                <span className="menuitem-hint">{lobbyPlayerCount}/10</span>
              </button>
            ) : null}
            <button
              type="button"
              className="menuitem"
              role="menuitem"
              onClick={() => {
                onCopyDiagnostics();
              }}
            >
              {diagnosticsCopied ? 'Copied' : 'Copy diagnostics'}
            </button>
            <button type="button" className="menuitem" role="menuitem" disabled title="Coming soon">
              Settings
              <span className="menuitem-hint">Soon</span>
            </button>
            <a
              className="menuitem"
              role="menuitem"
              href="https://github.com/kjunodev/umalytics/issues/new"
              target="_blank"
              rel="noreferrer"
            >
              Report a bug
            </a>
            <div className="app-menu-footer">
              UmaLytics by{' '}
              <a href="https://github.com/kjunodev/umalytics" target="_blank" rel="noreferrer">
                k.juno
              </a>
              <br />
              Uma Drafter by{' '}
              <a href="https://drafter.uma.guide" target="_blank" rel="noreferrer">
                Terumi
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
