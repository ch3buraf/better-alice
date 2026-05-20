import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// All non-metrika, non-yastatic entries
const filt = data.filter(e => {
  const u = String(e.url || '');
  return !u.includes('mc.yandex') && !u.includes('strm.yandex') && !u.includes('mc.webvisor') && !u.includes('yastatic') && !u.endsWith('.js');
});

// Unique URLs by kind
const groups = {};
for (const e of filt) {
  const k = `${e.kind}|${e.url || '(none)'}`;
  groups[k] = (groups[k] || 0) + 1;
}
console.log('--- Unique non-metrika kinds/URLs ---');
for (const [k, v] of Object.entries(groups)) console.log(`  ${v}x ${k}`);
console.log();

// All WS frames (any URL) — but show ws-out specifically
const wsOut = data.filter(e => e.kind === 'ws-out' && !String(e.data || '').includes('"ping"') && !String(e.data || '').includes('mousemove') && !String(e.data || '').includes('"event":"focus"') && !String(e.data || '').includes('"event":"blur"') && !String(e.data || '').includes('windowfocus') && !String(e.data || '').includes('windowblur'));
console.log(`--- ws-out frames (excluding ping + mousemove + focus + blur): ${wsOut.length} ---`);
for (const e of wsOut.slice(0, 20)) {
  console.log(`  url=${e.url}`);
  console.log(`  data=${e.data?.slice(0, 600)}`);
  console.log();
}

// All ws-in frames
const wsIn = data.filter(e => e.kind === 'ws-in');
console.log(`--- ws-in frames: ${wsIn.length} ---`);
for (const e of wsIn.slice(0, 20)) {
  console.log(`  url=${e.url}`);
  console.log(`  data=${e.data?.slice(0, 600)}`);
  console.log();
}

// All fetch entries with POST or with status that's not 200 or with body containing "message"
console.log('--- fetch entries (full inspection) ---');
const fetches = data.filter(e => e.kind === 'fetch');
console.log(`Total fetches: ${fetches.length}`);
const methods = {};
for (const e of fetches) methods[e.method || 'GET'] = (methods[e.method || 'GET'] || 0) + 1;
console.log('Methods:', methods);

const posts = fetches.filter(e => e.method && e.method !== 'GET');
console.log(`Non-GET fetches: ${posts.length}`);
for (const e of posts.slice(0, 10)) {
  console.log(`  ${e.method} ${e.url}`);
  console.log(`  postPreview: ${e.postPreview}`);
  console.log(`  status: ${e.status}, body: ${e.body?.slice(0, 600)}`);
  console.log();
}
