(function (WG) {
  'use strict';

  // Локализация интерфейса. Язык: настройка 'auto' | 'en' | 'ru'; 'auto' — по языку устройства
  // (русский для ru-*, во всех остальных случаях английский).
  const DICT = {
    en: {
      subtitle: 'Untangle the arrows',
      play: 'Level {n} ▶',
      levels: 'Levels',
      settings: 'Settings',
      back: '‹ Back',
      level: 'Level {n}',
      boss: '💀 BOSS',
      winTitle: 'Great!',
      reward: '+{reward} 🪙 (total {coins})',
      coinsTotal: 'Coins: {coins}',
      chest: '🎁 Chest: +1 💡, +1 ✂️, +100 🪙',
      next: 'Next ▶',
      toMenu: 'Menu',
      loseTitle: 'Out of lives',
      loseText: 'Continue or start over?',
      continueFor: 'Continue (+1❤️) for {price}🪙',
      retry: 'Restart',
      pause: 'Paused',
      resume: 'Resume',
      confirmTitle: 'Are you sure?',
      yes: 'Yes',
      cancel: 'Cancel',
      music: 'Music',
      sound: 'Sounds',
      effects: 'Effects',
      haptics: 'Vibration',
      on: 'on',
      off: 'off',
      theme: 'Theme',
      language: 'Language',
      langAuto: 'Auto',
      resetProgress: 'Reset progress',
      resetText: 'Progress, coins and stars will be deleted.',
      noHint: 'No hint available',
      noCoins: 'Not enough coins: {price}🪙',
      scissorsHelp: 'Tap an arrow — it is removed without losing a heart',
      levelPrompt: 'Level number:',
    },
    ru: {
      subtitle: 'Распутай стрелки',
      play: 'Уровень {n} ▶',
      levels: 'Уровни',
      settings: 'Настройки',
      back: '‹ Назад',
      level: 'Уровень {n}',
      boss: '💀 БОСС',
      winTitle: 'Отлично!',
      reward: '+{reward} 🪙 (всего {coins})',
      coinsTotal: 'Всего монет: {coins}',
      chest: '🎁 Сундук: +1 💡, +1 ✂️, +100 🪙',
      next: 'Дальше ▶',
      toMenu: 'В меню',
      loseTitle: 'Нет жизней',
      loseText: 'Продолжить или начать заново?',
      continueFor: 'Продолжить (+1❤️) за {price}🪙',
      retry: 'Заново',
      pause: 'Пауза',
      resume: 'Продолжить',
      confirmTitle: 'Точно?',
      yes: 'Да',
      cancel: 'Отмена',
      music: 'Музыка',
      sound: 'Звуки',
      effects: 'Эффекты',
      haptics: 'Вибрация',
      on: 'вкл',
      off: 'выкл',
      theme: 'Тема',
      language: 'Язык',
      langAuto: 'Авто',
      resetProgress: 'Сбросить прогресс',
      resetText: 'Прогресс, монеты и звёзды будут удалены.',
      noHint: 'Подсказки нет',
      noCoins: 'Не хватает монет: {price}🪙',
      scissorsHelp: 'Тап по стрелке — она уберётся без потери сердечка',
      levelPrompt: 'Номер уровня:',
    },
  };

  const LANGS = ['en', 'ru'];
  let setting = 'auto';
  let lang = 'en';

  // Язык устройства → поддерживаемый язык. Чистая функция (тесты в tools/test.js)
  function detect(preferred) {
    for (const tag of preferred || []) {
      const code = String(tag).toLowerCase().split('-')[0];
      if (LANGS.includes(code)) return code;
    }
    return 'en';
  }

  function deviceLanguages() {
    if (typeof navigator === 'undefined') return [];
    return navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  }

  function setLanguage(value) {
    setting = value === 'en' || value === 'ru' ? value : 'auto';
    lang = setting === 'auto' ? detect(deviceLanguages()) : setting;
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }

  // Строка по ключу с подстановкой {имя}. Нет перевода — английский, нет ключа — сам ключ
  function t(key, params) {
    const s = DICT[lang][key] ?? DICT.en[key] ?? key;
    return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m)) : s;
  }

  setLanguage('auto');

  WG.i18n = { t, detect, setLanguage, LANGS, DICT, get lang() { return lang; }, get setting() { return setting; } };
  WG.t = t;

})(window.WG = window.WG || {});
