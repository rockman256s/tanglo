(function (WG) {
  'use strict';

  // Уровни 1–3 — захардкоженные туториалы (раздел 6.1 плана). Строки маски не нужны: поле прямоугольное
  const HAND = {
    // Уровень 1 — единственный туториал: 3×3, три стрелки с хвостами, все свободны (IMP B1.5: со 2-го уровня — 20×30)
    1: {
      w: 3, h: 3, mask: null,
      arrows: [
        { id: 0, cells: [[0, 0], [0, 1]], color: 0 },
        { id: 1, cells: [[2, 2], [1, 2]], color: 1 },
        { id: 2, cells: [[1, 0], [2, 0]], color: 2 },
      ],
    },
  };

  // Какие уровни делаем фигурами (IMP B1.5: каждые 7-й с 15-го — маска поверх 20×30)
  function shapeEvery(n) {
    return n >= 15 && n % 7 === 0;
  }

  // Постепенная кривая (IMP B1.6/B1.7b): от маленьких полей к 20×30 (уровень 100+),
  // плотность нарастает — пустых клеток почти нет уже к ~60-му уровню.
  function bandParams(n) {
    if (n <= 1) {
      // используется только если HAND не задан (уровень 1 — handcrafted)
      return { w: 3, h: 3, minLen: 2, maxLen: 2, candidates: 1, minRounds: 1, coverage: 0.7 };
    }
    // Референс: уже 2-й уровень — плотное поле 20×30 с длинными стрелками (IMP B1.8).
    // Сложность растёт глубиной цепочек (rounds), длиной и плотностью — не размером поля.
    const tier = (table) => {
      for (const [limit, v] of table) {
        if (n < limit) return v;
      }
      return table[table.length - 1][1];
    };
    return {
      w: 20, h: 30,
      minLen: 3,
      // Референс: двухмодальный набор — герой-змейки до 14–24 клеток + короткие 3–8
      maxLen: tier([[10, 14], [25, 18], [Infinity, 24]]),
      candidates: tier([[10, 3], [30, 4], [Infinity, 5]]),
      // Глубина (waves решателя): строительные фазы дают базу, поезда стражей добирают;
      // планки — реалистичные минимумы, отбор сидов дотягивает лучшее оценкой
      minRounds: tier([[10, 6], [25, 8], [60, 10], [100, 12], [Infinity, 14]]),
      coverage: tier([[10, 0.85], [25, 0.9], [Infinity, 0.95]]),
      rayBias: 0.75,
      // Плетёнка референса — это зигзаги: ~40% стрелок виляют каждые 1–2 клетки
      serpentChance: 0.4,
    };
  }

  // Повороты: чем позднее, тем прямее (референс-карта: прямые+крючки доминируют, ~30% змеёк)
  function turnChanceFor(n) {
    if (n < 25) return 0.3;
    if (n < 50) return 0.25;
    if (n < 85) return 0.2;
    return 0.15;
  }

  // Параметры генератора для уровня n
  function paramsFor(n) {
    const boss = n >= 10 && n % 10 === 0; // боссы каждые 10 уровней, с 10-го (IMP B1.6)
    // Передышка: каждый 5-й уровень (кроме босса) берёт параметры предыдущего
    const rest = !boss && n >= 5 && n % 5 === 0;
    const base = bandParams(rest ? n - 1 : n);

    let mask = null;
    let shape = null;

    // Босс — тот же 20×30 (поле и так максимальное); статус даёт рамку и награду ×3
    if (!boss && shapeEvery(n)) {
      // Фигура может совпасть с передышкой: тогда форма остаётся, сложность — на ступень ниже
      const s = WG.shapes.get(Math.floor(n / 5), base.w, base.h);
      mask = s.mask;
      shape = s.name;
    }

    return {
      w: base.w,
      h: base.h,
      mask,
      shape,
      boss,
      minLen: base.minLen,
      maxLen: base.maxLen,
      turnChance: turnChanceFor(n),
      serpentChance: base.serpentChance,
      rayBias: base.rayBias,
      coverage: base.coverage,
      candidates: base.candidates,
      minRounds: base.minRounds,
      allowSingles: false, // референс: одиночек-голов без хвоста нет — минимальная стрелка 2 клетки
      maxSinglesRatio: 0,
    };
  }

  // Готовый туториальный уровень (копия) или null
  function handLevel(n) {
    if (!HAND[n]) return null;
    try {
      return JSON.parse(JSON.stringify({ id: n, seed: null, ...HAND[n] }));
    } catch {
      return null; // на обычных данных недостижимо; при ошибке — процедурная ветка генератора
    }
  }

  // Экономика (раздел 9.2–9.3 плана)
  const PRICES = { hint: 60, scissors: 150, continue: 20 };

  // Звёзды: 0 ошибок — 3, 1 — 2, иначе 1
  function starsFor(mistakes) {
    return mistakes === 0 ? 3 : mistakes === 1 ? 2 : 1;
  }

  // Награда за победу: 10 + 5 × звёзды, у босса ×3
  function rewardFor(stars, boss) {
    return (10 + 5 * stars) * (boss ? 3 : 1);
  }

  // Сундук каждые 10 уровней
  function isChest(n) {
    return n % 10 === 0;
  }

  WG.levels = { paramsFor, handLevel, HAND, PRICES, starsFor, rewardFor, isChest };

})(window.WG = window.WG || {});
