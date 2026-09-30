import { useEffect, useRef, useState } from 'react';
import type { PlayerStatsScope } from '@umalytics/shared';
import type { AppScene } from '../history/HistoricalScene';
import { APP_VERSION_LABEL } from '../scoutData';
import './shell.css';
import { isUiSize, saveUiSize, type UiSize } from '../common/uiSize';

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
  historicalMatchCode,
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
  historicalMatchCode: string | undefined;
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
  const [uiSize, setUiSize] = useState<UiSize>(() => {
    const value = document.documentElement.dataset.uiSize;
    return isUiSize(value) ? value : 'default';
  });
  const [sizeError, setSizeError] = useState(false);
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

  const statusCode = isLive && matchCode !== undefined ? matchCode : mode === 'history' && historicalMatchCode ? historicalMatchCode : undefined;
  const statusLabel = isLive ? (hasRoster ? 'Live' : 'Waiting') : mode === 'history' && historicalMatchCode ? 'Past match' : mode === 'history' ? 'History' : 'Players';
  // The compact header shows only the dot and room code, so the label and the
  // profile-check detail stay reachable here.
  const statusTitle = isLive ? `${statusLabel} - ${profileStatusLabel ?? 'Waiting for lobby data'}` : statusLabel;

  return (
    <header className="app-header">
      <div className="app-header-grid">
        <div className="app-header-lead">
          <div className="app-logo" title="UmaLytics">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="24" height="24" rx="7" stroke="#6a9bff" strokeWidth="2" />
              <path d="M8 17V9m5 8v-5m5 5v-8" stroke="#f0a05a" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <span className="app-logo-word">UmaLytics</span>
          </div>

          <nav className="seg mode-toggle" aria-label="UmaLytics mode">
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
        </div>

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

        <div className="app-header-tail">
          <div className="seg scope-toggle" role="group" aria-label="Stats time window">
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
            className={[isLive && hasRoster ? 'status-pill' : 'status-pill idle', statusCode !== undefined ? 'has-code' : ''].filter(Boolean).join(' ')}
            title={statusTitle}
          >
            <span className="status-pill-dot" aria-hidden="true" />
            <span className="status-pill-label">{statusLabel}</span>
            {statusCode !== undefined ? <span className="status-pill-code">{statusCode}</span> : null}
          </div>
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
                </span>
              </div>
              <div className="ui-size-control" role="group" aria-label="UI size">
                <span>UI size</span>
                <div className="seg">
                  {(['small', 'default', 'large'] as const).map((size) => (
                    <button key={size} type="button" aria-pressed={uiSize === size}
                      className={uiSize === size ? 'on' : ''}
                      onClick={() => {
                        void saveUiSize(size).then(() => {
                          setUiSize(size);
                          setSizeError(false);
                        }).catch(() => setSizeError(true));
                      }}>
                      {size.charAt(0).toUpperCase() + size.slice(1)}
                    </button>
                  ))}
                </div>
                {sizeError ? <span role="alert">Could not save UI size. Try again.</span> : null}
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
      </div>
    </header>
  );
}
