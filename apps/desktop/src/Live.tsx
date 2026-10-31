import { useEffect, useState } from 'react';
import { getSelectedPlayerContext } from '@umalytics/ui';
import { PlayerDrawer } from './PlayerDrawer';
import { DesktopTeamIcon } from './TeamIcon';
import { BadgeIcon } from '@umalytics/ui/lobby/BadgeChip';
import { getCardProfile, getCardState, getPlayerDisplayRating, getTeamAverageRating, CaptainCrown } from '@umalytics/ui/lobby/TeamSection';
import { BestUmaPortrait } from '@umalytics/ui/player/BestUmaPortrait';
import { sortTopUmasForCard } from '@umalytics/ui/player/TopUmasList';
import { getPlayerKey } from '@umalytics/ui/common/roster';
import { getNotableBadges } from '@umalytics/ui/common/badges';
import { formatDecimal, formatNumber, formatPercent, formatRecord, formatRank } from '@umalytics/ui/common/format';
import { getTeamGroups } from '@umalytics/core/room/rosterDisplay';
import { isDiscordSnowflake } from '@umalytics/core/room/rosterIdentity';
import type { EsportsTeamIcon, EsportsTeamIconMap, PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchRoster } from '@umalytics/shared';

function Uma({ uma }: { uma: NonNullable<PlayerProfileSummary['topUmas']>[number] }) {
  return <><BestUmaPortrait uma={uma}/><span className="uma-name" title={uma.name}>{uma.name}</span><small className="num">{uma.matches}g</small></>;
}
function PlayerCard({ player, profile, scope, loading, onSelect, selected, onRetry, teamIcon }: {
  player: PrematchPlayer; profile?: PlayerProfileSummary; scope: PlayerStatsScope; loading: boolean; onSelect: () => void; selected: boolean; onRetry: () => void; teamIcon?: EsportsTeamIcon;
}) {
  const p = getCardProfile(profile, scope);
  const state = loading && p?.isPartial && p.matches == null && !p.statsPrivate && !p.error ? 'loading' : getCardState(profile, p, loading, isDiscordSnowflake(player.discordId) ? player.discordId : undefined);
  const allBadges = state === 'loaded' ? getNotableBadges(p) : [];
  const badges = allBadges.filter(badge => ['oneTrick', 'deepPool', 'podiumRegular', 'underrated', 'newcomer'].includes(badge.kind));
  const shownBadges = badges.slice(0, badges.length > 3 ? 2 : 3);
  const moreBadges = badges.slice(shownBadges.length);
  const tier = allBadges.find(badge => badge.kind === 'top10' || badge.kind === 'top25')?.kind ?? '';
  const rating = getPlayerDisplayRating(player, profile);
  const umas = sortTopUmasForCard(p?.allUmas ?? p?.topUmas ?? []);
  const name = profile?.displayName ?? player.displayName;
  return <li className={`arena-card player-row ${tier} ${selected ? 'is-selected' : ''}`} data-state={state}>
    <button type="button" className="card-hit arena-card-hit" onClick={onSelect} aria-label={`Open details for ${name}`}/>
    <div className="arena-card-name"><strong title={name}>{name}</strong><DesktopTeamIcon icon={teamIcon}/>{(player.isCaptain || player.role === 'captain') && <CaptainCrown/>}<span className="rank num">{state === 'loading' ? '…' : state === 'private' || state === 'unavailable' ? '—' : formatRank(p, false)}</span></div>
    <div className="arena-card-meta"><span><b className="num">{formatNumber(rating)}</b> rating</span><div className="arena-badges">{shownBadges.map(badge => <span key={badge.kind} className={`arena-badge ${badge.tone === 'rank' ? 'gold' : ''}`} tabIndex={0} aria-label={`${badge.label}: ${badge.title}`}>
      {badge.kind === 'top10' || badge.kind === 'top25' ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2h6v4a3 3 0 0 1-6 0V2ZM5 3H2v2a3 3 0 0 0 3 3m6-5h3v2a3 3 0 0 1-3 3M8 9v4m-3 1h6"/></svg> : <BadgeIcon kind={badge.kind}/>}
      <span className="arena-tooltip" role="tooltip"><b>{badge.label}</b>{badge.title}</span></span>)}{moreBadges.length > 0 && <span className="arena-badge" tabIndex={0} aria-label={`${moreBadges.length} more badges: ${moreBadges.map(badge => badge.label).join(', ')}`}><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/></svg><span className="arena-tooltip" role="tooltip"><b>{moreBadges.length} more badges</b>{moreBadges.map(badge => badge.label).join(' · ')}. All badges are listed in details.</span></span>}</div></div>
    {state === 'loaded' ? <><div className="arena-stats compact-scouting-grid" aria-label={`${name} scouting summary`}>{[
      ['W–L', formatRecord(p)], ['Win', formatPercent(p?.winRate)], ['PPG', formatDecimal(p?.pointsPerGame)], ['MVP', formatNumber(p?.mvpMatches)]
    ].map(([label, value]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}</div><div className="arena-umas"><div className="label"><span>Most played</span><span>Games</span></div><ol className="top-umas-rows">{umas.map(uma => <li key={uma.umaId}><Uma uma={uma}/></li>)}</ol>{!umas.length && <p className="muted">No ranked Uma stats</p>}</div></> : state === 'loading' ? <div className="arena-loading" role="status" aria-label={`Loading stats for ${name}`}><span/><span/><span/><span/></div> : <div className="arena-card-message"><b>{state === 'private' ? 'Stats are private' : state === 'error' ? 'Couldn’t load stats' : 'No linked profile'}</b><span>{state === 'private' ? 'Open details for match history' : state === 'error' ? 'Available details remain accessible.' : 'No Discord account is linked.'}</span>{state === 'error' && <button type="button" disabled={loading} onClick={onRetry}>Retry stats</button>}</div>}
  </li>;
}
export function Lobby({ roster, profiles, loading, compact, scope, emptyStatus, onOpenMatch, onRetry, teamIcons }: {
  roster?: PrematchRoster; profiles: Record<string, PlayerProfileSummary>; loading: boolean; compact: boolean; scope: PlayerStatsScope; emptyStatus: string;
  onOpenMatch: (code: string) => void; onRetry: () => void; teamIcons: EsportsTeamIconMap;
}) {
  const [selected, setSelected] = useState<string>();
  useEffect(() => setSelected(undefined), [roster?.matchCode]);
  const teams = getTeamGroups(roster);
  const context = getSelectedPlayerContext(teams, selected);
  if (!roster?.players.length) return <section className="empty-state"><h2>Waiting for your room</h2><p>Open a room on Uma Drafter with local sharing turned on.</p><p role="status">{emptyStatus}</p><div className="feed-steps"><span>1 · Open Uma Drafter</span><span>2 · Enable local sharing</span><span>3 · Join a room</span></div></section>;
  return <>{compact && <div className="compact-caption"><span>{scope === 'currentSeason' ? 'Season' : 'All-time'} stats</span><span className="label">Rank · W–L · PPG</span></div>}
    <div className={`arena-lobby ${compact ? 'compact-lobby' : ''}`} aria-label="Live lobby teams">{teams.map((team, index) => <section className={`team team-${index + 1}`} key={team.id}>
      <div className="team-heading"><i/><h2>{team.name ?? `Team ${index + 1}`}</h2><span className="team-count">{team.players.length}/5 players</span><div className="rule"/><span className="num">Avg rating <b>{formatNumber(getTeamAverageRating(team, profiles))}</b></span></div>
      <ol className={`player-list ${compact ? 'compact-players' : 'arena-player-grid'}`}>{team.players.map(player => {
        const profile = profiles[player.discordId]; const p = getCardProfile(profile, scope);
        if (!compact) return <PlayerCard key={getPlayerKey(player)} player={player} profile={profile} teamIcon={teamIcons[player.discordId]} scope={scope} loading={loading} selected={selected === getPlayerKey(player)} onSelect={() => setSelected(getPlayerKey(player))} onRetry={onRetry}/>;
        const state = getCardState(profile, p, loading, isDiscordSnowflake(player.discordId) ? player.discordId : undefined);
        const usable = state === 'loaded'; const uma = sortTopUmasForCard(p?.allUmas ?? p?.topUmas ?? [])[0];
        return <li key={getPlayerKey(player)}><button className="compact-player-row" onClick={() => setSelected(getPlayerKey(player))} aria-label={`Open details for ${player.displayName}`}>{usable && uma ? <BestUmaPortrait uma={uma}/> : <span className="compact-portrait-empty"/>}<span className="player-identity"><strong>{player.displayName}</strong><small>{usable ? uma ? `${uma.name} · ${uma.matches}g` : 'No ranked Uma stats' : state === 'private' ? 'Stats are private' : state === 'loading' ? 'Loading stats…' : 'Stats unavailable'}</small></span><span className="rank num">{usable ? formatRank(p, false) : '—'}</span><span className="num">{usable ? formatRecord(p) : '—'}</span><span className="num">{usable ? formatDecimal(p?.pointsPerGame) : '—'}</span></button></li>;
      })}</ol></section>)}</div>
    {context && <PlayerDrawer key={`${context.player.discordId}:${scope}`} player={context.player} profile={profiles[context.player.discordId]} teamIcon={teamIcons[context.player.discordId]} scope={scope} loading={loading && !profiles[context.player.discordId]} onClose={() => setSelected(undefined)} onOpenMatch={onOpenMatch}/>}
  </>;
}
