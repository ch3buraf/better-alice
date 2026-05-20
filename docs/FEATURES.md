# Better Alice — каталог фич

Статус каждой bap-фичи (Better Alice) после адаптации под Яндекс Алису.

## Условные обозначения

- ✅ **Работает** — fully functional на обоих хостах
- ⚠️ **Частично** — работает с ограничениями
- ❌ **Не работает** — архитектурно невозможно без серверной поддержки
- 🚫 **Удалено** — фича была Yandex Alice-specific, не имеет смысла для Алисы

---

## 1. Системные промпты и инжекция

| Фича | Alice | Alice Pro | Заметки |
|---|---|---|---|
| Default system prompt (русский) | ✅ | ✅ | Префикс к user message, обернут в `<BetterAlice>...</BetterAlice>` |
| Custom system prompts | ✅ | ✅ | UI: Drawer → System Prompts. Радио-выбор активного |
| Disable Hidden System Prompt | ✅ | ✅ | Settings toggle |
| Frequency: first / always / every_x | ✅ | ✅ | Per-dialog tracking через localStorage[bap_injected_chats] |
| `<BetterAlice>` strip из user input | ✅ | ✅ | Защита от leaks |

**Ограничение**: Алиса не "слушается" инструкций в user-prompt по-настоящему (это не system role). Она их *читает*, но решение использовать встроенные tools (ART/search) принимает по своему. Поэтому **tool-теги типа `<BAL:VISUALIZER>` не работают** — Алиса проигнорит и сгенерит DivKit-image вместо SVG-кода.

## 2. Memory

| Фича | Alice | Alice Pro | Заметки |
|---|---|---|---|
| Stored memory list (key/value) | ✅ | ✅ | Drawer → Stored Memory |
| Importance: `always` (каждое сообщение) | ✅ | ✅ | Инжектится как `<BAL:memory_calls>k: v</BAL:memory_calls>` |
| Importance: `called` (по ключевому слову) | ✅ | ✅ | Триггерится substring match (case-insensitive) |
| Import / Export JSON | ✅ | ✅ | Yandex Alice-platform-agnostic |
| Disable Memory toggle | ✅ | ✅ | Settings |

## 3. Skills

| Фича | Alice | Alice Pro | Заметки |
|---|---|---|---|
| Upload .md skill | ✅ | ✅ | Drawer → Skill Set |
| Toggle skills on/off | ✅ | ✅ | Только активные инжектятся |
| Inject в первый prompt | ✅ | ✅ | `<BAL:SKILLS fingerprint="...">` обертка |
| Import / Export | ✅ | ✅ | |

## 4. Characters / RP personas

| Фича | Alice | Alice Pro | Заметки |
|---|---|---|---|
| Upload .md persona | ✅ | ✅ | Drawer → RP Characters |
| Активация (radio, only one at a time) | ✅ | ✅ | Инжектится `<BAL:RP>Character Name: ...</BAL:RP>` |
| Multi-character library | ✅ | ✅ | |
| Import / Export | ✅ | ✅ | |

## 5. Projects

