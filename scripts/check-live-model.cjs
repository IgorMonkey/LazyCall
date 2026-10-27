// Explicit integration check using synthetic text only; never loads meeting journals or frames.
const path = require('node:path');
const { writeFile, mkdir } = require('node:fs/promises');
const { CodexProvider } = require('../dist-electron/codex-provider');
const { parseGeneratedResults } = require('../dist-electron/results');
const data = path.join(process.env.APPDATA, 'CallMe');
const provider = new CodexProvider(path.resolve('runtime/codex/package/vendor/x86_64-pc-windows-msvc/bin/codex.exe'), path.join(data, 'codex-home'), path.join(data, 'assistant-workspace'));
(async () => {
  try {
    const status = await provider.connect();
    if (status.state !== 'ready') throw new Error('CallMe account login required; no auth store fallback is used');
    const catalog = await provider.models();
    const model = catalog.find(model => model.isDefault) || catalog[0];
    if (!model) throw new Error('No available model');
    const line = { id: 'a47c03bc-47de-4b27-89c8-03ea4630a2f7', source: 'remote', startMs: 0, endMs: 3000, text: 'В этом выступлении объясняют, как облака образуются из водяного пара. Решений и задач никто не согласовывает.' };
    let output = '';
    await provider.run({ id: 'synthetic-summary-test', model: model.id, reasoningEffort: model.reasoningEfforts.includes('low') ? 'low' : 'default', images: [], webSearch: false,
      text: `Это синтетический тест CallMe. Составь краткое содержание записи. Никаких рабочих договорённостей нет: items должен быть пустым. Верни только JSON {"summary":"содержание по-русски","items":[]}. Реплика ${line.id}: ${line.text}`,
      onText: text => { output = text; }
    });
    const result = parseGeneratedResults(output, [line]);
    if (!result.summary || result.items.length) throw new Error('Synthetic non-meeting summary contract failed');
    const report = { result: 'passed', actualModel: provider.status.model, catalogCount: catalog.length, summary: result.summary, structuredItems: result.items.length, syntheticOnly: true, webSearch: false, images: false };
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/live-model.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { provider.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
