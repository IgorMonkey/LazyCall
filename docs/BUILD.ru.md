# Сборка LazyCall

[English](BUILD.md)

В этом документе описан текущий public-review pipeline для Windows x64 версии `0.3.6`. Он создаёт только артефакты для ревью: GitHub Release не публикуется, обновление пользователям не становится доступным.

## Проверки разработки

Нужны Windows x64, Node.js 24 LTS, Corepack и Yarn 4.13.0. Репозиторий закрепляет эту точную версию Yarn через `packageManager`; Corepack-подбор подтверждает `yarn --version`. `nodeLinker: node-modules` оставлен намеренно для Electron tooling.

```powershell
corepack enable
yarn --version
yarn install --immutable
yarn build
yarn test
```

Эти проверки не требуют входа в ChatGPT, реальных данных встречи, микрофона или обращения к облачной модели.

## Public-review staging

Создайте свежую облегчённую staging-папку:

```powershell
yarn pack:public
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
yarn dist:web --prepackaged release/public-review/win-unpacked --local-preview --review-download-only
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
yarn pack:public
yarn dist:web --prepackaged release/public-review/win-unpacked --full-installer
```

Сборка проверяет формат `owner/repository` и записывает в staging GitHub-provider update feed для точного репозитория. Обычный релиз использует соответствующий feed `latest.yml`; будущий prerelease-канал — отдельное осознанное решение о выпуске. Вызовы Electron Builder идут с `--publish never`: команды собирают файлы локально и не создают репозиторий, не загружают ассеты, не публикуют релиз и не включают обновления.

Изолированный локальный сценарий установщика уже прошёл установку, повтор после повреждённой загрузки и удаление. Чистая Windows-машина без Microsoft VC Runtime и реальный путь обновления через GitHub пока не проверены. Укажите эти ограничения для раннего релиза; релизные заметки и ассеты остаются на ревью мейнтейнера.

## Не используйте старые офлайн-артефакты как публичные

`yarn dist:win` и прежний setup разработки содержат app-local DLL Microsoft VC Runtime и в офлайн-пути — Codex. Они полезны для разработки и исторической проверки, но не одобрены как публичные ассеты этого pipeline. Не загружайте `runtime/`, старые локальные установщики или любой артефакт из `release/` без указанного выше релизного ревью.
