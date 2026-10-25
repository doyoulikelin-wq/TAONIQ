const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let count = 0;
function assert(ok, message) { count++; if (!ok) throw new Error(message); }
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name.startsWith('.') || ['node_modules', 'test-artifacts'].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
for (const file of walk(root)) {
  const rel = path.relative(root, file);
  if (/\.(c?js)$/.test(file)) { execFileSync(process.execPath, ['--check', file]); count++; }
  if (!file.endsWith('.html')) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1].trim()) { new vm.Script(m[1], { filename: rel }); count++; }
  }
  const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert(ids.length === new Set(ids).size, `${rel}: duplicate id`);
  for (const m of source.matchAll(/<(?:script|img|link|a)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
    const url = m[1];
    if (/^<(script|img|link)/.test(m[0])) assert(!/^(https?:|\/\/)/.test(url), `${rel}: remote runtime asset ${url}`);
    if (/^(https?:|mailto:|data:|blob:|\/\/)/.test(url)) continue;
    const [target, fragment] = url.split('#');
    const pathname = target.split('?')[0];
    const resolved = pathname ? path.resolve(path.dirname(file), decodeURIComponent(pathname)) : file;
    assert(fs.existsSync(resolved), `${rel}: missing ${url}`);
    if (fragment && resolved.endsWith('.html')) {
      const other = fs.readFileSync(resolved, 'utf8');
      assert(other.includes(`id="${fragment}"`), `${rel}: missing anchor ${url}`);
    }
  }
  for (const m of source.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)) assert(ids.includes(m[1]), `${rel}: missing label target ${m[1]}`);
  assert(/<meta[^>]+charset="utf-8"/i.test(source), `${rel}: UTF-8 missing`);
  assert(source.includes('name="viewport"'), `${rel}: responsive viewport missing`);
}
console.log(JSON.stringify({ passed: true, checks: count, boundary: 'Static sources and references only; not browser layout or interaction QA.' }));
