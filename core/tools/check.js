'use strict';

// Проверка паков кодом самой игры: node tools/check.js [levels] [--game ../src]
// Каждый уровень декодируется и прогоняется через WG.level.validate (структура + решаемость).
// В конце — сводка метрик по диапазонам уровней.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { decode } = require('../src/codec');
const { analyze } = require('../src/metrics');

const dir = path.resolve(process.argv[2] || 'levels');
const gi = process.argv.indexOf('--game');
const gameSrc = path.resolve(gi > 0 ? process.argv[gi + 1] : path.join(__dirname, '..', '..', 'src'));

// Грузим модель и решатель игры так же, как её тесты (общий window.WG)
global.window = {};
for (const f of ['core', 'rng', 'level', 'solver']) {
  vm.runInThisContext(fs.readFileSync(path.join(gameSrc, f + '.js'), 'utf8'), { filename: f + '.js' });
}
const WG = window.WG;

const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
let ok = 0;
const bad = [];
const bands = new Map();
const bandOf = (n) => (n <= 10 ? '1-10' : n <= 100 ? '11-100' : n <= 1000 ? '101-1000' : n <= 5000 ? '1001-5000' : '5001+');

for (const file of index.packs) {
  const pack = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  pack.levels.forEach((code, k) => {
    const n = pack.from + k;
    const level = decode(code, n);
    try {
      const sol = WG.level.validate(level);
      if (!sol.solvable) throw new Error('не решаем');
      ok++;
    } catch (e) {
      bad.push(`${n}: ${e.message}`);
      return;
    }
    const m = analyze(level, { frontierRuns: 4 });
    const key = bandOf(n) + (level.kind === 'picture' ? ' картинки' : '');
    const b = bands.get(key) || { count: 0, cells: 0, arrows: 0, coverage: 0, waves: 0, free0: 0, freeMean: 0, lenMean: 0 };
    b.count++;
    b.cells += m.cells;
    b.arrows += m.arrows;
    b.coverage += m.coverage;
    b.waves += m.waves;
    b.free0 += m.initialFree;
    b.freeMean += m.freeMean;
    b.lenMean += m.lenMean;
    bands.set(key, b);
  });
}

console.log(`проверено игрой: ${ok} ок, ${bad.length} ошибок`);
for (const b of bad.slice(0, 20)) console.log('  ✗', b);
console.log('\nдиапазон            уровней  клеток  стрелок  покрытие  волны  своб.старт  фронт  длина');
for (const [k, b] of [...bands].sort()) {
  const c = b.count;
  console.log(`${k.padEnd(20)}${String(c).padStart(7)}${(b.cells / c).toFixed(0).padStart(8)}${(b.arrows / c).toFixed(0).padStart(9)}` +
    `${((b.coverage / c) * 100).toFixed(1).padStart(9)}%${(b.waves / c).toFixed(1).padStart(7)}${(b.free0 / c).toFixed(1).padStart(12)}` +
    `${(b.freeMean / c).toFixed(2).padStart(7)}${(b.lenMean / c).toFixed(1).padStart(7)}`);
}
process.exit(bad.length ? 1 : 0);
