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

test('feed-field diagnostics have a separate session cap and survive a service-worker restart', async () => {
  const session = {};
  const recorder = () => {
    const c = context({ browser: { storage: {
      local: { get: async () => ({}) },
      session: { get: async () => structuredClone(session), set: async value => Object.assign(session, structuredClone(value)) }
    } } });
    evaluate(c, 'diagnosticRecorder');
    return c;
  };
  const firstWorker = recorder();
  assert.equal(firstWorker.formatUnrecognisedFeedFields(await firstWorker.getUnrecognisedFeedFields()), 'Unrecognised feed fields\nnone');
  const send = (worker, fields) => worker.recordDiagnostic({ kind: 'feed-fields', fields });
  await send(firstWorker, [
    { name: '123456789012345678', count: 1, firstEventType: 'match.snapshot' },
    { name: 'futureField', count: 1, firstEventType: 'AB3-D9E' },
    { name: 'futureField', count: 2, firstEventType: 'match.snapshot', privateValue: 'Fixture Private Value' }
  ]);
  const secondWorker = recorder();
  await Promise.all([
    send(secondWorker, Array.from({ length: 50 }, (_, i) => ({ name: 'future.option-' + i, count: 1, firstEventType: 'match.snapshot' }))),
    send(secondWorker, [{ name: 'futureField', count: 3, firstEventType: 'room.future.updated' }])
  ]);
  const fields = await secondWorker.getUnrecognisedFeedFields();
  assert.equal(fields.length, 50);
  assert.equal(secondWorker.formatUnrecognisedFeedFields(fields).split('\n')[1], 'futureField ×5 (first seen in match.snapshot)');
  assert.doesNotMatch(JSON.stringify(session), /Fixture Private Value|123456789012345678|AB3-D9E/);
  assert.equal((await secondWorker.getDiagnosticTrace()).length, 0);
});
