// Actual native engine checks, using synthetic speech only. No device capture.
const { Whisper } = require(process.env.CALLME_RUNTIME_MODULE || '../dist-electron/whisper');
const { mkdtemp, readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

function assertLocalVcRuntime(engine, executable) {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$p=Get-Process -Id ([int]$env:CALLME_RUNTIME_PID); @($p.Modules | Where-Object {$_.ModuleName -match "^(msvcp140|vcruntime140|vcruntime140_1|vcomp140)[.]dll$"} | ForEach-Object {$_.FileName}) | ConvertTo-Json -Compress'],
    { windowsHide: true, timeout: 10000, encoding: 'utf8', env: { ...process.env, CALLME_RUNTIME_PID: String(engine.child.pid) } });
  const modules = JSON.parse(output);
  for (const name of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll']) {
    assert(modules.some(file => path.basename(file).toLowerCase() === name && path.dirname(file).toLowerCase() === path.dirname(executable).toLowerCase()), 'Whisper must load its bundled VC runtime: ' + name);
  }
}

async function waitFor(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for native lifecycle');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function pcmData(wav) {
  for (let offset = 12; offset + 8 <= wav.length;) {
    const length = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data') return wav.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + length % 2;
  }
  throw new Error('Missing WAV data');
}

(async () => {
  const root = path.resolve('runtime/whisper');
  const fixture = pcmData(await readFile('test-results/speech-16k.wav'));
  const errors = [], finals = [], result = {};
  const engine = new Whisper(root);
  engine.onError = message => errors.push(message);
  engine.onText = async (job, text) => finals.push({ source: job.source, startMs: job.startMs, text });
  try {
    let started = Date.now();
    await engine.start();
    result.coldStartupMs = Date.now() - started;
    result.actualBackend = engine.status.backend;
    assert.equal(engine.status.state, 'ready');
    const runtimeManifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    assertLocalVcRuntime(engine, path.join(root, statusExecutable(runtimeManifest, engine.status.backend)));
    result.appLocalVcRuntime = true;
    for (const [index, source] of ['self', 'remote'].entries()) {
      started = Date.now();
      engine.enqueue({ source, startMs: index * 10000, endMs: index * 10000 + fixture.length / 32, pcm: fixture });
      await engine.drain();
      result[index ? 'warmInferenceMs' : 'firstInferenceMs'] = Date.now() - started;
      assert(finals[index]?.text.includes('заявки'), 'Native engine failed synthetic Russian phrase');
      assert.equal(finals[index].source, source);
    }
    // Stop immediately after queuing both speakers: drain must include both finals.
    engine.enqueue({ source: 'self', startMs: 20000, endMs: 29000, pcm: fixture });
    engine.enqueue({ source: 'remote', startMs: 30000, endMs: 39000, pcm: fixture });
    started = Date.now();
    await engine.drain();
    result.stopDrainMs = Date.now() - started;
    assert.equal(finals.length, 4);
    assert.deepEqual(errors, []);
    const child = engine.child;
    engine.close();
    await waitFor(() => child.exitCode !== null || child.signalCode !== null);
    result.ownedChildStopped = true;

    // Exercise automatic CPU fallback with a separate manifest, without touching real DLLs.
    const fallbackRoot = await mkdtemp(path.resolve('test-results/runtime-fallback-'));
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    await writeFile(path.join(fallbackRoot, 'manifest.json'), JSON.stringify({
      cpu: path.relative(fallbackRoot, path.join(root, manifest.cpu)),
      model: path.relative(fallbackRoot, path.join(root, manifest.model)), cuda: 'missing-cuda.exe'
    }));
    const fallback = new Whisper(fallbackRoot);
    try {
      await fallback.start();
      assert.equal(fallback.status.backend, 'CPU');
      assertLocalVcRuntime(fallback, path.join(root, manifest.cpu));
      result.appLocalCpuVcRuntime = true;
      const texts = [], failures = [];
      fallback.onText = async (_, text) => texts.push(text);
      fallback.onError = error => failures.push(error);
      fallback.enqueue({ source: 'self', startMs: 0, endMs: fixture.length / 32, pcm: fixture });
      started = Date.now(); await fallback.drain();
      result.cpuInferenceMs = Date.now() - started;
      assert(texts[0]?.includes('заявки'));
      assert.deepEqual(failures, []);
      result.cpuFallback = true;
    } finally { fallback.close(); }

    // A runtime can accept GPU flags yet load CPU silently; status follows buffers,
    // rather than the executable path we attempted to launch.
    await writeFile(path.join(fallbackRoot, 'manifest.json'), JSON.stringify({
      cpu: path.relative(fallbackRoot, path.join(root, manifest.cpu)),
      model: path.relative(fallbackRoot, path.join(root, manifest.model)),
      cuda: path.relative(fallbackRoot, path.join(root, manifest.cpu))
    }));
    const silentFallback = new Whisper(fallbackRoot);
    try {
      await silentFallback.start();
      assert.equal(silentFallback.status.backend, 'CPU');
      result.silentCpuBackendReported = true;
    } finally { silentFallback.close(); }

    // Quit during cold startup must not restart another backend or leak the owned child.
    const cancelled = new Whisper(root);
    const launch = cancelled.start();
    await waitFor(() => cancelled.child !== null);
    const cancelledChild = cancelled.child;
    started = Date.now(); cancelled.close();
    await launch;
    await waitFor(() => cancelledChild.exitCode !== null || cancelledChild.signalCode !== null);
    assert.equal(cancelled.child, null);
    assert.notEqual(cancelled.status.state, 'ready');
    result.cancelStartupMs = Date.now() - started;
    result.noRestartAfterClose = true;
    result.finals = finals;
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/runtime-check.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: 'passed', ...result }));
  } finally { engine.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

function statusExecutable(manifest, backend) { return backend === 'CUDA' ? manifest.cuda : manifest.cpu; }
