import kits from '../src-tauri/data/role-kits.json' with { type: 'json' };
import pool from '../src-tauri/data/drafter-map-pool-global.json' with { type: 'json' };
import { replayEnvelopes } from './replay-fixture.mjs';
import fixture from '../../../tests/fixtures/casual-room-replay.json' with { type: 'json' };

// These synthetic records exist only in the local screenshot harness.
export const players = Array.from({ length: 10 }, (_, i) => ({
  userId: `fixture-${i}`, discordId: String(100000000000000301n + BigInt(i)),
  displayName: `Replay Player ${i + 1}`, discordUsername: i === 2 ? 'replay.racer' : i === 1 ? 'Replay Player 2' : undefined, team: i < 5 ? 'team1' : 'team2', role: 'player'
}));
const longUmaIds = ['100902', '106802', '101303', '101302', '103202', '105302', '100402', '102302', '101502', '105202', '100602', '100802', '100202', '104802'];
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
  umas: [
    { card_id: 103102, name: 'Ines Fujin', title: '[Melt Your Heart]', unique_skill_id: 110311, aptitudes: { distance: [1, 7, 7, 5], style: [7, 5, 1, 1], ground: [7, 1] } },
    { card_id: 106201, name: 'Matikanetannhauser', title: '[Clippety-Tippety-Clop]', unique_skill_id: 100621, aptitudes: { distance: [1, 4, 7, 7], style: [2, 7, 7, 3], ground: [7, 1] } },
  ],
  skills: [{ id: 1, name: 'Replay Recovery', hp_recovery: true, rarity: 'gold', icon_path: 'fixture-heal.webp' },
    { id: 2, name: 'Replay Recovery II', hp_recovery: true, rarity: 'white', icon_path: 'fixture-heal.webp' },
    { id: 110311, name: 'Fresh☆Parlor', hp_recovery: false, rarity: 'unique', icon_path: 'fixture-heal.webp' },
    { id: 100621, name: 'Go Go Mun!', hp_recovery: false, rarity: 'unique', icon_path: 'fixture-heal.webp' },
    { id: 201241, name: 'Front Runner Straightaways ◎', hp_recovery: false, rarity: 'white', icon_path: 'fixture-heal.webp' }, ...[...new Set([...Object.values(kits).filter(Array.isArray).flat(), 202051, 210052])].map(id => ({ id, name: id === 202051 ? 'Runaway' : id === 210052 ? 'Ignited Spirit WIT' : `Fixture kit skill ${id}`, hp_recovery: false, rarity: 'white', icon_path: null }))]
};
export const screenshotCatalog = {
  ...catalog,
  screenshot_skills: {
    110311: { cost: null, tier: null },
    210052: { cost: null, tier: null },
    200501: { cost: 120, tier: { group: 20050, rank: 2 } },
    200502: { cost: 120, tier: { group: 20050, rank: 1 } },
    910311: { cost: 200, tier: null },
  },
  skills: [
    ...catalog.skills.filter(skill => ![200501, 200502, 910311].includes(skill.id)),
    { id: 200501, name: 'Lane Legerdemain', rarity: 'gold', hp_recovery: false, icon_path: 'fixture-heal.webp' },
    { id: 200502, name: 'Go with the Flow', rarity: 'white', hp_recovery: false, icon_path: 'fixture-heal.webp' },
    { id: 910311, name: 'Fresh☆Parlor (inherited)', rarity: 'white', hp_recovery: true, icon_path: 'fixture-heal.webp' },
  ],
};

