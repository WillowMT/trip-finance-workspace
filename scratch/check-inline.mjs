// Parses the two inline template literals out of src/pages.ts the way Node would evaluate them,
// then syntax-checks the client script. Two things kill a deployed page silently: a stray backtick or
// `${`, and a single backslash before a regex-significant character, which the template literal
// consumes (`\s` ships as `s`, so `/s+/g` eats every "s" out of a label). Both are hard failures here.
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

let failures = 0;
const bad = (line) => { failures++; console.log(line); };

console.log('APP_SCRIPT closed=' + script.closed + ' chars=' + script.value.length);
console.log('CSS closed=' + css.closed + ' chars=' + css.value.length);

try {
  execFileSync(process.execPath, ['--check', 'scratch/served-script.js'], { stdio: 'pipe' });
  console.log('SCRIPT_SYNTAX=OK');
} catch (e) {
  bad('SCRIPT_SYNTAX=BROKEN');
  console.log(String(e.stderr || e.message).split('\n').slice(0, 12).join('\n'));
}

// Escapes that the template literal eats before the browser ever sees them. Doubled backslashes are
// the correct form in this file; a lone one in front of a pattern character changes what ships.
const REAL_ESCAPES = new Set(['n', 't', 'r', 'u', 'x', '`', '$', '\\', '"', "'"]);
let singleEscapes = 0;
script.raw.split('\n').forEach((line, index) => {
  for (let k = 0; k < line.length; k++) {
    if (line[k] !== '\\') continue;
    const next = line[k + 1];
    if (next === '\\') { k++; continue }
    if (!next || REAL_ESCAPES.has(next)) continue;
    singleEscapes++;
    bad('SINGLE_ESCAPE line ' + (index + 1) + ': ' + line.trim().slice(0, 110));
    break;
  }
});
console.log('SINGLE_ESCAPES=' + singleEscapes);

const backticks = (script.value.match(/`/g) || []).length;
const dollarBrace = (script.value.match(/\$\{/g) || []).length;
console.log('BACKTICKS_IN_SCRIPT=' + backticks);
console.log('DOLLAR_BRACE_IN_SCRIPT=' + dollarBrace);
if (backticks) bad('BACKTICKS_IN_SCRIPT must be 0');
if (dollarBrace) bad('DOLLAR_BRACE_IN_SCRIPT must be 0');

console.log(failures ? 'INLINE=FAIL (' + failures + ')' : 'INLINE=pass');
process.exitCode = failures ? 1 : 0;
