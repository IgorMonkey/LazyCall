const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startTurnTimeout } = require(path.join(process.env.CALLME_TEST_BUILD || path.join(__dirname, '../dist-electron'), 'turn-timeout'));

test('an active ordinary turn survives one minute but never exceeds five minutes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expired = [];
  const timer = startTurnTimeout(reason => expired.push(reason));
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(60_000); assert.deepEqual(expired, []); timer.touch(); }
  t.mock.timers.tick(60_000);
  assert.deepEqual(expired, ['total']);
  timer.touch(); t.mock.timers.tick(300_000);
  assert.deepEqual(expired, ['total']);
});

test('every turn renews inactivity and expires after two idle minutes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expired = [];
  const timer = startTurnTimeout(reason => expired.push(reason));
  t.mock.timers.tick(90_000); timer.touch();
  t.mock.timers.tick(119_999); assert.deepEqual(expired, []);
  t.mock.timers.tick(1); assert.deepEqual(expired, ['idle']);
  t.mock.timers.tick(300_000); assert.deepEqual(expired, ['idle']);
});

test('completion or cancellation clears all timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timer = startTurnTimeout(() => assert.fail('Closed deadline fired'));
  t.mock.timers.tick(10_000); timer.clear(); timer.touch(); t.mock.timers.tick(600_000);
});
