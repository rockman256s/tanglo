'use strict';

// Генератор уровня n: профиль → N кандидатов обратным построением → лучший по целям профиля →
// полировка → раскраска. Результат — уровень в формате игры (WG.level.Board):
//   { id, w, h, mask, arrows: [{ id, cells: [[x, y], …] (хвост → голова), color }] }

const { rng: makeRng, mix } = require('./rng');
const { construct } = require('./construct');
const { LAYOUTS } = require('./fields');
const { analyze, DX, DY } = require('./metrics');
const { profile } = require('./profile');
const { SHAPES, rasterize, crop } = require('./shapes');
const { polish } = require('./polish');

const PALETTE_SIZE = 8;

// Насколько метрики далеки от целей профиля (меньше — лучше)
function cost(m, t) {
  let c = 0;
  c += Math.max(0, t.coverage - m.coverage) * 400; // 1% непокрытых клеток = 4 очка
  c += Math.abs(m.freeMean - t.freeMean) * 2;
  c += (Math.abs(m.waves - t.waves) / t.waves) * 10;
  if (m.initialFree < t.initialFree[0]) c += (t.initialFree[0] - m.initialFree) * 3;
  if (m.initialFree > t.initialFree[1]) c += (m.initialFree - t.initialFree[1]) * 0.5;
  c += Math.abs(m.lenMean - t.lenMean) * 0.5;
  if (!m.solvable) c += 1e6;
  return c;
}

function toLevel(n, W, H, mask, arrows) {
  return {
    id: n,
    w: W,
    h: H,
    mask,
    arrows: arrows.map((a, i) => ({ id: i, cells: a.cells.map((c) => [c % W, (c - (c % W)) / W]), color: 0 })),
  };
}

// Раскраска: соприкасающиеся стрелки — разных цветов (жадно, порядок случайный)
function colorize(level, r, fixedColor, reserved = []) {
  const { w, h, arrows } = level;
  const owner = new Int32Array(w * h).fill(-1);
  arrows.forEach((a, i) => { for (const [x, y] of a.cells) owner[y * w + x] = i; });
  const order = r.shuffle(arrows.map((_, i) => i));
  const shift = r.int(0, PALETTE_SIZE - 1);
  for (const i of order) {
    if (fixedColor) {
      const fc = fixedColor(arrows[i]);
      if (fc !== null) { arrows[i].color = fc; continue; }
    }
    const used = new Set();
    for (const c of reserved) used.add(c);
    for (const [x, y] of arrows[i].cells) {
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const o = owner[ny * w + nx];
        if (o !== -1 && o !== i && arrows[o].colored) used.add(arrows[o].color);
      }
    }
    let c = shift;
    for (let k = 0; k < PALETTE_SIZE; k++) {
      c = (shift + k) % PALETTE_SIZE;
      if (!used.has(c)) break;
    }
    arrows[i].color = c;
    arrows[i].colored = true;
  }
  for (const a of arrows) delete a.colored;
}

// Контур фигуры: клетки внутри, у которых есть сосед (по 8 направлениям) снаружи.
// Обходим кольцо кусками и превращаем куски в длинные стрелки-стены
function contourArrows(inside, W, H, r) {
  const ringSet = new Set();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside[y * W + x]) continue;
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !inside[ny * W + nx]) { edge = true; break; }
        }
      }
      if (edge) ringSet.add(y * W + x);
    }
  }
  const occ = new Int32Array(W * H).fill(-1);
  const out = [];
  const visited = new Set();
  const ringCells = [...ringSet];
  const rayOk = (head, d, own) => {
    let x = (head % W) + DX[d];
    let y = Math.floor(head / W) + DY[d];
    for (; x >= 0 && y >= 0 && x < W && y < H; x += DX[d], y += DY[d]) {
      const i = y * W + x;
      if (occ[i] !== -1 || own.has(i)) return false;
    }
    return true;
  };
  for (const start of ringCells) {
    if (visited.has(start)) continue;
    let cur = start;
    let seg = [cur];
    visited.add(cur);
    let move = -1;
    const target = () => r.int(12, 30);
    let want = target();
    for (;;) {
      const x = cur % W;
      const y = (cur - x) / W;
      // продолжаем прямо, если можно, иначе поворачиваем
      const dirs = move >= 0 ? [move, (move + 1) % 4, (move + 3) % 4] : [0, 1, 2, 3];
      let next = -1;
      let nd = -1;
      for (const d of dirs) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (ringSet.has(j) && !visited.has(j)) { next = j; nd = d; break; }
      }
      if (next === -1 || seg.length >= want) {
        out.push(seg);
        if (next === -1) break;
        seg = [];
        want = target();
      }
      if (next === -1) break;
      visited.add(next);
      seg.push(next);
      cur = next;
      move = nd;
    }
  }
  // Ориентируем: голова — тот конец, чей луч чист (на пустом поле, с учётом уже поставленных)
  const fixed = [];
  for (const seg of out) {
    if (seg.length < 4) continue;
    const own = new Set(seg);
    const variants = r.chance(0.5) ? [seg, seg.slice().reverse()] : [seg.slice().reverse(), seg];
    for (const cells of variants) {
      const n = cells.length;
      const hx = cells[n - 1] % W;
      const px = cells[n - 2] % W;
      const d = hx !== px ? (hx > px ? 1 : 3) : cells[n - 1] > cells[n - 2] ? 2 : 0;
      if (!rayOk(cells[n - 1], d, own)) continue;
      fixed.push({ cells, dir: d });
      for (const c of cells) occ[c] = fixed.length - 1;
      break;
    }
  }
  return fixed;
}

