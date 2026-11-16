import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadFunction, loadModule, parseTsxModule } from './support/harness.mjs';
import { roomHarness } from './support/helpers.mjs';
import { fixturePlayers, season3Match, season3RoomState } from './fixtures/season3-matches.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const element = (type, props, ...children) => ({ type, props: props ?? {}, children });
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.children ?? [])] : [node];
const season2 = JSON.parse(fs.readFileSync(new URL('./fixtures/completed-match.json', import.meta.url)));

function explorer() {
  const c = vm.createContext({ URL, URLSearchParams, Error, console, AbortController, setTimeout, clearTimeout,
    getUmaDisplayName: (id, name) => name, getUmaPortraitUrl: id => `portrait:${id}`, normalizeUmaOutfitId: id => id, resolveDrafterImageUrl: x => x });
  loadModule(c, 'matchDetection'); loadModule(c, 'explorerData');
  return c;
}
const history = (match, code = 'FX3A2B') => plain(explorer().parseHistoricalMatch(match, code).draft);
function format() {
  const c = vm.createContext({ normalizeUmaOutfitId: id => id });
  loadModule(c, 'blessing');
  return c;
}
const picks = (draft, team) => draft.teams[team].umas.filter(uma => uma.kind === 'pick');
const styleOf = (draft, team, id) => picks(draft, team).find(uma => uma.umaId === id)?.runningStyle;

test('History decodes Godolphin Barb from the match report', () => {
  const draft = history(season3Match('godolphin-barb'));
  assert.equal(draft.blessing.goddess, 'godolphin-barb');
  assert.equal(draft.blessing.status, 'resolved');
  assert.equal(draft.blessing.arabianCategory, undefined);
  assert.equal(draft.blessing.candidates, undefined);
  assert.deepEqual(draft.mapRules, { maxDirtPerTeam: 3, maxPerDistanceCategory: 2 });
  // The real report already carries Sunny / Firm on every Barb course.
  const conditions = ['team1', 'team2'].flatMap(team => draft.teams[team].maps.map(map => [map.weather, map.ground]));
  assert.ok(conditions.length >= 6 && conditions.every(([weather, ground]) => weather === 'Sunny' && ground === 'Firm'));
});

test('History decodes the Darley Arabian category and the effective distance override', () => {
  const draft = history(season3Match('darley-arabian'));
  assert.equal(draft.blessing.goddess, 'darley-arabian');
  assert.equal(draft.blessing.arabianCategory, 'long');
  assert.deepEqual(draft.mapRules, { maxDirtPerTeam: 3, maxPerDistanceCategory: 2, distanceCategoryOverrides: { long: 3 } });
  const c = format();
  assert.equal(c.describeBlessing(draft.blessing, draft.mapRules).label, 'Darley Arabian · Long limit 3');
  assert.equal(c.formatMapLimits(draft.mapRules), 'Dirt 3 per team · 2 per distance (Long 3)');
});

test('History decodes Byerley Turk candidates, sealed bans and the selected tiebreaker', () => {
  const draft = history(season3Match('byerley-turk'));
  const blessing = draft.blessing;
  assert.equal(blessing.goddess, 'byerley-turk');
  assert.equal(blessing.candidates.length, 3);
  assert.deepEqual(blessing.candidates.map(map => map.mapId), ['fx-sapporo-1700-dirt', 'fx-morioka-2000-dirt', 'fx-nakayama-1200-turf-outer']);
  assert.deepEqual(blessing.candidates[2], { mapId: 'fx-nakayama-1200-turf-outer', name: 'Nakayama - 1200m Turf (Outer)', track: 'Nakayama', distance: 1200,
    surface: 'Turf', variant: 'Outer', direction: 'right', season: 'Spring', weather: 'Rainy', ground: 'Heavy' });
  assert.deepEqual(blessing.bans, { team1: { mapId: 'fx-nakayama-1200-turf-outer', automatic: false }, team2: { mapId: 'fx-nakayama-1200-turf-outer', automatic: false } });
  assert.deepEqual(blessing.lockedTeams, ['team1', 'team2']);
  assert.equal(blessing.selectedMapId, 'fx-sapporo-1700-dirt');
  const rows = format().tiebreakerCandidates(blessing);
  assert.deepEqual(plain(rows.map(row => [row.map.mapId, row.bannedBy, row.automatic, row.selected])), [
    ['fx-sapporo-1700-dirt', [], false, true], ['fx-morioka-2000-dirt', [], false, false], ['fx-nakayama-1200-turf-outer', ['team1', 'team2'], false, false]]);
  assert.equal(format().describeBlessing(blessing).label, 'Byerley Turk · sealed tiebreaker bans');
  assert.equal(draft.tiebreakerMap.name, 'Sapporo - 1700m Dirt');
});

