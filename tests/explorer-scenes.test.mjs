import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFunction, parseTsxModule, readModule } from './support/harness.mjs';

const historySyntax = parseTsxModule('uiHistoryScene');
const draftSyntax = parseTsxModule('uiDraftScene');
function sceneHarness(selected) {
  const c = vm.createContext({
    element: (type, props, ...children) => ({type, props, children}),
    React: { Fragment: 'Fragment' },
    useState: () => [selected, value => { selected = value; }], useEffect: () => {},
    getTeamGroups: roster => Object.values(roster.teams),
    getSelectedPlayerContext: (teams, key) => { for (const team of teams) { const player = team.players.find(p => p.discordId === key); if (player) return {team, player}; } },
    PlayerDrawer: 'Drawer', DraftScene: 'Draft', UmaPlannerScene: 'Umas', TeamSection: 'Team',
  });
  loadFunction(c, historySyntax, 'HistoricalScene');
  return c.HistoricalScene;
}
const player = {discordId:'123456789012345678',displayName:'Player'};
const props = {snapshot:{matchCode:'FX1A2B'},roster:{players:[player],teams:{team1:{id:'team1',players:[player]},team2:{id:'team2',players:[]}}},profiles:{},statsScope:'allTime',loading:true};
test('History scenes reuse the live draft and Uma renderer with the historical roster and chosen scope', () => {
  const render = sceneHarness();
  for (const [scene, type] of [['draft','Draft'],['umas','Umas']]) {
    const result = render({...props,scene});
    assert.equal(result.type,type); assert.equal(result.props.roster,props.roster);
    assert.equal(result.props.statsScope,'allTime'); assert.equal(result.props.profiles,props.profiles);
    if(scene === 'draft') assert.equal(result.props.historical,true);
  }
});
test('History lobby shows both teams and pending profiles without inventing players', () => {
  const result = sceneHarness()({...props,scene:'lobby'});
  const teams = result.children.flat()[0].children.flat();
  assert.equal(teams.length,2); assert.equal(teams[0].props.team,props.roster.teams.team1);
  assert.deepEqual(Array.from(teams[0].props.loadingDiscordIds),[player.discordId]);
  assert.equal(teams[1].props.team.players.length,0);
});
test('History details select a real roster member and do not replace Draft or Umas', () => {
  const render = sceneHarness(player.discordId);
  const result = render({...props,scene:'lobby'});
  const [lobby, drawer] = result.children.flat();
  assert.equal(lobby.type,'section'); assert.equal(drawer.type,'Drawer');
  assert.equal(drawer.props.player,player);
  assert.equal(drawer.props.context.isProfileLoading,true);
  assert.equal(render({...props,scene:'draft'}).type,'Draft');
  assert.equal(render({...props,scene:'umas'}).type,'Umas');
  assert.equal(sceneHarness('unknown')({...props,scene:'lobby'}).children.flat().filter(Boolean).length,1);
});
test('History selection reports only the opened player to its profile loader', () => {
  const opened = [];
  const result = sceneHarness()({ ...props, scene: 'lobby', onOpenPlayer: player => opened.push(player) });
  const team = result.children.flat()[0].children.flat()[0];
  team.props.onSelectPlayer(player.discordId);
  assert.deepEqual(opened, [player]);
});
test('Explorer styling cannot override shared draft tile geometry', () => {
  const explorerCss = readModule('uiHistoryCss');
  const draftCss = readModule('uiDraftCss');
  const baseCss = readModule('uiCommonBaseCss');
  assert.doesNotMatch(explorerCss,/\.explorer-view\s+button\s*\{/);
  assert.match(draftCss,/\.draft-pick-tile button,\n\.draft-pick-tile\.placeholder\s*\{[^}]*min-height:\s*128px/s);
  assert.match(baseCss,/scrollbar-gutter:\s*stable/);
});

test('the pick-tile grid absorbs spare column height instead of leaving an empty band below the experience table', () => {
  const draftCss = readModule('uiDraftCss');
  assert.match(draftCss, /\.draft-pick-grid\s*\{[^}]*flex:\s*1 1 auto/s);
  assert.match(draftCss, /\.draft-pick-grid\s*\{[^}]*grid-auto-rows:\s*minmax\(128px,\s*1fr\)/s);
  assert.doesNotMatch(
    draftCss,
    /\.draft-pick-grid\s*\{[^}]*min-height:\s*0/s,
    'the grid must keep its automatic min-content floor (2 rows at 128px) so it never shrinks below the tile minimum and overlaps the ban/veto rows'
  );
});

test('UI CSS never truncates names with ellipsis', () => {
  const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/extension/ui');
  function check(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) check(full);
      else if (entry.name.endsWith('.css')) assert.doesNotMatch(fs.readFileSync(full, 'utf8'), /text-overflow:\s*ellipsis/i, full);
    }
  }
  check(uiRoot);
});

