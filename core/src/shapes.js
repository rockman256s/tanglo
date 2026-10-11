'use strict';

// Силуэты для бонусных уровней-картинок. Каждая фигура — функция inside(u, v) в координатах
// [-1, 1]² (v растёт вниз) и пропорция ширина/высота. Векторное описание растеризуется под любую
// сетку, поэтому одна фигура даёт много уровней разного размера.

const circle = (cx, cy, r) => (u, v) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
const ellipse = (cx, cy, rx, ry, rot = 0) => (u, v) => {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const x = (u - cx) * c + (v - cy) * s;
  const y = -(u - cx) * s + (v - cy) * c;
  return (x / rx) ** 2 + (y / ry) ** 2 <= 1;
};
const box = (x0, y0, x1, y1) => (u, v) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
const poly = (pts) => (u, v) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const union = (...fs) => (u, v) => fs.some((f) => f(u, v));
const minus = (a, ...bs) => (u, v) => a(u, v) && !bs.some((b) => b(u, v));
const ring = (cx, cy, r0, r1) => minus(circle(cx, cy, r1), circle(cx, cy, r0));

function star(n, r0, r1, rot = -Math.PI / 2) {
  const pts = [];
  for (let k = 0; k < n * 2; k++) {
    const r = k % 2 ? r0 : r1;
    const a = rot + (k * Math.PI) / n;
    pts.push([r * Math.cos(a), r * Math.sin(a) + 0.08]);
  }
  return poly(pts);
}

const heart = (u, v) => {
  const x = u * 1.15;
  const y = -v * 1.15 + 0.15;
  return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0;
};

const SHAPES = [
  { name: 'heart', aspect: 1.1, f: heart, color: 0 },
  { name: 'star', aspect: 1.05, f: star(5, 0.42, 1), color: 1 },
  { name: 'ring', aspect: 1, f: ring(0, 0, 0.42, 0.98), color: 3 },
  { name: 'diamond', aspect: 0.75, f: poly([[0, -1], [1, 0], [0, 1], [-1, 0]]), color: 3 },
  { name: 'cross', aspect: 0.7, f: union(box(-0.24, -1, 0.24, 1), box(-1, -0.45, 1, -0.05)), color: 0 },
  { name: 'moon', aspect: 0.85, f: minus(circle(0, 0, 0.98), circle(0.42, -0.18, 0.78)), color: 6 },
  { name: 'drop', aspect: 0.72, f: union(circle(0, 0.35, 0.63), poly([[0, -1], [0.6, 0.22], [-0.6, 0.22]])), color: 3 },
  { name: 'house', aspect: 0.95, f: minus(union(poly([[0, -1], [1, -0.15], [-1, -0.15]]), box(-0.75, -0.2, 0.75, 1)), box(-0.18, 0.4, 0.18, 1)), color: 1 },
  {
    name: 'tree', aspect: 0.72,
    f: union(poly([[0, -1], [0.55, -0.35], [-0.55, -0.35]]), poly([[0, -0.6], [0.8, 0.2], [-0.8, 0.2]]),
      poly([[0, -0.15], [1, 0.72], [-1, 0.72]]), box(-0.16, 0.6, 0.16, 1)),
    color: 7,
  },
  { name: 'fish', aspect: 1.6, f: union(ellipse(-0.18, 0, 0.72, 0.62), poly([[0.4, 0], [1, -0.6], [1, 0.6]])), color: 2 },
  {
    name: 'cat', aspect: 1,
    f: minus(union(circle(0, 0.15, 0.82), poly([[-0.85, -1], [-0.2, -0.55], [-0.75, -0.2]]), poly([[0.85, -1], [0.2, -0.55], [0.75, -0.2]])),
      ellipse(-0.33, 0.05, 0.13, 0.17), ellipse(0.33, 0.05, 0.13, 0.17)),
    color: 1,
  },
  {
    name: 'butterfly', aspect: 1.15,
    f: union(ellipse(-0.5, -0.38, 0.5, 0.58, 0.5), ellipse(0.5, -0.38, 0.5, 0.58, -0.5),
      ellipse(-0.42, 0.5, 0.36, 0.42, -0.4), ellipse(0.42, 0.5, 0.36, 0.42, 0.4), box(-0.09, -0.75, 0.09, 0.9)),
    color: 4,
  },
  {
    name: 'anchor', aspect: 0.85,
    f: union(ring(0, -0.72, 0.12, 0.3), box(-0.1, -0.45, 0.1, 0.92), box(-0.55, -0.32, 0.55, -0.15),
      minus(ring(0, 0.12, 0.66, 0.88), box(-1, -1, 1, 0.12)), poly([[-0.95, 0.05], [-0.62, 0.05], [-0.8, 0.35]]), poly([[0.95, 0.05], [0.62, 0.05], [0.8, 0.35]])),
    color: 3,
  },
  { name: 'bolt', aspect: 0.6, f: poly([[0.15, -1], [-0.8, 0.15], [-0.05, 0.15], [-0.35, 1], [0.8, -0.2], [0.05, -0.2], [0.45, -1]]), color: 6 },
  { name: 'arrow', aspect: 0.75, f: union(poly([[0, -1], [1, -0.05], [-1, -0.05]]), box(-0.38, -0.1, 0.38, 1)), color: 2 },
  { name: 'crown', aspect: 1.25, f: union(poly([[-1, -0.7], [-0.5, -0.05], [0, -0.85], [0.5, -0.05], [1, -0.7], [0.85, 0.55], [-0.85, 0.55]]), box(-0.85, 0.6, 0.85, 0.9)), color: 1 },
  {
    name: 'key', aspect: 0.55,
    f: union(ring(0, -0.6, 0.18, 0.42), box(-0.12, -0.25, 0.12, 1), box(0.1, 0.45, 0.42, 0.6), box(0.1, 0.78, 0.35, 0.95)),
    color: 1,
  },
  { name: 'mushroom', aspect: 1.05, f: union(minus(ellipse(0, -0.05, 1, 0.85), box(-1, -0.05, 1, 1)), box(-0.3, -0.1, 0.3, 1)), color: 0 },
  {
    name: 'clover', aspect: 0.9,
    f: union(circle(0, -0.5, 0.42), circle(-0.45, 0.05, 0.42), circle(0.45, 0.05, 0.42), box(-0.08, 0.1, 0.08, 1)),
    color: 7,
  },
  {
    name: 'spade', aspect: 0.85,
    f: union((u, v) => heart(u, -v + 0.25), poly([[0, 0.2], [0.35, 1], [-0.35, 1]])),
    color: 4,
  },
  {
    name: 'smiley', aspect: 1,
    f: minus(circle(0, 0, 0.98), ellipse(-0.35, -0.3, 0.13, 0.2), ellipse(0.35, -0.3, 0.13, 0.2),
      minus(ring(0, 0.05, 0.42, 0.6), box(-1, -1, 1, 0.2))),
    color: 6,
  },
  {
    name: 'rocket', aspect: 0.6,
    f: union(ellipse(0, -0.1, 0.42, 0.9), poly([[-0.4, 0.25], [-0.85, 0.95], [-0.25, 0.75]]), poly([[0.4, 0.25], [0.85, 0.95], [0.25, 0.75]])),
    color: 0,
  },
  { name: 'umbrella', aspect: 1.1, f: union(minus(ellipse(0, -0.1, 1, 0.85), box(-1, -0.05, 1, 1)), box(-0.07, -0.1, 0.07, 0.85), minus(ring(0.22, 0.85, 0.08, 0.29), box(-1, -1, 1, 0.85))), color: 4 },
  { name: 'hourglass', aspect: 0.7, f: union(poly([[-1, -1], [1, -1], [0.12, 0], [-0.12, 0]]), poly([[-0.12, 0], [0.12, 0], [1, 1], [-1, 1]])), color: 1 },
  {
    name: 'flower', aspect: 0.85,
    f: union(...[0, 1, 2, 3, 4].map((k) => circle(0.42 * Math.cos(-Math.PI / 2 + (k * 2 * Math.PI) / 5), -0.25 + 0.42 * Math.sin(-Math.PI / 2 + (k * 2 * Math.PI) / 5), 0.3)),
      box(-0.07, 0.1, 0.07, 1), ellipse(0.3, 0.68, 0.25, 0.1, -0.5)),
    color: 5,
  },
  { name: 'bell', aspect: 0.9, f: union(minus(ellipse(0, 0.15, 0.62, 1.05), box(-1, 0.65, 1, 2)), box(-0.95, 0.6, 0.95, 0.78), circle(0, 0.85, 0.15)), color: 1 },
];

