(function (WG) {
  'use strict';

  // Lo-fi: бесконечная музыка без файлов. Две половины:
  //   композитор song(n, seed) — чистая функция, 16 тактов событий на сетке шестнадцатых
  //     (аккорды, бас, барабаны, мелодия); его проверяют тесты;
  //   движок createEngine(ac, dest, seed) — синтез WebAudio: электропиано, бас, барабаны,
  //     «плёнка» (плавание высоты, насыщение, завал верхов) и треск пластинки.
  // Каждая следующая песня — новая гармония, грув и мелодия, тональность на кварту выше.

  // Станции: один композитор, разный характер. swing — доля шестнадцатой, на которую
  // опаздывают нечётные шестнадцатые; drums: full | soft | none; leadEvery — мелодия
  // в каждой N-й песне; kicks — какие рисунки бочки разрешены; остальное — окраска звука
  const STATIONS = {
    chill: { bpm: 76, swing: 0.28, drums: 'full', leadEvery: 1, kicks: [0, 1, 2, 3, 4], lp: 4200, wet: 0.35, crackle: 1.2, wow: 1 },
    night: { bpm: 64, swing: 0.2, drums: 'soft', leadEvery: 2, kicks: [0], lp: 2800, wet: 0.6, crackle: 0.8, wow: 1.3 },
    cafe: { bpm: 88, swing: 0.34, drums: 'full', leadEvery: 1, kicks: [1, 2, 4], lp: 5200, wet: 0.25, crackle: 0.6, wow: 0.6 },
    tape: { bpm: 70, swing: 0.24, drums: 'none', leadEvery: 1, kicks: [0], lp: 3200, wet: 0.5, crackle: 2, wow: 2 },
  };
  const DEFAULT_STATION = 'chill';
  const station = (id) => STATIONS[id] || STATIONS[DEFAULT_STATION];
  const STEPS = 16;   // шестнадцатых в такте
  const BARS = 16;    // тактов в песне: A A B A по 4 такта

  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const mod12 = (x) => ((x % 12) + 12) % 12;
  // Нота с данным звуковысотным классом в окне [lo, lo + 12)
  const fold = (pc, lo) => lo + mod12(pc - lo);

  // Интервалы от корня аккорда; правая рука корень не берёт — его играет бас
  const QUALITY = {
    maj7: [0, 4, 7, 11, 14],
    m7: [0, 3, 7, 10, 14],
    dom7: [0, 4, 10, 14, 21],
    sus: [0, 5, 7, 10, 14],
  };
  // Четырёхтактовые обороты: [ступень в полутонах от тоники, качество]
  const PROGS = [
    [[2, 'm7'], [7, 'dom7'], [0, 'maj7'], [9, 'm7']],   // ii V I vi
    [[5, 'maj7'], [4, 'm7'], [2, 'm7'], [0, 'maj7']],   // IV iii ii I
    [[5, 'maj7'], [7, 'dom7'], [4, 'm7'], [9, 'm7']],   // IV V iii vi
    [[0, 'maj7'], [9, 'm7'], [2, 'm7'], [7, 'dom7']],   // I vi ii V
    [[9, 'm7'], [5, 'maj7'], [0, 'maj7'], [7, 'sus']],  // vi IV I Vsus
    [[5, 'maj7'], [5, 'maj7'], [4, 'm7'], [9, 'm7']],   // IV IV iii vi
  ];
  const PENTA = [0, 2, 4, 7, 9];
  const LEAD_LO = 67;
  const LEAD_HI = 83;

  // Грувы: позиции шестнадцатых
  const KICKS = [[0, 10], [0, 7, 10], [0, 3, 10], [0, 8, 11], [0, 6, 10, 13]];
  // Аккомпанемент правой руки: [шестнадцатая, длина]
  const COMPS = [
    [[0, 12]],
    [[0, 6], [6, 4], [10, 6]],
    [[0, 3], [3, 7], [10, 6]],
    [[0, 8], [14, 2]],
    [[-1, 9], [10, 6]], // -1: аккорд «вперёд», на последнюю шестнадцатую предыдущего такта
  ];
  // Бас: [шестнадцатая, что играть, длина]; r — корень, f — квинта, a — подход к следующему корню
  const BASSES = [
    [[0, 'r', 7], [10, 'r', 4], [14, 'a', 2]],
    [[0, 'r', 10], [12, 'f', 4]],
    [[0, 'r', 3], [3, 'r', 5], [8, 'f', 6]],
    [[0, 'r', 6], [7, 'r', 3], [10, 'f', 4], [14, 'a', 2]],
  ];

  function chordOf(key, [deg, q]) {
    const root = key + deg;
    const iv = QUALITY[q];
    return {
      bass: fold(root, 33),
      pcs: iv.map((x) => mod12(root + x)),
      keys: iv.slice(1).map((x) => fold(root + x, 55)).sort((a, b) => a - b),
    };
  }

  // Мелодическая фраза на 4 такта: такты 0–1 свободно, такт 2 повторяет ритм и рисунок
  // такта 0 от аккордового звука (вопрос-ответ), такт 3 — короткий спуск к долгой опорной ноте
  function phrase(rng, key, chords) {
    const scale = [];
    for (let m = LEAD_LO; m <= LEAD_HI; m++) if (PENTA.includes(mod12(m - key))) scale.push(m);
    const clamp = (i) => Math.max(0, Math.min(scale.length - 1, i));
    const snap = (i, chord) => {
      let best = i;
      let bestD = Infinity;
      scale.forEach((m, j) => {
        const d = Math.abs(j - i);
        if (chord.pcs.includes(mod12(m)) && d < bestD) { best = j; bestD = d; }
      });
      return best;
    };
    const rhythm = (bar) => {
      const on = [];
      for (let s = 0; s < STEPS; s += 2) {
        const p = s === 0 ? 0.6 : s % 4 === 0 ? 0.45 : 0.3;
        if (rng.chance(p)) on.push(s === 0 || !rng.chance(0.2) ? s : s - 1);
      }
      if (bar === 3) {
        const end = on.filter((s) => s <= 6);
        return end.length ? end : [0];
      }
      return on.length ? on : [rng.pick([0, 4, 8])];
    };

    const out = [];
    let idx = clamp(Math.floor(scale.length / 2) + rng.int(-2, 2));
    const bar0 = [];
    for (let bar = 0; bar < 4; bar++) {
      const chord = chords[bar];
      if (bar === 2 && bar0.length) {
        const shift = snap(bar0[0].i, chord) - bar0[0].i;
        for (const e of bar0) {
          const i = clamp(e.i + shift);
          out.push({ bar, s: e.s, inst: 'lead', m: scale[i], len: e.len, v: e.v });
          idx = i;
        }
        continue;
      }
      const on = rhythm(bar);
      on.forEach((s, k) => {
        const last = bar === 3 && k === on.length - 1;
        const next = k + 1 < on.length ? on[k + 1] : STEPS;
        const len = last ? STEPS - s : Math.min(6, next - s);
        if (k === 0 || last) idx = snap(clamp(idx + rng.pick([-1, 0, 1])), chord);
        else idx = clamp(idx + rng.pick([-2, -1, -1, 1, 1, 2]));
        const e = { bar, s, inst: 'lead', m: scale[idx], len, v: 0.75 + rng.next() * 0.25 };
        out.push(e);
        if (bar === 0) bar0.push({ s, len, v: e.v, i: idx });
      });
    }
    return out;
  }

  function drums(rng, kick, mode, fill) {
    const ev = [];
    const hit = (s, inst, v) => ev.push({ s, inst, v });
    if (mode === 'none') return ev;
    for (let s = 0; s < STEPS; s += 2) {
      if (mode === 'break' && s >= 8) break;
      if (s === 14 && rng.chance(0.18)) hit(s, 'ohat', 0.5);
      else hit(s, 'hat', (s % 4 === 0 ? 0.75 : 0.45) * (0.85 + rng.next() * 0.3));
      if (rng.chance(0.12)) hit(s + 1, 'hat', 0.25 + rng.next() * 0.15);
    }
    if (mode === 'intro') return ev;
    for (const s of kick) if (mode !== 'break' || s < 8) hit(s, 'kick', s === 0 ? 1 : 0.8);
    hit(4, 'snare', 1);
    if (mode !== 'break') hit(12, 'snare', 1);
    if (rng.chance(0.3)) hit(rng.pick([7, 9, 15]), 'snare', 0.22);
    if (fill) {
      hit(14, 'snare', 0.35);
      hit(15, 'snare', 0.5);
    }
    return ev;
  }

  // Песня n из бесконечной последовательности с данным сидом на данной станции
  function song(n, seed, stationId) {
    const st = station(stationId);
    const rng = WG.rng((seed >>> 0) ^ Math.imul(n + 1, 0x9E3779B1));
    const key0 = mod12(WG.rng(seed >>> 0).int(0, 11));
    const key = mod12(key0 + 5 * n);
    const progA = rng.pick(PROGS);
    let progB = rng.pick(PROGS);
    if (progB === progA) progB = PROGS[(PROGS.indexOf(progA) + 1) % PROGS.length];
    const A = progA.map((c) => chordOf(key, c));
    const B = progB.map((c) => chordOf(key, c));
    const kick = KICKS[rng.pick(st.kicks)];
    const compA = rng.pick(COMPS);
    const compB = rng.pick(COMPS);
    const bassPat = rng.pick(BASSES);
    const leadA = phrase(rng, key, A);
    const leadB = phrase(rng, key, B);
    const leadUntil = n % st.leadEvery ? 0 : n % 2 === 0 ? BARS : 12;

    const bars = [];
    for (let b = 0; b < BARS; b++) {
      const inB = b >= 8 && b < 12;
      const chords = inB ? B : A;
      const chord = chords[b % 4];
      const nextChord = b + 1 < BARS ? (b + 1 >= 8 && b + 1 < 12 ? B : A)[(b + 1) % 4] : A[0];
      const events = [];

      // Аккорд «вперёд» (-1) уходит в последнюю шестнадцатую предыдущего такта:
      // здесь такт сам отдаёт свою последнюю шестнадцатую следующему аккорду
      const comp = inB ? compB : compA;
      for (const [s, len] of comp) {
        if (s >= 0) events.push({ s, inst: 'keys', notes: chord.keys, len, v: s === 0 ? 1 : 0.8 });
        else if (b === 0) events.push({ s: 0, inst: 'keys', notes: chord.keys, len: len - 1, v: 1 });
      }
      const nextComp = b + 1 >= 8 && b + 1 < 12 ? compB : compA;
      if (b + 1 < BARS && nextComp[0][0] === -1) {
        const cut = events.filter((e) => e.s + e.len > 15);
        for (const e of cut) e.len = Math.max(1, 15 - e.s);
        events.push({ s: 15, inst: 'keys', notes: nextChord.keys, len: 1 + nextComp[0][1], v: 1 });
      }

      if (!(n === 0 && b < 4)) {
        const approach = nextChord.bass + (rng.chance(0.5) ? -1 : 2);
        for (const [s, what, len] of bassPat) {
          const m = what === 'r' ? chord.bass : what === 'f' ? chord.bass + 7 : approach;
          events.push({ s, inst: 'bass', m, len, v: s === 0 ? 1 : 0.8 });
        }
      }

      const mode = st.drums === 'none' ? 'none' : n === 0 && b < 4 ? 'intro' : b === BARS - 1 ? 'break' : 'full';
      const soft = st.drums === 'soft';
      for (const e of drums(rng, kick, mode, !soft && (b === 7 || b === 11))) {
        // Мягкие барабаны: без «призрачных» ударов, снейр и хэты тише
        if (soft && e.inst === 'snare' && e.v < 0.5) continue;
        if (soft && e.inst !== 'kick') e.v *= 0.6;
        events.push(e);
      }

      if (b >= 4 && b < leadUntil) {
        const lead = inB ? leadB : leadA;
        for (const e of lead) if (e.bar === b % 4) events.push({ s: e.s, inst: 'lead', m: e.m, len: e.len, v: e.v });
      }
      bars.push({ key, chord, events });
    }
    return { n, key, bars };
  }

  // ---- синтез ----

  function makeReverb(ac, seconds) {
    const len = Math.floor(ac.sampleRate * seconds);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    }
    const conv = ac.createConvolver();
    conv.buffer = ir;
    return conv;
  }

  // Треск пластинки: тихое шипение и редкие щелчки, петля 6 с
  function makeCrackle(ac) {
    const len = Math.floor(ac.sampleRate * 6);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.015;
    const clicks = 6 * 9;
    for (let k = 0; k < clicks; k++) {
      const at = Math.floor(Math.random() * (len - 200));
      const amp = (Math.random() < 0.15 ? 0.6 : 0.2) * (Math.random() < 0.5 ? -1 : 1);
      const width = 2 + Math.floor(Math.random() * 30);
      for (let i = 0; i < width; i++) d[at + i] += amp * Math.exp(-i / (width / 4));
    }
    return buf;
  }

  function createEngine(ac, dest, seed, stationId) {
    const st = station(stationId);
    const SIXTEENTH = 60 / st.bpm / 4;
    const nodes = []; // источники, которые живут всё время работы движка

    const out = ac.createGain();
    out.gain.value = 0.0001;
    out.connect(dest);

    // «Плёнка»: плавающая задержка (wow и flutter) → мягкое насыщение → срез низа и верха
    const wob = ac.createDelay(0.05);
    wob.delayTime.value = 0.012;
    for (const [hz, depth] of [[0.45, 0.0016], [6.1, 0.00012]]) {
      const lfo = ac.createOscillator();
      lfo.frequency.value = hz;
      const g = ac.createGain();
      g.gain.value = depth * st.wow;
      lfo.connect(g);
      g.connect(wob.delayTime);
      lfo.start();
      nodes.push(lfo);
    }
    const sat = ac.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4);
    }
    sat.curve = curve;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 45;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = st.lp;
    lp.Q.value = 0.5;
    wob.connect(sat);
    sat.connect(hp);
    hp.connect(lp);
    lp.connect(out);

    const dry = ac.createGain();
    dry.connect(wob);
    const rev = ac.createGain();
    const conv = makeReverb(ac, 2.4);
    const wet = ac.createGain();
    wet.gain.value = st.wet;
    rev.connect(conv);
    conv.connect(wet);
    wet.connect(wob);

    const crackle = ac.createBufferSource();
    crackle.buffer = makeCrackle(ac);
    crackle.loop = true;
    const cbp = ac.createBiquadFilter();
    cbp.type = 'bandpass';
    cbp.frequency.value = 2500;
    cbp.Q.value = 0.4;
    const cg = ac.createGain();
    cg.gain.value = st.crackle;
    crackle.connect(cbp);
    cbp.connect(cg);
    cg.connect(out);
    crackle.start();
    nodes.push(crackle);

    const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const send = (g, amount) => {
      const s = ac.createGain();
      s.gain.value = amount;
      g.connect(s);
      s.connect(rev);
    };
    const decayGain = (t, vol, attack, dur) => {
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      return g;
    };
    const noiseSrc = (t, dur) => {
      const src = ac.createBufferSource();
      src.buffer = noise;
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur);
      return src;
    };

    const INST = {
      kick(e, t) {
        const osc = ac.createOscillator();
        osc.frequency.setValueAtTime(110, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.13);
        const g = decayGain(t, 0.32 * e.v, 0.003, 0.42);
        osc.connect(g);
        g.connect(dry);
        osc.start(t);
        osc.stop(t + 0.45);
      },
      snare(e, t) {
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1700;
        bp.Q.value = 0.7;
        const g = decayGain(t, 0.26 * e.v, 0.002, 0.18);
        noiseSrc(t, 0.2).connect(bp);
        bp.connect(g);
        g.connect(dry);
        send(g, 0.35);
        const body = ac.createOscillator();
        body.type = 'triangle';
        body.frequency.setValueAtTime(190, t);
        body.frequency.exponentialRampToValueAtTime(150, t + 0.07);
        const bg = decayGain(t, 0.1 * e.v, 0.002, 0.08);
        body.connect(bg);
        bg.connect(dry);
        body.start(t);
        body.stop(t + 0.1);
      },
      hat(e, t, open) {
        const hpf = ac.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 7000;
        const dur = open ? 0.24 : 0.04;
        const g = decayGain(t, 0.11 * e.v, 0.001, dur);
        noiseSrc(t, dur + 0.02).connect(hpf);
        hpf.connect(g);
        g.connect(dry);
      },
      ohat(e, t) {
        INST.hat(e, t, true);
      },
      // Электропиано: FM-синус, яркость гаснет быстрее громкости; аккорд слегка «рассыпан»
      keys(e, t) {
        const hold = e.len * SIXTEENTH;
        e.notes.forEach((m, i) => {
          const tt = t + i * 0.012 + Math.random() * 0.006;
          const f = midi(m);
          const car = ac.createOscillator();
          car.frequency.value = f;
          const mod = ac.createOscillator();
          mod.frequency.value = f;
          const idx = ac.createGain();
          idx.gain.setValueAtTime(f * 0.7, tt);
          idx.gain.exponentialRampToValueAtTime(f * 0.03, tt + 1.2);
          mod.connect(idx);
          idx.connect(car.frequency);
          const g = ac.createGain();
          const vol = 0.065 * e.v;
          g.gain.setValueAtTime(0.0001, tt);
          g.gain.linearRampToValueAtTime(vol, tt + 0.01);
          g.gain.exponentialRampToValueAtTime(vol * 0.35, tt + Math.max(0.2, hold));
          g.gain.exponentialRampToValueAtTime(0.0001, tt + hold + 0.45);
          car.connect(g);
          g.connect(dry);
          send(g, 0.3);
          car.start(tt);
          mod.start(tt);
          car.stop(tt + hold + 0.5);
          mod.stop(tt + hold + 0.5);
        });
      },
      bass(e, t) {
        const dur = e.len * SIXTEENTH * 0.95;
        const f = midi(e.m);
        const lpf = ac.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 380;
        const g = ac.createGain();
        const vol = 0.1 * e.v;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.02);
        g.gain.exponentialRampToValueAtTime(vol * 0.5, t + Math.max(0.05, dur * 0.7));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
        lpf.connect(g);
        g.connect(dry);
        for (const [type, v] of [['sine', 1], ['triangle', 0.25]]) {
          const osc = ac.createOscillator();
          osc.type = type;
          osc.frequency.value = f;
          const og = ac.createGain();
          og.gain.value = v;
          osc.connect(og);
          og.connect(lpf);
          osc.start(t);
          osc.stop(t + dur + 0.1);
        }
      },
      // Мелодия: мягкий треугольник с поздним вибрато, как свисток или флейта
      lead(e, t) {
        const dur = e.len * SIXTEENTH;
        const f = midi(e.m);
        const osc = ac.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        const vib = ac.createOscillator();
        vib.frequency.value = 5;
        const vg = ac.createGain();
        vg.gain.setValueAtTime(0, t);
        vg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.5, dur));
        vib.connect(vg);
        vg.connect(osc.frequency);
        const lpf = ac.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 1800;
        const g = ac.createGain();
        const vol = 0.075 * e.v;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.04);
        g.gain.setValueAtTime(vol, t + Math.max(0.05, dur - 0.05));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
        osc.connect(lpf);
        lpf.connect(g);
        g.connect(dry);
        send(g, 0.5);
        osc.start(t);
        vib.start(t);
        osc.stop(t + dur + 0.35);
        vib.stop(t + dur + 0.35);
      },
    };

    let cache = null;
    // Одна шестнадцатая: step — номер с начала, t — время сетки (свинг и «руки» добавляются здесь)
    function schedule(step, t) {
      const b = Math.floor(step / STEPS);
      const n = Math.floor(b / BARS);
      if (!cache || cache.n !== n) cache = song(n, seed, stationId);
      const bar = cache.bars[b % BARS];
      const s = step % STEPS;
      const tt = t + (s % 2 ? st.swing * SIXTEENTH : 0);
      for (const e of bar.events) {
        if (e.s !== s) continue;
        const human = e.inst === 'keys' || e.inst === 'lead' ? Math.random() * 0.015 : Math.random() * 0.006;
        INST[e.inst](e, tt + human);
      }
    }

    function dispose(t) {
      for (const n of nodes) n.stop(t);
    }

    return { out, stepDur: SIXTEENTH, vol: 0.55, schedule, dispose };
  }

  WG.lofi = { song, createEngine, STATIONS, DEFAULT_STATION, STEPS, BARS, PENTA };

})(window.WG = window.WG || {});
