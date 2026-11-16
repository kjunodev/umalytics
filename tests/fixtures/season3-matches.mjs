// Synthetic Season 3 match records. Shapes follow the Uma Drafter match report;
// every code, player ID and name here is made up.
const course = (id, name, track, surface, distance, direction, conditions, variant) =>
  ({ id, name, track, surface, ...(variant ? { variant } : {}), distance, direction, conditions });
const SUNNY_FIRM = (season) => ({ ground: 'Firm', weather: 'Sunny', season });

const turf = {
  team1: [
    course('fx-nakayama-2000-turf-inner', 'Nakayama - 2000m Turf (Inner)', 'Nakayama', 'Turf', 2000, 'right', SUNNY_FIRM('Summer'), 'Inner'),
    course('fx-fukushima-2000-turf', 'Fukushima - 2000m Turf', 'Fukushima', 'Turf', 2000, 'right', SUNNY_FIRM('Spring')),
    course('fx-hakodate-1800-turf', 'Hakodate - 1800m Turf', 'Hakodate', 'Turf', 1800, 'right', SUNNY_FIRM('Winter'))
  ],
  team2: [
    course('fx-kokura-2000-turf', 'Kokura - 2000m Turf', 'Kokura', 'Turf', 2000, 'right', SUNNY_FIRM('Summer')),
    course('fx-sapporo-1500-turf', 'Sapporo - 1500m Turf', 'Sapporo', 'Turf', 1500, 'right', SUNNY_FIRM('Fall')),
    course('fx-chukyo-1600-turf', 'Chukyo - 1600m Turf', 'Chukyo', 'Turf', 1600, 'left', SUNNY_FIRM('Summer'))
  ]
};
const dirt = {
  team1: [
    course('fx-kyoto-1800-dirt', 'Kyoto - 1800m Dirt', 'Kyoto', 'Dirt', 1800, 'right', { ground: 'Good', weather: 'Cloudy', season: 'Spring' }),
    course('fx-morioka-2000-dirt', 'Morioka - 2000m Dirt', 'Morioka', 'Dirt', 2000, 'left', { ground: 'Firm', weather: 'Sunny', season: 'Summer' }),
    course('fx-morioka-1600-dirt', 'Morioka - 1600m Dirt', 'Morioka', 'Dirt', 1600, 'left', { ground: 'Firm', weather: 'Cloudy', season: 'Fall' })
  ],
  team2: [
    course('fx-niigata-1800-dirt', 'Niigata - 1800m Dirt', 'Niigata', 'Dirt', 1800, 'left', { ground: 'Good', weather: 'Sunny', season: 'Summer' }),
    course('fx-kawasaki-2100-dirt', 'Kawasaki - 2100m Dirt', 'Kawasaki', 'Dirt', 2100, 'left', { ground: 'Firm', weather: 'Cloudy', season: 'Spring' }),
    course('fx-nakayama-1800-dirt', 'Nakayama - 1800m Dirt', 'Nakayama', 'Dirt', 1800, 'right', { ground: 'Good', weather: 'Sunny', season: 'Summer' })
  ]
};
const vetoes = {
  team1: course('fx-fukushima-1800-turf', 'Fukushima - 1800m Turf', 'Fukushima', 'Turf', 1800, 'right', SUNNY_FIRM('Fall')),
  team2: course('fx-hanshin-2600-turf-outer', 'Hanshin - 2600m Turf (Outer)', 'Hanshin', 'Turf', 2600, 'right', SUNNY_FIRM('Spring'), 'Outer')
};
const candidates = [
  course('fx-sapporo-1700-dirt', 'Sapporo - 1700m Dirt', 'Sapporo', 'Dirt', 1700, 'right', { ground: 'Good', weather: 'Cloudy', season: 'Fall' }),
  course('fx-morioka-2000-dirt', 'Morioka - 2000m Dirt', 'Morioka', 'Dirt', 2000, 'left', { ground: 'Firm', weather: 'Cloudy', season: 'Fall' }),
  course('fx-nakayama-1200-turf-outer', 'Nakayama - 1200m Turf (Outer)', 'Nakayama', 'Turf', 1200, 'right', { ground: 'Heavy', weather: 'Rainy', season: 'Spring' }, 'Outer')
];
const uma = (id, name) => ({ id, name, imageUrl: `/uma/chara_stand_${id.slice(0, 4)}_${id}.webp` });
const picks = {
  team1: [uma('102001', 'Seiun Sky'), uma('103301', 'Fixture Uma A'), uma('101602', 'Fixture Uma B'), uma('100301', 'Tokai Teio'), uma('105901', 'Fixture Uma C'), uma('101002', 'Fixture Uma D')],
  team2: [uma('106401', 'Mejiro Palmer'), uma('100902', 'Fixture Uma E'), uma('100501', 'Fixture Uma F'), uma('103402', 'Fixture Uma G'), uma('101303', 'Fixture Uma H'), uma('102401', 'Fixture Uma I')]
};
// Five of the six picks of each team are assigned to players; the sixth has no style.
const styles = {
  team1: [['100301', 'pace'], ['102001', 'front'], ['101602', 'pace'], ['103301', 'end'], ['105901', 'pace']],
  team2: [['100902', 'front'], ['102401', 'pace'], ['103402', 'end'], ['106401', 'runaway'], ['100501', 'pace']]
};
export const fixturePlayers = Array.from({ length: 10 }, (_, i) => ({
  discordId: String(900000000000000001n + BigInt(i)), displayName: `Fixture Racer ${i + 1}`, team: i < 5 ? 'team1' : 'team2',
  role: i % 5 === 0 ? 'captain' : 'player'
}));

