// Builds a local, synthetic-only review gallery.  It invokes fixture checks only;
// it never opens saved meetings, replay/audit data, a microphone, or a provider.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const results = path.join(root, 'test-results');
const docsOutput = path.join(root, 'docs', 'screenshots');
const reviewOutput = path.join(root, 'release', 'maintainer-review', 'full-gallery');
const { version } = require('../package.json');

const checks = [
  ['check-ui.cjs'],
  ['check-interactions.cjs'],
  ['check-compact-ui.cjs'],
  ['check-assistant-ui.cjs', '--palette'],
  ['check-assistant-ui.cjs', '--onboarding'],
  ['check-assistant-ui.cjs', '--locales'],
  ['check-assistant-ui.cjs', '--header'],
  ['check-assistant-ui.cjs', '--spacing'],
  ['check-assistant-ui.cjs', '--transcript-follow'],
  ['check-assistant-ui.cjs', '--workflow-ui'],
  ['check-assistant-ui.cjs', '--project-context'],
  ['check-assistant-ui.cjs', '--theme'],
  ['check-assistant-ui.cjs']
];

const screens = [
  ['callme-idle.png', 'Idle', 'Idle meeting screen'],
  ['callme-live.png', 'Live', 'Live recording'],
  ['assistant-main-done-v8.png', 'Done', 'Saved meeting with transcript, assistant reply, and outcomes'],
  ['theme-light-main-1264.png', 'Assistant answer', 'Assistant answer in the main window'],
  ['assistant-project-reading.png', 'Assistant streaming', 'Assistant reads connected project context'],
  ['results-noauth-dark-904.png', 'Assistant disconnected', 'Assistant unavailable until Codex sign-in'],
  ['compact-dark-error.png', 'Assistant error', 'Retryable compact-window error'],
  ['repository-empty-light.png', 'Materials — no folder', 'Optional project folder before it is connected'],
  ['repository-analysis-reading.png', 'Materials — progress', 'Project overview progress'],
  ['repository-connected-light.png', 'Materials — overview', 'Connected repository overview'],
  ['repository-analysis-timeout.png', 'Materials — error', 'Recoverable project overview timeout'],
  ['assistant-projects-list-v7.png', 'Projects', 'Project list'],
  ['assistant-projects-form-v7.png', 'Projects', 'New project form'],
  ['callme-transcript.png', 'Transcript', 'Saved transcript'],
  ['assistant-results-v7.png', 'Outcomes', 'Generated decisions, tasks, and questions'],
  ['results-empty-light-1264.png', 'Outcomes', 'Empty outcomes state'],
  ['assistant-settings-v8.png', 'Settings', 'Codex and assistant settings'],
  ['settings-spacing-appearance-1264.png', 'Settings', 'Appearance, compact window, and shortcuts'],
  ['review-en-codex-missing.png', 'Codex runtime', 'English: Codex not found'],
  ['review-en-codex-found.png', 'Codex runtime', 'English: installed Codex found'],
  ['review-en-updates-unconfigured.png', 'Updates', 'Update channel unavailable'],
  ['review-en-update-progress-demo.png', 'Updates', 'Update download progress fixture'],
  ['review-en-update-ready-demo.png', 'Updates', 'Update ready-to-install fixture'],
  ['review-onboarding-ru-light-step1.png', 'Onboarding', 'Russian onboarding, step 1'],
  ['review-onboarding-ru-light-step2.png', 'Onboarding', 'Russian onboarding, step 2'],
  ['review-onboarding-ru-light-step3.png', 'Onboarding', 'Russian onboarding, step 3'],
  ['review-onboarding-en-dark-step1-904.png', 'Onboarding', 'English dark onboarding, step 1'],
  ['review-onboarding-en-dark-step2-motion-904.png', 'Onboarding', 'English dark onboarding, step 2'],
  ['review-onboarding-en-dark-step3-904.png', 'Onboarding', 'English dark onboarding, step 3'],
  ['compact-live.png', 'Compact', 'Live compact reply target'],
  ['compact-project-reading.png', 'Compact', 'Compact project-reading progress'],
  ['compact-dark-error.png', 'Compact', 'Dark compact error and retry'],
  ['compact-narrow.png', 'Compact', 'Compact window at minimum width'],
  ['header-ru-light-640.png', 'Responsive header', 'Russian light header at 640 px'],
  ['header-en-dark-640.png', 'Responsive header', 'English dark header at 640 px'],
  ['header-ru-light-900.png', 'Responsive header', 'Russian header and More menu at 900 px'],
  ['review-palette-light-main.png', 'Theme', 'Light theme'],
  ['review-palette-dark-main.png', 'Theme', 'Dark theme'],
  ['review-en-light-main.png', 'Locale', 'English main interface'],
  ['review-ru-light-main.png', 'Locale', 'Russian main interface']
];
const heroAliases = [
  ['review-palette-light-main.png', 'main-light.png'],
  ['review-palette-dark-main.png', 'main-dark.png']
];
const publicScreens = new Set([
  'assistant-main-done-v8.png', 'assistant-live-target-v8.png', 'assistant-results-v7.png',
  'repository-connected-light.png', 'repository-analysis-reading.png', 'assistant-settings-v8.png',
  'review-onboarding-en-dark-step3-904.png', 'review-onboarding-ru-light-step3.png',
  'compact-live.png', 'compact-dark-error.png', 'header-ru-light-640.png'
]);

