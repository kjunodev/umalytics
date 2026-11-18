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
