import fs from 'node:fs';
const raw = fs.readFileSync(process.argv[2], 'utf8');
// Strip leading "Focusing... Typing..." lines until JSON starts
const m = raw.match(/\{\r?\n  "requests"/);
if (!m) { console.error('no JSON marker'); process.exit(1); }
const data = JSON.parse(raw.slice(m.index));

console.log('=== Pre-JSON stderr lines ===');
console.log(raw.slice(0, m.index).trim());
console.log();

console.log(`=== Total ${data.requests.length} alicepro requests, ${data.wsFrames.length} WS frames ===`);
console.log();

// Group by method
const byMethod = {};
for (const r of data.requests) {
  const k = `${r.method} ${(r.url || '').split('?')[0]}`;
  byMethod[k] = (byMethod[k] || 0) + 1;
}
console.log('=== Methods & paths ===');
for (const [k, v] of Object.entries(byMethod)) console.log(`  ${v}x ${k}`);
console.log();

// Show all POSTs with payload
const posts = data.requests.filter(r => r.method && r.method !== 'GET' && r.method !== 'OPTIONS');
console.log(`=== ${posts.length} non-GET requests with payload ===`);
for (const r of posts) {
  console.log('---');
  console.log(`${r.method} ${r.url}`);
  console.log(`status=${r.status} contentType=${r.contentType || r.mime}`);
  console.log(`POST (${r.postBytes}B): ${r.postPreview}`);
  console.log(`RESP BODY: ${r.body?.slice(0, 2000)}`);
}
console.log();

console.log(`=== WS frames (${data.wsFrames.length}) ===`);
const wsByUrl = {};
for (const f of data.wsFrames) {
  const k = `${f.kind} ${f.url || '(no url)'}`;
  wsByUrl[k] = (wsByUrl[k] || 0) + 1;
}
for (const [k, v] of Object.entries(wsByUrl)) console.log(`  ${v}x ${k}`);
console.log();

console.log('=== ws-out + ws-in samples ===');
for (const f of data.wsFrames.slice(0, 20)) {
  if (f.kind === 'ws-open') console.log(`  [OPEN] ${f.url}`);
  else console.log(`  [${f.kind}] ${(f.payload || '').slice(0, 400)}`);
}
