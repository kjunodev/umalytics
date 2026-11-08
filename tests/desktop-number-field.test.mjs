import test from 'node:test';
import assert from 'node:assert/strict';
import { numberFieldValue } from '../apps/desktop/src/numberFieldValue.ts';

test('clearing or entering an invalid draft commits nothing', () => {
  for (const draft of ['', ' ', '-', '+', 'abc', '1.5', '1e3', '0', '-1', '2001', 'Infinity']) {
    assert.equal(numberFieldValue(draft, 1, 2000), undefined, draft);
  }
});

test('integer drafts commit through a clear and retype sequence, including bounds', () => {
  let committed = 1120;
  for (const draft of ['', '1', '12', '120', '1200']) committed = numberFieldValue(draft, 1, 2000) ?? committed;
  assert.equal(committed, 1200);
  for (const draft of ['', 'bad', '2001']) committed = numberFieldValue(draft, 1, 2000) ?? committed;
  assert.equal(committed, 1200);
  assert.equal(numberFieldValue('1', 1, 2000), 1);
  assert.equal(numberFieldValue('2000', 1, 2000), 2000);
  assert.equal(numberFieldValue('0', 0, 10), 0);
});
