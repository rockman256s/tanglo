'use strict';

// Паки для игры: levels/*.json → <игра>/levels/*.js (WG.levelPacks), node tools/export.js [levels] [../levels]
// JS, а не JSON: в Android WebView c file:// fetch к файлам запрещён, а <script> работает.
const fs = require('fs');
const path = require('path');

const src = path.resolve(process.argv[2] || 'levels');
const dst = path.resolve(process.argv[3] || path.join(__dirname, '..', '..', 'levels'));
const index = JSON.parse(fs.readFileSync(path.join(src, 'index.json'), 'utf8'));
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