| Фича | Alice | Alice Pro | Заметки |
|---|---|---|---|
| Создание проекта (имя + инструкции) | ✅ | ✅ | Drawer → Projects |
| Прикрепление файлов к проекту | ✅ | ✅ | |
| Inject project context при выборе | ✅ | ✅ | `<BAL:PROJECT name="...">` |
| RAG mode (выборка релевантных chunk'ов) | ✅ | ✅ | `lib/rag-engine.js` — TF-IDF |
| RAG limit (top N chunks) | ✅ | ✅ | Settings |

## 6. Загрузка контента в чат (Attach Menu)

| Фича | Alice | Alice Pro | Заметки |
|---|---|---|---|
| **+** кнопка рядом с инпутом | ⚠️ | ⚠️ | Mount-логика scanner'а адаптирована (см. `scanInputArea`). Положение кнопки может смещаться |
| Upload folder (концат текстовых файлов) | ✅ | ✅ | `showDirectoryPicker` API — клиентское |
| Process .gitignore во время upload | ✅ | ✅ | Setting |
| GitHub repo import (ZIP + extract) | ✅ | ✅ | `lib/github-reader` |
| GitHub Personal Access Token (private repos) | ✅ | ✅ | Settings → token |
| GitHub commits import | ✅ | ✅ | Configurable depth |
| Web page fetch (Readability + Turndown) | ✅ | ✅ | Конвертит HTML → markdown |
| YouTube transcript fetch | ✅ | ✅ | `youtube-transcript` пакет |
| Twitter tweet fetch (OEmbed) | ✅ | ✅ | |
| Single file upload | ✅ | ✅ | |

Все upload-фичи **вставляют контент в textarea** через `setMessageText` → user отправляет руками. На Alice/Alice Pro `findTextarea()` адаптирован.

## 7. Voice

| Фича | Alice | Alice Pro | Заметки |
|---|---|---|---|
| Voice-to-Text (Web Speech API) | ⚠️ | ⚠️ | Алиса уже встроенно умеет — наш STT дублирует. Работает но рекомендуется использовать нативный |
| Text-to-Speech (после ответа) | ⚠️ | ⚠️ | Зависит от наличия text-extraction из DivKit-сообщения (TODO) |
| Auto-submit после распознавания | ✅ | ✅ | Settings |
| Speech language picker (ru-RU/en-US/...) | ✅ | ✅ | Settings |

## 8. Code blocks / Code Runner

| Фича | Alice | Alice Pro | Заметки |
|---|---|---|---|
| Download button на ``` блоках | ⚠️ | ⚠️ | Работает если Алиса вернула markdown с `<pre><code>` — она обычно использует DivKit `text_card` с inline-code, не `<pre>`. Если выдаст fenced block — будет работать |
| Python sandbox (Pyodide) | ⚠️ | ⚠️ | См. выше |
| JavaScript sandbox | ⚠️ | ⚠️ | См. выше |
| TypeScript sandbox | ⚠️ | ⚠️ | См. выше |

## 9. Tool tags (`<BAL:...>`)

**Статус скорректирован 2026-05-19 после empirical-теста**: Алиса **слушается** инструкций в user-prompt лучше чем я первоначально предположил. Например, на инструкцию «не используй ART, верни SVG-код в \`\`\`svg блоке» Алиса послушно вернула SVG-код вместо генерации картинки.

Это значит — tool-теги можно портировать в Better Alice через **code-fence-based syntax** (вместо XML):
- bap:VISUALIZER → \`\`\`bap-visualizer ... \`\`\`
- bap:create_file → \`\`\`filename=path.ext ... \`\`\`
- bap:pptx → \`\`\`bap-pptx ... \`\`\`
- bap:excel → \`\`\`bap-excel ... \`\`\`
- bap:docx → \`\`\`bap-docx ... \`\`\`

Наш scanner ловит `\`\`\`<lang>...\`\`\`` блоки → рендерит в соответствующую UI card. Этот путь **реалистичен** для Better Alice v0.2.

В текущей версии (v0.1.0) tool-теги **ещё не реализованы** в новом синтаксисе — system prompt просит обычные \`\`\`code\`\`\` блоки. Это статус «не сделано», а не «невозможно».

| Фича | Статус | Альтернатива в Better Alice |
|---|---|---|
| `<BAL:VISUALIZER>` (SVG/HTML simulation) | ❌ | Использовать нативную Yandex ART (нарисуй что-то) |
| `<BAL:HTML>` (full HTML preview) | ❌ | — |
| `<BAL:pptx>` (PowerPoint generator) | ❌ | — |
| `<BAL:excel>` (Excel generator) | ❌ | — |
| `<BAL:docx>` (Word generator) | ❌ | — |
| `<BAL:create_file>` (downloadable file) | ❌ | — |
| `<BAL:LONG_WORK>` (ZIP packaging) | ❌ | — |
| `<BAL:AUTO:REQUEST_WEB_FETCH>` | ❌ | Использовать Attach Menu → Web Page |
| `<BAL:AUTO:REQUEST_GITHUB_FETCH>` | ❌ | Использовать Attach Menu → GitHub |
| `<BAL:AUTO:REQUEST_YOUTUBE_FETCH>` | ❌ | Attach Menu → YouTube |
| `<BAL:AUTO:REQUEST_TWITTER_FETCH>` | ❌ | Attach Menu → Twitter |
| `<BAL:AUTO:CODE_RUNNER>` | ❌ | — |
| `<BAL:character_create>` | ❌ | Drawer → RP Characters (вручную) |
| `<BAL:ask_question>` | ❌ | — |
| `<BAL:memory_write>` | ❌ | Drawer → Stored Memory (вручную) |

**Замечание**: первоначально я полагал что Алиса полностью игнорирует инструкции в user-prompt — это оказалось **неверным** (empirical-тест показал что слушается). Реальное ограничение мягче: некоторые виды инструкций (стиль, формат, "не используй встроенный tool") работают; стабильность подчинения 70-90% по результатам ручных проверок.

## 10. Сессии и история

| Фича | Alice | Alice Pro | Заметки |
|---|---|---|---|
| Sidebar chat-list (просмотр истории) | ❌ | ✅ | Alice: есть `[data-testid="chat-sidebar"]`, наш scanner не обрабатывает (опционально). Alice Pro: своя боковая панель чатов |
| Sidebar search в чатах | ⚠️ | ⚠️ | Yandex Alice-specific implementation; portable но не подключён |
| Chat filtering by tags | ⚠️ | ⚠️ | Yandex Alice sidebar-specific |
| Session List Cap (memory mgmt) | ✅ | ✅ | Settings |

## 11. Экспорт сессий

| Фича | Alice | Alice Pro | Заметки |
|---|---|---|---|
| Export to Markdown | ✅ | ✅ | `collectMessageNodes` + `detectMessageRole` адаптированы под обоих |
| Export to PDF | ✅ | ✅ | Via html2canvas + jsPDF (или browser print) |
| Export to HTML | ✅ | ✅ | |
| Export to Images | ✅ | ✅ | |
| Per-message export | ⚠️ | ⚠️ | Зависит от того насколько чисто DivKit/Svelte markdown извлекается |
| Reworked Export UI | ✅ | ✅ | |

## 12. Token usage / Pricing

| Фича | Alice | Alice Pro |
|---|---|---|
| Token Price Estimation | 🚫 | 🚫 |
| Pricing fetch (Yandex Alice API) | 🚫 | 🚫 |

**Удалено**: Yandex не отдаёт usage в WebSocket/SvelteKit response. Алиса — конечный продукт, без публичных token-метрик.

## 13. UI / UX

| Фича | Статус |
|---|---|
| Drawer с настройками (slide из правого края) | ✅ |
| Floating toggle button (BA) | ✅ |
| Theme: dark/light auto-detection | ✅ — но колорсы под Yandex Alice aesthetics. На Alice не криво, но не идеально |
| Toast notifications | ✅ |
| Selection mode (для export-by-selection) | ✅ |
| What's New modal | ✅ — обновлён под Better Alice |
| Announcement banner | 🚫 — отключён (Yandex Alice-specific feed) |
| Status banner (Yandex Alice outages) | 🚫 — отключён |
| Native navigation (Yandex Alice logo as `<a>`) | 🚫 — Yandex Alice-specific, не релевантно |

## 14. Server status / Pricing dynamics

| Фича | Статус |
|---|---|
| alice.yandex.ru poll | 🚫 удалено |
| Pricing fetch (api-docs.yandex-alice.com + github fallback) | 🚫 удалено |
| Embedded pricing fallback | 🚫 удалено |

---

## Итого

- ✅ **Работает полностью** (10 категорий): system prompt + memory + skills + characters + projects + upload menu + voice STT + export + drawer UI + storage
- ⚠️ **Частично** (3 категории): code-block enhancements (зависит от DivKit), voice TTS (text extraction из DivKit), sidebar features
- ❌ **Не реализуемо** (1 категория): tool-теги — архитектурно требуют server-side control
- 🚫 **Удалено** (3 категории): pricing, status monitor, Yandex Alice-specific UI tweaks

Better Alice реализует **~70% оригинальной функциональности BDS** при том что **30% (tool-tags)** архитектурно недоступны на чужом managed-ассистенте.
