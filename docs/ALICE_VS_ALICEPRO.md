# Alice vs Alice Pro — техническое руководство

Дата: 2026-05-20 (final update)
Источник: реальные тесты Better Alice extension + v22 system prompt с инструкциями про fence markers + stripFenceMarker helper.

## Самое главное (TL;DR для будущих агентов)

1. **AlicePro игнорирует system-prompt-инжекцию в сообщения** — переключение модели в safe mode. Решение: **source-файл в проекте** (Drawer → «Скачать system_prompt.txt» → загрузить в Источники проекта).
2. **AlicePro hljs auto-detect ломает fence-метки** — `bap-docx` становится `data-language="json"`, `bap-zip` → `nix`, `bap-run-python` → `fortran` и т.п. Решение: content-based sniff (`paragraphs[]` → docx, `files[]` → zip, Python keywords → run-python и т.д.).
3. **AlicePro иногда оставляет fence-маркер первой строкой textContent** (если hljs не распознал lang). Решение: `stripFenceMarker` helper в `code-blocks.js` — skip blank lines + strip marker line.
4. **AlicePro иногда теряет `filename=` маркер целиком** — handler не знает имя файла. Решение: system prompt v22 просит Alice **дублировать filename как комментарий**: `// filename: name.ext`. Sniff подхватывает.
5. **Live Drawer settings**: `$effect` с 300ms debounce — никакой кнопки Save, изменения летят сразу через `pushConfigToPage()`.
6. **Kill switch** `disableAllInjection`: полностью выключает всю инжекцию для дебага «голой Алисы».
7. **Skills / память / RP-персонаж для AlicePro доезжают через тот же source-файл**: «Скачать system_prompt.txt» теперь дозаписывает в файл секции `## АКТИВНЫЕ НАВЫКИ`, `## АКТИВНЫЙ ПЕРСОНАЖ (RP)` и `## ПАМЯТЬ О ПОЛЬЗОВАТЕЛЕ (всегда учитывай)` с importance:always. Юзер перезаливает файл в Источники проекта когда добавил/изменил skill — на Alice (regular) skills продолжают инжектиться в реальном времени через `<BAL:SKILLS>` префикс.


Это руководство для будущих проектов, которые хотят инжектировать context
в Алису или Алису Про. Оба хоста выглядят как «один продукт от Яндекса»,
но внутри это **две принципиально разные системы**, которые требуют разных
архитектурных подходов.

## TL;DR

| Аспект | `alice.yandex.ru` (Alice) | `alicepro.yandex.ru` (Alice Pro) |
|---|---|---|
| Frontend | React + Vins WebSocket | SvelteKit + form-action POST |
| Транспорт сообщений | WebSocket `Vins/TextInput` | `POST /expert/api?/messageSend` form-encoded |
| Куда инжектить системный промпт | **В тело user-сообщения** (WS payload mutation) | **НЕЛЬЗЯ в сообщение** — модель отказывается следовать. **Только** через источник в проекте |
| Реакция на `<BetterAlice>` блоки в сообщении | Игнорирует разметку, но читает контекст | Pattern-match'ит preamble и сваливается на «Я работаю с Яндекс 360...» |
| Code-block lang detection | `class="hljs language-X"` | `<pre data-language="X">` (без `language-X` класса) |
| Подсветка `bap-*` lang | Не подсвечивает, но `language-bap-X` класс ставит | НЕ ставит ни класс, ни data-language если lang неизвестен |
| Источники (file uploads как контекст) | Нет такого механизма | **Да** — проект имеет «Источники» с приоритетом авторитетного контекста |
| Виртуализация чата | Нет, все сообщения в DOM | Да — старые сообщения unmount-ятся при скролле |

## Алиса (alice.yandex.ru) — WS-инжекция

### Транспорт

