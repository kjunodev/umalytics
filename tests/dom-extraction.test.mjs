import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { evaluate, context, domHarness, realTrainerRow, lobbyFixture } from './support/helpers.mjs';

test('real trainer buttons beat companion images, and room codes exist before draft',()=>{
  const {c,document}=domHarness(lobbyFixture(realTrainerRow(),'<p>Waiting for player...</p>'));
  const roster=c.extractPrematchRosterFromRoomDom(document);
  assert.equal(roster.matchCode,'6XN84X');assert.equal(roster.players.length,1);
  assert.equal(roster.players[0].displayName,'Fixture Trainer | 기');assert.equal(roster.players[0].discordId,'100000000000000098');
  assert.equal(roster.teams.team1.name,'Team 1');assert.equal(roster.teams.team2.players.length,0);
});

test('empty first team does not renumber Team 2; unrelated pages are not lobbies',()=>{
  const {c,document}=domHarness(lobbyFixture('<p>Waiting for player...</p>',realTrainerRow()));
  assert.equal(c.extractPrematchRosterFromRoomDom(document).players[0].team,'team2');
  const other=domHarness('<h2>Leaderboard</h2><p>Some players</p>');assert.equal(other.c.extractPrematchRosterFromRoomDom(other.document),null);
});

test('default avatar cannot invent an ID; a verified profile link supplies it',()=>{
  const row=realTrainerRow('Guest','https://cdn.discordapp.com/embed/avatars/0.png');
  const first=domHarness(lobbyFixture(row,'<p>Waiting for player...</p>'));
  const player=first.c.extractPrematchRosterFromRoomDom(first.document).players[0];
  assert.equal(player.displayName,'Guest');assert.equal(player.profileLookupUnavailable,true);
  const linked=domHarness(lobbyFixture(row.replace('</div><span>Captain','<a href="/players/100000000000000098">Profile</a></div><span>Captain'),'<p>Waiting for player...</p>'));
  assert.equal(linked.c.extractPrematchRosterFromRoomDom(linked.document).players[0].discordId,'100000000000000098');
});

test('avatar initials do not replace trainer names',()=>{
  const row=realTrainerRow('Mimi').replace(/<img alt="Mimi"[^>]+>/,'<div>M</div>');
  const {c,document}=domHarness(lobbyFixture(row,'<p>Waiting for player...</p>'));
  assert.equal(c.extractPrematchRosterFromRoomDom(document).players[0].displayName,'Mimi');
});

test('legacy row boundaries exclude surrounding team-label paragraphs',()=>{
  const row='<div><p>Team 1</p><div><p>Fixture Query</p><span>Captain</span><img src="https://cdn.discordapp.com/avatars/100000000000000099/a.png"></div></div>';
  const {c,document}=domHarness(lobbyFixture(row,'<p>Waiting for player...</p>'));
  const roster=c.extractPrematchRosterFromRoomDom(document);
  assert.equal(roster.players.length,1);assert.equal(roster.players[0].displayName,'Fixture Query');
  assert.equal(roster.players[0].discordId,'100000000000000099');
});

test('draft captain summaries cannot masquerade as a waiting-room roster',()=>{
  const captains=realTrainerRow('Captain A','/uma/a.png')+realTrainerRow('Captain B','/uma/b.png');
  for(const code of ['', '<button aria-label="Copy room code">284-QNV</button>']) {
    const h=domHarness(code+'<section><h2>Veto Opponent’s Umamusume</h2>'+captains+'</section>');
    assert.equal(h.c.extractPrematchRosterFromRoomDom(h.document),null);
  }
  const h=domHarness(lobbyFixture(realTrainerRow(),'<p>Waiting for player...</p>').replace(/<button[^>]*>6XN-84X<\/button>/,''));
  assert.equal(h.c.extractPrematchRosterFromRoomDom(h.document),null);
});

test('DOM fallback preserves visible combined map numbers and leaves vetoes unnumbered',()=>{
  const {document}=parseHTML('<section><button aria-label="Open Nakayama 2000m map helper"><div>3</div><div>Nakayama</div><div>2000m Turf</div></button><button aria-label="Open Hanshin 2200m map helper"><span class="line-through">Hanshin</span>\n2200m Turf</button></section>');
  const c=context();evaluate(c,'draftExtraction');
  const maps=c.extractDomMaps('team1',document.querySelector('section'));
  assert.equal(maps[0].order,3);assert.equal(maps[1].order,undefined);assert.equal(maps[1].status,'vetoed');
});