const read = (raw_name, id, fields) => ({
  raw_name, resolution: id ? { matched: { id, confidence: 1 } } : null,
  fields: { level: null, cost: null, hint: null, obtained: null, ...fields },
});
const scan = (screen, data) => ({
  screen, card: null, attributes: null, skill_points: null, instruction: null, skills: [], ...data,
});
const card = { id: 103102, name: 'Ines Fujin', title: '[Melt Your Heart]' };
export const screenshotScans = [
  scan('learn', { skill_points: 200, skills: [
    read('Lane Legerdemain', 200501, { cost: 228, hint: 1 }),
    read('Go with the Flow', 200502, { cost: 120 }),
    read('Fresh☆Parlor', 910311, { cost: 170, hint: 1 }),
    read('Fresh☆Parlor', 110311, { obtained: true }),
  ] }),
  scan('attributes-chart', { card, instruction: 'Switch to the number view' }),
  scan('attributes-numbers', { card, attributes: { stats: [1210, 715, 817, 632, 635], track: 'SE', distance: 'EBSA', style: 'ABCG' } }),
  scan('career-skills', { card, skills: [
    read('Fresh☆Parlor', 110311),
    read('Ignited Spint WIT', null),
    { ...read('Carnival Bonus', null), resolution: 'ignored_no_race_effect' },
  ] }),
  scan('learn', { skill_points: 200, skills: [read('Go with the Flow', 200502, { cost: 120 })] }),
  scan('unsupported', { instruction: 'Learned Skills screen' }),
];
export function apiResponse(url, scene) {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/esports/league') return { standings: [{ teamId: 'fixture-team' }] };
  if (parsed.pathname === '/api/esports/teams/fixture-team') return { team: { id: 'fixture-team', name: 'Replay Racing League', logoUrl: 'https://drafter.uma.guide/fixture-team.png', roster: players.map(p => ({ discordId: p.discordId })) } };
  if (parsed.pathname === '/api/seasons') return [{ id: 'replay-season', active: true, name: 'Replay Season' }];
  if (parsed.pathname === '/api/leaderboard') {
    const entries = players.map((p, i) => ({ userId: p.discordId, displayName: p.displayName, discordUsername: p.discordUsername, rating: 1800 - i * 31, rd: 50, wins: i === 0 ? 212 : 12, losses: i === 0 ? 119 : 8 }));
    entries.splice(5, 0, ...Array.from({ length: 13 }, (_, i) => ({ userId: String(100000000000001001n + BigInt(i)), displayName: `Leaderboard fixture ${i + 1}`, rating: 1675 - i, rd: 50, wins: 12, losses: 8 })));
    if (scene === 'profile-worst') return { entries: entries.filter(e => e.userId !== players[0].discordId) };
    if (scene === 'badge-layout') return { entries: entries.filter(e => e.userId !== players[4].discordId) };
    return { entries };
  }
  if (parsed.pathname === '/api/players/directory-search') return { players: players.map(p => ({ discordId: p.discordId, discordUsername: p.displayName })) };
  if (/^\/api\/stats\/players\/\d+\/profile$/.test(parsed.pathname)) return { title: 'Replay Champion' };
  if (/^\/api\/stats\/players\/\d+\/history$/.test(parsed.pathname)) {
    const total = scene.startsWith('profile-') ? (parsed.searchParams.has('season') ? 55 : 63) : 25;
    const start = (Number(parsed.searchParams.get('page') ?? 1) - 1) * 20;
    return { total, playerHistory: Array.from({ length: Math.min(20, total - start) }, (_, offset) => {
      const i = start + offset;
      return { matchId: i === 0 ? 'ABC123' : `PD${String(i).padStart(4, '0')}`, verificationState: 'confirmed', isWinner: i % 2 === 0, pointsScored: i % 15,
        reportedAt: `2026-11-${String(7 - i % 7).padStart(2, '0')}T12:00:00Z`, mode: 'ranked', selectedUmaId: scene === 'profile-worst' ? longUmaIds[i % longUmaIds.length] : String(100101 + i % 8 * 100),
        podiumPlacements: 2, isMvp: i % 3 === 0, eloDelta: i % 2 === 0 ? 12 : -8, eloPlacement: false };
    }) };
  }
  if (parsed.pathname === '/api/matches/ABC123') {
    const savedSide = (offset) => ({ ...side(offset, 5), bannedMaps: [],
      pickedMaps: [{ id: `fixture-course-${offset}`, name: `Replay track ${offset + 1}`, track: `Replay track ${offset + 1}`, distance: 2400, surface: 'Turf' }] });
    return { id: 'ABC123', status: 'completed', report: { reportedAt: '2026-10-20T12:00:00Z', participants: players.map(p => ({ ...p, displayDiscordUsername: p.discordUsername ?? p.displayName })),
      draftSnapshot: { phase: 'complete', team1: savedSide(0), team2: savedSide(1),
        draftActionHistory: [0, 1].map(offset => ({ action: 'map-pick', actorTeam: `team${offset + 1}`, map: { id: `fixture-course-${offset}` } })),
        multiplayer: { team1Name: 'Replay Blue', team2Name: 'Replay Orange' },
        rules: { map: { picksPerTeam: 1, bansPerTeam: 0 }, uma: { teamSize: 5, preBansPerTeam: 1 } } } } };
  }
  const player = parsed.pathname.match(/^\/api\/stats\/players\/(\d+)\/stats$/)?.[1];
  if (player) {
    if (scene.startsWith('profile-')) {
      const multiplier = parsed.searchParams.has('season') ? 1 : 2;
      const entries = Array.from({ length: 14 }, (_, i) => ({ umaId: scene === 'profile-worst' ? longUmaIds[i] : i === 0 ? '100402' : String(100101 + i * 100), matches: (i >= 11 ? 2 : i === 0 ? 80 : 30 - i) * multiplier, wins: (i >= 11 ? 1 : i === 0 ? 29 : 18) * multiplier, losses: (i >= 11 ? 1 : i === 0 ? 51 : 12 - i) * multiplier, pointsScored: (i >= 11 ? 2 : i === 0 ? 80 : 30 - i) * multiplier * 8, podiumPlacements: 5, mvpMatches: 2 }));
      return { summary: { matchesIncluded: 331 * multiplier, totalPointsScored: 2648 * multiplier, totalPodiumPlacements: 993 * multiplier, totalMvpMatches: 108 * multiplier }, umaEntries: entries };
    }
    if (scene === 'usability') {
      const entries = Array.from({ length: 12 }, (_, i) => ({ umaId: String(100101 + i * 100), matches: i === 11 ? 2 : 20 - i, wins: i === 11 ? 1 : 10, losses: i === 11 ? 1 : 10 - i, pointsScored: (i === 11 ? 2 : 20 - i) * 7, podiumPlacements: 5, mvpMatches: 1 }));
      const games = entries.reduce((sum, entry) => sum + entry.matches, 0);
      return { summary: { matchesIncluded: games, totalPointsScored: games * 7, totalPodiumPlacements: games * 3, totalMvpMatches: 12 }, umaEntries: entries };
    }
    const i = players.findIndex(p => p.discordId === player);
    const multiplier = parsed.searchParams.has('season') ? 1 : 2;
    if (scene === 'badge-layout' && [0, 4].includes(i)) return { summary: { matchesIncluded: 30, totalPointsScored: 90, totalPodiumPlacements: 0, totalMvpMatches: 0 }, umaEntries: [{ umaId: '100101', matches: 3, wins: 1, losses: 2, pointsScored: 9 }] };
    if (scene === 'badge-layout' && i === 1) return { summary: { matchesIncluded: 30, totalPointsScored: 90, totalPodiumPlacements: 0, totalMvpMatches: 0 }, umaEntries: [{ umaId: '100101', matches: 20, wins: 10, losses: 10, pointsScored: 60 }] };
    if (i === 2) return {
      summary: { matchesIncluded: 30 * multiplier, totalPointsScored: 195 * multiplier, totalPodiumPlacements: 30 * multiplier, totalMvpMatches: 9 * multiplier },
      umaEntries: Array.from({ length: 8 }, (_, j) => ({ umaId: String(100101 + j * 100), matches: (j < 6 ? 4 : 3) * multiplier,
        wins: 2 * multiplier, losses: (j < 6 ? 2 : 1) * multiplier, pointsScored: 24 * multiplier, podiumPlacements: 3 * multiplier, mvpMatches: multiplier }))
    };
    return { summary: { matchesIncluded: 27 * multiplier, totalPointsScored: (180 + i * 3) * multiplier, totalPodiumPlacements: 81 * multiplier, totalMvpMatches: 3 }, umaEntries: [...[100101, 100201, 100301].map((id, j) => ({ umaId: String(id), matches: (10 - j) * multiplier,
      wins: (6 - j) * multiplier - (j === 2 ? 1 : 0), losses: 4 * multiplier - (j === 2 ? 1 : 0), pointsScored: (70 - j * 10 + i) * multiplier, podiumPlacements: 4, mvpMatches: 1 })), { umaId: '100401', matches: 2, wins: 1, losses: 1, pointsScored: 10, podiumPlacements: 2, mvpMatches: 0 }] };
  }
  throw new Error(`Unexpected API path: ${parsed.pathname}`);
}
export function staminaResult(input, thresholdOffset = 0, activationRate = 1) {
  const healing = input.build.skills.filter(s => catalog.skills.find(meta => meta.id === s.id)?.hp_recovery);
  const seeds = (input.seeds ?? (healing.length ? 512 : 256)) * (input.target === 99 ? 10 : input.target === 95 ? 2 : 1);
  const fraction = .055 * activationRate * healing.length;
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
    heal_equivalents: healing.map(s => ({ skill_id: s.id, fraction: .055, activation_rate: activationRate, stamina: equivalent(input.build.stats.stamina) / healing.length, variable: false })),
    seeds, races: 3456, elapsed_ms: 1250, ms_per_race: .36, course };
}
