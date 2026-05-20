// Roll back the over-aggressive "Projects" → "Проекты" replacement that broke
// JS identifiers and Svelte component imports.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");

// Walk all .svelte and .js files and reverse the bad replacement.
const filesToScan = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (["node_modules", ".git", "dist-chrome", "dist-firefox", "dist-android"].includes(name)) continue;
      walk(full);
    } else if (/\.(svelte|js)$/.test(name)) {
      filesToScan.push(full);
    }
  }
}
walk(path.join(root, "src"));

const PATTERNS = [
  // identifier replacements that ate the "Projects" word
  [/refreshПроекты/g, "refreshProjects"],
  [/ПроектыManager/g, "ProjectsManager"],
  [/ПроектыCard/g, "ProjectsCard"],
  [/panelПроекты/g, "panelProjects"],
  // any standalone "Проекты" that landed inside an identifier-like context
  // (next to letters/digits/underscores on either side, NOT in HTML text)
  [/([A-Za-z_])Проекты/g, "$1Projects"],
  [/Проекты([A-Za-z_])/g, "Projects$1"],
];

let touched = 0;
for (const f of filesToScan) {
  let text = fs.readFileSync(f, "utf8");
  const before = text;
  for (const [from, to] of PATTERNS) {
    text = text.replace(from, to);
  }
  if (text !== before) {
    fs.writeFileSync(f, text);
    touched++;
    console.log(`  fixed ${path.relative(root, f)}`);
  }
}
console.log(`\nReverted ${touched} files.`);
