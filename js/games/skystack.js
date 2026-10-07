/* Sky Stack: drop each slab on the one below. Whatever hangs over the edge is gone for good. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors, TAU = U.TAU;

  const W = 480, H = 640;
  const BH = 30;          // slab height
  const BASE_W = 200;     // width of the first slab
  const FLOOR = 570;      // world y of the ground
  const PERFECT = 5;      // px of forgiveness for a perfect drop
  const MARGIN = 8;
  const RAMP = [C.mint, C.sky, C.violet, C.pink, C.coral, C.sun];

  function tint(n) {
    const i = Math.floor(n / 5) % RAMP.length;
    return U.mix(RAMP[i], RAMP[(i + 1) % RAMP.length], (n % 5) / 5);
  }

  // Lands a slab of width w at x on `top`. Returns what stays (and the piece cut off), or null
  // when it misses completely.
  function land(top, x, w) {
    const off = x - top.x;
    if (Math.abs(off) <= PERFECT) return { x: top.x, w: w, perfect: true, cut: null };
    const left = Math.max(x, top.x), right = Math.min(x + w, top.x + top.w);
    if (right - left <= 0) return null;
    return { x: left, w: right - left, perfect: false, cut: off < 0 ? { x: x, w: left - x } : { x: right, w: x + w - right } };
  }
  function speedAt(n) { return Math.min(520, 170 + n * 8); }

  function slab(ctx, x, y, w, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, BH - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = 'rgba(14,12,34,0.22)';
    ctx.fillRect(x, y + BH - 8, w, 6);
  }

  function create(api) {
    const view = api.canvas(W, H), ctx = view.ctx;
    const pops = api.Floaters(), stars = api.Stars(70, W, H);
    let stack = [], mover = null, debris = [], rings = [];
    let cam = 0, score = 0, combo = 0, bestCombo = 0, phase = 'play', wait = 0;

    function hud() {
      api.stat('Height', score);
      api.stat('Perfect run', combo);
      api.stat('Width', (stack.length ? Math.round(stack[stack.length - 1].w / BASE_W * 100) : 100) + '%');
    }
    function levelY(n) { return FLOOR - (n + 1) * BH; }
    function spawnMover() {
      const top = stack[stack.length - 1], n = stack.length, fromLeft = n % 2 === 1;
      mover = { w: top.w, x: fromLeft ? MARGIN : W - MARGIN - top.w, dir: fromLeft ? 1 : -1, speed: speedAt(n), n: n };
    }
    function reset() {
      stack = [{ x: (W - BASE_W) / 2, w: BASE_W, n: 0 }];
      debris = [];
      rings = [];
      cam = 0;
      score = 0;
      combo = 0;
      bestCombo = 0;
      phase = 'play';
      pops.clear();
      spawnMover();
      hud();
    }

    function drop() {
      if (!api.playing || phase !== 'play') return;
      const top = stack[stack.length - 1], n = mover.n, y = levelY(n);
      const res = land(top, mover.x, mover.w);
      if (!res) {
        debris.push({ x: mover.x, y: y, w: mover.w, vx: mover.dir * 60, vy: 0, rot: 0, vr: mover.dir * 1.6, color: tint(n) });
        mover = null;
        phase = 'fall';
        wait = 1;
        api.tally('towers');
        api.sfx.lose();
        return;
      }
      let x = res.x, w = res.w;
      if (res.perfect) {
        combo++;
        if (combo > bestCombo) bestCombo = combo;
        api.tally('perfects');
        api.high('run', combo);
        if (combo >= 3 && w < BASE_W) { // a run of perfect drops wins some width back
          const grown = Math.min(BASE_W, w + 12);
          x = U.clamp(x - (grown - w) / 2, MARGIN, W - MARGIN - grown);
          w = grown;
        }
        rings.push({ x: x, y: y, w: w, age: 0 });
        pops.add(x + w / 2, y - 16, combo >= 2 ? 'PERFECT x' + combo : 'PERFECT', C.sun, 15);
        api.sfx.note(Math.min(combo + 3, 14), { dur: 0.2 });
      } else {
        combo = 0;
        api.low('sliver', Math.max(1, Math.round(res.w)));
        debris.push({ x: res.cut.x, y: y, w: res.cut.w, vx: (res.cut.x < x ? -1 : 1) * 70, vy: -40, rot: 0, vr: (res.cut.x < x ? -1 : 1) * 2.4, color: tint(n) });
        api.sfx.tone(170, 0.09, { type: 'square', to: 120, vol: 0.1 });
      }
      stack.push({ x: x, w: w, n: n });
      api.tally('slabs');
      score = stack.length - 1;
      spawnMover();
      hud();
    }

    function update(dt) {
      pops.update(dt);
      if (mover && phase === 'play') {
        const lo = MARGIN, hi = W - MARGIN - mover.w;
        mover.x += mover.dir * mover.speed * dt;
        if (mover.x > hi) { mover.x = Math.max(lo, hi - (mover.x - hi)); mover.dir = -1; }
        else if (mover.x < lo) { mover.x = Math.min(hi, lo + (lo - mover.x)); mover.dir = 1; }
      }
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        d.vy += 1500 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.rot += d.vr * dt;
        if (d.y + cam > H + 120) debris.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        rings[i].age += dt;
        if (rings[i].age > 0.45) rings.splice(i, 1);
      }
      cam += (Math.max(0, (stack.length - 9) * BH) - cam) * Math.min(1, 6 * dt);
      if (phase === 'fall') {
        wait -= dt;
        if (wait <= 0) {
          phase = 'over';
          api.gameOver({ title: 'Toppled', score: score, lines: [bestCombo > 1 ? 'Longest run of perfect drops: ' + bestCombo + '.' : 'Line the edges up exactly for a perfect drop.'] });
        }
      }
    }

    function draw(dt, t) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);

      // stars slide down slowly as the tower climbs
      ctx.fillStyle = C.ink;
      for (let i = 0; i < stars.list.length; i++) {
        const s = stars.list[i];
        ctx.globalAlpha = 0.2 + 0.3 * (0.5 + 0.5 * Math.sin(s.p + t * s.s));
        ctx.fillRect(s.x, (s.y + cam * 0.3) % H, s.r, s.r);
      }
      ctx.globalAlpha = 1;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = U.alpha(C.ink, 0.1);
      ctx.font = api.font(150, 'display');
      ctx.fillText(String(score), W / 2, 150);

      // height marks every ten slabs
      ctx.font = api.font(11, 'data');
      ctx.textAlign = 'left';
      for (let k = 10; k <= stack.length + 12; k += 10) {
        const y = FLOOR - k * BH + cam;
        if (y < -10 || y > H + 10) continue;
        ctx.fillStyle = C.line;
        ctx.fillRect(0, y, W, 1);
        ctx.fillStyle = C.soft;
        ctx.fillText(String(k), 8, y - 9);
      }

      ctx.fillStyle = C.bg2;
      ctx.fillRect(0, FLOOR + cam, W, H);
      ctx.fillStyle = C.line;
      ctx.fillRect(0, FLOOR + cam, W, 3);

      for (let i = 0; i < stack.length; i++) {
        const b = stack[i], y = levelY(b.n) + cam;
        if (y > H || y < -BH) continue;
        slab(ctx, b.x, y, b.w, tint(b.n));
      }
      if (mover) slab(ctx, mover.x, levelY(mover.n) + cam, mover.w, tint(mover.n));
      for (let i = 0; i < debris.length; i++) {
        const d = debris[i];
        ctx.save();
        ctx.translate(d.x + d.w / 2, d.y + cam + BH / 2);
        ctx.rotate(d.rot);
        slab(ctx, -d.w / 2, -BH / 2, d.w, d.color);
        ctx.restore();
      }
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i], k = r.age / 0.45, grow = 14 * k;
        ctx.strokeStyle = U.alpha(C.ink, 1 - k);
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x - grow, r.y + cam - grow * 0.4, r.w + grow * 2, BH - 2 + grow * 0.8);
      }
      ctx.save();
      ctx.translate(0, cam);
      pops.draw(ctx);
      ctx.restore();

      if (score === 0 && phase === 'play') {
        ctx.fillStyle = U.alpha(C.ink, 0.85);
        ctx.font = api.font(15, 'body');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(api.touch ? 'Tap to drop the slab' : 'Click or press Space to drop the slab', W / 2, FLOOR + 36);
      }
    }

    api.on(view.canvas, 'pointerdown', function (e) {
      e.preventDefault();
      drop();
    });
    api.onKey(function (e) {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowDown') drop();
    });

    api.loop(update, draw);
    reset();

    return {
      start: reset,
      peek: function () { return { score: score, combo: combo, phase: phase, mover: mover ? { x: mover.x, w: mover.w, dir: mover.dir, speed: mover.speed } : null, top: stack[stack.length - 1], height: stack.length }; }
    };
  }

  A.register({
    id: 'skystack',
    title: 'Sky Stack',
    tagline: 'Drop each slab square on the last and build to the stars.',
    genre: 'Timing',
    input: 'One button',
    color: 'coral',
    bestLabel: 'Tallest tower',
    stats: [
      { key: 'slabs', label: 'Slabs placed', kind: 'tally' },
      { key: 'perfects', label: 'Perfect drops', kind: 'tally' },
      { key: 'run', label: 'Longest perfect run', kind: 'high', headline: true },
      { key: 'sliver', label: 'Thinnest slab landed', kind: 'low', unit: ' px' },
      { key: 'towers', label: 'Towers toppled', kind: 'tally' }
    ],
    scoreLabel: 'Height',
    how: [
      'A slab slides across the top of the tower. Click, tap or press Space to drop it.',
      'Anything hanging over the edge is sliced off, so the next slab is narrower.',
      'Line the edges up exactly for a perfect drop. Three in a row starts winning width back.',
      'Miss the tower completely and it is over.'
    ],
    logic: { land: land, speedAt: speedAt, BASE_W: BASE_W, PERFECT: PERFECT },
    thumb: function (ctx, w, h, t) {
      const xs = [96, 104, 100, 112, 110, 118], ws = [128, 116, 112, 96, 92, 80];
      for (let i = 0; i < xs.length; i++) slab(ctx, xs[i], 168 - i * 26, ws[i], tint(i * 3));
      const mx = 120 + Math.sin(t * 2.2) * 70;
      slab(ctx, mx, 168 - 6 * 26, 80, tint(18));
      ctx.fillStyle = C.line;
      ctx.fillRect(0, 196, w, 2);
    },
    create: create
  });
})();
