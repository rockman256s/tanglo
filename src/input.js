(function (WG) {
  'use strict';

  const MISS_TOLERANCE = 0.25; // допуск промаха в долях клетки
  const TAP_SLOP_PX = 8;       // сдвиг меньше этого — тап, больше — пан
  const TAP_MAX_MS = 500;      // удержание дольше — не тап
  const DOUBLE_TAP_MS = 300;   // окно двойного тапа
  const MIN_SCALE = 1;         // меньше «вписанного» не нужно
  const MAX_SCALE = 2.5;       // предел увеличения по умолчанию
  // Для больших полей предел поднимает игра (setMaxScale): при полном зуме клетка должна быть
  // не меньше пальца, иначе на поле 30×50 по стрелкам не попасть
  let maxScale = MAX_SCALE;
  function setMaxScale(v) {
    maxScale = Math.max(MIN_SCALE, v);
  }
  const WHEEL_STEP = 1.15;     // шаг колеса мыши

  // ---- чистая view-математика (юнит-тесты в tools/test.js) ----
  // view = { scale, tx, ty }: экран = мир * scale + t; мир — координаты layout при scale = 1

  // Экранные CSS-пиксели канваса → мировые координаты
  function screenToWorld(view, px, py) {
    return { x: (px - view.tx) / view.scale, y: (py - view.ty) / view.scale };
  }

  // Вид не даёт полю (bw×bh мировых px) вылезти за канвас; если поле влезает — вид нейтрален
  // (layout уже центрирует поле, пановать в запас смысла нет)
  function clampView(view, bw, bh, cssW, cssH) {
    const scale = Math.max(MIN_SCALE, Math.min(maxScale, view.scale));
    const axis = (t, size, screen) => {
      if (size * scale <= screen) return 0;
      return Math.min(0, Math.max(screen - size * scale, t));
    };
    return { scale, tx: axis(view.tx, bw, cssW), ty: axis(view.ty, bh, cssH) };
  }

  // Пинч: масштаб относительно точки щипка — мир под серединой пальцев не уезжает
  function pinchView(base, baseMid, baseDist, mid, dist, bw, bh, cssW, cssH) {
    const scale = Math.max(MIN_SCALE, Math.min(maxScale, base.scale * dist / Math.max(1, baseDist)));
    const w = screenToWorld(base, baseMid.x, baseMid.y);
    return clampView({ scale, tx: mid.x - w.x * scale, ty: mid.y - w.y * scale }, bw, bh, cssW, cssH);
  }

  // Колесо мыши: зум к курсору
  function wheelView(view, cx, cy, deltaY, bw, bh, cssW, cssH) {
    const scale = Math.max(MIN_SCALE, Math.min(maxScale, view.scale * (deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP)));
    const w = screenToWorld(view, cx, cy);
    return clampView({ scale, tx: cx - w.x * scale, ty: cy - w.y * scale }, bw, bh, cssW, cssH);
  }

  // Пан: сдвиг с клампом к границам поля
  function panView(view, dx, dy, bw, bh, cssW, cssH) {
    return clampView({ scale: view.scale, tx: view.tx + dx, ty: view.ty + dy }, bw, bh, cssW, cssH);
  }

  // Какой стрелке принадлежит мировая точка (px, py). -1 — никакой.
  // Чистая функция: модель и разметка на входе, без DOM
  function hitTest(board, L, px, py) {
    const gx = (px - L.ox) / L.cell;
    const gy = (py - L.oy) / L.cell;
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    if (!board.inside(x, y)) return -1;

    const own = board.arrowAt(x, y);
    if (own !== -1) return own;

    // Клетка пуста: если ровно одна соседняя клетка занята и палец близко к общей границе — берём её
    const fx = gx - x;
    const fy = gy - y;
    const sides = [
      { dx: 0, dy: -1, dist: fy },
      { dx: 1, dy: 0, dist: 1 - fx },
      { dx: 0, dy: 1, dist: 1 - fy },
      { dx: -1, dy: 0, dist: fx },
    ];
    const near = [];
    for (const s of sides) {
      const id = board.arrowAt(x + s.dx, y + s.dy);
      if (id !== -1) near.push({ id, dist: s.dist });
    }
    if (near.length === 1 && near[0].dist < MISS_TOLERANCE) return near[0].id;
    return -1;
  }

  // ---- жесты: тап, пан, пинч, колесо, двойной тап (IMP B5) ----
  function attach(canvas, { getBoard, getLayout, getView, setView, onTap, onResetView }) {
    const pointers = new Map(); // pointerId → {x, y} в CSS-координатах канваса
    let gesture = null;         // {type: 'tap-or-pan'|'pan'|'pinch'|'dead', ...}
    let pinchBase = null;       // {view, mid, dist} на старте щипка
    let lastTap = null;         // {x, y, t} для двойного тапа

    const rel = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const worldSize = () => {
      const b = getBoard();
      const L = getLayout();
      return b ? { bw: L.cell * b.w, bh: L.cell * b.h } : { bw: 0, bh: 0 };
    };
    const applyView = (v) => setView(v);

    function handleTap(p) {
      const now = performance.now();
      if (lastTap && now - lastTap.t < DOUBLE_TAP_MS &&
          Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 24) {
        lastTap = null;
        if (onResetView) onResetView(); // двойной тап — сброс вида (IMP B5)
        return;
      }
      lastTap = { x: p.x, y: p.y, t: now };
      const board = getBoard();
      if (!board) return;
      const w = screenToWorld(getView(), p.x, p.y);
      const id = hitTest(board, getLayout(), w.x, w.y);
      if (id !== -1) onTap(id);
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (!getBoard()) return; // вне игры жесты не нужны
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
      const p = rel(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchBase = {
          view: { ...getView() },
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        };
        gesture = { type: 'pinch' };
      } else if (pointers.size === 1) {
        gesture = { type: 'tap-or-pan', start: p, last: p, t0: performance.now(), moved: 0 };
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = rel(e);
      pointers.set(e.pointerId, p);
      const { bw, bh } = worldSize();
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (gesture && gesture.type === 'pinch' && pointers.size >= 2 && pinchBase) {
        const [a, b] = [...pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        applyView(pinchView(pinchBase.view, pinchBase.mid, pinchBase.dist, mid, dist, bw, bh, cssW, cssH));
      } else if (gesture && (gesture.type === 'tap-or-pan' || gesture.type === 'pan')) {
        const dx = p.x - gesture.last.x;
        const dy = p.y - gesture.last.y;
        gesture.moved += Math.hypot(dx, dy);
        gesture.last = p;
        if (gesture.type === 'tap-or-pan' && gesture.moved > TAP_SLOP_PX) gesture.type = 'pan';
        if (gesture.type === 'pan') {
          applyView(panView(getView(), dx, dy, bw, bh, cssW, cssH));
        }
      }
    });

    const finish = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = rel(e);
      pointers.delete(e.pointerId);
      if (gesture && gesture.type === 'pinch') {
        // после щипка оставшийся палец не тапает и не панит — ждём отпускания
        if (pointers.size < 2) gesture = { type: 'dead' };
        return;
      }
      if (gesture && gesture.type === 'tap-or-pan' && pointers.size === 0) {
        const dt = performance.now() - gesture.t0;
        if (gesture.moved <= TAP_SLOP_PX && dt < TAP_MAX_MS) handleTap(p);
      }
      if (pointers.size === 0) gesture = null;
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    // Колесо мыши — зум к курсору (десктоп)
    canvas.addEventListener('wheel', (e) => {
      if (!getBoard()) return;
      e.preventDefault();
      const p = rel(e);
      const { bw, bh } = worldSize();
      applyView(wheelView(getView(), p.x, p.y, e.deltaY, bw, bh, canvas.clientWidth, canvas.clientHeight));
    }, { passive: false });
  }

  WG.input = {
    hitTest,
    attach,
    screenToWorld,
    clampView,
    setMaxScale,
    pinchView,
    wheelView,
    panView,
    MISS_TOLERANCE,
    MIN_SCALE,
    MAX_SCALE,
  };

})(window.WG = window.WG || {});
