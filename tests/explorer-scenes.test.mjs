import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../apps/extension/entrypoints/scout/App.tsx', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'HistoricalScene');
const code = ts.transpileModule(declaration.getText(syntax), { compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'element', target: ts.ScriptTarget.ES2022 } }).outputText;
function sceneHarness(selected) {
  const c = vm.createContext({
    element: (type, props, ...children) => ({type, props, children}),
    useState: () => [selected, value => { selected = value; }], useEffect: () => {},
    getTeamGroups: roster => Object.values(roster.teams),
    getSelectedPlayerContext: (teams, key) => { for (const team of teams) { const player = team.players.find(p => p.discordId === key); if (player) return {team, player}; } },
    PlayerDetailScene: 'Details', DraftScene: 'Draft', UmaPlannerScene: 'Umas', TeamSection: 'Team',
  });
  vm.runInContext(code, c);
  return c.HistoricalScene;
}
const player = {discordId:'123456789012345678',displayName:'Player'};
const props = {snapshot:{matchCode:'TG7YT2'},roster:{players:[player],teams:{team1:{id:'team1',players:[player]},team2:{id:'team2',players:[]}}},profiles:{},statsScope:'allTime',loading:true};
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
test('Explorer styling cannot override shared draft button geometry', () => {
  const css = fs.readFileSync(new URL('../apps/extension/entrypoints/scout/styles.css', import.meta.url),'utf8');
  assert.doesNotMatch(css,/\.explorer-view\s+button\s*\{/);
  assert.match(css,/\.draft-pick-slot button\s*\{[^}]*padding:\s*3px/s);
  assert.match(css,/scrollbar-gutter:\s*stable/);
});

test('Live and History pick slots use identical known-outfit portraits regardless of captured image URL', () => {
  const slot = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'DraftPickSlot');
  const compiled = ts.transpileModule(slot.getText(syntax), {compilerOptions:{jsx:ts.JsxEmit.React,jsxFactory:'element',target:ts.ScriptTarget.ES2022}}).outputText;
  const c = vm.createContext({element:(type,props,...children)=>({type,props,children}),UmaImage:'Image',getUmaPortraitUrl:id=>`portrait/${id}`,isKnownUmaOutfitId:id=>id==='100601'});
  vm.runInContext(compiled,c);
  const image = result => result.children.flatMap(child=>child?.children ?? []).flatMap(child=>child?.children ?? []).find(child=>child?.type==='Image').props.imageUrl;
  const render = action => c.DraftPickSlot({action,experienceCount:0,isSelected:false,onSelect(){}});
  assert.equal(image(render({umaId:'100601',name:'Oguri',imageUrl:'captured/other.png'})), 'portrait/100601');
  assert.equal(image(render({umaId:'100601',name:'Oguri',imageUrl:'portrait/100601'})), 'portrait/100601');
  assert.equal(image(render({umaId:'unknown',name:'Future Uma',imageUrl:'future.png'})), 'future.png');
});
