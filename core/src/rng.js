'use strict';

// Сидовый ГСЧ (mulberry32) — тот же алгоритм, что в игре. Один seed → одна последовательность
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)), // включительно
    range: (min, max) => min + next() * (max - min),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    // Индекс по весам (веса ≥ 0); -1, если все нули
    weighted: (weights) => {
      let sum = 0;
      for (const w of weights) sum += w;
      if (sum <= 0) return -1;
      let t = next() * sum;
      for (let i = 0; i < weights.length; i++) {
        t -= weights[i];
        if (t < 0) return i;
      }
      return weights.length - 1;
    },
  };
  return r;
}

// Смешивание seed: уровень n и номер попытки → независимый поток
function mix(...parts) {
  let h = 0x811C9DC5;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

module.exports = { rng, mix };
