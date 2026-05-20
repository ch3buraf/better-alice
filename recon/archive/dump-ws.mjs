import fs from 'node:fs';
const raw = fs.readFileSync(process.argv[2], 'utf8');
const m = raw.match(/\{\r?\n  "requests"/);
const data = JSON.parse(raw.slice(m.index));

console.log(`Total ${data.wsFrames.length} WS frames`);
console.log();

for (const [i, f] of data.wsFrames.entries()) {
  console.log(`--- [${i}] ${f.kind} ---`);
  if (f.url) console.log(`url: ${f.url}`);
  if (f.payload) {
    try {
      const obj = JSON.parse(f.payload);
      console.log(JSON.stringify(obj, null, 2).slice(0, 4000));
    } catch (e) {
      console.log(f.payload.slice(0, 2000));
    }
  }
  console.log();
}
