/* Lasso: draw a loop around fireflies of one colour. Bigger catches score far more. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors, TAU = U.TAU;

  const W = 900, H = 560;
  const HUES = [C.mint, C.pink, C.sky, C.sun, C.violet];
  const GOLD = '#FFFFFF';
  const START_TIME = 45, MAX_TIME = 60, MAX_ROPE = 2600;

  // Signed area of a closed polygon given as [x0, y0, x1, y1, ...].
  function area(pts) {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i += 2) {
      const j = (i + 2) % n;
      a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
    }
    return a / 2;
  }
  function inside(pts, x, y) {
    let hit = false;
    for (let i = 0, n = pts.length, j = n - 2; i < n; j = i, i += 2) {
      const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }

  // Decides what a finished loop caught. White fireflies count as any colour and double the score.
  function judge(pts, flies) {
    if (pts.length < 16 || Math.abs(area(pts)) < 900) return { kind: 'small', caught: [] };
    const caught = flies.filter(function (f) { return f.age >= 0.4 && inside(pts, f.x, f.y); });
    if (!caught.length) return { kind: 'empty', caught: caught };
    const hues = {};
    let wild = false;
    caught.forEach(function (f) { if (f.wild) wild = true; else hues[f.hue] = true; });
    if (Object.keys(hues).length > 1) return { kind: 'mixed', caught: caught };
    const n = caught.length;
    return { kind: 'catch', caught: caught, points: n * n * 10 * (wild ? 2 : 1), time: n >= 3 ? n * 0.7 : 0 };
  }

  function drawFly(ctx, x, y, color, glow, fade) {
    ctx.globalAlpha = fade * 0.16;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 15 * glow, 0, TAU); ctx.fill();
    ctx.globalAlpha = fade * 0.3;
    ctx.beginPath(); ctx.arc(x, y, 8.5 * glow, 0, TAU); ctx.fill();
    ctx.globalAlpha = fade;
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function create(api) {
    const view = api.canvas(W, H), ctx = view.ctx;
    const sparks = api.Particles(), pops = api.Floaters(), stars = api.Stars(60, W, H);
    let flies = [], path = null, pid = -1, rope = 0, echo = null;
    let time = START_TIME, score = 0, caughtTotal = 0, bestCatch = 0, spawnT = 0, shake = 0, phase = 'play';

    function hud() {
      api.stat('Time', Math.ceil(time) + 's');
      api.stat('Score', score);
      api.stat('Best catch', bestCatch);
      api.stat('Caught', caughtTotal);
    }
    function hueCount() { return score >= 1200 ? 5 : score >= 300 ? 4 : 3; }
    function wanted() { return 14 + Math.min(8, Math.floor(caughtTotal / 8)); }
    function spawn(aged) {
      const n = hueCount(), counts = [];
      for (let i = 0; i < n; i++) counts.push(0);
      let hasWild = false;
      flies.forEach(function (f) { if (f.wild) hasWild = true; else if (f.hue < n) counts[f.hue]++; });
      // usually top up whichever colour is rarest, so a group is always possible
      let hue = U.randInt(0, n - 1);
      if (Math.random() < 0.7) {
        let low = Infinity;
        counts.forEach(function (c, i) { if (c < low) { low = c; hue = i; } });
      }
      const base = 24 + Math.min(46, score / 60);
      flies.push({
        x: U.rand(40, W - 40), y: U.rand(50, H - 40), a: U.rand(TAU), turn: 0,
        sp: base * U.rand(0.7, 1.3), hue: hue, wild: !hasWild && Math.random() < 0.06,
        age: aged ? 1 : 0, boost: 0, ph: U.rand(TAU), dead: false
      });
    }
    function reset() {
      flies = [];
      path = null;
      echo = null;
      time = START_TIME;
      score = 0;
      caughtTotal = 0;
      bestCatch = 0;
      spawnT = 0;
      shake = 0;
      phase = 'play';
      sparks.clear();
      pops.clear();
      for (let i = 0; i < 14; i++) spawn(true);
      hud();
    }

    function close() {
      const pts = path;
      path = null;
      if (!pts || !api.playing || phase !== 'play') return;
      api.tally('rope', Math.round(rope));
      const res = judge(pts, flies);
      if (res.kind === 'small') return;
      echo = { pts: pts, age: 0, kind: res.kind };
      if (res.kind === 'empty') { api.sfx.tone(240, 0.08, { type: 'triangle', vol: 0.08 }); return; }
      let cx = 0, cy = 0;
      res.caught.forEach(function (f) { cx += f.x; cy += f.y; });
      cx /= res.caught.length;
      cy /= res.caught.length;
      if (res.kind === 'mixed') {
        time = Math.max(0, time - 3);
        shake = 10;
        api.tally('mixed');
        res.caught.forEach(function (f) { f.boost = 1; f.a = Math.atan2(f.y - cy, f.x - cx); });
        pops.add(cx, cy, 'MIXED  -3s', C.coral, 17);
        api.sfx.bad();
        hud();
        return;
      }
      const n = res.caught.length;
      score += res.points;
      time = Math.min(MAX_TIME, time + res.time);
      caughtTotal += n;
      if (n > bestCatch) bestCatch = n;
      api.tally('caught', n);
      api.tally('clean');
      api.high('biggest', n);
      const wilds = res.caught.filter(function (f) { return f.wild; }).length;
      if (wilds) api.tally('wild', wilds);
      res.caught.forEach(function (f, i) {
        f.dead = true;
        sparks.burst(f.x, f.y, { count: 12, color: f.wild ? GOLD : HUES[f.hue], speed: 150 });
        if (i < 6) api.sfx.tone(392 * Math.pow(2, [0, 4, 7, 12, 16, 19][i] / 12), 0.2, { type: 'triangle', delay: 0.001 + i * 0.05, vol: 0.15 });
      });
      flies = flies.filter(function (f) { return !f.dead; });
      pops.add(cx, cy, '+' + res.points + (res.time ? '  +' + res.time.toFixed(1) + 's' : ''), C.ink, n >= 4 ? 22 : 17);
      hud();
    }

    function update(dt) {
      sparks.update(dt);
      pops.update(dt);
      shake = Math.max(0, shake - 30 * dt);
      if (echo) { echo.age += dt; if (echo.age > 0.5) echo = null; }
      if (phase !== 'play') return;

      time -= dt;
      if (time <= 0) {
        time = 0;
        phase = 'over';
        path = null;
        hud();
        api.gameOver({ title: 'Dawn', score: score, lines: [caughtTotal + ' fireflies caught.', bestCatch > 1 ? 'Biggest single loop: ' + bestCatch + '.' : 'Loop two or more of one colour for a real score.'] });
        return;
      }
      for (let i = 0; i < flies.length; i++) {
        const f = flies[i];
        f.age += dt;
        f.boost = Math.max(0, f.boost - dt);
        f.turn = (f.turn + U.rand(-5, 5) * dt) * 0.985;
        f.a += f.turn * dt * 2;
        const sp = f.sp * (1 + 3 * f.boost);
        f.x += Math.cos(f.a) * sp * dt;
        f.y += Math.sin(f.a) * sp * dt;
        if (f.x < 20) { f.x = 20; f.a = Math.PI - f.a; } else if (f.x > W - 20) { f.x = W - 20; f.a = Math.PI - f.a; }
        if (f.y < 26) { f.y = 26; f.a = -f.a; } else if (f.y > H - 20) { f.y = H - 20; f.a = -f.a; }
      }
      spawnT -= dt;
      if (flies.length < wanted() && spawnT <= 0) { spawn(false); spawnT = 0.3; }
      hud();
    }

    function draw(dt, t) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      if (shake > 0) ctx.translate(U.rand(-shake, shake) * 0.5, U.rand(-shake, shake) * 0.5);
      stars.draw(ctx, t, 0.6);

      if (echo) {
        const k = 1 - echo.age / 0.5;
        const col = echo.kind === 'catch' ? C.mint : echo.kind === 'mixed' ? C.coral : C.soft;
        ctx.beginPath();
        ctx.moveTo(echo.pts[0], echo.pts[1]);
        for (let i = 2; i < echo.pts.length; i += 2) ctx.lineTo(echo.pts[i], echo.pts[i + 1]);
        ctx.closePath();
        ctx.fillStyle = U.alpha(col, 0.22 * k);
        ctx.fill();
        ctx.strokeStyle = U.alpha(col, 0.9 * k);
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      for (let i = 0; i < flies.length; i++) {
        const f = flies[i];
        drawFly(ctx, f.x, f.y, f.wild ? GOLD : HUES[f.hue], 0.85 + 0.25 * Math.sin(t * 4 + f.ph), Math.min(1, f.age / 0.4));
      }

      if (path && path.length >= 4) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = U.alpha(C.ink, 0.25);
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(path[0], path[1]);
        for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
        ctx.stroke();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // how the loop will close if you let go now
        ctx.setLineDash([4, 8]);
        ctx.strokeStyle = U.alpha(C.ink, 0.5);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(path[path.length - 2], path[path.length - 1]);
        ctx.lineTo(path[0], path[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'butt';
      }
      sparks.draw(ctx);
      pops.draw(ctx);
      ctx.restore();

      // the night is a bar that burns down
      ctx.fillStyle = C.bg2;
      ctx.fillRect(0, 0, W, 8);
      ctx.fillStyle = time < 10 ? C.coral : C.mint;
      ctx.fillRect(0, 0, W * U.clamp(time / MAX_TIME, 0, 1), 8);

      if (caughtTotal === 0 && phase === 'play' && !path) {
        ctx.fillStyle = U.alpha(C.ink, 0.85);
        ctx.font = api.font(15, 'body');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Draw a loop around fireflies of one colour, then let go.', W / 2, H - 16);
      }
    }

    api.on(view.canvas, 'pointerdown', function (e) {
      if (!api.playing || phase !== 'play') return;
      e.preventDefault();
      const p = view.point(e);
      path = [p.x, p.y];
      rope = 0;
      pid = e.pointerId;
      try { view.canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
    });
    api.on(view.canvas, 'pointermove', function (e) {
      if (!path || e.pointerId !== pid) return;
      const p = view.point(e);
      const x = U.clamp(p.x, 0, W), y = U.clamp(p.y, 0, H);
      const d = Math.hypot(x - path[path.length - 2], y - path[path.length - 1]);
      if (d < 5) return;
      path.push(x, y);
      rope += d;
      if (rope > MAX_ROPE) close(); // the rope only reaches so far
    });
    api.on(view.canvas, 'pointerup', function (e) { if (path && e.pointerId === pid) close(); });
    api.on(view.canvas, 'pointercancel', function (e) { if (e.pointerId === pid) path = null; });

    api.loop(update, draw);
    reset();

    return {
      start: reset,
      peek: function () { return { time: time, score: score, phase: phase, flies: flies, caught: caughtTotal, best: bestCatch }; }
    };
  }

  A.register({
    id: 'lasso',
    title: 'Lasso',
    tagline: 'Rope in fireflies of one colour with a single loop.',
    genre: 'Drawing',
    input: 'Mouse or touch',
    color: 'sky',
    stats: [
      { key: 'caught', label: 'Fireflies caught', kind: 'tally' },
      { key: 'biggest', label: 'Biggest loop', kind: 'high', unit: ' fireflies', headline: true },
      { key: 'clean', label: 'Clean loops', kind: 'tally' },
      { key: 'mixed', label: 'Mixed loops', kind: 'tally' },
      { key: 'wild', label: 'White fireflies caught', kind: 'tally' },
      { key: 'rope', label: 'Rope thrown', kind: 'tally', format: function (v) { return Math.round(v / 100).toLocaleString('en-US') + ' m'; } }
    ],
    how: [
      'Hold and draw a loop around fireflies, then let go.',
      'A loop holding one colour catches them. Bigger groups score far more and add time.',
      'A loop holding mixed colours costs three seconds.',
      'White fireflies match any colour and double the catch.'
    ],
    logic: { area: area, inside: inside, judge: judge },
    thumb: function (ctx, w, h, t) {
      const inLoop = [[132, 86], [168, 70], [186, 108], [150, 118]];
      const out = [[52, 52, C.pink], [262, 60, C.sky], [70, 150, C.sun], [270, 144, C.pink], [232, 176, C.sky], [36, 104, C.violet]];
      const draw = Math.min(1, (t * 0.5 + 0.5) % 1.4);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 40 * draw; i++) {
        const a = -2.2 + (i / 40) * TAU * 1.02, r = 52 + Math.sin(a * 3) * 5;
        const x = 160 + Math.cos(a) * r * 1.15, y = 95 + Math.sin(a) * r * 0.82;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
      if (draw >= 1) {
        ctx.fillStyle = U.alpha(C.mint, 0.16);
        ctx.fill();
      }
      inLoop.forEach(function (p, i) { drawFly(ctx, p[0], p[1], C.mint, 0.85 + 0.25 * Math.sin(t * 4 + i), 1); });
      out.forEach(function (p, i) { drawFly(ctx, p[0] + Math.sin(t + i) * 4, p[1] + Math.cos(t * 0.8 + i) * 4, p[2], 0.85 + 0.25 * Math.sin(t * 3 + i * 2), 1); });
    },
    create: create
  });
})();
