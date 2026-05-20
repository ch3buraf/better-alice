# Алиса и Алиса Про — внутреннее устройство

Документ собран во время реверс-инжиниринга 2026-05-19 на базе chrome CDP recon (см. `alisa/recon/`).

## TL;DR

| | **Алиса Про** (`alicepro.yandex.ru`) | **Алиса** (`alice.yandex.ru`) |
|---|---|---|
| Tech stack | SvelteKit (Svelte 5) | React (`alice-for-web`, BEM-классы) |
| Транспорт сообщения | HTTP form POST | WebSocket |
| Протокол | `application/x-www-form-urlencoded` | Yandex Alice/SpeechKit protocol (directive/event) |
| Стрим ответа | SvelteKit `__data.json` polling-GETs | WebSocket frames (server→client directives) |
| Scope | Узкий — Яндекс 360 (Почта/Диск). Отказывается от кода, SVG, общих задач | Универсальный — пишет код, SVG, отвечает на любые вопросы |
| DOM-якорь input'а | `textarea#message-textarea` внутри `form#message-form.boltalka` | `textarea.AliceInput-Textarea` (нет form, есть data-testid `inputbase-textarea`) |
| Кнопка submit | `form#message-form button.submit` | `[data-testid="oknyx"]` (анимированный «омикс» Алисы, в режиме arrow когда есть текст) |
| Auth | Yandex passport cookies | Yandex passport cookies |
| Версия (на момент recon) | (не зафиксировано) | `alice-for-web v1.92.2 2026-05-14` |

---

## Алиса Про — детальный протокол

### Send endpoint

```
POST https://alicepro.yandex.ru/expert/api?/messageSend
Content-Type: application/x-www-form-urlencoded
```

Body (form-encoded):
```
projectId={uuid32}
chatId={uuid32}
doAnalysis=false
doReasoning=false
useWordAgent=false
doComplexQuestions=false
neuro=false
type=input
source=main
text={URL-encoded message text}
availableServices=7
servicesOverrides=7
```

Ответ:
```json
{"type":"redirect","status":302,"location":"https://alicepro.yandex.ru/expert/projects/{projectId}/chats/{chatId}?/messageSend="}
```

Это **SvelteKit form action** (отсюда `?/messageSend` — это SvelteKit-синтаксис именованной server action). Из-за такого подхода фронт обрабатывает редирект и идёт за обновлённым состоянием:

### Response stream — polling-style

После `messageSend` фронтенд каждые ~300-500ms делает:

```
GET https://alicepro.yandex.ru/expert/projects/{projectId}/chats/{chatId}/__data.json?%2FmessageSend=&x-sveltekit-invalidated=110
```

В recon-сессии за ~5 секунд было **12 таких GET'ов** — фронт опрашивает сервер пока ответ Алисы не достроится. В body каждого — полная SvelteKit `__data.json` структура с актуальным списком сообщений (включая частично сгенерированный ответ Алисы).

Это **не SSE и не streaming response** — это обычный polling. Каждый GET возвращает целиком текущее состояние, фронт diff'ает.

### WebSocket — НЕ для чата

`wss://mc.yandex.com/solid.ws` — это **Yandex Metrika** (трекинг событий: focus/blur/scroll/mouse). К чату отношения не имеет. Heartbeat: `{"resource":"ping","timestamp":...}` каждые ~5 сек.

### DOM

- Чат-инпут: `textarea#message-textarea`, placeholder «Спросите Алису Про»
- Форма: `form#message-form.boltalka.svelte-1qitp4r`
- Submit кнопка: `form#message-form button.submit.svelte-1qitp4r`
- Тулбар: `.message-input-toolbar`
- Сообщения юзера: TODO (не зафиксировано в recon)
- Сообщения Алисы: TODO

### Точки инъекции (для расширения)

**Лучшая точка — monkey-patch `fetch`:**
```js
const _fetch = window.fetch;
window.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('/expert/api') && init?.body && init.method === 'POST') {
    // Body — это уже urlencoded string. Парсим, переделываем text, переподписываем.
    const params = new URLSearchParams(init.body);
    const original = params.get('text') || '';
    params.set('text', injectPrefix() + '\n\n' + original);
    init.body = params.toString();
  }
  return _fetch.call(this, input, init);
};
```

