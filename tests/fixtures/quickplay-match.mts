// Synthetic Quickplay report with invented match and player identities.
export const quickplayCode = 'FXQ020';

const courses = [
  ['Tokyo', 1600, 'Turf'],
  ['Nakayama', 2500, 'Turf'],
  ['Ohi', 2000, 'Dirt'],
  ['Hanshin', 2200, 'Turf'],
  ['Kyoto', 3200, 'Turf'],
  ['Sapporo', 1700, 'Dirt'],
  ['Chukyo', 1200, 'Turf'],
] as const;
const maps = courses.map(([track, distance, surface]) => ({
  id: `fixture-${track.toLowerCase()}-${distance}`, name: track, track, distance, surface,
  conditions: { ground: 'Firm', weather: 'Sunny', season: 'Spring' },
}));
const uma = (id: string) => ({ id, name: `Fixture Uma ${id}` });

export function quickplayMatch({ hideAssignments = false } = {}) {
  const team1 = {
    pickedMaps: maps.slice(0, 3), bannedMaps: [], bannedUmas: [],
    pickedUmas: ['100101', '100301', '102001', '100701', '102301'].map(uma),
    preBannedUmas: ['100201', '100401', '100601'].map(uma),
  };
  const team2 = {
    pickedMaps: maps.slice(3, 6), bannedMaps: [], bannedUmas: [],
    pickedUmas: ['100501', '101401', '101601', '105001', '106401'].map(uma),
    preBannedUmas: ['100901', '101101', '101201'].map(uma),
  };
  const teams = { team1, team2 };
  const participants = (['team1', 'team2'] as const).flatMap(team => teams[team].pickedUmas.map((pick, slotIndex) => ({
    team, slotIndex, role: slotIndex === 0 ? 'captain' : 'player',
    userId: `fixture-${team}-${slotIndex}`,
    discordId: String(900000000000002000n + BigInt((team === 'team1' ? 0 : 5) + slotIndex)),
    displayName: `Fixture ${team} Racer ${slotIndex + 1}`,
    ...(hideAssignments ? {} : { selectedUmaId: pick.id }),
  })));
  const assignments = participants.map(({ team, slotIndex, userId, selectedUmaId }) => ({ team, slotIndex, userId, selectedUmaId }));
  return {
    id: quickplayCode, status: 'completed', mode: 'casual',
    report: {
      matchId: quickplayCode, queueContext: 'quickplay', finishedAt: '2026-11-17T23:00:00Z',
      participants,
      ...(hideAssignments ? { umaAssignmentsHidden: true } : {}),
      draftSnapshot: {
        phase: 'complete',
        rules: {
          preset: 'casual', variant: 'quickplay',
          map: { picksPerTeam: 3, bansPerTeam: 0, wildcardMode: 'random' },
          uma: { teamSize: 5, preBansPerTeam: 3, postBansPerTeam: 0, pickOwnership: 'seat' },
        },
        ...teams, wildcardMap: maps[6],
        draftActionHistory: (['preBannedUmas', 'pickedUmas'] as const).flatMap(key =>
          (['team1', 'team2'] as const).flatMap(actorTeam => teams[actorTeam][key].map(pick => ({
            action: key === 'preBannedUmas' ? 'uma-pre-ban' : 'uma-pick', actorTeam, uma: pick,
          }))),
        ),
        multiplayer: { team1Name: 'Fixture Blue', team2Name: 'Fixture Orange' },
        ...(hideAssignments ? {} : { participantUmaAssignments: assignments }),
      },
    },
  };
}

export function quickplaySnapshotEvent() {
  const { report } = quickplayMatch();
  const state = report.draftSnapshot;
  return {
    type: 'match.snapshot', matchId: quickplayCode, version: 1,
    state: { ...state, multiplayer: { ...state.multiplayer, queueContext: report.queueContext } },
  };
}
