'use strict';

// Запуск: node tools/test.js
// Грузит src/*.js тем же способом, что и index.html (общий window.WG), без библиотек

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

global.window = {};
const SRC = path.join(__dirname, '..', 'src');
const FILES = ['core', 'i18n', 'rng', 'level', 'solver', 'generator', 'shapes', 'levels', 'themes', 'anim', 'audio', 'storage', 'render', 'input'];
for (const f of FILES) {
  vm.runInThisContext(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8'), { filename: f + '.js' });
}
const WG = window.WG;

// Короткий конструктор уровня для тестов
const level = (w, h, arrows, extra = {}) => ({ id: 0, w, h, mask: null, arrows, ...extra });

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---- локализация ----
test('i18n: язык устройства → ru для ru-*, иначе en; подстановка параметров', () => {
  assert.strictEqual(WG.i18n.detect(['ru-RU', 'en-US']), 'ru');
  assert.strictEqual(WG.i18n.detect(['de-DE', 'ru']), 'ru');
  assert.strictEqual(WG.i18n.detect(['de-DE', 'fr']), 'en');
  assert.strictEqual(WG.i18n.detect([]), 'en');
  WG.i18n.setLanguage('ru');
  assert.strictEqual(WG.t('play', { n: 7 }), 'Уровень 7 ▶');
  WG.i18n.setLanguage('en');
  assert.strictEqual(WG.t('play', { n: 7 }), 'Level 7 ▶');
  assert.strictEqual(WG.t('noCoins', { price: 60 }), 'Not enough coins: 60🪙');
});

test('i18n: словари en и ru содержат одни и те же ключи', () => {
  assert.deepStrictEqual(Object.keys(WG.i18n.DICT.ru).sort(), Object.keys(WG.i18n.DICT.en).sort());
});

// ---- rng ----
test('rng(42) дважды выдаёт одинаковую последовательность', () => {
  const a = WG.rng(42);
  const b = WG.rng(42);
  for (let i = 0; i < 100; i++) assert.strictEqual(a.next(), b.next());
});

// ---- модель и решатель ----
test('одиночный путь к краю: canExit = true', () => {
  const lvl = level(3, 1, [{ id: 0, cells: [[0, 0], [1, 0]], color: 0 }]);
  const board = new WG.level.Board(lvl);
  assert.strictEqual(board.canExit(0), true);
});

test('две стрелки смотрят друг на друга: цикл → solvable = false', () => {
  const lvl = level(3, 1, [
    { id: 0, cells: [[0, 0]], dir: 'R', color: 0 },
    { id: 1, cells: [[2, 0]], dir: 'L', color: 1 },
  ]);
  const board = new WG.level.Board(lvl);
  assert.deepStrictEqual(board.firstBlocker(board.alive.get(0)), { arrowId: 1, dist: 2 });
  assert.deepStrictEqual(board.firstBlocker(board.alive.get(1)), { arrowId: 0, dist: 2 });
  const res = WG.solver.solve(lvl);
  assert.strictEqual(res.solvable, false);
  assert.strictEqual(res.initialFree, 0);
});

test('цепочка: A блокирована B, B свободна → rounds = 2, order = [B, A]', () => {
  const lvl = level(4, 1, [
    { id: 0, cells: [[0, 0], [1, 0]], color: 0 }, // A, смотрит R, луч упирается в B
    { id: 1, cells: [[3, 0]], dir: 'R', color: 1 }, // B, луч пуст
  ]);
  const res = WG.solver.solve(lvl);
  assert.strictEqual(res.solvable, true);
  assert.strictEqual(res.rounds, 2);
  assert.deepStrictEqual(res.order, [1, 0]);
  assert.strictEqual(res.maxChain, 2);
});

test('tap по заблокированной стрелке не меняет occ', () => {
  const lvl = level(4, 1, [
    { id: 0, cells: [[0, 0], [1, 0]], color: 0 },
    { id: 1, cells: [[3, 0]], dir: 'R', color: 1 },
  ]);
  const board = new WG.level.Board(lvl);
  const before = board.occ.slice();
  const res = board.tap(0);
  assert.strictEqual(res.type, 'blocked');
  assert.strictEqual(res.blockerId, 1);
  assert.deepStrictEqual(board.occ, before);
  assert.strictEqual(board.alive.has(0), true);
});

test('tap по свободной стрелке убирает её из occ и alive', () => {
  const lvl = level(4, 1, [{ id: 0, cells: [[0, 0], [1, 0]], color: 0 }]);
  const board = new WG.level.Board(lvl);
  const res = board.tap(0);
  assert.deepStrictEqual(res, { type: 'exit', arrowId: 0, rayLen: 2 });
  assert.strictEqual(board.arrowAt(0, 0), -1);
  assert.strictEqual(board.arrowAt(1, 0), -1);
  assert.strictEqual(board.isCleared(), true);
});

test('tap по уже убранной стрелке возвращает null', () => {
  const lvl = level(3, 1, [{ id: 0, cells: [[0, 0]], dir: 'R', color: 0 }]);
  const board = new WG.level.Board(lvl);
  board.tap(0);
  assert.strictEqual(board.tap(0), null);
});

test('hint выбирает стрелку, которая разблокирует больше всех', () => {
  // Свободны id 2 (разблокирует никого) и id 0 (держит id 1). Раньше в списке стоит id 2,
  // но подсказка должна выбрать id 0
  const lvl = level(3, 2, [
    { id: 2, cells: [[2, 0]], dir: 'U', color: 2 },
    { id: 0, cells: [[1, 1]], dir: 'D', color: 0 },
    { id: 1, cells: [[0, 1]], dir: 'R', color: 1 }, // луч упирается в id 0
  ]);
  const board = new WG.level.Board(lvl);
  assert.strictEqual(WG.solver.hint(board), 0);
});

test('hint возвращает null, если свободных нет', () => {
  const lvl = level(3, 1, [
    { id: 0, cells: [[0, 0]], dir: 'R', color: 0 },
    { id: 1, cells: [[2, 0]], dir: 'L', color: 1 },
  ]);
  assert.strictEqual(WG.solver.hint(new WG.level.Board(lvl)), null);
});

// ---- validate ----
test('validate пропускает корректный уровень', () => {
  const lvl = level(4, 1, [
    { id: 0, cells: [[0, 0], [1, 0]], color: 0 },
    { id: 1, cells: [[3, 0]], dir: 'R', color: 1 },
  ]);
  WG.level.validate(lvl);
});

test('validate ловит нерешаемый уровень (правило 5 из §3.2: цикл)', () => {
  const lvl = level(3, 1, [
    { id: 0, cells: [[0, 0]], dir: 'R', color: 0 },
    { id: 1, cells: [[2, 0]], dir: 'L', color: 1 },
  ]);
  assert.throws(() => WG.level.validate(lvl), /не решаем/);
});

test('validate ловит выход за поле', () => {
  const lvl = level(3, 1, [{ id: 0, cells: [[5, 0]], dir: 'R', color: 0 }]);
  assert.throws(() => WG.level.validate(lvl), /за пределами поля/);
});

test('validate ловит разрыв цепочки', () => {
  const lvl = level(3, 1, [{ id: 0, cells: [[0, 0], [2, 0]], color: 0 }]);
  assert.throws(() => WG.level.validate(lvl), /разрыв/);
});

test('validate ловит наложение стрелок', () => {
  const lvl = level(3, 1, [
    { id: 0, cells: [[0, 0], [1, 0]], color: 0 },
    { id: 1, cells: [[1, 0]], dir: 'R', color: 1 },
  ]);
  assert.throws(() => WG.level.validate(lvl), /занята стрелкой/);
});

test('validate ловит луч через собственное тело (змейка свернулась перед головой)', () => {
  // Голова [1,1] смотрит R, а на [2,1] лежит её же тело
  const lvl = level(5, 3, [
    {
      id: 0,
      cells: [[2, 1], [2, 0], [1, 0], [0, 0], [0, 1], [1, 1]],
      color: 0,
    },
  ]);
  assert.throws(() => WG.level.validate(lvl), /собственное тело/);
});

test('validate ловит одиночную стрелку без dir', () => {
  const lvl = level(3, 1, [{ id: 0, cells: [[0, 0]], color: 0 }]);
  assert.throws(() => WG.level.validate(lvl), /dir/);
});

// ---- генератор ----
const LEVEL_COUNT = 200;

test(`makeLevel(n) для n = 1..${LEVEL_COUNT}: validate проходит, solvable = true`, () => {
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const lvl = WG.generator.makeLevel(n);
    WG.level.validate(lvl);
    const res = WG.solver.solve(lvl);
    assert.strictEqual(res.solvable, true, `уровень ${n} не решается`);
  }
});

