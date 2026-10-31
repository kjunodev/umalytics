import type { DraftSnapshot, DraftUmaAction } from '@umalytics/shared';
import { UmaImage, getFallbackUmaImageUrl } from '@umalytics/ui/common/UmaImage';
import { isHashedUmaAssetUrl } from '@umalytics/core/umas/umaPortraits';
import { phaseLabel } from './phase';

const teamIds = ['team1', 'team2'] as const;
function Portrait({ action }: { action: DraftUmaAction }) {
  const fallback = action.umaId ? getFallbackUmaImageUrl(action.umaId) : undefined;
  return <span className="draft-portrait"><UmaImage imageUrl={isHashedUmaAssetUrl(action.imageUrl) ? fallback : action.imageUrl ?? fallback} name={action.name}/></span>;
}
export function DraftLoading() {
  return <section className="draft-loading" role="status" aria-label="Reading draft"><h2>Reading draft</h2><div>{[0, 1, 2].map(column => <div key={column}>{[0, 1, 2, 3, 4].map(row => <span key={row}/>)}</div>)}</div></section>;
}
export function Draft({ draft, pickOrder, loading = false }: { draft?: DraftSnapshot; pickOrder?: DraftUmaAction[]; loading?: boolean }) {
  if (!draft) return loading ? <DraftLoading/> : <section className="empty-state"><h2>Waiting for the draft</h2><p>Race picks, Uma picks, bans and vetoes appear when the draft starts.</p></section>;
  const current = draft.currentTeam;
  const pickPhase = draft.phase === 'uma-pick';
  const complete = draft.phase === 'complete';
  const count = draft.rules?.picks ?? 6;
  const picked = current ? draft.teams[current].umas.filter(uma => uma.kind === 'pick').length : 0;
  const raceCount = 2 * Math.max((draft.rules?.maps ?? 4) - (draft.rules?.mapVetoes ?? 1), 0);
  const races = teamIds.flatMap(team => draft.teams[team].maps.filter(map => map.status === 'selected')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const vetoed = teamIds.flatMap(team => draft.teams[team].maps.filter(map => map.status === 'vetoed'));
  const teamPanel = (team: typeof teamIds[number], index: number) => {
    const side = draft.teams[team];
    const picks = side.umas.filter(uma => uma.kind === 'pick');
    const groups = [{ kind: 'pick', label: 'Picks', count, empty: 'Open slot' }, { kind: 'ban', label: 'Bans', count: draft.rules?.bans ?? 2, empty: 'Ban pending' }, { kind: 'veto', label: 'Veto', count: draft.rules?.vetoes ?? 1, empty: 'Veto pending' }] as const;
    return <section className={`arena-draft-team team-${index + 1}`} key={team}>
      <div className="arena-draft-heading"><h2>{side.name ?? `Team ${index + 1}`}</h2><span>{picks.length}/{count} picked</span></div>
      {groups.map(group => {
        const actions = side.umas.filter(uma => uma.kind === group.kind);
        return <div className="arena-draft-group" key={group.kind}><h3 className="label">{group.label}</h3><ol>{Array.from({ length: Math.max(group.count, actions.length) }, (_, slot) => {
          const action = actions[slot]; const now = !complete && current === team && slot === actions.length && (group.kind === 'pick' ? pickPhase : draft.phase === `uma-${group.kind}`);
          return <li key={slot} className={`slot ${action ? group.kind === 'pick' ? 'filled' : 'ban' : 'empty'} ${now ? 'now' : ''}`}>
            {action ? <Portrait action={action}/> : <span className="draft-portrait placeholder" aria-hidden="true"/>}<span className="slot-name" title={action?.name}>{action?.name ?? (now ? group.kind === 'pick' ? 'Picking…' : `${group.label} in progress…` : group.empty)}</span><small>{group.kind === 'pick' ? `Pick ${slot + 1}` : group.label}</small>
          </li>;
        })}</ol></div>;
      })}
    </section>;
  };
  return <section className="arena-draft draft-scene" aria-label="Live draft view">
    <div className={`turn-banner ${complete ? 'done' : current === 'team1' ? 'team-1' : 'team-2'}`} role="status"><i/><b>{pickPhase && current ? `${draft.teams[current].name ?? current} is picking` : phaseLabel(draft.phase)}</b><span>{pickPhase ? `Uma pick ${picked + 1} of ${count}` : complete ? 'All picks locked in · ready to race' : 'Uma slots open · waiting for race picks'}</span></div>
    <div className="arena-draft-columns draft-columns">{teamPanel('team1', 0)}<div className="arena-draft-center">
      <section className="arena-races"><h2 className="label">Races · {raceCount} picked + tiebreaker</h2><ol>{Array.from({ length: Math.max(raceCount, races.length) }, (_, index) => {
        const race = races[index]; return <li className={`arena-race ${race?.team === 'team1' ? 'team-1' : 'team-2'} ${race ? '' : 'pending'}`} key={index}><b className="num">{index + 1}</b><span>{race ? <><strong>{race.track ?? race.name}{race.distance ? ` ${race.distance}` : ''}{race.variant ? ` ${race.variant}` : ''}</strong><small>{[race.surface, race.ground, race.weather, race.season].filter(Boolean).join(' · ') || race.details || 'Conditions not shared'}</small></> : <strong>Awaiting race pick</strong>}</span><i/></li>;
      })}<li className={`arena-race tiebreaker ${draft.tiebreakerMap ? '' : 'pending'}`}><b className="num">TB</b><span><strong>{draft.tiebreakerMap ? `${draft.tiebreakerMap.track ?? draft.tiebreakerMap.name}${draft.tiebreakerMap.distance ? ` ${draft.tiebreakerMap.distance}` : ''}` : 'Awaiting tiebreaker'}</strong>{draft.tiebreakerMap && <small>{[draft.tiebreakerMap.surface, draft.tiebreakerMap.ground, draft.tiebreakerMap.weather, draft.tiebreakerMap.season].filter(Boolean).join(' · ') || draft.tiebreakerMap.details || 'Conditions not shared'}</small>}</span><i/></li></ol>
        {!!vetoed.length && <p className="vetoed-maps">Vetoed maps: {vetoed.map((race, index) => <s key={index}>{race.name}{index < vetoed.length - 1 ? ', ' : ''}</s>)}</p>}
      </section>
      {pickOrder?.length ? <section className="arena-pick-order"><h2 className="label">Pick order · {pickOrder.length} made</h2><ol>{pickOrder.map((action, index) => <li className={action.team === 'team1' ? 'team-1' : 'team-2'} key={`${action.team}-${index}`} title={`${index + 1}. ${draft.teams[action.team].name}: ${action.name}`}><Portrait action={action}/><span className="num">{index + 1}</span></li>)}</ol></section> : null}
    </div>{teamPanel('team2', 1)}</div>
  </section>;
}
