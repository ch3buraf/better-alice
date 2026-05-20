// Second pass of localization for strings missed in first sweep.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const PAIRS = [
  [">Run Again<", ">Запустить снова<"],
  [">Console Output<", ">Вывод консоли<"],
  [">Word Document<", ">Word документ<"],
  [">Excel Spreadsheet<", ">Excel таблица<"],
  [">PowerPoint Presentation<", ">PowerPoint презентация<"],
  [">Interactive Simulation<", ">Интерактивная симуляция<"],
  [">Custom Instructions<", ">Кастомные инструкции<"],
  [">Delete Project<", ">Удалить проект<"],
  [">Save Prompt<", ">Сохранить промпт<"],
  [">Run Code<", ">Запустить код<"],
  [">Run Python<", ">Запустить Python<"],
  [">Run JS<", ">Запустить JS<"],
  [">Stop<", ">Остановить<"],
  [">Download<", ">Скачать<"],
  [">Copy<", ">Копировать<"],
  [">Loading...<", ">Загрузка...<"],
  [">Generating...<", ">Генерация...<"],
  ["placeholder=\"Enter folder name\"", "placeholder=\"Введите имя папки\""],
  ["placeholder=\"Project name\"", "placeholder=\"Имя проекта\""],
  ["placeholder=\"Skill name\"", "placeholder=\"Имя навыка\""],
  ["placeholder=\"key\"", "placeholder=\"ключ\""],
  ["placeholder=\"value\"", "placeholder=\"значение\""],
  // various other small phrases
  ["Active Project", "Активный проект"],
  ["Active Files", "Активные файлы"],
  ["Active Skills", "Активные навыки"],
  ["Active Persona", "Активный персонаж"],
  // common UI verbs in text nodes (carefully — only when between tags)
  [">Try Again<", ">Повторить<"],
  [">Refresh<", ">Обновить<"],
  [">Continue<", ">Продолжить<"],
  [">Skip<", ">Пропустить<"],
  [">More<", ">Ещё<"],
  [">Less<", ">Свернуть<"],
];

const files = [];
function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n);
    const st = fs.statSync(f);
    if (st.isDirectory()) walk(f);
    else if (n.endsWith(".svelte")) files.push(f);
  }
}
walk(path.join(root, "src/content/ui"));

let touched = 0;
for (const f of files) {
  let text = fs.readFileSync(f, "utf8");
  const before = text;
  for (const [from, to] of PAIRS) {
    text = text.split(from).join(to);
  }
  if (text !== before) {
    fs.writeFileSync(f, text);
    touched++;
    console.log("  " + path.relative(root, f));
  }
}
console.log(`\n${touched} files.`);
