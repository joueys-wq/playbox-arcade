/* Supernova: one click, then the chain reaction does the rest. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors, TAU = U.TAU;

  const W = 900, H = 560;
  const DOT = 6, BLAST = 68;
  const GROW = 0.3, HOLD = 2, FADE = 0.35, LIFE = GROW + HOLD + FADE;
  const CHARGES = 5;
  // [dots on screen, dots you must catch]. Tuned by simulation: a patient click clears level 2
  // about 85% of the time, sliding down to about 40% on the last few.
  const LEVELS = [[5, 1], [10, 2], [15, 3], [20, 5], [25, 7], [30, 10], [35, 14], [40, 20], [45, 27], [50, 34], [55, 41], [60, 49]];

  // A blast swells, holds, then collapses.
  function blastRadius(age) {
    if (age < GROW) return BLAST * (1 - Math.pow(1 - age / GROW, 3));
    if (age < GROW + HOLD) return BLAST;
    return BLAST * Math.max(0, 1 - (age - GROW - HOLD) / FADE);
  }

  function drawBlast(ctx, x, y, r, color, strength) {
    if (r <= 0) return;
    ctx.fillStyle = U.alpha(color, 0.4 * strength);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = U.alpha(color, 0.9 * strength);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  }
  function drawDot(ctx, x, y, color) {
    ctx.fillStyle = U.alpha(color, 0.22);
    ctx.beginPath(); ctx.arc(x, y, DOT * 2.3, 0, TAU); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, DOT, 0, TAU); ctx.fill();
  }

  function create(api) {
    const view = api.canvas(W, H), ctx = view.ctx;
    const pops = api.Floaters(), stars = api.Stars(70, W, H);
    let level = 0, dots = [], blasts = [], phase = 'ready';
    let caught = 0, levelPts = 0, score = 0, charges = CHARGES;
    let wait = 0, passed = false, note = '', cursor = null;
    let deepest = 0;
    const hearts = api.lives('Lives');

    function hud() {
      api.stat('Level', (level + 1) + '/' + LEVELS.length);
      api.stat('Caught', caught + '/' + LEVELS[level][1]);
      hearts.set(charges, CHARGES);
      api.stat('Score', score);
    }
    function setup(n) {
      level = n;
      dots = [];
      blasts = [];
      caught = 0;
      levelPts = 0;
      deepest = 0;
      phase = 'ready';
      for (let i = 0; i < LEVELS[n][0]; i++) {
        const a = U.rand(TAU), sp = U.rand(55, 105);
        dots.push({ x: U.rand(20, W - 20), y: U.rand(20, H - 20), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, color: A.palette[i % A.palette.length] });
      }
      hud();
    }
    function catchDot(i, by) {
      const d = dots[i], depth = by.depth + 1, pts = 50 * Math.min(depth, 10);
      dots.splice(i, 1);
      caught++;
      api.tally('dots');
      if (depth > deepest) deepest = depth;
      levelPts += pts;
      pops.add(d.x, d.y - 14, '+' + pts, d.color, 13);
      blasts.push({ x: d.x, y: d.y, age: 0, color: d.color, depth: depth });
      api.sfx.note(Math.min(depth + 1, 14), { dur: 0.26, vol: 0.14 });
      hud();
    }
    function finish() {
      const total = LEVELS[level][0], need = LEVELS[level][1];
      passed = caught >= need;
      api.high('chain', caught);
      api.high('depth', deepest);
      if (passed) {
        api.high('level', level + 1);
        if (caught === total) api.tally('perfect');
        score += levelPts + (caught - need) * 100 + (caught === total ? 1000 : 0);
        if (charges < CHARGES) charges++; // a cleared level wins a heart back
        note = caught === total ? 'Every last one' : 'Chain complete';
        api.sfx.win();
        api.submitScore(score);
      } else {
        charges--;
        note = 'Caught ' + caught + ', needed ' + need;
        api.sfx.bad();
      }
      phase = 'result';
      wait = 1.7;
      hud();
    }
    function next() {
      if (passed && level + 1 < LEVELS.length) { setup(level + 1); return; }
      if (!passed && charges > 0) { setup(level); return; }
      phase = 'done';
      if (passed) {
        score += charges * 500;
        api.tally('clears');
        hud();
        api.gameOver({ title: 'Supernova', score: score, lines: ['All twelve levels cleared with ' + charges + (charges === 1 ? ' heart' : ' hearts') + ' to spare.'] });
      } else {
        api.gameOver({ title: 'Out of hearts', score: score, lines: ['You reached level ' + (level + 1) + ' of ' + LEVELS.length + '.'] });
      }
    }

    function update(dt) {
      pops.update(dt);
      hearts.update(dt);
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.x < DOT) { d.x = DOT; d.vx = Math.abs(d.vx); } else if (d.x > W - DOT) { d.x = W - DOT; d.vx = -Math.abs(d.vx); }
        if (d.y < DOT) { d.y = DOT; d.vy = Math.abs(d.vy); } else if (d.y > H - DOT) { d.y = H - DOT; d.vy = -Math.abs(d.vy); }
      }
      for (let i = blasts.length - 1; i >= 0; i--) {
        blasts[i].age += dt;
        if (blasts[i].age >= LIFE) blasts.splice(i, 1);
      }
      if (phase === 'chain') {
        for (let i = dots.length - 1; i >= 0; i--) {
          const d = dots[i];
          for (let j = 0; j < blasts.length; j++) {
            const b = blasts[j], r = blastRadius(b.age) + DOT, dx = d.x - b.x, dy = d.y - b.y;
            if (dx * dx + dy * dy < r * r) { catchDot(i, b); break; }
          }
        }
        if (!blasts.length) finish();
      } else if (phase === 'result') {
        wait -= dt;
        if (wait <= 0) next();
      }
    }

    function draw(dt, t) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      stars.draw(ctx, t, 0.7);

      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < blasts.length; i++) {
        const b = blasts[i];
        drawBlast(ctx, b.x, b.y, blastRadius(b.age), b.color, b.age > GROW + HOLD ? 0.6 : 1);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < dots.length; i++) drawDot(ctx, dots[i].x, dots[i].y, dots[i].color);
      pops.draw(ctx);
      hearts.draw(ctx, 16, 26, 20);

      ctx.textAlign = 'center';
      if (phase === 'ready') {
        if (cursor) {
          ctx.strokeStyle = U.alpha(C.ink, 0.5);
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 6]);
          ctx.lineDashOffset = -t * 14;
          ctx.beginPath(); ctx.arc(cursor.x, cursor.y, BLAST, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.textBaseline = 'top';
        ctx.fillStyle = U.alpha(C.ink, 0.8);
        ctx.font = api.font(15, 'body');
        ctx.fillText('Catch ' + LEVELS[level][1] + ' of ' + LEVELS[level][0] + '. You get one click.', W / 2, 16);
      } else if (phase === 'result') {
        ctx.textBaseline = 'middle';
        ctx.fillStyle = passed ? C.mint : C.coral;
        ctx.font = api.font(40, 'display');
        ctx.fillText(note.toUpperCase(), W / 2, H / 2 - 8);
        ctx.fillStyle = U.alpha(C.ink, 0.8);
        ctx.font = api.font(15, 'body');
        const tail = passed ? (level + 1 < LEVELS.length ? 'Next level coming up.' : 'That was the last one.') : (charges > 0 ? 'Same level again.' : '');
        ctx.fillText(tail, W / 2, H / 2 + 30);
      }
    }

    api.on(view.canvas, 'pointermove', function (e) { cursor = view.point(e); });
    api.on(view.canvas, 'pointerleave', function () { cursor = null; });
    api.on(view.canvas, 'pointerdown', function (e) {
      if (!api.playing) return;
      e.preventDefault();
      const p = view.point(e);
      cursor = p;
      if (phase !== 'ready') return;
      phase = 'chain';
      api.tally('blasts');
      blasts.push({ x: p.x, y: p.y, age: 0, color: C.ink, depth: 0 });
      api.sfx.tone(150, 0.32, { to: 55, vol: 0.2 });
    });

    api.loop(update, draw);
    setup(0);

    return {
      start: function () {
        score = 0;
        charges = CHARGES;
        pops.clear();
        setup(0);
      },
      peek: function () { return { level: level, phase: phase, caught: caught, need: LEVELS[level][1], dots: dots, blasts: blasts.length, charges: charges, score: score }; }
    };
  }

  A.register({
    id: 'supernova',
    title: 'Supernova',
    tagline: 'One click sets it off. The chain reaction does the rest.',
    genre: 'Chain reaction',
    input: 'One click',
    color: 'coral',
    stats: [
      { key: 'blasts', label: 'Blasts set off', kind: 'tally' },
      { key: 'dots', label: 'Dots caught', kind: 'tally' },
      { key: 'chain', label: 'Biggest chain', kind: 'high', unit: ' dots', headline: true },
      { key: 'depth', label: 'Deepest link in a chain', kind: 'high' },
      { key: 'perfect', label: 'Perfect levels', kind: 'tally' },
      { key: 'level', label: 'Furthest level cleared', kind: 'high' },
      { key: 'clears', label: 'Full clears', kind: 'tally' }
    ],
    how: [
      'Click once to set off a blast.',
      'Any dot that drifts into a blast explodes too, and so on down the chain.',
      'Catch the number shown to clear the level. Wait for the dots to bunch up before you click.',
      'A miss costs one of your five hearts. Clearing a level wins one back.',
      'Deeper links in the chain are worth more, and catching every dot pays a bonus.'
    ],
    thumb: function (ctx, w, h, t) {
      const blastsAt = [[150, 108, 0], [204, 82, 0.35], [118, 148, 0.55], [236, 138, 0.85]];
      const loose = [[60, 120, C.sky], [270, 62, C.sun], [92, 58, C.pink], [176, 168, C.mint], [282, 160, C.violet], [40, 40, C.coral]];
      const cols = [C.ink, C.sun, C.mint, C.pink];
      const cyc = t % 3.2;
      ctx.globalCompositeOperation = 'lighter';
      blastsAt.forEach(function (b, i) {
        const age = cyc - b[2];
        if (age <= 0) return;
        const r = 36 * Math.min(1, age / 0.3) * (age > 2.2 ? Math.max(0, 1 - (age - 2.2) / 0.4) : 1);
        drawBlast(ctx, b[0], b[1], r, cols[i], 1);
      });
      ctx.globalCompositeOperation = 'source-over';
      blastsAt.forEach(function (b, i) { if (i > 0 && cyc - b[2] <= 0) drawDot(ctx, b[0], b[1], cols[i]); });
      loose.forEach(function (d, i) { drawDot(ctx, d[0] + Math.sin(t * 0.8 + i) * 6, d[1] + Math.cos(t * 0.7 + i * 2) * 6, d[2]); });
    },
    create: create
  });
})();
