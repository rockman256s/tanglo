'use strict';

// Паки для игры: levels/*.json → <игра>/levels-full/*.js (WG.levelPacks)
//   node tools/export.js [levels] [куда] [--to N]
// По умолчанию — в ../levels-full: полный набор, в git не попадает, из него собирается APK.
// В репозитории лежит только начало (../levels): node tools/export.js levels ../levels --to 1000
// JS, а не JSON: в Android WebView c file:// fetch к файлам запрещён, а <script> работает.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const ti = args.indexOf('--to');
const limit = ti >= 0 ? +args.splice(ti, 2)[1] : Infinity;
const src = path.resolve(args[0] || 'levels');
const dst = path.resolve(args[1] || path.join(__dirname, '..', '..', 'levels-full'));
const index = JSON.parse(fs.readFileSync(path.join(src, 'index.json'), 'utf8'));
index.packs = index.packs.filter((_, i) => i * index.packSize < limit);
index.count = Math.min(index.count, index.packs.length * index.packSize);
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(dst)) if (/^pack-\d+\.js$|^index\.js$/.test(f)) fs.unlinkSync(path.join(dst, f));
for (const f of index.packs) {
  const pack = JSON.parse(fs.readFileSync(path.join(src, f), 'utf8'));
  fs.writeFileSync(path.join(dst, f.replace(/\.json$/, '.js')),
    `WG.levelPacks.add(${JSON.stringify({ from: pack.from, to: pack.to, levels: pack.levels })});\n`);
}
fs.writeFileSync(path.join(dst, 'index.js'),
  `WG.levelPacks.setIndex(${JSON.stringify({ packSize: index.packSize, count: index.count, generator: index.generator })});\n`);
console.log(`${index.packs.length} паков, ${index.count} уровней → ${dst}`);
