# Техническое описание

## Подключённый репозиторий (0.3.1)

Папка выбирается нативным диалогом и сохраняется в ProjectKnowledgeStore: отдельно для проекта и для режима без проекта. Подключение не создаёт список копий и не требует выбора 16 файлов. CodexProvider передаёт в каждый связанный запрос три dynamic tools: repo_list, repo_search и repo_read. Рабочий каталог процесса и CODEX_HOME остаются собственными каталогами CallMe; инструменты привязаны к выбранному корню в хосте.

RepositoryReader выполняет только файловое чтение без shell: проверяет относительные пути, canonical containment, компоненты пути, links/junctions и идентичность открытого файла. Выдача и время поиска ограничены; изменения файлов читаются при следующем запросе. Чтение отменяется вместе с turn. Dynamic tool call принимается только для текущего thread/turn и разрешённого имени; чужие вызовы, approvals и команды отвергаются. Поддержка dynamicTools проверена настоящим bundled app-server 0.145.0 в отдельном пустом профиле, а чтение, свежесть и изоляция — нативным Electron fixture с синтетической моделью.

Предварительный обзор не считается текущим состоянием кода: ответы должны проверять факты инструментами. При смене/отключении папки обзор очищается. Дополнительные документы по-прежнему используют ограниченные копии; старые IPC импорта сохранены для совместимости, но основной UI их не предлагает. Протокол: [OpenAI Docs](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental).

Дата: 25 октября 2026. Статус: проектирование перед реализацией. Принятые инженерные решения, контракты и начальные численные настройки ниже ещё не являются результатами runtime-тестов.

## 1. Компоненты и процессы

~~~mermaid
flowchart TD
  Main["Electron main: permissions, lifecycle, secrets, IPC"]
  UI["UI renderer: разговор, подсказки, журнал"]
  Capture["Capture renderer: mic, window, AudioWorklet, sampler"]
  Service["Utility process: STT, utterances, scheduler, context"]
  Whisper["Whisper worker: app-owned модель, CPU/GPU"]
  Provider["CodexProvider adapter"]
  Codex["Codex app-server: live thread и research thread"]
  Writer["JournalWriter: worker thread"]
  Log["events.jsonl"]
  Main --> UI
  Main --> Capture
  Main --> Service
  Main --> Writer
  Capture -->|"bounded PCM и кадры"| Service
  Service -->|"два раздельных аудиоисточника"| Whisper
  Whisper -->|"partial и final"| Service
  Service -->|"final и результаты"| Main
  Main -->|"сохранённые события"| UI
  Service --> Provider
  Provider -->|"stdio"| Codex
  Writer --> Log
~~~

Это логические компоненты внутри обычного Electron process model, включая его служебные Chromium-процессы. Отдельный localhost HTTP/WebSocket server между нашими компонентами не нужен.

| Компонент | Владеет | Ограничения |
| --- | --- | --- |
| Main | Выбор окна/устройств, session lifecycle, keys, child supervision | Не распознаёт звук и не ждёт LLM синхронно |
| UI renderer | Разговор, карточки, редактирование, preview/status | sandbox=true, contextIsolation=true, nodeIntegration=false |
| Capture renderer | MediaStream, AudioWorklet, sampler, RAM ring | Только локальный код; без ключей и произвольного доступа к FS/сети |
| Service utility | STT adapter/worker supervision, normalizer, scheduler, provider adapters | Неблокирующий I/O; ошибки адаптеров ловятся на границе |
| Whisper native worker | Загруженная модель, CPU/GPU inference, VAD/window decoding | App-owned процесс; ограниченные очереди двух раздельных источников |
| JournalWriter worker | Упорядоченные durable события и projections | Единственный writer; не ждёт модель |
| Codex child | Отдельные model threads | Только штатный auth и проверенная политика инструментов |

Отдельный capture renderer сохраняет звук при тяжёлом обновлении/перезагрузке UI. Цена — ещё один Chromium renderer; S1/S5 проверяют память и background capture. Начать можно без скрытого tray/autostart, но capture не привязывать к жизненному циклу React-компонента.

