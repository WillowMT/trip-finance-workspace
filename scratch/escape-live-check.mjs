// Reads the DEPLOYED page's bytes and proves the inline script arrived with its escapes intact.
// `\s` lost to a template literal ships as /s+/g, which eats the s out of "➕ Add expense" — the
// reported bug. Usage: node scratch/escape-live-check.mjs https://host/path
const url = process.argv[2];
if (!url) { console.log('usage: node escape-live-check.mjs <url>'); process.exit(1) }

const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
const html = await res.text();
console.log('STATUS ' + res.status + ' BYTES ' + html.length);

const checks = [
  ['script arrived', html.includes('function navMark(')],
  ['whitespace collapse intact', html.includes('replace(/\\s+/g')],
  ['mangled collapse absent', !html.includes('replace(/s+/g')],
  ['no ${ in client script', !html.includes('${')],
];
let bad = 0;
for (const [name, ok] of checks) { if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + name) }
process.exitCode = bad ? 1 : 0;