**⚠️ Caveat:** SvelteKit делает `const _fetch = window.fetch` на этапе модуля. Если хук поставлен после загрузки страницы — он не сработает. Решение: ставить хук через `manifest.json content_scripts run_at: document_start` ИЛИ injected script через `<script>`-инжект в `<head>` до первого fetch.

**Парсинг ответа — hook на тот же `fetch` для GET'ов `__data.json`:**
- Body — JSON в SvelteKit формате (data nodes), нужен парсер для извлечения текста ассистента
- Стрим — увидеть постепенно растущий текст можно сравнивая последовательные responses или dedupe'ом

### Scope: Алиса Про функционально равна обычной Алисе

При первом тесте префикс-инструкция + запрос «нарисуй SVG-схему атома» Алиса Про сначала ответила:

> «С этой задачей я лучше справлюсь на alice.yandex.ru»

…но на повтор того же сообщения она нормально **сгенерировала картинку** через Yandex ART (вернула DivKit-JSON с `<img src="https://yaart-web-alice-images.s3.yandex.net/...">`, **идентично обычной Алисе**).

Корректный вывод:
- **DivKit + ART — общая инфраструктура** обеих Алис, не специфика alice.yandex.ru
- **Алиса Про функционально не урезана** — она просто иногда триггерит fallback-suggestion на простые/общие запросы, но в основном отвечает нормально
- Feature-set одинаковый для обоих хостов: memory, skills, upload, prefix-инжекция работают идентично
- **Limitation одинаковый**: bap-стиль tool тэги (VISUALIZER/pptx/etc.) **не работают на обоих**. Alice в любой ипостаси использует свои внутренние tools (ART для рисования, search для фактов, и т.д.) и игнорирует инструкции про XML-теги в user prompt. Это **архитектурное ограничение Yandex'а**, не bug Алисы Про

---

## Алиса (обычная) — детальный протокол

### Tech stack
- React (`alice-for-web` v1.92.2, BEM CSS-классы, data-testid атрибуты)
- WebSocket-based message transport (см. ниже)

### WebSocket протокол

Это **Yandex Alice Protocol** — тот же, что используют умные колонки и Алиса в Яндекс Браузере. Двусторонний обмен JSON-объектами с одним из двух top-level ключей:

**Server → Client (директива):**
```json
{
  "directive": {
    "header": {
      "namespace": "System",
      "name": "Ping",
      "messageId": "{uuid}"
    },
    "payload": {
      "ping_timeout_milliseconds": 60000,
      "pong_timeout_milliseconds": 0,
      "timestamp": 1779195983
    }
  }
}
```

**Client → Server (event):**
```json
{
  "event": {
    "header": {
      "namespace": "System",
      "name": "Pong",
      "messageId": "{uuid}",
      "refMessageId": "{messageId of directive being responded to}"
    },
    "payload": {}
  }
}
```

Namespace'ы (на основе [Yandex Alice docs](https://yandex.ru/dev/dialogs/alice/doc/protocol.html) и observed):
- `System` — heartbeat (`Ping`/`Pong`), service messages
- `Vins` — voice dialog (input/output text, voice features)
- `Audio` — speech synthesis chunks (TTS)
- `Speaker` — audio playback control
- ... много других

### ✓ Полный send/receive протокол (расшифрован 2026-05-19)

**Client → Server — отправка текста пользователя:**

```json
{
  "event": {
    "header": {
      "namespace": "Vins",
      "name": "TextInput",
      "messageId": "{client-generated uuid}",
      "seqNumber": 8
    },
    "payload": {
      "application": {
        "app_id": "ru.yandex.webstandalone.desktop",
        "app_version": "unknown",
        "platform": "windows",
        "os_version": "{user-agent}",
        "uuid": "00000000000000508366871779190740",
        "lang": "ru-RU",
        "client_time": "20260519T131149",
        "timezone": "Europe/Moscow",
        "timestamp": "1779196309"
      },
      "header": {
        "prev_req_id": "{request_id of previous message}",
        "request_id": "{new uuid}",
        "dialog_id": "{from URL path /chat/{dialog_id}/}",
        "dialog_type": 2
      },
      "request": {
        "event": {
          "type": "text_input",
          "text": "Кто написал Войну и мир?"          ← ВОТ ЭТО ПОЛЕ ИНЖЕКТИМ
        },
        "voice_session": false,
        "experiments": [
          "read_dialogs_for_unauthorized_users",
          "mm_enable_protocol_scenario=WebAliceControls",
          "exp_flag_chat_dialog_history",
          "div2cards_in_external_skills_for_web_standalone",
          "skills_standalone_use_div_render",
          "alice_enable_generate_video",
          "draw_picture_enable_controls",
          ... (40+ feature flags)
        ],
        "uniproxy_options": { "background_response_streaming_options": {} },
        "additional_options": { "bass_options": { "user_agent": "..." } }
      }
    }
  }
}
```

