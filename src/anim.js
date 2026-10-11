(function (WG) {
  'use strict';

  const EASE = {
    linear: (t) => t,
    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
    easeOutBack: (t) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
  };

  // Твины, таймеры и частицы. Не знает про игру: меняет поля объектов и вызывает колбэки
  class Anim {
    constructor() {
      this.tweens = [];
      this.timers = [];
      this.particles = [];
    }

    // Плавно меняет obj[key] от from (по умолчанию — текущее) к to за dur секунд
    tween(obj, key, to, dur, opts = {}) {
      const tw = {
        obj,
        key,
        from: opts.from !== undefined ? opts.from : obj[key],
        to,
        dur: Math.max(dur, 0.0001),
        delay: opts.delay || 0,
        ease: EASE[opts.ease || 'linear'],
        elapsed: 0,
        onDone: opts.onDone || null,
        done: false,
      };
      this.tweens.push(tw);
      return tw;
    }

    // Вызвать fn через sec секунд
    after(sec, fn) {
      this.timers.push({ t: sec, fn });
    }

    emit(p) {
      this.particles.push({ ...p, max: p.life });
    }

    update(dt) {
      for (const tw of this.tweens.slice()) {
        if (tw.done) continue;
        tw.elapsed += dt;
        if (tw.elapsed < tw.delay) continue;
        const p = Math.min(1, (tw.elapsed - tw.delay) / tw.dur);
        tw.obj[tw.key] = tw.from + (tw.to - tw.from) * tw.ease(p);
        if (p >= 1) {
          tw.done = true;
          if (tw.onDone) tw.onDone();
        }
      }
      this.tweens = this.tweens.filter((tw) => !tw.done);

      const due = [];
      const rest = [];
      for (const tm of this.timers) {
        tm.t -= dt;
        (tm.t <= 0 ? due : rest).push(tm);
      }
      this.timers = rest;
      for (const tm of due) tm.fn();

      for (const p of this.particles) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += (p.g || 0) * dt;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
    }

    isBusy() {
      return this.tweens.length > 0 || this.timers.length > 0 || this.particles.length > 0;
    }

    clear() {
      this.tweens = [];
      this.timers = [];
      this.particles = [];
    }
  }

  WG.anim = { Anim, EASE };

})(window.WG = window.WG || {});