В main зарегистрировать только именованные методы preload. Не экспортировать ipcRenderer, shell, fs или универсальный invoke(channel, args). На обеих сторонах проверять форму, размер сообщения и допустимость действия в текущем состоянии. Разрешения выдаются своему capture origin/frame и выбранному source; перед использованием проверяется, что frame/source ещё существуют.

Внешние ссылки открываются через проверенный OS browser маршрут с разрешёнными схемами, raw HTML из модели не выполняется. Renderer загружает локальную сборку, CSP ограничивает источники. Вывод модели и Markdown проходят санитизацию.

## 2. Состояние встречи

~~~text
idle → preparing → capturing → stopping → finalizing → completed
          |            |          |             |
          └→ failed    └→ degraded └→ incomplete └→ export-available
~~~ 

degraded — набор признаков, а не потеря состояния capturing: stt_offline, agent_unavailable, mic_missing, screen_stale, disk_backpressure. UI показывает конкретную причину и начало интервала.

Start имеет session id и идемпотентен; повторное нажатие не создаёт вторые streams. После Start нельзя сменить проект внутри той же встречи. Смена устройства или окна создаёт source epoch и событие discontinuity.

Порядок Stop:

1. Зафиксировать cutoff monotonic time, остановить поступление новых кадров и сэмплов, закрыть media tracks.
2. Доставить уже принятый ограниченный audio tail, отправить STT end/finalize по контракту провайдера.
3. Дождаться final либо flush timeout; записать незавершённый интервал как incomplete/gap. Не превращать partial в достоверный final автоматически.
4. Дождаться writer acknowledgement, записать capture.stopped.
5. Отменить устаревшие live-задания, собрать итоговый context и запустить summary/backlog.
6. Записать validated result или summary.failed. Экспорт transcript доступен независимо от этого результата.

Initial flush timeout — 5 секунд с возможностью продолжить ожидание; это настройка для S3, а не гарантия провайдера. Кнопка «Остановить захват» не ждёт summary.

Выход приложения останавливает только принадлежащие ему streams и child processes. Не применять массовое завершение codex/node/electron по имени: приложение Codex и чужие сессии должны остаться доступны.

## 3. Звук, время и STT

Два независимых sourceId: mic/self и loopback/remote. Каждый имеет epoch, фактическую sample rate, число каналов, счётчик сэмплов и sequence number. AudioWorklet передаёт короткие PCM чанки через ограниченный канал; React state не получает каждый аудиочанк.

Начальные настройки для проверки:

- PCM mono signed 16-bit little-endian; целевая частота 16 kHz только если она поддержана выбранной моделью STT. На входе фиксировать реальную частоту, обычно она иная.
- Stateful resampling с low-pass фильтрацией; не брать каждый третий сэмпл и не сбрасывать фазу между чанками.
- Чанки около 100 ms; настройка определяется требованиями провайдера.
- Transport backlog максимум 5 секунд на источник. После disconnect не накапливать всю встречу. Отдельное ограниченное окно анализа Whisper описано ниже; оно не считается тем же буфером.
- Два STT connections в облачном варианте. VAD может помогать сегментации, но отключение тишины должно учитывать keepalive/endpointing и timestamps провайдера.

Предел raw audio памяти рассчитывать по фактическому формату, а не только по числу чанков. При переполнении фиксировать capture.gap с диапазоном времени и причиной. Старый звук не отправляется с ложным текущим timestamp. Повторять только ограниченный неподтверждённый хвост, если контракт STT допускает replay; иначе начинать новый epoch с явным gap.

### Часы

UTC используется для даты/экспорта, monotonic session milliseconds — для порядка и синхронизации. Main задаёт session anchor; capture устанавливает соответствие performance/audio clock с anchor. При старте и смене устройства сохраняются mapping и estimated uncertainty.

Таймкод аудио строится по sample count и source epoch. Время получения STT final — отдельное поле: сетевую задержку нельзя выдавать за момент произнесения. Frame хранит captureMonoMs, не только время доставки агенту. Windows clock adjustment не переставляет реплики.

