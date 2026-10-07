/* Hue Shift: a smooth gradient gets scrambled. Swap the tiles back into order. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors;

  // cols, rows, and which tiles stay pinned as anchors
  const LEVELS = [
    [4, 4, 'frame'], [5, 5, 'frame'], [6, 5, 'rows'], [6, 6, 'checker'], [6, 6, 'cols'], [7, 6, 'corners'],
    [7, 7, 'frame'], [8, 7, 'rows'], [8, 8, 'checker'], [8, 8, 'corners'], [9, 8, 'cols'], [9, 9, 'corners']
  ];

  function pinned(kind, x, y, c, r) {
    const edgeX = x === 0 || x === c - 1, edgeY = y === 0 || y === r - 1;
    if (kind === 'frame') return edgeX || edgeY;
    if (kind === 'rows') return edgeY;
    if (kind === 'cols') return edgeX;
    if (kind === 'checker') return (x + y) % 2 === 0;
    return edgeX && edgeY; // corners
  }

  // OKLCH to linear sRGB.
  function linear(L, ch, hueDeg) {
    const h = hueDeg * Math.PI / 180, a = ch * Math.cos(h), b = ch * Math.sin(h);
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }
  function showable(v) { return v[0] >= -0.0005 && v[0] <= 1.0005 && v[1] >= -0.0005 && v[1] <= 1.0005 && v[2] >= -0.0005 && v[2] <= 1.0005; }

  // OKLCH to an sRGB colour, so equal steps across the board look like equal steps to the eye.
  // A colour the screen cannot show keeps its hue and lightness and gives up just enough chroma.
  function oklch(L, ch, hueDeg) {
    let v = linear(L, ch, hueDeg);
    if (!showable(v)) {
      let lo = 0, hi = ch;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (showable(linear(L, mid, hueDeg))) lo = mid; else hi = mid;
      }
      v = linear(L, lo, hueDeg);
    }
    const out = v.map(function (x) {
      x = Math.min(1, Math.max(0, x));
      return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
    });
    return 'rgb(' + out[0] + ', ' + out[1] + ', ' + out[2] + ')';
  }

  // The solved board: hue sweeps across (further on wider boards, so each step stays visible)
  // and lightness falls down the rows. No two tiles ever match.
  function palette(c, r, rnd) {
    const h0 = rnd() * 360;
    const across = (rnd() < 0.5 ? -1 : 1) * Math.min(300, (c - 1) * (24 + rnd() * 8));
    const down = (rnd() < 0.5 ? -1 : 1) * (20 + rnd() * 40);
    const out = [];
    for (let y = 0; y < r; y++) {
      for (let x = 0; x < c; x++) {
        const u = c > 1 ? x / (c - 1) : 0, v = r > 1 ? y / (r - 1) : 0;
        out.push(oklch(0.86 - 0.36 * v, 0.15, h0 + across * u + down * v));
      }
    }
    return out;
  }

  // Shuffles only the loose positions until most tiles have really moved.
  function scramble(order, loose, rnd) {
    const need = Math.max(2, Math.ceil(loose.length * 0.7));
    for (let tries = 0; tries < 60; tries++) {
      const tiles = U.shuffle(loose.map(function (p) { return order[p]; }), rnd);
      let moved = 0;
      loose.forEach(function (p, i) { if (tiles[i] !== order[p]) moved++; });
      if (moved >= need || tries === 59) {
        const next = order.slice();
        loose.forEach(function (p, i) { next[p] = tiles[i]; });
        return next;
      }
    }
    return order.slice();
  }

  // Fewest swaps that can sort a board: each loop of misplaced tiles costs one less than its length.
  function minSwaps(order) {
    const seen = [];
    let swaps = 0;
    for (let i = 0; i < order.length; i++) {
      if (seen[i] || order[i] === i) continue;
      let len = 0, j = i;
      while (!seen[j]) { seen[j] = true; j = order[j]; len++; }
      swaps += len - 1;
    }
    return swaps;
  }

  function create(api) {
    const root = document.createElement('div');
    root.className = 'hue';
    const msg = document.createElement('p');
    msg.className = 'hue-msg';
    const board = document.createElement('div');
    board.className = 'hue-board';
    const bar = document.createElement('div');
    bar.className = 'game-actions';
    const hintBtn = document.createElement('button');
    hintBtn.type = 'button';
    hintBtn.className = 'btn small quiet';
    hintBtn.textContent = 'Show me one';
    bar.appendChild(hintBtn);
    root.appendChild(msg);
    root.appendChild(board);
    root.appendChild(bar);
    api.stage.appendChild(root);

    let level = 1, cols = 4, rows = 4, size = 60;
    let goal = [];      // colour that belongs at each position
    let order = [];     // tile index sitting at each position
    let tiles = [];     // { color, fixed, el }
    let selected = -1, moves = 0, locked = true, done = false, stageW = 600, stageH = 500;
    let par = 0; // the fewest swaps this scramble can be solved in

    function hud() {
      api.stat('Level', level);
      api.stat('Swaps', par ? moves + ' (par ' + par + ')' : String(moves));
    }
    function posOf(tile) { return order.indexOf(tile); }
    function layout(snap) {
      size = Math.max(22, Math.floor(Math.min((stageW - 16) / cols, (stageH - 104) / rows, 116)));
      if (snap) board.classList.add('snap');
      board.style.width = cols * size + 'px';
      board.style.height = rows * size + 'px';
      order.forEach(function (tile, pos) {
        const el = tiles[tile].el;
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.setProperty('--x', (pos % cols) * size + 'px');
        el.style.setProperty('--y', Math.floor(pos / cols) * size + 'px');
      });
      if (snap) { void board.offsetWidth; board.classList.remove('snap'); } // apply without animating
    }
    function isSolved() {
      for (let p = 0; p < order.length; p++) if (tiles[order[p]].color !== goal[p]) return false;
      return true;
    }
    function build(n) {
      level = n;
      const spec = LEVELS[(n - 1) % LEVELS.length];
      cols = spec[0];
      rows = spec[1];
      goal = palette(cols, rows, Math.random);
      board.textContent = '';
      tiles = goal.map(function (color, i) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'hue-tile';
        el.style.background = color;
        const fixed = pinned(spec[2], i % cols, Math.floor(i / cols), cols, rows);
        if (fixed) el.classList.add('fixed');
        el.setAttribute('aria-label', fixed ? 'Pinned tile' : 'Tile');
        el.addEventListener('click', function () { tap(i); });
        board.appendChild(el);
        return { color: color, fixed: fixed, el: el };
      });
      order = tiles.map(function (t, i) { return i; });
      selected = -1;
      moves = 0;
      par = 0;
      done = false;
      locked = true;
      layout(true);
      hud();
      msg.textContent = 'Here is the finished gradient. Take a look.';
      api.after(1.5, function () {
        const loose = [];
        tiles.forEach(function (t, i) { if (!t.fixed) loose.push(i); });
        order = scramble(order, loose, Math.random);
        par = minSwaps(order);
        hud();
        layout(false);
        locked = false;
        msg.textContent = 'Put it back. Click two tiles to swap them. Dotted tiles are pinned.';
        api.sfx.tone(300, 0.2, { type: 'triangle', to: 180 });
      });
    }
    function flag(el, cls, seconds) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
      api.after(seconds, function () { el.classList.remove(cls); });
    }
    function tap(tile) {
      if (!api.playing || locked || done) return;
      const t = tiles[tile];
      if (t.fixed) { flag(t.el, 'nudge', 0.3); return; }
      if (selected < 0) {
        selected = tile;
        t.el.classList.add('sel');
        api.sfx.click();
        return;
      }
      const other = selected;
      tiles[other].el.classList.remove('sel');
      selected = -1;
      if (other === tile) return;
      const a = posOf(tile), b = posOf(other);
      order[a] = other;
      order[b] = tile;
      moves++;
      api.tally('swaps');
      [t.el, tiles[other].el].forEach(function (el) {
        el.classList.add('moving');
        api.after(0.3, function () { el.classList.remove('moving'); });
      });
      layout(false);
      api.sfx.tone(440, 0.07, { type: 'triangle', to: 560, vol: 0.12 });
      hud();
      if (isSolved()) win();
    }
    function win() {
      done = true;
      msg.textContent = 'Solved in ' + moves + (moves === 1 ? ' swap.' : ' swaps.');
      order.forEach(function (tile, pos) {
        const el = tiles[tile].el, d = (pos % cols + Math.floor(pos / cols)) * 0.035;
        api.after(d, function () { flag(el, 'cheer', 0.55); });
      });
      api.sfx.win();
      api.submitScore(level);
      api.save('level', level + 1);
      api.tally('boards');
      api.high('largest', cols * rows);
      if (moves <= par) api.tally('ideal');
      api.after(2.1, function () { build(level + 1); });
    }
    function hint() {
      if (!api.playing || locked || done) return;
      for (let p = 0; p < order.length; p++) {
        if (tiles[order[p]].color === goal[p]) continue;
        // the tile that belongs here, and the one sitting in its place
        let home = -1;
        for (let i = 0; i < tiles.length && home < 0; i++) if (tiles[i].color === goal[p] && posOf(i) !== p) home = i;
        flag(tiles[order[p]].el, 'flag', 1.6);
        if (home >= 0) flag(tiles[home].el, 'flag', 1.6);
        msg.textContent = 'Those two want to trade places.';
        api.tally('hints');
        return;
      }
    }
    hintBtn.addEventListener('click', function () { hint(); hintBtn.blur(); });
    const againBtn = document.createElement('button');
    againBtn.type = 'button';
    againBtn.className = 'btn small quiet';
    againBtn.textContent = 'Back to level 1';
    againBtn.addEventListener('click', function () {
      againBtn.blur();
      if (!api.playing || locked || done) return;
      api.save('level', 1);
      build(1);
    });
    bar.appendChild(againBtn);

    api.onResize(function (w, h) {
      stageW = w;
      stageH = h;
      if (tiles.length) layout(true);
    });
    api.loop(null, null);
    build(1);
    msg.textContent = '';

    return {
      start: function () { build(Math.max(1, Math.floor(Number(api.load('level', 1)) || 1))); },
      peek: function () { return { level: level, cols: cols, rows: rows, moves: moves, locked: locked, done: done, order: order.slice(), goal: goal.slice(), colors: tiles.map(function (t) { return t.color; }), fixed: tiles.map(function (t) { return t.fixed; }) }; },
      tap: tap
    };
  }

  A.register({
    id: 'hueshift',
    title: 'Hue Shift',
    tagline: 'A gradient, scrambled. Swap the tiles back into order.',
    genre: 'Colour',
    input: 'Mouse or touch',
    color: 'pink',
    bestLabel: 'Furthest level cleared',
    stats: [
      { key: 'boards', label: 'Boards solved', kind: 'tally', headline: true },
      { key: 'ideal', label: 'Solved in the fewest possible swaps', kind: 'tally' },
      { key: 'swaps', label: 'Swaps made', kind: 'tally' },
      { key: 'hints', label: 'Trades pointed out', kind: 'tally' },
      { key: 'largest', label: 'Largest board solved', kind: 'high', unit: ' tiles' }
    ],
    scoreLabel: 'Cleared',
    formatScore: function (v) { return 'Level ' + v; },
    how: [
      'You get a moment to look at the finished gradient before it scrambles.',
      'Click one tile, then another, to swap them. Tiles with a dot are pinned in place.',
      'Rebuild the smooth blend of colour. There is no clock.',
      'Stuck? "Show me one" points out two tiles that should trade. Your level is saved.'
    ],
    logic: { LEVELS: LEVELS, pinned: pinned, oklch: oklch, palette: palette, scramble: scramble, minSwaps: minSwaps },
    thumb: function (ctx, w, h, t) {
      const c = 7, r = 4, s = 36, ox = (w - c * s) / 2, oy = (h - r * s) / 2;
      const swap = Math.floor(t * 0.8) % 2 === 0;
      for (let y = 0; y < r; y++) {
        for (let x = 0; x < c; x++) {
          let u = x / (c - 1), v = y / (r - 1);
          // two tiles sit in each other's places half the time
          if (swap && x === 2 && y === 1) { u = 4 / (c - 1); v = 2 / (r - 1); }
          else if (swap && x === 4 && y === 2) { u = 2 / (c - 1); v = 1 / (r - 1); }
          ctx.fillStyle = oklch(0.86 - 0.36 * v, 0.15, 320 + 170 * u + 40 * v);
          ctx.fillRect(ox + x * s, oy + y * s, s + 0.5, s + 0.5);
        }
      }
      ctx.fillStyle = 'rgba(14,12,34,0.5)';
      [[0, 0], [c - 1, 0], [0, r - 1], [c - 1, r - 1]].forEach(function (p) {
        ctx.beginPath(); ctx.arc(ox + (p[0] + 0.5) * s, oy + (p[1] + 0.5) * s, 3, 0, Math.PI * 2); ctx.fill();
      });
      if (swap) {
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(ox + 2 * s + 1.5, oy + s + 1.5, s - 3, s - 3);
        ctx.strokeRect(ox + 4 * s + 1.5, oy + 2 * s + 1.5, s - 3, s - 3);
      }
    },
    create: create
  });
})();
