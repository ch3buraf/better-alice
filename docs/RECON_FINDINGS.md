# Recon findings — практическое руководство по Алисе и Алисе Про

Это сводка того, что удалось выяснить через CDP-разведку (`recon/*.mjs`) и live-эксперименты в браузере. Полезно для любого следующего проекта по интеграции с Yandex Alice / AlicePro.

## 1. Транспорты

### `alice.yandex.ru` (regular Alice) — WebSocket
- Сообщения уходят как `Vins TextInput` payload через `WebSocket.prototype.send`.
- Перехват: monkey-patch `WebSocket.prototype.send` в MAIN world (не в content world — иначе React-bundle уже отправил оригинал).
- Структура payload:
  ```js
  {
    namespace: "Vins",
    name: "TextInput",
    payload: { request: { event: { text: "сообщение пользователя" } } }
  }
  ```
- Мутировать поле `text` → переподписать payload через `JSON.stringify` → `origSend.call(this, data)`.
- **Критично**: в ES-модуле `arguments` НЕ алиасит локальные параметры. Использовать `.call(this, data)` вместо `.apply(this, arguments)`.

### `alicepro.yandex.ru` (Alice Pro) — SvelteKit form-action POST
- Транспорт: `POST /expert/api?/messageSend` с `Content-Type: application/x-www-form-urlencoded`.
- **Native form POST не идёт через `window.fetch`** — патч fetch'а бессилен. Поэтому мутация payload'а на лету невозможна стандартными способами.
- AlicePro модель **отказывается** следовать system-prompt инжекции в тело сообщения: pattern-match'ит `<BetterAlice>` блоки и сваливается на дефолтный «Я для Яндекс 360…».
- **Решение**: source-file workflow. Положить системный промпт в Источники проекта AlicePro — модель читает его как авторитетный контекст.

## 2. Code-block detection (где Алиса рендерит наши `bap-*` fences)

| Хост | Маркер языка |
|---|---|
| Alice | `<code class="hljs language-bap-pptx">` — наш язык остаётся в `class` |
| AlicePro | `<pre data-language="bap-pptx">` — отдельный data-атрибут, без `language-…` класса |

**Подвох AlicePro:** highlight.js на бэке делает auto-detect. Когда `bap-docx` не распознан как известный язык, hljs ставит **похожий**:
- `bap-docx` → `data-language="json"` (JSON-подобный контент)
- `bap-zip` → `"nix"` или `"prolog"`
- `bap-run-python` → `"fortran"` или `"dust"`
- `bap-memory` → `"prolog"`
- `bap-character` → `"prolog"`

Решение: content-based sniff. Открываем JSON, смотрим на структурные ключи:
- `paragraphs[]` → docx
- `slides[]` → pptx
- `sheets[]` или `rows[]` → excel
- `files[]` с `path/content` → zip
- `{key, value, importance}` (или массив таких) → memory
- `{name, usage, content}` → character
- LaTeX-паттерны (`\begin{...}`, `\frac`, `\sum`) → latex
- HTML/SVG в первой строке → visualizer
- Python keywords (`import`, `def`, `print(`) в начале → run-python

См. `sniffOfficeFromJsonContent` в `src/content/files/code-blocks.js`.

## 3. AlicePro теряет fence-маркер

Иногда (особенно для `filename=…`) AlicePro полностью **удаляет** open-fence-маркер из markdown'а. Кодоблок приходит без `data-language` и без первой строки `filename=…`.

**Fallback**: попросить модель в system-промпте **дублировать имя файла как комментарий в первой строке тела**:
```
// filename: fact.js   (JS/TS/C/Go/Java)
# filename: fact.py    (Python/Ruby/Shell)
-- filename: query.sql (SQL)
```
Extension sniff'ит эти комменты и восстанавливает имя.

## 4. Стрим-aware re-attach

AlicePro отдаёт сообщение пакетами. Когда extension впервые сканит `<pre>`, JSON может быть ещё неполным → handler выбирает не тот action (например `attachGenericDownload` вместо `attachOfficeRunButton`).

**Решение**: сохранять длину контента в `pre.dataset.bapCodeSeenLen`. Если при повторном scan'е контент сильно вырос (>40 chars), удалить старую кнопку и пересобрать handler.

## 5. Skills / память / RP-персонаж на AlicePro