**Server → Client — подтверждение получения:**

```json
{
  "directive": {
    "header": { "namespace": "System", "name": "InputStartAck", "refMessageId": "{request_id}", "messageId": "..." },
    "payload": { "input_start_ack": { "request_start_time": 1779196310341531 } }
  }
}
```

**Server → Client — стриминг ответа (несколько чанков):**

```json
{
  "streaming": {
    "source": "InitialRequest",
    "routing": { "dialog_id": "{chat uuid}" }
  },
  "directive": {
    "header": { "namespace": "Vins", "name": "DeferredAliceResponse", "refMessageId": "{request_id}", "messageId": "..." },
    "payload": {
      "json_response": {
        "is_last": false,                       // true в финальном чанке
        "response_partial_num": 1,
        "request_id": "{request_id}",
        "base_response": {
          "text": "Лев Николаевич Толстой.",   // ← полный текст ответа на этот момент
          "cards": [
            {
              "card_id": "...",
              "text_card": {
                "text": "Лев Николаевич Толстой.",
                "progressive_printing": true
              }
            },
            {
              "card_id": "...-origin",
              "sources_card": {
                "sources": ["https://ru.wikipedia.org/...", "https://..."]
              }
            }
          ],
          "directives": [...]                    // server-side actions e.g. tracking events
        }
      }
    }
  }
}
```

**Server → Client — фоновый контроль:**
- `DialogControl` (namespace=System) — `update_time_last_read`, server-side housekeeping
- `Ping` (namespace=System, каждые 60s) — heartbeat

**Server → Client — ART (image generation), TODO детальный recon:**
- На запрос «нарисуй атом» Алиса использовала **внутренний tool** — Yandex ART
- Ответ пришёл как DivKit JSON с image-component, рендерится в `<div class="MessageBubble-Container_type_divjson">`
- URL картинки: `https://yaart-web-alice-images.s3.yandex.net/{uuid}:1`
- Точная структура card_type для картинок — TODO

### Готовый код для injection

```js
// SEND injection — добавить prefix к каждому TextInput
const _send = WebSocket.prototype.send;
WebSocket.prototype.send = function(data) {
  try {
    if (typeof data === 'string') {
      const obj = JSON.parse(data);
      if (obj?.event?.header?.namespace === 'Vins'
          && obj?.event?.header?.name === 'TextInput'
          && obj?.event?.payload?.request?.event?.type === 'text_input') {
        const original = obj.event.payload.request.event.text;
        const prefix = buildPrefixFromMemoriesAndSkills(); // наш контент
        obj.event.payload.request.event.text = prefix + '\n\n' + original;
        data = JSON.stringify(obj);
      }
    }
  } catch (e) {}
  return _send.call(this, data);
};

// RECEIVE — подписаться на новые WS и слушать DeferredAliceResponse
const _WS = window.WebSocket;
function PatchedWS(url, protocols) {
  const inst = new _WS(url, protocols);
  inst.addEventListener('message', (ev) => {
    try {
      const obj = JSON.parse(ev.data);
      const dir = obj?.directive;
      if (dir?.header?.namespace === 'Vins' && dir?.header?.name === 'DeferredAliceResponse') {
        const text = dir.payload?.json_response?.base_response?.text;
        const cards = dir.payload?.json_response?.base_response?.cards;
        const isLast = dir.payload?.json_response?.is_last;
        const requestId = dir.payload?.json_response?.request_id;
        onAliceResponse({ requestId, text, cards, isLast });
      }
    } catch (e) {}
  });
  return inst;
}
PatchedWS.prototype = _WS.prototype;
Object.assign(PatchedWS, _WS);
window.WebSocket = PatchedWS;
```

