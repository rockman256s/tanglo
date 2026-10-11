(function (WG) {
  'use strict';

  // Готовые уровни из генератора (core/). Паки — JS-файлы levels/pack-NNNN.js, которые вызывают
  // WG.levelPacks.add(...): так они грузятся и в браузере, и в Android WebView с file://
  // (fetch там к файлам не пускают). Индекс levels/index.js подключается в index.html.
  // Нет индекса или уровень за его пределами — игра берёт процедурный генератор.

  let index = null; // { packSize, count }
  const packs = new Map(); // номер пака → { from, to, levels }
  const loading = new Map(); // номер пака → Promise

  const packOf = (n) => Math.floor((n - 1) / index.packSize);

  function setIndex(ix) {
    index = ix;
  }

  function add(pack) {
    packs.set(Math.floor((pack.from - 1) / index.packSize), pack);
  }

  // Уровень есть в паках (уровни из HAND в levels.js — туториал — остаются за игрой)
  function covers(n) {
    return !!index && n >= 1 && n <= index.count && !WG.levels.HAND[n];
  }

  function ready(n) {
    return covers(n) && packs.has(packOf(n));
  }

  function load(n) {
    if (!covers(n)) return Promise.reject(new Error('нет в паках'));
    const p = packOf(n);
    if (packs.has(p)) return Promise.resolve();
    if (!loading.has(p)) {
      loading.set(p, new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'levels/pack-' + String(p).padStart(4, '0') + '.js';
        s.onload = () => (packs.has(p) ? resolve() : reject(new Error('пустой пак')));
        s.onerror = () => {
          loading.delete(p);
          reject(new Error('пак не загрузился'));
        };
        document.head.append(s);
      }));
    }
    return loading.get(p);
  }

  // Уровень в формате WG.level.Board; boss — по правилу игры (levels.paramsFor)
  function get(n) {
    if (!ready(n)) return null;
    const pack = packs.get(packOf(n));
    const level = WG.levelCodec.decode(pack.levels[n - pack.from], n);
    level.boss = WG.levels.paramsFor(n).boss;
    return level;
  }

  WG.levelPacks = { setIndex, add, covers, ready, load, get };

})(window.WG = window.WG || {});
