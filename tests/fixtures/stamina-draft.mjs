import pool from '../../apps/desktop/src-tauri/data/drafter-map-pool-global.json' with { type: 'json' };

export function draftSnapshotFixture(partial = false) {
  const ids = ['tokyo-1600-turf', 'morioka-2000-dirt', 'tokyo-2000-turf', 'nakayama-2500-turf-inner', 'kyoto-3000-turf-outer', 'hanshin-3200-turf-outer-to-inner', 'fukushima-1150-dirt'];
  const maps = ids.map((id, i) => {
    const c = pool.maps.find(c => c.id === id);
    return { mapId: id, team: i < 3 ? 'team1' : 'team2', name: `${c.track} ${c.distance}`, track: c.track, distance: c.distance, surface: c.surface, variant: c.variant ?? undefined, status: 'selected', ground: ['Firm', 'Good', 'Soft', 'Heavy'][i % 4], weather: ['Sunny', 'Cloudy', 'Rainy', 'Snowy'][i % 4], season: ['Spring', 'Summer', 'Fall', 'Winter'][i % 4] };
  });
  return { matchCode: 'ABC123', version: 1000, source: 'synced-draft-state', updatedAt: 1, phase: partial ? 'map-pick' : 'complete',
    teams: { team1: { id: 'team1', maps: maps.slice(0, partial ? 1 : 3), umas: [] }, team2: { id: 'team2', maps: partial ? [] : maps.slice(3, 6), umas: [] } },
    ...(partial ? {} : { tiebreakerMap: maps[6] }) };
}