Две звуковые карты могут иметь drift. S1 измеряет его на длинном интервале; при накоплении ошибки нормализовать временное отображение, сохраняя исходные значения. Реплики с overlap не сортируются по порядку final-пакетов.

### Нормализация STT

Адаптер хранит provider offsets и нормализует partial revisions/final words. Над ним UtteranceAssembler собирает реплики по endpoint/пунктуации/паузе и разделяет text-final от utterance-closed. У Soniox final token не равен готовой реплике целиком.

Stable utteranceId + revision сохраняют связь исправлений. Дедупликация после reconnect опирается на provider segment IDs/offsets и интервалы, а не на совпадение слов «да, да». Speaker ID scoped к connection epoch; сам по себе не связывает личности между встречами.

Final сначала отправляется в writer. После durable ack запись отмечается сохранённой и допускается в очередь LLM; partial показывается временно. Потеря агента не останавливает этот путь.

### Встроенный Whisper

Основной локальный адаптер управляет поставляемым whisper.cpp worker. Worker получает PCM с sourceId/epoch/timestamps по ограниченному локальному IPC и возвращает наши partial/final события. Не запускать отдельный executable на каждый 100-ms chunk и не перезагружать модель на каждую фразу. Один загруженный model context обслуживает два источника с раздельными окнами/декодирующим состоянием; точный способ переиспользования контекста проверяется на thread safety и справедливость очереди.

Начальная гипотеза для S3: analysis window 6–12 секунд на источник, небольшой overlap и VAD, обновление промежуточного текста с частотой, которую выдерживает выбранное железо. Верхняя граница окна и backlog задаёт общий RAM budget; исходное аудио не архивируется. Повторное декодирование перекрытия не создаёт дубли реплик. Стабильный префикс и окончание реплики определяет адаптер по проверенному алгоритму, а не выдаёт каждое окно за независимый final.

Полная Windows x64 поставка включает worker/DLL, нужные redistributable dependencies, базовую мультиязычную модель и license notices. Native ресурсы лежат вне app.asar; путь строится от resourcesPath/manifest поставки. Модель проверяется по версии/hash. Дополнительные веса можно установить из UI с атомарной загрузкой и проверкой целостности; базовый офлайн-режим не требует этой загрузки.

Backend selection: проверить доступность и короткий запуск GPU backend, затем при ошибке CPU. Рассмотреть Vulkan для разных производителей и CUDA для NVIDIA; не обещать универсальную GPU-совместимость. UI показывает фактический backend, модель, отставание и доступный более лёгкий профиль. CPU fallback гарантирует только предусмотренный путь исполнения на поддерживаемом CPU, а не достаточную скорость для любого компьютера.

End-user не ставит Python, Whisper, build tools или CUDA Toolkit вручную. Приложение комплектует необходимые runtime-библиотеки; OS/GPU driver и минимальные характеристики остаются системными требованиями. Тесты на другом ПК/без NVIDIA обязательны. Soniox/Yandex остаются отдельными опциональными адаптерами со своими credentials.

## 4. Экран

Один выбранный source, один video track. Видео декодируется для отдельных снимков, MediaRecorder/долгий video archive не запускается.

Начальная гипотеза sampler: до 2 проверок кадра в секунду; уменьшенная grayscale-копия для change score, debounce около 300 ms, не более одного автоматического опорного кадра за 2 секунды. Для LLM — обычно 1–2 свежих релевантных изображения на turn; JPEG/WebP с ограниченным размером, ориентир long edge 1600 px. Все значения уточняет S1/S4 по читаемости мелкого UI.

Мигающий курсор и видео лица не должны расходовать весь budget: порог изменения и область интереса настраиваются по реальному окну. Ручной кадр и кадр на момент вопроса имеют приоритет. Периодический status heartbeat отличает неизменный экран от остановившегося sampler.

Frame event включает source epoch, время, размеры, hash, причину выбора и возраст при использовании. Нельзя автоматически привязывать к новой реплике давно потерянное окно. При отсутствии пригодного кадра context передаёт screenUnavailable/stale.

