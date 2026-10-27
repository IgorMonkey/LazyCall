# Галерея скриншотов LazyCall

[English](SCREENSHOTS.md)

[Правила компоновки](UI_GUIDELINES.ru.md): общая сетка панелей, прокрутка диалогов и источники рекомендаций, использованные при оформлении интерфейса.

Вымышленный разговор о поиске заявок. Язык совпадает с этой страницей; у каждого кадра есть светлая и тёмная пара. Реальных встреч, репозиториев, аккаунтов или ответов провайдера здесь нет.

## Выбранный синтетический пример на русском

Пять кадров показывают один вымышленный разговор о поиске заявок. При смене темы просмотра они автоматически выбирают парный светлый или тёмный вариант.

### Основной разговор

<picture><source media="(prefers-color-scheme: dark)" srcset="screenshots/readme-main-ru-dark.png?v=6f1831540073"><img src="screenshots/readme-main-ru-light.png?v=b0efe5f005b6" alt="Синтетическая русская расшифровка и ответ о проверке прав" width="960"></picture>

### Контекст проекта

<picture><source media="(prefers-color-scheme: dark)" srcset="screenshots/readme-context-ru-dark.png?v=6d755c9282ca"><img src="screenshots/readme-context-ru-light.png?v=08b69e3b1b6d" alt="Синтетические русские папка проекта и обзор репозитория" width="960"></picture>

### Итоги встречи

<picture><source media="(prefers-color-scheme: dark)" srcset="screenshots/readme-results-ru-dark.png?v=c4eadb21d77e"><img src="screenshots/readme-results-ru-light.png?v=f91ec80b8210" alt="Синтетические русские решение, задача и открытый вопрос" width="960"></picture>

### Компактное окно

<picture><source media="(prefers-color-scheme: dark)" srcset="screenshots/readme-compact-ru-dark.png?v=e5f3a2b4d605"><img src="screenshots/readme-compact-ru-light.png?v=095e91a13a62" alt="Синтетическая русская подсказка в компактном окне" width="404"></picture>

### Онбординг

<picture><source media="(prefers-color-scheme: dark)" srcset="screenshots/readme-onboarding-ru-dark.png?v=2a43a47c389f"><img src="screenshots/readme-onboarding-ru-light.png?v=da31527b950f" alt="Русский онбординг, третий шаг" width="560"></picture>

<details>
<summary>Покрытие фикстурами и пересборка</summary>

Полная локальная галерея пересобирается командой `node scripts/build-screenshot-gallery.cjs` в `release/maintainer-review/full-gallery/index.html`; рядом лежит машиночитаемый `index.json`. Используются только локальные Playwright-фикстуры.

- Основной сценарий: ожидание, запись, пауза, сохранённая встреча, правка расшифровки, следование за последней репликой, адаптивная шапка и меню «Ещё».
- Помощник: пустое/неподключённое состояние, чтение проекта в потоке, ответ, повторяемая ошибка, найденный/отсутствующий Codex и состояния обновления.
- Материалы, проекты, история встреч, итоги, все вкладки настроек, русский и английский, светлая и тёмная темы, все шаги онбординга и состояния компактного окна.
</details>