**Caveat'ы:**
- `experiments` массив в send-payload — содержит ~40 feature flags. Влияние модификации не ясно: `mm_enable_protocol_scenario=WebAliceControls` выглядит как контроль scenario routing — теоретически можно попробовать включить custom scenario, но фильтр на сервере скорее всего не пропустит произвольное значение. **TODO experiment** — попробовать отключить часть флагов и посмотреть на поведение
- `dialog_id` в URL — фронт читает его из `location.pathname`, мы должны делать то же
- `request_id` / `prev_req_id` — uuidv4-like строки клиентского формата `019e405d-3061-47c8-99ac-d0f8c0125cbf`. Можно генерировать crypto.randomUUID, главное хранить prev_req_id для цепочки

### ⚡ Critical finding: Alice использует DivKit, не markdown

В ответ на запрос «нарисуй SVG-схему атома» (с префикс-инструкцией использовать `<BAL:VISUALIZER>`) Алиса:
- ❌ НЕ обернула в `<BAL:VISUALIZER>`
- ❌ НЕ выдала SVG-код
- ✅ Использовала **свой внутренний tool** — Yandex ART — сгенерировала картинку
- ✅ Вернула ответ в **DivJSON** (Yandex DivKit) формате — не markdown!

DOM-маркер: `<div class="MessageBubble-Container_type_divjson">` с вложенными `divkit-xxxxx` классами и `<img src="https://yaart-web-alice-images.s3.yandex.net/...">`.

**Это значит:**
1. Tool-теги в стиле better-alice (`<BAL:VISUALIZER>`, `<BAL:create_file>`, etc.) в Alice работать НЕ будут — она их игнорирует, использует свои встроенные tools, и пишет результат в DivJSON а не в markdown.
2. Полный fork BDS под Alice невозможен в прямой форме. Альтернативы:
   - Принять что Alice сама решает какой tool использовать → перехватывать её **готовые** DivJSON-результаты и обогащать UI (например, добавлять «скачать» к картинкам, «запустить» к code-блокам)
   - Memory/skills/upload — реалистично, работает как обычный текстовый префикс к user prompt
   - Custom rendering tools (pptx/excel/docx/visualizer) — не работает

### DOM

- Чат-инпут: `textarea.AliceInput-Textarea.AliceInput-Textarea_multiline` (data-testid `inputbase-textarea`)
- Контейнер инпута: `.AliceInput.StandaloneRichInput`
- Submit button: `[data-testid="oknyx"]` (в active state добавляет класс `StandaloneOknyx_arrow`)
  - Когда textarea пустая, oknyx — это микрофон/анимация Алисы (voice mode)
  - Когда есть текст, oknyx превращается в «стрелку отправки»
- Сообщения пользователя: `[data-testid="message-bubble-container-from-user"]`
- Сообщения Алисы: `[data-testid="message-bubble-container"]` без `_from-user`-модификатора
- Кнопка нового чата: `[data-testid="new-chat-button"]`
- Сайдбар чатов: `[data-testid="chat-sidebar"]`, элементы: `[data-testid="chatlist-item-{chatId}"]`
- Хедер: `[data-testid="header"]`

### Точки инъекции (для расширения)

**Лучшая точка — monkey-patch `WebSocket.prototype.send`:**
```js
const _wsSend = WebSocket.prototype.send;
WebSocket.prototype.send = function(data) {
  try {
    if (typeof data === 'string' && data.includes('"namespace"')) {
      const obj = JSON.parse(data);
      // TODO: подтвердить точное место хранения текста в payload
      // Гипотеза: obj.event.header.namespace === 'Vins' && obj.event.payload.text
      if (obj?.event?.header?.namespace === 'Vins' && obj.event.payload?.text) {
        obj.event.payload.text = injectPrefix() + '\n\n' + obj.event.payload.text;
        data = JSON.stringify(obj);
      }
    }
  } catch (e) {}
  return _wsSend.call(this, data);
};
```