User отправляет сообщение → клиентский JS пакует `Vins TextInput` payload
в WebSocket frame. Мы перехватываем `WebSocket.prototype.send`, находим
`payload.request.event.text`, инжектируем префикс через `buildPrefixedText`
и пересылаем.

```js
// src/injected/alice-ws-patch.js (упрощённо)
const origSend = WebSocket.prototype.send;
WebSocket.prototype.send = function (data) {
  try {
    const obj = JSON.parse(data);
    if (obj.namespace === "Vins" && obj.name === "TextInput") {
      const original = obj.payload.request.event.text;
      const { text } = buildPrefixedText(original, state, conversationId);
      obj.payload.request.event.text = text;
      data = JSON.stringify(obj);
    }
  } catch (_) {}
  return origSend.call(this, data);  // NB: .call, не .apply(arguments)
};
```

**Критическая ловушка**: в ES-модуле `arguments` НЕ алиасит локальные параметры. Используй `.call(this, data)`, **не** `.apply(this, arguments)`.

### Что инжектируется

Префикс перед user-сообщением:
- `<BetterAlice>{system prompt}</BetterAlice>` — системный промпт
- `<BetterAlice><BAL:SKILLS>...</BAL:SKILLS></BetterAlice>` — активные навыки
- `<BetterAlice><BAL:RP>...</BAL:RP></BetterAlice>` — активный персонаж
- `<BetterAlice><BAL:PROJECT>...</BAL:PROJECT></BetterAlice>` — активный проект (с RAG если включён)
- `<BetterAlice><BAL:memory_calls>...</BAL:memory_calls></BetterAlice>` — релевантная память

Алиса **читает** этот контекст. Она не строго следует ему (это user-message, не system), но он влияет на стиль, язык, формат ответа. Возможно перебить дефолтный «я работаю с Яндекс 360» через persistent context.

### Frequency

- `first` — инжект только в первое сообщение разговора
- `always` — **в каждое** (default, надёжнее всего)
- `every_x` — каждые N сообщений

Алиса забывает контекст быстро (3-5 сообщений), поэтому `always`. Цена — больше токенов, но это редко проблема для standalone-сессий.

### Code-block detection

- `<pre><code class="hljs language-bap-pptx">...</code></pre>` — `detectLanguage` находит `language-bap-pptx`
- Если Алиса не подсветила (неизвестный hljs lang): кладёт fence-имя как **первую строку textContent**: `bap-pptx\n{...}`. Мы детектим и strip-аем первую строку.

### DOM-селекторы

| Что | Селектор |
|---|---|
| Сообщение (любое) | `[data-testid="message-bubble-container"]` |
| Сообщение пользователя | `[data-testid="message-bubble-container-from-user"]` |
| Textarea ввода | `textarea#message-textarea` или `[data-testid="inputbase-textarea"]` |
| Sidebar чатов | `[data-testid="chat-sidebar"]` |
| Code-block | `pre > code.hljs language-X` |

## Алиса Про (alicepro.yandex.ru) — Source-file workflow

### Транспорт

User отправляет → SvelteKit `<form action="?/messageSend">` POST. Body может быть:
- URL-encoded string: `projectId=...&chatId=...&text=...`
- FormData (через `use:enhance` hook)
- **ИЛИ** native browser form POST (полностью обходит `window.fetch`!)

Мы пробовали:
1. **Override `window.fetch`** — пропускает native form POST.
2. **Capture-phase `submit` listener** + мутация `textarea.value` — работает технически, но **модель отказывается следовать инжекции в теле сообщения**. Alice Pro pattern-match'ит preamble и сваливается на дефолтные ответы про Яндекс 360.

### Почему не работает inline-инжекция

Alice Pro имеет server-side preprocessing который классифицирует входящее сообщение. Если в начале есть что-то похожее на:
- XML теги (`<BetterAlice>`, `<system>`, `<context>`)
- Markdown headers «СИСТЕМНЫЕ ИНСТРУКЦИИ» / «КОНТЕКСТ»
- Любой preamble длиннее ~500 байт перед реальным запросом

