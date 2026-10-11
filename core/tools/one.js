'use strict';
// Сгенерировать один уровень и показать метрики: node tools/one.js <n> [out.json]
const { generateLevel } = require('../src/generator');
const n = +process.argv[2] || 2;
const t0 = Date.now();
const res = generateLevel(n, { polish: process.env.NOPOLISH ? false : undefined });
const m = res.metrics;
const f = (v) => (typeof v === 'number' ? +v.toFixed(2) : v);
console.log(`L${n} ${Date.now() - t0}ms d=${res.profile.d.toFixed(2)} ${res.level.kind}${res.level.picture ? ':' + res.level.picture.kind + ':' + res.level.picture.name : ''} layout=${res.layout} ${m.w}x${m.h}`);
console.log(Object.entries(m).filter(([k]) => !['w', 'h', 'dirs'].includes(k)).map(([k, v]) => `${k}=${f(v)}`).join(' '), 'dirs', Object.entries(m.dirs).map(([k, v]) => k + Math.round(v * 100)).join(' '));
console.log('targets', JSON.stringify(res.profile.targets, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
if (process.argv[3]) require('fs').writeFileSync(process.argv[3], JSON.stringify(res.level));
