# Сборка LazyCall

[English](BUILD.md)

В этом документе описан текущий public-review pipeline для Windows x64 версии `0.3.5-alpha.1`. Он создаёт только артефакты для ревью: GitHub Release не публикуется, обновление пользователям не становится доступным.

## Проверки разработки

Нужны Windows x64, Node.js 24 LTS и npm.

```powershell
npm ci
npm run build
npm test
```

Эти проверки не требуют входа в ChatGPT, реальных данных встречи, микрофона или обращения к облачной модели.

## Public-review staging

Создайте свежую облегчённую staging-папку:

```powershell
npm run pack:public
```

Команда записывает `release/public-review/win-unpacked` для текущей версии приложения. В этой стадии намеренно нет встроенного Codex и четырёх app-local DLL Microsoft VC Runtime. Остаются локальная модель Whisper и CPU/CUDA-бинарники. Вместо встроенного Codex LazyCall находит установленный нативный CLI или даёт выбрать `codex.exe`; web-установщик получает одобренный Microsoft VC Runtime во время установки.

Перед сборкой установщика проверьте stage. Packaged smoke использует отдельную папку userData, синтетический WAV и заглушки внешних запусков:

```powershell
$env:CALLME_PACKAGED_EXE = (Resolve-Path 'release/public-review/win-unpacked/LazyCall.exe').Path
$env:CALLME_PUBLIC_LIGHT = '1'
node scripts/check-packaged.cjs
```

Локальный public-review stage, подключение установленного Codex и английский/русский интерфейс уже проверялись в этой среде. Это не означает, что онлайн-установщик готов для общего распространения.

## Локальный preview web-установщика

Соберите установщик и payload только для loopback:

```powershell
npm run dist:web -- --prepackaged release/public-review/win-unpacked --local-preview --review-download-only
```

Установщик будет обращаться только к `http://127.0.0.1:38473`. В отдельном терминале запустите выдачу payload:

```powershell
node scripts/serve-web-preview.cjs
```

`--review-download-only` оставляет preview в режиме ревью скачивания. Он не создаёт production release и не должен выдаваться за публичный установщик.

## Сборка с production-контурами без публикации

Используйте имя GitHub-репозитория только после ревью места выпуска. Установите его **до** public stage, чтобы приложение получило тот же адрес update feed:

```powershell
$env:CALLME_RELEASE_REPOSITORY = 'IgorMonkey/LazyCall'
npm run pack:public
npm run dist:web -- --prepackaged release/public-review/win-unpacked --full-installer
```

Сборка проверяет формат `owner/repository` и записывает в staging GitHub-provider update feed для точного репозитория. Так как эта версия — prerelease, semver-конфигурация приложения после публикации использует соответствующий feed `alpha.yml`. Вызовы Electron Builder идут с `--publish never`: команды собирают файлы локально и не создают репозиторий, не загружают ассеты, не публикуют релиз и не включают обновления.

Онлайн-установщик всё ещё требует настоящей end-to-end проверки на подходящей чистой Windows-машине до публичной раздачи. Нужно проверить скачивание, ошибку checksum, загрузку и установку VC Runtime, сценарии отсутствующего и установленного Codex, удаление и обновление. Релизные заметки и ассеты остаются на ревью мейнтейнера.

## Не используйте старые офлайн-артефакты как публичные

`npm run dist:win` и прежний setup разработки содержат app-local DLL Microsoft VC Runtime и в офлайн-пути — Codex. Они полезны для разработки и исторической проверки, но не одобрены как публичные ассеты этого pipeline. Не загружайте `runtime/`, старые локальные установщики или любой артефакт из `release/` без указанного выше релизного ревью.