test('makeLevel(17): детерминизм — одинаковый seed даёт идентичный JSON', () => {
  const params = WG.levels.paramsFor(17);
  const a = WG.generator.generate(params, 17000);
  const b = WG.generator.generate(params, 17000);
  assert.strictEqual(JSON.stringify(a.level), JSON.stringify(b.level));
  // Буква §5.6: сам makeLevel (формула seed = n*1000 + attempt) тоже детерминирован
  assert.strictEqual(JSON.stringify(WG.generator.makeLevel(17)), JSON.stringify(WG.generator.makeLevel(17)));
});

test('генерация разреженного лабиринта 20×30 занимает меньше 400 мс (без фаз добивки)', () => {
  const params = Object.assign({}, WG.levels.paramsFor(2), { repairHoles: false });
  assert.strictEqual(params.w, 20);
  assert.strictEqual(params.h, 30);
  const tRoyal = Date.now();
  WG.generator.generate(params, 2000);
  const dt = Date.now() - tRoyal;
  assert.ok(dt < 400, `заняло ${dt} мс`);
});

test('полная генерация (ремонт + добивка + поезда) укладывается в 7 с (IMP B1.8)', () => {
  const params = WG.levels.paramsFor(200);
  assert.strictEqual(params.w, 20);
  assert.strictEqual(params.h, 30);
  const t0 = Date.now();
  const res = WG.generator.generate(params, 200000);
  const dt = Date.now() - t0;
  assert.ok(res.metrics.solvable, 'уровень должен быть решаемым');
  assert.ok(dt < 7000, `заняло ${dt} мс`);
});

