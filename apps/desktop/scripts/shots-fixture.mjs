import pool from '../src-tauri/data/drafter-map-pool-global.json' with { type: 'json' };
import { replayEnvelopes } from './replay-fixture.mjs';
import fixture from '../../../tests/fixtures/casual-room-replay.json' with { type: 'json' };

// These synthetic records exist only in the local screenshot harness.
export const players = Array.from({ length: 10 }, (_, i) => ({
  userId: `fixture-${i}`, discordId: String(100000000000000301n + BigInt(i)),
  displayName: `Replay Player ${i + 1}`, team: i < 5 ? 'team1' : 'team2', role: 'player'
}));
const uma = id => ({ id, name: `Fixture Uma ${id}` });
const side = (offset, picked) => ({ pickedUmas: Array.from({ length: picked }, (_, i) => uma(String(100101 + offset + i * 100))),
  preBannedUmas: [uma(String(101001 + offset))], bannedUmas: [],
  pickedMaps: [{ id: `fixture-course-${offset}`, track: `Replay track ${offset + 1}`, distance: 2400 + offset * 100, surface: 'Turf' }], bannedMaps: [] });
export const messages = [
  ...replayEnvelopes(fixture).slice(0, -1),
  { v: 1, roomCode: fixture.room, event: { type: 'match.snapshot', matchId: fixture.room, version: 999,
    state: { phase: 'uma-pick', currentTeam: 'team2', rules: { picks: 5, maps: 2, bans: 1 },
      team1: side(0, 4), team2: side(1, 3), multiplayer: { team1Name: 'Replay Blue', team2Name: 'Replay Orange', rankedQueueRoster: players } } } }
];
export const catalog = {
  courses: pool.maps.map((map, i) => ({ id: map.id, track_name: map.track, distance: map.distance,
    surface: map.surface === 'Turf' ? 1 : 2, direction: map.direction === 'right' ? 1 : map.direction === 'left' ? 2 : 3,
    variant: map.variant, course_set_id: 10000 + i, race_instance_id: 9001 + i, race_id: 1000 + i,
    grade: 100, time: 2, month: 4, instance_reason: 'Screenshot fixture on exact course', unavailable_reason: map.id === 'morioka-2000-dirt' ? 'Engine course geometry missing: courseeventparam 11504.' : null })),
  skills: [{ id: 1, name: 'Replay Recovery', hp_recovery: true }, { id: 2, name: 'Replay Recovery II', hp_recovery: true }]
};
export function apiResponse(url) {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/seasons') return [{ id: 'replay-season', active: true, name: 'Replay Season' }];
  if (parsed.pathname === '/api/leaderboard') return { entries: players.map((p, i) => ({ userId: p.discordId, displayName: p.displayName, rating: 1800 - i * 31, rd: 50, wins: 12, losses: 8 })) };
  if (parsed.pathname === '/api/players/directory-search') return { players: players.map(p => ({ discordId: p.discordId, discordUsername: p.displayName })) };
  if (/^\/api\/stats\/players\/\d+\/profile$/.test(parsed.pathname)) return { title: 'Replay Champion' };
  if (/^\/api\/stats\/players\/\d+\/history$/.test(parsed.pathname)) return { total: 6, playerHistory: Array.from({ length: 6 }, (_, i) => ({
    matchId: 'ABC123', verificationState: 'confirmed', isWinner: i % 2 === 0, pointsScored: 12 - i,
    reportedAt: '2026-10-20T12:00:00Z', mode: 'ranked', selectedUmaId: '100101',
    podiumPlacements: 2, isMvp: i === 0, eloDelta: i % 2 === 0 ? 12 : -8, eloPlacement: false
  })) };
  if (parsed.pathname === '/api/matches/ABC123') {
    const savedSide = (offset) => ({ ...side(offset, 5), bannedMaps: [],
      pickedMaps: [{ id: `fixture-course-${offset}`, name: `Replay track ${offset + 1}`, track: `Replay track ${offset + 1}`, distance: 2400, surface: 'Turf' }] });
    return { id: 'ABC123', status: 'completed', report: { participants: players,
      draftSnapshot: { phase: 'complete', team1: savedSide(0), team2: savedSide(1),
        draftActionHistory: [0, 1].map(offset => ({ action: 'map-pick', actorTeam: `team${offset + 1}`, map: { id: `fixture-course-${offset}` } })),
        multiplayer: { team1Name: 'Replay Blue', team2Name: 'Replay Orange' },
        rules: { map: { picksPerTeam: 1, bansPerTeam: 0 }, uma: { teamSize: 5, preBansPerTeam: 1 } } } } };
  }
  const player = parsed.pathname.match(/^\/api\/stats\/players\/(\d+)\/stats$/)?.[1];
  if (player) {
    const i = players.findIndex(p => p.discordId === player);
    const multiplier = parsed.searchParams.has('season') ? 1 : 2;
    return { summary: { matchesIncluded: 27 * multiplier, totalPointsScored: (180 + i * 3) * multiplier, totalPodiumPlacements: 12, totalMvpMatches: 3 }, umaEntries: [100101, 100201, 100301].map((id, j) => ({ umaId: String(id), matches: (10 - j) * multiplier,
      wins: (6 - j) * multiplier, losses: 4 * multiplier, pointsScored: (70 - j * 10 + i) * multiplier, podiumPlacements: 4, mvpMatches: 1 })) };
  }
  throw new Error(`Unexpected API path: ${parsed.pathname}`);
}
export function staminaResult(input) {
  const rate = (stamina, center) => Math.min(100, Math.max(0, 100 / (1 + Math.exp(-(stamina - center) / 57))));
  const point = stamina => ({ stamina, seeds: 32, survival_percent: rate(stamina, 820), full_spurt_percent: rate(stamina, 920),
    full_spurt_at_entry_percent: rate(stamina, 950), avg_min_hp: Math.max(0, (stamina - 790) * .42) });
  const curve = Array.from({ length: 17 }, (_, i) => point(600 + i * 50));
  const course = catalog.courses.find(c => c.id === input.race.map_id);
  const thresholds = { full_spurt: 1050, survival: 950 };
  return { input: structuredClone(input), request_id: input.request_id, curve, current: point(input.build.stats.stamina),
    thresholds, needed_effective_stamina: input.build.skills.length ? { full_spurt: 1100, survival: 1000 } : thresholds, effective_stamina: input.build.stats.stamina + input.build.skills.length * 200,
    heal_equivalents: input.build.skills.map(s => ({ skill_id: s.id, fraction: .055, stamina: 200, variable: false })),
    seeds: input.seeds ?? (input.build.skills.length ? 1000 : 256), races: 3456, elapsed_ms: 1250, ms_per_race: .36, course };
}