test('Godolphin Barb shows its Sunny / Firm effect', () => {
  assert.equal(format().describeBlessing({ goddess: 'godolphin-barb' }).label, 'Godolphin Barb · Sunny / Firm');
});

test('running styles reach each pick, runaway stays its own value and the team mix reads front to back', () => {
  const draft = history(season3Match('godolphin-barb'));
  assert.equal(styleOf(draft, 'team2', '106401'), 'runaway');
  assert.equal(styleOf(draft, 'team1', '102001'), 'front');
  assert.equal(styleOf(draft, 'team1', '103301'), 'end');
  assert.equal(styleOf(draft, 'team1', '101002'), undefined, 'the unassigned sixth pick has no style');
  const c = format();
  assert.equal(c.formatStyleComposition(c.runningStyleComposition(picks(draft, 'team2'))), 'Runaway · Front · 2 Pace · End');
  assert.equal(c.formatStyleComposition(c.runningStyleComposition(picks(draft, 'team1'))), 'Front · 3 Pace · End');
  assert.equal(c.formatStyleComposition(c.runningStyleComposition([])), '');
  assert.ok(draft.teams.team1.umas.filter(uma => uma.kind !== 'pick').every(uma => uma.runningStyle === undefined), 'bans never carry a style');
});

test('styles fall back to the report participants when the saved assignments are missing', () => {
  const match = season3Match('godolphin-barb');
  delete match.report.draftSnapshot.participantUmaAssignments;
  const draft = history(match);
  assert.equal(styleOf(draft, 'team2', '106401'), 'runaway');
  assert.equal(styleOf(draft, 'team1', '100301'), 'pace');
});

test('unknown goddess and style values pass through as text; malformed ones are dropped', () => {
  const match = season3Match('godolphin-barb');
  match.report.draftSnapshot.blessing.goddess = 'Mystery-Goddess';
  match.report.draftSnapshot.participantUmaAssignments[0].runningStyle = 'Sweeper';
  match.report.draftSnapshot.participantUmaAssignments[1].runningStyle = '<img onerror=x>';
  match.report.draftSnapshot.participantUmaAssignments[2].runningStyle = { front: true };
  for (const participant of match.report.participants) delete participant.runningStyle;
  const draft = history(match);
  const c = format();
  assert.equal(draft.blessing.goddess, 'mystery-goddess');
  assert.deepEqual(plain(c.describeBlessing(draft.blessing)), { name: 'Mystery Goddess', label: 'Mystery Goddess' });
  assert.equal(styleOf(draft, 'team1', '100301'), 'sweeper');
  assert.equal(c.runningStyleLabel('sweeper'), 'Sweeper');
  assert.equal(styleOf(draft, 'team1', '102001'), undefined);
  assert.equal(styleOf(draft, 'team1', '101602'), undefined);
  assert.equal(c.runningStyleLabel('runaway'), 'Runaway');
  match.report.draftSnapshot.blessing = { goddess: '' };
  assert.equal(history(match).blessing, undefined);
});

test('an Arabian blessing without the effective override still names the category without inventing a limit', () => {
  const c = format();
  assert.equal(c.describeBlessing({ goddess: 'darley-arabian', arabianCategory: 'mile' }, {}).label, 'Darley Arabian · Mile limit raised');
});

test('Season 2 data has no blessing, styles or Season 3 limits and still decodes', () => {
  const draft = history(season2, 'FX1A2B');
  assert.equal(draft.blessing, undefined);
  assert.ok(draft.teams.team1.umas.length > 0);
  assert.ok(['team1', 'team2'].every(team => draft.teams[team].umas.every(uma => uma.runningStyle === undefined)));
  assert.equal(draft.mapRules?.distanceCategoryOverrides, undefined);
  assert.equal(format().formatMapLimits(undefined), undefined);
});

