# Better Alice — Chrome-расширение для Алисы и Алисы Про

Превращает [Алису](https://alice.yandex.ru) и [Алису Про](https://alicepro.yandex.ru) в полноценного AI-ассистента: специальные кодовые блоки `bap-*` для генерации файлов, навыки (skills), память, ролевые персонажи и Live Drawer-настройки.

Форк [better-deepseek](https://github.com/EdgeTypE/better-deepseek), переписанный под Яндекс Алису.

<img width="312" height="637" alt="Снимок экрана 2026-05-20 231452" src="https://github.com/user-attachments/assets/698570cc-aafd-4dae-8d70-7a0fbbb496a2" />
<img width="295" height="446" alt="image" src="https://github.com/user-attachments/assets/cca91631-15bd-4b58-9e12-c3a1449d817f" />

## ⚠ Дисклеймер

Это **рабочий пример**, а не отполированный продукт. Что нужно учитывать:

- **Код в значительной мере сгенерирован** на базе оригинала better-deepseek, переписан и адаптирован под Алису/АлисуПро. Хоть всё и протестировано (267/267 юнит-тестов + e2e 12/12 на обоих хостах), отдельные фичи могут вести себя нестабильно.
- **Документация** в `docs/` и комментарии в коде составлены при помощи AI-ассистента и могут содержать неточности или устаревшие выводы.
- **Интерфейс Алисы и Алисы Про периодически меняется** (DOM-селекторы, WS-протокол, поведение модели). Если расширение в какой-то момент перестало работать — скорее всего Yandex изменил что-то в своей реализации, и нужно адаптировать селекторы / sniff-логику. Своевременных обновлений я не обещаю.
- Расширение **не публиковалось** в магазины (Chrome Web Store / Firefox Add-ons / Edge Add-ons) — это форк под себя. Если хотите официально опубликовать — fork под своим аккаунтом, я не против. PR с фиксами и обновлениями тоже приветствуются.

## Что умеет

Когда Алиса видит специальный кодовый блок — расширение делает с ним что-то полезное:

- ` ```bap-pptx ` → JSON-спецификация → скачивается готовый `.pptx`
- ` ```bap-excel ` → `.xlsx`
- ` ```bap-docx ` → `.docx`
- ` ```bap-zip ` → многофайловый ZIP-архив
- ` ```filename=имя.ext ` → произвольный файл с правильным именем
- ` ```bap-visualizer ` → HTML+SVG+JS в sandbox iframe (интерактивные схемы и симуляции)
- ` ```bap-latex ` → красивая формула через KaTeX (длинные системы уравнений, матрицы)
- ` ```bap-run-python ` / `bap-run-js` / `bap-run-ts` → код запускается в браузерном sandbox
- ` ```bap-ask ` → интерактивная панель уточняющих вопросов прямо в поле ввода
- ` ```bap-memory ` → факт сохраняется в долговременную память, подмешивается в контекст
- ` ```bap-character ` → персонаж для ролевой игры

Плюс: загруженные `.md`-навыки, активный RP-персонаж, всё это автоматически подмешивается в контекст. Live Drawer — настройки применяются на лету, без кнопки Save.

## Установка

### Способ 1 — из готового ZIP

1. Скачай `better-alice-chrome.zip` из релизов (или собери — см. ниже).
2. Распакуй в любую папку.
3. Открой `chrome://extensions/`.
4. Включи «**Режим разработчика**» (правый верхний угол).
5. Нажми «**Загрузить распакованное расширение**» → выбери папку, куда распаковал.

### Способ 2 — собрать из исходников

```bash
git clone <repo-url>
cd better-alice
npm install
npm run build:chrome      # → dist/chrome/ + better-alice-chrome.zip
npm run build:firefox     # → dist/firefox/ + better-alice-firefox.zip
npm run build             # оба сразу
```

Дальше — те же шаги 3–5 из «Способа 1», только выбрать `dist/chrome` (или распаковать только что собранный `better-alice-chrome.zip`).

## Настройка для Алисы Про

Алиса Про игнорирует system-prompt инжекцию в сообщения (защита от джейлбрейка), поэтому контекст приходится подсовывать через **Источники проекта**:

1. Открой Drawer расширения (значок ✨ в углу чата).
2. Нажми «📥 **Скачать system_prompt.txt**» — расширение соберёт файл с системным промптом, шпаргалкой по `bap-*` форматам, активными skills, RP-персонажем и памятью.
3. В Алисе Про создай проект (или открой существующий).
4. Загрузи скачанный файл в раздел «**Источники**».
5. Работай в чатах этого проекта — Алиса будет читать файл как авторитетный контекст.

Когда добавляешь/меняешь skills или важные факты — перезалей source-файл в проект.

Готовый пример source-файла — [`SYSTEM_PROMPT_IMPORTANT.txt`](SYSTEM_PROMPT_IMPORTANT.txt).

На обычной Алисе (`alice.yandex.ru`) ничего из этого делать не нужно — инжекция работает напрямую через перехват WebSocket.

## Структура

```
better-alice/
├── src/
│   ├── content/        # content-scripts (scanner, UI, handlers)
│   ├── injected/       # MAIN-world (WS-patch для Alice, fetch-patch для AlicePro)
│   ├── sandbox/        # iframe-окружение (Pyodide, KaTeX, fflate)
│   ├── background/     # service worker
│   └── lib/            # общие константы и хелперы
├── tests/              # 267 unit + integration тестов (Vitest)
├── android/            # Android-обвязка (WebViewBridge — для WebView-приложения)
├── docs/               # архитектура, сравнение Alice vs AlicePro, recon findings
├── recon/              # CDP-инструменты для E2E-тестирования
├── dist/chrome/        # build output → загружать как unpacked
├── SYSTEM_PROMPT_IMPORTANT.txt   # пример source-файла для проекта Алисы Про
└── better-alice-chrome.zip       # дистрибутив после `npm run build:chrome`
```

## Тестирование

### Юнит и интеграционные

```bash
npm test               # 267 unit + integration (Vitest)
npm run test:unit      # только unit (с покрытием)
npm run test:watch     # watch mode
```

### E2E через Chrome DevTools Protocol

Нужен запущенный Chrome с открытым CDP-портом и авторизованной сессией в Алисе/Алисе Про:

```bash
# 1. Запустить Chrome с CDP
chrome --remote-debugging-port=9222 --user-data-dir=C:\chrome-claude-profile

# 2. Авторизоваться в Алисе и Алисе Про руками, загрузить unpacked расширение
# 3. Для AlicePro — положить SYSTEM_PROMPT_IMPORTANT.txt в Источники проекта

# 4. Прогнать тесты
cd recon
node qa-alice.mjs                       # 12 кейсов на обычной Алисе
node qa-alicepro-project.mjs            # 12 кейсов на Алисе Про
node test-skill-in-source-bundle.mjs    # smoke-test bundling skills в source-файл
```

Скриншоты падают в `recon/screenshots/`.

## Документация

- [`docs/ALICE_VS_ALICEPRO.md`](docs/ALICE_VS_ALICEPRO.md) — техническое руководство: в чём разница между двумя хостами и как с этим жить.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — общая архитектура расширения.
- [`docs/ALICE_INTERNALS.md`](docs/ALICE_INTERNALS.md) — внутренности Алисы (WS-протокол, DOM-селекторы, поведение модели).
- [`docs/RECON_FINDINGS.md`](docs/RECON_FINDINGS.md) — практические наблюдения из CDP-разведки.
- [`docs/FEATURES.md`](docs/FEATURES.md) — полный список фич с примерами.
- [`docs/REBRAND_PARITY.md`](docs/REBRAND_PARITY.md) — аудит паритета с форком-родителем.

## Стек

- **Manifest V3** Chrome extension + `web-accessible-resources` для sandbox
- **Svelte 5** (`$state`, `$effect`, `$props`, `$derived`) + Vite 6
- **Vitest 3** + jsdom для тестов
- **Pyodide** через extension-sandbox iframe (обходит Yandex CSP)
- **KaTeX** для LaTeX-рендера в iframe
- **PptxGenJS / SheetJS / docx-js** для офисных файлов
- **fflate** для ZIP

## Лицензия

MIT — см. [`LICENSE`](LICENSE).

Авторы:
- Çağrı DÜRÜ — оригинал [better-deepseek](https://github.com/EdgeTypE/better-deepseek)
- [ch3buraf](https://github.com/ch3buraf) — форк Better Alice
