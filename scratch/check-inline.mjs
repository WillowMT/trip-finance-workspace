// Parses the two inline template literals out of src/pages.ts the way Node would evaluate them,
// then syntax-checks the client script. A stray backtick or a single-backslash escape shows up here
// rather than in a browser as a dead app.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const src = fs.readFileSync('src/pages.ts', 'utf8');

function literal(name) {
  const start = src.indexOf('const ' + name + ' = `');
  if (start < 0) throw new Error('no ' + name);
  const from = start + ('const ' + name + ' = `').length;
  // Walk forward to the closing backtick, honouring escapes, so a backslash-backtick inside does not end it.
  let i = from;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '`') break;
    i++;
  }
  const raw = src.slice(from, i);
  // What the template literal actually produces at runtime.
  const value = raw.replace(/\\([\s\S])/g, (m, c) => (c === '`' ? '`' : c === '$' ? '$' : c === '\\' ? '\\' : c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c));
  return { raw, value, closed: src[i] === '`' };
}

const script = literal('APP_SCRIPT');
const css = literal('CSS');
fs.writeFileSync('scratch/served-script.js', script.value);
fs.writeFileSync('scratch/served-style.css', css.value);

console.log('APP_SCRIPT closed=' + script.closed + ' chars=' + script.value.length);
console.log('CSS closed=' + css.closed + ' chars=' + css.value.length);

try {
  execFileSync(process.execPath, ['--check', 'scratch/served-script.js'], { stdio: 'pipe' });
  console.log('SCRIPT_SYNTAX=OK');
} catch (e) {
  console.log('SCRIPT_SYNTAX=BROKEN');
  console.log(String(e.stderr || e.message).split('\n').slice(0, 12).join('\n'));
}

// Escapes that reach the browser as a bare character are a silent behaviour change: report the ones
// inside regex literals, where losing a backslash changes what the expression matches.
for (const line of script.value.split('\n')) {
  const m = line.match(/\/[^/\n]*\/[gimsuy]*/g);
  if (!m) continue;
  for (const lit of m) {
    if (/^\/[A-Za-z]+\/[gimsuy]*$/.test(lit) && lit.length > 3 && !/^\/[a-z]+$/i.test(lit)) console.log('SUSPECT_REGEX=' + lit + '  <- ' + line.trim().slice(0, 90));
  }
}
console.log('BACKTICKS_IN_SCRIPT=' + (script.value.match(/`/g) || []).length);
console.log('DOLLAR_BRACE_IN_SCRIPT=' + (script.value.match(/\$\{/g) || []).length);
