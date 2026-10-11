'use strict';

const { rng: makeRng } = require('./rng');

// Направления: индекс 0..3 = U R D L (как WG.DIR_NAMES в игре)
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const DIR_NAMES = ['U', 'R', 'D', 'L'];

function dirIndex(dx, dy) {
  return dx === 1 ? 1 : dx === -1 ? 3 : dy === 1 ? 2 : 0;
}

function headDir(cells) {
  const n = cells.length;
  const [px, py] = cells[n - 2];
  const [hx, hy] = cells[n - 1];
  return dirIndex(hx - px, hy - py);
}

// Граф «A ждёт B» (B лежит на луче A). Лучи идут до края прямоугольника, маска на них не влияет
function dependencies(level) {
  const { w, h, arrows } = level;
  const owner = new Int32Array(w * h).fill(-1);
  arrows.forEach((a, i) => { for (const [x, y] of a.cells) owner[y * w + x] = i; });
  const waits = arrows.map((a, i) => {
    const [hx, hy] = a.cells[a.cells.length - 1];
    const d = headDir(a.cells);
    const out = [];
    for (let x = hx + DX[d], y = hy + DY[d]; x >= 0 && y >= 0 && x < w && y < h; x += DX[d], y += DY[d]) {
      const o = owner[y * w + x];
      if (o !== -1 && o !== i && !out.includes(o)) out.push(o);
    }
    return out;
  });
  return { owner, waits };
}

// Волны: на каждом шаге убираются все свободные. waves = длина самой длинной цепочки
function waves(waits) {
  const n = waits.length;
  const blockers = waits.map((w) => w.length);
  const waitedBy = Array.from({ length: n }, () => []);
  waits.forEach((ws, i) => { for (const j of ws) waitedBy[j].push(i); });
  const wave = new Int32Array(n).fill(-1);
  let cur = [];
  for (let i = 0; i < n; i++) if (blockers[i] === 0) cur.push(i);
  let k = 0;
  let removed = 0;
  const sizes = [];
  while (cur.length) {
    sizes.push(cur.length);
    const next = [];
    for (const i of cur) {
      wave[i] = k;
      removed++;
      for (const j of waitedBy[i]) if (--blockers[j] === 0) next.push(j);
    }
    cur = next;
    k++;
  }
  return { solvable: removed === n, count: k, sizes, wave, waitedBy };
}

// Игрок снимает по одной случайной свободной стрелке: сколько вариантов у него на каждом шаге
function frontier(waits, waitedBy, runs, seed) {
  const n = waits.length;
  const r = makeRng(seed);
  const acc = new Float64Array(n);
  for (let run = 0; run < runs; run++) {
    const blockers = waits.map((w) => w.length);
    const free = [];
    for (let i = 0; i < n; i++) if (blockers[i] === 0) free.push(i);
    for (let step = 0; step < n && free.length; step++) {
      acc[step] += free.length;
      const k = Math.floor(r.next() * free.length);
      const i = free[k];
      free[k] = free[free.length - 1];
      free.pop();
      for (const j of waitedBy[i]) if (--blockers[j] === 0) free.push(j);
    }
  }
  const avg = Array.from(acc, (v) => v / runs);
  return {
    mean: avg.reduce((s, v) => s + v, 0) / n,
    tight: avg.filter((v) => v <= 2.5).length, // шагов, где выбор из ≤2 стрелок
    curve: avg,
  };
}

// Полный набор метрик уровня (те же, что я снимал со скриншотов референса)
function analyze(level, opts = {}) {
  const { w, h, arrows, mask } = level;
  const n = arrows.length;
  const allowedCount = mask ? mask.reduce((s, row) => s + [...row].filter((c) => c === '#').length, 0) : w * h;
  const covered = arrows.reduce((s, a) => s + a.cells.length, 0);
  const { owner, waits } = dependencies(level);
  const wv = waves(waits);
  const fr = frontier(waits, wv.waitedBy, opts.frontierRuns || 12, 12345);

  const lens = arrows.map((a) => a.cells.length);
  let turns = 0;
  let segs = 0;
  const dirs = [0, 0, 0, 0];
  for (const a of arrows) {
    dirs[headDir(a.cells)]++;
    let prev = -1;
    for (let k = 1; k < a.cells.length; k++) {
      const d = dirIndex(a.cells[k][0] - a.cells[k - 1][0], a.cells[k][1] - a.cells[k - 1][1]);
      if (d !== prev) { segs++; if (prev !== -1) turns++; }
      prev = d;
    }
  }

  // Пары стрелок, идущих бок о бок ≥6 клеток — главный визуальный «путатель»
  const touch = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = owner[y * w + x];
      if (a === -1) continue;
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        if (nx >= w || ny >= h) continue;
        const b = owner[ny * w + nx];
        if (b === -1 || b === a) continue;
        const key = a < b ? a * 65536 + b : b * 65536 + a;
        touch.set(key, (touch.get(key) || 0) + 1);
      }
    }
  }
  let parallel = 0;
  for (const v of touch.values()) if (v >= 6) parallel++;

  const blockedBy = new Int32Array(n);
  for (const ws of waits) for (const j of ws) blockedBy[j]++;

  return {
    w, h, arrows: n,
    cells: allowedCount,
    coverage: covered / allowedCount,
    empty: allowedCount - covered,
    solvable: wv.solvable,
    waves: wv.count,
    initialFree: wv.sizes[0] || 0,
    freeMean: fr.mean,
    tightSteps: fr.tight,
    lenMean: covered / Math.max(1, n),
    lenMax: Math.max(0, ...lens),
    stubs: lens.filter((l) => l === 2).length / Math.max(1, n),
    turnsMean: turns / Math.max(1, n),
    segMean: (covered - n) / Math.max(1, segs),
    dirs: Object.fromEntries(DIR_NAMES.map((d, i) => [d, dirs[i] / Math.max(1, n)])),
    blockersMean: waits.reduce((s, ws) => s + ws.length, 0) / Math.max(1, n),
    maxBlocks: Math.max(0, ...blockedBy),
    parallel,
  };
}

module.exports = { DX, DY, DIR_NAMES, dirIndex, headDir, dependencies, waves, frontier, analyze };
