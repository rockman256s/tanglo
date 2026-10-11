(function (WG) {
  'use strict';

  // Направления: y растёт вниз, x — вправо
  WG.DIRS = {
    U: { dx: 0, dy: -1 },
    R: { dx: 1, dy: 0 },
    D: { dx: 0, dy: 1 },
    L: { dx: -1, dy: 0 },
  };
  WG.DIR_NAMES = ['U', 'R', 'D', 'L'];

  WG.dirFromDelta = (dx, dy) => dx === 1 ? 'R' : dx === -1 ? 'L' : dy === 1 ? 'D' : 'U';

  WG.MAX_HEARTS = 3;

})(window.WG = window.WG || {});