// ---- зум/пан (IMP B5): чистая view-математика ----
test('clampView с box: при зуме видны оба края смещённого поля, угол поля уводится почти в центр экрана', () => {
  WG.input.setMaxScale(6);
  try {
  // поле 300×500 мировых px, лежит с отступом (20, 100); видимая полоса по вертикали — [90, 557]
  const box = { ox: 20, oy: 100, top: 90, bottom: 110 };
  const W = 340;
  const H = 667;
  const s = 4;
  // тянем максимально вниз-вправо: левый/верхний край поля прижат к краю полосы
  const a = WG.input.clampView({ scale: s, tx: 1e6, ty: 1e6 }, 300, 500, W, H, box);
  const sx = W * 0.45;
  const sy = (H - 90 - 110) * 0.45;
  assert.ok(Math.abs(20 * s + a.tx - sx) < 1e-9, 'левый край поля у левого края экрана');
  assert.ok(Math.abs(100 * s + a.ty - (90 + sy)) < 1e-9, 'верх поля под HUD');
  // тянем вверх-влево: правый/нижний край поля доступен
  const b = WG.input.clampView({ scale: s, tx: -1e6, ty: -1e6 }, 300, 500, W, H, box);
  assert.ok(Math.abs(320 * s + b.tx - (W - sx)) < 1e-9, 'правый край поля достижим');
  assert.ok(Math.abs(600 * s + b.ty - (H - 110 - sy)) < 1e-9, 'низ поля над бустерами');
  // масштаб 1: вид нейтрален — layout уже поставил поле (300×447) по центру полосы [90, 557]
  const c = WG.input.clampView({ scale: 1, tx: 50, ty: 50 }, 300, 447, W, H, box);
  assert.ok(Math.abs(c.tx) < 1e-9 && Math.abs(c.ty) < 1e-9);
  } finally {
    WG.input.setMaxScale(WG.input.MAX_SCALE);
  }
});

