// Sweep through user-facing strings and replace Yandex Alice branding with Better Alice.
// Touches: src/content/ui/*.svelte, src/content/ui/*.js, src/lib/pricing.js
// Skips internal selectors/CSS class prefixes (bap-*) and storage keys (bap_*).

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');

// Visible string replacements (order matters — most-specific first)
const REPLACEMENTS = [
  // Drawer / toggle / titles
  ['Better Alice', 'Better Alice'],
  ['BetterAlice', 'BetterAlice'],
  // Toggle button text
  ['>BDS<', '>BA<'],
  // GitHub links → placeholder
  ['https://github.com/EdgeTypE/better-alice/issues/new', 'https://github.com/'],
  ['https://github.com/EdgeTypE/better-alice#changelog', 'https://github.com/'],
  ['https://github.com/EdgeTypE/better-alice', 'https://github.com/'],
  // Content references in user-visible text
  ['Yandex Alice API cost', 'оценка стоимости (отключено для Алисы)'],
  ['Yandex Alice\'s', 'Алисы'],
  ['Yandex Alice API', 'API'],
  ['alice.yandex.ru', 'alice.yandex.ru'],
  ['Better Alice is an open-source community', 'Better Alice is an open-source community'],
];

// Files/globs to scan — user-facing UI only
const TARGETS = [
  'src/content/ui',
  'src/lib/pricing.js',
  'src/lib/constants.js',
];

const SKIP_NAMES = ['rebrand.mjs', '.test.js'];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_NAMES.some(s => name.includes(s))) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile() && /\.(svelte|js)$/.test(name)) out.push(full);
  }
}

const files = [];
for (const t of TARGETS) {
  const full = path.join(root, t);
  if (!fs.existsSync(full)) continue;
  if (fs.statSync(full).isDirectory()) walk(full, files);
  else files.push(full);
}

let totalReplacements = 0;
let touchedFiles = 0;
for (const f of files) {
  let text = fs.readFileSync(f, 'utf8');
  const before = text;
  for (const [from, to] of REPLACEMENTS) {
    const parts = text.split(from);
    if (parts.length > 1) {
      totalReplacements += (parts.length - 1);
      text = parts.join(to);
    }
  }
  if (text !== before) {
    fs.writeFileSync(f, text);
    touchedFiles++;
    console.log(`  ${f.replace(root + path.sep, '')}: changed`);
  }
}

console.log(`\nDone: ${totalReplacements} replacements across ${touchedFiles} files.`);