const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
async function copy(source, target) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(source, target); }

(async () => {
  for (const [script, ...args] of checks) {
    console.log(`fixture capture: ${script} ${args.join(' ')}`);
    execFileSync(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, CALLME_UI_DIST: process.env.CALLME_UI_DIST || path.join(root, 'dist') } });
  }
  await fs.rm(docsOutput, { recursive: true, force: true });
  await fs.rm(reviewOutput, { recursive: true, force: true });
  await fs.mkdir(docsOutput, { recursive: true });
  await fs.mkdir(path.join(reviewOutput, 'screens'), { recursive: true });
  const manifest = [];
  for (const [file, group, title] of screens) {
    const source = path.join(results, file);
    const data = await fs.readFile(source);
    const digest = createHash('sha256').update(data).digest('hex');
    if (publicScreens.has(file)) await copy(source, path.join(docsOutput, file));
    await copy(source, path.join(reviewOutput, 'screens', file));
    manifest.push({ file, group, title, bytes: data.length, sha256: digest, fixture: true });
  }
  for (const [sourceFile, alias] of heroAliases) {
    await copy(path.join(results, sourceFile), path.join(docsOutput, alias));
    await copy(path.join(results, sourceFile), path.join(reviewOutput, 'screens', alias));
  }
  const groups = [...new Set(manifest.map(item => item.group))];
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LazyCall ${version} — synthetic UI gallery</title><style>body{margin:0;background:#13161c;color:#f1f3f6;font:16px/1.55 system-ui}main{max-width:1320px;margin:auto;padding:30px 20px}p{color:#b8c0ca;max-width:960px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}figure{margin:0;border:1px solid #39414d;border-radius:10px;overflow:hidden;background:#1d222b}img{width:100%;display:block;background:#fff}figcaption{padding:10px 12px;font-weight:600}small{display:block;color:#aab3bf;font-weight:400}h2{margin-top:42px}</style><main><h1>LazyCall ${version} — synthetic UI gallery</h1><p>Every image is regenerated from a local Playwright fixture. No real meeting, recording, repository, account, provider response, audit, or replay material is included.</p>${groups.map(group => `<section><h2>${escape(group)}</h2><div class="grid">${manifest.filter(item => item.group === group).map(item => `<figure><a href="screens/${encodeURIComponent(item.file)}"><img src="screens/${encodeURIComponent(item.file)}" alt="${escape(item.title)}" loading="lazy"></a><figcaption>${escape(item.title)}<small>${escape(item.file)}</small></figcaption></figure>`).join('')}</div></section>`).join('')}</main>`;
  await fs.writeFile(path.join(reviewOutput, 'index.html'), html, 'utf8');
  await fs.writeFile(path.join(reviewOutput, 'index.json'), JSON.stringify({ version, syntheticOnly: true, generatedBy: 'scripts/build-screenshot-gallery.cjs', screens: manifest }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', output: reviewOutput, docsOutput, screenshots: manifest.length, fixtureChecks: checks.length, syntheticOnly: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
