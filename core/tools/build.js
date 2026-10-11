'use strict';

// Сборка паков уровней.
//   node tools/build.js --from 1 --to 20000 [--pack 100] [--out levels] [--workers N] [--force]
//
// Пишет out/pack-0000.json … (по --pack уровней), out/index.json и out/stats.tsv.
// Готовые паки пропускаются — прерванную сборку можно просто запустить снова.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const FORMAT = 'wazegame-levels/1';
const GENERATOR_VERSION = 1;

if (!isMainThread) {
  const { generateLevel } = require('../src/generator');
  const { encode } = require('../src/codec');
  parentPort.on('message', (n) => {
    const t0 = Date.now();
    const res = generateLevel(n, workerData.options);
    const m = res.metrics;
    if (!m.solvable) throw new Error(`уровень ${n} не решаем`);
    parentPort.postMessage({
      n,
      code: encode(res.level),
      stat: [n, res.level.kind + (res.level.picture ? ':' + res.level.picture.kind + ':' + res.level.picture.name : ''), res.layout,
        m.w, m.h, m.arrows, m.coverage.toFixed(3), m.waves, m.initialFree, m.freeMean.toFixed(2), m.tightSteps,
        m.lenMean.toFixed(1), m.lenMax, m.parallel, res.profile.d.toFixed(2), Date.now() - t0],
    });
  });
  return;
}

function args() {
  const a = { from: 1, to: 100, pack: 100, out: 'levels', workers: Math.max(1, os.cpus().length - 1), force: false };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    if (k === 'force') a.force = true;
    else a[k] = isNaN(+v[i + 1]) ? v[++i] : +v[++i];
  }
  return a;
}

async function main() {
  const a = args();
  const out = path.resolve(a.out);
  fs.mkdirSync(out, { recursive: true });
  const packOf = (n) => Math.floor((n - 1) / a.pack);
  const packFile = (p) => path.join(out, `pack-${String(p).padStart(4, '0')}.json`);

  // Какие уровни нужно сделать
  const todo = [];
  const packs = new Map(); // p → { need, levels: Map }
  for (let n = a.from; n <= a.to; n++) {
    const p = packOf(n);
    if (!a.force && fs.existsSync(packFile(p))) continue;
    if (!packs.has(p)) {
      const lo = p * a.pack + 1;
      const hi = Math.min(lo + a.pack - 1, a.to);
      packs.set(p, { lo, hi, need: hi - lo + 1, levels: new Map(), stats: [] });
    }
    todo.push(n);
  }
  // Пак собирается целиком: если диапазон режет пак, достраиваем его границы
  for (const [p, info] of packs) {
    for (let n = info.lo; n <= info.hi; n++) if (!todo.includes(n)) todo.push(n);
    info.need = info.hi - info.lo + 1;
  }
  todo.sort((x, y) => x - y);
  console.log(`уровней: ${todo.length}, паков: ${packs.size}, потоков: ${a.workers}`);
  if (!todo.length) return writeIndex(a, out);

  const statsFile = path.join(out, 'stats.tsv');
  if (!fs.existsSync(statsFile)) {
    fs.writeFileSync(statsFile, 'n\tkind\tlayout\tw\th\tarrows\tcoverage\twaves\tfree0\tfreeMean\ttight\tlenMean\tlenMax\tparallel\td\tms\n');
  }

  const t0 = Date.now();
  let done = 0;
  let next = 0;
  await new Promise((resolve, reject) => {
    let alive = 0;
    const spawn = () => {
      const w = new Worker(__filename, { workerData: { options: {} } });
      alive++;
      const feed = () => {
        if (next < todo.length) w.postMessage(todo[next++]);
        else { w.terminate(); }
      };
      w.on('message', (msg) => {
        const p = packOf(msg.n);
        const info = packs.get(p);
        info.levels.set(msg.n, msg.code);
        info.stats.push(msg.stat);
        done++;
        if (info.levels.size === info.need) {
          const levels = [];
          for (let n = info.lo; n <= info.hi; n++) levels.push(info.levels.get(n));
          fs.writeFileSync(packFile(p), JSON.stringify({ format: FORMAT, from: info.lo, to: info.hi, levels }));
          info.stats.sort((x, y) => x[0] - y[0]);
          fs.appendFileSync(statsFile, info.stats.map((r) => r.join('\t')).join('\n') + '\n');
          packs.delete(p);
        }
        if (done % 50 === 0 || done === todo.length) {
          const el = (Date.now() - t0) / 1000;
          const eta = (el / done) * (todo.length - done);
          process.stdout.write(`\r${done}/${todo.length}  ${el.toFixed(0)}с  осталось ~${(eta / 60).toFixed(1)} мин   `);
        }
        feed();
      });
      w.on('error', reject);
      w.on('exit', () => { if (--alive === 0) resolve(); });
      feed();
    };
    for (let i = 0; i < Math.min(a.workers, todo.length); i++) spawn();
  });
  process.stdout.write('\n');
  writeIndex(a, out);
}

function writeIndex(a, out) {
  const files = fs.readdirSync(out).filter((f) => /^pack-\d+\.json$/.test(f)).sort();
  let count = 0;
  for (const f of files) {
    const { to } = JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
    count = Math.max(count, to);
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({
    format: FORMAT, generator: GENERATOR_VERSION, packSize: a.pack, count, packs: files,
  }, null, 2));
  console.log(`index.json: ${count} уровней в ${files.length} паках`);
}

main().catch((e) => { console.error(e); process.exit(1); });
