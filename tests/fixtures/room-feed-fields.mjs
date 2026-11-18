import { season3RoomState } from './season3-matches.mjs';

export const hiddenValue = 'Fixture Private Value';
export const extraFieldNames = [
  'futureEnvelope', 'futureSnapshot', 'futureRule', 'futureMapRule', 'futureUmaRule',
  'futureBlessing', 'futureQuickplay', 'futureMultiplayer', 'futureAssignment'
];

export function feedFieldsEvent(withExtras = true) {
  const state = season3RoomState('byerley-turk');
  state.rules.map.maxPerDistanceCategoryOverrides = { long: 3 };
  state.quickplay = { seed: hiddenValue, timers: { dynamicTimer: 45 }, rolling: {}, banRolls: [] };
  state.seatPicks = { team1: { pickedFor: { arbitraryPlayerKey: hiddenValue } } };
  const event = { type: 'match.snapshot', matchId: 'FX3A2B', version: 1, state };
  if (withExtras) {
    const containers = [event, state, state.rules, state.rules.map, state.rules.uma, state.blessing,
      state.quickplay, state.multiplayer, state.participantUmaAssignments[0]];
    containers.forEach((container, index) => { container[extraFieldNames[index]] = { hiddenKey: hiddenValue }; });
  }
  return event;
}

// Every key seen in Season 3 ranked and Quickplay draft snapshots (public reports, 2026-11-17),
// with placeholder values. None of these may be reported as unrecognised.
export function season3KnownKeysEvent() {
  const event = feedFieldsEvent(false);
  const { state } = event;
  const fill = (container, keys) => keys.forEach(key => { if (!(key in container)) container[key] = hiddenValue; });
  fill(state, ['roomCodes', 'team1Ready', 'team2Ready', 'turnTimeBank', 'availableMaps', 'availableUmas', 'trainingTimer',
    'pendingMatchReport', 'pickOrderHistoryText', 'confirmedMatchResults', 'participantUmaAssignmentRoster', 'participantUmaAssignmentReadiness']);
  fill(state.quickplay, ['mapRolls', 'skippedBans', 'wildcardRolled', 'teamMapRollsCompleted']);
  fill(state.multiplayer, ['roomId', 'enabled', 'matchFormat', 'lastCoinFlip', 'queueContext', 'turnDuration', 'hostActorUserId',
    'draftCompletedAt', 'rankedRecoveryAt', 'lobbySidesSwapped', 'rankedTurnDeadline', 'rankedHandoffSource', 'rankedPolicyVersion',
    'rankedRatingContext', 'playerTeamAssignments', 'trainingTimerDuration', 'raceStartTimerDuration', 'assignmentPolicyVersion',
    'rankedQueueSideSelection', 'rankedReportingFallbackAt', 'captainOffers', 'quickplayTimers']);
  fill(state.rules.map, ['wildcardMode']);
  fill(state.rules.uma, ['pickOwnership', 'picksBeforeVetoPerTeam']);
  for (const entry of state.participantUmaAssignments) fill(entry, ['role', 'updatedAt', 'actorUserId', 'participantKey']);
  return event;
}