test('screenToWorld/clampView: обратимость и границы поля', () => {
  const v = { scale: 2, tx: -100, ty: -50 };
  const w = WG.input.screenToWorld(v, 300, 400);
  assert.strictEqual(w.x, 200); // (300 − (−100)) / 2
  assert.strictEqual(w.y, 225); // (400 − (−50)) / 2
  // Увеличенное поле не вытянуть за край
  const c = WG.input.clampView({ scale: 2, tx: 999, ty: -999 }, 300, 600, 375, 667);
  assert.strictEqual(c.tx, 0);    // 300*2=600 < 667? нет: lo=−225, hi=0 → 999 → 0
  assert.strictEqual(c.ty, -533); // 600*2=1200 > 667 → низ прижат к краю
  // При scale 1 вид нулевой, куда бы его ни тянули
  const c1 = WG.input.clampView({ scale: 1, tx: 5, ty: -3 }, 300, 600, 375, 667);
  assert.deepStrictEqual([c1.scale, c1.tx, c1.ty], [1, 0, 0]);
  // Масштаб зажимается в [1, MAX]
  assert.strictEqual(WG.input.clampView({ scale: 9, tx: 0, ty: 0 }, 300, 600, 375, 667).scale, WG.input.MAX_SCALE);
  assert.strictEqual(WG.input.clampView({ scale: 0.2, tx: 0, ty: 0 }, 300, 600, 375, 667).scale, 1);
});

test('pinch/wheel: мир под пальцем/курсором не уезжает (IMP B5)', () => {
  const base = { scale: 1, tx: 0, ty: 0 };
  const mid = { x: 200, y: 150 };
  const v = WG.input.pinchView(base, mid, 100, mid, 200, 345, 700, 375, 667);
  assert.strictEqual(v.scale, 2);
  const back = WG.input.screenToWorld(v, mid.x, mid.y);
  assert.strictEqual(back.x, 200);
  assert.strictEqual(back.y, 150);
  // Колесо: зум к курсору, шаг WHEEL_STEP
  const w = WG.input.wheelView(base, 100, 200, -120, 345, 700, 375, 667);
  assert.strictEqual(w.scale, 1.15);
  const p0 = WG.input.screenToWorld(base, 100, 200);
  const p1 = WG.input.screenToWorld(w, 100, 200);
  assert.ok(Math.abs(p0.x - p1.x) < 1e-9 && Math.abs(p0.y - p1.y) < 1e-9);
  // Пан двигает и клампится
  const pan = WG.input.panView(v, 50, 0, 345, 700, 375, 667);
  assert.strictEqual(pan.tx, v.tx + 50);
  const panClamped = WG.input.panView(v, 9999, 0, 345, 700, 375, 667);
  assert.ok(panClamped.tx <= 0);
});

// ---- туториалы, фигуры, кривая сложности ----
test('туториал: уровень 1 — 3 свободные стрелки, со 2-го — плотное 20×30 (референс)', () => {
  const r1 = WG.solver.solve(WG.generator.makeLevel(1));
  assert.strictEqual(WG.generator.makeLevel(1).arrows.length, 3);
  assert.strictEqual(r1.initialFree, 3);
  assert.strictEqual(r1.rounds, 1);
  // Уровень 2 — уже плотное поле 20×30, как в референсе (IMP B1.8)
  const l2 = WG.generator.makeLevel(2);
  assert.strictEqual(l2.w, 20);
  assert.strictEqual(l2.h, 30);
  assert.ok(l2.arrows.length >= 40);
});

test('фигур не меньше 8, каждая — прямоугольная маска с клетками', () => {
  assert.ok(WG.shapes.count >= 8);
  for (const s of WG.shapes.list) {
    const w = s.rows[0].length;
    assert.ok(s.rows.every((r) => r.length === w), `${s.name}: рваные строки`);
    assert.ok(s.rows.join('').includes('#'), `${s.name}: нет клеток`);
  }
  const fitted = WG.shapes.get(0, 12, 16).mask;
  assert.strictEqual(fitted.length, 16);
  assert.ok(fitted.every((r) => r.length === 12));
});