/** goddess: 'godolphin-barb' | 'darley-arabian' | 'byerley-turk' (or anything, to test pass-through). */
export function season3Match(goddess = 'godolphin-barb', { code = 'FX3A2B' } = {}) {
  const arabian = goddess === 'darley-arabian', turk = goddess === 'byerley-turk';
  const baseMap = { bansPerTeam: 1, picksPerTeam: 4, maxDirtPerTeam: 3, surfaceRestrictions: true, distanceRestrictions: true, maxPerDistanceCategory: 2 };
  const baseRules = { map: baseMap, uma: { teamSize: 6, preBanOrder: [], preBansPerTeam: 2, postBansPerTeam: 1 }, preset: 'ranked', variant: 'standard', augments: [], rulesVersion: 0 };
  const courses = arabian || turk ? dirt : turf;
  const tiebreaker = turk ? candidates[0] : arabian ? course('fx-kyoto-1900-dirt', 'Kyoto - 1900m Dirt', 'Kyoto', 'Dirt', 1900, 'right', { ground: 'Firm', weather: 'Cloudy', season: 'Winter' })
    : course('fx-nakayama-1800-turf-inner', 'Nakayama - 1800m Turf (Inner)', 'Nakayama', 'Turf', 1800, 'right', SUNNY_FIRM('Summer'), 'Inner');
  const blessing = { status: 'resolved', goddess, version: 1, baseRules, assignedAt: '2026-11-16T07:45:48.851Z', deadlineAt: '2026-11-16T07:45:53.851Z',
    generation: 'fixture-generation', resolvedAt: '2026-11-16T07:45:54.677Z',
    ...(arabian ? { arabianCategory: 'long' } : {}),
    ...(turk ? { candidates, bans: { team1: { mapId: candidates[2].id, automatic: false }, team2: { mapId: candidates[2].id, automatic: false } },
      lockedTeams: ['team1', 'team2'], selectedMapId: candidates[0].id } : {}) };
  const side = team => ({ bannedMaps: [vetoes[team]], pickedMaps: courses[team], bannedUmas: [uma('100602', 'Fixture Ban')], preBannedUmas: [uma('100201', 'Fixture PreBan')], pickedUmas: picks[team] });
  const assignments = ['team1', 'team2'].flatMap(team => styles[team].map(([selectedUmaId, runningStyle], slotIndex) =>
    ({ team, slotIndex, selectedUmaId, runningStyle, discordId: fixturePlayers[(team === 'team1' ? 0 : 5) + slotIndex].discordId, displayName: fixturePlayers[(team === 'team1' ? 0 : 5) + slotIndex].displayName })));
  return { id: code, mode: 'ranked', status: 'completed', report: {
    matchId: code, finishedAt: '2026-11-16T09:07:12.682Z',
    participants: fixturePlayers.map((player, i) => {
      const [selectedUmaId, runningStyle] = styles[player.team][i % 5];
      return { ...player, displayDiscordUsername: player.displayName, selectedUmaId, runningStyle };
    }),
    draftSnapshot: { phase: 'complete', rules: { ...baseRules, map: { ...baseMap, ...(arabian ? { maxPerDistanceCategoryOverrides: { long: 3 } } : {}) } },
      team1: side('team1'), team2: side('team2'), blessing, wildcardMap: tiebreaker,
      draftActionHistory: ['team1', 'team2', 'team1', 'team2', 'team1', 'team2'].map((actorTeam, i) => ({ action: 'map-pick', actorTeam, map: courses[actorTeam][Math.floor(i / 2)] })),
      multiplayer: { team1Name: 'Fixture Blue', team2Name: 'Fixture Orange', runningStylesEnabled: true, threeGoddessBlessingEnabled: true },
      participantUmaAssignments: assignments } } };
}

/** The same draft as a live room `match.snapshot` event state (rules, blessing and style rows as the room carries them). */
export function season3RoomState(goddess = 'godolphin-barb') {
  const saved = season3Match(goddess).report.draftSnapshot;
  return { phase: 'complete', currentTeam: 'team1', rules: saved.rules, blessing: saved.blessing, wildcardMap: saved.wildcardMap,
    team1: saved.team1, team2: saved.team2, participantUmaAssignments: saved.participantUmaAssignments,
    multiplayer: { team1Name: 'Fixture Blue', team2Name: 'Fixture Orange', runningStylesEnabled: true, threeGoddessBlessingEnabled: true } };
}