— модель уходит в safe mode: «Я Алиса Про для Яндекс 360. Я могу помочь с...». Подтверждено в QA: при инжекции в текст Alice Pro даже не пытается отвечать на запрос.

### Правильный путь — «Источники» в проекте

Alice Pro имеет понятие **проектов** с прикрепляемыми источниками (PDF, TXT, DOCX и т.п.). Когда юзер пишет в чат проекта, ответ строится по схеме:

```
[Источники проекта] + [System prompt Алисы] + [История чата] + [User message] → Ответ
```

Если положить наш системный промпт как `.txt` файл в источники проекта:
- Alice читает его как **авторитетный контекст** (источник, а не сообщение)
- Pattern-matcher не срабатывает (это не preamble, а separately-passed context)
- Промпт сохраняется на все чаты в проекте

### Implementation в Better Alice

`src/injected/alicepro-fetch-patch.js` — **no-op**. Не мутируем сообщения.

`src/content/ui/SettingsPanel.svelte` — секция «🚀 Алиса Про — setup через проект»:
- Кнопка **«Скачать system_prompt.txt»** — генерит файл с актуальным prompt'ом (default или custom) + cheatsheet форматов
- Кнопка **«Открыть Создать проект»** — открывает `/expert` для ручного создания проекта
- Инструкция шагами в самой панели

User flow:
1. Открой Drawer → Advanced → секция Alice Pro
2. Нажми «Скачать system_prompt.txt»
3. В Alice Pro: «Создать проект» → Загрузи файл в Источники
4. Используй чаты в этом проекте — Alice будет знать все `bap-*` форматы

### Code-block detection в Alice Pro

```html
<pre data-language="bap-docx" class="svelte-1w9vok">
  <code class="hljs">{...JSON...}</code>
</pre>
```

- Язык в **`data-language` атрибуте**, не в class
- `code` имеет только `class="hljs"` без `language-X`
- Для bap-* hljs не знает → AlicePro кладёт `data-language="bap-docx"` (или иногда «json», «fortran» — auto-detect промахивается)

`detectLanguage()` сначала читает `pre.getAttribute("data-language")`, потом fallback на класс.

### DOM-селекторы Alice Pro

| Что | Селектор |
|---|---|
| Textarea | `textarea#message-textarea` |
| Form | `form#message-form` |
| Кнопка submit | `form.querySelector('button[type=submit]')` |
| Создать проект | `.sidebar-item.new-project-item` |
| Создать чат (в проекте) | `.button-container button` (внутри `.welcome-container`) |
| Sidebar чат | `.sidebar-item` |
| Code-block | `pre[data-language] > code.hljs` |
| Иконка отправки | `button.submit` |

### Виртуализация

Alice Pro в долгих чатах **виртуализирует** старые сообщения (unmount из DOM при скролле). Расширение должно:
- Запускать `enhanceCodeBlockDownloads()` через `MutationObserver` на каждое появление `<pre>`
- Не полагаться на «прошёлся один раз — всё обработал»

### Source-файл template

`src/content/ui/SettingsPanel.svelte` генерит файл такого вида:

```
# Better Alice — системный промпт для Алисы Про
# Положи этот файл в Источники проекта Алисы Про.

## СИСТЕМНЫЙ ПРОМПТ
<active prompt>

## ТЕХНИЧЕСКАЯ СПРАВКА (форматы кодовых блоков)
<TOOL_FENCE_CHEATSHEET>
```

`TOOL_FENCE_CHEATSHEET` — компактный список всех `bap-*` форматов с JSON-схемами. Живёт в `src/lib/constants.js`.

## Master kill switch

`disableAllInjection` (по умолчанию `false`) — полностью отключает инжекцию в **обоих** хостах. Полезно для:
- Дебага «выключи всё и проверь чистую Алису»
- Юзера который хочет минимум вмешательства расширения

