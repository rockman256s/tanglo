// Компактная запись уровней в паки. Работает и в Node (require), и в браузере (window.WG.levelCodec),
// чтобы игра могла читать паки этим же файлом.
//
// Уровень — одна строка:  w,h|mask|meta|стрелка стрелка …
//   mask:    '-' (прямоугольник) или строки через '/', в каждой RLE: '12#3.5#'
//   meta:    kind[:pictureKind:pictureName]
//   стрелка: x.y.color:ХОДЫ — клетка хвоста, цвет и шаги от хвоста к голове (U R D L)
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.WG = root.WG || {}).levelCodec = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STEP = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] };

  function rle(row) {
    let out = '';
    for (let i = 0; i < row.length;) {
      let j = i;
      while (j < row.length && row[j] === row[i]) j++;
      out += (j - i > 1 ? j - i : '') + row[i];
      i = j;
    }
    return out;
  }

  function unrle(s) {
    let out = '';
    let num = '';
    for (const ch of s) {
      if (ch >= '0' && ch <= '9') { num += ch; continue; }
      out += ch.repeat(num ? +num : 1);
      num = '';
    }
    return out;
  }

  function encode(level) {
    const mask = level.mask ? level.mask.map(rle).join('/') : '-';
    let meta = level.kind || 'chaos';
    if (level.picture) meta += ':' + level.picture.kind + ':' + level.picture.name;
    const arrows = level.arrows.map((a) => {
      let moves = '';
      for (let k = 1; k < a.cells.length; k++) {
        const dx = a.cells[k][0] - a.cells[k - 1][0];
        const dy = a.cells[k][1] - a.cells[k - 1][1];
        moves += dx === 1 ? 'R' : dx === -1 ? 'L' : dy === 1 ? 'D' : 'U';
      }
      return a.cells[0][0] + '.' + a.cells[0][1] + '.' + a.color + ':' + moves;
    });
    return level.w + ',' + level.h + '|' + mask + '|' + meta + '|' + arrows.join(' ');
  }

  function decode(str, id) {
    const [size, mask, meta, body] = str.split('|');
    const [w, h] = size.split(',').map(Number);
    const [kind, pk, pn] = meta.split(':');
    const arrows = (body ? body.split(' ') : []).map((tok, i) => {
      const [head, moves] = tok.split(':');
      const [x, y, color] = head.split('.').map(Number);
      const cells = [[x, y]];
      let cx = x;
      let cy = y;
      for (const m of moves) {
        cx += STEP[m][0];
        cy += STEP[m][1];
        cells.push([cx, cy]);
      }
      return { id: i, cells, color };
    });
    const level = { id, w, h, mask: mask === '-' ? null : mask.split('/').map(unrle), arrows, kind };
    if (pk) level.picture = { kind: pk, name: pn };
    return level;
  }

  return { encode, decode };
});