test('the live room snapshot carries the blessing, map limits and running styles for each goddess', () => {
  for (const goddess of ['godolphin-barb', 'darley-arabian', 'byerley-turk']) {
    const { state } = roomHarness();
    const update = state.apply({ type: 'match.snapshot', matchId: 'FX3A2B', version: 1, state: season3RoomState(goddess) }, 'FX3A2B');
    const draft = plain(update.draft);
    const saved = season3Match(goddess).report.draftSnapshot;
    assert.equal(draft.blessing.goddess, goddess);
    assert.deepEqual(draft.blessing, plain(history(season3Match(goddess)).blessing));
    assert.deepEqual(draft.mapRules, goddess === 'darley-arabian' ? { maxDirtPerTeam: 3, maxPerDistanceCategory: 2, distanceCategoryOverrides: { long: 3 } } : { maxDirtPerTeam: 3, maxPerDistanceCategory: 2 });
    assert.equal(styleOf(draft, 'team2', '106401'), 'runaway');
    assert.equal(styleOf(draft, 'team1', '100301'), 'pace');
    assert.equal(styleOf(draft, 'team1', '101002'), undefined);
    assert.equal(saved.blessing.goddess, goddess);
  }
});

test('live style rows keep only team, Uma and style; no player identity enters the decoded event', () => {
  const { c } = roomHarness();
  const decoded = c.decodeRoomEvent({ type: 'match.snapshot', matchId: 'FX3A2B', version: 1, state: season3RoomState('godolphin-barb') });
  const text = JSON.stringify(decoded.state.runningStyles);
  assert.equal(decoded.state.runningStyles.length, 10);
  assert.ok(fixturePlayers.every(player => !text.includes(player.discordId) && !text.includes(player.displayName)));
  assert.deepEqual(Object.keys(decoded.state.runningStyles[0]).sort(), ['runningStyle', 'team', 'umaId']);
});

test('a live snapshot without any Season 3 field decodes as before', () => {
  const { state } = roomHarness();
  const saved = season3RoomState('godolphin-barb');
  for (const key of ['blessing', 'participantUmaAssignments']) delete saved[key];
  delete saved.rules.map.maxDirtPerTeam;
  const draft = plain(state.apply({ type: 'match.snapshot', matchId: 'FX3A2B', version: 1, state: saved }, 'FX3A2B').draft);
  assert.equal(draft.blessing, undefined);
  assert.equal(draft.mapRules.distanceCategoryOverrides, undefined);
  assert.equal(styleOf(draft, 'team1', '100301'), undefined);
  assert.equal(picks(draft, 'team1').length, 6);
});

test('a style carried on the picked Uma itself is honoured and an unknown goddess does not break the room', () => {
  const { state } = roomHarness();
  const saved = season3RoomState('godolphin-barb');
  delete saved.participantUmaAssignments;
  saved.blessing.goddess = 'someone-new';
  saved.team1.pickedUmas[0].runningStyle = 'Late';
  const draft = plain(state.apply({ type: 'match.snapshot', matchId: 'FX3A2B', version: 1, state: saved }, 'FX3A2B').draft);
  assert.equal(draft.blessing.goddess, 'someone-new');
  assert.equal(draft.teams.team1.umas.find(uma => uma.kind === 'pick').runningStyle, 'late');
});

// ---- presentation ----

