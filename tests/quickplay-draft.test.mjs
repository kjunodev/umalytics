import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { quickplayCode, quickplayMatch, quickplaySnapshotEvent } from './fixtures/quickplay-match.mts';
import { loadFunction, loadModule, parseTsxModule } from './support/harness.mjs';
import { roomHarness } from './support/helpers.mjs';

const expectedRules = { maps: 3, picks: 5, bans: 3, vetoes: 0, mapVetoes: 0 };
const plain = value => JSON.parse(JSON.stringify(value));

function historyContext() {
  const context = vm.createContext({
    getUmaDisplayName: (_id, name) => name, getUmaPortraitUrl: () => undefined,
    normalizeUmaOutfitId: id => id, resolveDrafterImageUrl: url => url,
  });
  loadModule(context, 'matchDetection');
  loadModule(context, 'explorerData');
  return context;
}

test('Quickplay History keeps all maps and picks when Uma assignments are hidden', () => {
  const context = historyContext();
  loadModule(context, 'uiCommonRoster');
  loadModule(context, 'uiDraftFormat');
  for (const hideAssignments of [false, true]) {
    const match = quickplayMatch({ hideAssignments });
    if (hideAssignments) {
      assert.equal(match.report.umaAssignmentsHidden, true);
      assert.equal(match.report.draftSnapshot.participantUmaAssignments, undefined);
    }
    const { draft, roster } = context.parseHistoricalMatch(match, quickplayCode);
    assert.equal(draft.queueContext, 'quickplay');
    assert.deepEqual(plain(draft.rules), expectedRules);
    assert.equal(roster.players.length, 10);
    assert.equal(draft.tiebreakerMap.track, match.report.draftSnapshot.wildcardMap.track);
    for (const side of Object.values(draft.teams)) {
      assert.equal(side.maps.length, 3);
      assert.equal(side.umas.filter(uma => uma.kind === 'pick').length, 5);
      assert.equal(side.umas.filter(uma => uma.kind === 'ban').length, 3);
    }
    const cards = context.buildDraftRaceCards(draft.teams, 6);
    assert.equal(cards.filter(Boolean).length, 6);
  }
});

test('History treats report queue and rules variant as Quickplay indicators and ignores unknown values', () => {
  const context = historyContext();
  for (const [queue, variant, expected] of [
    ['quickplay', undefined, 'quickplay'],
    [undefined, 'quickplay', 'quickplay'],
    ['future-queue', 'future-variant', undefined],
    [undefined, 'standard', undefined],
  ]) {
    const match = quickplayMatch();
    match.report.queueContext = queue;
    match.report.draftSnapshot.rules.variant = variant;
    assert.equal(context.parseHistoricalMatch(match, quickplayCode).draft.queueContext, expected);
  }
});

test('live Quickplay survives the feed whitelist and unknown queue values are discarded', () => {
  for (const [queue, variant, expected] of [
    ['quickplay', undefined, 'quickplay'],
    [undefined, 'quickplay', 'quickplay'],
    [{ unknown: 'quickplay' }, 'future-variant', undefined],
    [undefined, 'standard', undefined],
  ]) {
    const { c, state } = roomHarness();
    const event = quickplaySnapshotEvent();
    event.state.multiplayer.queueContext = queue;
    event.state.rules.variant = variant;
    const decoded = c.decodeRoomEvent(event);
    assert.equal(decoded.state.multiplayer.queueContext, expected);
    state.apply(decoded, quickplayCode);
    assert.equal(state.draft.queueContext, expected);
    assert.deepEqual(plain(state.draft.rules), expectedRules);
    assert.equal(state.draft.tiebreakerMap.track, 'Chukyo');
  }
});

