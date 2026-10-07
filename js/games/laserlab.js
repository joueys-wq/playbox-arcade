/* Laser Lab: bend one beam through every crystal with a handful of mirrors, and trip no alarm. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors, TAU = U.TAU;

  const S = 640, BOARD = 520;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // east, south, west, north

  // Board cells: '' empty, 'B' solid block, 'T' crystal (must be lit), 'A' alarm (must stay dark).
  // pz.bolted maps a cell to a mirror that belongs to the board and cannot be moved.

  // The direction a beam travelling in direction d leaves a mirror in.
  function turn(kind, d) { return kind === '/' ? 3 - d : d ^ 1; }

  // Follows the beam from the emitter. `mirrors` maps a cell index to '/' or '\'.
  // Returns the corner points of the beam (in cell units), the crystals it lit, the alarms it
  // tripped, the mirrors it bounced off in order, and every cell it crossed.
  function trace(pz, mirrors) {
    const n = pz.n, pts = [], lit = {}, tripped = {}, hits = [], cells = [];
    let x = pz.emit.x, y = pz.emit.y, d = pz.emit.d, guard = n * n * 4, alarms = 0;
    pts.push(x + 0.5 - DX[d] * 0.5, y + 0.5 - DY[d] * 0.5);
    while (guard-- > 0) {
      if (x < 0 || y < 0 || x >= n || y >= n || pz.cells[y * n + x] === 'B') {
        pts.push(x + 0.5 - DX[d] * 0.5, y + 0.5 - DY[d] * 0.5); // stops on the face it reached
        break;
      }
      const i = y * n + x, c = pz.cells[i];
      cells.push(i);
      if (c === 'T') lit[i] = true;
      else if (c === 'A' && !tripped[i]) { tripped[i] = true; alarms++; }
      const m = pz.bolted[i] || mirrors[i];
      if (m) {
        pts.push(x + 0.5, y + 0.5);
        hits.push(i);
        d = turn(m, d);
      }
      x += DX[d];
      y += DY[d];
    }
    return { pts: pts, lit: lit, tripped: tripped, alarms: alarms, hits: hits, cells: cells };
  }

  function solved(pz, mirrors) {
    const t = trace(pz, mirrors);
    return t.alarms === 0 && pz.targets.every(function (i) { return t.lit[i]; });
  }

  // Can the board be solved with at most `limit` mirrors? Walks the beam depth first: the first
  // time it reaches an empty cell, that cell is either left empty for good or given a mirror.
  // Returns { ok, out }, where `out` means the search ran out of budget before it could be sure.
  function beatable(pz, limit, budget) {
    const n = pz.n, total = pz.targets.length, deepest = n * n * 4;
    const placed = [], passed = new Uint8Array(n * n), seen = new Uint8Array(n * n);
    let nodes = 0, out = false;
    function go(x, y, d, left, lit, depth) {
      if (out || depth > deepest) return false;
      if (++nodes > budget) { out = true; return false; }
      if (x < 0 || y < 0 || x >= n || y >= n) return lit === total;
      const i = y * n + x, c = pz.cells[i];
      if (c === 'B') return lit === total;
      if (c === 'A') return false;
      let gained = 0;
      if (c === 'T' && !seen[i]) { seen[i] = 1; gained = 1; }
      const mirror = pz.bolted[i] || placed[i];
      let ok;
      if (mirror) {
        const nd = turn(mirror, d);
        ok = go(x + DX[nd], y + DY[nd], nd, left, lit + gained, depth + 1);
      } else {
        passed[i]++;
        ok = go(x + DX[d], y + DY[d], d, left, lit + gained, depth + 1);
        passed[i]--;
        // a mirror can only go on an empty cell the beam has not already crossed
        if (!ok && left > 0 && c === '' && !passed[i]) {
          for (let o = 0; o < 2 && !ok; o++) {
            const kind = o ? '\\' : '/', nd = turn(kind, d);
            placed[i] = kind;
            ok = go(x + DX[nd], y + DY[nd], nd, left - 1, lit + gained, depth + 1);
            placed[i] = undefined;
          }
        }
      }
      if (gained) seen[i] = 0;
      return ok;
    }
    const ok = go(pz.emit.x, pz.emit.y, pz.emit.d, limit, 0, 0);
    return { ok: ok, out: out };
  }

  // What each level asks for. Boards grow to ten by ten and the hand of mirrors to nine. Not
  // every leg of the answer carries a crystal, alarms guard the tempting shortcuts, and some
  // mirrors are bolted to the board: a few on the answer's path, a few there to mislead.
  function spec(level) {
    const k = Math.min(9, 3 + Math.floor(level / 2));
    return {
      n: Math.min(10, 7 + Math.floor((level - 1) / 2)),
      k: k,
      crystals: Math.max(2, Math.round(k * 0.6)),
      alarms: Math.min(6, 1 + Math.floor(level / 2)),
      boltedOn: Math.min(2, Math.floor(level / 3)),
      boltedOff: Math.min(3, Math.floor((level + 1) / 3)),
      blocks: Math.min(7, 3 + Math.floor(level / 2))
    };
  }

  // Builds a puzzle backwards from its answer: lay a beam with one bounce per mirror, keep some
  // of those mirrors as bolted fixtures, drop crystals on a few legs, then dress the unused
  // squares with alarms, decoy mirrors and blocks, and take the player's mirrors away.
  function attempt(sp, rnd) {
    const n = sp.n, bounces = sp.k + sp.boltedOn;
    const ri = function (m) { return Math.floor(rnd() * m); };
    const side = ri(4), pos = ri(n);
    const emit = side === 0 ? { x: 0, y: pos, d: 0 } : side === 1 ? { x: pos, y: 0, d: 1 } : side === 2 ? { x: n - 1, y: pos, d: 2 } : { x: pos, y: n - 1, d: 3 };
    const cells = [];
    for (let i = 0; i < n * n; i++) cells.push('');
    const pz = { n: n, emit: emit, cells: cells, targets: [], k: sp.k, bolted: {}, solution: {}, order: [] };
    const path = {}; // every mirror on the answer's route, bolted or not

    for (let j = 0; j < bounces; j++) {
      const t = trace(pz, path);
      const from = j === 0 ? 0 : t.cells.lastIndexOf(t.hits[j - 1]) + 1;
      const earlier = {};
      for (let i = 0; i < from; i++) earlier[t.cells[i]] = true;
      // the next mirror goes on the last leg, past its first cell, on a cell the beam has not used
      const cands = t.cells.slice(from + 1).filter(function (c) { return !earlier[c]; });
      if (!cands.length) return null;
      const cell = cands[ri(cands.length)];
      const first = rnd() < 0.5 ? '/' : '\\', second = first === '/' ? '\\' : '/';
      let placed = false;
      [first, second].forEach(function (o) {
        if (placed) return;
        path[cell] = o;
        const t2 = trace(pz, path);
        // it must be the newest bounce, hit once, with at least two cells of beam after it
        const ok = t2.hits.length === j + 1 && t2.hits[j] === cell && t2.cells.length - 1 - t2.cells.lastIndexOf(cell) >= 2;
        if (ok) placed = true; else delete path[cell];
      });
      if (!placed) return null;
    }

    const t = trace(pz, path);
    if (t.hits.length !== bounces) return null;
    const visits = {};
    t.cells.forEach(function (c) { visits[c] = (visits[c] || 0) + 1; });

    // crystals: always one on the final leg, the rest on other legs picked at random
    const legs = [];
    for (let s = 1; s <= bounces; s++) {
      const a = t.cells.lastIndexOf(t.hits[s - 1]) + 1;
      const b = s < bounces ? t.cells.indexOf(t.hits[s]) : t.cells.length;
      const open = t.cells.slice(a, b).filter(function (c) { return visits[c] === 1 && !path[c]; });
      if (open.length) legs.push({ last: s === bounces, cell: open[ri(open.length)] });
    }
    const finale = legs.filter(function (g) { return g.last; })[0];
    if (!finale) return null;
    const others = U.shuffle(legs.filter(function (g) { return !g.last; }), rnd).slice(0, sp.crystals - 1);
    if (others.length < Math.min(1, sp.crystals - 1)) return null;
    [finale].concat(others).forEach(function (g) { pz.cells[g.cell] = 'T'; pz.targets.push(g.cell); });

    // which of the route's mirrors stay on the board for good
    const keep = {};
    U.shuffle(t.hits.slice(), rnd).slice(0, sp.boltedOn).forEach(function (c) { keep[c] = true; });
    t.hits.forEach(function (c) {
      if (keep[c]) pz.bolted[c] = path[c];
      else { pz.solution[c] = path[c]; pz.order.push(c); }
    });

    // alarms go first on the squares a lazy beam would run into: straight on past where a
    // mirror belongs, then squares beside the route, then anywhere else off the route
    const free = function (i) { return !visits[i] && pz.cells[i] === '' && !pz.bolted[i]; };
    const tempting = [], beside = [], taken = {};
    let x = emit.x, y = emit.y, d = emit.d;
    for (let i = 0; i < t.cells.length; i++) {
      const c = t.cells[i];
      if (pz.solution[c]) {
        for (let far = 1; far <= 2; far++) {
          const tx = x + DX[d] * far, ty = y + DY[d] * far;
          if (tx >= 0 && ty >= 0 && tx < n && ty < n && free(ty * n + tx) && !taken[ty * n + tx]) { taken[ty * n + tx] = true; tempting.push(ty * n + tx); }
        }
      }
      for (let q = 0; q < 4; q++) {
        const bx = x + DX[q], by = y + DY[q];
        if (bx >= 0 && by >= 0 && bx < n && by < n && free(by * n + bx) && !taken[by * n + bx]) { taken[by * n + bx] = true; beside.push(by * n + bx); }
      }
      if (path[c]) d = turn(path[c], d);
      x += DX[d];
      y += DY[d];
    }
    const rest = [];
    for (let i = 0; i < n * n; i++) if (free(i) && !taken[i]) rest.push(i);
    // only half the alarms sit on tempting squares, or they would give the mirrors away
    const lures = U.shuffle(tempting, rnd).splice(0, Math.ceil(sp.alarms / 2));
    const pool = U.shuffle(tempting.concat(beside, rest), rnd);
    lures.concat(pool.splice(0, sp.alarms - lures.length)).forEach(function (c) { pz.cells[c] = 'A'; });
    // decoy mirrors and blocks take other squares off the route
    pool.splice(0, sp.boltedOff).forEach(function (c) { pz.bolted[c] = rnd() < 0.5 ? '/' : '\\'; });
    pool.splice(0, sp.blocks).forEach(function (c) { pz.cells[c] = 'B'; });

    return solved(pz, pz.solution) ? pz : null;
  }

  // A fair puzzle that cannot be solved with fewer mirrors than the hand holds. Smaller hands are
  // checked exhaustively; for the biggest the search stops at its budget, having ruled out every
  // answer that uses noticeably fewer mirrors.
  function generate(level, rnd) {
    const sp = spec(level);
    let spare = null;
    for (let i = 0; i < 500; i++) {
      const pz = attempt(sp, rnd);
      if (!pz) continue;
      spare = spare || pz;
      let easy = false;
      for (let m = 0; m < sp.k && !easy; m++) {
        const r = beatable(pz, m, 300000);
        if (r.out) break;
        easy = r.ok;
      }
      if (!easy) return pz;
    }
    if (spare) return spare;
    // never reached in practice, but a puzzle must always come back
    const cells = [];
    for (let i = 0; i < 36; i++) cells.push('');
    cells[3] = 'T';
    return { n: 6, emit: { x: 0, y: 2, d: 0 }, cells: cells, targets: [3], k: 1, bolted: {}, solution: { 15: '/' }, order: [15] };
  }

  function drawMirror(ctx, px, py, cs, kind, color, bolted) {
    const a = cs * 0.2, b = cs * 0.8;
    const x0 = px + a, y0 = kind === '/' ? py + b : py + a, x1 = px + b, y1 = kind === '/' ? py + a : py + b;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, cs * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.lineCap = 'butt';
    if (bolted) { // a bolt at each end marks a mirror that is part of the board
      const r = Math.max(3, cs * 0.085);
      ctx.fillStyle = C.bg2;
      ctx.lineWidth = 2;
      [[x0, y0], [x1, y1]].forEach(function (p) {
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill(); ctx.stroke();
      });
    }
  }
  function drawCrystal(ctx, cx, cy, r, lit, t) {
    const s = lit ? r * (1 + 0.08 * Math.sin(t * 6)) : r * 0.9;
    if (lit) {
      ctx.fillStyle = U.alpha(C.sun, 0.25);
      ctx.beginPath(); ctx.arc(cx, cy, s * 1.5, 0, TAU); ctx.fill();
    }
    ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.75, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s * 0.75, cy); ctx.closePath();
    if (lit) { ctx.fillStyle = C.sun; ctx.fill(); }
    else { ctx.strokeStyle = C.violet; ctx.lineWidth = 2.5; ctx.stroke(); }
  }
  // An alarm is a ringed dot: quiet when dark, loud when the beam is on it.
  function drawAlarm(ctx, cx, cy, r, tripped, t) {
    if (tripped) {
      const k = 0.5 + 0.5 * Math.sin(t * 14);
      ctx.fillStyle = U.alpha(C.coral, 0.25 + 0.3 * k);
      ctx.beginPath(); ctx.arc(cx, cy, r * (1.7 + 0.4 * k), 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = U.alpha(C.coral, tripped ? 1 : 0.75);
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    ctx.fillStyle = tripped ? C.ink : C.coral;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.38, 0, TAU); ctx.fill();
  }
  function drawBeam(ctx, pts, ox, oy, cs, t, color) {
    if (pts.length < 4) return;
    const line = function () {
      ctx.beginPath();
      ctx.moveTo(ox + pts[0] * cs, oy + pts[1] * cs);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(ox + pts[i] * cs, oy + pts[i + 1] * cs);
      ctx.stroke();
    };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = U.alpha(color, 0.25);
    ctx.lineWidth = Math.max(8, cs * 0.2);
    line();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    line();
    ctx.strokeStyle = U.alpha(C.ink, 0.85);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 14]);
    ctx.lineDashOffset = -t * 60;
    line();
    ctx.setLineDash([]);
    ctx.lineJoin = 'miter';
  }

  function create(api) {
    const view = api.canvas(S, S, { reserve: 52 }), ctx = view.ctx;
    const sparks = api.Particles();
    let level = 1, pz = generate(1, Math.random), mirrors = {}, fixed = {}, left = pz.k, hints = 0;
    let clock = 0; // seconds spent on the current puzzle
    let beam = trace(pz, mirrors), phase = 'play', wait = 0, hover = -1, note = '', noteT = 0;
    let cs = Math.floor(BOARD / pz.n), ox = (S - cs * pz.n) / 2, oy = (S - cs * pz.n) / 2 + 14;

    const bar = document.createElement('div');
    bar.className = 'game-actions';
    const mk = function (label, fn) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small quiet';
      b.textContent = label;
      b.addEventListener('click', function () { if (api.playing && phase === 'play') fn(); b.blur(); });
      bar.appendChild(b);
      return b;
    };
    mk('Hint', hint);
    mk('Clear mirrors', clearAll);
    mk('Back to level 1', function () { api.save('level', 1); load(1); });
    api.stage.appendChild(bar);

    function say(text) { note = text; noteT = 2.8; }
    function hud() {
      api.stat('Level', level);
      api.stat('Mirrors left', left);
      api.stat('Hints', hints);
      api.stat('Time', U.clock(clock));
    }
    function refresh() {
      const wasQuiet = beam.alarms === 0;
      beam = trace(pz, mirrors);
      hud();
      if (phase !== 'play') return;
      if (beam.alarms > 0) {
        if (wasQuiet) { say('The beam is crossing an alarm. Steer it away.'); api.sfx.bad(); }
        return;
      }
      if (pz.targets.every(function (i) { return beam.lit[i]; })) {
        phase = 'won';
        wait = 1.6;
        pz.targets.forEach(function (i) {
          sparks.burst(ox + (i % pz.n + 0.5) * cs, oy + (Math.floor(i / pz.n) + 0.5) * cs, { count: 18, color: C.sun, speed: 160 });
        });
        api.sfx.win();
        api.submitScore(level);
        api.save('level', level + 1);
        api.tally('solved');
        api.high('biggest', pz.n);
        if (!hints) { api.tally('clean'); api.low('fastest', Math.round(clock * 10) / 10); }
      }
    }
    function load(n) {
      level = n;
      pz = generate(n, Math.random);
      mirrors = {};
      fixed = {};
      left = pz.k;
      hints = 0;
      clock = 0;
      phase = 'play';
      hover = -1;
      noteT = 0;
      cs = Math.floor(BOARD / pz.n);
      ox = (S - cs * pz.n) / 2;
      oy = (S - cs * pz.n) / 2 + 14;
      beam = trace(pz, mirrors);
      refresh();
    }
    // Whether the player may put a mirror on this square.
    function open(i) { return pz.cells[i] === '' && !pz.bolted[i] && !fixed[i]; }
    function cycle(i) {
      if (pz.cells[i] === 'T') { say('A crystal cannot hold a mirror.'); return; }
      if (pz.cells[i] === 'B') { say('That square is solid.'); return; }
      if (pz.cells[i] === 'A') { say('That is an alarm. Keep the beam off it.'); return; }
      if (pz.bolted[i]) { say('That mirror is bolted down. Use it or steer around it.'); return; }
      if (fixed[i]) { say('That mirror was a hint. It stays put.'); return; }
      const cur = mirrors[i];
      if (!cur) {
        if (left <= 0) { say('No mirrors left. Click one to turn it, and again to lift it.'); api.sfx.bad(); return; }
        mirrors[i] = '/';
        left--;
        api.tally('placed');
      } else if (cur === '/') {
        mirrors[i] = '\\';
      } else {
        delete mirrors[i];
        left++;
      }
      api.sfx.click();
      refresh();
    }
    function lift(i) {
      if (!mirrors[i] || fixed[i]) return;
      delete mirrors[i];
      left++;
      api.sfx.click();
      refresh();
    }
    function keepFixed() {
      mirrors = {};
      let n = 0;
      Object.keys(fixed).forEach(function (i) { mirrors[i] = pz.solution[i]; n++; });
      left = pz.k - n;
    }
    function clearAll() {
      keepFixed();
      api.sfx.click();
      refresh();
    }
    function hint() {
      let next = -1;
      for (let i = 0; i < pz.order.length && next < 0; i++) if (!fixed[pz.order[i]]) next = pz.order[i];
      if (next < 0) return;
      fixed[next] = true;
      hints++;
      api.tally('hints');
      keepFixed(); // hand the player's own mirrors back so the board matches the known answer
      say('One mirror placed for you. The rest are back in your hand.');
      api.sfx.good();
      refresh();
    }
    function cellAt(p) {
      const x = Math.floor((p.x - ox) / cs), y = Math.floor((p.y - oy) / cs);
      return x < 0 || y < 0 || x >= pz.n || y >= pz.n ? -1 : y * pz.n + x;
    }

    function update(dt) {
      sparks.update(dt);
      if (phase === 'play') {
        const before = Math.floor(clock);
        clock += dt;
        if (Math.floor(clock) !== before) hud();
      }
      if (noteT > 0) noteT -= dt;
      if (phase === 'won') {
        wait -= dt;
        if (wait <= 0) load(level + 1);
      }
    }

    function draw(dt, t) {
      const n = pz.n, size = cs * n;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, S, S);
      U.rr(ctx, ox - 6, oy - 6, size + 12, size + 12, 8);
      ctx.fillStyle = C.bg2;
      ctx.fill();

      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        ctx.moveTo(ox + i * cs, oy); ctx.lineTo(ox + i * cs, oy + size);
        ctx.moveTo(ox, oy + i * cs); ctx.lineTo(ox + size, oy + i * cs);
      }
      ctx.stroke();

      for (let i = 0; i < n * n; i++) {
        const px = ox + (i % n) * cs, py = oy + Math.floor(i / n) * cs;
        if (pz.cells[i] === 'B') {
          U.rr(ctx, px + 4, py + 4, cs - 8, cs - 8, 4);
          ctx.fillStyle = C.line;
          ctx.fill();
        } else if (i === hover && phase === 'play' && open(i)) {
          ctx.fillStyle = U.alpha(C.ink, 0.07);
          ctx.fillRect(px + 1, py + 1, cs - 2, cs - 2);
        }
      }

      // emitter, sitting just outside the edge it fires through
      const e = pz.emit, ex = ox + (e.x + 0.5 - DX[e.d] * 0.5) * cs, ey = oy + (e.y + 0.5 - DY[e.d] * 0.5) * cs;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(e.d * Math.PI / 2);
      ctx.fillStyle = C.coral;
      U.rr(ctx, -26, -11, 20, 22, 4);
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, -7); ctx.lineTo(3, 0); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
      ctx.restore();

      drawBeam(ctx, beam.pts, ox, oy, cs, t, C.coral);

      for (let i = 0; i < n * n; i++) {
        const px = ox + (i % n) * cs, py = oy + Math.floor(i / n) * cs;
        if (pz.cells[i] === 'T') drawCrystal(ctx, px + cs / 2, py + cs / 2, cs * 0.26, !!beam.lit[i], t);
        else if (pz.cells[i] === 'A') drawAlarm(ctx, px + cs / 2, py + cs / 2, cs * 0.2, !!beam.tripped[i], t);
        if (pz.bolted[i]) drawMirror(ctx, px, py, cs, pz.bolted[i], C.soft, true);
        else if (mirrors[i]) drawMirror(ctx, px, py, cs, mirrors[i], fixed[i] ? C.sun : C.ink, false);
      }
      sparks.draw(ctx);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = api.font(15, 'body');
      const lit = pz.targets.filter(function (i) { return beam.lit[i]; }).length;
      let line = 'Crystals lit: ' + lit + ' of ' + pz.targets.length + '.';
      if (beam.alarms) line += beam.alarms === 1 ? ' One alarm is tripped.' : ' ' + beam.alarms + ' alarms are tripped.';
      else if (level === 1 && !Object.keys(mirrors).length) line += ' Click a square to place a mirror, again to turn it.';
      ctx.fillStyle = noteT <= 0 && beam.alarms ? C.coral : U.alpha(C.ink, 0.85);
      ctx.fillText(noteT > 0 ? note : line, S / 2, 26);
      if (phase === 'won') {
        ctx.fillStyle = U.alpha(C.bg, 0.6);
        ctx.fillRect(0, S / 2 - 40, S, 80);
        ctx.fillStyle = C.sun;
        ctx.font = api.font(34, 'display');
        ctx.fillText('ALL LIT', S / 2, S / 2 + 2);
      }
    }

    api.on(view.canvas, 'pointerdown', function (e) {
      if (!api.playing || phase !== 'play') return;
      e.preventDefault();
      const i = cellAt(view.point(e));
      if (i < 0) return;
      if (e.button === 2) lift(i); else cycle(i);
    });
    api.on(view.canvas, 'contextmenu', function (e) { e.preventDefault(); });
    api.on(view.canvas, 'pointermove', function (e) { hover = cellAt(view.point(e)); });
    api.on(view.canvas, 'pointerleave', function () { hover = -1; });

    api.loop(update, draw);
    hud();

    return {
      start: function () {
        sparks.clear();
        load(Math.max(1, Math.floor(Number(api.load('level', 1)) || 1)));
      },
      peek: function () {
        return {
          level: level, phase: phase, left: left, n: pz.n, k: pz.k, cells: pz.cells, bolted: pz.bolted, targets: pz.targets,
          solution: pz.solution, order: pz.order, ox: ox, oy: oy, cs: cs, lit: Object.keys(beam.lit).length, alarms: beam.alarms, mirrors: mirrors
        };
      }
    };
  }

  A.register({
    id: 'laserlab',
    title: 'Laser Lab',
    tagline: 'Bend one beam through every crystal without tripping an alarm.',
    genre: 'Logic',
    input: 'Mouse',
    color: 'violet',
    bestLabel: 'Furthest level cleared',
    stats: [
      { key: 'solved', label: 'Puzzles solved', kind: 'tally', headline: true },
      { key: 'clean', label: 'Solved without a hint', kind: 'tally' },
      { key: 'hints', label: 'Hints taken', kind: 'tally' },
      { key: 'placed', label: 'Mirrors placed', kind: 'tally' },
      { key: 'fastest', label: 'Fastest solve without a hint', kind: 'low', format: function (v) { return v.toFixed(1) + ' s'; } },
      { key: 'biggest', label: 'Biggest board solved', kind: 'high', format: function (v) { return v + ' by ' + v; } }
    ],
    scoreLabel: 'Cleared',
    formatScore: function (v) { return 'Level ' + v; },
    how: [
      'Click an empty square to place a mirror. Click it again to turn it, and once more to lift it.',
      'Light every crystal. Not every stretch of the beam has one, so the route is yours to work out.',
      'Red alarms must stay dark. Grey mirrors are bolted down: some help, some are there to mislead.',
      'Mirrors are tight, with no spares on the early levels. Hint places one for you, and your level is saved.'
    ],
    logic: { trace: trace, solved: solved, beatable: beatable, attempt: attempt, generate: generate, spec: spec },
    thumb: function (ctx, w, h, t) {
      const cs = 34, ox = 75, oy = 15;
      ctx.fillStyle = C.bg2;
      U.rr(ctx, ox - 4, oy - 4, cs * 5 + 8, cs * 5 + 8, 6);
      ctx.fill();
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 5; i++) {
        ctx.moveTo(ox + i * cs, oy); ctx.lineTo(ox + i * cs, oy + cs * 5);
        ctx.moveTo(ox, oy + i * cs); ctx.lineTo(ox + cs * 5, oy + i * cs);
      }
      ctx.stroke();
      ctx.fillStyle = C.line;
      U.rr(ctx, ox + cs * 3 + 4, oy + 4, cs - 8, cs - 8, 3);
      ctx.fill();
      drawBeam(ctx, [0, 3.5, 1.5, 3.5, 1.5, 1.5, 3.5, 1.5, 3.5, 5], ox, oy, cs, t, C.coral);
      drawMirror(ctx, ox + cs, oy + cs * 3, cs, '/', C.ink, false);
      drawMirror(ctx, ox + cs, oy + cs, cs, '/', C.soft, true);
      drawMirror(ctx, ox + cs * 3, oy + cs, cs, '\\', C.ink, false);
      drawCrystal(ctx, ox + cs * 2.5, oy + cs * 1.5, 9, true, t);
      drawCrystal(ctx, ox + cs * 3.5, oy + cs * 3.5, 9, true, t);
      drawAlarm(ctx, ox + cs * 4.5, oy + cs * 3.5, 7, false, t);
      drawAlarm(ctx, ox + cs * 1.5, oy + cs * 4.5, 7, false, t);
      ctx.fillStyle = C.coral;
      U.rr(ctx, ox - 22, oy + cs * 3.5 - 9, 16, 18, 3);
      ctx.fill();
    },
    create: create
  });
})();
