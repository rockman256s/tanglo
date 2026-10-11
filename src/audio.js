(function (WG) {
  'use strict';

  // Звук синтезируется через WebAudio, без файлов (раздел 10 плана)
  const state = { sound: true, music: true, haptics: true, theme: 'neon' };
  let ctx = null;
  let master = null;
  let noise = null;
  let musicGain = null;
  let musicTimer = null;
  let combo = 0;
  let lastExitAt = -Infinity;

  // Серия быстрых ходов (< 1.2 с между ними): каждый следующий — на полтона выше, до +7
  // Чистая функция: возвращает новое значение серии
  function nextCombo(prevCombo, prevAt, now) {
    if (now - prevAt < 1.2) return Math.min(7, prevCombo + 1);
    return 0;
  }

  // Контекст создаём при первом жесте: иначе браузер заблокирует звук
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      ctx = null;
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);

    // Буфер белого шума для свуша
    const len = Math.floor(ctx.sampleRate * 0.3);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function unlock() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // Огибающая: быстрая атака, экспоненциальный спад
  function envelope(gainNode, t0, dur, vol) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.linearRampToValueAtTime(vol, t0 + 0.005);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function tone(type, f0, f1, dur, vol, when = 0) {
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    envelope(g, t0, dur, vol);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Свуш: полосовой фильтр, частота скользит вверх. Тон сдвигается серией; Wool — мягче
  function swoosh(semitones) {
    const soft = state.theme === 'wool';
    const mul = Math.pow(2, semitones / 12);
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    const f0 = (soft ? 250 : 400) * mul;
    const f1 = (soft ? 1200 : 2000) * mul;
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.exponentialRampToValueAtTime(f1, t0 + 0.2);
    const g = ctx.createGain();
    envelope(g, t0, 0.22, soft ? 0.25 : 0.4);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + 0.25);
  }

  // Звук выезда стрелки с учётом серии быстрых ходов
  function exitSound() {
    if (!state.sound || !ensure()) return;
    unlock();
    const now = performance.now() / 1000;
    combo = nextCombo(combo, lastExitAt, now);
    lastExitAt = now;
    swoosh(combo);
  }

  const SOUNDS = {
    thud() {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, t0);
      osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.15);
      envelope(g, t0, 0.15, 0.6);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + 0.17);
    },
    pop() {
      tone('sine', 600, 600, 0.06, 0.25);
    },
    win() {
      // Арпеджио C5 E5 G5 C6 треугольной волной
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('triangle', f, f, 0.35, 0.3, i * 0.11));
    },
    lose() {
      // Две ноты вниз
      tone('triangle', 330, 330, 0.25, 0.3, 0);
      tone('triangle', 220, 220, 0.4, 0.3, 0.22);
    },
  };

  function play(name) {
    if (!state.sound || !ensure()) return;
    unlock();
    if (name === 'swoosh') swoosh(0);
    else if (SOUNDS[name]) SOUNDS[name]();
  }

  // ---- музыка: тихий эмбиент-луп из четырёх аккордов ----

  const CHORDS = [
    [261.63, 329.63, 392.0], // C
    [220.0, 261.63, 329.63], // Am
    [174.61, 220.0, 261.63], // F
    [196.0, 246.94, 293.66], // G
  ];

  function playChord(chord) {
    const t0 = ctx.currentTime;
    for (const f of chord) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.5, t0 + 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 1.9);
      osc.connect(g);
      g.connect(musicGain);
      osc.start(t0);
      osc.stop(t0 + 2);
    }
  }

  function startMusic() {
    // Запуск только в running-контексте: если контекст ещё не создан (не было жеста)
    // или suspended, аккорды копились бы на замороженном currentTime и разом сыграли
    // при первом тапе. Создание контекста — дело onFirstGesture (план §10).
    if (!ctx || ctx.state !== 'running' || musicTimer || !state.music) return;
    if (!musicGain) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 800;
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.05;
      musicGain.connect(lp);
      lp.connect(master);
    }
    let i = 0;
    playChord(CHORDS[i++ % CHORDS.length]);
    musicTimer = setInterval(() => {
      playChord(CHORDS[i++ % CHORDS.length]);
    }, 2000);
  }

  function stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  }

  // Вибрация — только если включено и поддерживается (iOS Safari без navigator.vibrate — тихо пропускаем)
  function vibrate(pattern) {
    if (!state.haptics) return;
    try {
      navigator.vibrate?.(pattern);
    } catch (e) {
      // не поддерживается — ничего не делаем
    }
  }

  // Настройки из save.settings
  function setOptions(opts) {
    Object.assign(state, opts);
    if (state.music) startMusic();
    else stopMusic();
  }

  // Первый жест пользователя: создаём контекст и запускаем музыку, если она включена
  function onFirstGesture() {
    ensure();
    unlock();
    if (state.music) startMusic();
  }
  // В Node (тесты) документа нет: слушателей не вешаем
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', onFirstGesture, { once: true, capture: true });
    document.addEventListener('keydown', onFirstGesture, { once: true, capture: true });

    // Клик по любой кнопке — короткий «поп»
    document.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('button')) play('pop');
    }, true);
  }

  WG.audio = { setOptions, play, exitSound, vibrate, nextCombo, state };

})(window.WG = window.WG || {});