test('shared draft header shows the Quickplay chip and omits the veto stage', () => {
  const context = historyContext();
  Object.assign(context, {
    element: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    TEAM_IDS: ['team1', 'team2'],
    DRAFT_VETO_SLOT_COUNT: 1, DRAFT_PICK_SLOT_COUNT: 6, DraftStageTrack: 'DraftStageTrack',
  });
  loadModule(context, 'uiDraftFormat');
  loadFunction(context, parseTsxModule('uiDraftScene'), 'DraftPhaseBar');
  const { draft } = context.parseHistoricalMatch(quickplayMatch(), quickplayCode);
  const bar = snapshot => context.DraftPhaseBar({ snapshot, initialPickCount: 5, stageIndex: 0, historical: false });
  assert.equal(bar(draft).children.find(child => child?.props?.className === 'draft-format').children[0], 'Quickplay');
  assert.equal(bar(draft).children.find(child => child?.props?.className === 'draft-phase-status').children[0], 'Draft complete');
  assert.equal(bar(draft).children.some(child => child?.type === 'DraftStageTrack'), false);
  assert.equal(bar({ ...draft, queueContext: undefined }).children.some(child => child?.props?.className === 'draft-format'), false);
});

test('shared Quickplay team panels have five picks and three bans, including legacy reports without a pick count', () => {
  const context = historyContext();
  loadModule(context, 'uiCommonRoster');
  Object.assign(context, {
    element: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: () => [undefined, () => {}], useEffect: () => {},
    DRAFT_PICK_SLOT_COUNT: 6, DRAFT_BAN_SLOT_COUNT: 2, DRAFT_VETO_SLOT_COUNT: 1,
    DraftPickPlaceholder: 'DraftPickPlaceholder', DraftPickTile: 'DraftPickTile',
    DraftBanVetoRow: 'DraftBanVetoRow', DraftPickExperiencePanel: 'DraftPickExperiencePanel',
    DraftStyleMix: 'DraftStyleMix', formatTeamName: team => team.name,
    getDraftActionKey: action => action.umaId, getUmaExperience: () => [],
  });
  loadFunction(context, parseTsxModule('uiDraftScene'), 'DraftTeamPanel');
  const { draft } = context.parseHistoricalMatch(quickplayMatch(), quickplayCode);
  const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.children ?? [])] : [];
  for (const rules of [draft.rules, { ...draft.rules, picks: 0 }]) {
    for (const team of Object.values(draft.teams)) {
      const nodes = walk(context.DraftTeamPanel({ team, rules, rosterPlayers: [], profiles: {}, statsScope: 'currentSeason', isCurrentTeam: false }));
      assert.equal(nodes.filter(node => node.type === 'DraftPickTile').length, 5);
      assert.equal(nodes.filter(node => node.type === 'DraftPickPlaceholder').length, 0);
      assert.equal(nodes.filter(node => node.type === 'DraftBanVetoRow' && node.props.kind === 'ban').length, 3);
      assert.equal(nodes.filter(node => node.type === 'DraftBanVetoRow' && node.props.kind === 'veto').length, 0);
    }
  }
});

test('Quickplay History orders races by the map rolls, or alternates teams without them', () => {
  const context = historyContext();
  const raceOrder = draft => Object.values(draft.teams).flatMap(side => side.maps.map(map => ({ team: side.id, name: map.name, order: map.order })))
    .sort((a, b) => a.order - b.order).map(({ team, name }) => `${team}:${name}`);

  const alternating = context.parseHistoricalMatch(quickplayMatch(), quickplayCode).draft;
  assert.deepEqual(raceOrder(alternating), ['team1:Tokyo', 'team2:Hanshin', 'team1:Nakayama', 'team2:Kyoto', 'team1:Ohi', 'team2:Sapporo']);

  const rolled = quickplayMatch();
  const snapshot = rolled.report.draftSnapshot;
  const roll = (team, map, rollIndex) => ({ kind: 'map-roll', team, mapId: snapshot[team].pickedMaps.find(m => m.name === map).id, rollIndex });
  snapshot.quickplay = { mapRolls: [
    { kind: 'wildcard-roll', mapId: snapshot.wildcardMap.id, rollIndex: 0 },
    roll('team2', 'Kyoto', 1), roll('team1', 'Ohi', 2), roll('team2', 'Sapporo', 3),
    roll('team1', 'Tokyo', 4), roll('team2', 'Hanshin', 5), roll('team1', 'Nakayama', 6),
  ] };
  assert.deepEqual(raceOrder(context.parseHistoricalMatch(rolled, quickplayCode).draft),
    ['team2:Kyoto', 'team1:Ohi', 'team2:Sapporo', 'team1:Tokyo', 'team2:Hanshin', 'team1:Nakayama']);
});