**Парсинг ответа** — hook на конструктор `WebSocket`:
```js
const _WS = window.WebSocket;
function PatchedWS(...args) {
  const inst = new _WS(...args);
  inst.addEventListener('message', (ev) => {
    try {
      const obj = JSON.parse(ev.data);
      if (obj?.directive?.header?.namespace === 'Vins') {
        // TODO: где-то здесь chunks ответа Алисы
        processIncomingChunk(obj.directive);
      }
    } catch (e) {}
  });
  return inst;
}
PatchedWS.prototype = _WS.prototype;
Object.assign(PatchedWS, _WS);
window.WebSocket = PatchedWS;
```

**⚠️ Caveats:**
1. `WebSocket.prototype.send` патч работает на ВСЕХ инстансах (даже созданных до патча) благодаря shared prototype
2. `WebSocket` constructor patch работает только для НОВЫХ инстансов — старые надо подписать вручную, либо рассчитывать что страница пересоздаст WS при reconnect
3. Лучше всего инжектить хук через `manifest.json content_scripts run_at: document_start` — до того как React успеет создать первый WebSocket

### Альтернативный путь — DOM mutation observer

Если WS-протокол слишком хрупкий (Yandex может его изменить), запасной вариант:
1. Перехватывать submit-кнопку — `addEventListener('click', ...)` на `[data-testid="oknyx"]`
2. Перед кликом — менять `textarea.value` (с диспатчем нативного React-input через `React-DOM internals`)
3. Слушать новые `[data-testid="message-bubble-container"]` через MutationObserver

Но это менее надёжно: React следит за DOM и может перезаписать наши изменения.

---

## Сравнение с Yandex Alice (контекст better-alice)

| | Yandex Alice | Алиса Про | Алиса |
|---|---|---|---|
| Стек | React | SvelteKit | React |
| Send | `POST /api/v0/chat/completion` (JSON) | form POST urlencoded | WebSocket directive/event |
| Stream | SSE поверх HTTP | SvelteKit polling | WebSocket frames |
| System prompt control | ✓ через payload | ❌ нет | ❌ нет |
| Tool tag obedience | ✓ (после инжекта в system) | ❌ (refuses) | ⚠️ TBD |

**Главный вопрос для Variant 2 (full bap-clone)**: будет ли обычная Алиса слушать инструкции в user-сообщении («оборачивай в `<BAL:VISUALIZER>`»). На Алисе Про не слушает. На обычной Алисе тест не доведён до конца (submit-click через CDP не сработал — нужно отладить React-совместимый submit).

---

## Что нужно для адаптации better-alice

### Архитектурный выбор: 1 extension или 2?

**Один extension, два adapter'а** — рекомендую. Преимущества:
- Общая UI (drawer, settings, memory, skills) — единый user experience
- Общий код tool-renderer'ов (VISUALIZER, pptx, excel, docx, create_file)
- Per-host adapter'ы только для transport-слоя

**Структура форка:**

```
better-alice/
├── manifest.json
│   matches: 
│     - https://alicepro.yandex.ru/expert/*
│     - https://alice.yandex.ru/chat/*
│     - https://alice.yandex.ru/        (стартовая страница)
├── src/
│   ├── adapters/
│   │   ├── alicepro.js      # SvelteKit form POST inject
│   │   └── alice.js         # WebSocket directive inject
│   ├── content/             # общий UI (Svelte 5)
│   │   ├── ui/...           # drawer, panels — переносим почти as-is
│   │   ├── scanner.js       # переписать селекторы под Alice DOM
│   │   └── dom/host.js      # переписать host-mounting под Alice
│   ├── injected/
│   │   ├── index.js         # ветвление по location.hostname
│   │   ├── alicepro-fetch-patch.js
│   │   ├── alice-ws-patch.js
│   │   └── payload-mutator.js  # общий — генерит prefix-инжекцию
│   ├── lib/                 # tools, office-skills, rag — переносим as-is
│   └── ...
```

### Список изменений (минимум для MVP)

1. **`static/manifest.json`** — два matches
2. **`src/lib/constants.js`** — DEFAULT_SYSTEM_PROMPT переписать под русский язык и убрать ссылки на Yandex Alice; tool-теги оставить
3. **`src/injected/index.js`** — диспатч по `location.hostname` на нужный адаптер
4. **`src/injected/alicepro-fetch-patch.js`** (новый) — перехват POST на `/expert/api?/messageSend`, мутация form-encoded text
5. **`src/injected/alice-ws-patch.js`** (новый) — перехват WS.send, мутация Vins-payload (после фикса recon)
6. **`src/injected/payload-mutator.js`** — оставить логику build prefix (system+memory+skills), убрать Yandex Alice-specifics (форматирование payload)
7. **`src/content/scanner.js`** — переписать селекторы:
   - Alice Pro: `textarea#message-textarea`, `form#message-form .message-bubble` (TODO recon)
   - Alice: `textarea.AliceInput-Textarea`, `[data-testid="message-bubble-container"]`, `[data-testid="message-bubble-container-from-user"]`
