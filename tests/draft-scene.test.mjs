import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModule } from './support/harness.mjs';

const TEAM_IDS = ['team1', 'team2'];

function getDraftSlots(items, slotCount) {
  const visible = items.slice(0, slotCount);
  return [...visible, ...Array(Math.max(slotCount - visible.length, 0)).fill(undefined)];
}

function harness() {
  const c = vm.createContext({ TEAM_IDS, getDraftSlots });
  loadModule(c, 'uiDraftFormat');
  return c;
}

function team(id, umas = [], maps = []) {
  return { id, name: id === 'team1' ? 'Rose Tempest' : 'literally 1984', umas, maps };
}

function pick(team, order) {
  return { kind: 'pick', team, name: `Uma ${team}:${order}`, order };
}

function veto(team, order) {
  return { kind: 'veto', team, name: `Vetoed ${team}:${order}`, order };
}

test('formatOrdinal formats English ordinal suffixes including the 11-13 exception', () => {
  const c = harness();
  const cases = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd', 101: '101st' };
  for (const [value, expected] of Object.entries(cases)) assert.equal(c.formatOrdinal(Number(value)), expected);
});

test('draft stage index advances from picks to vetoes to final picks as counts complete', () => {
  const c = harness();
  const teams = { team1: team('team1'), team2: team('team2') };
  assert.equal(c.getDraftStageIndex({ teams, rules: undefined }, 5), 0);

  teams.team1.umas = [pick('team1', 1), pick('team1', 2), pick('team1', 3), pick('team1', 4), pick('team1', 5)];
  teams.team2.umas = [pick('team2', 1), pick('team2', 2), pick('team2', 3), pick('team2', 4), pick('team2', 5)];
  assert.equal(c.getDraftStageIndex({ teams, rules: undefined }, 5), 1);

  teams.team1.umas.push(veto('team1', 1));
  assert.equal(c.getDraftStageIndex({ teams, rules: undefined }, 5), 1, 'still waiting on team2 to veto');

  teams.team2.umas.push(veto('team2', 1));
  assert.equal(c.getDraftStageIndex({ teams, rules: undefined }, 5), 2);
});

test('draft status text names the current team picking their next Uma, vetoing, or reports completion', () => {
  const c = harness();
  const teams = {
    team1: team('team1', [pick('team1', 1), pick('team1', 2)]),
    team2: team('team2', [])
  };
  const snapshot = { teams, currentTeam: 'team1', rules: undefined };
  assert.equal(c.formatDraftStatusText(snapshot, 0, 6), 'Rose Tempest is picking their 3rd Uma');
  assert.equal(c.formatDraftStatusText(snapshot, 1, 6), "Rose Tempest is vetoing an opponent's pick");
  assert.equal(c.formatDraftStatusText({ ...snapshot, currentTeam: undefined }, 0, 6), undefined);

  const finished = {
    teams: {
      team1: team('team1', Array.from({ length: 6 }, (_, i) => pick('team1', i + 1))),
      team2: team('team2', Array.from({ length: 6 }, (_, i) => pick('team2', i + 1)))
    },
    currentTeam: 'team1',
    rules: undefined
  };
  assert.equal(c.formatDraftStatusText(finished, 2, 6), 'Draft complete');
});

test('draft race cards merge both teams by combined order, pad pending slots, and append the tiebreaker last', () => {
  const c = harness();
  const teams = {
    team1: team('team1', [], [
      { team: 'team1', name: 'Nakayama', order: 1, status: 'selected' },
      { team: 'team1', name: 'Vetoed course', status: 'vetoed' }
    ]),
    team2: team('team2', [], [
      { team: 'team2', name: 'Hanshin', order: 2, status: 'selected' }
    ])
  };
  const cards = c.buildDraftRaceCards(teams, undefined, 4);
  assert.equal(cards.length, 4);
  assert.equal(cards[0].n, 1); assert.equal(cards[0].team, 'team1'); assert.equal(cards[0].map.name, 'Nakayama');
  assert.equal(cards[1].n, 2); assert.equal(cards[1].team, 'team2'); assert.equal(cards[1].map.name, 'Hanshin');
  assert.equal(cards[2], undefined);
  assert.equal(cards[3], undefined);

  const withTiebreaker = c.buildDraftRaceCards(teams, { name: 'Hakodate' }, 4);
  assert.equal(withTiebreaker.length, 5);
  assert.equal(withTiebreaker[4].tiebreaker, true);
  assert.equal(withTiebreaker[4].team, 'tiebreaker');
  assert.equal(withTiebreaker[4].n, 5);
});

test('race modifier chips look up known tones case-insensitively and fall back for unknown values', () => {
  const c = harness();
  assert.deepEqual({ ...c.getDraftSurfaceChip('Turf') }, { label: 'Turf', bg: '#13301f', fg: '#8fe0b0' });
  assert.deepEqual({ ...c.getDraftSurfaceChip('turf') }, { label: 'turf', bg: '#13301f', fg: '#8fe0b0' });
  assert.equal(c.getDraftSurfaceChip(undefined), undefined);
  assert.deepEqual({ ...c.getDraftGroundChip('Muddy') }, { label: 'Muddy', bg: '#1f2738', fg: '#9aa4b8' });
});

test('weather icon key only recognizes the four known weather labels, case-insensitively', () => {
  const c = harness();
  assert.equal(c.getDraftWeatherIconKey('Sunny'), 'sunny');
  assert.equal(c.getDraftWeatherIconKey('RAINY'), 'rainy');
  assert.equal(c.getDraftWeatherIconKey('Foggy'), undefined);
  assert.equal(c.getDraftWeatherIconKey(undefined), undefined);
});

test('structured race fields are preferred; plain details text is only a fallback for DOM drafts', () => {
  const c = harness();
  assert.equal(c.hasStructuredRaceModifiers({ name: 'X', surface: 'Turf' }), true);
  assert.equal(c.hasStructuredRaceModifiers({ name: 'X', details: '2000m - Turf - Good' }), false);
  assert.equal(c.formatDraftMapDetails({ name: 'X', details: '2000m - Turf - Good -x' }), '2000m • Turf • Good');
  assert.equal(c.formatDraftMapDetails({ name: 'X' }), undefined);
});
