// Builds faq-bot.min.js and faq-bot.min.css with no dependencies:
// strips comments, indentation and blank lines. Run: node build.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const dir = __dirname;

function minifyJs(src) {
  const out = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('/*!')) { out.push(line); continue; }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    if (!line || line.startsWith('//')) continue;
    // Trailing "// note" is dropped only when nothing before it could hide a "//".
    const at = line.indexOf(' // ');
    if (at > -1 && !/['"`/]/.test(line.slice(0, at))) {
      out.push(line.slice(0, at).trimEnd());
      continue;
    }
    out.push(line);
  }
  return squeeze(out.join('\n')) + '\n';
}

// Drops spaces next to punctuation, outside strings, regexes and template literals.
function squeeze(code) {
  const PUNCT = '{}()[];,:=+-*<>!&|?';
  const REGEX_BEFORE = '(,=:[!&|?{};\n';
  let out = '';
  let i = 0;
  const lastCode = () => out.replace(/[ \t]+$/, '').slice(-1);
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      out += code.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '/' && (REGEX_BEFORE.includes(lastCode()) || /\breturn\s*$/.test(out))) {
      let j = i + 1, inClass = false;
      while (j < code.length && code[j] !== '\n') {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === '[') inClass = true;
        else if (code[j] === ']') inClass = false;
        else if (code[j] === '/' && !inClass) break;
        j++;
      }
      j++;
      while (/[a-z]/.test(code[j] || '')) j++;
      out += code.slice(i, j);
      i = j;
      continue;
    }
    if (c === ' ') {
      let j = i;
      while (code[j] === ' ') j++;
      const prev = out.slice(-1), next = code[j] || '';
      const same = (prev === '+' || prev === '-') && prev === next;
      if (!same && (PUNCT.includes(prev) || PUNCT.includes(next))) { i = j; continue; }
      out += ' ';
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function minifyCss(src) {
  const license = (src.match(/^\/\*![\s\S]*?\*\//) || [''])[0];
  const body = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .trim();
  return (license ? license + '\n' : '') + body + '\n';
}

const files = [
  ['faq-bot.js', 'faq-bot.min.js', minifyJs],
  ['faq-bot.css', 'faq-bot.min.css', minifyCss]
];

let total = 0;
for (const [from, to, fn] of files) {
  const out = fn(fs.readFileSync(path.join(dir, from), 'utf8'));
  fs.writeFileSync(path.join(dir, to), out);
  const size = Buffer.byteLength(out);
  total += size;
  console.log(`${to}: ${(size / 1024).toFixed(1)} KB (${(zlib.gzipSync(out).length / 1024).toFixed(1)} KB gzipped)`);
}
console.log(`total: ${(total / 1024).toFixed(1)} KB`);
