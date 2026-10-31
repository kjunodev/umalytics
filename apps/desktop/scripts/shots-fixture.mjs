import kits from '../src-tauri/data/role-kits.json' with { type: 'json' };
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
  pickedMaps: Array.from({ length: 3 }, (_, i) => ({ id: `fixture-course-${offset}-${i}`, track: `Replay track ${offset + i * 2 + 1}`, distance: 2400 + i * 100, surface: 'Turf', conditions: { ground: 'Good', weather: 'Sunny', season: 'Spring' } })), bannedMaps: [] });
export const messages = [
  ...replayEnvelopes(fixture).slice(0, -1),
  { v: 1, roomCode: fixture.room, event: { type: 'match.snapshot', matchId: fixture.room, version: 999,
    state: { phase: 'uma-pick', currentTeam: 'team2', rules: { picks: 5, maps: 4, bans: 1, mapVetoes: 1 },
      wildcardMap: { track: 'Replay tiebreaker', distance: 2000, surface: 'Dirt', conditions: { ground: 'Firm', weather: 'Cloudy', season: 'Winter' } },
      team1: side(0, 4), team2: side(1, 3), multiplayer: { team1Name: 'Replay Blue', team2Name: 'Replay Orange', rankedQueueRoster: players } } } }
];
export const catalog = {
  courses: pool.maps.map((map, i) => ({ id: map.id, track_name: map.track, distance: map.distance,
    surface: map.surface === 'Turf' ? 1 : 2, direction: map.direction === 'right' ? 1 : map.direction === 'left' ? 2 : 3,
    variant: map.variant, course_set_id: 10000 + i, race_instance_id: 9001 + i, race_id: 1000 + i,
    grade: 100, time: 2, month: 4, instance_reason: 'Screenshot fixture on exact course', unavailable_reason: null })),
  local_skill_data: true,
  local_skill_path: 'C:\\Users\\Player\\Documents\\UmaLytics-GameData\\gametora', local_skill_count: 1204, local_icon_count: 312,
  skills: [{ id: 1, name: 'Replay Recovery', hp_recovery: true, rarity: 'gold', icon_path: 'fixture-heal.webp' },
    { id: 2, name: 'Replay Recovery II', hp_recovery: true, rarity: 'white', icon_path: 'fixture-heal.webp' },
    { id: 3, name: 'Replay Unique', hp_recovery: false, rarity: 'unique', icon_path: 'fixture-heal.webp' },
    { id: 201241, name: 'Front Runner Straightaways ◎', hp_recovery: false, rarity: 'white', icon_path: 'fixture-heal.webp' }, ...[...new Set([...Object.values(kits).filter(Array.isArray).flat(), 202051, 210052])].map(id => ({ id, name: id === 202051 ? 'Runaway' : id === 210052 ? 'Ignited Spirit WIT' : `Fixture kit skill ${id}`, hp_recovery: false, rarity: 'white', icon_path: null }))]
};
export function apiResponse(url) {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/seasons') return [{ id: 'replay-season', active: true, name: 'Replay Season' }];
  if (parsed.pathname === '/api/leaderboard') {
    const entries = players.map((p, i) => ({ userId: p.discordId, displayName: p.displayName, rating: 1800 - i * 31, rd: 50, wins: i === 0 ? 212 : 12, losses: i === 0 ? 119 : 8 }));
    entries.splice(5, 0, ...Array.from({ length: 13 }, (_, i) => ({ userId: String(100000000000001001n + BigInt(i)), displayName: `Leaderboard fixture ${i + 1}`, rating: 1675 - i, rd: 50, wins: 12, losses: 8 })));
    return { entries };
  }
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
    return { id: 'ABC123', status: 'completed', report: { reportedAt: '2026-10-20T12:00:00Z', participants: players,
      draftSnapshot: { phase: 'complete', team1: savedSide(0), team2: savedSide(1),
        draftActionHistory: [0, 1].map(offset => ({ action: 'map-pick', actorTeam: `team${offset + 1}`, map: { id: `fixture-course-${offset}` } })),
        multiplayer: { team1Name: 'Replay Blue', team2Name: 'Replay Orange' },
        rules: { map: { picksPerTeam: 1, bansPerTeam: 0 }, uma: { teamSize: 5, preBansPerTeam: 1 } } } } };
  }
  const player = parsed.pathname.match(/^\/api\/stats\/players\/(\d+)\/stats$/)?.[1];
  if (player) {
    const i = players.findIndex(p => p.discordId === player);
    const multiplier = parsed.searchParams.has('season') ? 1 : 2;
    return { summary: { matchesIncluded: 27 * multiplier, totalPointsScored: (180 + i * 3) * multiplier, totalPodiumPlacements: 81 * multiplier, totalMvpMatches: 3 }, umaEntries: [...[100101, 100201, 100301].map((id, j) => ({ umaId: String(id), matches: (10 - j) * multiplier,
      wins: (6 - j) * multiplier - (j === 2 ? 1 : 0), losses: 4 * multiplier - (j === 2 ? 1 : 0), pointsScored: (70 - j * 10 + i) * multiplier, podiumPlacements: 4, mvpMatches: 1 })), { umaId: '100401', matches: 2, wins: 1, losses: 1, pointsScored: 10, podiumPlacements: 2, mvpMatches: 0 }] };
  }
  throw new Error(`Unexpected API path: ${parsed.pathname}`);
}
export function staminaResult(input, thresholdOffset = 0) {
  const healing = input.build.skills.filter(s => catalog.skills.find(meta => meta.id === s.id)?.hp_recovery);
  const seeds = (input.seeds ?? (healing.length ? 512 : 256)) * (input.target === 99 ? 10 : input.target === 95 ? 2 : 1);
  const fraction = .055 * healing.length;
  const passRate = .925 ** healing.length;
  const rate = (stamina, center) => Math.min(100, Math.max(0, 100 / (1 + Math.exp(-(stamina - center - thresholdOffset) / 57))));
  const point = (stamina, samples = 32) => {
    const conditional = { survival_percent: rate(stamina, 820), full_spurt_percent: rate(stamina, 920),
      full_spurt_at_entry_percent: rate(stamina, 950), avg_min_hp: Math.max(0, (stamina - 790) * .42) };
    const unconditional = { ...conditional, survival_percent: conditional.survival_percent * passRate,
      full_spurt_percent: conditional.full_spurt_percent * passRate, full_spurt_at_entry_percent: conditional.full_spurt_at_entry_percent * passRate };
    const rates = input.assume_skills_activate ? conditional : unconditional;
    return { stamina, seeds: samples, ...rates, joint_percent: Math.max(0, rates.full_spurt_percent + rates.survival_percent - 100) };
  };
  const curve = Array.from({ length: 17 }, (_, i) => point(600 + i * 50));
  const course = catalog.courses.find(c => c.id === input.race.map_id);
  const offset = thresholdOffset + (input.target === 99 ? 150 : input.target === 95 ? 50 : 0);
  const thresholds = { joint: 1070 + offset, full_spurt: 1050 + offset, survival: 950 + offset };
  const coef = input.build.running_style === 1 && input.build.skills.some(s => s.id === 202051) ? .86 : [.95, .89, 1, .995][input.build.running_style - 1];
  const equivalent = stamina => fraction * (stamina + course.distance / (.8 * coef));
  return { input: structuredClone(input), request_id: input.request_id, curve, current: point(input.build.stats.stamina, seeds),
    thresholds, threshold_samples: { joint: { seeds }, full_spurt: { seeds }, survival: { seeds } }, needed_effective_stamina: { joint: thresholds.joint + equivalent(thresholds.joint), full_spurt: thresholds.full_spurt + equivalent(thresholds.full_spurt), survival: thresholds.survival + equivalent(thresholds.survival) },
    effective_stamina: input.build.stats.stamina + equivalent(input.build.stats.stamina),
    heal_equivalents: healing.map(s => ({ skill_id: s.id, fraction: .055, stamina: equivalent(input.build.stats.stamina), variable: false })),
    seeds, races: 3456, elapsed_ms: 1250, ms_per_race: .36, course };
}