Raw sampling frames остаются в ограниченной RAM-очереди (до 3 кандидатов). На диск сохраняются только кадры, реально отправленные агенту, закреплённые пользователем или использованные как основание заметки. Это отдельные изображения, не видеоархив. Retention виден пользователю до Start.

Если Codex требует localImage, материализовать только выбранный кадр в app-owned session directory; путь не берётся из речи/ответа модели. Lifetime временного файла должен покрывать чтение turn. После turn удалить ненужную временную копию; закреплённый evidence-frame остаётся по политике встречи.

## 5. Контракты провайдеров

Ниже эскиз доменных типов, а не сгенерированный Codex protocol и не готовая реализация.

~~~typescript
type Support = "yes" | "no" | "unknown";
type EvidenceRef =
  | { kind: "utterance"; id: string; revision: number }
  | { kind: "frame"; id: string }
  | { kind: "document"; id: string; sha256: string; locator: string }
  | { kind: "web"; url: string; checkedAtUtc: string };

interface AgentCapabilities {
  images: Support;
  textDeltas: Support;
  structuredOutput: Support;
  cancel: Support;
  research: Support;
  tools: "none" | "hosted" | "application" | "mixed" | "unknown";
}

interface AgentProvider {
  id: string;
  connect(config: ProviderConnection): Promise<AgentConnection>;
}
interface AgentConnection {
  capabilities(model: string): Promise<AgentCapabilities>;
  createSession(input: SessionContext): Promise<AgentSession>;
  dispose(): Promise<void>;
}
interface AgentSession {
  run(request: AgentRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
  close(): Promise<void>;
}
type AgentEvent =
  | { type: "started"; requestId: string }
  | { type: "text.delta"; requestId: string; itemId: string; delta: string }
  | { type: "tool.status"; requestId: string; label: string }
  | { type: "completed"; requestId: string; text: string; structured?: unknown }
  | { type: "failed"; requestId: string; code: string; retryable: boolean };

interface SttProvider {
  id: string;
  connect(input: SttConnectOptions): Promise<SttStream>;
}
interface SttStream {
  send(chunk: AudioChunk): Promise<void>;
  events: AsyncIterable<SttEvent>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}
~~~ 

ProviderConnection, AgentRequest, SessionContext, AudioChunk и SttEvent определяются нашими версиями схем. В connection renderer передаёт credential reference, не plaintext key. Только соответствующий privileged adapter разрешает ссылку в секрет.

STT capabilities отдельно описывают partial/final, timestamps, formats/rates, languages, diarization и limits. Их не смешиваем с AgentCapabilities. Capability — пересечение provider runtime, выбранной модели, auth и разрешённой политики; unknown не считается yes.

Отсутствующая capability отражается в UI и заданиях. Например, без images помощник использует transcript и пишет, что экран не проверен; без research не обещает сверку. Нельзя молча подменять unsupported structured output обычным JSON и считать его гарантированно валидным.

ProviderConnection — discriminated union: Codex (managed executable + app-owned auth home), OpenAI-compatible (base URL + key reference), Anthropic (свой API key reference). Реализуется только Codex. Подписочные CLI-адаптеры других поставщиков потребуют отдельного подтверждённого контракта.

При смене LLM во время встречи создавать новую provider session, передавать проверенный компактный state и новые данные из журнала. Provider thread IDs, скрытая история и auth не переносятся. Журнал встречи остаётся общим.

## 6. Codex adapter

Запускать конкретный native executable через spawn с массивом argv, shell=false и windowsHide=true. Для выпуска поставлять/управлять собственным Codex runtime, закреплённым вместе со схемами. Установленный runtime разрешён для раннего S2; системный codex в PowerShell может быть .ps1 shim, а его путь не равен native exe. Не зависеть от временного fnm_multishells пути или глобального Node/CLI на другом компьютере. Полная поставка включает native runtime; обновления выполняются отдельно от пользовательских глобальных установок и проходят compatibility checks.

App-owned CODEX_HOME создаётся вне репозитория, с собственной конфигурацией и обычным login. Не открывать auth.json программно и не копировать чужой cache. Среда дочернего процесса — allowlist необходимых системных переменных и app paths; ключи STT и посторонние TOKEN/SECRET env туда не передавать. Полный env для диагностики не печатать.

Протокол по stdio:

1. initialize с clientInfo и capabilities по схеме выбранной версии, затем initialized.
2. thread/start для новой встречи: отдельный cwd на sanitized snapshot, проверенная политика, developer instructions, ephemeral=true, когда поддержано и проверено.
3. turn/start: текст + локальные изображения, request mapping; outputSchema для структурного результата.
4. item/agentMessage/delta → нормализованный text.delta; item.completed сверяет итоговый текст; turn/completed завершает запрос.
5. turn/interrupt отменяет устаревший turn; дождаться terminal notification с тем же threadId/turnId.

JSON-RPC parser должен обрабатывать несколько строк в chunk и строку, разрезанную между chunks; stdout — только protocol, stderr — ограниченная диагностика без сырого содержимого встречи. Ограничить line/message size. Неизвестные уведомления не должны ронять capture, но несовместимая критическая схема должна отключать adapter.

У каждого запроса локальный requestId, context revision и mapping provider thread/turn/item IDs. Ошибка/exit помечает незавершённый запрос; повторный запуск не выдаёт старый fragment за завершённый ответ. Ephemeral-сессию после crash восстанавливаем из своего журнала новым thread, а не обещаем resume потерянной RAM-истории.

ephemeral уменьшает локальные rollout-файлы, но не является обещанием отсутствия данных у облачного провайдера или в системных буферах. Настройки логов runtime проверяются на fixture во время S2.

## 7. Очереди, latency и контекст

Запись transcript — независимый приоритет. Очередь LLM хранит ссылки на durable события, а не весь дублированный разговор.

| Класс | Триггер | Выполнение |
| --- | --- | --- |
| Быстрый ручной ответ | «Помоги ответить» | Высший приоритет, live-thread |
| Автоподсказка | Вероятный вопрос/пауза | Coalesce по последнему вопросу, live-thread |
| Извлечение записей | Накопились final-реплики | После коротких ответов, объединять интервалы |
| Проверка источников | Кнопка/план проверки | Отдельная research-thread, максимум один запрос |
| Итог | Stop + flush | После cutoff, из полного durable диапазона |

Одновременно один turn на thread; research не блокирует live-thread. Общий лимит — до двух генераций; при throttling приостанавливать research. Не запускать новый turn после каждого partial или каждого кадра.

Начальные bounds: одна pending ручная/auto-подсказка на актуальный вопрос; остальные заменяются ссылкой на более свежую ревизию. Историю не теряем — она остаётся в JSONL. Один накопленный extraction range. Одна очередь проверки. Максимум 20 последних реплик/около 32 KiB нового текста на live turn плюс ограниченный snapshot и 1–2 кадра; эти размеры уточняются по реальному token usage.

Непрочитанные старые диапазоны не исчезают при coalesce: extraction/summary догоняет их отдельно. Ограничение контекста не должно отбрасывать отрицание, условие решения или реплику с договорённостью только ради числа строк.

ContextBuilder передаёт: цель встречи, проверенное описание проекта, curated agreements, последние реплики с IDs/times, релевантные source excerpts, текущие кадры с возрастом и уже подтверждённые пользователем записи. Полный transcript повторно не отправляется на каждое слово. Для длинной встречи поддерживается compact state; он производный и восстанавливаемый.

Preliminary answer — короткая формулировка без долгого research. Verified supplement — отдельная карточка/редакция с источниками. У обоих общий questionId. Новая тема/редакция не допускает позднего ответа поверх актуального.

Цель S4: полезная первая формулировка p50 ≤5 s, p95 ≤10 s после готового вопроса. Это целевой критерий, а не обещанная latency Codex. Начальный soft timeout — 8 s со статусом ожидания; hard timeout быстрого turn — 25 s с отменой. Поздний research можно показать отдельно, если вопрос ещё актуален.

## 8. Контекст и инструменты

RepoContextService работает с явно выбранным проектом и allowlist файлов. Он строит sanitized snapshot с manifest: исходный относительный путь, hash, версия/commit при наличии и время чтения. Symlink/junction не должен выводить за разрешённый корень. Ограничить размеры файлов/результатов.

Секреты, credentials, .env, wallets, auth caches и реальные ключи не входят в контекст. Позитивный allowlist и предварительно подготовленные материалы важнее эвристического поиска слова token. Ошибка санитизации не считается решённой одним regex.

Начальная retrieval — ограниченный текстовый поиск/выдержки по снимку, без vector DB. PDF/изображения документов потребуют отдельного ingestion шага; не считать произвольный бинарный файл уже читаемым контекстом.

Runtime не получает право на произвольный shell или исходный репозиторий от реплики участника. Документы, screen text и web content не могут менять инструменты, auth, output destinations или system policy. Разрешённые действия определяет приложение.

Live-thread использует минимальный проверенный набор инструментов. Research-thread получает только проверенные способы поиска по snapshot и внешним источникам. Точная поверхность инструментов зависит от S2; если текущий Codex не позволяет её безопасно ограничить, research не включается до решения. Обычный read-only не защищает секреты от чтения.

Неподдержанный tool request возвращает отказ/ошибку, а не перенаправляется в универсальный shell. Выходные пути экспорта выбирает пользователь через UI; модель не задаёт произвольный файловый путь.

## 9. События и durable storage

Источник истины — events.jsonl одной встречи. Пример envelope и события (синтетические данные):

~~~json
{
  "schemaVersion": 1,
  "eventId": "evt-example-42",
  "sessionId": "meeting-example",
  "seq": 42,
  "recordedAtUtc": "2026-10-25T09:00:12.450Z",
  "occurredMonoMs": 12100,
  "type": "transcript.final",
  "payload": {
    "utteranceId": "utt-7",
    "revision": 1,
    "sourceId": "loopback",
    "sourceEpoch": 1,
    "speakerLabel": "remote",
    "startMs": 10300,
    "endMs": 12100,
    "text": "Давайте добавим поиск по номеру заявки.",
    "providerReceivedMonoMs": 12430
  }
}
~~~ 

seq назначает единственный writer, время возникновения не обязано возрастать вместе с seq: delayed final может относиться к более раннему аудио. eventId обеспечивает идемпотентность повтора. IDs в реальном приложении — UUID, примеры выше условные.

| Событие | Существенные поля | Durable |
| --- | --- | --- |
| session.started/stopping/completed | Project/context refs, mode live/replay, cutoff | Да |
| capture.source.changed | sourceId, epoch, description | Да |
| capture.gap / health.changed | Time range, reason, source | Да |
| transcript.partial | utteranceId, revision, replace text | Нет, временное |
| transcript.final/corrected | Interval, source, text, revision | Да |
| frame.selected | Frame id/hash, time, source, asset ref | Да |
| agent.requested | Request/question IDs, context refs/revision | Да, без ключей |
| agent.delta | Request/item ID, delta | Нет, временное |
| agent.completed/failed | Final text/result, status, sources | Да |
| note.proposed/edited/confirmed/rejected | Note id/revision, actor, evidence | Да |
| export.completed | Destination ref, version/hash | Да |

Append через один file handle, полная JSON-строка + newline. Перед durable ack вызывать datasync/fsync; допустимо объединять небольшой batch с верхней границей 1 s. UI различает «получено» и «сохранено». Ack означает выполненный flush по API ОС, не абсолютную гарантию при любой аппаратной потере питания.

При startup читать валидные строки по порядку, проверять schemaVersion/seq/eventId. Оборванный последний record сохраняется отдельно как повреждённый хвост, восстанавливается валидный префикс. Corruption в середине не игнорировать молча: копия исходника, явный recovery report, никакой записи поверх единственной копии.

Проекции transcript/journal/state строятся replay. Snapshot: temp file → flush → замена; Windows sharing/AV errors обрабатываются ограниченным retry, исходник журнала остаётся. До нового append после восстановления определить последний seq и уже существующие event IDs.

Ошибка диска: короткий bounded retry и индикация, затем остановка capture, если writer нельзя восстановить в рамках буфера. Не разрешать много минут «живого» разговора с несохранённым журналом.

Планируемая структура данных вне репозитория:

~~~text
%LOCALAPPDATA%\CallMe\
  settings.json
  credentials.enc
  codex-home\                 # штатное хранилище Codex; не читать вручную
  projects\<project-id>\
    manifest.json
    context-snapshots\<id>\
  sessions\<session-id>\
    events.jsonl
    state.json                # производный snapshot
    frames\<frame-id>.jpg      # выбранные evidence frames
    exports\
~~~ 

Конкретный Electron userData path задать до ready и проверить при упаковке. Репозиторий содержит код/документы/синтетические fixtures, не реальные встречи.

## 10. Записи, решения и summary

~~~typescript
interface JournalNote {
  id: string;
  revision: number;
  kind: "flow" | "problem" | "proposal" | "decision" | "task" | "question";
  text: string;
  state: "draft" | "confirmed" | "rejected";
  agreement: "not-applicable" | "proposed" | "explicit-in-transcript" | "user-confirmed";
  evidence: EvidenceRef[];
  basis: "source-supported" | "inference" | "insufficient";
  owner: string | null;
  dueAt: string | null;
  acceptanceCriteria: Array<{ text: string; origin: "proposed" | "agreed" }>;
  editedBy: "model" | "user";
}
~~~ 

LLM возвращает предложения изменений, не пишет журнал напрямую. Validator проверяет JSON/schema, типы, существование evidence IDs и допустимость transition. У decision должны быть ссылки на реплики с явным согласием либо user-confirmed; structural validation само по себе не доказывает смысл согласия, поэтому такой вывод виден для проверки человеком.

Нельзя принимать несуществующие source refs, произвольные пути или новые owner/deadline без основания. Невалидный результат хранится как ошибка/черновик без публикации в подтверждённый журнал. Частичный streamed JSON не становится готовой задачей.

Human edit создаёт новую revision и защищает её от автоматической перезаписи. Следующее предложение модели ссылается на base revision; конфликт показывает отдельное предложение. Поздняя коррекция transcript помечает зависимые записи для повторной проверки, не уничтожая ручную правку.

Summary строится из всего завершённого диапазона, состояния журнала и ручных подтверждений. Сначала локальный экспорт Markdown + JSON/JSONL и evidence frames. Задачи и предлагаемые критерии остаются черновиками. Без отдельной команды нет внешней отправки и тикетов.

## 11. Secrets, retention и диагностика

API keys шифруются OS-backed async safeStorage только в main; renderer получает masked status/reference. В service ключ передаётся только нужному адаптеру и не попадает в Codex env, лог, URL или transcript. Если шифрование недоступно — session-only key либо отключение подключения, без plaintext fallback.

Это не полное шифрование встречи. Transcript и опорные кадры первого варианта локально доступны текущему OS-пользователю; до Start это должно быть видно. Секреты и содержание встреч не добавлять в Git. Отдельное шифрование архива и управляемый retention — самостоятельная функция, не обещание safeStorage.

По умолчанию raw mic/loopback audio и видео не архивируются. RAM ring исчезает при crash; системный swap/cloud policies этим утверждением не контролируются. Сохраняются final transcript, ручные правки, ответы, записи и выбранные кадры. Пользователь может удалить встречу и её app-owned assets отдельным явным действием.

Метрики без содержимого: capture gaps, queue depth/age, RMS/clipping, reconnect, final latency, frame freshness, first-text/useful-answer latency, provider errors, token usage при наличии. Не логировать сырые audio/image payloads, auth headers, полный env или рассуждения модели.

Replay имеет постоянную плашку и mode в events. Результат replay не маркируется как живое распознавание или прошедшая проверка провайдера.