test('расписание: поле 20×30 со 2-го, фигуры каждый 7-й с 15-го, боссы каждый 10-й с 10-го', () => {
  // Фигуры
  assert.ok(WG.levels.paramsFor(21).mask, 'уровень 21 должен быть фигурой');
  assert.strictEqual(WG.levels.paramsFor(22).mask, null);
  assert.ok(WG.levels.paramsFor(35).mask);
  assert.strictEqual(WG.levels.paramsFor(36).mask, null);

  // Боссы: каждый 10-й с 10-го; босс 110 — поле 20×30 (золотая рамка)
  assert.strictEqual(WG.levels.paramsFor(10).boss, true);
  const boss = WG.levels.paramsFor(110);
  assert.strictEqual(boss.boss, true);
  assert.strictEqual(boss.w, 20);
  assert.strictEqual(boss.h, 30);
  assert.strictEqual(WG.levels.paramsFor(11).boss, false);

  // Поле 20×30 уже со 2-го уровня — сложность растёт плотностью и глубиной
  assert.deepStrictEqual([WG.levels.paramsFor(2).w, WG.levels.paramsFor(2).h], [20, 30]);
  assert.deepStrictEqual([WG.levels.paramsFor(200).w, WG.levels.paramsFor(200).h], [20, 30]);
  // Повороты: позже — прямее (референс-карта)
  assert.strictEqual(WG.levels.paramsFor(15).turnChance, 0.3);
  assert.strictEqual(WG.levels.paramsFor(30).turnChance, 0.25);
  assert.strictEqual(WG.levels.paramsFor(60).turnChance, 0.2);
  assert.strictEqual(WG.levels.paramsFor(200).turnChance, 0.15);

  // Передышка на 5-м уровне: параметры как у предыдущего
  assert.deepStrictEqual(
    { w: WG.levels.paramsFor(15).w, h: WG.levels.paramsFor(15).h, minRounds: WG.levels.paramsFor(15).minRounds },
    { w: WG.levels.paramsFor(14).w, h: WG.levels.paramsFor(14).h, minRounds: WG.levels.paramsFor(14).minRounds }
  );
});

test('rounds: цепочки глубокие на всех полосах (лабиринт)', () => {
  const bands = [[2, 9], [10, 24], [25, 49], [50, 84], [85, 160]];
  const avgs = bands.map(([a, b]) => {
    let sum = 0;
    for (let n = a; n <= b; n++) sum += WG.solver.solve(WG.generator.makeLevel(n)).rounds;
    return sum / (b - a + 1);
  });
  console.log('        средний rounds по полосам 2–9 / 10–24 / 25–49 / 50–84 / 85–160: ' +
    avgs.map((v) => v.toFixed(2)).join(' / '));
  for (const [i, avg] of avgs.entries()) {
    assert.ok(avg >= 9, `полоса ${bands[i]}: avg rounds ${avg.toFixed(2)} < 9 — цепочки недостаточно глубокие`);
  }
  assert.ok(avgs[4] >= 10, `85–160 (${avgs[4].toFixed(2)}) < 10`);
});

// ---- баланс IMP B1: крупные поля, много стрелок, мало одиночек-заглушек ----
test('баланс: стрелок без хвостов нет — 0 одиночек (IMP B1.5, референс)', () => {
  for (const n of [2, 3, 8, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 130, 150, 160, 180, 200]) {
    const lvl = WG.generator.makeLevel(n);
    const singles = lvl.arrows.filter((a) => a.cells.length === 1).length;
    assert.strictEqual(singles, 0, `уровень ${n}: ${singles} стрелок без хвоста`);
  }
});

test('плотность: пустых клеток почти нет — добивка и доминошки (IMP B1.8)', () => {
  for (const n of [2, 5, 15, 25, 40, 60, 90, 110, 150, 200]) {
    const lvl = WG.generator.makeLevel(n);
    const allowed = lvl.mask ? lvl.mask.join('').split('#').length - 1 : lvl.w * lvl.h;
    const cells = lvl.arrows.reduce((s, a) => s + a.cells.length, 0);
    const empty = allowed - cells;
    assert.ok(empty / allowed <= 0.1, `уровень ${n}: пустых клеток ${empty} из ${allowed} (> 10%)`);
  }
});

