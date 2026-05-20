# Better Alice — валидация MVP

## Что валидировано (по состоянию на 2026-05-19)

### ✅ Уровень кода — 26/26 unit-тестов зелёные

```
tests/unit/prefix-builder.test.js       12/12 ✓
tests/unit/alicepro-fetch-patch.test.js  5/5  ✓
tests/unit/alice-ws-patch.test.js        9/9  ✓
```

Покрыто:

**Prefix-builder (общий для обоих хостов):**
- На первом сообщении в диалоге инжектится system prompt
- На последующих — не дублируется (если frequency=first)
- frequency=always — инжектит каждый раз
- 'always' memories попадают в каждое сообщение
- 'called' memories — только когда key-слово в prompt'е
- disableSystemPrompt / disableMemory работают
- Активный skill инжектится с fingerprint'ом
- Активный character инжектится в <BAL:RP>
- Strip предыдущих BetterAlice-блоков и legacy BetterAlice
- Per-dialog-id state — новый dialog → новая first-turn инжекция

**Alice Pro adapter (fetch-patch):**
- POST `/expert/api?/messageSend` мутируется: text-параметр обогащается префиксом
- Остальные form-параметры (projectId, chatId, type, source, availableServices) сохраняются
- GET-ы `__data.json?/messageSend=` не трогаются (это response polling)
- Несвязанные POST-ы (`projectCreate`, `messageReaction`) не трогаются
- Idempotent — повторный patch не переустанавливает fetch
- Событие `bap:mutation-applied` с metadata (host, conversationId, userPrompt, injectedText) диспатчится

**Alice adapter (ws-patch):**
- WS-фрейм `Vins/TextInput` парсится, text-payload мутируется, сериализуется обратно
- Не трогает System-фреймы (Pong, Ping)
- Не трогает другие namespace-ы
- Идемпотентность send-патча
- `bap:alice-response-chunk` диспатчится на `DeferredAliceResponse` с is_last=false
- `bap:alice-response-final` диспатчится на is_last=true
- Не падает на malformed JSON
- Не падает на binary (ArrayBuffer) payload

### ✅ Build — все 4 бандла собираются

```
dist-chrome/
├── manifest.json   (matches: alice.yandex.ru + alicepro.yandex.ru)
├── content.js      (823 KB — Svelte UI + storage + scanner)
├── background.js   (9 KB — service worker)
├── injected.js     (11 KB — MAIN-world hook with two adapters)
├── sandbox.js      (1.2 MB — pyodide/JS/TS code runner)
├── content.css
├── sandbox.html
└── static/         (loading SVGs)
```

### ✅ Recon — протокол обоих хостов вскрыт

См. [ALICE_INTERNALS.md](./ALICE_INTERNALS.md). Реальные frames захвачены через CDP:

- Alice Pro: `POST /expert/api?/messageSend` с form-encoded body — точка инъекции `text` параметр
- Alice: `WS event {namespace:Vins,name:TextInput}` — точка инъекции `event.payload.request.event.text`
- Alice response stream: `WS directive {namespace:Vins,name:DeferredAliceResponse}` с `json_response.base_response.text/cards`

## Что НЕ валидировано (требует ручной установки extension в Chrome)

Установка unpacked-extension в Chrome 147+ требует клика по «Load unpacked» в `chrome://extensions/`, который открывает OS-диалог выбора папки. CDP не может управлять нативными OS-диалогами — это архитектурное ограничение Chrome DevTools Protocol.

После клика «Load unpacked» → выбор `dist-chrome/` валидируются:
1. Content-script bootstraps на обоих хостах (`window.__bdsContentBootstrapped`)
2. Injected hook применяется (`window.__betterAliceNetworkPatched` + один из адаптеров)
3. Drawer mountится (`#bap-root` + `#bap-toggle`)
4. После реальной отправки сообщения — `bap:mutation-applied` event fires (метрика инъекции)

Скрипт верификации: `recon/verify-mvp.mjs`.

## Известные ограничения

1. **Tool tags не работают** — обе Алисы игнорируют XML-инструкции в user prompt про `<BAL:VISUALIZER>` и т.п. Используют свои встроенные tools (Yandex ART, search).
2. **No token usage** — Yandex не отдаёт usage в response.
3. **scanner.js не адаптирован** — Yandex Alice-специфичные DOM selectors остаются. Drawer и память работают (они storage-based), но автоматическая обработка assistant messages (download buttons, code runners, long-work zipping) — нет. Это next milestone (task #13).
