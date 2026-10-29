export const DEV_ORIGIN = 'http://umalytics-replay.localhost';

export function replayEnvelopes(fixture) {
  if (!fixture.room || !Array.isArray(fixture.timeline) || !fixture.participants) {
    throw new Error('Replay requires a room-event timeline. completed-match.json is a history report, not a compatible realtime fixture.');
  }
  const people = keys => keys.map(key => {
    const person = fixture.participants[key];
    if (!person) throw new Error('Unknown replay participant key.');
    return person;
  });
  const team = () => ({ pickedUmas: [], bannedUmas: [], preBannedUmas: [], pickedMaps: [], bannedMaps: [] });
  return [...fixture.timeline.map(step => {
    let event;
    if (step.kind === 'snapshot') event = { type: 'match.snapshot', matchId: fixture.room, version: step.version,
      state: { phase: 'complete', currentTeam: 'team1', team1: team(), team2: team(),
        multiplayer: { team1Name: 'Fixture Blue', team2Name: 'Fixture Red' } } };
    else if (step.kind === 'presence') event = { type: 'room.presence.updated', matchId: fixture.room, participants: people(step.online) };
    else if (step.kind === 'assignment') event = { type: 'participant.uma-assignments.snapshot', matchId: fixture.room,
      team: step.team, revision: step.revision, roster: people(step.roster) };
    else throw new Error('Unsupported replay timeline step.');
    return { v: 1, roomCode: fixture.room, event };
  }), { v: 1, type: 'left' }];
}
