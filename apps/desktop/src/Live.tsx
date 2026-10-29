import { isDiscordSnowflake } from '@umalytics/core/room/rosterIdentity';
import type { DraftSnapshot, PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchRoster } from '@umalytics/shared';

const teamIds = ['team1', 'team2'] as const;
function statusFor(player: PrematchPlayer, profile?: PlayerProfileSummary) {
  return !isDiscordSnowflake(player.discordId) ? 'No linked profile' : !profile ? 'Loading stats…' : profile.statsPrivate ? 'Stats are private' : profile.error ? 'Stats unavailable' : '';
}
function Rank({ profile }: { profile?: PlayerProfileSummary }) {
  return <span className="badge rank num">{!profile || profile.statsPrivate || profile.error || profile.rankUnavailable || (profile.isPartial && profile.rank == null) ? '—' : profile.rank ? `#${profile.rank}` : 'Unranked'}</span>;
}
function Uma({ name, matches }: { name: string; matches?: number }) {
  return <span className="uma-row"><span className="monogram">{name.split(' ').slice(0, 2).map(part => part[0]).join('')}</span><span>{name}</span>{matches !== undefined && <small className="num">{matches}g</small>}</span>;
}
export function Lobby({ roster, profiles, compact, scope, emptyStatus }: {
  roster?: PrematchRoster; profiles: Record<string, PlayerProfileSummary>; compact: boolean; scope: PlayerStatsScope; emptyStatus: string;
}) {
  if (!roster?.players.length) return <section className="empty-state"><h2>Waiting for your room</h2><p>Open a room on Uma Drafter with local sharing turned on</p><p role="status">{emptyStatus}</p></section>;
  return <div className="lobby">{compact && <div className="compact-caption"><span>{scope === 'currentSeason' ? 'Season' : 'All-time'} stats</span><span className="label">Rank · W–L · PPG</span></div>}
    {teamIds.map((team, index) => {
      const players = roster.players.filter(player => player.team === team);
      const ratings = players.map(player => profiles[player.discordId]).filter((p): p is PlayerProfileSummary => !!p && !p.statsPrivate && !p.error && p.rating != null).map(p => p.rating!);
      return <section className={`team team-${index + 1}`} key={team}><div className="team-heading"><i/><h2>{roster.teams?.[team].name ?? `Team ${index + 1}`}</h2>{!compact && <span>{players.length} players</span>}<div className="rule"/><span className="num">{compact ? 'Avg' : 'Avg rating'} <b>{ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : '—'}</b></span></div>
        <div className="player-grid">{players.map(player => {
          const p = profiles[player.discordId]; const message = statusFor(player, p); const usable = p && !message;
          const record = usable && p.wins != null && p.losses != null ? `${p.wins}–${p.losses}` : '—';
          const ppg = usable && p.pointsPerGame != null ? p.pointsPerGame.toFixed(1) : '—';
          const umas = usable ? p.topUmas?.slice(0, 3) ?? [] : [];
          return compact ? <button className="player-row" key={player.discordId} aria-label={`${player.displayName}, ${message || `rank ${p?.rank ?? 'unranked'}, ${record}, ${ppg} PPG`}`}>
            <span className="player-identity"><strong>{player.displayName}</strong>{message ? <small>{message}</small> : umas[0] ? <Uma name={umas[0].name}/> : <small>No ranked Uma stats</small>}</span><Rank profile={p}/><span className="num">{record}</span><span className="num">{ppg}</span>
          </button> : <article className="player-card" key={player.discordId} aria-label={player.displayName}><strong className="player-name">{player.displayName}</strong><div className="badge-area"><Rank profile={p}/></div>
            <div className="player-stats">{[[usable && p.rating != null ? Math.round(p.rating) : '—', 'Rating'], [record, 'W–L'], [usable && p.winRate != null ? `${Math.round(p.winRate * 100)}%` : '—', 'Win'], [ppg, 'PPG']].map(([value, label]) => <div key={label}><b className="num">{value}</b><span className="label">{label}</span></div>)}</div>
            {message ? <small className="profile-status">{message}</small> : <div className="top-umas">{umas.map(uma => <Uma key={uma.umaId} name={uma.name} matches={uma.matches}/>)}</div>}
          </article>;
        })}</div>{!players.length && <p className="muted">Waiting for players</p>}</section>;
    })}</div>;
}

export function Draft({ draft }: { draft?: DraftSnapshot }) {
  if (!draft) return <section className="empty-state"><h2>Waiting for the draft</h2><p>Picks, bans and races will appear when a room is shared.</p></section>;
  const current = draft.currentTeam; const pickPhase = draft.phase === 'uma-pick'; const count = draft.rules?.picks;
  const picked = current ? draft.teams[current].umas.filter(uma => uma.kind === 'pick').length : 0;
  const races = teamIds.flatMap(team => draft.teams[team].maps.filter(map => map.status === 'selected')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return <div className="draft-view"><div className="turn-banner" role="status">{pickPhase && current ? `${draft.teams[current].name ?? current} is picking · Uma pick ${picked + 1}${count ? ` of ${count}` : ''}` : `Draft ${draft.phase?.replaceAll('-', ' ') ?? 'in progress'}`}</div>
    <section className="races"><h2 className="label">Races</h2>{races.map((race, i) => <div className={`race team-${race.team === 'team1' ? 1 : 2}`} key={`${race.team}-${i}`}><i/>{race.name}{race.details ? ` · ${race.details}` : ''}</div>)}{draft.tiebreakerMap && <div className="race">Tiebreaker · {draft.tiebreakerMap.name} {draft.tiebreakerMap.details}</div>}{!races.length && <p className="muted">No races selected yet</p>}</section>
    <div className="draft-teams">{teamIds.map((team, i) => {
      const side = draft.teams[team]; const picks = side.umas.filter(uma => uma.kind === 'pick'); const bans = side.umas.filter(uma => uma.kind !== 'pick');
      return <section className={`team-${i + 1}`} key={team}><div className="team-heading"><i/><h2>{side.name ?? `Team ${i + 1}`}</h2></div><div className="pick-list">{Array.from({ length: Math.max(count ?? picks.length, picks.length) }, (_, slot) => <div key={slot} className={`slot ${picks[slot] ? '' : current === team && pickPhase && slot === picks.length ? 'now' : 'empty'}`}>{picks[slot] ? <Uma name={picks[slot].name}/> : current === team && pickPhase && slot === picks.length ? 'Picking…' : 'Open slot'}</div>)}</div><h3 className="label">Bans</h3><div className="pick-list">{bans.map((ban, n) => <div className="slot ban" key={`${ban.umaId}-${n}`}>{ban.name}</div>)}{!bans.length && <span className="muted">No bans</span>}</div></section>;
    })}</div></div>;
}
