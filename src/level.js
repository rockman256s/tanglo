(function (WG) {
  'use strict';

  // Модель уровня. Не знает про графику и игрока (сердечки считает игра)
  class Board {
    constructor(level) {
      this.w = level.w;
      this.h = level.h;
      this.mask = level.mask ? level.mask.slice() : null;
      this.occ = new Int16Array(this.w * this.h).fill(-1); // -1 = пусто, иначе id стрелки
      this.alive = new Map(); // id → стрелка (ещё не убранная)

      for (const a of level.arrows) {
        const arrow = {
          id: a.id,
          cells: a.cells.map((c) => [c[0], c[1]]),
          dir: a.dir,
          color: a.color,
        };
        this.alive.set(arrow.id, arrow);
        for (const [x, y] of arrow.cells) this.occ[y * this.w + x] = arrow.id;
      }
    }

    inside(x, y) {
      return x >= 0 && y >= 0 && x < this.w && y < this.h;
    }

    allowed(x, y) {
      return this.inside(x, y) && (this.mask === null || this.mask[y][x] === '#');
    }

    arrowAt(x, y) {
      return this.inside(x, y) ? this.occ[y * this.w + x] : -1;
    }

    dirOf(arrow) {
      const n = arrow.cells.length;
      if (n === 1) return arrow.dir;
      const [px, py] = arrow.cells[n - 2];
      const [hx, hy] = arrow.cells[n - 1];
      return WG.dirFromDelta(hx - px, hy - py);
    }

    head(arrow) {
      return arrow.cells[arrow.cells.length - 1];
    }

    // Клетки от головы (не включая её) до края поля
    ray(arrow) {
      const [hx, hy] = this.head(arrow);
      const d = WG.DIRS[this.dirOf(arrow)];
      const out = [];
      for (let x = hx + d.dx, y = hy + d.dy; this.inside(x, y); x += d.dx, y += d.dy) {
        out.push([x, y]);
      }
      return out;
    }

    // Первая чужая клетка на луче: { arrowId, dist } (dist: 1 = сразу перед головой) или null
    firstBlocker(arrow) {
      const ray = this.ray(arrow);
      for (let k = 0; k < ray.length; k++) {
        const [x, y] = ray[k];
        const id = this.occ[y * this.w + x];
        if (id !== -1 && id !== arrow.id) return { arrowId: id, dist: k + 1 };
      }
      return null;
    }

    canExit(arrowId) {
      const arrow = this.alive.get(arrowId);
      return !!arrow && this.firstBlocker(arrow) === null;
    }

    // Главная функция хода. Успех — стрелка удаляется из модели; блок — модель не меняется
    tap(arrowId) {
      const arrow = this.alive.get(arrowId);
      if (!arrow) return null;

      const blocker = this.firstBlocker(arrow);
      if (blocker) {
        return { type: 'blocked', arrowId, blockerId: blocker.arrowId, dist: blocker.dist };
      }

      const rayLen = this.ray(arrow).length;
      for (const [x, y] of arrow.cells) this.occ[y * this.w + x] = -1;
      this.alive.delete(arrowId);
      return { type: 'exit', arrowId, rayLen };
    }

    // Ножницы: убрать стрелку без проверки луча. Возвращает её геометрию или null
    forceRemove(arrowId) {
      const arrow = this.alive.get(arrowId);
      if (!arrow) return null;
      const rayLen = this.ray(arrow).length;
      for (const [x, y] of arrow.cells) this.occ[y * this.w + x] = -1;
      this.alive.delete(arrowId);
      return { cells: arrow.cells, dir: this.dirOf(arrow), color: arrow.color, rayLen };
    }

    isCleared() {
      return this.alive.size === 0;
    }
  }

  function fail(msg) {
    throw new Error('Уровень: ' + msg);
  }

  // Проверка уровня: правила 1–4 структуры + правило 5 — решаемость (через solver, §3.2)
  function validate(level) {
    const { w, h, mask } = level;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
      fail('некорректный размер поля');
    }
    if (mask && (mask.length !== h || mask.some((row) => row.length !== w))) {
      fail('маска не совпадает с размером поля');
    }

    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
    const allowed = (x, y) => inside(x, y) && (!mask || mask[y][x] === '#');
    const owner = new Int16Array(w * h).fill(-1);
    const ids = new Set();

    for (const a of level.arrows) {
      const tag = `стрелка ${a.id}`;
      if (!Number.isInteger(a.id) || a.id < 0) fail(`${tag}: id должен быть целым неотрицательным`);
      if (ids.has(a.id)) fail(`${tag}: id повторяется`);
      ids.add(a.id);
      if (!a.cells || a.cells.length === 0) fail(`${tag}: нет клеток`);
      if (a.cells.length === 1 && !(a.dir in WG.DIRS)) {
        fail(`${tag}: одиночная стрелка должна иметь dir`);
      }

      const cells = a.cells;
      for (let k = 0; k < cells.length; k++) {
        const [x, y] = cells[k];
        if (!inside(x, y)) fail(`${tag}: клетка [${x},${y}] за пределами поля`);
        if (!allowed(x, y)) fail(`${tag}: клетка [${x},${y}] вне маски`);
        if (k > 0) {
          const [px, py] = cells[k - 1];
          if (Math.abs(px - x) + Math.abs(py - y) !== 1) {
            fail(`${tag}: разрыв между [${px},${py}] и [${x},${y}]`);
          }
        }
        const i = y * w + x;
        if (owner[i] === a.id) fail(`${tag}: клетка [${x},${y}] повторяется внутри стрелки`);
        if (owner[i] !== -1) fail(`${tag}: клетка [${x},${y}] занята стрелкой ${owner[i]}`);
        owner[i] = a.id;
      }
    }

    // Луч не должен проходить через собственное тело
    for (const a of level.arrows) {
      const cells = a.cells;
      const n = cells.length;
      const [hx, hy] = cells[n - 1];
      let dir = a.dir;
      if (n > 1) {
        const [px, py] = cells[n - 2];
        dir = WG.dirFromDelta(hx - px, hy - py);
      }
      const d = WG.DIRS[dir];
      for (let x = hx + d.dx, y = hy + d.dy; inside(x, y); x += d.dx, y += d.dy) {
        if (owner[y * w + x] === a.id) {
          fail(`стрелка ${a.id}: луч проходит через её собственное тело`);
        }
      }
    }

    // Правило 5 из §3.2: уровень решаем. Метрики отдаём вызывающему — генератор больше
    // не прогоняет решатель дважды (важно для полей 20×30)
    const metrics = WG.solver.solve(level);
    if (!metrics.solvable) fail('уровень не решаем');
    return metrics;
  }

  WG.level = { Board, validate };

})(window.WG = window.WG || {});
