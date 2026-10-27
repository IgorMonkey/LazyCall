# Аудит стека

Дата проверки: **25 октября 2026, Europe/Moscow**. Область: личный помощник для Windows, согласованный [флоу](PRODUCT_FLOW.md). Это аудит осуществимости и выбор начальной архитектуры. Работающий захват, качество STT и задержка LLM ещё не подтверждены.

## 1. Решение

Рекомендован **свой Electron + TypeScript + React/Vite**, без веб-сервера, отдельного backend и Python-сервиса в первом варианте.

Первый агент — **Codex через официальный CLI, app-server по stdio**. SDK/exec проще для конечного задания, но для нашего интерфейса существенны текстовые дельты, отдельные thread/turn и отмена. app-server подходит этому контракту лучше. Это инженерный вывод по документации и локальным схемам, а не результат замера живой генерации. Официальная документация также различает SDK для программных заданий и app-server для глубокого встраивания клиента: [SDK](https://learn.chatgpt.com/docs/codex-sdk), [app-server](https://learn.chatgpt.com/docs/app-server).

В первом эксперименте используем уже установленный CLI 0.145.0 как внешний runtime, проверяем его версию и конкретный протокол. Глобальный Codex не обновляем. Если эту версию нельзя изолировать или она не проходит живые проверки, испытываем отдельный runtime 0.164.0 в каталоге приложения. Схемы от разных версий не смешиваем.

STT отделён от LLM. После уточнения пользователя основной кандидат — локальный Whisper, включённый в поставку через whisper.cpp. Первая проверка сравнивает мультиязычные модели и backend на двух источниках; облачный STT остаётся опцией при недостаточной скорости/точности. Хранилище первого варианта — append-only JSONL и восстанавливаемые проекции.

## 2. Сравнение desktop-основ

| Вариант | Что облегчает | Что придётся сделать | Вывод для этой задачи |
| --- | --- | --- | --- |
| Electron + TS/React | Windows system loopback, выбор окна, Web Audio, Node для CLI/STT; один основной язык | Проверить реальные endpoints/гарнитуры, сделать очередь и безопасный IPC; Chromium увеличивает память и размер | Основной вариант: быстрее проверить полный поток |
| Tauri 2 + Rust/React | Доступ к WASAPI и Win32; WebView2 вместо собственного Chromium | Rust/C++ toolchain, native capture, IPC, поставка Codex; готовый web display-capture не считать эквивалентом Electron API | Возвращаться при неприемлемом capture/footprint Electron |
| .NET/WPF | Естественная Windows-интеграция, WASAPI и Windows.Graphics.Capture через библиотеки/interop | C# UI, D3D/WinRT interop, управление CLI и STT; .NET SDK сейчас не найден | Сильный запасной вариант, если решающим станет native capture |
| Fork NexQ | Готовые meeting UI, audio capture, STT/LLM настройки, история и RAG | Добавить наш screen pipeline, Codex, журнал с основаниями и правила очередей; принять существующую большую архитектуру | Не брать базой сейчас; использовать как справочник решений |

Это сравнительная инженерная оценка объёма работ, не benchmark размера и CPU. Для Tauri официально нужны Rust, Microsoft C++ Build Tools и WebView2: [prerequisites](https://v2.tauri.app/start/prerequisites/). Native screen capture для Windows имеет отдельную interop-поверхность: [Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/).

NexQ проверен по README, package.json, дереву исходников и нескольким целевым файлам на main: версия 2.27.1, MIT, Tauri/Rust + React. Его системный capture открывает input stream на output-устройстве через cpal; flush transcript задан интервалом 30 секунд. Это полезный опыт для capture, но не подходящая гарантия сохранности нашего final transcript. Отсутствие нужного нам готового screen→agent флоу и совместимого live-контракта означает дополнительную работу; отсутствие любой возможной API-поверхности во всём проекте этим узким чтением не доказано. Источники: [репозиторий](https://github.com/naxhq/NexQ), [capture](https://github.com/naxhq/NexQ/blob/main/src-tauri/src/audio/system_capture.rs), [persistence](https://github.com/naxhq/NexQ/blob/main/src/hooks/useTranscriptPersistence.ts), [лицензия](https://github.com/naxhq/NexQ/blob/main/LICENSE). main изменяемый; при заимствовании закрепить commit и сохранить уведомление MIT.

## 3. Capture: подтверждённое и неизвестное

Electron предоставляет desktopCapturer и setDisplayMediaRequestHandler. Main выбирает разрешённый источник, renderer получает MediaStream через getDisplayMedia. Для Windows callback может вернуть выбранное video и audio: 'loopback'. Это **системный звук**, не звук выбранного окна. На deviceId в getDisplayMedia для выбора окна не полагаемся. Источники: [desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer), [session](https://www.electronjs.org/docs/latest/api/session); дополнительно сверено через Context7 /electron/electron.

Микрофон открывается отдельно через getUserMedia с выбранным audio deviceId. Потоки не смешиваются до STT. Пара «мой mic / remote loopback» даёт роль источника, но не имена удалённых участников.

Не проверены:

- Откуда Electron реально берёт loopback, если ВКС выводит звук на нестандартный endpoint.
- Смена default output, USB-гарнитуры, Bluetooth и hands-free профиля во время звонка.
- Дубли голоса, echo cancellation и пропуски при одновременной речи.
- Отдельное окно демонстрации, минимизация, изменение DPI/монитора и замершие кадры.
- Стабильность AudioWorklet и capture после упаковки приложения.

Если требуется именно process audio, запасной путь — native helper на Microsoft process-loopback. Официальный пример поддерживает включение/исключение дерева процессов, требует Windows build 20348+ и не привязан к одному физическому endpoint. Локальный build 26100 проходит только минимальный порог API; это не подтверждение готовности helper или всех устройств. [Microsoft sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/).

У native helper остаются отдельные сложности: выбрать PID/дерево ВКС, учесть браузерный Телемост и смену процессов, собрать и поставить бинарник. Для MVP сначала проверяем Electron loopback; не выдаём fallback за уже выполненную часть.

Экран: автоматически отбирать отдельные кадры при изменениях, хранить и посылать ограниченное количество, показывать возраст. Ручной кадр дополняет эту схему. OCR, DOM и непрерывный видеопоток LLM в первый вариант не входят.

## 4. Codex: интерфейс и совместимость

### Что проверено локально

- CLI отвечает версией 0.145.0.
- exec --help подтверждает JSONL, image, output-schema, read-only, ignore-user-config, ephemeral.
- exec resume --help имеет собственный набор флагов; sandbox/cwd нельзя механически приписывать после resume.
- app-server --help доступен, stdio — поддерживаемый транспорт. Команда и генератор схем помечены experimental.
- app-server generate-ts успешно создал схемы **0.145.0 во временном каталоге**, без запроса к модели.
- В этих схемах есть thread/start, turn/start, item/agentMessage/delta, turn/interrupt; вход localImage/image, outputSchema, ephemeral у thread/start. В turn/start текстовый вход требует text_elements.
- Схема readOnly содержит networkAccess, но сама по себе не задаёт allowlist чтения файлов.

Схемы — подтверждение формы интерфейса. Работа входа, изображений, дельт, прав доступа и модели на аккаунте ещё не испытана. Добавление audio в общий протокол не меняет выбранный отдельный STT pipeline.

### Почему не подключаем SDK 0.164.0 к глобальному CLI 0.145.0

При чтении опубликованного npm tarball SDK 0.164.0 обнаружено:

1. package.json требует точно @openai/codex 0.164.0. Встроенный resolver предполагает эту пару.
2. codexPathOverride может обойти resolver, но не доказывает совместимость со старым бинарником.
3. Реализация запускает exec с --experimental-json; её поведение нельзя приравнивать к проверенному нами --json старого CLI.
4. runStreamed возвращает события item/turn. В типах нет отдельного agent-message-delta события; текст внутри item.updated не является гарантией пословного вывода.
5. Публичные options не содержат прямых ignoreUserConfig/ephemeral переключателей.
6. index.d.ts импортирует ContentBlock из @modelcontextprotocol/sdk, который в этом tarball указан только в devDependencies. Это риск typecheck чистого потребителя; транзитивное наличие пакета не считается контрактом. Полная чистая установка/сборка не выполнялась.

В аудите tarball проверен по sha512 integrity из npm registry; lifecycle scripts не запускались. SDK остаётся допустимой альтернативой для конечных заданий, но сейчас не добавляется в основной runtime. Если вернёмся к нему, проверим чистую установку и согласованную пару SDK/CLI, не маскируя проблему через skipLibCheck.

### Выбранный контракт

Один отдельный app-server процесс, stdio, управляемые только приложением thread IDs. Одна live-thread на встречу; при проверках — дополнительная research-thread в том же процессе. Одна активная генерация на thread. Открытые чаты Codex не перечисляем и не выбираем через --last.

Вход — штатный Codex login в отдельном app-owned CODEX_HOME, без копирования токенов из приложения Codex. Это потребует одного обычного входа при подключении. Настройки, плагины, MCP и произвольные инструкции текущего чата не наследуем. Модель выбирается из доступных аккаунту с проверкой нужных modalities, не подменяется автоматически.

Внешние API получают свои штатные ключи/flows. ChatGPT subscription token не становится универсальным ключом Anthropic или OpenAI-compatible endpoint. Лимиты Codex общие для аккаунта; личная подписка не означает unlimited. [Authentication](https://learn.chatgpt.com/docs/auth).

Новый binary/version допускается после генерации схем и S2-проверки. Неизвестная версия должна давать понятный статус, а не продолжать с неподтверждённым протоколом.

### Ограничение безопасности, которое нельзя закрыть одним read-only

Prompt с просьбой «не читать секреты» и cwd на снимке не ограничивают чтение всего диска. Нужны изоляция конфигурации, минимальная среда дочернего процесса, выключенные ненужные инструменты и проверяемые ограничения чтения.

Документация описывает shell_tool и другие feature flags; современные permission profiles имеют ограничения и не должны смешиваться с legacy sandbox_mode. Их конкретная поддержка и Windows enforcement требуют отдельной проверки на выбранном CLI. Не копируем сегодняшние новые поля в схемы 0.145.0. Источники: [config basics](https://learn.chatgpt.com/docs/config-file/config-basic), [permissions](https://learn.chatgpt.com/docs/permissions).

S2 проверяет только безопасные canary-файлы. Пока нельзя доказать запрет произвольного локального чтения, агенту не открываем реальный repo и не включаем исследование с shell; используем переданный текст/кадры и проверенный минимальный набор инструментов. Если сам runtime нельзя ограничить, его живое включение блокируется до исправления изоляции.

## 5. Версии и политика фиксации

Registry latest — наблюдение на дату аудита, не готовый lockfile. Проект пока не имеет package.json.

| Компонент | Наблюдение | Начальное решение | Уровень проверки |
| --- | --- | --- | --- |
| Системный Node | 24.13.0 | Использовать для разработки | --version |
| npm | 11.6.2 | Один package-lock.json, npm ci после создания проекта | --version |
| Electron | latest 45.0.0; доступен 44.9.1 | **44.9.1 как baseline spike**, обновлять по поддерживаемым patch-релизам | Metadata, .d.ts и release feed; бинарник не запускался |
| Bundled Node Electron 44.9.1 | 24.22.0, Chromium 152.0.7977.167, modules ABI 149 | Проверять внутри самого Electron при S1/S5 | Официальный release feed, не runtime-проверка |
| React / react-dom | 19.3.1 / 19.3.1 | Совпадающая пара 19.3.1 | npm metadata, peer react-dom совпадает |
| Vite | 8.3.5 | 8.3.5 | Node requirement ^20.19.0 или >=22.12.0; локальный Node подходит |
| @vitejs/plugin-react | 6.1.2 | 6.1.2 | Peer Vite ^8.0.0; дополнительные compiler peers optional |
| TypeScript | latest 7.0.2, доступен 6.0.3 | **6.0.3 для первого spike** | Metadata; compiler/tooling миграцию TS7 пока не добавляем |
| Codex CLI | установлен 0.145.0; latest 0.164.0 | 0.145.0 для S2; отдельный 0.164.0 при необходимости | Help и генерация схем только для 0.145.0 |
| @openai/codex-sdk | 0.164.0 | Пока не включать в runtime | Tarball .d.ts/.js/package.json |
| SQLite binding | Не выбран | JSONL в первом варианте | ABI-зависимость не добавляем |

Electron 44.9.1 выбран как предыдущая patch-ветка, а не как доказанно более стабильная версия. Если к началу разработки ветка выйдет из поддержки или потребуется исправление безопасности/capture, baseline пересматривается с повтором профильных проверок. Выбор версии Electron не является исправлением локальных падений приложения Codex.

Официальный [Electron release feed](https://releases.electronjs.org/releases.json) отличает встроенный Node от системного. Поэтому работоспособность node:sqlite в системном node не доказывает доступность внутри utility process Electron. Node 24 документация помечает SQLite release candidate: [Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html). Если позже нужен SQLite, проверить import, FTS, журналирование и crash recovery именно в упакованном runtime; для внешнего native binding отдельно проверять Electron ABI.

В Electron 44.9.1 async safeStorage методы есть в .d.ts и version-specific документации. Использовать isAsyncEncryptionAvailable, encryptStringAsync, decryptStringAsync; decrypt возвращает объект с result. При недоступном OS encryption не сохранять ключ plaintext. Sync API deprecated с Electron 45 согласно текущей [документации safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

Упаковщик не закреплён до S5. Предпочтение — обычный Electron Forge и Windows x64 distributable; выбор его версии/плагинов следует проверять вместе с выбранным Vite. Сначала достаточно portable/unpacked запуска. Auto-update и сертификат подписи не входят в первый личный spike.

Размер также требует проверки: metadata платформенного пакета @openai/codex 0.164.0-win32-x64 сообщает **483 692 160 байт распакованного пакета**, не размер отдельного exe и не размер скачивания. Ранний S2 может использовать установленный runtime. Но по уточнённому требованию переносимости выпуск должен иметь управляемый приложением Codex runtime, а не зависеть от глобального CLI/fnm на машине разработчика. Для полной автономной установки runtime входит в installer; размер принимается как цена поставки, измеряется на S5. Вход в Codex остаётся штатным отдельным действием.

## 6. STT: независимое решение

| Кандидат | Причина проверить | Ограничение |
| --- | --- | --- |
| Встроенный Whisper / whisper.cpp | Основной кандидат: локальный движок и модель в поставке, CPU/GPU варианты | Измерить русский, live latency двух источников и переносимость |
| Soniox realtime | Облачная опция: WebSocket, partial/final, контекст терминов, diarization | Нужен отдельный аккаунт/ключ; качество ru и доступность не проверены |
| Yandex SpeechKit streaming | Русский язык, официальный streaming API | Свой auth/billing и transport; ключ ещё не предоставлен |
| GigaAM локально | Дополнительный кандидат для русского, если Whisper не устроит | Свой benchmark и поставка; сейчас не реализуется |

### Встроенный Whisper и переносимость

Whisper — локальная модель, whisper.cpp — нативный движок её исполнения. В Windows-поставку включаются собственный worker executable/DLL, необходимые runtime-зависимости, мультиязычная модель и license notices. Файлы worker, DLL и модели размещаются как обычные app resources вне app.asar, чтобы native process мог их открыть. Никаких абсолютных путей к Python, моделям или toolchain разработчика.

Планируемая полная версия installer содержит базовую модель сразу. Дополнительная более тяжёлая модель может управляться из UI; её загрузка не является обязательным условием первого распознавания. Конкретная базовая модель закрепляется только после S3: сравнить medium и large-v3-turbo, включая квантизованные варианты. В документации whisper.cpp large-v3-turbo занимает 1.5 GiB, large-v3-turbo-q5_0 — 547 MiB; это размеры весов, не итогового installer. [Модели](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md).

Для широкой совместимости нужен CPU backend; GPU ускорение проверяется на конкретном устройстве. Рассмотреть Vulkan для разных производителей, CUDA как вариант NVIDIA. Наличие backend не означает поддержку любой карты или одинаковую скорость. Не требовать от конечного пользователя compiler/CUDA Toolkit; необходимые поставляемые библиотеки комплектуются с приложением, системный GPU driver остаётся предпосылкой. При ошибке загрузки GPU backend приложение проверяет CPU fallback и показывает фактический режим. [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [ограничения ASAR](https://www.electronjs.org/docs/latest/tutorial/asar-archives).

На слабом CPU распознавание может отставать даже при успешном запуске. Нужны измеренные минимальные требования и более лёгкий профиль, а не обещание realtime на любом ПК. Два аудиоисточника сохраняются раздельно, но могут использовать одну загруженную модель в общем worker с ограниченной справедливой очередью. Отдельные копии большой модели на каждый источник по умолчанию не нужны.

Whisper обрабатывает аудиоокна; partial/stable text, VAD и устранение повторов реализует адаптер. GPU/модель проверяются на русской речи и одновременной работе обоих источников. Native worker добавляет один управляемый процесс; постоянный Python-сервис не нужен. Пример whisper-stream — исходная демонстрация подхода, не готовый production pipeline.

Автономность касается STT: аудио не требуется отправлять в облако, но текст и выбранные кадры идут к выбранному LLM. Codex требует сеть и вход. Ни движок, ни модели в рамках этого уточнения не скачивались и не устанавливались.

Soniox: пример текущей модели stt-rt-v5; конфигурация должна соответствовать реальному PCM sample rate/channels. Ключ передаётся при WebSocket-подключении через header/protocols, поле api_key в start deprecated, с 15 января 2027 только такого поля недостаточно. Адаптер нормализует токены провайдера в наши partial/final реплики; provider final token не всегда означает конец мысли. [WebSocket API](https://soniox.com/docs/api-reference/stt/websocket-api).

Рекомендованы два независимых mono-потока, чтобы сохранять известную роль mic/loopback. Резервировать две соединения/квоты и считать стоимость обоих потоков. Soniox оценивает realtime примерно в $0.12 за час потока, фактически тарификация token-based: ориентир двух часов потоков на час встречи — около $0.24, без гарантии итоговой суммы и доступности оплаты. [Soniox pricing](https://soniox.com/pricing).

SpeechKit на проверенной русской странице: 0.1626 ₽ за 15 секунд mono streaming с НДС, округление вверх. Час одного непрерывного mono-потока даёт 240 × 0.1626 = **39.024 ₽**, двух — **78.048 ₽**; reconnect и округление коротких фрагментов меняют сумму. Это расчёт тарифа, не оценка качества. [SpeechKit pricing](https://aistudio.yandex.ru/ru/docs/speechkit/pricing).

Пауза аудио/отсутствие речи не считается бесплатным состоянием по умолчанию: различать прекращение отправки PCM, keepalive и закрытие оплачиваемой streaming-сессии. Проверить контракт конкретного провайдера.

По предыдущим локальным проверкам: Ryzen 7 7800X3D, около 31 GiB RAM, RTX 2080 Ti 11 GiB. Это делает локальный benchmark разумным, но не доказывает realtime. Локальные STT и модели пока не установлены. Screenpipe в выбранный pipeline не включается.

## 7. Хранение и поставка

JSONL выбран, чтобы начать без native ABI и сохранять final transcript независимо от LLM. Один writer, append-only события, ограниченный период до flush, восстановление оборванного хвоста. Редактирование — новыми событиями, JSON snapshots и экспорт — производные. Это сознательная цена за простоту; SQLite станет полезен при поиске по большой истории и сложных транзакциях.

Сетевые клиенты и Codex не работают в main/renderer UI. Main управляет разрешениями и жизненным циклом, capture renderer — MediaStream/AudioWorklet, один utility process — STT/agent orchestration, отдельный writer worker — диск. Electron предоставляет [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process); IPC и UI ограничиваются по [security guide](https://www.electronjs.org/docs/latest/tutorial/security).

Новый backend, vector database, постоянный FFmpeg-процесс и Docker для начального сценария не требуются. Они добавляются только под конкретный провал проверки.

## 8. Что аудит завершил и что остаётся проверить

Выполнено: проверена пустая папка и отсутствие локальных AGENTS.md на пути проекта; повторно проверены версии Node/npm/CLI и Windows build; прочитана актуальная официальная документация, metadata пакетов, исходники SDK и несколько файлов NexQ; сгенерированы локальные типы app-server. dotnet/rustc/cargo через Get-Command не найдены. Секреты, auth cache и пользовательские конфиги не читались. Зависимости приложения не ставились.

Не выполнено: Electron capture, реальная генерация Codex, auth/login, STT, проверка чтения canary через модель, packaging, тесты UI, обе ВКС. Генератор схем завершился успешно; один объединённый shell-запуск вернул ненулевой код из-за отсутствующих optional toolchain-команд, это не ошибка генератора.

Критические неизвестные и последовательность проверки вынесены в [план валидации](VALIDATION_PLAN.md). До их прохождения нельзя обещать готовый realtime-помощник или гарантированную оценку сроков.