test('баланс: стрелок достаточно и они не короче порога (IMP B1/B1.5/B1.8)', () => {
  const rows = [
    // [n, минимум стрелок, минимальная средняя длина] — плотная упаковка даёт 75–145 стрелок
    [2, 50, 3],
    [8, 50, 3],
    [15, 50, 3],
    [25, 50, 3],
    [40, 50, 3],
    [60, 50, 3],
    [90, 50, 3],
    [110, 50, 3],
    [200, 50, 3],
  ];
  for (const [n, minArrows, minAvg] of rows) {
    const lvl = WG.generator.makeLevel(n);
    const avg = lvl.arrows.reduce((s, a) => s + a.cells.length, 0) / lvl.arrows.length;
    assert.ok(lvl.arrows.length >= minArrows, `уровень ${n}: стрелок ${lvl.arrows.length} < ${minArrows}`);
    assert.ok(avg >= minAvg, `уровень ${n}: средняя длина ${avg.toFixed(2)} < ${minAvg}`);
  }
});

// ---- лабиринт (IMP B1.6): глубина цепочек и мало «бесплатных» тапов ----
test('лабиринт: глубокие цепочки и мало «бесплатных» тапов (IMP B1.8, по метрикам референса)', () => {
  // Референс (уровень 2): initialFree ~6%, maxChain ~21. Наши пороги — с запасом на сиды
  for (const [n, minRounds, maxFreePct] of [[2, 8, 30], [20, 9, 30], [40, 9, 30], [60, 9, 30], [110, 10, 30], [160, 10, 30]]) {
    const lvl = WG.generator.makeLevel(n);
    const m = WG.solver.solve(lvl);
    const pct = (100 * m.initialFree) / lvl.arrows.length;
    assert.ok(m.rounds >= minRounds, `уровень ${n}: rounds ${m.rounds} < ${minRounds}`);
    assert.ok(pct <= maxFreePct, `уровень ${n}: свободных ${pct.toFixed(0)}% > ${maxFreePct}%`);
    assert.ok(m.maxChain >= 8, `уровень ${n}: maxChain ${m.maxChain} < 8 — цепочки не той глубины`);
  }
});

// ---- рендер (чистые функции, без canvas) ----
test('layout: поле целиком внутри экрана, по центру горизонтально, между HUD и панелью', () => {
  for (const [cw, ch, w, h] of [[375, 667, 12, 16], [1024, 768, 14, 18], [360, 640, 3, 3]]) {
    const L = WG.render.layout(cw, ch, w, h);
    assert.ok(L.cell >= 4);
    assert.ok(L.ox >= 0 && L.ox + L.cell * w <= cw, `по ширине не влезает ${cw}x${ch}`);
    assert.ok(L.oy >= 90, 'поле заходит на HUD');
    assert.ok(L.oy + L.cell * h <= ch - 110, 'поле заходит на панель бустеров');
    assert.ok(Math.abs(L.ox - (cw - L.cell * w - L.ox)) <= 1, 'поле не по центру');
  }
});

test('subPolyline: концы — интерполяция по дробным индексам, середина — целые точки', () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }];
  const res = WG.render.subPolyline(pts, 1.5, 3.25);
  assert.deepStrictEqual(res.map((p) => p.x), [1.5, 2, 3, 3.25]);
  assert.ok(res.every((p) => p.y === 0));
  // Окно за концом массива не падает
  const tail = WG.render.subPolyline(pts, 3.5, 4.5);
  assert.strictEqual(tail[tail.length - 1].x, 4);
});

test('shade: осветление и затемнение hex-цвета', () => {
  assert.strictEqual(WG.render.shade('#000000', 0), 'rgb(0,0,0)');
  assert.strictEqual(WG.render.shade('#ffffff', -1), 'rgb(0,0,0)');
  assert.strictEqual(WG.render.shade('#000000', 1), 'rgb(255,255,255)');
});

