import test from 'node:test';

// Advance only between event-loop turns so promise continuations drain before
// the next timer fires. Runner load cannot consume any simulated deadline.
export default function clockTest(name, body) {
  return test(name, async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
    let settled = false;
    const pending = Promise.resolve().then(() => body(t));
    pending.then(() => { settled = true; }, () => { settled = true; });
    for (let elapsed = 0; !settled && elapsed < 120_000; elapsed += 10) {
      await new Promise(resolve => setImmediate(resolve));
      if (!settled) t.mock.timers.tick(10);
    }
    if (!settled) throw new Error('Test exceeded 120 seconds of controlled time');
    await pending;
  });
}
