// Local review artifact only. Uses synthetic screenshots, never meeting data.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'release', 'maintainer-review');
const { version } = require('../package.json');
const screens = [
  ['review-palette-light-main.png', 'Светлая тема — пример расшифровки и ответа'],
  ['review-palette-dark-main.png', 'Тёмная тема — графит и коралловый'],
  ['review-palette-dark-settings.png', 'Настройки — нейтральная активная вкладка'],
  ['review-onboarding-ru-light-step1.png', 'RU — первый запуск'],
  ['review-onboarding-en-dark-step3-904.png', 'EN — контекст необязателен'],
  ['review-en-codex-missing.png', 'EN — подключение установленного Codex'],
  ['review-en-dark-materials.png', 'EN — материалы встречи'],
  ['review-en-dark-results.png', 'EN — понятный следующий шаг без записи'],
  ['review-en-update-progress-demo.png', 'Обновление — демонстрация состояния загрузки'],
  ['header-ru-light-900.png', 'Шапка — минимальная ширина основного окна, меню «Ещё»'],
  ['header-en-dark-1264.png', 'Шапка — English, тёмная тема'],
];
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
(async () => {
  await fs.mkdir(path.join(output, 'screens'), { recursive: true });
  for (const [file] of screens) await fs.copyFile(path.join(root, 'test-results', file), path.join(output, 'screens', file));
  const reports = ['palette-review.json', 'localization-review.json', 'onboarding-review.json', 'spacing-audit.json', 'header-review.json', 'packaged-check.json', 'updates-desktop-check.json'];
  for (const file of reports) await fs.copyFile(path.join(root, 'test-results', file), path.join(output, file));
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LazyCall — review ${version}</title><style>body{margin:0;background:#12151b;color:#f0f3f8;font:16px/1.6 system-ui}main{max-width:1280px;margin:auto;padding:32px 24px}h1{font-size:30px}p{color:#b7c1d0;max-width:850px}section{margin:40px 0}h2{font-size:20px}img{display:block;width:100%;height:auto;border:1px solid #394454;border-radius:8px}a{color:#ff897a}nav{display:flex;flex-wrap:wrap;gap:16px}</style><main><h1>LazyCall ${version} — локальное ревью</h1><p>Рабочий интерфейс приложения на синтетических данных. Ответ на основном экране и прогресс обновления подготовлены тестовым сценарием: это не результаты работы облачной модели и не скачивание настоящего обновления. Публичный репозиторий и релиз ещё не созданы.</p><nav><a href="../../README.ru.md">README RU</a><a href="../../README.md">README EN</a></nav>${screens.map(([file, title]) => `<section><h2>${escape(title)}</h2><a href="screens/${file}"><img src="screens/${file}" alt="${escape(title)}" loading="lazy"></a></section>`).join('')}</main>`;
  await fs.writeFile(path.join(output, 'index.html'), html, 'utf8');
  const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean).sort();
  const files = [];
  for (const file of candidates) {
    const data = await fs.readFile(path.join(root, file));
    files.push({ file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  const manifest = { version, published: false, branch: execFileSync('git', ['branch', '--show-current'], { cwd: root }).toString().trim(), files, excluded: ['runtime/', 'release/', 'test-results/', 'node_modules/', '.env*'] };
  await fs.writeFile(path.join(output, 'source-manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(output, 'source-files.txt'), files.map(entry => entry.file).join('\n'));
  console.log(JSON.stringify({ output, screens: screens.length, sourceFiles: files.length, sourceBytes: files.reduce((sum, entry) => sum + entry.bytes, 0), published: false }));
})().catch(error => { console.error(error); process.exitCode = 1; });
