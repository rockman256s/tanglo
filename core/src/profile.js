'use strict';

// Профиль уровня n: размер поля, раскладка потока, распределение длин, стиль тел и цели отбора.
//
// Кривая сложности d ∈ [0, 1]:
//   - быстрый рост на первых ~100 уровнях (референс: уже 2-й уровень — плотное большое поле);
//   - медленный дрейф вверх до 20 000;
//   - шум ±, чтобы соседние уровни не были одинаковыми;
//   - каждый 5-й уровень — передышка (сложность ниже);
//   - каждый 10-й — бонус-картинка.

const { rng: makeRng, mix } = require('./rng');

const DEFAULTS = {
  maxW: 32, // предел поля по ширине (экран телефона)
  maxH: 52,
  pictureEvery: 10, // бонус-картинка каждые N уровней (0 — выключить)
  restEvery: 5,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Референс: 1-й уровень уже плотный 20×30, 2–3-й — заметно сложнее. Старт с 0.2, к 10-му ≈0.55,
// к 100-му ≈0.8, дальше медленный дрейф к 1
function difficulty(n, r) {
  if (n === 1) return 0.2;
  const fast = 1 - Math.exp(-(n - 1) / 40);
  const slow = 1 - Math.exp(-n / 3000);
  return clamp(0.35 + 0.45 * fast + 0.2 * slow + r.range(-0.05, 0.05), 0, 1);
}

function profile(n, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const r = makeRng(mix(n, 0x9E3779B9));
  const picture = o.pictureEvery > 0 && n >= o.pictureEvery && n % o.pictureEvery === 0;
  const rest = !picture && o.restEvery > 0 && n > o.restEvery && n % o.restEvery === 0;
  let d = difficulty(n, r);
  if (rest) d *= 0.75;

  // Размер поля: 20×30 на 1-м уровне, к ~10-му — около 28×44, дальше медленно до предела
  const grow = n === 1 ? 0 : clamp(0.55 + 0.45 * (1 - Math.exp(-(n - 2) / 60)) + r.range(-0.08, 0.04), 0, 1);
  let W = Math.round(lerp(20, o.maxW, grow));
  const aspect = r.range(1.5, 1.68);
  let H = Math.min(o.maxH, Math.round(W * aspect));
  if (n === 1) { W = 20; H = 30; }

  // Раскладка потока: сначала одна зона, со сложностью — зоны, вихри, полосы
  const layouts = [
    ['single', lerp(1, 0.45, d)],
    ['split', lerp(0, 0.2, d)],
    ['quad', lerp(0, 0.15, d)],
    ['spiral', lerp(0, 0.12, d)],
    ['stripes', lerp(0, 0.08, d)],
  ];
  const layout = layouts[r.weighted(layouts.map((x) => x[1]))][0];

  const p = {
    n, d, rest, picture: null,
    w: W, h: H, layout,
    mood: { main: [lerp(0.5, 0.45, d), lerp(0.7, 0.62, d)], opp: [0, 0.06] },
    lengths: {
      stub: lerp(0.18, 0.1, d),
      mu: lerp(2.5, 3.35, d) + r.range(-0.15, 0.15),
      sigma: 0.6,
      max: H,
    },
    style: {
      turnProb: [lerp(0.2, 0.12, d), lerp(0.7, 0.88, d)],
      zigzag: 0.35, spiral: 0.3, maxRun: Math.round(H * 0.8),
      hug: 1.5, block: 1.0, pocket: 0.25, rescue: 3,
      dirFix: 1.5, shortRay: [0, 0.15, 0.6],
      sample: 24, beta: 12, frontier: 1.0,
      wDepth: 1, wClose: 4, closeCap: 3, wBlock: 0.3, wHug: 1, wPot: 1, noise: 1, wKill: 4,
    },
    candidates: Math.round(lerp(4, 8, d)),
    polishIters: Math.round(lerp(600, 3000, d)),
    maxW: o.maxW,
    maxH: o.maxH,
    targets: {
      coverage: 0.985,
      freeMean: lerp(6.5, 3.2, d),
      waves: lerp(22, 55, d) * Math.sqrt((W * H) / 1450),
      initialFree: [Math.round(lerp(5, 3, d)), Math.round(lerp(16, 8, d))],
      lenMean: lerp(7, 11.5, d),
    },
  };

  if (picture) {
    // Тип картинки и фигура — детерминированно по номеру; фигуры идут по кругу с перемешиванием
    const kinds = ['fill', 'mask', 'contour'];
    const k = n / o.pictureEvery;
    p.picture = { kind: kinds[k % 3], shapeIndex: mix(k, 0xC0FFEE) };
    p.d = d * 0.85; // бонус чуть легче — это награда
  }
  return p;
}

module.exports = { profile, DEFAULTS };
