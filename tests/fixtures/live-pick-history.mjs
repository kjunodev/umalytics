// Recorded room-event shape with synthetic identities and selections.
const uma = (id) => ({ id, name: 'A player name must not pass through', imageUrl: 'https://drafter.uma.guide/images/uma.png', privateField: 'secret' });
export const livePickEvent = {
  type: 'match.snapshot', matchId: 'ABC123', version: 10,
  state: {
    phase: 'uma-pick', currentTeam: 'team1', team1: { pickedUmas: [uma('100101')] }, team2: { pickedUmas: [uma('100201')], bannedUmas: [uma('100301')] },
    draftActionHistory: [
      { action: 'map-pick', actorTeam: 'team1', map: { id: 'map' } },
      { action: 'uma-pre-ban', actorTeam: 'team1', actorUserId: 'actor-secret', discordId: 'discord-secret', displayName: 'Player secret', uma: uma('100401') },
      { action: 'uma-pick', actorTeam: 'team2', actorUserId: 'actor-secret', uma: uma('100201') },
      { action: 'uma-pick', actorTeam: 'team1', actorUserId: 'actor-secret', uma: uma('100101') },
      { action: 'uma-pick', actorTeam: 'team2', actorUserId: 'actor-secret', uma: uma('100301') },
      { action: 'uma-veto', actorTeam: 'team2', actorUserId: 'actor-secret', uma: uma('100301') }
    ]
  }
};