8. **`src/content/dom/host.js`** — переписать монтирование host-контейнеров (зависит от Alice DOM)
9. **`src/content/dom/message-text.js`** — переписать text extraction
10. **`src/content/ui/Drawer.svelte`** — обновить тексты RU + branding (BDS → BAL/BTA или как назовём)
11. **Удалить Yandex Alice-specifics:**
    - `src/lib/pricing.js` (Yandex не отдаёт usage)
    - Yandex Alice-specific URL detection в xhr-patch
    - `Session/fetch_page` логика — не нужна для Alice

### Сохранить as-is (lib/-level переносится):
- Все tool-теги: VISUALIZER, HTML, create_file, pptx, excel, docx, LONG_WORK, character, memory_write
- Office skills (docx, excel, pptx)
- RAG engine
- ZIP / file-builder
- GitHub fetch / Web fetch / YouTube transcript / Twitter fetch
- Sandbox (для запуска python/js/ts)
- UI компоненты Svelte (Drawer, Cards, Lists)

### Не сохранять (Yandex Alice-only):
- Pricing/token usage tracking (Yandex не даёт)
- Session fetch logic
- Server status monitor (есть Yandex но другой endpoint)
- Voice STT/TTS — на Alice уже встроено в Yandex SpeechKit, дублировать смысла нет

---

## Открытые вопросы для следующего recon

1. **Alice WS protocol для отправки сообщения** — точная структура `{event}` с user text
2. **Alice WS protocol для приёма ответа** — структура `{directive}` с text chunks Алисы
3. **Будет ли Alice слушаться prefix-инструкций про теги** — нужен реальный E2E тест
4. **Alice Pro `__data.json` JSON-структура** — как извлечь текст assistant message
5. **Alice DOM message rendering** — куда монтировать host-контейнер для рендера tool-cards (VISUALIZER, pptx превью, etc.)
6. **Alice Pro DOM message rendering** — то же самое для Alice Pro
7. **Длина prefix** — насколько большой инструкционный prefix Alice/AlicePro переваривают без обрезки контекста или жалоб
8. **Multi-turn behavior** — нужно ли инжектить prefix в КАЖДОЕ сообщение или достаточно первого (если Alice удерживает память)

## Reproducibility — как повторить recon

Все скрипты в `alisa/recon/`:

| Файл | Что делает |
|---|---|
| `cdp-eval.mjs <urlSub> <expr>` | One-shot eval JS expression в указанной вкладке через CDP |
| `cdp-network-watch.mjs <urlSub> <sec>` | Слушает все Network-события за N секунд |
| `cdp-send-and-watch.mjs <urlSub> <msg> <sec>` | Программно типает + сабмитит + ловит трафик (для Alice Pro) |
| `cdp-alice-recon.mjs <urlSub> <msg> <sec>` | То же для alice.yandex.ru (специфика oknyx-кнопки) |
| `cdp-full-recon.mjs <urlSub> <msg> <sec>` | Полный recon с bodies (для Alice Pro) |
| `install-hook.mjs <urlSub>` | Ставит in-page хук на window.fetch + WebSocket |
| `read-hook.mjs <urlSub>` | Читает window.__aliceRecon.log |
| `analyze-hook.mjs <file>` | Группирует и форматирует hook-лог |
| `summarize-recon.mjs <file>` | Группирует и форматирует CDP-лог |
| `extract-response.mjs <file>` | Ищет специфичные паттерны (bap:VISUALIZER, <svg>) в body'ах |

Предусловия:
- Chrome запущен с `--remote-debugging-port=9222 --user-data-dir="C:\Users\LL5AI\chrome-claude-profile"` (отдельный профиль обязателен — дефолтный заблокирован Chrome 136+ для CDP)
- В этом профиле залогинены в Яндекс-passport
- Открыты вкладки на нужный сайт