// Растеризация в маску W×H (строки из '#' и '.'). Фигура вписывается с полем margin клеток.
// Тонкие места (одна клетка) убираем: в них не уложится ни стрелка, ни контур
function rasterize(shape, W, H, margin = 0) {
  const iw = W - margin * 2;
  const ih = H - margin * 2;
  // вписываем квадрат [-1,1]² с учётом пропорции фигуры
  let sw = iw;
  let sh = iw / shape.aspect;
  if (sh > ih) { sh = ih; sw = ih * shape.aspect; }
  const ox = (W - sw) / 2;
  const oy = (H - sh) / 2;
  const grid = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      const u = ((x + 0.5 - ox) / sw) * 2 - 1;
      const v = ((y + 0.5 - oy) / sh) * 2 - 1;
      row.push(u >= -1 && u <= 1 && v >= -1 && v <= 1 && shape.f(u, v) ? 1 : 0);
    }
    grid.push(row);
  }
  // Морфологическая чистка: клетка с <2 соседями внутри фигуры — шум растеризации
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!grid[y][x]) continue;
        let n = 0;
        if (x > 0 && grid[y][x - 1]) n++;
        if (x < W - 1 && grid[y][x + 1]) n++;
        if (y > 0 && grid[y - 1][x]) n++;
        if (y < H - 1 && grid[y + 1][x]) n++;
        if (n < 2) grid[y][x] = 0;
      }
    }
  }
  return grid;
}

// Обрезать пустые поля вокруг маски (для типа «маска поля»: поле = силуэт)
function crop(grid) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  grid.forEach((row, y) => row.forEach((c, x) => {
    if (c) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }));
  return grid.slice(y0, y1 + 1).map((row) => row.slice(x0, x1 + 1));
}

module.exports = { SHAPES, rasterize, crop };
