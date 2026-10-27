// Validates the generated package with bundled Codex in an empty, isolated profile.
const { spawnSync, spawn } = require('node:child_process');
const { mkdtemp, mkdir, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { prepareCodexPlugin } = require('../dist-electron/codex-integration');
(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'callme-plugin-install-'));
  const home = path.join(root, 'isolated-codex'); await mkdir(home);
  const executable = path.resolve(process.env.CALLME_CODEX_EXE || 'runtime/codex/package/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
  const bridgeExecutable = process.env.CALLME_MCP_EXE || require('electron');
  const bridgeEntry = path.resolve(process.env.CALLME_MCP_ENTRY || 'dist-electron/mcp-entry.js');
  const url = new URL(await prepareCodexPlugin(root, bridgeExecutable, bridgeEntry));
  const marketplace = url.searchParams.get('marketplacePath');
  const env = { CODEX_HOME: home };
  for (const key of ['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramData','COMSPEC']) if (process.env[key]) env[key] = process.env[key];
  const run = args => {
    const result = spawnSync(executable, args, { env, cwd: root, windowsHide: true, encoding: 'utf8', timeout: 20000 });
    if (result.status !== 0) throw new Error(args.slice(0, 3).join(' ') + ': ' + result.stderr + result.stdout + (result.error?.message || ''));
    return result.stdout;
  };
  const registered = run(['plugin','marketplace','add',(path.extname(marketplace) === '.json' ? path.dirname(marketplace) : marketplace),'--json']);
  const available = run(['plugin','list','--json']);

  const installed = run(['plugin','add','callme@callme-local','--json']);
  assert(installed.includes('callme'));
  const child = spawn(executable, ['app-server','--listen','stdio://'], { env, cwd: root, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  let buffer = ''; const pending = new Map(); let serial = 0;
  child.stdout.setEncoding('utf8'); child.stdout.on('data', data => {
    buffer += data;
    for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break; const message = JSON.parse(buffer.slice(0,end)); buffer = buffer.slice(end+1); if (message.id !== undefined && !message.method) pending.get(message.id)?.(message); }
  });
  child.stderr.on('data', () => {});
  const rpc = (method, params) => new Promise((resolve,reject) => {
    const id=++serial; const timer=setTimeout(()=>reject(Error('Codex RPC timeout: '+method)),20000);
    pending.set(id, message => { clearTimeout(timer);pending.delete(id); if(message.error)reject(Error(message.error.message));else resolve(message.result); });
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  let mcp;
  try {
    await rpc('initialize',{clientInfo:{name:'callme-package-test',version:'0.1.0'},capabilities:{experimentalApi:false}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    await rpc('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'read-only',ephemeral:true});
    mcp = await rpc('mcpServerStatus/list', {limit:100});
    assert(JSON.stringify(mcp).includes('read_meeting'), 'Codex must discover LazyCall MCP tools: '+JSON.stringify(mcp));
  } finally { child.kill(); }
  const report = { status:'passed', isolatedProfile: true, bundledCodex: true, bridgeExecutable, bridgeEntry, registration:JSON.parse(registered), installation:JSON.parse(installed), mcpDiscovered:true, modelTurnStarted:false, externalAppOpened:false, userProfileChanged:false };
  await writeFile('test-results/plugin-install.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
})().catch(error => { console.error(error.message); process.exitCode=1; });
