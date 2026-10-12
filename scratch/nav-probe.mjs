// One-job-per-page + drawer: structural probe of the DEPLOYED page (read-only GETs).
// Usage: node scratch/nav-probe.mjs
import fs from 'node:fs';

const ORIGIN = 'https://trip-finance-workspace.waiyanmt.workers.dev';
const secret = fs.readFileSync('/opt/data/scratch/workspace-secret.txt', 'utf8').trim();
const page = await fetch(`${ORIGIN}/w/${secret}`, { redirect: 'manual' });
const html = await page.text();
fs.writeFileSync('/opt/data/vietnam-finance-workspace/scratch/served-page.html', html);

const checks = [
  ['status 200', page.status === 200],
  ['drawer exists', html.includes('id="nav-drawer"')],
  ['drawer starts closed', /id="nav-open"[^>]*aria-expanded="false"/.test(html)],
  ['no always-visible tab bar', !html.includes('class="tabs"')],
  ['no type dropdown', !html.includes('id="t-kind"')],
  ['add page own form', /<section id="add"[^>]*>[\s\S]*?id="t-add"/.test(html)],
  ['pay page own form', /<section id="pay"[^>]*>[\s\S]*?id="p-add"/.test(html)],
  ['read page keeps analytics', /<section id="ledger">[\s\S]*?id="spend-chart"/.test(html)],
  ['cards collapse', /<details class="card fold">\s*<summary>/.test(html)],
  ['no data card open', !/<details class="card fold"[^>]*\sopen/.test(html)],
  ['word ledger is gone from copy', !/>[^<]*\b[Ll]edger\b[^<]*</.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))],
  ['split page has no splits card', !/id="split"[\s\S]{0,4000}?id="recent-splits"/.test(html)],
  ['recent splits live on the read page', /id="ledger"[\s\S]*?id="recent-splits"/.test(html)],
];

let bad = 0;
for (const [name, ok] of checks) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`) }
console.log(`NAV_PROBE=${bad ? 'FAIL' : 'OK'} (${checks.length - bad}/${checks.length})`);
