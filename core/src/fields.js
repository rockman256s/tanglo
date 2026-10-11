'use strict';

// Поля потока: для каждой клетки — веса четырёх направлений головы (U R D L) и потенциал
// (0..1: чем больше, тем раньше в обратном построении ставится голова, т.е. тем позже её снимут).
//
// Референс: у каждого уровня (или зоны уровня) есть доминирующее направление, противоположное
// почти отсутствует. Разбор идёт от «выхода» к «истоку», поэтому потенциал — это расстояние до
// края по направлению потока: дальние клетки ставятся первыми.

const { DX, DY } = require('./metrics');

// Веса для доминирующего направления main: основное, два боковых, встречное
function dirWeights(main, rng, mood) {
  const w = [0, 0, 0, 0];
  const pMain = rng.range(mood.main[0], mood.main[1]);
  const pOpp = rng.range(mood.opp[0], mood.opp[1]);
  const rest = Math.max(0, 1 - pMain - pOpp);
  const split = rng.range(0.15, 0.85); // боковые делят остаток неровно (в референсе 29% vs 7%)
  w[main] = pMain;
  w[(main + 2) % 4] = pOpp;
  w[(main + 1) % 4] = rest * split;
  w[(main + 3) % 4] = rest * (1 - split);
  return w;
}

// Расстояние от клетки до края по направлению d
function edgeDist(x, y, d, W, H) {
  return d === 0 ? y : d === 1 ? W - 1 - x : d === 2 ? H - 1 - y : x;
}

function finish(W, H, flow) {
  const pot = new Float32Array(W * H);
  let max = 1e-9;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let s = 0;
      let ws = 0;
      for (let d = 0; d < 4; d++) {
        const f = flow[i * 4 + d];
        s += f * edgeDist(x, y, d, W, H);
        ws += f;
      }
      pot[i] = ws > 0 ? s / ws : 0;
      if (pot[i] > max) max = pot[i];
    }
  }
  for (let i = 0; i < pot.length; i++) pot[i] /= max;
  return { flow, pot };
}

// Одна зона, один поток (уровни 1–2 референса)
function single(W, H, rng, mood) {
  const w = dirWeights(rng.int(0, 3), rng, mood);
  const flow = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) for (let d = 0; d < 4; d++) flow[i * 4 + d] = w[d];
  return finish(W, H, flow);
}

// Две половины со своими потоками (разрез вертикальный или горизонтальный, с шумом)
function split(W, H, rng, mood) {
  const vertical = rng.chance(0.5);
  const cut = (vertical ? W : H) * rng.range(0.38, 0.62);
  const a = rng.int(0, 3);
  // Вторая половина: наружу от разреза, поперёк или так же — разные рисунки зависимостей
  const b = rng.pick([(a + 2) % 4, (a + 1) % 4, (a + 3) % 4, a]);
  const wa = dirWeights(a, rng, mood);
  const wb = dirWeights(b, rng, mood);
  const flow = new Float32Array(W * H * 4);
  const wobble = rng.range(0, 3);
  const phase = rng.range(0, 6.28);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = vertical ? x - wobble * Math.sin(y / 4 + phase) : y - wobble * Math.sin(x / 4 + phase);
      const w = t < cut ? wa : wb;
      for (let d = 0; d < 4; d++) flow[(y * W + x) * 4 + d] = w[d];
    }
  }
  return finish(W, H, flow);
}

// Четыре квадранта, каждый течёт к своему углу (как уровень 3 референса)
function quad(W, H, rng, mood) {
  const cx = W * rng.range(0.4, 0.6);
  const cy = H * rng.range(0.4, 0.6);
  const flow = new Float32Array(W * H * 4);
  const pairs = {}; // для каждого квадранта — доли двух «наружных» направлений
  for (const q of ['00', '01', '10', '11']) pairs[q] = rng.range(0.3, 0.7);
  const pOpp = rng.range(mood.opp[0], mood.opp[1]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const left = x < cx;
      const top = y < cy;
      const h = left ? 3 : 1;
      const v = top ? 0 : 2;
      const s = pairs[(top ? '0' : '1') + (left ? '0' : '1')];
      const i = (y * W + x) * 4;
      flow[i + h] = (1 - pOpp) * s;
      flow[i + v] = (1 - pOpp) * (1 - s);
      flow[i + (h + 2) % 4] = pOpp / 2;
      flow[i + (v + 2) % 4] = pOpp / 2;
    }
  }
  return finish(W, H, flow);
}

// Вихрь: направления по касательной вокруг центра (с примесью «наружу»).
// Лучи проходят через центр — очень длинные цепочки и много пересечений
function spiral(W, H, rng, mood) {
  const cx = (W - 1) * rng.range(0.35, 0.65);
  const cy = (H - 1) * rng.range(0.35, 0.65);
  const cw = rng.chance(0.5) ? 1 : -1;
  const out = rng.range(0.2, 0.8);
  const flow = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const rx = (x - cx) / W;
      const ry = (y - cy) / H;
      const r = Math.hypot(rx, ry) || 1;
      const tx = (-ry * cw) / r + (out * rx) / r;
      const ty = (rx * cw) / r + (out * ry) / r;
      const i = (y * W + x) * 4;
      for (let d = 0; d < 4; d++) {
        const dot = tx * DX[d] + ty * DY[d];
        flow[i + d] = Math.max(0, dot) ** 2 + mood.opp[1] * 0.3;
      }
    }
  }
  return finish(W, H, flow);
}

// Полосы со встречными потоками (горизонтальные или вертикальные)
function stripes(W, H, rng, mood) {
  const vertical = rng.chance(0.5);
  const len = vertical ? W : H;
  const n = rng.int(3, 5);
  const bounds = [];
  for (let k = 1; k < n; k++) bounds.push(Math.round((len * k) / n + rng.range(-1.5, 1.5)));
  const mains = [];
  const base = vertical ? rng.pick([0, 2]) : rng.pick([1, 3]);
  for (let k = 0; k < n; k++) mains.push(k % 2 ? (base + 2) % 4 : base);
  const ws = mains.map((m) => dirWeights(m, rng, mood));
  const flow = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = vertical ? x : y;
      let k = 0;
      while (k < bounds.length && t >= bounds[k]) k++;
      for (let d = 0; d < 4; d++) flow[(y * W + x) * 4 + d] = ws[k][d];
    }
  }
  return finish(W, H, flow);
}

const LAYOUTS = { single, split, quad, spiral, stripes };

module.exports = { LAYOUTS, dirWeights, finish, edgeDist };
