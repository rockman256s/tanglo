(function (WG) {
  'use strict';

  const KEY = 'wazegame.save.v1';

  function defaults() {
    return {
      level: 1,
      stars: {},
      coins: 0,
      boosters: { hint: 3, scissors: 1 },
      settings: { sound: true, music: true, haptics: true, effects: true, theme: 'neon', lang: 'auto' },
    };
  }

  // Слияние с дефолтом: новые поля появляются, испорченные значения отбрасываются
  function merge(data) {
    const d = defaults();
    if (!data || typeof data !== 'object') return d;
    const num = (v, fb) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : fb);
    return {
      level: num(data.level, d.level) || 1,
      stars: data.stars && typeof data.stars === 'object' ? { ...data.stars } : d.stars,
      coins: num(data.coins, d.coins),
      boosters: {
        hint: num(data.boosters && data.boosters.hint, d.boosters.hint),
        scissors: num(data.boosters && data.boosters.scissors, d.boosters.scissors),
      },
      settings: {
        sound: typeof (data.settings && data.settings.sound) === 'boolean' ? data.settings.sound : d.settings.sound,
        music: typeof (data.settings && data.settings.music) === 'boolean' ? data.settings.music : d.settings.music,
        haptics: typeof (data.settings && data.settings.haptics) === 'boolean' ? data.settings.haptics : d.settings.haptics,
        effects: typeof (data.settings && data.settings.effects) === 'boolean' ? data.settings.effects : d.settings.effects,
        theme: data.settings && (data.settings.theme === 'neon' || data.settings.theme === 'wool')
          ? data.settings.theme : d.settings.theme,
        lang: data.settings && ['auto', 'en', 'ru'].includes(data.settings.lang) ? data.settings.lang : d.settings.lang,
      },
    };
  }

  // localStorage может отсутствовать или бросать исключения (приватный режим, заблокированные данные)
  function load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw ? merge(JSON.parse(raw)) : defaults();
    } catch (e) {
      return defaults();
    }
  }

  function save(data) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      // Не сохранилось — игра продолжается без сохранения
    }
  }

  function reset() {
    try {
      window.localStorage.removeItem(KEY);
    } catch (e) {
      // см. save
    }
  }

  WG.storage = { KEY, defaults, merge, load, save, reset };

})(window.WG = window.WG || {});
