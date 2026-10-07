/* Lantern: find the way out of a dark maze before the oil runs dry. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors, TAU = U.TAU;

  const W = 720, H = 560, TOP = 26;
  const SPEED = 7;                                   // cells per second
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];      // north, east, south, west
  const KEY_DIR = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
  const DIR_KEYS = [['ArrowUp', 'KeyW'], ['ArrowRight', 'KeyD'], ['ArrowDown', 'KeyS'], ['ArrowLeft', 'KeyA']];
  const SIZES = [[10, 8], [12, 9], [14, 11], [16, 12], [18, 14], [20, 15]];
  const NIGHT = '#080716';

  // Carves a maze with a depth-first walk, then knocks out a few extra walls so there are loops.
  // walls[i] has bit d set when cell i is walled on side d.
  function makeMaze(c, r, rnd, braid) {
    const walls = new Uint8Array(c * r).fill(15), seen = new Uint8Array(c * r), stack = [0];
    const open = function (a, d) {
      walls[a] &= ~(1 << d);
      walls[a + DX[d] + DY[d] * c] &= ~(1 << ((d + 2) % 4));
    };
    seen[0] = 1;
    while (stack.length) {
      const cur = stack[stack.length - 1], x = cur % c, y = Math.floor(cur / c), opts = [];
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < c && ny < r && !seen[ny * c + nx]) opts.push(d);
      }
      if (!opts.length) { stack.pop(); continue; }
      const d = opts[Math.floor(rnd() * opts.length)], next = cur + DX[d] + DY[d] * c;
      open(cur, d);
      seen[next] = 1;
      stack.push(next);
    }
    let extra = Math.floor(c * r * braid);
    for (let tries = 0; extra > 0 && tries < 4000; tries++) {
      const x = Math.floor(rnd() * c), y = Math.floor(rnd() * r), d = Math.floor(rnd() * 4);
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= c || ny >= r || !(walls[y * c + x] & (1 << d))) continue;
      open(y * c + x, d);
      extra--;
    }
    return { c: c, r: r, walls: walls };
  }

  // Steps from `from` to every cell, breadth first.
  function distances(mz, from) {
    const dist = new Int32Array(mz.c * mz.r).fill(-1), queue = [from];
    dist[from] = 0;
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      for (let d = 0; d < 4; d++) {
        if (mz.walls[cur] & (1 << d)) continue;
        const next = cur + DX[d] + DY[d] * mz.c;
        if (dist[next] < 0) { dist[next] = dist[cur] + 1; queue.push(next); }
      }
    }
    return dist;
  }

  // Start in a corner, exit at the farthest cell, oil and gems tucked into dead ends first.
  function buildLevel(level, rnd) {
    const size = SIZES[Math.min(level, SIZES.length) - 1], c = size[0], r = size[1];
    const mz = makeMaze(c, r, rnd, 0.05);
    const start = [0, c - 1, (r - 1) * c, r * c - 1][Math.floor(rnd() * 4)];
    const dist = distances(mz, start);
    let exit = start;
    for (let i = 0; i < dist.length; i++) if (dist[i] > dist[exit]) exit = i;
    const dead = [], other = [];
    for (let i = 0; i < c * r; i++) {
      if (i === start || i === exit) continue;
      const w = mz.walls[i], count = (w & 1) + ((w >> 1) & 1) + ((w >> 2) & 1) + ((w >> 3) & 1);
      (count === 3 ? dead : other).push(i);
    }
    const spots = U.shuffle(dead, rnd).concat(U.shuffle(other, rnd));
    return {
      mz: mz, c: c, r: r, start: start, exit: exit, path: dist[exit],
      flasks: spots.splice(0, Math.min(4, 1 + Math.floor(level / 2))),
      gems: spots.splice(0, Math.min(10, 3 + level)),
      burn: U.clamp(dist[exit] / SPEED * 3 + 10, 26, 80) // seconds a full lantern lasts
    };
  }

  function create(api) {
    const view = api.canvas(W, H), ctx = view.ctx;
    const fog = document.createElement('canvas');
    fog.width = W;
    fog.height = H;
    const fctx = fog.getContext('2d');
    const sparks = api.Particles(), pops = api.Floaters();
    const virt = [false, false, false, false];
    let L = buildLevel(1, Math.random), level = 1, score = 0, oil = 1, seen = new Uint8Array(L.c * L.r);
    let flasks = [], gems = [], held = [], phase = 'play', wait = 0, beatT = 0;
    let cs = 40, ox = 0, oy = 0;
    let pl = { cell: 0, to: 0, t: 0, moving: false, dir: 2 };
    let gemsRun = 0;

    function hud() {
      api.stat('Maze', level);
      api.stat('Oil', Math.max(0, Math.ceil(oil * 100)) + '%');
      api.stat('Gems', gemsRun);
      api.stat('Score', score);
    }
    function load(n) {
      level = n;
      if (api.playing) api.high('deepest', n);
      L = buildLevel(n, Math.random);
      cs = Math.floor(Math.min(W / L.c, (H - TOP) / L.r));
      ox = (W - cs * L.c) / 2;
      oy = TOP + (H - TOP - cs * L.r) / 2;
      seen = new Uint8Array(L.c * L.r);
      flasks = L.flasks.slice();
      gems = L.gems.slice();
      pl = { cell: L.start, to: L.start, t: 0, moving: false, dir: 2 };
      oil = 1;
      phase = 'play';
      beatT = 0;
      hud();
    }
    function cellX(i) { return ox + (i % L.c + 0.5) * cs; }
    function cellY(i) { return oy + (Math.floor(i / L.c) + 0.5) * cs; }
    function isDown(d) { return virt[d] || api.key(DIR_KEYS[d][0]) || api.key(DIR_KEYS[d][1]); }
    // The most recently pressed direction that is still held and not walled off.
    function wantDir() {
      for (let i = held.length - 1; i >= 0; i--) {
        const d = held[i];
        if (isDown(d) && !(L.mz.walls[pl.cell] & (1 << d))) return d;
      }
      return -1;
    }
    function press(d) {
      const at = held.indexOf(d);
      if (at >= 0) held.splice(at, 1);
      held.push(d);
    }
    function begin(d) {
      pl.to = pl.cell + DX[d] + DY[d] * L.c;
      pl.t = 0;
      pl.moving = true;
      pl.dir = d;
    }
    function arrive() {
      const at = pl.cell;
      api.tally('steps');
      let k = flasks.indexOf(at);
      if (k >= 0) {
        flasks.splice(k, 1);
        oil = Math.min(1, oil + 0.4);
        api.tally('flasks');
        pops.add(cellX(at), cellY(at) - 16, 'OIL +40%', C.sun, 14);
        api.sfx.good();
      }
      k = gems.indexOf(at);
      if (k >= 0) {
        gems.splice(k, 1);
        score += 25;
        gemsRun++;
        api.tally('gems');
        pops.add(cellX(at), cellY(at) - 16, '+25', C.mint, 14);
        api.sfx.tone(988, 0.1, { type: 'triangle' });
      }
      if (at === L.exit) {
        const bonus = 100 * level + Math.round(oil * 100);
        api.tally('mazes');
        api.low('close', Math.max(1, Math.round(oil * 100)));
        score += bonus;
        pops.add(cellX(at), cellY(at) - 20, '+' + bonus, C.mint, 18);
        sparks.burst(cellX(at), cellY(at), { count: 36, color: C.mint, speed: 190, life: 0.9 });
        phase = 'won';
        wait = 1.3;
        api.sfx.win();
        api.submitScore(score);
      }
      hud();
    }
    function playerPos() {
      const k = pl.moving ? pl.t : 0;
      return { x: U.lerp(cellX(pl.cell), cellX(pl.to), k), y: U.lerp(cellY(pl.cell), cellY(pl.to), k) };
    }
    function radius(t) {
      const base = cs * (1.2 + 3.3 * Math.pow(Math.max(0, oil), 0.8)) * (1 + 0.025 * Math.sin(t * 13) + 0.015 * Math.sin(t * 29));
      return phase === 'dark' ? base * Math.max(0, wait / 1.2) : base;
    }

    function update(dt) {
      sparks.update(dt);
      pops.update(dt);
      held = held.filter(isDown);

      if (pl.moving) {
        pl.t += dt * SPEED;
        if (pl.t >= 1) {
          const extra = pl.t - 1;
          pl.cell = pl.to;
          pl.moving = false;
          pl.t = 0;
          arrive();
          if (phase === 'play') {
            const d = wantDir();
            if (d >= 0) { begin(d); pl.t = Math.min(extra, 0.9); }
          }
        }
      } else if (phase === 'play') {
        const d = wantDir();
        if (d >= 0) begin(d);
      }

      if (phase === 'play') {
        // remember every cell the light has reached
        const p = playerPos(), reach = radius(0) * 0.8;
        const x0 = Math.max(0, Math.floor((p.x - reach - ox) / cs)), x1 = Math.min(L.c - 1, Math.floor((p.x + reach - ox) / cs));
        const y0 = Math.max(0, Math.floor((p.y - reach - oy) / cs)), y1 = Math.min(L.r - 1, Math.floor((p.y + reach - oy) / cs));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const i = y * L.c + x;
            if (!seen[i] && Math.hypot(cellX(i) - p.x, cellY(i) - p.y) < reach) seen[i] = 1;
          }
        }
        oil -= dt / L.burn;
        if (oil < 0.25) {
          beatT -= dt;
          if (beatT <= 0) {
            beatT = 0.9;
            api.sfx.tone(72, 0.12, { vol: 0.22 });
            api.sfx.tone(62, 0.14, { vol: 0.18, delay: 0.17 });
          }
        }
        if (oil <= 0) {
          oil = 0;
          phase = 'dark';
          wait = 1.2;
          api.sfx.lose();
        }
        hud();
      } else if (phase === 'won') {
        wait -= dt;
        if (wait <= 0) load(level + 1);
      } else if (phase === 'dark') {
        wait -= dt;
        if (wait <= 0) {
          phase = 'over';
          api.gameOver({ title: 'The light went out', score: score, lines: [level > 1 ? 'You escaped ' + (level - 1) + (level === 2 ? ' maze.' : ' mazes.') : 'Oil flasks buy time. The arrow by your feet points at the exit.'] });
        }
      }
    }

    function draw(dt, t) {
      ctx.fillStyle = NIGHT;
      ctx.fillRect(0, 0, W, H);
      const n = L.c * L.r, p = playerPos(), R = radius(t);

      ctx.fillStyle = C.bg2;
      for (let i = 0; i < n; i++) {
        if (seen[i]) ctx.fillRect(cellX(i) - cs / 2, cellY(i) - cs / 2, cs + 0.5, cs + 0.5);
      }
      ctx.strokeStyle = C.violet;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (!seen[i]) continue;
        const x = cellX(i) - cs / 2, y = cellY(i) - cs / 2, w = L.mz.walls[i];
        if (w & 1) { ctx.moveTo(x, y); ctx.lineTo(x + cs, y); }
        if (w & 2) { ctx.moveTo(x + cs, y); ctx.lineTo(x + cs, y + cs); }
        if (w & 4) { ctx.moveTo(x, y + cs); ctx.lineTo(x + cs, y + cs); }
        if (w & 8) { ctx.moveTo(x, y); ctx.lineTo(x, y + cs); }
      }
      ctx.stroke();
      ctx.lineCap = 'butt';

      if (seen[L.exit]) {
        const ex = cellX(L.exit), ey = cellY(L.exit), s = cs * 0.3 * (1 + 0.1 * Math.sin(t * 5));
        ctx.fillStyle = U.alpha(C.mint, 0.25);
        ctx.fillRect(ex - cs / 2 + 2, ey - cs / 2 + 2, cs - 4, cs - 4);
        ctx.strokeStyle = C.mint;
        ctx.lineWidth = 3;
        ctx.strokeRect(ex - s, ey - s, s * 2, s * 2);
      }
      for (let i = 0; i < flasks.length; i++) {
        if (!seen[flasks[i]]) continue;
        const x = cellX(flasks[i]), y = cellY(flasks[i]), s = cs * 0.2;
        ctx.fillStyle = C.sun;
        ctx.beginPath(); ctx.arc(x, y + s * 0.3, s, 0, TAU); ctx.fill();
        ctx.fillRect(x - s * 0.35, y - s * 1.3, s * 0.7, s);
      }
      for (let i = 0; i < gems.length; i++) {
        if (!seen[gems[i]]) continue;
        const x = cellX(gems[i]), y = cellY(gems[i]), s = cs * 0.2;
        ctx.fillStyle = C.mint;
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.8, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.8, y); ctx.closePath(); ctx.fill();
      }

      // the explorer
      ctx.fillStyle = C.ink;
      ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.24, 0, TAU); ctx.fill();
      ctx.fillStyle = C.sun;
      ctx.beginPath(); ctx.arc(p.x + DX[pl.dir] * cs * 0.24, p.y + DY[pl.dir] * cs * 0.24, cs * 0.11, 0, TAU); ctx.fill();
      sparks.draw(ctx);

      // darkness, with a hole cut by the lantern
      fctx.globalCompositeOperation = 'source-over';
      fctx.clearRect(0, 0, W, H);
      fctx.fillStyle = 'rgba(8,7,22,0.84)';
      fctx.fillRect(0, 0, W, H);
      if (R > 1) {
        fctx.globalCompositeOperation = 'destination-out';
        const hole = fctx.createRadialGradient(p.x, p.y, R * 0.12, p.x, p.y, R);
        hole.addColorStop(0, 'rgba(0,0,0,1)');
        hole.addColorStop(0.6, 'rgba(0,0,0,0.85)');
        hole.addColorStop(1, 'rgba(0,0,0,0)');
        fctx.fillStyle = hole;
        fctx.beginPath(); fctx.arc(p.x, p.y, R, 0, TAU); fctx.fill();
      }
      ctx.drawImage(fog, 0, 0, W, H);
      if (R > 1) {
        ctx.globalCompositeOperation = 'lighter';
        const warm = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 0.9);
        warm.addColorStop(0, U.alpha(C.sun, 0.16));
        warm.addColorStop(1, U.alpha(C.sun, 0));
        ctx.fillStyle = warm;
        ctx.beginPath(); ctx.arc(p.x, p.y, R * 0.9, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      // a small arrow that always points at the exit, as the crow flies
      if (phase === 'play' && pl.cell !== L.exit) {
        const a = Math.atan2(cellY(L.exit) - p.y, cellX(L.exit) - p.x), d = cs * 0.66;
        ctx.save();
        ctx.translate(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
        ctx.rotate(a);
        ctx.fillStyle = U.alpha(C.mint, 0.75 + 0.25 * Math.sin(t * 5));
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -6.5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 6.5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      pops.draw(ctx);

      // oil gauge
      ctx.fillStyle = C.bg2;
      ctx.fillRect(0, 0, W, 12);
      ctx.fillStyle = oil < 0.25 && Math.floor(t * 5) % 2 === 0 ? C.coral : C.sun;
      ctx.fillRect(0, 0, W * U.clamp(oil, 0, 1), 12);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (phase === 'won') {
        ctx.fillStyle = C.mint;
        ctx.font = api.font(34, 'display');
        ctx.fillText('OUT', W / 2, H / 2);
      } else if (level === 1 && phase === 'play' && pl.cell === L.start && !pl.moving) {
        ctx.fillStyle = U.alpha(C.ink, 0.9);
        ctx.font = api.font(15, 'body');
        ctx.fillText(api.touch ? 'Use the pad to walk. Find the green exit.' : 'Arrow keys or WASD to walk. Find the green exit.', W / 2, H - 22);
      }
    }

    api.onKey(function (e) {
      if (e.repeat) return;
      const d = KEY_DIR[e.code];
      if (d !== undefined) press(d);
    });

    if (api.touch) {
      const pad = document.createElement('div');
      pad.className = 'dpad';
      [['up', 0, '▲'], ['right', 1, '▶'], ['down', 2, '▼'], ['left', 3, '◀']].forEach(function (b) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = b[0];
        el.textContent = b[2];
        el.setAttribute('aria-label', 'Walk ' + b[0]);
        el.addEventListener('pointerdown', function (e) { e.preventDefault(); virt[b[1]] = true; press(b[1]); });
        const off = function () { virt[b[1]] = false; };
        el.addEventListener('pointerup', off);
        el.addEventListener('pointercancel', off);
        el.addEventListener('pointerleave', off);
        pad.appendChild(el);
      });
      api.stage.appendChild(pad);
    }

    api.loop(update, draw);
    load(1);

    return {
      start: function () {
        score = 0;
        gemsRun = 0;
        held = [];
        sparks.clear();
        pops.clear();
        load(1);
      },
      peek: function () { return { level: level, phase: phase, oil: oil, score: score, cell: pl.cell, exit: L.exit, c: L.c, r: L.r, walls: Array.prototype.slice.call(L.mz.walls), flasks: flasks.slice(), gems: gems.slice(), burn: L.burn, path: L.path }; }
    };
  }

  A.register({
    id: 'lantern',
    title: 'Lantern',
    tagline: 'A dark maze, a dying lamp, and one way out.',
    genre: 'Maze',
    input: 'Keyboard',
    color: 'sun',
    stats: [
      { key: 'mazes', label: 'Mazes escaped', kind: 'tally', headline: true },
      { key: 'deepest', label: 'Deepest maze reached', kind: 'high' },
      { key: 'gems', label: 'Gems found', kind: 'tally' },
      { key: 'flasks', label: 'Oil flasks used', kind: 'tally' },
      { key: 'steps', label: 'Steps walked', kind: 'tally' },
      { key: 'close', label: 'Closest call at an exit', kind: 'low', unit: '% oil left' }
    ],
    how: [
      'Walk with the arrow keys or WASD. You only see what the lantern reaches.',
      'The light shrinks as the oil burns. Yellow flasks top it up.',
      'The green arrow by your feet points at the exit as the crow flies.',
      'Gems are worth points, if you can spare the oil. Each maze is bigger than the last.'
    ],
    logic: { makeMaze: makeMaze, distances: distances, buildLevel: buildLevel, SIZES: SIZES },
    thumb: function (ctx, w, h, t) {
      ctx.fillStyle = NIGHT;
      ctx.fillRect(0, 0, w, h);
      const cs = 40, px = 160 + Math.sin(t * 1.4) * 20, py = 100;
      const walls = [[0, 1, 3, 1], [1, 0, 1, 1], [4, 1, 4, 3], [2, 2, 4, 2], [5, 0, 5, 2], [1, 3, 3, 3], [6, 1, 6, 4], [2, 4, 2, 5], [3, 4, 5, 4], [7, 2, 8, 2], [7, 3, 7, 5], [0, 4, 1, 4], [5, 3, 6, 3]];
      ctx.strokeStyle = C.violet;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      walls.forEach(function (s) { ctx.moveTo(s[0] * cs, s[1] * cs); ctx.lineTo(s[2] * cs, s[3] * cs); });
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = C.sun;
      ctx.beginPath(); ctx.arc(220, 62, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.beginPath(); ctx.arc(px, py, 8, 0, TAU); ctx.fill();
      // darkness everywhere the lamp does not reach
      const R = 82 + Math.sin(t * 9) * 2;
      const g = ctx.createRadialGradient(px, py, R * 0.3, px, py, R);
      g.addColorStop(0, 'rgba(8,7,22,0)');
      g.addColorStop(1, 'rgba(8,7,22,0.97)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      const warm = ctx.createRadialGradient(px, py, 0, px, py, R);
      warm.addColorStop(0, U.alpha(C.sun, 0.2));
      warm.addColorStop(1, U.alpha(C.sun, 0));
      ctx.fillStyle = warm;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    },
    create: create
  });
})();