test('the pick tile shows the running style and the candidate row shows who banned or selected it', () => {
  const syntax = parseTsxModule('uiDraftScene');
  const c = vm.createContext({ element, UmaImage: 'Image', getUmaPortraitUrl: id => `portrait/${id}`, isHashedUmaAssetUrl: () => false,
    runningStyleLabel: style => style[0].toUpperCase() + style.slice(1), formatRaceTrackName: map => map.track ?? map.name,
    formatRaceDistance: distance => distance === undefined ? undefined : `${distance}m`, formatTeamName: team => team.name, DRAFT_DETAIL_SEPARATOR: ' • ' });
  for (const name of ['getDraftActionImageUrl', 'DraftPickTile', 'DraftCandidateRow']) loadFunction(c, syntax, name);
  const classes = node => (node?.children ?? []).filter(Boolean).map(child => child.props?.className);
  const tile = c.DraftPickTile({ action: { umaId: '106401', name: 'Mejiro Palmer', runningStyle: 'runaway' }, experienceCount: 0, isSelected: false, onSelect() {} });
  const button = tile.children.find(child => child?.type === 'button');
  assert.deepEqual(classes(button), ['draft-pick-portrait', 'draft-pick-name', 'draft-pick-style', 'draft-pick-exp none']);
  assert.equal(button.children.find(child => child?.props?.className === 'draft-pick-style').children[0], 'Runaway');
  const text = node => walk(node).filter(item => typeof item === 'string').join('');
  const teams = { team1: { name: 'Fixture Blue' }, team2: { name: 'Fixture Orange' } };
  const map = { mapId: 'm', track: 'Nakayama', variant: 'Outer', distance: 1200, surface: 'Turf', season: 'Spring', weather: 'Rainy', ground: 'Heavy' };
  const banned = c.DraftCandidateRow({ candidate: { map, bannedBy: ['team1', 'team2'], automatic: false, selected: false }, teams });
  assert.match(banned.props.className, /banned/);
  assert.match(text(banned), /Nakayama \(Outer\) 1200m/);
  assert.match(text(banned), /Banned · Fixture Blue/);
  assert.match(text(banned), /Banned · Fixture Orange/);
  const selected = c.DraftCandidateRow({ candidate: { map, bannedBy: [], automatic: false, selected: true }, teams });
  assert.match(selected.props.className, /selected/);
  assert.match(text(selected), /Tiebreaker/);
  assert.doesNotMatch(text(selected), /Banned/);
  assert.match(text(c.DraftCandidateRow({ candidate: { map, bannedBy: ['team2'], automatic: true, selected: false }, teams })), /Auto-banned · Fixture Orange/);
});

test('the Races panel lists the candidates and map limits only when a blessing provides them', () => {
  const syntax = parseTsxModule('uiDraftScene');
  const c = vm.createContext({ element, React: { Fragment: 'Fragment' }, Fragment: 'Fragment', TEAM_IDS: ['team1', 'team2'], formatTeamName: team => team.name, DraftCandidateRow: 'DraftCandidateRow',
    formatRaceTrackName: () => '', formatRaceDistance: () => undefined, hasStructuredRaceModifiers: () => false, getDraftWeatherIconKey: () => undefined,
    formatDraftMapDetails: () => undefined, formatMapLimits: rules => rules.distanceCategoryOverrides ? 'Limits with override' : 'Limits',
    tiebreakerCandidates: blessing => blessing.candidates.map(map => ({ map, bannedBy: [], automatic: false, selected: false })) });
  loadFunction(c, syntax, 'DraftRacesPanel');
  const teams = { team1: { name: 'Fixture Blue' }, team2: { name: 'Fixture Orange' } };
  const find = (node, className) => walk(node).filter(item => item?.props?.className === className);
  const plainPanel = c.DraftRacesPanel({ teams, races: [], tiebreakerMap: undefined, vetoedMaps: [] });
  assert.equal(find(plainPanel, 'draft-map-limits').length, 0);
  assert.equal(find(plainPanel, 'draft-vetoed-heading').length, 0);
  const panel = c.DraftRacesPanel({ teams, races: [], tiebreakerMap: undefined, vetoedMaps: [],
    blessing: { goddess: 'byerley-turk', candidates: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }, mapRules: { distanceCategoryOverrides: { long: 3 } } });
  assert.equal(find(panel, 'draft-map-limits')[0].children[0], 'Limits with override');
  assert.equal(walk(panel).filter(item => item?.type === 'DraftCandidateRow').length, 3);
  assert.equal(find(panel, 'draft-vetoed-heading').length, 1);
});

test('Season 3 styles are in-flow, share the existing tones and the Fall tone exists', () => {
  const css = fs.readFileSync(new URL('../packages/ui/src/draft/draft.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css.match(/\.draft-pick-style \{[^}]*\}/)[0], /position:\s*absolute/);
  assert.match(css, /\.draft-mod\[data-tone="season-fall"\]/);
  for (const selector of ['.draft-blessing', '.draft-style-mix', '.draft-map-limits', '.draft-candidate-row', '.draft-candidate-tag']) assert.ok(css.includes(`${selector} {`), selector);
});
