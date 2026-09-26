// Version-stamps the page's files so a deploy can't mix old and new ones.
//
// GitHub Pages lets browsers cache each file for 10 minutes, so right after a deploy a browser could load a new
// main.js next to an old round.js. This gives every script, worklet and stylesheet URL a ?v= stamp, one for the
// whole set: a hash of the sources, so any change gives every file a new URL. All imports of a module carry the
// same stamp, so each module still loads once. It also lists the modules as <link rel="modulepreload"> in
// index.html, so the browser fetches them all at once instead of discovering them import by import.
//
// usage: node tools/stamp.mjs            (rewrites the files; run it before committing)
//        node tools/stamp.mjs --check    (exits 1 if the stamps are out of date)
import { createHash } from 'crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const js = walk(join(ROOT, 'js')).filter((p) => p.endsWith('.js')).sort();
const css = walk(join(ROOT, 'css')).filter((p) => p.endsWith('.css')).sort();
const rel = (p) => relative(ROOT, p).split('\\').join('/');

const V = /\?v=[0-9a-f]+/g;
const unstamped = (text) => text.replace(V, '');
const hash = createHash('sha256');
for (const p of [...js, ...css]) hash.update(rel(p) + '\0' + unstamped(readFileSync(p, 'utf8')) + '\0');
const v = hash.digest('hex').slice(0, 10);

const out = new Map();
for (const p of js) {
  const text = unstamped(readFileSync(p, 'utf8'))
    .replace(/(\bfrom\s+'|\bimport\s+')(\.{1,2}\/[^'?]+\.js)'/g, `$1$2?v=${v}'`)
    .replace(/new URL\('(\.\/[^'?]+\.worklet\.js)', import\.meta\.url\)/g, `new URL('$1?v=${v}', import.meta.url)`);
  out.set(p, text);
}
const modules = js.filter((p) => !p.endsWith('.worklet.js')).map(rel);
const html = join(ROOT, 'index.html');
out.set(html, unstamped(readFileSync(html, 'utf8'))
  .replace(/href="(css\/[^"?]+\.css)"/g, `href="$1?v=${v}"`)
  .replace(/src="(js\/main\.js)"/, `src="$1?v=${v}"`)
  .replace(/( *)<!-- modules -->[\s\S]*?<!-- \/modules -->/, (_, pad) =>
    `${pad}<!-- modules -->\n${modules.map((m) => `${pad}<link rel="modulepreload" href="${m}?v=${v}">`).join('\n')}\n${pad}<!-- /modules -->`));

const stale = [...out].filter(([p, text]) => readFileSync(p, 'utf8') !== text).map(([p]) => rel(p));
if (process.argv.includes('--check')) {
  if (stale.length) { console.error(`stamps out of date (run node tools/stamp.mjs): ${stale.join(', ')}`); process.exit(1); }
  console.log(`stamps current (v=${v})`);
} else {
  for (const [p, text] of out) if (stale.includes(rel(p))) writeFileSync(p, text);
  console.log(`v=${v}: ${stale.length ? `updated ${stale.join(', ')}` : 'already current'}`);
}
