import fs from 'node:fs';

const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const filtered = data.filter((e) => {
  const u = String(e.url || '');
  return !u.includes('mc.yandex') && !u.includes('strm.yandex') && !u.includes('yastatic') && !u.includes('mc.webvisor');
});

console.log('Filtered:', filtered.length, '/', data.length);
console.log();

console.log('=== Unique URLs ===');
const groups = {};
for (const e of filtered) {
  const k = `${e.kind} ${e.url || '(none)'}`;
  groups[k] = (groups[k] || 0) + 1;
}
for (const [k, v] of Object.entries(groups)) console.log(` ${v}x ${k}`);

console.log();
console.log('=== Frames in chronological order (head 40) ===');
for (const e of filtered.slice(0, 40)) {
  console.log('---');
  console.log(`[${e.kind}] ${e.url || ''}`);
  if (e.method) console.log(`  method=${e.method} status=${e.status}`);
  if (e.postPreview) console.log(`  POST: ${e.postPreview.slice(0, 600)}`);
  if (e.body) console.log(`  BODY: ${e.body.slice(0, 800)}`);
  if (e.data) console.log(`  DATA: ${e.data.slice(0, 800)}`);
}
