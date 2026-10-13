(function (WG) {
  'use strict';

  // HTML-слой поверх канваса: меню, HUD, бустеры, карта, настройки, модальные окна.
  // Кнопки — не на канвасе (раздел 9.1). Логика — в main.js, здесь только отрисовка и вызовы handlers
  const t = (key, params) => WG.t(key, params);
  let handlers = {};
  let menuEl, hudEl, bottomEl, panelEl, overlayEl, cardEl, toastEl;
  let hudLevel, hudHearts, hudCoins, hudPause;
  let btnHint, btnScissors, btnRestart;
  let panelTitle, panelBody;
  let menuPlay, menuSubtitle, menuBtnLevels, menuBtnSettings, panelBack;
  let toastTimer = null;

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function button(label, cls, onClick) {
    const b = h('button', 'btn ' + (cls || ''), label);
    b.addEventListener('click', onClick);
    return b;
  }

  function init(h2) {
    handlers = h2;

    // Меню
    menuEl = h('div', 'screen menu hidden');
    menuSubtitle = h('p', 'subtitle', t('subtitle'));
    menuEl.append(h('h1', 'logo', 'TANGLO'), menuSubtitle);
    menuPlay = button('', 'btn-big', () => handlers.onPlay());
    const row = h('div', 'menu-row');
    menuBtnLevels = button(t('levels'), 'btn-ghost', () => handlers.onMap());
    menuBtnSettings = button(t('settings'), 'btn-ghost', () => handlers.onSettings());
    row.append(menuBtnLevels, menuBtnSettings);
    menuEl.append(menuPlay, row);

    // HUD сверху
    hudEl = h('div', 'hud hidden');
    hudPause = button('⚙️', 'icon-btn', () => handlers.onPause());
    const center = h('div', 'hud-center');
    hudLevel = h('div', 'hud-level');
    center.append(hudLevel);
    const right = h('div', 'hud-right');
    hudHearts = h('div', 'hud-hearts');
    hudCoins = h('div', 'hud-coins');
    right.append(hudHearts, hudCoins);
    hudEl.append(hudPause, center, right);

    // Панель бустеров снизу
    bottomEl = h('div', 'bottom hidden');
    btnHint = button('', 'booster', () => handlers.onHint());
    btnScissors = button('', 'booster', () => handlers.onScissors());
    btnRestart = button('↺', 'booster', () => handlers.onRestart());
    bottomEl.append(btnHint, btnScissors, btnRestart);

    // Полноэкранные панели: карта уровней и настройки
    panelEl = h('div', 'panel hidden');
    const head = h('div', 'panel-head');
    panelBack = button(t('back'), 'btn-ghost btn-small', () => handlers.onBack());
    head.append(panelBack);
    panelTitle = h('h2', 'panel-title');
    head.append(panelTitle);
    panelBody = h('div', 'panel-body');
    panelEl.append(head, panelBody);

    // Модальные окна
    overlayEl = h('div', 'overlay hidden');
    cardEl = h('div', 'card');
    overlayEl.append(cardEl);

    toastEl = h('div', 'toast hidden');

    document.body.append(menuEl, hudEl, bottomEl, panelEl, overlayEl, toastEl);
  }

  // Смена языка: подписи, созданные один раз в init
  function relabel() {
    menuSubtitle.textContent = t('subtitle');
    menuBtnLevels.textContent = t('levels');
    menuBtnSettings.textContent = t('settings');
    panelBack.textContent = t('back');
  }

  function showScreen(name) {
    menuEl.classList.toggle('hidden', name !== 'menu');
    panelEl.classList.toggle('hidden', name !== 'map' && name !== 'settings');
    const inGame = name === 'game';
    hudEl.classList.toggle('hidden', !inGame);
    bottomEl.classList.toggle('hidden', !inGame);
    if (!inGame) hideOverlay();
  }

  function showMenu(levelNumber) {
    menuPlay.textContent = t('play', { n: levelNumber });
    showScreen('menu');
  }

  function setHud({ levelNumber, boss, hearts, maxHearts, coins }) {
    hudLevel.textContent = boss ? t('boss') : t('level', { n: levelNumber });
    hudHearts.textContent = '❤️'.repeat(hearts) + '🖤'.repeat(Math.max(0, maxHearts - hearts));
    hudCoins.textContent = `🪙 ${coins}`;
  }

  // Бейдж: количество, если есть; иначе цена в монетах
  function boosterLabel(icon, count, price) {
    return count > 0 ? `${icon} ${count}` : `${icon} ${price}🪙`;
  }

  function setBoosters({ hint, scissors, hintPrice, scissorsPrice, armed }) {
    btnHint.textContent = boosterLabel('💡', hint, hintPrice);
    btnScissors.textContent = boosterLabel('✂️', scissors, scissorsPrice);
    btnScissors.classList.toggle('armed', !!armed);
  }

  function hideOverlay() {
    overlayEl.classList.add('hidden');
  }

  // Карточка: заголовок, строки текста (строка или Node), кнопки [{label, onClick, disabled}]
  function showCard(title, lines, buttons) {
    cardEl.textContent = '';
    cardEl.append(h('h1', 'card-title', title));
    for (const line of lines) {
      cardEl.append(line instanceof Node ? line : h('p', 'card-text', line));
    }
    const row = h('div', 'card-buttons');
    for (const b of buttons) {
      const btn = button(b.label, b.cls || '', () => {
        hideOverlay();
        b.onClick();
      });
      if (b.disabled) btn.disabled = true;
      row.append(btn);
    }
    cardEl.append(row);
    overlayEl.classList.remove('hidden');
  }

  function showWin({ stars, reward, coins, chest, nextLabel }) {
    const lines = [h('div', 'card-stars', '★'.repeat(stars) + '☆'.repeat(3 - stars))];
    if (reward > 0) lines.push(t('reward', { reward, coins }));
    else lines.push(t('coinsTotal', { coins }));
    if (chest) lines.push(t('chest'));
    showCard(t('winTitle'), lines, [
      { label: nextLabel || t('next'), cls: 'btn-big', onClick: handlers.onNext },
      { label: t('toMenu'), cls: 'btn-ghost', onClick: handlers.onMenu },
    ]);
  }

  function showLose({ coins, continuePrice }) {
    showCard(t('loseTitle'), [t('loseText')], [
      {
        label: t('continueFor', { price: continuePrice }),
        cls: 'btn-big',
        disabled: coins < continuePrice,
        onClick: handlers.onContinue,
      },
      { label: t('retry'), cls: 'btn-ghost', onClick: handlers.onRetry },
    ]);
  }

  // Быстрые переключатели в паузе: карточка не закрывается, кнопка сразу показывает новое состояние
  function quickToggles(settings) {
    const row = h('div', 'menu-row quick-toggles');
    for (const [key, on, off] of [['music', '🎵', '🎵'], ['sound', '🔊', '🔇'], ['effects', '✨', '✨']]) {
      const b = button(settings[key] ? on : off, 'icon-btn ' + (settings[key] ? 'btn-on' : 'btn-off'), () => {
        handlers.onSetting(key, !settings[key]);
      });
      b.title = t(key);
      row.append(b);
    }
    return row;
  }

  function showPause(settings) {
    showCard(t('pause'), settings ? [quickToggles(settings)] : [], [
      { label: t('resume'), cls: 'btn-big', onClick: handlers.onResume },
      { label: t('retry'), cls: 'btn-ghost', onClick: handlers.onRetry },
      { label: t('toMenu'), cls: 'btn-ghost', onClick: handlers.onMenu },
    ]);
  }

  function showConfirm(text, onYes) {
    showCard(t('confirmTitle'), [text], [
      { label: t('yes'), cls: 'btn-big', onClick: onYes },
      { label: t('cancel'), cls: 'btn-ghost', onClick: () => {} },
    ]);
  }

  // Карта уровней: пройденные со звёздами, текущий — пульсирует, будущие — замок
  function showMap({ current, stars }) {
    panelTitle.textContent = t('levels');
    panelBody.textContent = '';
    const count = Math.ceil((current + 19) / 10) * 10;
    const grid = h('div', 'level-grid');
    for (let n = 1; n <= count; n++) {
      const cls = n < current ? 'done' : n === current ? 'current' : 'locked';
      const cell = h('button', 'lvl ' + cls);
      if (cls === 'locked') {
        cell.textContent = '🔒';
        cell.disabled = true;
      } else {
        cell.append(h('span', 'lvl-num', String(n)));
        const s = stars[n] || 0;
        if (s > 0) cell.append(h('span', 'lvl-stars', '★'.repeat(s)));
        cell.addEventListener('click', () => handlers.onPickLevel(n));
      }
      grid.append(cell);
    }
    panelBody.append(grid);
    showScreen('map');
  }

  function showSettings(settings, { hasProgress }) {
    panelTitle.textContent = t('settings');
    panelBody.textContent = '';
    const list = h('div', 'settings');

    const toggle = (label, key) => {
      const on = settings[key];
      list.append(button(`${label}: ${on ? t('on') : t('off')}`, on ? 'btn-on' : 'btn-off', () => {
        handlers.onSetting(key, !on);
      }));
    };
    toggle(t('music'), 'music');
    const styleRow = h('div', 'menu-row');
    for (const [name, label] of [['lofi', 'Lo-fi'], ['ambient', 'Ambient']]) {
      styleRow.append(button(label, settings.musicStyle === name ? 'btn-on' : 'btn-off', () => {
        handlers.onSetting('musicStyle', name);
      }));
    }
    list.append(h('p', 'settings-label', t('musicStyle')), styleRow);
    if (settings.musicStyle === 'lofi') {
      const stationRow = h('div', 'menu-row');
      for (const name of ['chill', 'night', 'cafe', 'tape']) {
        stationRow.append(button(t('station_' + name), settings.musicStation === name ? 'btn-on' : 'btn-off', () => {
          handlers.onSetting('musicStation', name);
        }));
      }
      list.append(h('p', 'settings-label', t('station')), stationRow);
    }
    toggle(t('sound'), 'sound');
    toggle(t('effects'), 'effects');
    toggle(t('haptics'), 'haptics');
    toggle(t('hard'), 'hard');
    list.append(h('p', 'settings-label', t('hardHelp')));

    const themeRow = h('div', 'menu-row');
    for (const [name, label] of [['neon', 'Neon'], ['wool', 'Wool']]) {
      themeRow.append(button(label, settings.theme === name ? 'btn-on' : 'btn-off', () => {
        handlers.onSetting('theme', name);
      }));
    }
    list.append(h('p', 'settings-label', t('theme')), themeRow);

    const langRow = h('div', 'menu-row');
    const current = settings.lang || 'auto';
    for (const [code, label] of [['auto', t('langAuto')], ['en', 'English'], ['ru', 'Русский']]) {
      langRow.append(button(label, current === code ? 'btn-on' : 'btn-off', () => {
        handlers.onSetting('lang', code);
      }));
    }
    list.append(h('p', 'settings-label', t('language')), langRow);

    if (hasProgress) {
      list.append(button(t('resetProgress'), 'btn-danger', () => {
        showConfirm(t('resetText'), handlers.onResetProgress);
      }));
    }
    panelBody.append(list);
    showScreen('settings');
  }

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 1500);
  }

  WG.ui = {
    init,
    showScreen,
    showMenu,
    setHud,
    setBoosters,
    showWin,
    showLose,
    showPause,
    showMap,
    showSettings,
    relabel,
    hideOverlay,
    toast,
  };

})(window.WG = window.WG || {});