Префикс-инжекция `<BetterAlice><BAL:SKILLS>…</BAL:SKILLS></BetterAlice>` **не работает** (AlicePro pattern-match'ит и игнорирует).

**Решение**: бандлить всё в source-файл вместе с системным промптом:
- `## АКТИВНЫЕ НАВЫКИ` — все .md skills (только `active !== false`)
- `## АКТИВНЫЙ ПЕРСОНАЖ (RP)` — выбранный character
- `## ПАМЯТЬ О ПОЛЬЗОВАТЕЛЕ (всегда учитывай)` — facts с `importance: always`

Юзер один раз перезагружает source-файл когда меняет skills.

## 6. Тестирование через CDP

### Setup
```bash
# Запуск Chrome с открытым DevTools-портом и dedicated profile
chrome --remote-debugging-port=9222 --user-data-dir=C:\chrome-claude-profile
```

Сначала зайди в Алису/AlicePro руками и авторизуйся — куки сохранятся в профиле.

### Attach к Chrome
```js
const v = await fetch("http://127.0.0.1:9222/json/version").then(r => r.json());
const ws = new WebSocket(v.webSocketDebuggerUrl);
```

### Открыть новый таб
```js
await call("Target.createTarget", { url: "https://alice.yandex.ru/", background: false });
```

### Отправить сообщение
- **Alice**: установить значение textarea через `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, text)` (React-friendly setter), dispatch `input` event, найти submit button.
- **AlicePro**: `form#message-form` + `form.requestSubmit(submitBtn)`.

### Ждать ответ
- Поллить `document.body.textContent.length` пока не вырастет на >80 chars и не стабилизируется (3-5 проверок без изменений).
- Для Pyodide-кейсов: `extraWait: 25000` (загрузка Pyodide).

### Проверять DOM
- Селекторы наших wrapper'ов: `.bap-visualizer-wrapper`, `.bap-latex-wrapper`, `.bap-question-panel`, `.bap-memory-chip`, `.bap-character-chip`, `.bap-auto-run-container`.

### Reload-retry
Если первая проверка дала FAIL, делать `Page.reload({ignoreCache: true})`, ждать 9 sec для re-загрузки чата (AlicePro грузит историю асинхронно), повторно проверить DOM. Закрывает ~20% flaky случаев.

См. `recon/qa-alice.mjs`, `recon/qa-alicepro-project.mjs`.

## 7. Создать чат в проекте AlicePro

Прямой URL `/expert/projects/<id>/chats/<chat-id>` иногда открывает чат с огромной историей → старые pre-блоки обрабатываются медленно. Для чистого теста:

1. Открыть `/expert/projects/<id>` (project landing).
2. Кликнуть segmented-toggle "Чаты" (или `button[class*="segmented-toggle"]` где `textContent` содержит "Чаты").
3. Кликнуть `form.new-chat-form button` — создаёт свежий чат с активным source-файлом.

## 8. Виртуализация чата на AlicePro

Старые сообщения **unmount-ятся** при скролле. Это значит:
- MutationObserver триггерится не только на добавление новых сообщений, но и на повторное mount при scroll back.
- Сохранять обработанность через `dataset` атрибуты на `<pre>` (выживает unmount-remount).
- Не использовать WeakSet — он не переживает re-mount если ссылка теряется.

## 9. Theme / dark mode

Алиса ставит theme class на `<body>` (например `"en_US dark"` или `"en_US light"`), не на `<html>`.

Наблюдать через MutationObserver на `<body>` class, синхронизировать с extension UI.

## 10. Pyodide в sandbox iframe

Yandex CSP запрещает inline-eval. Но если поместить Pyodide-загрузчик в **extension sandbox iframe** (`sandbox.html`), он работает — extension manifest позволяет sandbox-страницам своё CSP.

Установка: `<script src="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js">` грузится с jsdelivr ОК, потому что extension sandbox имеет более либеральный CSP чем content world.

Bridge через `postMessage` между sandbox iframe и content script.

## 11. Что не сработало

- ❌ Service worker fetch interceptor для AlicePro — Yandex использует native form POST, который **не идёт через ServiceWorker** на этой странице.
- ❌ MutationObserver для перехвата formdata перед отправкой — Svelte form-action работает через свой internal pipeline, мы видим только response.
- ❌ Прямая подмена `chrome.declarativeNetRequest` rules — на чтении куки/auth state ломается.
- ❌ Инжекция в payload через `XMLHttpRequest.prototype.send` patch — на AlicePro form-action не использует XHR.

## 12. Полезные DOM-селекторы (cheat sheet)

| Что | Селектор |
|---|---|
| Любое сообщение (оба хоста) | `[data-testid="message-bubble-container"]` |
| Сообщение пользователя | `[data-testid="message-bubble-container-from-user"]` |
| Textarea ввода | `textarea#message-textarea`, `[data-testid="inputbase-textarea"]`, `textarea.AliceInput-Textarea` |
| Submit button | `form#message-form button[type="submit"]`, `button.submit` |
| Code-block (AlicePro) | `pre[data-language]` |
| Code-block (regular Alice) | `pre code[class*="language-"]` |
| AlicePro Drawer "Источники" | `[class*="sources"]` или secondary nav |
| Project landing | `https://alicepro.yandex.ru/expert/projects/<id>` |
| Project "Чаты" toggle | `button[class*="segmented-toggle"]` content "Чаты" |
| "Создать чат" в проекте | `form.new-chat-form button` |
