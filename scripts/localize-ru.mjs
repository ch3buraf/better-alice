// Localize all user-visible UI strings to Russian.
// Scans only .svelte files in src/content/ui/ to keep technical code intact.
//
// Match strategy: only literal occurrences (whole-substring), preserving HTML
// surroundings. Each pair is exact UTF-8 — keep alphabetic-only English
// pairs first to avoid accidentally hitting bap-* CSS class names which contain
// English words too.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");

const PAIRS = [
  // === Drawer & main sections ===
  ["General Settings", "Общие настройки"],
  ["System Prompts", "Системные промпты"],
  ["Read-only core instructions", "Базовые инструкции (только просмотр)"],
  ["Default (Hidden)", "По умолчанию (скрытый)"],
  ["Add New System Prompt", "Добавить системный промпт"],
  ["Advanced Settings", "Дополнительные настройки"],

  // === Settings toggles ===
  ["Project Auto-Context (Local RAG)", "Авто-контекст проекта (локальный RAG)"],
  ["Process .gitignore during upload", "Обрабатывать .gitignore при загрузке"],
  ["Auto download create_file outputs", "Автозагрузка файлов create_file"],
  ["Auto download LONG_WORK zip", "Автозагрузка ZIP из LONG_WORK"],
  ["Disable Hidden System Prompt", "Отключить скрытый системный промпт"],
  ["Disable Stored Memory Injection", "Отключить инжекцию памяти"],
  ["System Prompt Injection Frequency", "Частота инжекции системного промпта"],
  ["Only on first message", "Только в первом сообщении"],
  ["Always (every message)", "Всегда (каждое сообщение)"],
  ["Every N messages", "Каждые N сообщений"],
  ["Voice Mode (Auto-read responses)", "Голосовой режим (озвучка ответов)"],
  ["Auto-submit after speech", "Авто-отправка после распознавания"],
  ["Speech Language", "Язык распознавания речи"],
  ["Preferred Response Language", "Язык ответов модели"],
  ["Markdown Walker Max Depth", "Макс. глубина обхода Markdown"],
  ["Chat Session List Cap", "Лимит списка сессий"],
  ["GitHub Personal Access Token", "GitHub Personal Access Token"],

  // === Settings descriptions ===
  ["Leave empty to let the model decide.", "Оставьте пустым, чтобы модель решила сама."],
  ["Hard cap on DOM recursion depth when reconstructing markdown from a", "Жёсткий лимит глубины рекурсии при сборке markdown из"],
  ["message. Lower = safer against stack overflow on deeply nested content;", "сообщения. Меньше = безопаснее против переполнения стека на глубоко вложенном контенте;"],
  ["higher = preserves structure of pathologically nested messages. Default", "больше = сохраняет структуру патологически вложенных сообщений. По умолчанию"],
  ["Maximum number of chat sessions kept in memory for the sidebar. Older", "Максимальное число сессий, хранимых в памяти для сайдбара. Старые"],
  ["sessions beyond this cap are evicted (FIFO). Lower values reduce memory", "сессии сверх лимита удаляются (FIFO). Меньшие значения уменьшают память"],
  ["usage on long-lived tabs. Default 500.", "при долгой работе во вкладке. По умолчанию 500."],
  ["Create a classic token with", "Создайте classic-токен со скоупом"],
  ["scope at GitHub Settings -&gt;", "в GitHub Settings →"],
  ["scope at GitHub Settings ->", "в GitHub Settings →"],

  // === Buttons ===
  ["Save Settings", "Сохранить настройки"],
  [">Save<", ">Сохранить<"],
  [">Cancel<", ">Отмена<"],
  [">Delete<", ">Удалить<"],
  [">Export<", ">Экспорт<"],
  [">Import<", ">Импорт<"],
  [">Add<", ">Добавить<"],
  [">Edit<", ">Изменить<"],
  [">View<", ">Открыть<"],
  [">Hide<", ">Скрыть<"],
  [">Clear<", ">Очистить<"],
  [">Reset<", ">Сброс<"],
  [">Apply<", ">Применить<"],
  [">Confirm<", ">Подтвердить<"],
  [">Close<", ">Закрыть<"],
  [">Browse<", ">Обзор<"],
  [">Manage<", ">Управлять<"],
  [">New<", ">Новый<"],
  [">Open<", ">Открыть<"],
  [">Run<", ">Запустить<"],

  // === Sections / labels ===
  ["Skill Set", "Набор навыков"],
  ["RP Characters", "RP-персонажи"],
  ["Stored Memory", "Сохранённая память"],
  ["Projects", "Проекты"],
  ["Project & file selection available below the chat input.", "Выбор проекта и файлов доступен под полем ввода."],
  ["Upload Skill (.md)", "Загрузить навык (.md)"],
  ["Upload Persona (.md)", "Загрузить персонажа (.md)"],

  // === Empty states ===
  ["No skills loaded.", "Навыки не загружены."],
  ["No personas saved.", "Персонажи не сохранены."],
  ["No memory entries yet.", "Записей памяти пока нет."],
  ["No projects yet.", "Проектов пока нет."],
  ["None (Assistant)", "Без персонажа (ассистент)"],

  // === Attach menu ===
  ["Upload Folder", "Загрузить папку"],
  ["Upload File", "Загрузить файл"],
  ["GitHub Repo", "GitHub репо"],
  ["Web Page", "Веб-страница"],
  ["YouTube Video", "YouTube видео"],
  ["Twitter / X Post", "Twitter / X пост"],
  ["Voice Input", "Голосовой ввод"],
  ["Stop Recording", "Остановить запись"],
  [">Send<", ">Отправить<"],
  [">Fetch<", ">Получить<"],
  ["Recording...", "Запись..."],
  ["Processing...", "Обработка..."],
  ["Loading...", "Загрузка..."],
  ["Could not fetch page content.", "Не удалось получить содержимое страницы."],

  // === Toasts (часть уже была переведена) ===
  ["File too large to display.", "Файл слишком большой для показа."],
  ["Imported successfully.", "Импорт выполнен."],
  ["Exported successfully.", "Экспорт выполнен."],
  ["Settings saved.", "Настройки сохранены."],
  ["Saved.", "Сохранено."],
  ["Deleted.", "Удалено."],
  ["Copied to clipboard.", "Скопировано в буфер обмена."],

  // === GitHub dialog ===
  ["Import GitHub Repository", "Импорт GitHub репозитория"],
  ["Enter the repo URL or owner/repo", "Введите URL репозитория или owner/repo"],
  ["Include recent commits", "Включить последние коммиты"],
  ["Number of commits", "Количество коммитов"],
  ["Token is valid.", "Токен валиден."],
  ["Token is invalid or expired.", "Токен невалиден или истёк."],

  // === Web dialog ===
  ["Import Web Page", "Импорт веб-страницы"],
  ["Enter the URL", "Введите URL"],
];

const filesToScan = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (st.isFile() && full.endsWith(".svelte")) filesToScan.push(full);
  }
}
walk(path.join(root, "src/content/ui"));

let total = 0;
let touched = 0;
for (const f of filesToScan) {
  let text = fs.readFileSync(f, "utf8");
  const before = text;
  for (const [from, to] of PAIRS) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
      total += (before.length - 0); // count is approximate
    }
  }
  if (text !== before) {
    fs.writeFileSync(f, text);
    touched++;
    console.log(`  ${path.relative(root, f)}`);
  }
}
console.log(`\nLocalized ${touched} files.`);
