const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Whisper } = require('../dist-electron/whisper');

test('slow inference exposes active backlog, bounds queued audio, and reports dropped phrases', async () => {
  const originalFetch = global.fetch;
  const requests = [], progress = [], errors = [], received = [];
  const whisper = new Whisper('unused');
  whisper.status = { state: 'ready', label: 'Fixture', backend: 'CPU' };
  whisper.onStatus = value => progress.push(value);
  whisper.onError = message => errors.push(message);
  whisper.onText = async job => received.push(job.startMs);
  global.fetch = (_, options) => new Promise((resolve, reject) => {
    requests.push(() => resolve({ ok: true, json: async () => ({ text: 'Synthetic speech' }) }));
    options.signal.addEventListener('abort', () => reject(Error('Fixture aborted')), { once: true });
  });
  try {
    for (let index = 0; index < 6; index++) whisper.enqueue({ source: 'self', startMs: index, endMs: index + 1, pcm: new Uint8Array(640) });
    assert.equal(whisper.status.pending, 5);
    assert.equal(whisper.status.dropped, 1);
    assert(whisper.status.oldestQueuedAt <= Date.now());
    assert(errors.some(message => message.includes('пропущен фрагмент')));
    assert(progress.every(value => value.pending <= 5));
    let index = 0;
    while (whisper.status.pending) {
      assert(requests[index], 'Queued inference must become runnable');
      requests[index++]();
      await new Promise(resolve => setImmediate(resolve));
    }
    await whisper.drain();
    assert.deepEqual(received, [0, 2, 3, 4, 5]);
    assert.equal(whisper.status.oldestQueuedAt, undefined);
    assert.equal(whisper.status.pending, 0);
  } finally { whisper.close(); global.fetch = originalFetch; }
});

function controlledInference(context, backend) {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const whisper = new Whisper('unused'), requests = [], errors = [], texts = [];
  whisper.status = { state: 'ready', label: 'Fixture', backend };
  whisper.onError = message => errors.push(message);
  whisper.onText = async (_, text) => texts.push(text);
  context.mock.method(global, 'fetch', (_, options) => new Promise((resolve, reject) => {
    requests.push({ signal: options.signal, complete: () => resolve({ ok: true, json: async () => ({ text: 'Synthetic speech' }) }) });
    options.signal.addEventListener('abort', () => reject(Error('Fixture aborted')), { once: true });
  }));
  context.after(() => whisper.close());
  const enqueue = () => whisper.enqueue({ source: 'self', startMs: 0, endMs: 20, pcm: new Uint8Array(640) });
  return { whisper, requests, errors, texts, enqueue };
}

test('CPU speech can finish after 45 seconds without being discarded', async context => {
  const fixture = controlledInference(context, 'CPU');
  fixture.enqueue();
  context.mock.timers.tick(45000);
  assert.equal(fixture.requests[0].signal.aborted, false);
  assert.equal(fixture.whisper.status.pending, 1);
  fixture.requests[0].complete();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fixture.texts, ['Synthetic speech']);
  assert.equal(fixture.whisper.status.pending, 0);
  context.mock.timers.tick(120000);
  assert.deepEqual(fixture.errors, []);
});

for (const [backend, elapsed] of [['CPU', 121000], ['CUDA', 31000]]) {
  test(`${backend} inference still aborts when its bounded budget expires`, async context => {
    const fixture = controlledInference(context, backend);
    fixture.enqueue();
    context.mock.timers.tick(elapsed);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.requests[0].signal.aborted, true);
    assert.equal(fixture.whisper.status.pending, 0);
    assert.equal(fixture.errors.length, 1);
    assert.deepEqual(fixture.texts, []);
  });
}

test('stopping slow CPU speech still drops queued audio after the drain limit', async context => {
  const fixture = controlledInference(context, 'CPU');
  fixture.enqueue(); fixture.enqueue();
  context.mock.timers.tick(45000);
  const drained = fixture.whisper.drain();
  context.mock.timers.tick(20001);
  await new Promise(resolve => setImmediate(resolve));
  context.mock.timers.tick(25);
  await drained;
  assert.equal(fixture.requests[0].signal.aborted, true);
  assert.equal(fixture.requests.length, 1, 'Stopping must discard the pending fragment');
  assert.equal(fixture.whisper.status.pending, 0);
  assert(fixture.errors.some(message => message.includes('20 секунд')));
  assert.deepEqual(fixture.texts, []);
});