function pictureSpec(p, r) {
  const shapes = SHAPES;
  const kind = p.picture.kind;
  // Узкие фигуры не годятся как маска поля
  let shape = shapes[p.picture.shapeIndex % shapes.length];
  if (kind === 'mask') {
    let k = 0;
    while (shape.aspect < 0.7 && k < shapes.length) shape = shapes[(p.picture.shapeIndex + ++k) % shapes.length];
  }
  let W = p.w;
  let H = p.h;
  let grid;
  if (kind === 'mask') {
    // Поле = силуэт: растягиваем фигуру, пока обрезанный силуэт помещается в предел поля и
    // его площадь не превышает площадь обычного уровня
    grid = crop(rasterize(shape, W, H, 0));
    for (let k = 1.05; k <= 2.5; k += 0.05) {
      const g = crop(rasterize(shape, Math.round(p.w * k), Math.round(p.h * k), 0));
      const area = g.reduce((s, row) => s + row.reduce((a, c) => a + c, 0), 0);
      if (g[0].length > p.maxW || g.length > p.maxH || area > p.w * p.h * 0.8) break;
      grid = g;
    }
    H = grid.length;
    W = grid[0].length;
  } else {
    grid = rasterize(shape, W, H, Math.max(2, Math.round(W * 0.08)));
  }
  const inside = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) inside[y * W + x] = grid[y][x];
  return { shape, kind, W, H, inside };
}

function generateLevel(n, options = {}) {
  const p = profile(n, options);
  const salt = options.salt || 0;
  let W = p.w;
  let H = p.h;
  let allowed = new Uint8Array(W * H).fill(1);
  let region = null;
  let fixed = [];
  let pic = null;
  let mask = null;

  if (p.picture) {
    pic = pictureSpec(p, makeRng(mix(n, 0x51C7, salt)));
    W = pic.W;
    H = pic.H;
    allowed = new Uint8Array(W * H).fill(1);
    if (pic.kind === 'mask') {
      allowed = pic.inside;
      mask = [];
      for (let y = 0; y < H; y++) {
        let row = '';
        for (let x = 0; x < W; x++) row += allowed[y * W + x] ? '#' : '.';
        mask.push(row);
      }
    } else if (pic.kind === 'fill') {
      region = new Int16Array(W * H);
      for (let i = 0; i < W * H; i++) region[i] = pic.inside[i];
    } else if (pic.kind === 'contour') {
      fixed = contourArrows(pic.inside, W, H, makeRng(mix(n, 0xC047, salt)));
    }
    p.lengths.max = H;
  }

  let best = null;
  for (let k = 0; k < p.candidates; k++) {
    const r = makeRng(mix(n, k, 0xA5A5, salt));
    const layout = pic && pic.kind !== 'fill' ? r.pick(['single', 'quad', 'spiral']) : p.layout;
    const field = LAYOUTS[layout](W, H, r, p.mood);
    const res = construct({
      w: W, h: H, allowed, region, fixed,
      flow: field.flow, pot: field.pot, style: p.style, lengths: p.lengths,
    }, r);
    const level = toLevel(n, W, H, mask, res.arrows);
    const m = analyze(level, { frontierRuns: 8 });
    const c = cost(m, p.targets);
    if (!best || c < best.cost) best = { level, metrics: m, cost: c, layout, fixedCount: fixed.length };
  }

  if (options.polish !== false && p.polishIters !== 0) {
    const pr = makeRng(mix(n, 0x9011, salt));
    const res = polish(best.level, p, pr, { region, iters: options.polishIters ?? p.polishIters, cost, keep: best.fixedCount });
    if (res.cost < best.cost) Object.assign(best, res);
  }

  // Раскраска
  const cr = makeRng(mix(n, 0xC010, salt));
  if (pic && pic.kind === 'fill') {
    const inner = pic.shape.color;
    const outer = (inner + 3) % PALETTE_SIZE;
    colorize(best.level, cr, (a) => (pic.inside[a.cells[0][1] * W + a.cells[0][0]] ? inner : outer));
  } else if (pic && pic.kind === 'contour') {
    // В палитрах игры есть пары похожих цветов (0/5, 1/6, 2/7); 3 и 4 различимы в обеих темах.
    // Контур берёт один из них, а для остальных стрелок оба зарезервированы
    const wall = cr.pick([3, 4]);
    colorize(best.level, cr, (a) => (a.id < best.fixedCount ? wall : null), [3, 4]);
  } else {
    colorize(best.level, cr, null);
  }

  best.level.kind = pic ? 'picture' : 'chaos';
  if (pic) best.level.picture = { kind: pic.kind, name: pic.shape.name };
  best.metrics = analyze(best.level);
  return { level: best.level, metrics: best.metrics, profile: p, layout: best.layout };
}

module.exports = { generateLevel, cost, colorize };
