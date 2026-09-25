import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadFunction, parseTsxModule, readModule } from './support/harness.mjs';

const historySyntax = parseTsxModule('uiHistoryScene');
const draftSyntax = parseTsxModule('uiDraftScene');
function sceneHarness(selected) {
  const c = vm.createContext({
    element: (type, props, ...children) => ({type, props, children}),
    useState: () => [selected, value => { selected = value; }], useEffect: () => {},
    getTeamGroups: roster => Object.values(roster.teams),
    getSelectedPlayerContext: (teams, key) => { for (const team of teams) { const player = team.players.find(p => p.discordId === key); if (player) return {team, player}; } },
    PlayerDetailScene: 'Details', DraftScene: 'Draft', UmaPlannerScene: 'Umas', TeamSection: 'Team',
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
  const teams = result.children.flat();
  assert.equal(teams.length,2); assert.equal(teams[0].props.team,props.roster.teams.team1);
  assert.deepEqual(Array.from(teams[0].props.loadingDiscordIds),[player.discordId]);
  assert.equal(teams[1].props.team.players.length,0);
});
test('History details select a real roster member and do not replace Draft or Umas', () => {
  const render = sceneHarness(player.discordId);
  const result = render({...props,scene:'lobby'});
  assert.equal(result.type,'Details'); assert.equal(result.props.player,player);
  assert.equal(result.props.isProfileLoading,true);
  assert.equal(render({...props,scene:'draft'}).type,'Draft');
  assert.equal(render({...props,scene:'umas'}).type,'Umas');
  assert.equal(sceneHarness('unknown')({...props,scene:'lobby'}).type,'section');
});
test('Explorer styling cannot override shared draft tile geometry', () => {
  const explorerCss = readModule('uiHistoryCss');
  const draftCss = readModule('uiDraftCss');
  const baseCss = readModule('uiCommonBaseCss');
  assert.doesNotMatch(explorerCss,/\.explorer-view\s+button\s*\{/);
  assert.match(draftCss,/\.draft-pick-tile button,\n\.draft-pick-tile\.placeholder\s*\{[^}]*height:\s*128px/s);
  assert.match(baseCss,/scrollbar-gutter:\s*stable/);
});

test('draft.css never truncates names: no text-overflow: ellipsis anywhere, so long Uma/player/track names wrap and their rows grow instead of clipping', () => {
  const draftCss = readModule('uiDraftCss');
  assert.doesNotMatch(draftCss, /text-overflow:\s*ellipsis/);
});

test('the races column shares its height between race cards so the column fills the panel instead of leaving a scrollbar, only falling back to internal scroll on very short windows', () => {
  const draftCss = readModule('uiDraftCss');
  assert.match(draftCss, /\.draft-race-card\s*\{[^}]*flex:\s*1 1 0/s);
  assert.match(draftCss, /\.draft-race-card\s*\{[^}]*min-height:\s*\d+px/s);
  assert.match(draftCss, /\.draft-race-list\s*\{[^}]*overflow-y:\s*auto/s, 'a fallback for very short windows');
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
