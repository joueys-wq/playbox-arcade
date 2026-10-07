/* Constellation: the sky draws a pattern one star at a time. Trace it back from memory. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors, TAU = U.TAU;

  const W = 800, H = 520;
  const REACH = 40;       // how close a click must land to count as a star
  const MAX_STARS = 9;
  const TINTS = [C.sun, C.sky, C.pink, C.mint, C.violet, C.coral, C.ink, C.sun, C.sky];

  function stepTime(round) { return Math.max(0.3, 0.62 - 0.025 * round); }

  // Adds one more star to the pattern, never the same star twice running.
  function extend(seq, starCount, rnd) {
    let s;
    do { s = Math.floor(rnd() * starCount); } while (seq.length && s === seq[seq.length - 1]);
    seq.push(s);
    return seq;
  }

  // Finds room for a new star, well clear of the others. The spacing relaxes if the sky is crowded.
  function placeStar(stars, rnd) {
    let gap = 125;
    for (let tries = 0; tries < 400; tries++) {
      const x = 70 + rnd() * (W - 140), y = 80 + rnd() * (H - 170);
      let ok = true;
      for (let i = 0; i < stars.length && ok; i++) ok = Math.hypot(stars[i].x - x, stars[i].y - y) >= gap;
      if (ok) return { x: x, y: y };
      if (tries % 40 === 39) gap *= 0.9;
    }
    return { x: 70 + rnd() * (W - 140), y: 80 + rnd() * (H - 170) };
  }

  function drawStar(ctx, x, y, r, color, spin) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = spin + k * TAU / 8, rr = k % 2 ? r * 0.36 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function create(api) {
    const view = api.canvas(W, H), ctx = view.ctx;
    const dust = api.Stars(110, W, H), sparks = api.Particles();
    let stars = [], seq = [], round = 1, lives = 3, score = 0, longest = 0;
    let phase = 'show', showT = 0, shown = -1, inputI = 0, wait = 0, then = null, note = '', hover = -1, shake = 0;
    let cleanRun = 0;
    const hearts = api.lives('Lives');

    function hud() {
      api.stat('Round', round);
      api.stat('Pattern', seq.length + ' stars');
      hearts.set(lives, 3);
      api.stat('Score', score);
    }
    function addStar() {
      const p = placeStar(stars, Math.random);
      stars.push({ x: p.x, y: p.y, pulse: 0, wrong: 0, born: 0, ph: U.rand(TAU) });
    }
    function startShow(text) {
      phase = 'show';
      showT = -0.8;
      shown = -1;
      inputI = 0;
      note = text || 'Watch the sky';
    }
    function pause(seconds, text, next) {
      phase = 'pause';
      wait = seconds;
      note = text;
      then = next;
    }
    function reset() {
      stars = [];
      seq = [];
      round = 1;
      lives = 3;
      score = 0;
      longest = 0;
      shake = 0;
      cleanRun = 0;
      sparks.clear();
      for (let i = 0; i < 5; i++) addStar();
      stars.forEach(function (s) { s.born = 1; });
      for (let i = 0; i < 3; i++) extend(seq, stars.length, Math.random);
      startShow();
      hud();
    }
    function nextRound() {
      round++;
      if ((round - 1) % 3 === 0 && stars.length < MAX_STARS) addStar();
      extend(seq, stars.length, Math.random);
      startShow();
      hud();
    }
    function light(i) {
      stars[i].pulse = 1;
      api.sfx.note(i + 2, { dur: 0.32 });
    }
    function starAt(p) {
      let best = -1, bd = REACH;
      for (let i = 0; i < stars.length; i++) {
        const d = Math.hypot(stars[i].x - p.x, stars[i].y - p.y);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    function pick(i) {
      if (i === seq[inputI]) {
        light(i);
        inputI++;
        api.tally('traced');
        if (inputI < seq.length) return;
        score += seq.length * 10;
        longest = Math.max(longest, seq.length);
        api.tally('rounds');
        api.high('longest', seq.length);
        cleanRun++;
        api.high('flawless', cleanRun);
        seq.forEach(function (s) { sparks.burst(stars[s].x, stars[s].y, { count: 8, color: TINTS[s], speed: 110 }); });
        api.sfx.good();
        hud();
        pause(1, 'That is it', nextRound);
        return;
      }
      lives--;
      cleanRun = 0;
      api.tally('slips');
      shake = 10;
      stars[i].wrong = 0.5;
      stars[seq[inputI]].pulse = 1; // show which one it should have been
      api.sfx.bad();
      hud();
      if (lives > 0) {
        pause(1.1, 'Not that one. Watch again.', function () { startShow('Watch again'); });
      } else {
        pause(1.1, 'The pattern slips away', function () {
          phase = 'over';
          api.gameOver({
            title: 'Lost in the stars', score: score,
            lines: [longest ? 'Longest pattern you traced: ' + longest + ' stars.' : 'The first pattern is three stars long. Take it slowly.']
          });
        });
      }
    }

    function update(dt) {
      sparks.update(dt);
      shake = Math.max(0, shake - 30 * dt);
      hearts.update(dt);
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.pulse = Math.max(0, s.pulse - dt * 2.2);
        s.wrong = Math.max(0, s.wrong - dt);
        s.born = Math.min(1, s.born + dt * 1.5);
      }
      if (phase === 'show') {
        const step = stepTime(round);
        showT += dt;
        const idx = Math.floor(showT / step);
        if (showT >= 0 && idx > shown && idx < seq.length) {
          shown = idx;
          light(seq[idx]);
        }
        if (showT >= seq.length * step + 0.2) {
          phase = 'input';
          inputI = 0;
          note = 'Your turn';
        }
      } else if (phase === 'pause') {
        wait -= dt;
        if (wait <= 0) {
          const next = then;
          then = null;
          if (next) next();
        }
      }
    }

    function draw(dt, t) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      if (shake > 0) ctx.translate(U.rand(-shake, shake) * 0.5, U.rand(-shake, shake) * 0.5);
      dust.draw(ctx, t);

      // the lines traced so far
      const upto = phase === 'show' ? shown + 1 : phase === 'input' ? inputI : phase === 'pause' && inputI >= seq.length ? seq.length : inputI;
      if (upto >= 2) {
        ctx.strokeStyle = U.alpha(C.ink, 0.55);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(stars[seq[0]].x, stars[seq[0]].y);
        for (let i = 1; i < upto; i++) ctx.lineTo(stars[seq[i]].x, stars[seq[i]].y);
        ctx.stroke();
      }

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i], col = s.wrong > 0 ? C.coral : TINTS[i];
        const idle = 1 + 0.08 * Math.sin(t * 2 + s.ph);
        const r = (13 + 13 * s.pulse) * idle * s.born;
        ctx.fillStyle = U.alpha(col, 0.16 + 0.3 * s.pulse);
        ctx.beginPath(); ctx.arc(s.x, s.y, r * 2.1, 0, TAU); ctx.fill();
        if (i === hover && phase === 'input') {
          ctx.strokeStyle = U.alpha(C.ink, 0.6);
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(s.x, s.y, 30, 0, TAU); ctx.stroke();
        }
        drawStar(ctx, s.x, s.y, r, s.pulse > 0.05 || s.wrong > 0 ? col : U.mix(col, C.bg, 0.18), t * 0.15 + s.ph);
      }
      sparks.draw(ctx);
      ctx.restore();
      hearts.draw(ctx, 18, 34, 22);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = phase === 'input' ? C.sun : U.alpha(C.ink, 0.85);
      ctx.font = api.font(20, 'display');
      ctx.fillText(note.toUpperCase(), W / 2, 34);

      // one pip per star in the pattern
      const n = seq.length, gap = Math.min(22, (W - 120) / n), x0 = W / 2 - (n - 1) * gap / 2;
      const filled = phase === 'show' ? shown + 1 : inputI;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i < filled ? (phase === 'show' ? C.ink : C.sun) : C.line;
        ctx.beginPath(); ctx.arc(x0 + i * gap, H - 26, 5, 0, TAU); ctx.fill();
      }
    }

    api.on(view.canvas, 'pointermove', function (e) { hover = starAt(view.point(e)); });
    api.on(view.canvas, 'pointerleave', function () { hover = -1; });
    api.on(view.canvas, 'pointerdown', function (e) {
      if (!api.playing || phase !== 'input') return;
      e.preventDefault();
      const i = starAt(view.point(e));
      if (i >= 0) pick(i);
    });

    api.loop(update, draw);
    reset();

    return {
      start: reset,
      peek: function () { return { phase: phase, seq: seq.slice(), inputI: inputI, round: round, lives: lives, score: score, stars: stars.map(function (s) { return { x: s.x, y: s.y }; }) }; }
    };
  }

  A.register({
    id: 'constellation',
    title: 'Constellation',
    tagline: 'Watch the stars light up in order, then trace them back.',
    genre: 'Memory',
    input: 'Mouse or touch',
    color: 'mint',
    stats: [
      { key: 'rounds', label: 'Rounds cleared', kind: 'tally' },
      { key: 'longest', label: 'Longest pattern traced', kind: 'high', unit: ' stars', headline: true },
      { key: 'traced', label: 'Stars traced', kind: 'tally' },
      { key: 'slips', label: 'Wrong stars', kind: 'tally' },
      { key: 'flawless', label: 'Best run without a slip', kind: 'high', unit: ' rounds' }
    ],
    how: [
      'The sky lights a pattern of stars, one at a time. Each star has its own note.',
      'When it is your turn, click the same stars in the same order.',
      'Every round adds one star to the pattern, and the sky slowly fills up.',
      'Each wrong star costs a heart. Lose all three and the night ends.'
    ],
    logic: { extend: extend, placeStar: placeStar, stepTime: stepTime },
    thumb: function (ctx, w, h, t) {
      const pts = [[58, 150], [112, 78], [176, 122], [228, 52], [272, 132]];
      const lit = Math.floor((t * 1.6) % (pts.length + 2));
      ctx.strokeStyle = U.alpha(C.ink, 0.55);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < Math.min(pts.length, lit + 1); i++) {
        if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]); else ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();
      ctx.fillStyle = C.ink;
      [[30, 30], [90, 20], [150, 40], [200, 170], [290, 30], [250, 180], [40, 90], [140, 176], [300, 90]].forEach(function (p, i) {
        ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 2 + i);
        ctx.fillRect(p[0], p[1], 2, 2);
      });
      ctx.globalAlpha = 1;
      pts.forEach(function (p, i) {
        const on = i === Math.min(lit, pts.length - 1), col = TINTS[i];
        ctx.fillStyle = U.alpha(col, on ? 0.4 : 0.14);
        ctx.beginPath(); ctx.arc(p[0], p[1], on ? 26 : 18, 0, TAU); ctx.fill();
        drawStar(ctx, p[0], p[1], on ? 15 : 10, i <= lit ? col : U.mix(col, C.bg, 0.4), t * 0.2 + i);
      });
    },
    create: create
  });
})();
