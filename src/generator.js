(function (WG) {
  'use strict';

  const DIR_LIST = ['U', 'R', 'D', 'L'];
  const OPP = { U: 'D', D: 'U', L: 'R', R: 'L' };
  const PERP = { U: ['L', 'R'], D: ['L', 'R'], L: ['U', 'D'], R: ['U', 'D'] };

  const key = (x, y) => x + ',' + y;

  function makeState(params) {
    const mask = params.mask || null;
    const w = mask ? mask[0].length : params.w;
    const h = mask ? mask.length : params.h;
    let allowedCount = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask || mask[y][x] === '#') allowedCount++;
      }
    }
    return {
      w,
      h,
      mask,
      occ: new Int16Array(w * h).fill(-1),
      arrows: [],
      allowedCount,
      filled: 0,
    };
  }

  function inside(st, x, y) {
    return x >= 0 && y >= 0 && x < st.w && y < st.h;
  }

  function freeAt(st, x, y) {
    return inside(st, x, y) && (!st.mask || st.mask[y][x] === '#') && st.occ[y * st.w + x] === -1;
  }

  // Клетки от (x,y) по dir до края поля, не включая стартовую
  function rayCells(st, x, y, dir) {
    const d = WG.DIRS[dir];
    const out = [];
    for (let cx = x + d.dx, cy = y + d.dy; inside(st, cx, cy); cx += d.dx, cy += d.dy) {
      out.push([cx, cy]);
    }
    return out;
  }

  function coverage(st) {
    return st.filled / st.allowedCount;
  }

  // headableCells заменил randomFreeCell: без свободного луча клетка не годится в голову имплицитно

  // Свободные клетки, из которых виден хотя бы один луч без чужих клеток (IMP B1.7):
  // только такие позиции могут стать головой — это «пилинг» лабиринта от краёв в центр
  function headableCells(st) {
    const out = [];
    for (let y = 0; y < st.h; y++) {
      for (let x = 0; x < st.w; x++) {
        if (!freeAt(st, x, y)) continue;
        for (const dir of DIR_LIST) {
          if (rayCells(st, x, y, dir).every(([rx, ry]) => st.occ[ry * st.w + rx] === -1)) {
            out.push([x, y]);
            break;
          }
        }
      }
    }
    return out;
  }

  // Свободные клетки, лежащие на чьём-то луче: постановка сюда = блокировка (IMP B1.6)
  function rayCoveredFreeCells(st) {
    const seen = new Set();
    const out = [];
    for (const a of st.arrows) {
      const [hx, hy] = a.cells[a.cells.length - 1];
      for (const [x, y] of rayCells(st, hx, hy, a.dir)) {
        const k = key(x, y);
        if (!seen.has(k) && freeAt(st, x, y)) {
          seen.add(k);
          out.push([x, y]);
        }
      }
    }
    return out;
  }

  // Один кандидат стрелки строится от головы назад (см. раздел 5.3 плана).
  // forceHead — принудительная голова (резерв для цепочного строительства)
  function tryMakeArrow(st, params, rng, forceHead) {
    let head = forceHead || null;
    if (!head) {
    // IMP B1.6/B1.7: позиции головы — только в доступных для выхода клетках
    // (иначе кандидат заведомо не помещается), и чаще — на чужом луче
    const rayBias = params.rayBias === undefined ? 0.75 : params.rayBias;
    const headable = headableCells(st);
    if (!headable.length) return null;
    const onRay = rng.chance(rayBias)
      ? rayCoveredFreeCells(st).filter(([x, y]) => headable.some(([hx2, hy2]) => hx2 === x && hy2 === y))
      : [];
    head = onRay.length ? rng.pick(onRay) : rng.pick(headable);
    }
    if (!head) return null;
    const [hx, hy] = head;
    // Референс (карта стрелок): ~30% — извилистые змейки (3+ поворотов),
    // остальные — прямые или крючки. Двухмодальный набор (IMP B1.6)
    const serpentChance = params.serpentChance === undefined ? 0.3 : params.serpentChance;
    const serpent = rng.chance(serpentChance);

    // Референс: головы смотрят внутрь поля. Вылет за край (луч 0) — вечная «тыкалка».
    // Но и слишком длинный луч вреден (ломает плотность укладки): сладкая точка ~4 клетки —
    // коридор потом разберут «поезда стражей» (blockFreeArrows)
    let bestCand = null;
    let bestRay = -Infinity; // любой валидный dir должен уметь выиграть (не только ray=4)
    for (const dir of rng.shuffle(DIR_LIST.slice())) {
      const ray = rayCells(st, hx, hy, dir);
      // Вылет за край (луч 0) — вечная «тыкалка», запрещён: пусть фаза застревает,
      // хвост поля добьют ремонт и добивка (IMP B1.8)
      if (ray.length === 0) continue;
      if (ray.some(([x, y]) => st.occ[y * st.w + x] !== -1)) continue;
      const rayScore = -Math.abs(ray.length - 4);

      const d = WG.DIRS[dir];
      const nx = hx - d.dx;
      const ny = hy - d.dy;
      if (!freeAt(st, nx, ny)) continue;

      const rayKeys = new Set(ray.map(([x, y]) => key(x, y)));
      const bodyKeys = new Set([key(hx, hy), key(nx, ny)]);
      const body = [[hx, hy], [nx, ny]];
      // Референс: двухмодальный набор (IMP B1.8b) — «герои» максимальной длины —
      // всегда зигзагом (плетёнка, а не полосы), остальные — обычной длины
      const hero = serpent && rng.chance(0.55);
      const targetLen = hero ? params.maxLen : Math.max(2, rng.int(params.minLen, params.maxLen));

      // Тугой зигзаг (текстура референса): поворот каждые 1–2 клетки, стороны чередуются
      let sinceTurn = 0;
      const zigPeriod = 1 + rng.int(0, 1);
      let zigSide = rng.int(0, 1);

      // Растём назад от головы; growDir — направление последнего шага
      let cur = [nx, ny];
      let growDir = OPP[dir];
      let bendCount = 0;
      while (body.length < targetLen) {
        let order;
        if (serpent && sinceTurn >= zigPeriod) {
          const p = PERP[growDir];
          order = [p[zigSide], p[1 - zigSide], growDir];
          zigSide = 1 - zigSide;
          sinceTurn = 0;
        } else {
          const perp = rng.shuffle(PERP[growDir].slice());
          const tc = serpent ? Math.min(0.65, params.turnChance + 0.35) : params.turnChance;
          order = rng.chance(tc)
            ? [...perp, growDir]
            : [growDir, ...perp];
          sinceTurn++;
        }

        let next = null;
        let nextDir = null;
        for (const nd of order) {
          const cx = cur[0] + WG.DIRS[nd].dx;
          const cy = cur[1] + WG.DIRS[nd].dy;
          const k = key(cx, cy);
          if (freeAt(st, cx, cy) && !bodyKeys.has(k) && !rayKeys.has(k)) {
            next = [cx, cy];
            nextDir = nd;
            break;
          }
        }
        if (!next) break;

        body.push(next);
        bodyKeys.add(key(next[0], next[1]));
        if (nextDir !== growDir) bendCount++;
        cur = next;
        growDir = nextDir;
      }

      if (body.length < params.minLen) continue;
      if (rayScore > bestRay) {
        bestRay = rayScore;
        bestCand = { cells: body.reverse(), dir, turns: bendCount, rayLen: ray.length };
      }
    }
    return bestCand;
  }

  // Оценка «вплетения» новой стрелки в лабиринт (IMP B1.6):
  // цепочки блокировок (не ноль → не «отдельная доминошка», не веер 5+ → не «всё на одной»),
  // теснота примыкания к занятым клеткам, змейчатость, длина
  function interlockScore(st, cand, rng) {
    const keys = new Set(cand.cells.map(([x, y]) => key(x, y)));
    let blocked = 0;
    for (const a of st.arrows) {
      const [hx, hy] = a.cells[a.cells.length - 1];
      if (rayCells(st, hx, hy, a.dir).some(([x, y]) => keys.has(key(x, y)))) blocked++;
    }
    let adj = 0;
    let sealed = 0;
    for (const [x, y] of cand.cells) {
      for (const d of Object.values(WG.DIRS)) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (inside(st, nx, ny)) {
          if (st.occ[ny * st.w + nx] !== -1) adj++;
          else {
            // опечатывание: свободная клетка, все соседи которой после установки кандидата
            // заняты — больше ничем её не закрыть (будущая дЫра)
            let freeNb = 0;
            for (const e of Object.values(WG.DIRS)) {
              const fx = nx + e.dx;
              const fy = ny + e.dy;
              if (inside(st, fx, fy) && st.occ[fy * st.w + fx] === -1 && !keys.has(key(fx, fy))) freeNb++;
            }
            if (freeNb === 0) sealed++;
          }
        }
      }
    }
    let s = blocked === 0 ? -2.0 : 2.4 * Math.min(blocked, 3);
    if (blocked > 4) s -= 1.5; // веер: одна стрелка держит всех — плоская пазл-структура
    s += 0.35 * adj;
    s -= 1.4 * sealed; // анти-пузырь: не создавать незаполнимые карманы (IMP B1.7)
    s += (cand.turns >= 2 ? 1.2 : 0) + 0.12 * cand.cells.length;
    s += rng.next() * 0.6;
    cand.blocked = blocked;
    return s;
  }

  function place(st, cand) {
    const id = st.arrows.length;
    for (const [x, y] of cand.cells) st.occ[y * st.w + x] = id;
    st.filled += cand.cells.length;
    st.arrows.push({ id, cells: cand.cells, dir: cand.dir });
  }

  // Одиночки заделывают оставшиеся дыры; ставятся последними, значит уходят первыми.
  // IMP B1.1: не более maxSinglesRatio от итогового числа стрелок и только пока coverage
  // ниже цели — иначе поле забивается «заглушками» без хвостов.
  function fillSingles(st, rng, params) {
    const ratio = params.maxSinglesRatio === undefined ? 0.1 : params.maxSinglesRatio;
    // placed ≤ ratio·(base + placed) ⇒ placed ≤ ratio·base / (1 − ratio) — итог ≤ ratio
    const maxSingles = Math.floor((st.arrows.length * ratio) / (1 - ratio));
    let placed = 0;
    const cells = [];
    for (let y = 0; y < st.h; y++) {
      for (let x = 0; x < st.w; x++) {
        if (freeAt(st, x, y)) cells.push([x, y]);
      }
    }
    for (const [x, y] of rng.shuffle(cells)) {
      if (placed >= maxSingles || coverage(st) >= params.coverage) break;
      if (!freeAt(st, x, y)) continue;
      for (const dir of rng.shuffle(DIR_LIST.slice())) {
        const ray = rayCells(st, x, y, dir);
        if (ray.every(([rx, ry]) => st.occ[ry * st.w + rx] === -1)) {
          place(st, { cells: [[x, y]], dir });
          placed++;
          break;
        }
      }
    }
  }

  // Жадная раскраска: цвет не совпадает с цветами соседей по стороне
  // Ремонт дыр (IMP B1.7): пустую клетку поглощает соседняя стрелка — с любого края:
  // хвост (втянуть — дырка становится новым хвостом), голова прямо (продолжение по ходу).
  // Безопасность очереди выезда: клетка не должна быть на луче стрелки с БОЛЬШИМ id
  // (поставленной позже) — иначе новая блокировка может создать цикл. Финальный
  // validate + solve в generate отсекает спорные попытки (fallback по сидам).
  function repairHoles(st) {
    // Эвристики ремонта могут в редких случаях замкнуть длинный цикл ожиданий
    // (B ждёт A → A ждёт C → C ждёт B) — тогда все последующие фазы парализуются.
    // Проверяем итог солвером и откатываем целиком при провале (IMP B1.8)
    const snap = snapshotState(st);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let y = 0; y < st.h && !progressed; y++) {
        for (let x = 0; x < st.w && !progressed; x++) {
          if (!freeAt(st, x, y)) continue;
          // владельцы лучей, пересекающих дырку (по текущим головам стрелок)
          const owners = [];
          for (const a of st.arrows) {
            const [hx, hy] = a.cells[a.cells.length - 1];
            for (const [rx, ry] of rayCells(st, hx, hy, a.dir)) {
              if (rx === x && ry === y) { owners.push(a.id); break; }
            }
          }
          const safeFor = (arrow) => owners.every((id) => id < arrow.id);
          // Кап длины (IMP B1.8b): ремонт не должен раздувать стрелку в монстра
          // (в референсе максимум 25 клеток)
          const absorb = (arrow, cellsNew) => {
            if (cellsNew.length > 24) return;
            arrow.cells = cellsNew;
            arrow.dir = WG.dirFromDelta(
              cellsNew[cellsNew.length - 1][0] - cellsNew[cellsNew.length - 2][0],
              cellsNew[cellsNew.length - 1][1] - cellsNew[cellsNew.length - 2][1]
            );
            st.occ[y * st.w + x] = arrow.id;
            st.filled++;
            progressed = true;
          };
          // край 1: втянуть в хвост (дырка примыкает к хвосту с любой стороны)
          for (const dir of DIR_LIST) {
            const d = WG.DIRS[dir];
            const nx = x - d.dx;
            const ny = y - d.dy;
            if (!inside(st, nx, ny)) continue;
            const id = st.occ[ny * st.w + nx];
            if (id === -1) continue;
            const arrow = st.arrows[id];
            if (arrow.cells[0][0] !== nx || arrow.cells[0][1] !== ny) continue;
            if (owners.includes(id)) continue; // луч пройдёт по собственному телу — нельзя
            if (!safeFor(arrow)) continue;
            absorb(arrow, [[x, y], ...arrow.cells]);
            break;
          }
          if (progressed) break;
          // край 2: достроить с головы (дырка — клетка перед головой по любому направлению;
          // dir может поменяться — это «загиб» головы в дырку, валидно, правило 4 проверит validate)
          for (const dir of DIR_LIST) {
            const d = WG.DIRS[dir];
            const nx = x - d.dx;
            const ny = y - d.dy;
            if (!inside(st, nx, ny)) continue;
            const id = st.occ[ny * st.w + nx];
            if (id === -1) continue;
            const arrow = st.arrows[id];
            const head = arrow.cells[arrow.cells.length - 1];
            if (head[0] !== nx || head[1] !== ny) continue;
            if (arrow.dir !== dir) continue; // только строго по ходу: луч сокращается, новых блокировок нет
            // дырка лежала на собственном старом луче — это не опасно (луч короче),
            // нужно только, чтобы не появились блокировки «чужих» более поздних стрелок
            const others = owners.filter((o) => o !== id);
            if (!others.every((o) => o < id)) continue;
            // Новая голова (дырка) не должна оказаться в пограничной клетке по ходу —
            // ray-0 (вечная «тыкалка») запрещён (IMP B1.8)
            if (rayCells(st, x, y, dir).length === 0) continue;
            absorb(arrow, [...arrow.cells, [x, y]]);
            break;
          }
          if (progressed) break;
          // загиб головы в дырку перпендикулярно (новое направление выезда): самый мощный
          // вариант — но только если через дырку не проходит НИКАКОЙ луч (пустое перекр_y_тие),
          // иначе сломаем чужую очередь выезда
          if (owners.length === 0) {
            for (const dir of DIR_LIST) {
              const d = WG.DIRS[dir];
              const nx = x - d.dx;
              const ny = y - d.dy;
              if (!inside(st, nx, ny)) continue;
              const id = st.occ[ny * st.w + nx];
              if (id === -1) continue;
              const arrow = st.arrows[id];
              const head = arrow.cells[arrow.cells.length - 1];
              if (head[0] !== nx || head[1] !== ny) continue;
              if (arrow.dir === dir) continue; // прямой вариант уже рассмотрен выше
              // загиб: новый луч не должен проходить через собственное тело (правило 4),
              // а дырка не должна быть на луче стрелки НОВЕЕ нашей — иначе новая блокировка
              // может замкнуть цикл (IMP B1.7c)
              let ok = true;
              for (let rx = x + d.dx, ry = y + d.dy; inside(st, rx, ry); rx += d.dx, ry += d.dy) {
                if (st.occ[ry * st.w + rx] === id) { ok = false; break; }
              }
              if (!ok) continue;
              if (!owners.filter((o) => o !== id).every((o) => o < id)) continue;
              // Загиб в пограничную клетку наружу → ray-0 — запрещён (IMP B1.8)
              if (rayCells(st, x, y, dir).length === 0) continue;
              absorb(arrow, [...arrow.cells, [x, y]]);
              break;
            }
          }
          if (progressed) break;
        }
      }
    }
    // Итог ремонта подтверждаем солвером: редкий цикл ожиданий — откат всего прохода
    if (!stillSolvable(st)) restoreState(st, snap);
  }

  // ===== Добивка дыр (IMP B1.8 «плотность референса») =====
  // Строительство «луч чист» застревает на ~65% покрытия: у оставшихся пустых
  // клеток нет свободного луча. Карманы добиваем НОВЫМИ короткими стрелками
  // (2–4 клетки) с перекрытым лучом: такая стрелка просто ждёт ухода блокирующих.
  // Дедлок — только взаимное ожидание («луч новой ⊗ тело A» И «тело новой ⊗ луч A»):
  // такие кандидаты отсекаем заранее, а каждую постановку подтверждаем солвером
  // (не решаемо — откат). Каждая добивочная стрелка что-то блокирует → глубина растёт.

  // Случайный путь из свободных клеток длиной 2–4 от дырки; голова — конец пути,
  // dir — направление последнего шага (как в Board.dirOf)
  function tryPackArrow(st, sx, sy, rng) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const len = 2 + rng.int(0, 2);
      const path = [[sx, sy]];
      const used = new Set([key(sx, sy)]);
      let cur = [sx, sy];
      let ok = true;
      for (let i = 1; i < len; i++) {
        const nb = rng.shuffle(DIR_LIST.slice())
          .map((d) => [cur[0] + WG.DIRS[d].dx, cur[1] + WG.DIRS[d].dy])
          .filter(([x, y]) => freeAt(st, x, y) && !used.has(key(x, y)));
        if (!nb.length) { ok = false; break; }
        cur = nb[0];
        path.push(cur);
        used.add(key(cur[0], cur[1]));
      }
      if (!ok) continue;
      const head = path[path.length - 1];
      const prev = path[path.length - 2];
      const dir = WG.dirFromDelta(head[0] - prev[0], head[1] - prev[1]);
      if (!dir) continue;
      // Луч не должен пересекать собственное тело (правило 4)
      const bodyKeys = new Set(path.map(([x, y]) => key(x, y)));
      if (rayCells(st, head[0], head[1], dir).some(([x, y]) => bodyKeys.has(key(x, y)))) continue;
      // Голова не в пограничной клетке по ходу — ray-0 (вечная «тыкалка») запрещён
      if (rayCells(st, head[0], head[1], dir).length === 0) continue;
      return { cells: path.slice(), dir, turns: 0 };
    }
    return null;
  }

  function snapshotState(st) {
    return {
      filled: st.filled,
      arrows: st.arrows.map((a) => ({ id: a.id, dir: a.dir, cells: a.cells.map((c) => [c[0], c[1]]) })),
    };
  }

  function restoreState(st, snap) {
    st.occ.fill(-1);
    st.arrows = snap.arrows.map((a) => ({ id: a.id, dir: a.dir, cells: a.cells }));
    for (const a of st.arrows) {
      for (const [x, y] of a.cells) st.occ[y * st.w + x] = a.id;
    }
    st.filled = snap.filled;
  }

  // Общий откат одной постановки (place → place minus)
  function undoPlace(st, cand) {
    for (const [x, y] of cand.cells) st.occ[y * st.w + x] = -1;
    st.filled -= cand.cells.length;
    st.arrows.pop();
  }

  // Досилиз: текущий набор стрелок всё ещё решаем?
  function stillSolvable(st) {
    try {
      return WG.solver.solve({
        w: st.w,
        h: st.h,
        mask: st.mask,
        arrows: st.arrows.map((a) => {
          const arrow = { id: a.id, cells: a.cells };
          if (a.cells.length === 1) arrow.dir = a.dir;
          return arrow;
        }),
      }).solvable === true;
    } catch {
      return false;
    }
  }

  // Взаимное ожидание: луч кандидата пересекает тело A и одновременно тело
  // кандидата лежит на луче A → дедлок, кандидата отбрасываем
  function mutualWait(st, cand) {
    const [hx, hy] = cand.cells[cand.cells.length - 1];
    const bodyKeys = new Set(cand.cells.map(([x, y]) => key(x, y)));
    const crossed = new Set(); // кто блокирует кандидата (чужие тела на его луче)
    for (const [rx, ry] of rayCells(st, hx, hy, cand.dir)) {
      const id = st.occ[ry * st.w + rx];
      if (id !== -1) crossed.add(id);
    }
    const waiting = new Set(); // кто ждёт кандидата (его тело на их луче)
    for (const a of st.arrows) {
      const [ax, ay] = a.cells[a.cells.length - 1];
      if (rayCells(st, ax, ay, a.dir).some(([x, y]) => bodyKeys.has(key(x, y)))) waiting.add(a.id);
    }
    for (const id of crossed) {
      if (waiting.has(id)) return true;
    }
    return false;
  }

  function packHoles(st, rng, deadline) {
    let wave = 0;
    // Без coverage-гейта: заполняем ВСЕ дыры (каналы пустых клеток, по которым
    // сходятся лучи «свободных» стрелок) — полная упаковка и есть цель (IMP B1.8)
    while (Date.now() < deadline && wave++ < 8) {
      let improved = false;
      const holes = [];
      for (let y = 0; y < st.h; y++) {
        for (let x = 0; x < st.w; x++) {
          if (freeAt(st, x, y)) holes.push([x, y]);
        }
      }
      for (const [sx, sy] of rng.shuffle(holes)) {
        if (Date.now() >= deadline) break;
        if (!freeAt(st, sx, sy)) continue;
        const cand = tryPackArrow(st, sx, sy, rng);
        if (!cand || mutualWait(st, cand)) continue;
        place(st, cand);
        if (stillSolvable(st)) {
          improved = true;
        } else {
          undoPlace(st, cand);
        }
      }
      if (!improved) break;
    }
  }

  // Фаза B: «поезда стражей» (IMP B1.8, по метрикам референса: initialFree 6%,
  // maxChain ~21). Свободная стрелка (луч чист до края) — кандидат в «тыкалку».
  // Её коридор заполняем стрелками 2–3 клетки ВДОЛЬ луча: каждая следующая
  // лежит на луче предыдущей → коридор длины L превращается в цепочку
  // глубины ~L/2 (a ждёт стража1, стража1 ждёт стража2, ...). Это и есть
  // короткие прямые стрелки, которыми забиты коридоры референса.
  function blockFreeArrows(st, rng, deadline) {
    const isFreeArrow = (a) => {
      const [hx, hy] = a.cells[a.cells.length - 1];
      return rayCells(st, hx, hy, a.dir).every(([x, y]) => st.occ[y * st.w + x] === -1);
    };
    for (const a of rng.shuffle(st.arrows.filter(isFreeArrow))) {
      if (Date.now() >= deadline) break;
      if (!isFreeArrow(a)) continue; // уже заблокирована предыдущим поездом
      const [hx, hy] = a.cells[a.cells.length - 1];
      const ray = rayCells(st, hx, hy, a.dir);
      let i = 0;
      while (i + 1 < ray.length && Date.now() < deadline) {
        const len = 2 + rng.int(0, 1); // 2–3 клетки вдоль луча
        const cells = [];
        let ok = true;
        for (let k = 0; k < len; k++) {
          const c = ray[i + k];
          if (!c || !freeAt(st, c[0], c[1])) { ok = false; break; }
          cells.push([c[0], c[1]]);
        }
        if (!ok || cells.length < 2) break;
        // Голова поезда — не в пограничной клетке по ходу (иначе ray-0 = вечная «тыкалка»):
        // укорачиваем сегмент, пока голова не получит хотя бы 1 клетку луча
        while (cells.length >= 2) {
          const [chx, chy] = cells[cells.length - 1];
          if (rayCells(st, chx, chy, a.dir).length > 0) break;
          cells.pop();
        }
        if (cells.length < 2) break;
        const cand = { cells, dir: a.dir, turns: 0 };
        if (!mutualWait(st, cand)) {
          place(st, cand);
          if (!stillSolvable(st)) undoPlace(st, cand);
        } // иначе: взаимное ожидание — кандидат отвергнут
        i += len;
      }
    }
  }

  // Досыпания доминошками (IMP B1.8): каждая пара соседних свободных клеток
  // становится стрелкой длины 2. Ориентация — с ненулевым лучом (ray-0 запрещён).
  // Если луч кандидата чист — добавление доказуемо безопасно (свободная стрелка
  // выходит первой) — без солвера; иначе подтверждаем солвером.
  function fillDominoes(st, rng) {
    for (let y = 0; y < st.h; y++) {
      for (let x = 0; x < st.w; x++) {
        if (!freeAt(st, x, y)) continue;
        for (const dir of rng.shuffle(DIR_LIST.slice())) {
          const nx = x + WG.DIRS[dir].dx;
          const ny = y + WG.DIRS[dir].dy;
          if (!freeAt(st, nx, ny)) continue;
          const fwd = rayCells(st, nx, ny, dir).length > 0;
          const back = rayCells(st, x, y, OPP[dir]).length > 0;
          if (!fwd && !back) continue;
          const headFwd = fwd || !back;
          const cells = headFwd ? [[x, y], [nx, ny]] : [[nx, ny], [x, y]];
          const cand = { cells, dir: headFwd ? dir : OPP[dir], turns: 0 };
          if (mutualWait(st, cand)) continue;
          const [chx, chy] = cand.cells[cand.cells.length - 1];
          const rayClear = rayCells(st, chx, chy, cand.dir).every(([rx, ry]) => st.occ[ry * st.w + rx] === -1);
          place(st, cand);
          if (!rayClear && !stillSolvable(st)) undoPlace(st, cand);
          break;
        }
      }
    }
  }

  function colorize(st, rng) {
    const colors = st.arrows.map(() => -1);
    for (const a of st.arrows) {
      const used = new Set();
      for (const [x, y] of a.cells) {
        for (const d of Object.values(WG.DIRS)) {
          const id = inside(st, x + d.dx, y + d.dy) ? st.occ[(y + d.dy) * st.w + x + d.dx] : -1;
          if (id !== -1 && id !== a.id) used.add(colors[id]);
        }
      }
      const free = [];
      for (let c = 0; c < 8; c++) if (!used.has(c)) free.push(c);
      colors[a.id] = free.length ? rng.pick(free) : rng.int(0, 7);
    }
    return colors;
  }

  function generate(params, seed) {
    const rng = WG.rng(seed);
    const st = makeState(params);

    let fails = 0;
    let stalls = 0; // суммарно неудачных раундов: на плотном поле длинные стрелки перестают помещаться
    while (coverage(st) < params.coverage && fails < 150) {
      let best = null;
      // Распад maxLen (IMP B1.5): чем дольше стоим, тем короче пробуем — упаковка хвоста поля
      const effMax = Math.max(params.minLen, params.maxLen - Math.floor(stalls / 60));
      const p2 = effMax === params.maxLen ? params : Object.assign({}, params, { maxLen: effMax });
      for (let i = 0; i < params.candidates; i++) {
        const cand = tryMakeArrow(st, p2, rng);
        if (!cand) continue;
        cand.score = interlockScore(st, cand, rng);
        if (!best || cand.score > best.score) best = cand;
      }
      // IMP B1.6: лабиринт растёт сплетением — «свободная» стрелка (никого не блокирует)
      // допускается только если застряли (stalls) или поле почти заполнено.
      if (best && (best.blocked > 0 || stalls > 40 || coverage(st) > 0.68)) {
        place(st, best);
        fails = 0;
      } else {
        fails++;
        stalls++;
      }
    }
    // Второй этап (IMP B1.8): если строительная фаза застряла на рыхлом поле
    // (карманы рубят пространство) — дочерпываем без interlock-гейта:
    // глубину цепочек потом добирают поезда и добивка
    if (coverage(st) < params.coverage - 0.02) {
      fails = 0;
      stalls = 0;
      while (coverage(st) < params.coverage && fails < 200) {
        const cand = tryMakeArrow(st, params, rng);
        if (cand) {
          place(st, cand);
          fails = 0;
        } else {
          fails++;
        }
      }
    }
    if (params.allowSingles) fillSingles(st, rng, params);
    // Близкое внимание: если после repair остались ямы, делаем ещё один проход (заполнение пострелками)
    if (st.filled / st.allowedCount < params.coverage) fillSingles(st, rng, params);

    // Уровень гарантированно решаем БЕЗ добивки (построение задом наперёд);
    // базовая версия — страховка для отката. Дальше добиваем плотность и глубину
    // (IMP B1.8): ремонт → добивка → повторный ремонт; итог проверяется
    // validate+solve, при провале — откат к базовой.
    const build = () => {
      const colors = colorize(st, rng);
      return {
        id: null,
        w: st.w,
        h: st.h,
        mask: st.mask,
        shape: params.shape || null,
        boss: !!params.boss,
        arrows: st.arrows.map((a) => {
          const arrow = { id: a.id, cells: a.cells, color: colors[a.id] };
          if (a.cells.length === 1) arrow.dir = a.dir;
          return arrow;
        }),
        seed,
      };
    };
    const base = snapshotState(st);
    if (params.repairHoles !== false) {
      repairHoles(st);
      // Бюджет делится по фазам: packHoles за один проход по дыркам съедает секунду
      // солвер-проверок, поэтому без жёстких слайсов поездам ничего не достаётся
      const t0 = Date.now();
      const budget = params.packBudgetMs || 2600;
      // Сначала поезда (длинные коридоры → цепочки), потом добивка остальных карманов;
      // каждая постановка подтверждается солвером; три прохода съедают «хвосты» каналов
      blockFreeArrows(st, rng, t0 + budget * 0.22);
      packHoles(st, rng, t0 + budget * 0.4);
      fillDominoes(st, rng); // безусловная засыпка пар — добивает карманы
      blockFreeArrows(st, rng, t0 + budget * 0.58);
      packHoles(st, rng, t0 + budget * 0.74);
      fillDominoes(st, rng);
      blockFreeArrows(st, rng, t0 + budget * 0.9);
      packHoles(st, rng, t0 + budget);
      fillDominoes(st, rng);
      repairHoles(st); // подбор остатков (одиночные дыры втягиваются соседями)
    }
    let level;
    let metrics;
    try {
      level = build();
      metrics = WG.level.validate(level);
      if (!metrics || metrics.solvable === false) throw new Error('unsolvable after pack');
    } catch {
      restoreState(st, base);
      level = build();
      metrics = WG.level.validate(level);
    }
    return { level, metrics, coverage: st.filled / st.allowedCount };
  }

  const cache = new Map();

  // Уровень n: перебираем сиды, пока не выполнятся условия отбраковки (раздел 5.4)
  function makeLevelInfo(n) {
    if (cache.has(n)) return cache.get(n);

    const hand = WG.levels.handLevel(n);
    if (hand) {
      const info = { level: hand, metrics: WG.solver.solve(hand), coverage: null, attempt: 0 };
      cache.set(n, info);
      return info;
    }

    const params = WG.levels.paramsFor(n);
    // Пробные сиды: лёгкая добивка (малый бюджет), полная — только в финале
    const probe = Object.assign({}, params, { packBudgetMs: 220 });
    let bestSeed = -1;
    let bestScore = -1;
    let foundSeed = -1;
    for (let attempt = 0; attempt < 12 && foundSeed < 0; attempt++) {
      const seed = n * 1000 + attempt;
      let res = null;
      try {
        res = generate(probe, seed);
      } catch {
        continue;
      }
      if (!res.metrics.solvable) continue;
      // Референс: свободных на старте ~6% — сид с большим «тыкательным» стартом бракуем;
      // и средняя длина ≥ minLen+2.5 — витиеватость (короткышные поля — текстурный мусор)
      const avgLen = res.level.arrows.reduce((s, a) => s + a.cells.length, 0) / Math.max(1, res.level.arrows.length);
      const freeOk = res.metrics.initialFree / Math.max(1, res.level.arrows.length) <= 0.15
        && avgLen >= params.minLen + 2.5;
      const ok = freeOk
        && res.metrics.rounds >= params.minRounds
        && res.coverage >= params.coverage - 0.12; // допуск на плотных полях (IMP B1.7)
      if (ok) {
        foundSeed = seed;
      } else {
        const m = res.metrics;
        const freeRatio = m.initialFree / Math.max(1, res.level.arrows.length);
        // Покров весомее: провал по плотности хуже недобора глубины (глубину доберут фазы)
        const score = Math.min(m.rounds, params.minRounds * 2) * 2 + res.coverage * 16 - freeRatio * 8;
        if (score > bestScore) {
          bestScore = score;
          bestSeed = seed;
        }
      }
    }
    const pickSeed = foundSeed >= 0 ? foundSeed : bestSeed;
    if (pickSeed < 0) throw new Error(`Не удалось сгенерировать уровень ${n}`);
    // Финальная генерация — с ремонтом дыр; базовая (без ремонта) как страховка
    let info;
    try {
      const fin = generate(params, pickSeed);
      info = fin.metrics.solvable ? fin : generate(probe, pickSeed);
    } catch {
      info = generate(probe, pickSeed);
    }
    info.level.id = n;
    info.attempt = pickSeed - n * 1000;
    cache.set(n, info);
    return info;
  }

  WG.generator = {
    generate,
    makeLevelInfo,
    makeLevel: (n) => makeLevelInfo(n).level,
  };

})(window.WG = window.WG || {});
