import fs from 'node:fs';
const raw = fs.readFileSync(process.argv[2], 'utf8');
const m = raw.match(/\{\r?\n  "requests"/);
const data = JSON.parse(raw.slice(m.index));

// Find the longest __data.json body — that should contain Alice's final response
const dataJsons = data.requests
  .filter(r => r.url.includes('__data.json'))
  .filter(r => r.body)
  .sort((a, b) => (b.body?.length || 0) - (a.body?.length || 0));

console.log(`Found ${dataJsons.length} __data.json responses with bodies`);

// Find any bap:VISUALIZER tag in any response
for (const r of dataJsons.slice(0, 5)) {
  console.log('---');
  console.log(`URL: ${r.url}`);
  console.log(`Body length: ${r.body?.length}`);
  const bdsHit = r.body?.indexOf('bap:VISUALIZER');
  const svgHit = r.body?.indexOf('<svg');
  const atomHit = r.body?.toLowerCase().indexOf('атом');
  const electronHit = r.body?.toLowerCase().indexOf('электрон');
  const codeHit = r.body?.indexOf('```');
  console.log(`  bap:VISUALIZER index: ${bdsHit}`);
  console.log(`  <svg index: ${svgHit}`);
  console.log(`  атом index: ${atomHit}`);
  console.log(`  электрон index: ${electronHit}`);
  console.log(`  \`\`\` index: ${codeHit}`);
  // Show surroundings of each hit
  if (bdsHit > -1) console.log(`  BDS context: ${r.body.slice(Math.max(0, bdsHit-100), bdsHit+200)}`);
  if (svgHit > -1) console.log(`  SVG context: ${r.body.slice(Math.max(0, svgHit-100), svgHit+300)}`);
  if (atomHit > -1) console.log(`  Атом context: ${r.body.slice(Math.max(0, atomHit-50), atomHit+200)}`);
}
