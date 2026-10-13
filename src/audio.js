(function (WG) {
  'use strict';

  // Звук синтезируется через WebAudio, без файлов (раздел 10 плана)
  const state = { sound: true, music: true, musicStyle: 'lofi', musicStation: 'chill', haptics: true, effects: true, theme: 'neon' };
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

  // ---- музыка: два стиля — lo-fi (src/lofi.js) и спокойный эмбиент ниже, синтез без файлов ----
  //
  // Восьмитактовый круг в до мажоре (Fmaj7 – C/E – Am7 – Gsus4 – Fmaj7 – Em7 – Dm7 – G), 72 BPM.
  // Тёплый пэд, мягкое FM-электропиано (арпеджио и сочинённая мелодия), бас, общий ревербератор.
  // Четыре части по 8 тактов: вступление → мелодия → мелодия октавой выше → «вдох» без баса.
  // Ноты планируются на ~0.3 с вперёд по часам AudioContext (без дрожания таймеров).

  const BPM = 72;
  const BEAT = 60 / BPM;
  const EIGHTH = BEAT / 2;
  const MUSIC_VOL = 1.2; // громкость шины музыки: пик ≈0.35 до master, тише звуков ходов
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const CHORDS = [
    { bass: 41, pad: [57, 60, 64, 67], arp: [65, 69, 72, 76] }, // Fmaj7
    { bass: 40, pad: [55, 60, 64, 67], arp: [64, 67, 72, 74] }, // C/E
    { bass: 45, pad: [57, 60, 64, 67], arp: [64, 69, 72, 76] }, // Am7
    { bass: 43, pad: [55, 60, 62, 67], arp: [62, 67, 72, 74] }, // Gsus4
    { bass: 41, pad: [57, 60, 64, 67], arp: [65, 69, 72, 76] }, // Fmaj7
    { bass: 40, pad: [55, 59, 62, 64], arp: [64, 67, 71, 74] }, // Em7
    { bass: 38, pad: [57, 60, 62, 65], arp: [62, 65, 69, 72] }, // Dm7
    { bass: 43, pad: [55, 59, 62, 67], arp: [62, 67, 71, 74] }, // G
  ];
  const ARP = [0, 1, 2, 3, 1, 2, 3, 2]; // порядок нот арпеджио по восьмым такта
  // Мелодия на 8 тактов: [восьмая от начала круга, нота, длительность в восьмых]
  const MELODY = [
    [0, 76, 3], [3, 74, 1], [4, 72, 4], [8, 67, 4], [12, 72, 2], [14, 74, 2],
    [16, 76, 6], [22, 79, 2], [24, 74, 8],
    [32, 77, 2], [34, 76, 2], [36, 72, 4], [40, 71, 2], [42, 72, 2], [44, 67, 4],
    [48, 69, 3], [51, 72, 1], [52, 74, 4], [56, 71, 4], [60, 67, 4],
  ];

  let music = null; // живая музыка: движок стиля + { style, timer, nextTime, step }

  // Ревербератор: стерео-импульс из затухающего шума
  function makeReverb(ac, seconds) {
    const len = Math.floor(ac.sampleRate * seconds);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const conv = ac.createConvolver();
    conv.buffer = ir;
    return conv;
  }

  // Шины музыки: dry и rev (вход ревербератора) → out (громкость/плавное появление) → dest
  function createMusic(ac, dest) {
    const out = ac.createGain();
    out.gain.value = 0.0001;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5500;
    const dry = ac.createGain();
    dry.gain.value = 0.8;
    const rev = ac.createGain();
    const conv = makeReverb(ac, 3.2);
    const wet = ac.createGain();
    wet.gain.value = 0.5;
    dry.connect(lp);
    rev.connect(conv);
    conv.connect(wet);
    wet.connect(lp);
    lp.connect(out);
    out.connect(dest);
    return { ac, out, dry, rev };
  }

  // Электропиано: FM-синус (модулятор 1:1, яркость гаснет быстрее громкости)
  function epNote(mu, m, t, dur, vol, send) {
    const { ac } = mu;
    const f = midi(m);
    const car = ac.createOscillator();
    car.frequency.setValueAtTime(f, t);
    const mod = ac.createOscillator();
    mod.frequency.setValueAtTime(f, t);
    const idx = ac.createGain();
    idx.gain.setValueAtTime(f * 1.1, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.9);
    mod.connect(idx);
    idx.connect(car.frequency);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g);
    g.connect(mu.dry);
    const s = ac.createGain();
    s.gain.value = send;
    g.connect(s);
    s.connect(mu.rev);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  // Пэд: по две слегка расстроенные пилы на ноту через тёмный фильтр, медленная атака
  function padChord(mu, notes, t, dur) {
    const { ac } = mu;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    lp.Q.value = 0.4;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.022, t + 1.6);
    g.gain.setValueAtTime(0.022, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.8);
    lp.connect(g);
    g.connect(mu.dry);
    const s = ac.createGain();
    s.gain.value = 0.9;
    g.connect(s);
    s.connect(mu.rev);
    for (const m of notes) {
      for (const cents of [-7, 7]) {
        const osc = ac.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(midi(m), t);
        osc.detune.setValueAtTime(cents, t);
        osc.connect(lp);
        osc.start(t);
        osc.stop(t + dur + 1.9);
      }
    }
  }

  // Бас: синус с тихим треугольником, срезанный сверху
  function bassNote(mu, m, t, dur) {
    const { ac } = mu;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.03, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g);
    g.connect(mu.dry);
    for (const [type, v] of [['sine', 1], ['triangle', 0.35]]) {
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(midi(m), t);
      const og = ac.createGain();
      og.gain.value = v;
      osc.connect(og);
      og.connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  // Одна восьмая. step — номер восьмой с начала; 8 восьмых = такт, 64 = круг, 4 круга = цикл
  function scheduleStep(mu, step, t) {
    const e = step % 8;
    const bar = Math.floor(step / 8) % CHORDS.length;
    const part = Math.floor(step / 64) % 4;
    const chord = CHORDS[bar];
    const human = () => Math.random() * 0.012;
    if (e === 0) {
      padChord(mu, chord.pad, t, BEAT * 4);
      if (part !== 3) bassNote(mu, chord.bass, t + 0.01, BEAT * 3.6);
    }
    // Арпеджио: в 1-й и 4-й частях — четвертями, в остальных — восьмыми
    if (part === 1 || part === 2 || e % 2 === 0) {
      const v = (e === 0 ? 0.11 : 0.075) * (0.85 + Math.random() * 0.3);
      epNote(mu, chord.arp[ARP[e]], t + human(), 1.8, v, 0.35);
    }
    if (part === 1 || part === 2) {
      const pos = step % 64;
      for (const [at, m, len] of MELODY) {
        if (at !== pos) continue;
        const up = part === 2 ? 12 : 0;
        epNote(mu, m + up, t + human(), Math.max(1.6, len * EIGHTH * 1.6), part === 2 ? 0.12 : 0.17, 0.55);
      }
    }
  }

  // Стиль вместе со станцией lo-fi: смена любого из них пересоздаёт движок
  const styleKey = () => (state.musicStyle === 'lofi' ? 'lofi:' + state.musicStation : state.musicStyle);

  // Движок стиля: { out, stepDur, vol, schedule(step, t), dispose(t) }
  function createEngine(style, ac, dest) {
    const [name, st] = style.split(':');
    if (name === 'lofi' && WG.lofi) return WG.lofi.createEngine(ac, dest, Math.floor(Math.random() * 2 ** 31), st);
    const mu = createMusic(ac, dest);
    return { ...mu, stepDur: EIGHTH, vol: MUSIC_VOL, schedule: (step, t) => scheduleStep(mu, step, t), dispose() {} };
  }

  // Оффлайн-рендер для проверки (громкость, пики): play/test не используют
  function renderMusic(seconds, sampleRate = 44100, style = styleKey()) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ac = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);
    const en = createEngine(style, ac, ac.destination);
    en.out.gain.value = en.vol;
    for (let step = 0, t = 0.05; t < seconds - 0.5; step++, t += en.stepDur) en.schedule(step, t);
    return ac.startRendering();
  }

  function startMusic() {
    // Запуск только в running-контексте: если контекст ещё не создан (не было жеста)
    // или suspended, ноты копились бы на замороженном currentTime и разом сыграли
    // при первом тапе. Создание контекста — дело onFirstGesture (план §10).
    if (!ctx || ctx.state !== 'running' || !state.music) return;
    if (music && music.style !== styleKey()) dropMusic();
    if (!music) {
      const style = styleKey();
      music = { ...createEngine(style, ctx, master), style, timer: null, nextTime: 0, step: 0 };
    }
    if (music.timer) return;
    const now = ctx.currentTime;
    music.out.gain.cancelScheduledValues(now);
    music.out.gain.setValueAtTime(Math.max(0.0001, music.out.gain.value), now);
    music.out.gain.linearRampToValueAtTime(music.vol, now + 2.5); // плавное появление
    music.nextTime = now + 0.1;
    music.timer = setInterval(() => {
      const ahead = ctx.currentTime + 0.3;
      while (music.nextTime < ahead) {
        music.schedule(music.step++, music.nextTime);
        music.nextTime += music.stepDur;
      }
    }, 100);
  }

  function stopMusic() {
    if (!music || !music.timer) return;
    clearInterval(music.timer);
    music.timer = null;
    // Уже запланированные ноты гасим плавным уводом громкости шины
    const now = ctx.currentTime;
    music.out.gain.cancelScheduledValues(now);
    music.out.gain.setValueAtTime(Math.max(0.0001, music.out.gain.value), now);
    music.out.gain.linearRampToValueAtTime(0.0001, now + 0.6);
  }

  // Смена стиля: старый движок затихает и освобождается, новый создаётся при следующем старте
  function dropMusic() {
    if (!music) return;
    stopMusic();
    const old = music;
    music = null;
    old.dispose(ctx.currentTime + 0.7);
    setTimeout(() => old.out.disconnect(), 1500);
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
    if (music && music.style !== styleKey()) dropMusic();
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

  WG.audio = { setOptions, play, exitSound, vibrate, nextCombo, suspend, resume, renderMusic, state };

})(window.WG = window.WG || {});