test('arrowPoints: окно скользит по расширенному пути, голова уходит за край', () => {
  const geo = { cells: [[0, 0], [1, 0]], dir: 'R', color: 0, rayLen: 2 };
  const p0 = WG.render.arrowPoints(geo, 0);
  assert.deepStrictEqual(p0.map((p) => p.x), [0, 1]);
  const p2 = WG.render.arrowPoints(geo, 2);
  assert.deepStrictEqual(p2.map((p) => p.x), [2, 3]);
  const p5 = WG.render.arrowPoints(geo, 5);
  assert.deepStrictEqual(p5.map((p) => p.x), [5, 6]); // за краем поля, ещё видна
  // Отскок (easeOutBack) даёт t < 0: не падаем, прижимаемся к хвосту
  const pNeg = WG.render.arrowPoints(geo, -0.3);
  assert.deepStrictEqual(pNeg.map((p) => p.x), [0, 1]);
});

// ---- ввод ----
test('hitTest: попадание в занятую клетку и допуск промаха у границы', () => {
  const lvl = level(3, 1, [{ id: 7, cells: [[0, 0], [1, 0]], color: 0 }]);
  const board = new WG.level.Board(lvl);
  const L = { ox: 0, oy: 0, cell: 10 };
  assert.strictEqual(WG.input.hitTest(board, L, 15, 5), 7);       // внутри клетки (1,0)
  assert.strictEqual(WG.input.hitTest(board, L, 25, 5), -1);      // пусто, далеко от границы
  assert.strictEqual(WG.input.hitTest(board, L, 21, 5), 7);       // пусто (2,0), палец у левой границы = у стрелки
  assert.strictEqual(WG.input.hitTest(board, L, 26, 5), -1);      // пусто, но далеко (0.6 клетки)
  assert.strictEqual(WG.input.hitTest(board, L, -5, 5), -1);      // за полем
  assert.strictEqual(WG.input.hitTest(board, L, 40, 5), -1);
});

test('hitTest: две соседние занятые стрелки в пустой клетке — промах', () => {
  const lvl = level(3, 3, [
    { id: 0, cells: [[0, 1]], dir: 'U', color: 0 },
    { id: 1, cells: [[2, 1]], dir: 'U', color: 1 },
  ]);
  const board = new WG.level.Board(lvl);
  const L = { ox: 0, oy: 0, cell: 10 };
  assert.strictEqual(WG.input.hitTest(board, L, 15, 15), -1);
});

// ---- анимации ----
test('anim: твин, таймер и частицы', () => {
  const A = new WG.anim.Anim();
  const o = { x: 0 };
  let done = 0;
  A.tween(o, 'x', 10, 1, { onDone: () => done++ });
  A.update(0.5);
  assert.strictEqual(o.x, 5);
  A.update(0.5);
  assert.strictEqual(o.x, 10);
  assert.strictEqual(done, 1);

  let fired = false;
  A.after(0.2, () => { fired = true; });
  A.update(0.1);
  assert.strictEqual(fired, false);
  A.update(0.1);
  assert.strictEqual(fired, true);

  A.emit({ x: 0, y: 0, vx: 1, vy: 0, life: 0.2, color: '#fff', size: 0.1 });
  A.update(0.1);
  assert.strictEqual(A.particles.length, 1);
  assert.strictEqual(A.particles[0].x, 0.1);
  A.update(0.2);
  assert.strictEqual(A.particles.length, 0);
  assert.strictEqual(A.isBusy(), false);
});

// ---- этап 6: форс-удаление, экономика, сохранение ----
test('forceRemove убирает стрелку без проверки луча и возвращает её геометрию', () => {
  const lvl = level(4, 1, [
    { id: 0, cells: [[0, 0], [1, 0]], color: 3 }, // заблокирована
    { id: 1, cells: [[3, 0]], dir: 'R', color: 1 },
  ]);
  const board = new WG.level.Board(lvl);
  const geo = board.forceRemove(0);
  assert.deepStrictEqual(geo, { cells: [[0, 0], [1, 0]], dir: 'R', color: 3, rayLen: 2 });
  assert.strictEqual(board.arrowAt(0, 0), -1);
  assert.strictEqual(board.alive.has(0), false);
  assert.strictEqual(board.forceRemove(0), null);
});

