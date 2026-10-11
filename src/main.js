(function (WG) {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const P = WG.levels.PRICES;
  const save = WG.storage.load();

  const game = {
    screen: 'menu',     // menu | game | map | settings
    levelNumber: save.level,
    board: null,
    boss: false,
    state: 'playing',   // playing | paused | won | lost
    hearts: WG.MAX_HEARTS,
    mistakes: 0,
    moves: 0,
    cssW: 0,
    cssH: 0,
    vis: new Map(),     // id стрелки → визуальное состояние (t, alpha, scale, flash, hint)
    ghosts: [],         // стрелки вне модели, которые ещё анимируются
    locked: new Set(),  // стрелки, которые сейчас «бьются» о блок
    shake: 0,           // остаток тряски, сек
    hintArrowId: null,
    scissorsArmed: false,
    anim: new WG.anim.Anim(),
    save,               // прогресс: level, stars, coins, boosters, settings
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const theme = () => WG.themes[save.settings.theme];
  // Вид канваса: зум/пан для плотных полей (IMP B5). экран = мир * scale + t
  const view = { scale: 1, tx: 0, ty: 0 };
  function resetView() {
    view.scale = 1;
    view.tx = 0;
    view.ty = 0;
  }

  // Предел зума: при полном увеличении клетка ≈ 44 CSS-px (размер пальца), но не меньше 2.5×
  const FINGER_PX = 44;
  function updateZoomLimit() {
    if (!game.board || !game.cssW) return;
    WG.input.setMaxScale(Math.max(2.5, Math.min(8, FINGER_PX / layout().cell)));
  }

  function persist() {
    WG.storage.save(save);
  }

  function layout() {
    return WG.render.layout(game.cssW, game.cssH, game.board.w, game.board.h);
  }

  function geoOf(arrow) {
    return {
      cells: arrow.cells,
      dir: game.board.dirOf(arrow),
      color: arrow.color,
      rayLen: game.board.ray(arrow).length,
    };
  }

  function refreshHud() {
    WG.ui.setHud({
      levelNumber: game.levelNumber,
      boss: game.boss,
      hearts: game.hearts,
      maxHearts: WG.MAX_HEARTS,
      coins: save.coins,
    });
  }

  function refreshBoosters() {
    WG.ui.setBoosters({
      hint: save.boosters.hint,
      scissors: save.boosters.scissors,
      hintPrice: P.hint,
      scissorsPrice: P.scissors,
      armed: game.scissorsArmed,
    });
  }

  // Бустер расходуем: сначала запас, иначе платим монетами. false — не хватает
  function useCharge(kind) {
    const price = kind === 'hint' ? P.hint : P.scissors;
    if (save.boosters[kind] > 0) {
      save.boosters[kind]--;
      return true;
    }
    if (save.coins >= price) {
      save.coins -= price;
      return true;
    }
    return false;
  }

  // ---- экраны ----

  function showMenu() {
    game.screen = 'menu';
    game.state = 'playing';
    game.anim = new WG.anim.Anim();
    WG.ui.showMenu(save.level);
  }

  function openMap() {
    game.screen = 'map';
    WG.ui.showMap({ current: save.level, stars: save.stars });
  }

  function openSettings() {
    game.screen = 'settings';
    WG.ui.showSettings(save.settings, { hasProgress: true });
  }

  function setSetting(key, value) {
    save.settings[key] = value;
    persist();
    WG.audio.setOptions(save.settings);
    if (key === 'theme') draw();
    if (key === 'effects' && !value) {
      game.shake = 0;
      if (game.anim) game.anim.particles = [];
    }
    // Из паузы — обновляем карточку паузы, из экрана настроек — экран настроек
    if (game.screen === 'game' && game.state === 'paused') WG.ui.showPause(save.settings);
    else WG.ui.showSettings(save.settings, { hasProgress: true });
  }

  // Визуальные эффекты (тряска, конфетти, искры) можно выключить в настройках
  const fx = () => save.settings.effects !== false;

  function resetProgress() {
    WG.storage.reset();
    const d = WG.storage.defaults();
    for (const k of Object.keys(save)) delete save[k];
    Object.assign(save, d);
    game.levelNumber = save.level;
    showMenu();
  }

  // ---- уровень ----

  function startLevel(n) {
    // Готовые уровни из паков; пак грузится асинхронно — тогда стартуем, когда он придёт.
    // Если пак не загрузился или уровня нет в паках — процедурный генератор игры
    const packs = WG.levelPacks;
    if (packs && packs.covers(n) && !packs.ready(n)) {
      packs.load(n).then(() => startLevel(n), () => startLevelInfo(n, WG.generator.makeLevelInfo(n)));
      return;
    }
    const level = packs && packs.get(n);
    startLevelInfo(n, level ? { level } : WG.generator.makeLevelInfo(n));
    if (packs && packs.covers(n + 1)) packs.load(n + 1).catch(() => {}); // заранее — следующий пак
  }

  let debugTitle = false;

  function startLevelInfo(n, info) {
    if (debugTitle) {
      const src = WG.levelPacks && WG.levelPacks.ready(n) ? 'pack' : 'gen';
      document.title = 'L' + n + ' arrows=' + info.level.arrows.length + ' w=' + info.level.w + ' h=' + info.level.h + ' src=' + src;
    }
    game.levelNumber = n;
    game.boss = !!info.level.boss;
    game.board = new WG.level.Board(info.level);
    resetView();
    updateZoomLimit(); // новый уровень — вид сброшен (IMP B5)
    game.screen = 'game';
    game.state = 'playing';
    game.hearts = WG.MAX_HEARTS;
    game.mistakes = 0;
    game.moves = 0;
    game.vis = new Map();
    game.ghosts = [];
    game.locked = new Set();
    game.shake = 0;
    game.hintArrowId = null;
    game.scissorsArmed = false;
    game.anim = new WG.anim.Anim();

    // Появление: стрелки по очереди (раздел 8.4)
    [...game.board.alive.keys()].forEach((id, i) => {
      const v = { t: 0, alpha: 1, scale: 0, flash: 0, hint: 0 };
      game.vis.set(id, v);
      game.anim.tween(v, 'scale', 1, 0.25, {
        delay: Math.min(i * 0.015, 0.55),
        ease: 'easeOutBack',
      });
    });

    WG.ui.showScreen('game');
    refreshHud();
    refreshBoosters();
  }

  function pause() {
    if (game.state !== 'playing' || game.screen !== 'game') return;
    game.state = 'paused';
    WG.ui.showPause(save.settings);
  }

  function resume() {
    if (game.state === 'paused') game.state = 'playing';
  }

  function toMenu() {
    showMenu();
  }

  // ---- ввод ----

  function onTap(id) {
    if (game.state !== 'playing' || game.screen !== 'game') return;
    if (game.scissorsArmed) {
      cut(id);
      return;
    }
    if (game.locked.has(id)) return;
    const arrow = game.board.alive.get(id);
    if (!arrow) return;

    const geo = geoOf(arrow);
    const res = game.board.tap(id);
    if (!res) return;
    game.moves++;
    if (game.hintArrowId === id) game.hintArrowId = null;

    if (res.type === 'exit') onExit(id, geo, res);
    else onBlocked(id, res);

    refreshHud();
  }

  // Успех: стрелка уезжает; модель уже без неё
  function onExit(id, geo, res) {
    const L = geo.cells.length;
    const ghost = {
      geo: { ...geo, rayLen: res.rayLen, fade: true },
      vis: { t: 0, alpha: 1, scale: 1, flash: 0 },
      trail: 0,
    };
    game.vis.delete(id);
    game.ghosts.push(ghost);

    const dur = clamp((L + res.rayLen) / 22, 0.25, 0.7);
    game.anim.tween(ghost.vis, 't', L + res.rayLen, dur, {
      ease: 'easeInQuad',
      onDone: () => {
        game.ghosts = game.ghosts.filter((g) => g !== ghost);
      },
    });

    WG.audio.exitSound();
    WG.audio.vibrate(10);
    if (game.board.isCleared()) game.anim.after(0.6, win);
  }

  // Блок: стрелка «бьётся», теряем сердечко, блокирующая мигает красным
  function onBlocked(id, res) {
    game.hearts--;
    game.mistakes++;
    game.locked.add(id);
    WG.audio.play('thud');
    WG.audio.vibrate([30, 40, 30]);

    const v = game.vis.get(id);
    const dist = res.dist;
    const peak = dist - 1 + 0.3;
    game.anim.tween(v, 't', peak, 0.12 + dist * 0.03, {
      ease: 'easeOutQuad',
      onDone: () => {
        game.anim.tween(v, 't', 0, 0.18, {
          ease: 'easeOutBack',
          onDone: () => game.locked.delete(id),
        });
      },
    });
    v.flash = 1;
    game.anim.tween(v, 'flash', 0, 0.6);

    const blocker = game.vis.get(res.blockerId);
    if (blocker) {
      blocker.flash = 1;
      game.anim.tween(blocker, 'flash', 0, 0.6);
    }

    if (fx()) game.shake = 0.25;
    if (game.hearts === 0) game.anim.after(0.7, lose);
  }

  // ---- бустеры ----

  function useHint() {
    if (game.state !== 'playing' || game.screen !== 'game') return;
    if (game.hintArrowId !== null) return;
    const id = WG.solver.hint(game.board);
    if (id === null) {
      WG.ui.toast('Подсказки нет');
      return;
    }
    if (!useCharge('hint')) {
      WG.ui.toast(`Не хватает монет: ${P.hint}🪙`);
      return;
    }
    game.hintArrowId = id;
    persist();
    refreshBoosters();
    refreshHud();
  }

  function armScissors() {
    if (game.state !== 'playing' || game.screen !== 'game') return;
    if (game.scissorsArmed) {
      game.scissorsArmed = false;
      refreshBoosters();
      return;
    }
    if (save.boosters.scissors === 0 && save.coins < P.scissors) {
      WG.ui.toast(`Не хватает монет: ${P.scissors}🪙`);
      return;
    }
    game.scissorsArmed = true;
    refreshBoosters();
    WG.ui.toast('Тап по стрелке — она уберётся без потери сердечка');
  }

  // Ножницы: стрелка распадается на частицы, модель меняется без проверки луча
  function cut(id) {
    const arrow = game.board.alive.get(id);
    if (!arrow) return;
    if (!useCharge('scissors')) {
      game.scissorsArmed = false;
      refreshBoosters();
      return;
    }
    game.scissorsArmed = false;
    const geo = geoOf(arrow);
    game.board.forceRemove(id);
    game.vis.delete(id);
    if (game.hintArrowId === id) game.hintArrowId = null;

    const ghost = {
      geo: { cells: geo.cells, dir: geo.dir, color: geo.color, rayLen: geo.rayLen, fade: false },
      vis: { t: 0, alpha: 1, scale: 1, flash: 0 },
      trail: 0,
    };
    game.ghosts.push(ghost);
    game.anim.tween(ghost.vis, 'alpha', 0, 0.4, {
      ease: 'easeOutQuad',
      onDone: () => {
        game.ghosts = game.ghosts.filter((g) => g !== ghost);
      },
    });
    game.anim.tween(ghost.vis, 'scale', 0.4, 0.4, { ease: 'easeOutQuad' });

    const pal = theme().palette;
    if (fx()) for (const [x, y] of geo.cells) {
      for (let k = 0; k < 3; k++) {
        game.anim.emit({
          x,
          y,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          g: 4,
          life: 0.5 + Math.random() * 0.3,
          color: pal[geo.color % pal.length],
          size: 0.1,
        });
      }
    }

    WG.audio.play('swoosh');
    WG.audio.vibrate(10);
    persist();
    refreshBoosters();
    refreshHud();
    if (game.board.isCleared()) game.anim.after(0.6, win);
  }

  // ---- итоги уровня ----

  function win() {
    if (game.state !== 'playing' || game.screen !== 'game') return;
    game.state = 'won';
    const n = game.levelNumber;
    const stars = WG.levels.starsFor(game.mistakes);
    const fresh = n >= save.level; // первое прохождение: награда и продвижение

    save.stars[n] = Math.max(save.stars[n] || 0, stars);
    let reward = 0;
    let chest = false;
    if (fresh) {
      reward = WG.levels.rewardFor(stars, game.boss);
      save.coins += reward;
      save.level = n + 1;
      if (WG.levels.isChest(n)) {
        chest = true;
        save.boosters.hint += 1;
        save.boosters.scissors += 1;
        save.coins += 100;
      }
    }
    persist();
    confetti();
    WG.audio.play('win');
    WG.audio.vibrate([20, 30, 20, 30, 60]);
    refreshHud();
    refreshBoosters();
    WG.ui.showWin({ stars, reward, coins: save.coins, chest });
  }

  function lose() {
    if (game.state !== 'playing' || game.screen !== 'game') return;
    game.state = 'lost';
    WG.audio.play('lose');
    WG.audio.vibrate([60, 60, 120]);
    WG.ui.showLose({ coins: save.coins, continuePrice: P.continue });
  }

  function onContinue() {
    if (save.coins < P.continue) return;
    save.coins -= P.continue;
    game.hearts = 1;
    game.state = 'playing';
    persist();
    refreshHud();
  }

  // Конфетти 80 штук, «волна» от центра по пустым клеткам
  function confetti() {
    if (!fx()) return;
    const pal = theme().palette;
    const cx = (game.board.w - 1) / 2;
    const cy = (game.board.h - 1) / 2;
    const empties = [];
    for (let y = 0; y < game.board.h; y++) {
      for (let x = 0; x < game.board.w; x++) {
        if (game.board.allowed(x, y) && game.board.arrowAt(x, y) === -1) {
          empties.push({ x, y, d: Math.hypot(x - cx, y - cy) });
        }
      }
    }
    empties.sort((a, b) => a.d - b.d);
    const count = 80;
    for (let i = 0; i < count; i++) {
      const src = empties.length ? empties[Math.floor(i * empties.length / count)] : { x: cx, y: cy, d: 0 };
      game.anim.after(src.d * 0.03, () => {
        game.anim.emit({
          x: src.x,
          y: src.y,
          vx: (Math.random() - 0.5) * 6,
          vy: -(2 + Math.random() * 4),
          g: 8,
          life: 1.2 + Math.random() * 0.6,
          color: pal[i % pal.length],
          size: 0.12,
        });
      });
    }
  }

  // След за уезжающей стрелкой: искры (neon) или ворсинки (wool)
  function emitTrail(g, dt) {
    g.trail += dt;
    const t = theme();
    while (g.trail > 0.05 && g.vis.t < g.geo.rayLen + g.geo.cells.length) {
      g.trail -= 0.05;
      const pts = WG.render.arrowPoints(g.geo, g.vis.t);
      const head = pts[pts.length - 1];
      const neon = t.style === 'neon';
      game.anim.emit({
        x: head.x,
        y: head.y,
        vx: (Math.random() - 0.5) * (neon ? 2 : 0.8),
        vy: (Math.random() - 0.5) * (neon ? 2 : 0.8),
        g: 0,
        life: neon ? 0.35 : 0.6,
        color: t.palette[g.geo.color % t.palette.length],
        size: neon ? 0.06 : 0.12,
      });
    }
  }

  // ---- отрисовка и цикл ----

  function draw(now = performance.now()) {
    const t = theme();
    WG.render.drawFrame(ctx, game.cssW, game.cssH, t);
    if (game.screen !== 'game') {
      WG.render.drawDecor(ctx, game.cssW, game.cssH, t, now);
      return;
    }
    const L = layout();
    ctx.save();
    // При зуме поле не залезает под HUD и панель бустеров
    if (view.scale > 1) {
      ctx.beginPath();
      ctx.rect(0, WG.render.PLAY_TOP, game.cssW, game.cssH - WG.render.PLAY_TOP - WG.render.PLAY_BOTTOM);
      ctx.clip();
    }
    if (game.shake > 0) {
      const a = 4 * (game.shake / 0.25);
      ctx.translate((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a);
    }
    // Зум/пан (IMP B5): поле и стрелки рисуются в мировых координатах
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);
    if (game.boss) WG.render.drawBossFrame(ctx, game.board, L);
    WG.render.drawBoard(ctx, game.board, t, L, game.vis);
    for (const g of game.ghosts) WG.render.drawArrowState(ctx, L, g.geo, g.vis, t);
    WG.render.drawParticles(ctx, game.anim.particles, L, t);
    ctx.restore();
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    game.cssW = window.innerWidth;
    game.cssH = window.innerHeight;
    canvas.style.width = game.cssW + 'px';
    canvas.style.height = game.cssH + 'px';
    canvas.width = Math.round(game.cssW * dpr);
    canvas.height = Math.round(game.cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Вид клампится к новым границам (IMP B5)
    updateZoomLimit();
    if (game.board) {
      const L = layout();
      Object.assign(view, WG.input.clampView(
        view, L.cell * game.board.w, L.cell * game.board.h, game.cssW, game.cssH
      ));
    }
    draw();
  }

  let last = performance.now();
  function frame(now) {
    // Следующий кадр планируем первым: ошибка в отрисовке не должна останавливать игру
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (game.state !== 'paused') {
      game.anim.update(dt);
      if (fx()) for (const g of game.ghosts) emitTrail(g, dt);
    }
    game.shake = Math.max(0, game.shake - dt);
    if (game.hintArrowId !== null) {
      const v = game.vis.get(game.hintArrowId);
      if (v) v.hint = 0.5 + 0.5 * Math.sin(now / 200);
    }
    draw(now);
  }

  // ---- запуск ----

  // Системная кнопка «Назад» (Android-обёртка): true — обработали, false — можно выходить
  WG.back = function () {
    if (game.screen === 'game') {
      if (game.state === 'playing') pause();
      else if (game.state === 'paused') { WG.ui.hideOverlay(); resume(); }
      else toMenu();
      return true;
    }
    if (game.screen === 'map' || game.screen === 'settings') {
      showMenu();
      return true;
    }
    return false;
  };

  WG.game = game; // для отладки из консоли
  WG.audio.setOptions(save.settings);
  WG.ui.init({
    onPlay: () => startLevel(save.level),
    onMap: openMap,
    onSettings: openSettings,
    onBack: showMenu,
    onPause: pause,
    onResume: resume,
    onRestart: () => startLevel(game.levelNumber),
    onRetry: () => startLevel(game.levelNumber),
    onMenu: toMenu,
    onNext: () => startLevel(game.levelNumber + 1),
    onContinue,
    onHint: useHint,
    onScissors: armScissors,
    onPickLevel: startLevel,
    onSetting: setSetting,
    onResetProgress: resetProgress,
  });
  WG.input.attach(canvas, {
    getBoard: () => (game.screen === 'game' ? game.board : null),
    getLayout: layout,
    getView: () => view,
    setView: (v) => Object.assign(view, v),
    onResetView: resetView,
    onTap,
  });

  // Отладочные клавиши (PLAN §12) — только при ?debug=1:
  // N — следующий уровень, L — прыжок на номер уровня, T — тема
  const debugQuery = new URLSearchParams(location.search);
  if (debugQuery.get('debug') === '1') {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'n' || k === 'т') {
        startLevel(game.levelNumber + 1);
      } else if (k === 'l' || k === 'д') {
        const n = Number(window.prompt('Номер уровня:', String(game.levelNumber)));
        if (Number.isInteger(n) && n >= 1 && n <= 9999) startLevel(n);
      } else if (k === 't' || k === 'е') {
        setSetting('theme', save.settings.theme === 'neon' ? 'wool' : 'neon');
      }
    });
  }

  const debugJump = Number(debugQuery.get('level'));
  if (debugQuery.get('debug') === '1' && Number.isInteger(debugJump) && debugJump >= 1 && debugJump <= 9999) {
    // Диагностика headless-скриншотов: факт в title (попадает в --dump-dom).
    // Уровень из пака стартует асинхронно — title пишет startLevelInfo
    debugTitle = true;
    startLevel(debugJump);
  } else {
    showMenu();
  }
  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);

})(window.WG);
