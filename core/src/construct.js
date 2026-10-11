'use strict';

// Обратное построение уровня.
//
// Стрелки ставятся в порядке, обратном порядку снятия: каждая новая снимается раньше всех
// уже стоящих. Значит, в момент постановки её луч должен быть пуст до края поля, а тело
// может лежать на лучах уже стоящих стрелок (они просто будут ждать новую). Инвариант
// «перевёрнутый порядок постановки — корректный порядок снятия» держится на каждом шаге,
// поэтому уровень решаем по построению, без починки циклов.
//
// Сложность задаётся тем, КАК выбирается каждая следующая стрелка:
//   - поле потока (веса направлений по клеткам) и потенциал (что заполнять раньше);
//   - стиль тела: лестница, гребёнка, спираль, прямые;
//   - «прижимание» к уже занятому (плотная упаковка, параллельные линии);
//   - перекрытие чужих лучей — тело ставится поперёк лучей, удлиняя цепочки ожидания.

const { DX, DY } = require('./metrics');

const LEFT = [3, 0, 1, 2]; // поворот налево от направления движения
const RIGHT = [1, 2, 3, 0];

function construct(spec, rng) {
  const { w: W, h: H } = spec;
  const N = W * H;
  const allowed = spec.allowed; // Uint8Array: 1 — клетка поля
  const region = spec.region; // Int16Array | null: тело не пересекает границу регионов
  const flow = spec.flow; // Float32Array(N*4): веса направлений головы
  const pot = spec.pot; // Float32Array(N): 0..1, чем больше — тем раньше ставим голову
  const st = spec.style;

  const occ = new Int32Array(N).fill(-1);
  const rayOwners = Array.from({ length: N }, () => []); // id стрелок, чей луч идёт через клетку
  const arrows = []; // { cells: [idx…] от хвоста к голове, dir, u }
  // «Открытые» стрелки: на их луче пока нет ни одной поставленной позже. В конце это ровно
  // те стрелки, которые свободны на старте уровня
  const open = new Set();

  // Пустые клетки — плотный массив с O(1) удалением
  const empties = [];
  const pos = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (allowed[i]) { pos[i] = empties.length; empties.push(i); }
  }
  const takeEmpty = (i) => {
    const k = pos[i];
    const last = empties.pop();
    if (last !== i) { empties[k] = last; pos[last] = k; }
    pos[i] = -1;
  };

  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const free = (i) => allowed[i] === 1 && occ[i] === -1;

  // Сколько соседей клетки «закрыто»: край, дыра маски, занятая клетка или граница региона
  const closedAround = (i, bodySet) => {
    const x = i % W;
    const y = (i - x) / W;
    let c = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (!inside(nx, ny)) { c++; continue; }
      const j = ny * W + nx;
      if (!free(j) || (bodySet && bodySet.has(j)) || (region && region[j] !== region[i])) c++;
    }
    return c;
  };

  // Сколько соседей занято стрелками (край поля не считается — к краю голову не тянем)
  const occupiedAround = (i) => {
    const x = i % W;
    const y = (i - x) / W;
    let c = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (inside(nx, ny) && occ[ny * W + nx] !== -1) c++;
    }
    return c;
  };

  const place = (cells, dir) => {
    const id = arrows.length;
    let u = 1;
    for (const i of cells) {
      occ[i] = id;
      takeEmpty(i);
      for (const o of rayOwners[i]) {
        if (arrows[o].u + 1 > u) u = arrows[o].u + 1;
        open.delete(o);
      }
    }
    open.add(id);
    const hi = cells[cells.length - 1];
    const hx = hi % W;
    const hy = (hi - hx) / W;
    for (let nx = hx + DX[dir], ny = hy + DY[dir]; inside(nx, ny); nx += DX[dir], ny += DY[dir]) {
      rayOwners[ny * W + nx].push(id);
    }
    arrows.push({ cells, dir, u });
    return id;
  };

  // Заранее заданные стрелки (контур картинки) — ставятся первыми, снимаются последними
  for (const f of spec.fixed || []) place(f.cells, f.dir);
  const nFixed = arrows.length; // их форма — это рисунок, заливка дыр их не трогает

  // Растим тело назад от головы. Возвращает массив клеток от хвоста к голове или null
  function grow(head, dir, target) {
    const hx = head % W;
    const hy = (head - hx) / W;
    const bx = hx - DX[dir];
    const by = hy - DY[dir];
    if (!inside(bx, by)) return null;
    const b1 = by * W + bx;
    if (!free(b1) || (region && region[b1] !== region[head])) return null;

    // Клетка лежит на собственном луче — запрещено правилами игры
    const onOwnRay = (x, y) => (DX[dir] !== 0
      ? y === hy && (x - hx) * DX[dir] > 0
      : x === hx && (y - hy) * DY[dir] > 0);

    const body = [head, b1];
    const set = new Set(body);
    let cx = bx;
    let cy = by;
    let move = (dir + 2) % 4; // идём от головы к хвосту
    let lastTurn = 0; // -1 налево, +1 направо
    let run = 1;

    // Стиль конкретной стрелки: базовая вероятность поворота и предпочтение знака поворота
    const turnP = st.turnProb[0] + rng.next() * (st.turnProb[1] - st.turnProb[0]);
    const alt = rng.next() < st.zigzag ? 1 : rng.next() < st.spiral ? -1 : 0; // 1 — чередовать, -1 — крутить

    while (body.length < target) {
      const opts = [move, LEFT[move], RIGHT[move]];
      const wts = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const d = opts[k];
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (!inside(nx, ny)) continue;
        const j = ny * W + nx;
        if (!free(j) || set.has(j) || onOwnRay(nx, ny)) continue;
        if (region && region[j] !== region[head]) continue;

        let wgt;
        if (k === 0) {
          wgt = 1 - turnP;
          if (run >= st.maxRun) wgt *= 0.05;
        } else {
          wgt = turnP / 2;
          const sign = k === 1 ? -1 : 1;
          if (alt === 1 && lastTurn !== 0) wgt *= sign === -lastTurn ? 2.5 : 0.4;
          if (alt === -1 && lastTurn !== 0) wgt *= sign === lastTurn ? 2.5 : 0.4;
        }
        // Прижимание: плотная упаковка без дыр и длинные параллели
        wgt *= 1 + st.hug * closedAround(j, set);
        // Перекрываем чужие лучи — растут цепочки ожидания
        if (rayOwners[j].length) wgt *= 1 + st.block;
        // Спасение: клетка, у которой почти не осталось чистых лучей, — забираем сейчас
        if (clearCount[j] <= 1) wgt *= 1 + st.rescue * (2 - clearCount[j]);
        // Не оставляем за собой изолированную пустую клетку
        for (let e = 0; e < 4; e++) {
          const ex = nx + DX[e];
          const ey = ny + DY[e];
          if (!inside(ex, ey)) continue;
          const q = ey * W + ex;
          if (q === cy * W + cx || !free(q) || set.has(q)) continue;
          if (closedAround(q, set) >= 3) wgt *= st.pocket;
        }
        wts[k] = wgt;
      }
      const k = rng.weighted(wts);
      if (k < 0) break;
      const d = opts[k];
      if (d === move) run++;
      else { lastTurn = k === 1 ? -1 : 1; run = 1; }
      move = d;
      cx += DX[d];
      cy += DY[d];
      const j = cy * W + cx;
      body.push(j);
      set.add(j);
    }
    return body.reverse(); // от хвоста к голове
  }

  function sampleLength() {
    const L = spec.lengths;
    if (rng.next() < L.stub) return 2;
    // Тяжёлый хвост: логнормальное распределение с обрезкой
    const g = Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
    return Math.max(3, Math.min(L.max, Math.round(Math.exp(L.mu + L.sigma * g))));
  }

  // Сколько пустых клеток потеряют последний чистый луч, если поставить эти клетки
  const lost = new Uint8Array(N);
  const touched = [];
  function kills(cells) {
    const inBody = new Set(cells);
    for (const s0 of cells) {
      const sx = s0 % W;
      const sy = (s0 - sx) / W;
      for (let d = 0; d < 4; d++) {
        // клетки e, у которых s0 лежит на луче d: идём от s0 против d
        for (let ex = sx - DX[d], ey = sy - DY[d]; inside(ex, ey); ex -= DX[d], ey -= DY[d]) {
          const e = ey * W + ex;
          if (occ[e] !== -1) break;
          if (inBody.has(e) || !allowed[e] || !clear[e * 4 + d]) continue;
          if (!lost[e]) touched.push(e);
          lost[e] |= 1 << d;
        }
      }
    }
    let k = 0;
    for (const e of touched) {
      let left = 0;
      for (let d = 0; d < 4; d++) if (clear[e * 4 + d] && !(lost[e] & (1 << d))) left++;
      if (left === 0) k++;
      lost[e] = 0;
    }
    touched.length = 0;
    return k;
  }

  // Оценка кандидата: глубина цепочки, закрытые «открытые» лучи, плотность, потенциал, убитые клетки
  function score(cells, head) {
    let u = 1;
    const blocked = new Set();
    let closes = 0;
    let closed = 0;
    for (const i of cells) {
      for (const o of rayOwners[i]) {
        if (blocked.has(o)) continue;
        blocked.add(o);
        if (open.has(o)) closes++;
        if (arrows[o].u + 1 > u) u = arrows[o].u + 1;
      }
      closed += closedAround(i, null);
    }
    return st.wDepth * u
      + st.wClose * Math.min(closes, st.closeCap)
      + st.wBlock * Math.min(blocked.size, 12)
      + st.wHug * closed / cells.length
      + st.wPot * pot[head] * 10
      - st.wKill * kills(cells)
      + st.noise * rng.next() * 10;
  }

  // Для всех клеток и направлений: чист ли луч до края. Один проход от каждого края — O(N)
  const clear = new Uint8Array(N * 4);
  const clearCount = new Uint8Array(N);
  function computeClear() {
    clear.fill(0);
    clearCount.fill(0);
    for (let d = 0; d < 4; d++) {
      // Идём навстречу направлению d от края, на котором луч заканчивается
      const lines = DX[d] !== 0 ? H : W;
      const len = DX[d] !== 0 ? W : H;
      for (let l = 0; l < lines; l++) {
        let ok = true;
        for (let k = 0; k < len; k++) {
          // k = 0 — клетка у края, куда смотрит d
          let x;
          let y;
          if (d === 0) { x = l; y = k; } else if (d === 2) { x = l; y = H - 1 - k; } else if (d === 1) { y = l; x = W - 1 - k; } else { y = l; x = k; }
          const i = y * W + x;
          if (ok && occ[i] === -1 && allowed[i]) { clear[i * 4 + d] = 1; clearCount[i]++; }
          if (occ[i] !== -1) ok = false;
        }
      }
    }
  }

  // Целевые доли направлений = средние веса поля потока по клеткам
  const dirTarget = [0, 0, 0, 0];
  {
    let tot = 0;
    for (let i = 0; i < N; i++) {
      if (!allowed[i]) continue;
      let s = 0;
      for (let d = 0; d < 4; d++) s += flow[i * 4 + d];
      if (s <= 0) continue;
      for (let d = 0; d < 4; d++) dirTarget[d] += flow[i * 4 + d] / s;
      tot++;
    }
    for (let d = 0; d < 4; d++) dirTarget[d] /= Math.max(1, tot);
  }
  const dirCount = [0, 0, 0, 0];
  for (const a of arrows) dirCount[a.dir]++;

  // Длина луча (клеток до края) — голова у края, смотрящая наружу, свободна всегда
  const rayLen = (x, y, d) => (d === 0 ? y : d === 1 ? W - 1 - x : d === 2 ? H - 1 - y : x);

  // Основной цикл: все допустимые (голова, направление) → K по весам → лучший по оценке
  const candC = [];
  const candD = [];
  const candW = [];
  const candR = [];
  for (;;) {
    computeClear();
    candC.length = 0; candD.length = 0; candW.length = 0; candR.length = 0;
    let maxPot = 0;
    for (const c of empties) if (pot[c] > maxPot) maxPot = pot[c];
    // Коррекция: направление, которое уже перебрало свою долю, ослабляем
    const total = arrows.length;
    const corr = [1, 1, 1, 1];
    if (total >= 8) {
      for (let d = 0; d < 4; d++) {
        const r = (dirTarget[d] + 0.02) / (dirCount[d] / total + 0.02);
        corr[d] = Math.min(4, Math.max(0.25, r)) ** st.dirFix;
      }
    }
    for (const c of empties) {
      const x = c % W;
      const y = (c - x) / W;
      // Фронт: чем дальше клетка «вниз по потоку» от текущего фронта, тем меньше вес
      const base = Math.exp(st.beta * (pot[c] - maxPot)) * (1 + st.frontier * occupiedAround(c));
      for (let d = 0; d < 4; d++) {
        if (!clear[c * 4 + d]) continue;
        const f = flow[c * 4 + d];
        if (f <= 0) continue;
        const bx = x - DX[d];
        const by = y - DY[d];
        if (!inside(bx, by) || !free(by * W + bx)) continue;
        if (region && region[by * W + bx] !== region[c]) continue;
        const rl = rayLen(x, y, d);
        const short = rl >= st.shortRay.length ? 1 : st.shortRay[rl];
        candC.push(c); candD.push(d); candW.push(base * f * corr[d] * short);
        candR.push(rl);
      }
    }
    if (!candC.length) break;
    // Голова у края наружу (луч 0) свободна всегда — только если других вариантов нет
    if (candR.some((r) => r > 0)) {
      for (let k = 0; k < candW.length; k++) if (candR[k] === 0) candW[k] = 0;
    }

    const target = sampleLength();
    let best = null;
    let bestScore = -Infinity;
    for (let t = 0; t < st.sample; t++) {
      const k = rng.weighted(candW);
      const cells = grow(candC[k], candD[k], target);
      if (!cells) continue;
      const s = score(cells, candC[k]);
      if (s > bestScore) { bestScore = s; best = { cells, dir: candD[k] }; }
    }
    if (!best) break;
    place(best.cells, best.dir);
    dirCount[best.dir]++;
  }

  // Дыры. Клетку c можно отдать стрелке X, если через c не идёт луч стрелки, поставленной
  // ПОСЛЕ X (её луч в момент постановки был пуст), и c не лежит на луче самой X
  const canTake = (c, o) => o >= nFixed && !rayOwners[c].some((r) => r >= o) && (!region || region[c] === region[arrows[o].cells[0]]);
  const give = (c, o) => {
    occ[c] = o;
    takeEmpty(c);
    for (const r of rayOwners[c]) open.delete(r);
  };

  let changed = true;
  while (changed && empties.length) {
    changed = false;
    // а) хвост дорастает в соседнюю пустую клетку
    for (const c of empties.slice()) {
      if (!free(c)) continue;
      const x = c % W;
      const y = (c - x) / W;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (!inside(nx, ny)) continue;
        const o = occ[ny * W + nx];
        if (o === -1 || arrows[o].cells[0] !== ny * W + nx || !canTake(c, o)) continue;
        arrows[o].cells.unshift(c);
        give(c, o);
        changed = true;
        break;
      }
    }
    // б) петля: ребро тела p–q и две пустые клетки a–b рядом (квадрат 2×2) → p–a–b–q.
    //    Последнее ребро (в голову) не трогаем — иначе сменится направление стрелки
    for (const a of empties.slice()) {
      if (!free(a)) continue;
      const ax = a % W;
      const ay = (a - ax) / W;
      let done = false;
      for (let d = 0; d < 4 && !done; d++) {
        const bx = ax + DX[d];
        const by = ay + DY[d];
        if (!inside(bx, by)) continue;
        const b = by * W + bx;
        if (!free(b)) continue;
        for (const side of [LEFT[d], RIGHT[d]]) {
          const px = ax + DX[side];
          const py = ay + DY[side];
          const qx = bx + DX[side];
          const qy = by + DY[side];
          if (!inside(px, py) || !inside(qx, qy)) continue;
          const p = py * W + px;
          const q = qy * W + qx;
          const o = occ[p];
          if (o === -1 || occ[q] !== o) continue;
          const cells = arrows[o].cells;
          const ip = cells.indexOf(p);
          const iq = cells.indexOf(q);
          if (Math.abs(ip - iq) !== 1) continue;
          const lo = Math.min(ip, iq);
          if (lo + 1 === cells.length - 1) continue; // ребро в голову
          if (!canTake(a, o) || !canTake(b, o)) continue;
          // вставляем между lo и lo+1 в правильном порядке
          const first = cells[lo] === p ? a : b;
          const second = first === a ? b : a;
          cells.splice(lo + 1, 0, first, second);
          give(a, o);
          give(b, o);
          changed = true;
          done = true;
          break;
        }
      }
    }
  }

  return { arrows, empty: empties.length };
}

module.exports = { construct };