test('экономика: звёзды по ошибкам, награда ×3 у босса, сундук каждые 10', () => {
  assert.strictEqual(WG.levels.starsFor(0), 3);
  assert.strictEqual(WG.levels.starsFor(1), 2);
  assert.strictEqual(WG.levels.starsFor(2), 1);
  assert.strictEqual(WG.levels.rewardFor(3, false), 25);
  assert.strictEqual(WG.levels.rewardFor(1, true), 45);
  assert.strictEqual(WG.levels.isChest(10), true);
  assert.strictEqual(WG.levels.isChest(11), false);
});

// Подменяем localStorage: в Node его нет
function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

test('storage: пустое хранилище → дефолты; испорченный JSON → дефолты', () => {
  window.localStorage = fakeStorage();
  assert.deepStrictEqual(WG.storage.load(), WG.storage.defaults());
  window.localStorage = fakeStorage({ [WG.storage.KEY]: '{не json' });
  assert.deepStrictEqual(WG.storage.load(), WG.storage.defaults());
});

test('storage: частичное сохранение дополняется дефолтами, мусор отбрасывается', () => {
  window.localStorage = fakeStorage({
    [WG.storage.KEY]: JSON.stringify({ level: 12, coins: -5, settings: { theme: 'wool', sound: 'да' } }),
  });
  const s = WG.storage.load();
  assert.strictEqual(s.level, 12);
  assert.strictEqual(s.coins, 50); // мусор → стартовые монеты
  assert.strictEqual(s.settings.theme, 'wool');
  assert.strictEqual(s.settings.sound, true);
  assert.deepStrictEqual(s.boosters, { hint: 3, scissors: 1 });
});

test('storage: save → load возвращает то же; reset стирает', () => {
  window.localStorage = fakeStorage();
  const data = WG.storage.defaults();
  data.coins = 240;
  data.stars = { 1: 3, 2: 2 };
  WG.storage.save(data);
  assert.deepStrictEqual(WG.storage.load(), data);
  WG.storage.reset();
  assert.deepStrictEqual(WG.storage.load(), WG.storage.defaults());
});

test('storage: недоступный localStorage не роняет игру', () => {
  window.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.deepStrictEqual(WG.storage.load(), WG.storage.defaults());
  WG.storage.save(WG.storage.defaults());
  WG.storage.reset();
});

// ---- звук ----
test('серия ходов: тон растёт при ходах < 1.2 с друг за другом, до +7, и сбрасывается', () => {
  let c = 0;
  let at = -Infinity;
  const step = (now) => { c = WG.audio.nextCombo(c, at, now); at = now; return c; };
  assert.strictEqual(step(10), 0);     // первый ход
  assert.strictEqual(step(10.5), 1);   // быстро
  assert.strictEqual(step(11.0), 2);
  for (let i = 0; i < 10; i++) step(11 + i * 0.5);
  assert.strictEqual(c, 7);            // потолок
  assert.strictEqual(step(30), 0);     // пауза сбрасывает
});

// ---- раннер ----
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log('  ok    ' + t.name);
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + t.name + '\n        ' + e.message.split('\n')[0]);
  }
}

if (failed) {
  console.log(`\n${failed} из ${tests.length} тестов упали`);
  process.exit(1);
}

// Таблица для глаз: выборочные уровни
console.log('\n   n   поле    стрелок  rounds  initialFree  maxChain');
for (const n of [1, 2, 3, 4, 5, 10, 11, 20, 30, 31, 45, 60, 61, 80, 100, 101, 120, 150, 200]) {
  const lvl = WG.generator.makeLevel(n);
  const res = WG.solver.solve(lvl);
  const size = `${lvl.w}×${lvl.h}`.padEnd(7);
  console.log(
    `${String(n).padStart(4)}   ${size} ${String(lvl.arrows.length).padStart(7)}  ` +
    `${String(res.rounds).padStart(6)}  ${String(res.initialFree).padStart(11)}  ${String(res.maxChain).padStart(8)}`
  );
}

console.log(`\n${tests.length} тестов\nALL TESTS PASSED`);
