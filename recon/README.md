# recon/ — Chrome DevTools Protocol инструменты

Скрипты для тестирования Better Alice через Chrome DevTools Protocol (CDP). Требуется Chrome, запущенный с `--remote-debugging-port=9222 --user-data-dir=...` и руками авторизованной сессией в Алисе/Алисе Про.

## Активные

| Скрипт | Что делает |
|---|---|
| `qa-alice.mjs` | 12 кейсов на regular Alice (`alice.yandex.ru`): self-check, pptx, excel, docx, filename, visualizer, latex, ask, memory, character, zip, run-python. |
| `qa-alicepro-project.mjs` | Те же 12 кейсов, но на AlicePro через готовый проект (юзер должен предварительно положить `SYSTEM PROMPT_IMPORTANT.txt` в Источники проекта). Включает reload-retry: если первая проверка fail, делает `Page.reload(true)` и проверяет ещё раз. |
| `test-skill-in-source-bundle.mjs` | Smoke-test что активный skill попадает в скачиваемый `system_prompt.txt` (проверяет работу bundling в SettingsPanel). |

## Запуск

```bash
# 1. Запустить Chrome с открытым CDP-портом
chrome --remote-debugging-port=9222 --user-data-dir=C:\chrome-claude-profile

# 2. Авторизоваться в Алисе и AlicePro руками, загрузить unpacked extension
# 3. Положить SYSTEM PROMPT_IMPORTANT.txt в Источники проекта AlicePro

# 4. Прогнать тесты
node qa-alicepro-project.mjs
node qa-alice.mjs
node test-skill-in-source-bundle.mjs
```

Скриншоты падают в `screenshots/qa-pro/`, `screenshots/qa-alice/`.

## archive/

56 одноразовых скриптов разведки и итеративных тестов, использовавшихся при разработке. Найдённые в них практики — feature-detection, паттерны DOM-селекторов, особенности Алисы и AlicePro — суммированы в [`docs/RECON_FINDINGS.md`](../docs/RECON_FINDINGS.md). Сами скрипты больше не запускаются, но могут пригодиться как отправная точка для будущих расследований.
