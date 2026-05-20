# Better Alice — архитектура расширения

## Обзор

Better Alice — Chrome/Edge/Firefox MV3 extension, добавляющий слой управляющих фич поверх Яндекс Алисы (`alice.yandex.ru`) и Алисы Про (`alicepro.yandex.ru`). Архитектурно — fork [better-alice](https://github.com/EdgeTypE/better-alice), адаптированный под Yandex-стек.

```
┌──────────────────────────────────────────────────────────────┐
│  Browser tab @ alice.yandex.ru / alicepro.yandex.ru          │
│                                                              │
│  ┌─────────────────────────┐    ┌─────────────────────────┐  │
│  │  MAIN world             │    │  ISOLATED world         │  │
│  │  (page JS context)      │    │  (extension content     │  │
│  │                         │    │   script context)        │  │
│  │  ┌──────────────────┐   │    │  ┌──────────────────┐   │  │
│  │  │ injected.js      │◀──┼────┼──│ content.js       │   │  │
│  │  │ - patches fetch  │   │ ev │  │ - Svelte 5 UI    │   │  │
│  │  │   or WebSocket   │   │ ents│ │ - storage layer  │   │  │
│  │  │ - injects prefix │──▶┼────┼─▶│ - DOM scanner    │   │  │
│  │  │   (sys+mem+skl)  │   │    │  │ - export tools   │   │  │
│  │  └──────────────────┘   │    │  └──────────────────┘   │  │
│  └─────────────────────────┘    └─────────────────────────┘  │
│           ▲                              ▲                   │
│           │                              │                   │
│   intercept user msg              chrome.storage.local       │
└──────────────────────────────────────────────────────────────┘
        │                                  ▲
        ▼                                  │
  Yandex backend                  ┌────────┴────────────┐
  (WS or SvelteKit form)          │ background.js (SW)  │
                                  │ - tab/install hooks │
                                  └─────────────────────┘
```

## Bundle layout

Build script (`build.js`) собирает 4 IIFE-бандла через Vite:

| Файл           | Контекст           | Что внутри                                         |
|----------------|--------------------|---------------------------------------------------|
| `content.js`   | content-script (ISOLATED) | Svelte 5 UI, storage, scanner, экспортёр |
| `background.js`| service worker     | minimal: install handler, openOptionsPage         |
| `injected.js`  | page main world    | Network hooks (WebSocket / fetch monkey-patch)    |
| `sandbox.js`   | sandboxed iframe   | Pyodide / JS-eval runner (Code Runner card)       |

`manifest.json` (MV3): `content_scripts` запускается `run_at: document_start`, что критично — иначе SvelteKit/React успеют закэшировать `window.fetch` / `window.WebSocket` до того как мы их пропатчим.

## Поток инъекции

```
USER → Alice/Алиса Pro UI → submit handler → fetch() / ws.send()
                                              │
                                              ▼ (intercepted)
                              ┌──────────────────────────────┐
                              │ injected/index.js dispatcher │
                              │ (hostname-based)             │
                              └──────────────────────────────┘
                                              │
                            ┌─────────────────┴─────────────────┐
                            ▼                                   ▼
              ┌──────────────────────┐               ┌──────────────────────┐
              │ alice-ws-patch.js    │               │ alicepro-fetch-patch │
              │ (WebSocket.send)     │               │ (window.fetch)       │
              └──────────────────────┘               └──────────────────────┘
                            │                                   │
                            └─────────────────┬─────────────────┘
                                              ▼
                              ┌──────────────────────────────┐
                              │ prefix-builder.js            │
                              │ buildPrefixedText(text,      │
                              │   state, conversationId)     │
                              │                              │
                              │ Собирает:                    │
                              │  - system prompt (1st turn)  │
                              │  - skills (1st turn)         │
                              │  - character (1st turn)      │
                              │  - project context (1st turn)│
                              │  - matched memories (always) │
                              │  - RAG chunks (every prompt) │
                              └──────────────────────────────┘
                                              │
                                              ▼
                       prefix + "\n\n" + originalText → отдаётся в backend
```

## Per-host адаптер

### alice.yandex.ru — WebSocket (Yandex Alice Protocol)

- **Транспорт**: persistent `wss://` соединение (на момент recon: `wss://uniproxy.alice.yandex.net/`)
- **Формат фрейма (client → server)**:
  ```json
  {"event":{
    "header":{"namespace":"Vins","name":"TextInput",...},
    "payload":{
      "header":{"dialog_id":"...","request_id":"..."},
      "request":{"event":{"type":"text_input","text":"ВОТ СЮДА ИНЖЕКТИМ"}}
    }
  }}
  ```
- **Формат ответа (server → client)**:
  ```json
  {"directive":{
    "header":{"namespace":"Vins","name":"DeferredAliceResponse",...},
    "payload":{"json_response":{
      "is_last":true,
      "base_response":{"text":"...","cards":[{"text_card":{...}},{"sources_card":{...}}]}
    }}
  }}
  ```
- **Patch механизм**: `WebSocket.prototype.send` overridden (cross-instance via prototype chain) + `WebSocket` constructor wrapped (for incoming message capture on new instances)
- **Caveat**: send-патч использует `_send.call(this, data)` НЕ `_send.apply(this, arguments)` — в strict mode (ES modules) `arguments` не алиасится к локальной переменной `data`, поэтому реассайн `data = JSON.stringify(mutated)` НЕ отразится в arguments[0]

### alicepro.yandex.ru — SvelteKit form action

- **Транспорт**: HTTP POST на `https://alicepro.yandex.ru/expert/api?/messageSend`
- **Content-Type**: `application/x-www-form-urlencoded`
- **Body**:
  ```
  projectId=...&chatId=...&type=input&source=main&
  text=URL-encoded-text&availableServices=7&...
  ```
- **Response**: `{"type":"redirect","status":302,"location":"...?/messageSend="}` — SvelteKit form action redirect, фронт после этого polling-ит `__data.json?/messageSend=` (GET'ы, обычно 9-12 за раз) пока ответ Алисы стримится
- **Patch механизм**: `window.fetch` overridden, мутирует `text` параметр URLSearchParams тела

## Per-host DOM-якоря

| Элемент          | Alice (React)                                         | Alice Pro (SvelteKit)            | Yandex Alice (legacy)          |
|------------------|-------------------------------------------------------|----------------------------------|----------------------------|
| Чат-инпут        | `textarea.AliceInput-Textarea` + `[data-testid="inputbase-textarea"]` | `textarea#message-textarea` | `textarea#chat-input`      |
| Форма            | (нет form, React onSubmit)                            | `form#message-form`              | n/a                        |
| Submit кнопка    | `[data-testid="oknyx"].StandaloneOknyx_arrow`         | `form#message-form button.submit`| SVG-path-detection         |
| Сообщения юзера  | `[data-testid="message-bubble-container-from-user"]`  | `.message.user`                  | `div.ds-message._63c77b1` (с heuristic) |
| Сообщения Алисы  | `[data-testid="message-bubble-container"]`            | `.alice-message`                 | `div.ds-message` (assistant heuristic)  |
| ART/Image bubble | `.MessageBubble-Container_type_divjson img`           | то же (общий DivKit)             | n/a                        |
| Кнопка нового чата | `[data-testid="new-chat-button"]`                   | `#new-boltalka-form button`      | Yandex Alice-specific          |

## Storage layer

`chrome.storage.local` keyspace:

| Key                              | Назначение                              |
|----------------------------------|------------------------------------------|
| `bap_settings`                   | settings (system prompt, frequency, etc.) |
| `bap_skills`                     | список skills                            |
| `bap_memories`                   | memory entries                           |
| `bap_characters`                 | RP-персоны                               |
| `bap_projects`                   | projects (name, instructions)            |
| `bap_project_files`              | файлы проектов                           |
| `bap_chat_tags`                  | теги для chat-сессий                     |
| `bap_remote_announcement` (unused) | announcements feed (отключён)           |

В localStorage (per-page):
| Key                       | Назначение                                              |
|---------------------------|--------------------------------------------------------|
| `bap_injected_chats`      | список dialog_id где уже инжектировали system prompt   |
| `bap_injected_chars`      | какой character был активен в dialog (для смены)        |

## Events bridge (MAIN ↔ ISOLATED)

Через `window.dispatchEvent(new CustomEvent(...))` — оба мира видят window события, JSON-сериализуем detail для Firefox Xray-vision.

| Event                        | Откуда → куда     | Зачем                                        |
|------------------------------|--------------------|----------------------------------------------|
| `bap:config-update`          | content → injected | Обновлённый snapshot config (memory/skills)  |
| `bap:request-config`         | injected → content | injected просит первичный config             |
| `bap:mutation-applied`       | injected → content | После каждой инъекции (для логов/UI)         |
| `bap:alice-response-chunk`   | injected → content | Стрим ответа Алисы по WS (chunk)             |
| `bap:alice-response-final`   | injected → content | Финальный чанк (is_last=true)                |
| `bap:mark-voice-message`     | content → injected | Помечает следующее сообщение как voice       |

## DOM-инспектор: что добавляется на страницу

1. `#bap-root` — корневой div в `<body>`, mountpoint Svelte App
2. `#bap-toggle` — floating-кнопка справа сверху ("BA")
3. `#bap-drawer` — выезжающий drawer с настройками
4. `#bap-injected-hook` — `<script src="injected.js">` (удаляется после load)
5. (Per-feature) `.bap-code-download` — кнопки на code-блоках
6. (Per-feature) `[data-bap-attach-menu-mounted]` — маркер места куда смонтирован "+" upload
7. (Per-feature) `[data-bap-code-download-attached="1"]` — маркер обработанного code-блока

## Build & dev workflow

```bash
# Установить deps
npm install

# Dev build with watch
npm run dev

# Production build
npm run build:chrome
npm run build:firefox

# Unit tests
npm run test:unit

# Reload extension в Chrome (когда CDP на 9222 включен)
node ../recon/reload-extension.mjs
```

См. также:
- [ALICE_INTERNALS.md](./ALICE_INTERNALS.md) — детальный протокол Алисы и Алисы Про
- [FEATURES.md](./FEATURES.md) — статус каждой bap-фичи в Better Alice
- [VALIDATION.md](./VALIDATION.md) — отчёт о валидации MVP
