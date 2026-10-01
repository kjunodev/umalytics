import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, context } from './support/helpers.mjs';

test('recorder caps the trace and never stores arbitrary payloads, identifiers, or tokens',async()=>{
  const stored={};const c=context({browser:{storage:{local:{get:async()=>({}),set:async value=>Object.assign(stored,value)}}}});
  evaluate(c,'diagnosticRecorder');
  const clean=c.sanitizeDiagnostic({kind:'room',reason:'match-snapshot',room:'M95Z2Z',team1:5,token:'SECRET',payload:{chat:'SECRET'},discordId:'SECRET',endpoint:'SECRET',phase:'SECRET'});
  assert(!JSON.stringify(clean).includes('SECRET'));
  for(let i=0;i<250;i++)c.recordDiagnostic({kind:'room',reason:'match-snapshot',version:i,team1:5,team2:5});
  const trace=await c.getDiagnosticTrace();assert.equal(trace.length,200);assert.equal(trace[0].version,50);assert.equal(trace.at(-1).version,249);
});
