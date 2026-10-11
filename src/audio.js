(function (WG) {
  'use strict';

  // Звук синтезируется через WebAudio, без файлов (раздел 10 плана)
  const state = { sound: true, music: true, haptics: true, effects: true, theme: 'neon' };
  let ctx = null;
  let master = null;
  let noise = null;
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

  // ---- музыка: спокойный lo-fi, синтез без файлов ----
  //
  // Джазовый круг ii–V–I–vi (Dm9 – G13 – Cmaj9 – Am9), 70 BPM, один аккорд на такт.
  // Электропиано (мягкая атака, долгое затухание) играет аккорд на 1 и на «и» второй доли,
  // бас — корень на 1 и 3, мелодия — редкие ноты пентатоники с эхом. Нотная лента
  // планируется на ~0.3 с вперёд по часам AudioContext (без дрожания таймеров).

  const BPM = 70;
  const BEAT = 60 / BPM;
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const PROGRESSION = [
    { bass: 38, keys: [53, 57, 60, 64] }, // Dm9:   F A C E над D
    { bass: 43, keys: [53, 57, 59, 64] }, // G13:   F A B E над G
    { bass: 36, keys: [52, 55, 59, 62] }, // Cmaj9: E G B D над C
    { bass: 45, keys: [55, 59, 60, 64] }, // Am9:   G B C E над A
  ];
  const MELODY = [69, 72, 74, 76, 79, 81]; // пентатоника C/Am

  let music = null; // { bus, timer, nextTime, step, last }

  function musicBus() {
    // Шина: мягкий фильтр + эхо → master
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    lp.Q.value = 0.3;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    const echoIn = ctx.createGain();
    echoIn.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(lp);
    bus.connect(lp);
    lp.connect(master);
    return { bus, echoIn };
  }

  // Электропиано: синус + тихий треугольник октавой выше, экспоненциальное затухание
  function keyNote(m, t, dur, vol) {
    const f = midi(m);
    for (const [type, mul, v] of [['sine', 1, 1], ['triangle', 2, 0.18]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f * mul, t);
      osc.detune.setValueAtTime((Math.random() - 0.5) * 6, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * v, t + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(music.bus);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  function bassNote(m, t, dur) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(midi(m), t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(music.bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Колокольчик мелодии: синус с лёгким вибрато, часть сигнала уходит в эхо
  function bellNote(m, t, vol) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(midi(m), t);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 2.5;
    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(g);
    g.connect(music.bus);
    g.connect(music.echoIn);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 1.5);
    lfo.stop(t + 1.5);
  }

  // Одна восьмая: step считает восьмые с начала, 8 восьмых = такт
  function scheduleStep(step, t) {
    const bar = Math.floor(step / 8) % PROGRESSION.length;
    const e = step % 8;
    const chord = PROGRESSION[bar];
    if (e === 0) {
      chord.keys.forEach((m, i) => keyNote(m, t + i * 0.012, BEAT * 3.2, 0.11));
      bassNote(chord.bass, t, BEAT * 1.8);
    }
    if (e === 3) chord.keys.forEach((m, i) => keyNote(m, t + i * 0.01, BEAT * 2, 0.07));
    if (e === 4) bassNote(chord.bass + 12 * (Math.random() < 0.3 ? 1 : 0), t, BEAT * 1.4);
    // Мелодия: редкие ноты, чаще на сильных восьмых, без резких скачков
    const p = e % 2 === 0 ? 0.32 : 0.14;
    if (Math.random() < p) {
      const prev = music.last;
      let k = prev === null ? 2 : prev + Math.round((Math.random() - 0.5) * 3);
      k = Math.max(0, Math.min(MELODY.length - 1, k));
      music.last = k;
      bellNote(MELODY[k], t + (e % 2 ? 0.03 : 0), 0.09);
    }
  }

  function startMusic() {
    // Запуск только в running-контексте: если контекст ещё не создан (не было жеста)
    // или suspended, ноты копились бы на замороженном currentTime и разом сыграли
    // при первом тапе. Создание контекста — дело onFirstGesture (план §10).
    if (!ctx || ctx.state !== 'running' || !state.music) return;
    if (!music) {
      music = { ...musicBus(), timer: null, nextTime: 0, step: 0, last: null };
    }
    if (music.timer) return;
    const now = ctx.currentTime;
    music.bus.gain.cancelScheduledValues(now);
    music.bus.gain.setValueAtTime(Math.max(0.0001, music.bus.gain.value), now);
    music.bus.gain.linearRampToValueAtTime(0.55, now + 1.5); // плавное появление
    music.nextTime = now + 0.1;
    music.timer = setInterval(() => {
      const ahead = ctx.currentTime + 0.3;
      while (music.nextTime < ahead) {
        scheduleStep(music.step++, music.nextTime);
        music.nextTime += BEAT / 2;
      }
    }, 100);
  }

  function stopMusic() {
    if (!music || !music.timer) return;
    clearInterval(music.timer);
    music.timer = null;
    // Уже запланированные ноты гасим плавным уводом громкости шины
    const now = ctx.currentTime;
    music.bus.gain.cancelScheduledValues(now);
    music.bus.gain.setValueAtTime(Math.max(0.0001, music.bus.gain.value), now);
    music.bus.gain.linearRampToValueAtTime(0.0001, now + 0.4);
  }

  // Приложение свёрнуто — замолкаем полностью; вернулось — продолжаем
  function suspend() {
    stopMusic();
    if (ctx && ctx.state === 'running') ctx.suspend();
  }

  function resume() {
    if (!ctx) return;
    const go = () => { if (state.music) startMusic(); };
    if (ctx.state === 'suspended') ctx.resume().then(go, () => {});
    else go();
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
    document.addEventListener('visibilitychange', () => (document.hidden ? suspend() : resume()));

    // Клик по любой кнопке — короткий «поп»
    document.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('button')) play('pop');
    }, true);
  }

  WG.audio = { setOptions, play, exitSound, vibrate, nextCombo, suspend, resume, state };

})(window.WG = window.WG || {});
