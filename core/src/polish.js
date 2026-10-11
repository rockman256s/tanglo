'use strict';

// Полировка (поиск с большой окрестностью): вырезаем окно, убираем все стрелки, задевающие его,
// перезаполняем освободившиеся клетки новыми путями со случайными головами. Принимаем, если
// уровень остался решаемым и цена (расстояние до целей профиля) не выросла.
// Первые `keep` стрелок (контур картинки) не трогаем.

const { analyze, dependencies, waves, DX, DY } = require('./metrics');

function polish(level, p, r, { region, iters, cost, keep = 0 }) {
  const { w: W, h: H } = level;
  const allowed = new Uint8Array(W * H).fill(1);
  if (level.mask) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) allowed[y * W + x] = level.mask[y][x] === '#' ? 1 : 0;
  }
  let arrows = level.arrows.map((a) => a.cells.map(([x, y]) => y * W + x));
  const make = (list) => ({ ...level, arrows: list.map((cells, i) => ({ id: i, cells: cells.map((c) => [c % W, (c - (c % W)) / W]), color: 0 })) });

  let curLevel = make(arrows);
  let curM = analyze(curLevel, { frontierRuns: 8 });
  let curCost = cost(curM, p.targets);
  let wave = waves(dependencies(curLevel).waits).wave;

  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  // Разбить множество клеток S на пути. Правило Варнсдорфа (сначала клетки с меньшим числом
  // свободных соседей) — чтобы не оставлять одиночек
  function partition(S) {
    const free = new Set(S);
    const deg = (i) => {
      const x = i % W;
      const y = (i - x) / W;
      let k = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (!inside(nx, ny)) continue;
        const j = ny * W + nx;
        if (free.has(j) && (!region || region[j] === region[i])) k++;
      }
      return k;
    };
    const paths = [];
    while (free.size) {
      // старт — клетка с минимальной степенью
      let start = -1;
      let sd = 9;
      for (const c of free) {
        const k = deg(c) + r.next() * 0.5;
        if (k < sd) { sd = k; start = c; }
      }
      const path = [start];
      free.delete(start);
      const L = r.chance(p.lengths.stub) ? 2 : Math.max(3, Math.round(Math.exp(p.lengths.mu + p.lengths.sigma * (r.next() * 2 - 1))));
      let cur = start;
      let move = -1;
      while (path.length < L) {
        const x = cur % W;
        const y = (cur - x) / W;
        const opts = [];
        const wts = [];
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (!inside(nx, ny)) continue;
          const j = ny * W + nx;
          if (!free.has(j) || (region && region[j] !== region[cur])) continue;
          opts.push(j);
          const straight = d === move ? 1 : 0;
          wts.push((1 + straight * 0.5) / (1 + deg(j)) ** 2);
        }
        const k = r.weighted(wts);
        if (k < 0) break;
        const next = opts[k];
        const nx = next % W;
        move = nx !== x ? (nx > x ? 1 : 3) : next > cur ? 2 : 0;
        path.push(next);
        free.delete(next);
        cur = next;
      }
      paths.push(path);
    }
    return paths;
  }

  // Направление головы и проверка «луч не через своё тело»
  const headOk = (cells) => {
    const n = cells.length;
    const h = cells[n - 1];
    const q = cells[n - 2];
    const hx = h % W;
    const qx = q % W;
    const d = hx !== qx ? (hx > qx ? 1 : 3) : h > q ? 2 : 0;
    const own = new Set(cells);
    for (let x = hx + DX[d], y = (h - hx) / W + DY[d]; inside(x, y); x += DX[d], y += DY[d]) {
      if (own.has(y * W + x)) return false;
    }
    return true;
  };

  let accepted = 0;
  const stat = { empty: 0, big: 0, unsolvable: 0, worse: 0 };
  for (let it = 0; it < iters; it++) {
    // Окно вокруг случайной клетки
    const owner = new Int32Array(W * H).fill(-1);
    arrows.forEach((cells, i) => { for (const c of cells) owner[c] = i; });
    // Половина окон — вокруг головы стрелки, свободной на старте (их и надо «закрывать»)
    let cx = r.int(0, W - 1);
    let cy = r.int(0, H - 1);
    if (r.chance(0.5)) {
      const freeIdx = [];
      wave.forEach((v, i) => { if (v === 0 && i >= keep) freeIdx.push(i); });
      if (freeIdx.length) {
        const cells = arrows[r.pick(freeIdx)];
        const h = cells[cells.length - 1];
        cx = h % W;
        cy = (h - cx) / W;
      }
    }
    const rad = r.int(2, 3);
    const hit = new Set();
    for (let y = cy - rad; y <= cy + rad; y++) {
      for (let x = cx - rad; x <= cx + rad; x++) {
        if (!inside(x, y)) continue;
        const o = owner[y * W + x];
        if (o >= keep) hit.add(o);
      }
    }
    if (!hit.size) { stat.empty++; continue; }
    const S = [];
    for (const o of hit) for (const c of arrows[o].cells ?? arrows[o]) S.push(c);
    // плюс пустые клетки окна
    for (let y = cy - rad; y <= cy + rad; y++) {
      for (let x = cx - rad; x <= cx + rad; x++) {
        if (inside(x, y) && allowed[y * W + x] && owner[y * W + x] === -1) S.push(y * W + x);
      }
    }
    if (S.length > 90) { stat.big++; continue; }

    const restIdx = [];
    arrows.forEach((_, i) => { if (!hit.has(i)) restIdx.push(i); });
    const rest = restIdx.map((i) => arrows[i]);
    // Порядок снятия: волна текущего решения. Для оставшихся стрелок он остаётся корректным
    const Sset = new Set(S);
    const waiters = new Map(); // клетка из S → минимальная волна стрелок, чей луч через неё идёт
    for (const i of restIdx) {
      const cells = arrows[i];
      const n = cells.length;
      const h = cells[n - 1];
      const q = cells[n - 2];
      const hx = h % W;
      const qx = q % W;
      const d = hx !== qx ? (hx > qx ? 1 : 3) : h > q ? 2 : 0;
      for (let x = hx + DX[d], y = (h - hx) / W + DY[d]; inside(x, y); x += DX[d], y += DY[d]) {
        const c = y * W + x;
        if (Sset.has(c)) {
          const prev = waiters.get(c);
          if (prev === undefined || wave[i] < prev) waiters.set(c, wave[i]);
        }
      }
    }
    // Окно ориентации: снять позже всех на луче (lo) и раньше всех, кто ждёт тело (hi)
    const orient = (cells) => {
      if (!headOk(cells)) return null;
      const n = cells.length;
      const h = cells[n - 1];
      const q = cells[n - 2];
      const hx = h % W;
      const qx = q % W;
      const d = hx !== qx ? (hx > qx ? 1 : 3) : h > q ? 2 : 0;
      let lo = -1;
      for (let x = hx + DX[d], y = (h - hx) / W + DY[d]; inside(x, y); x += DX[d], y += DY[d]) {
        const o = owner[y * W + x];
        if (o !== -1 && !hit.has(o) && wave[o] > lo) lo = wave[o];
      }
      let hi = Infinity;
      for (const c of cells) {
        const wv = waiters.get(c);
        if (wv !== undefined && wv < hi) hi = wv;
      }
      return lo < hi ? lo : null;
    };
    const place = (path, out) => {
      if (path.length < 2) return;
      const a = path;
      const b = path.slice().reverse();
      const la = orient(a);
      const lb = orient(b);
      if (la !== null && lb !== null) out.push(r.chance(0.5) ? a : b);
      else if (la !== null) out.push(a);
      else if (lb !== null) out.push(b);
      else if (path.length >= 4) {
        const mid = r.int(2, path.length - 2);
        place(path.slice(0, mid), out);
        place(path.slice(mid), out);
      }
    };

    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      const paths = partition(S);
      const fresh = [];
      for (const path of paths) place(path, fresh);
      const cand = rest.concat(fresh);
      const lvl = make(cand);
      const { waits } = dependencies(lvl);
      const wv = waves(waits);
      if (!wv.solvable) { stat.unsolvable++; continue; }
      const m = analyze(lvl, { frontierRuns: 8 });
      const c = cost(m, p.targets);
      if (c <= curCost) {
        // контурные стрелки остаются первыми
        arrows = cand;
        wave = wv.wave;
        curLevel = lvl;
        curM = m;
        curCost = c;
        accepted++;
      } else stat.worse++;
      done = true;
    }
  }
  return { level: curLevel, metrics: curM, cost: curCost, accepted, stat };
}

module.exports = { polish };
