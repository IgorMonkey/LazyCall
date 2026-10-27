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