Реализация в `src/injected/prefix-builder.js`:

```js
if (state.config?.disableAllInjection) {
  return { text: cleanText, changed: cleanText !== userText };
}
```

UI: Drawer → Advanced → toggle «🚫 Отключить ВСЮ инжекцию». Применяется на лету через live-settings (см. ниже).

## Live settings

`src/content/ui/SettingsPanel.svelte` использует Svelte 5 `$effect` для авто-сохранения **по 300мс debounce** на любое изменение toggle/input. Не нужно нажимать «Save». pushConfigToPage() вызывается сразу, injected-сторона видит новые флаги в следующем сообщении.

```js
$effect(() => {
  [autoFiles, voiceMode, disableSystemPrompt, disableAllInjection, ...];
  scheduleLiveSave();  // debounced 300ms
});
```

## Поведенческие различия Alice vs Alice Pro

| Запрос | Alice | Alice Pro (без проекта) | Alice Pro (в проекте с source) |
|---|---|---|---|
| «Что ты умеешь?» | Базовые функции Алисы | «Я для Яндекс 360...» | Перечислит наши `bap-*` форматы |
| «Сделай PowerPoint про осень в формате `bap-pptx`» | Возвращает `bap-pptx` fence | Возвращает `bap-pptx` fence (т.к. в каждом prompt explicit), скачивание работает | Та же |
| «Создай персонажа в `bap-character`» | Возвращает JSON, наш handler upsert'ит | Возвращает JSON | Та же |
| «$$E=mc^2$$» (LaTeX inline) | Не рендерит сама → наш `bap-latex` нужен | **Сама рендерит** через свой MathJax | Та же + наш fence для долгих формул |
| Накопленная память юзера | Из storage через prefix-injection | Не видит (инжекция выкл) | Видит из source-файла (если включить в template) |

## Чек-лист для будущих проектов «как сделать расширение для Алисы»

### Если фича — text injection в сообщения:
- ✅ Алиса (regular): через WS-patch.
- ❌ Алиса Про: **не работает**. Используй source-файлы.

### Если фича — UI overlay на ответах ассистента:
- Обе работают: парсим `<pre>` блоки + `data-language`/`class` lang detection.
- В Alice Pro **обязательно** учитывай виртуализацию (MutationObserver).

### Если фича — chat sidebar enhancement (поиск, теги, экспорт):
- Селекторы разные:
  - Alice: `[data-testid="chat-sidebar"]`
  - Alice Pro: `.sidebar-item`
- Логика та же.

### Если фича — voice / file upload / web fetch:
- Работают независимо от инжекции.
- AttachMenu используется одинаково на обоих хостах.

### Если фича требует постоянной памяти / контекста:
- На Alice Pro **проект + source-файл** — единственный надёжный путь.
- Дай юзеру возможность одной кнопкой скачать и положить файл.

## История архитектуры

| Версия | Подход | Результат |
|---|---|---|
| v0.1 | WS-patch для Alice, **fetch override** для Alice Pro (URL-encoded body) | Alice работала, Alice Pro молчала |
| v0.2 | Добавил FormData support, capture-phase submit listener для native form POST | Технически инжекция доходит, но **Alice Pro pattern-match'ит preamble и отказывается работать** |
| v0.3 (current) | Alice Pro adapter — **no-op**. Vместо инжекции — Download source-file kнопка в UI | Alice Pro работает корректно когда source-файл загружен в проект |

## Источники

- DOM-структуры зафиксированы пользователем в реальной сессии 2026-05-20:
  - Alice Pro project view: `<button class="...new-project-item">Создать проект</button>`
  - Alice Pro «Создать чат» внутри проекта: `<div class="button-container">...</div>`
- Поведенческие тесты: `recon/qa-alice.mjs` и `recon/qa-alicepro-project.mjs`
- Архитектурные решения: `recon/screenshots/qa-pro/*.png` (12 фичей в AlicePro проекте)