test('the races column shares its height between race cards so the column fills the panel instead of leaving a scrollbar, only falling back to internal scroll on very short windows', () => {
  const draftCss = readModule('uiDraftCss');
  assert.match(draftCss, /\.draft-race-card\s*\{[^}]*flex:\s*1 1 0/s);
  assert.match(draftCss, /\.draft-race-card\s*\{[^}]*min-height:\s*\d+px/s);
  assert.match(draftCss, /\.draft-race-list\s*\{[^}]*overflow-y:\s*auto/s, 'a fallback for very short windows');
});

test('the races column orders races 1..N first, then the tiebreaker card, then the Vetoed section', () => {
  const c = vm.createContext({
    element: (type, props, ...children) =>
      typeof type === 'function' ? type(props ?? {}) : { type, props, children },
    React: { Fragment: 'Fragment' },
    TEAM_IDS: ['team1', 'team2'],
    formatTeamName: (team) => team?.name ?? team?.id ?? 'Unknown team',
    formatRaceTrackName: (map) => map.track ?? map.name,
    formatRaceDistance: (distance) => (distance === undefined ? undefined : `${distance}m`),
    hasStructuredRaceModifiers: () => false,
    getDraftWeatherIconKey: () => undefined,
    formatDraftMapDetails: () => undefined
  });
  loadFunction(c, draftSyntax, 'DraftRacesPanel');
  loadFunction(c, draftSyntax, 'DraftRaceCardItem');
  loadFunction(c, draftSyntax, 'DraftVetoedMapRow');

  const teams = { team1: { id: 'team1', name: 'Rose Tempest' }, team2: { id: 'team2', name: 'literally 1984' } };
  const races = [
    { n: 1, team: 'team1', tiebreaker: false, map: { name: 'Nakayama' } },
    { n: 2, team: 'team2', tiebreaker: false, map: { name: 'Hanshin' } }
  ];
  const tiebreakerMap = { name: 'Hakodate' };
  const vetoedMaps = [{ team: 'team1', map: { name: 'Kyoto' } }, { team: 'team2', map: { name: 'Chukyo' } }];

  function findAll(node, predicate, results = []) {
    if (!node || typeof node !== 'object') return results;
    if (predicate(node)) results.push(node);
    for (const child of (node.children ?? []).flat(Infinity)) findAll(child, predicate, results);
    return results;
  }

  const result = c.DraftRacesPanel({ teams, races, tiebreakerMap, vetoedMaps });
  const list = result.children.find((child) => child?.type === 'ol');
  const items = findAll(list, (node) => node.type === 'li');
  const classNames = items.map((item) => item.props?.className);

  assert.deepEqual(classNames, [
    'draft-race-card team1', 'draft-race-card team2',
    'draft-race-card tiebreaker',
    'draft-vetoed-heading', 'draft-vetoed-map-row team1', 'draft-vetoed-map-row team2'
  ], 'races 1..N first, then the gold TB tiebreaker card, then the Vetoed heading and rows');
});

test('the played/new chip renders as its own line under the pick name, not layered over the portrait', () => {
  const c = vm.createContext({element:(type,props,...children)=>({type,props,children}),UmaImage:'Image',getUmaPortraitUrl:id=>`portrait/${id}`,isKnownUmaOutfitId:()=>false});
  loadFunction(c, draftSyntax, 'DraftPickTile');
  const result = c.DraftPickTile({action:{umaId:'100601',name:'Oguri'},experienceCount:3,isSelected:false,onSelect(){}});
  const button = result.children.find((child) => child?.type === 'button');
  const order = button.children.map((child) => child.props?.className);
  assert.deepEqual(order, ['draft-pick-portrait', 'draft-pick-name', 'draft-pick-exp some'],
    'portrait, then name, then the exp chip, in document order (no absolute overlay on the portrait)');

  const draftCss = readModule('uiDraftCss');
  assert.match(draftCss, /\.draft-pick-exp\s*\{(?:(?!position:\s*absolute)[^}])*\}/s, '.draft-pick-exp must not be absolutely positioned over the portrait');
});

test('Live and History pick tiles use identical known-outfit portraits regardless of captured image URL', () => {
  const c = vm.createContext({element:(type,props,...children)=>({type,props,children}),UmaImage:'Image',getUmaPortraitUrl:id=>`portrait/${id}`,isKnownUmaOutfitId:id=>id==='100601'});
  loadFunction(c, draftSyntax, 'DraftPickTile');
  const image = result => result.children.flatMap(child=>child?.children ?? []).flatMap(child=>child?.children ?? []).find(child=>child?.type==='Image').props.imageUrl;
  const render = action => c.DraftPickTile({action,experienceCount:0,isSelected:false,onSelect(){}});
  assert.equal(image(render({umaId:'100601',name:'Oguri',imageUrl:'captured/other.png'})), 'portrait/100601');
  assert.equal(image(render({umaId:'100601',name:'Oguri',imageUrl:'portrait/100601'})), 'portrait/100601');
  assert.equal(image(render({umaId:'unknown',name:'Future Uma',imageUrl:'future.png'})), 'future.png');
});
