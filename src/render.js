(function (WG) {
  'use strict';

  const TAU = Math.PI * 2;
  const PAD = 16;       // отступ поля от краёв
  const TOP = 90;       // высота HUD сверху
  const BOTTOM = 110;   // высота панели бустеров снизу
  // Толщина тела стрелки в долях клетки (IMP B2, референс ~0.3)
  const BODY_LW = { neon: 0.3, wool: 0.32 };
  const lwOf = (theme, cell) => cell * (BODY_LW[theme.style] || 0.3);

  // Поле вписывается в область между HUD и панелью бустеров; сохраняем {ox, oy, cell} для ввода
  function layout(cssW, cssH, w, h) {
    const availW = Math.max(1, cssW - PAD * 2);
    const availH = Math.max(1, cssH - TOP - BOTTOM - PAD * 2);
    const cell = Math.max(4, Math.floor(Math.min(availW / w, availH / h)));
    const ox = Math.round((cssW - cell * w) / 2);
    const oy = Math.round(TOP + PAD + (availH - cell * h) / 2);
    return { ox, oy, cell };
  }

  function center(L, x, y) {
    return { x: L.ox + (x + 0.5) * L.cell, y: L.oy + (y + 0.5) * L.cell };
  }

  // Часть ломаной между дробными индексами from и to (для анимации, раздел 7.4 плана)
  function subPolyline(points, from, to) {
    const res = [];
    const last = points.length - 1;
    const lerp = (raw) => {
      const i = Math.max(0, Math.min(last, raw));
      const i0 = Math.floor(i);
      const i1 = Math.min(i0 + 1, last);
      const f = i - i0;
      return {
        x: points[i0].x + (points[i1].x - points[i0].x) * f,
        y: points[i0].y + (points[i1].y - points[i0].y) * f,
      };
    };
    res.push(lerp(from));
    for (let k = Math.floor(from) + 1; k < to; k++) res.push(points[k]);
    res.push(lerp(to));
    return res;
  }

  // Смешивание hex-цвета с целевым (t = 0..1): t>0 к белому, t<0 к чёрному
  function shade(hex, t) {
    const n = parseInt(hex.slice(1), 16);
    const target = t >= 0 ? 255 : 0;
    const k = Math.abs(t);
    const ch = (v) => Math.round(v + (target - v) * k);
    const r = ch((n >> 16) & 255);
    const g = ch((n >> 8) & 255);
    const b = ch(n & 255);
    return `rgb(${r},${g},${b})`;
  }

  function tracePath(ctx, pts) {
    ctx.beginPath();
    if (pts.length === 1) {
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[0].x + 0.01, pts[0].y);
      return;
    }
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }

  // Наконечник: основание на голове, вершина вперёд по dir
  function headTriangle(ctx, head, dir, cell) {
    const d = WG.DIRS[dir];
    const px = -d.dy;
    const py = d.dx;
    const half = cell * 0.275; // основание 0.55 клетки (IMP B2)
    const len = cell * 0.36;
    ctx.beginPath();
    ctx.moveTo(head.x + d.dx * len, head.y + d.dy * len);
    ctx.lineTo(head.x + px * half, head.y + py * half);
    ctx.lineTo(head.x - px * half, head.y - py * half);
    ctx.closePath();
    ctx.fill();
  }

  function drawNeon(ctx, pts, head, dir, color, cell, lw) {
    // Свечение: ломаная с тенью
    ctx.shadowBlur = cell * 0.4;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    tracePath(ctx, pts);
    ctx.stroke();
    headTriangle(ctx, head, dir, cell);

    // Без тени: тонкая светлая линия — «неоновая трубка»
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = lw * 0.25;
    tracePath(ctx, pts);
    ctx.stroke();

    ctx.fillStyle = shade(color, 0.35);
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, lw * 0.45, 0, TAU);
    ctx.fill();
  }

  function drawWool(ctx, pts, head, dir, color, cell, lw) {
    // Мягкая тень снизу
    ctx.shadowColor = 'rgba(60,40,20,0.25)';
    ctx.shadowBlur = cell * 0.12;
    ctx.shadowOffsetY = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    tracePath(ctx, pts);
    ctx.stroke();
    headTriangle(ctx, head, dir, cell);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Штриховка «пряжи»: пунктир более тёмным оттенком поверх тела
    ctx.save();
    ctx.globalAlpha *= 0.35;
    ctx.strokeStyle = shade(color, -0.35);
    ctx.lineWidth = lw * 0.8;
    ctx.setLineDash([2, cell * 0.16]);
    tracePath(ctx, pts);
    ctx.stroke();
    ctx.restore();

    // Узелок на конце вместо острого наконечника
    ctx.fillStyle = shade(color, -0.2);
    ctx.beginPath();
    ctx.arc(head.x, head.y, lw * 0.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = shade(color, 0.25);
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, lw * 0.45, 0, TAU);
    ctx.fill();
  }

  // Стрелка по точкам (хвост → голова). dir — направление наконечника
  function drawArrowPoints(ctx, pts, dir, color, theme, cell, opts = {}) {
    if (pts.length === 0) return;
    const lw = lwOf(theme, cell);
    const head = pts[pts.length - 1];

    ctx.save();
    ctx.globalAlpha *= opts.alpha === undefined ? 1 : opts.alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (theme.style === 'neon') drawNeon(ctx, pts, head, dir, color, cell, lw);
    else drawWool(ctx, pts, head, dir, color, cell, lw);
    ctx.restore();
  }

  function drawFrame(ctx, cssW, cssH, theme) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  // Сетка и точки пустых клеток; клетки вне маски не рисуем
  function drawField(ctx, board, theme, L) {
    const { cell, ox, oy } = L;
    for (let y = 0; y < board.h; y++) {
      for (let x = 0; x < board.w; x++) {
        if (!board.allowed(x, y)) continue;
        const px = ox + x * cell;
        const py = oy + y * cell;
        ctx.strokeStyle = theme.grid;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
        if (board.arrowAt(x, y) === -1) {
          const c = center(L, x, y);
          ctx.fillStyle = theme.dot;
          ctx.beginPath();
          ctx.arc(c.x, c.y, Math.max(1.5, cell * 0.06), 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  // Расширенный путь стрелки в дробных клетках: тело, луч до края, ещё L+1 клеток за краем
  function extGrid(geo) {
    const n = geo.cells.length;
    const d = WG.DIRS[geo.dir];
    const [hx, hy] = geo.cells[n - 1];
    const ext = geo.cells.map(([x, y]) => ({ x, y }));
    for (let k = 1; k <= geo.rayLen + n + 1; k++) {
      ext.push({ x: hx + d.dx * k, y: hy + d.dy * k });
    }
    return ext;
  }

  // Видимая часть стрелки: окно длиной L, скользящее по расширенному пути (t — позиция головы)
  // t < 0 допустим при отскоке (easeOutBack перелетает ноль) — прижимаем к хвосту
  function arrowPoints(geo, t) {
    const n = geo.cells.length;
    const from = Math.max(0, t);
    return subPolyline(extGrid(geo), from, from + n - 1);
  }

  // Стрелка в произвольном состоянии. vis: {t, alpha, scale, flash}; geo.fade — гаснуть за краем
  function drawArrowState(ctx, L, geo, vis, theme) {
    const t = vis.t || 0;
    const scale = vis.scale === undefined ? 1 : vis.scale;
    if (scale <= 0.01) return;

    let alpha = vis.alpha === undefined ? 1 : vis.alpha;
    if (geo.fade) {
      alpha *= 1 - Math.max(0, (t - geo.rayLen) / geo.cells.length);
      if (alpha <= 0) return;
    }

    let pts = arrowPoints(geo, t).map((p) => center(L, p.x, p.y));
    let cell = L.cell;
    if (scale !== 1) {
      const c = pts.reduce((acc, p) => ({ x: acc.x + p.x / pts.length, y: acc.y + p.y / pts.length }), { x: 0, y: 0 });
      pts = pts.map((p) => ({ x: c.x + (p.x - c.x) * scale, y: c.y + (p.y - c.y) * scale }));
      cell *= scale;
    }

    const color = theme.palette[geo.color % theme.palette.length];
    if (vis.hint > 0) {
      // Подсказка: белый пульсирующий контур
      ctx.save();
      ctx.globalAlpha = alpha * vis.hint * 0.8;
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = lwOf(theme, cell) * 1.6;
      tracePath(ctx, pts);
      ctx.stroke();
      ctx.restore();
    }
    if (vis.flash > 0) {
      // Красный контур под стрелкой (блок)
      ctx.save();
      ctx.globalAlpha = alpha * vis.flash * 0.9;
      ctx.strokeStyle = '#ff3b3b';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = lwOf(theme, cell) * 1.45;
      tracePath(ctx, pts);
      ctx.stroke();
      ctx.restore();
    }
    drawArrowPoints(ctx, pts, geo.dir, color, theme, cell, { alpha });
  }

  function drawParticles(ctx, list, L, theme) {
    ctx.save();
    for (const p of list) {
      const a = Math.max(0, p.life / p.max);
      const [px, py] = [L.ox + (p.x + 0.5) * L.cell, L.oy + (p.y + 0.5) * L.cell];
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (theme.style === 'neon') {
        ctx.shadowBlur = L.cell * 0.3;
        ctx.shadowColor = p.color;
      }
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1, L.cell * p.size), 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // vis — карта id → визуальное состояние (анимации); модель остаётся нетронутой
  // Декор меню: медленно ползущие стрелки на фоне. Раскладка детерминирована (seed)
  function drawDecor(ctx, cssW, cssH, theme, time) {
    const rng = WG.rng(7);
    const cell = Math.max(28, Math.min(cssW, cssH) / 9);
    const count = 9;
    ctx.save();
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < count; i++) {
      const dir = WG.DIR_NAMES[rng.int(0, 3)];
      const len = rng.int(2, 4);
      const bx = rng.next() * cssW;
      const by = rng.next() * cssH;
      const speed = 12 + rng.next() * 18;
      const d = WG.DIRS[dir];
      // Смещение вдоль направления, с заворачиванием по экрану
      const travel = (time * speed / 1000) % (Math.max(cssW, cssH) + cell * 6);
      const offX = d.dx * (travel - cell * 3);
      const offY = d.dy * (travel - cell * 3);
      const x = ((bx + offX) % (cssW + cell * 6) + cssW + cell * 6) % (cssW + cell * 6) - cell * 3;
      const y = ((by + offY) % (cssH + cell * 6) + cssH + cell * 6) % (cssH + cell * 6) - cell * 3;
      const pts = [];
      for (let k = 0; k < len; k++) {
        pts.push({ x: x - d.dx * cell * (len - 1 - k), y: y - d.dy * cell * (len - 1 - k) });
      }
      const color = theme.palette[i % theme.palette.length];
      drawArrowPoints(ctx, pts, dir, color, theme, cell);
    }
    ctx.restore();
  }

  // Босс-уровень: золотая рамка вокруг поля (PLAN §6.1, IMP B3.3)
  function drawBossFrame(ctx, board, L) {
    const gold = '#ffd700';
    ctx.save();
    ctx.strokeStyle = gold;
    ctx.shadowColor = gold;
    ctx.shadowBlur = L.cell * 0.35;
    ctx.lineWidth = Math.max(2, L.cell * 0.08);
    ctx.strokeRect(L.ox, L.oy, board.w * L.cell, board.h * L.cell);
    ctx.restore();
  }

  function drawBoard(ctx, board, theme, L, vis = new Map()) {
    drawField(ctx, board, theme, L);
    for (const arrow of board.alive.values()) {
      const geo = {
        cells: arrow.cells,
        dir: board.dirOf(arrow),
        color: arrow.color,
        rayLen: board.ray(arrow).length,
      };
      drawArrowState(ctx, L, geo, vis.get(arrow.id) || {}, theme);
    }
  }

  WG.render = {
    layout,
    center,
    subPolyline,
    shade,
    drawFrame,
    drawField,
    drawBoard,
    drawBossFrame,
    drawArrowPoints,
    drawArrowState,
    drawParticles,
    drawDecor,
    arrowPoints,
    extGrid,
  };

})(window.WG = window.WG || {});
