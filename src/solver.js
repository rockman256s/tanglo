(function (WG) {
  'use strict';

  // id всех стрелок, которые сейчас можно убрать
  function freeArrows(board) {
    const free = [];
    for (const arrow of board.alive.values()) {
      if (board.canExit(arrow.id)) free.push(arrow.id);
    }
    return free;
  }

  // Длиннейшая цепочка «A ждёт B»: B лежит на луче A. Цикл даёт 0 вклада
  function maxChain(level) {
    const board = new WG.level.Board(level);
    const waits = new Map();
    for (const arrow of board.alive.values()) {
      const deps = new Set();
      for (const [x, y] of board.ray(arrow)) {
        const id = board.arrowAt(x, y);
        if (id !== -1 && id !== arrow.id) deps.add(id);
      }
      waits.set(arrow.id, [...deps]);
    }

    const memo = new Map();
    const onStack = new Set();
    const depth = (id) => {
      if (memo.has(id)) return memo.get(id);
      if (onStack.has(id)) return 0;
      onStack.add(id);
      let best = 0;
      for (const dep of waits.get(id)) best = Math.max(best, depth(dep));
      onStack.delete(id);
      memo.set(id, best + 1);
      return best + 1;
    };

    let max = 0;
    for (const id of waits.keys()) max = Math.max(max, depth(id));
    return max;
  }

  // Решатель: убираем волнами все свободные стрелки, пока есть что убирать
  function solve(level) {
    const board = new WG.level.Board(level);
    const initialFree = freeArrows(board).length;
    const order = [];
    let rounds = 0;

    for (;;) {
      const free = freeArrows(board);
      if (free.length === 0) break;
      rounds++;
      for (const id of free) {
        const res = board.tap(id);
        if (res && res.type === 'exit') order.push(id);
      }
    }

    return {
      solvable: board.isCleared(),
      order,
      rounds,
      initialFree,
      maxChain: maxChain(level),
    };
  }

  // Подсказка: свободная стрелка, которая разблокирует больше всего других
  function hint(board) {
    let best = null;
    let bestScore = -1;
    for (const id of freeArrows(board)) {
      let score = 0;
      for (const other of board.alive.values()) {
        if (other.id === id) continue;
        const blocker = board.firstBlocker(other);
        if (blocker && blocker.arrowId === id) score++;
      }
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
    return best;
  }

  WG.solver = { solve, hint, freeArrows };

})(window.WG = window.WG || {});
