/* Slingshot: fling a probe through planetary gravity and into the gate. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors, TAU = U.TAU;

  const W = 900, H = 560;
  const STEP = 1 / 120;   // fixed physics step, so the same shot always flies the same way
  const PROBE = 5;        // probe radius
  const MAX_PULL = 150;   // longest useful drag, px
  const POWER = 2.8;      // launch speed per px of pull
  const MAX_FLIGHT = 11;  // seconds before a wandering probe is called lost
  const EDGE = 220;       // how far off screen a probe may stray and still come back
  const DENSITY = 1100;   // mass per r squared
  const DEG = Math.PI / 180;

  // start [x, y] / gate [x, y, r] / bodies [x, y, r, colour, mass scale]
  // walls [x1, y1, x2, y2, count, r]: a row of light asteroids
  // Ordered by how many launches reach the gate, checked by brute force: about 2% on the first
  // system down to about 0.4% on the last.
  const RAW = [
    { name: 'First light', start: [140, 300], gate: [730, 240, 30], bodies: [[450, 440, 44, 'sun']] },
    { name: 'Low orbit', start: [110, 480], gate: [450, 165, 22], bodies: [[450, 300, 74, 'sky', 1.2]] },
    { name: 'Eclipse', start: [120, 290], gate: [705, 290, 22], bodies: [[540, 290, 52, 'violet']] },
    { name: 'Over the top', start: [110, 430], gate: [790, 430, 24], bodies: [[450, 390, 54, 'coral']] },
    { name: 'The gap', start: [110, 130], gate: [800, 440, 22], bodies: [[400, 190, 46, 'sky'], [560, 410, 46, 'pink']] },
    { name: 'S-bend', start: [90, 470], gate: [820, 400, 22], bodies: [[330, 330, 54, 'pink'], [600, 230, 54, 'mint']] },
    { name: 'Binary', start: [100, 280], gate: [810, 280, 22], bodies: [[420, 190, 42, 'sun'], [420, 370, 42, 'coral'], [640, 280, 30, 'violet']] },
    { name: 'Rubble', start: [100, 470], gate: [790, 195, 26], bodies: [[300, 330, 20, 'soft', 0.6], [420, 200, 24, 'soft', 0.6], [520, 380, 18, 'soft', 0.6], [600, 240, 22, 'soft', 0.6], [690, 150, 16, 'soft', 0.6], [240, 180, 18, 'soft', 0.6], [640, 420, 34, 'pink']] },
    { name: 'U-turn', start: [250, 120], gate: [330, 375, 26], bodies: [[560, 280, 60, 'mint', 1.6]], walls: [[-200, 280, 400, 280, 16, 15]] },
    { name: 'Grand tour', start: [100, 100], gate: [800, 110, 24], bodies: [[360, 250, 46, 'sun'], [640, 330, 46, 'violet']], walls: [[500, -100, 500, 200, 8, 15]] }
  ];

  function build(l) {
    const bodies = l.bodies.map(function (b) {
      return { x: b[0], y: b[1], r: b[2], color: b[3] || 'violet', m: b[2] * b[2] * DENSITY * (b[4] === undefined ? 1 : b[4]) };
    });
    (l.walls || []).forEach(function (w) {
      for (let i = 0; i < w[4]; i++) {
        const t = w[4] === 1 ? 0 : i / (w[4] - 1);
        bodies.push({ x: U.lerp(w[0], w[2], t), y: U.lerp(w[1], w[3], t), r: w[5], color: 'soft', m: w[5] * w[5] * DENSITY * 0.2 });
      }
    });
    return { name: l.name, start: { x: l.start[0], y: l.start[1] }, gate: { x: l.gate[0], y: l.gate[1], r: l.gate[2] }, bodies: bodies };
  }
  const LEVELS = RAW.map(build);

  // Advances the probe one step. Returns 'fly', 'gate', 'crash' or 'lost'.
  function step(p, lv) {
    let ax = 0, ay = 0;
    const bodies = lv.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], dx = b.x - p.x, dy = b.y - p.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
      if (d < b.r + PROBE) return 'crash';
      const f = b.m / (d2 * d);
      ax += dx * f;
      ay += dy * f;
    }
    p.vx += ax * STEP;
    p.vy += ay * STEP;
    p.x += p.vx * STEP;
    p.y += p.vy * STEP;
    p.t += STEP;
    const gx = lv.gate.x - p.x, gy = lv.gate.y - p.y, gr = lv.gate.r + PROBE;
    if (gx * gx + gy * gy < gr * gr) return 'gate';
    if (p.t > MAX_FLIGHT || p.x < -EDGE || p.x > W + EDGE || p.y < -EDGE || p.y > H + EDGE) return 'lost';
    return 'fly';
  }

  // Turns a pull vector into a launch velocity, or null when the pull is too short to mean it.
  function velocity(dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len < 12) return null;
    const pull = Math.min(len, MAX_PULL);
    return { vx: dx / len * pull * POWER, vy: dy / len * pull * POWER, power: pull / MAX_PULL };
  }

  // Flies a whole shot without drawing it. Used for the aim preview and for checking levels.
  function fly(lv, vx, vy, maxSteps, trace) {
    const p = { x: lv.start.x, y: lv.start.y, vx: vx, vy: vy, t: 0 };
    for (let i = 0; i < maxSteps; i++) {
      const r = step(p, lv);
      if (trace && (i & 3) === 3) trace.push(p.x, p.y);
      if (r !== 'fly') return r;
    }
    return 'fly';
  }

  function drawBody(ctx, b) {
    const col = C[b.color] || C.violet;
    const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, U.mix(col, '#FFFFFF', 0.4));
    g.addColorStop(0.55, col);
    g.addColorStop(1, U.mix(col, C.bg, 0.55));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fill();
  }

  function create(api) {
    const view = api.canvas(W, H), ctx = view.ctx;
    const sparks = api.Particles(), pops = api.Floaters(), stars = api.Stars(90, W, H);
    let li = 0, lv = LEVELS[0], shots = 0, total = 0, score = 0, misses = 0;
    let aces = 0; // gates reached on the first launch this run
    let phase = 'aim', probe = null, trail = [], ghost = null, acc = 0, wait = 0, tick = 0;
    let drag = null;                      // the pull in progress, if any
    let last = { ang: 0, pull: 90 };      // the aim that stays on screen between shots

    function hud() {
      api.stat('System', (li + 1) + '/' + LEVELS.length);
      api.stat('Shots', shots);
      api.stat('First try', aces);
      api.stat('Score', score);
    }
    function load(i) {
      li = i;
      lv = LEVELS[i];
      shots = 0;
      misses = 0;
      phase = 'aim';
      probe = null;
      trail = [];
      ghost = null;
      drag = null;
      acc = 0;
      last = { ang: Math.atan2(lv.gate.y - lv.start.y, lv.gate.x - lv.start.x), pull: 90 };
      hud();
    }
    function currentAim() {
      if (drag) return velocity(drag.ax - drag.x, drag.ay - drag.y);
      return velocity(Math.cos(last.ang) * last.pull, Math.sin(last.ang) * last.pull);
    }
    function fire(v) {
      if (!v) return;
      last = { ang: Math.atan2(v.vy, v.vx), pull: v.power * MAX_PULL };
      shots++;
      total++;
      api.tally('launches');
      probe = { x: lv.start.x, y: lv.start.y, vx: v.vx, vy: v.vy, t: 0 };
      trail = [probe.x, probe.y];
      acc = 0;
      tick = 0;
      phase = 'fly';
      api.sfx.tone(200, 0.28, { type: 'sawtooth', to: 620, vol: 0.1 });
      hud();
    }
    function miss(crashed) {
      misses++;
      if (crashed) {
        api.tally('crashes');
        sparks.burst(probe.x, probe.y, { count: 24, color: C.coral, speed: 170 });
        api.sfx.boom();
      } else {
        api.sfx.bad();
      }
      ghost = trail;
      trail = [];
      probe = null;
      phase = 'aim';
    }
    function win() {
      const pts = shots === 1 ? 500 : shots === 2 ? 350 : shots === 3 ? 250 : shots <= 5 ? 150 : 80;
      score += pts;
      api.tally('gates');
      if (shots === 1) { aces++; api.tally('firstTry'); }
      api.high('flight', Math.round(probe.t * 10) / 10);
      pops.add(lv.gate.x, lv.gate.y - 34, '+' + pts, C.mint, 20);
      sparks.burst(lv.gate.x, lv.gate.y, { count: 40, color: C.mint, speed: 220, life: 0.9 });
      api.sfx.win();
      probe = null;
      phase = 'won';
      wait = 1.3;
      hud();
    }

    function update(dt) {
      sparks.update(dt);
      pops.update(dt);
      if (phase === 'fly') {
        acc += dt;
        while (acc >= STEP && phase === 'fly') {
          acc -= STEP;
          const r = step(probe, lv);
          if ((++tick & 1) === 0) trail.push(probe.x, probe.y);
          if (r === 'gate') win();
          else if (r === 'crash') miss(true);
          else if (r === 'lost') miss(false);
        }
      } else if (phase === 'won') {
        wait -= dt;
        if (wait <= 0) {
          if (li + 1 < LEVELS.length) {
            load(li + 1);
          } else {
            phase = 'done';
            api.low('fewest', total);
            api.gameOver({ title: 'All systems cleared', score: score, lines: [total + ' launches across ' + LEVELS.length + ' systems.'] });
          }
        }
      }
    }

    function path(points, from) {
      ctx.beginPath();
      ctx.moveTo(points[from], points[from + 1]);
      for (let i = from + 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
      ctx.stroke();
    }

    function draw(dt, t) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      stars.draw(ctx, t);

      // gravity wells: faint rings so the pull of each body can be read at a glance
      ctx.lineWidth = 1;
      for (let i = 0; i < lv.bodies.length; i++) {
        const b = lv.bodies[i];
        if (b.r < 24) continue;
        ctx.strokeStyle = U.alpha(C[b.color] || C.violet, 0.16);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.7, 0, TAU); ctx.stroke();
        ctx.strokeStyle = U.alpha(C[b.color] || C.violet, 0.08);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.6, 0, TAU); ctx.stroke();
      }
      for (let i = 0; i < lv.bodies.length; i++) drawBody(ctx, lv.bodies[i]);

      // gate
      const g = lv.gate, pulse = 1 + 0.07 * Math.sin(t * 4);
      ctx.fillStyle = U.alpha(C.mint, 0.16);
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r * pulse, 0, TAU); ctx.fill();
      ctx.strokeStyle = C.mint;
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 6]);
      ctx.lineDashOffset = -t * 22;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r * pulse, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);

      // the last shot, left behind as a guide
      if (ghost && ghost.length >= 4) {
        ctx.strokeStyle = U.alpha(C.soft, 0.4);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 7]);
        path(ghost, 0);
        ctx.setLineDash([]);
      }
      if (trail.length >= 4) {
        ctx.strokeStyle = U.alpha(C.sun, 0.75);
        ctx.lineWidth = 2;
        path(trail, Math.max(0, trail.length - 240));
      }

      // launch pad, aim and preview
      const s = lv.start;
      const v = phase === 'aim' ? currentAim() : null;
      const dir = v ? Math.atan2(v.vy, v.vx) : last.ang;
      if (v) {
        const dots = [];
        fly(lv, v.vx, v.vy, Math.round(110 * (1 + 0.35 * Math.min(misses, 12))), dots);
        ctx.fillStyle = C.sun;
        for (let i = 0; i < dots.length; i += 2) {
          ctx.globalAlpha = 0.15 + 0.85 * (1 - i / dots.length);
          ctx.fillRect(dots[i] - 1.5, dots[i + 1] - 1.5, 3, 3);
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(dir) * 18, s.y + Math.sin(dir) * 18);
        ctx.lineTo(s.x + Math.cos(dir) * (22 + v.power * 44), s.y + Math.sin(dir) * (22 + v.power * 44));
        ctx.stroke();
        ctx.fillStyle = C.ink;
        ctx.font = api.font(12, 'data');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(v.power * 100) + '%', s.x - Math.cos(dir) * 34, s.y - Math.sin(dir) * 34);
      }
      if (drag) {
        ctx.strokeStyle = U.alpha(C.ink, 0.35);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(drag.ax, drag.ay); ctx.lineTo(drag.x, drag.y); ctx.stroke();
      }
      ctx.strokeStyle = U.alpha(C.sky, 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0, TAU); ctx.stroke();
      if (phase !== 'fly') {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(dir);
        ctx.fillStyle = C.ink;
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      if (probe) {
        ctx.fillStyle = U.alpha(C.sun, 0.3);
        ctx.beginPath(); ctx.arc(probe.x, probe.y, PROBE * 2.4, 0, TAU); ctx.fill();
        ctx.fillStyle = C.ink;
        ctx.beginPath(); ctx.arc(probe.x, probe.y, PROBE, 0, TAU); ctx.fill();
      }
      sparks.draw(ctx);
      pops.draw(ctx);

      ctx.fillStyle = C.soft;
      ctx.font = api.font(12, 'data');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText((li + 1) + ' / ' + lv.name.toUpperCase(), 16, 14);
      if (phase === 'aim' && !drag) {
        const tip = misses > 0 ? 'Arrow keys fine-tune the aim. Space fires it again.'
          : li === 0 && shots === 0 ? 'Drag back anywhere, then let go to launch.' : '';
        if (tip) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = U.alpha(C.ink, 0.75);
          ctx.font = api.font(15, 'body');
          ctx.fillText(tip, W / 2, H - 16);
        }
      }
    }

    api.on(view.canvas, 'pointerdown', function (e) {
      if (!api.playing) return;
      e.preventDefault();
      if (phase === 'fly' && probe && probe.t > 0.6) miss(false); // cut a stray shot short
      if (phase !== 'aim') return;
      const p = view.point(e);
      drag = { ax: p.x, ay: p.y, x: p.x, y: p.y, id: e.pointerId };
      try { view.canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
    });
    api.on(view.canvas, 'pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      const p = view.point(e);
      drag.x = p.x;
      drag.y = p.y;
    });
    api.on(view.canvas, 'pointerup', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      const v = velocity(drag.ax - drag.x, drag.ay - drag.y);
      drag = null;
      if (api.playing && phase === 'aim') fire(v);
    });
    api.on(view.canvas, 'pointercancel', function (e) {
      if (drag && e.pointerId === drag.id) drag = null;
    });
    api.onKey(function (e) {
      if (phase !== 'aim' || drag) return;
      const k = e.shiftKey ? 5 : 1;
      if (e.code === 'ArrowLeft') last.ang -= 0.5 * k * DEG;
      else if (e.code === 'ArrowRight') last.ang += 0.5 * k * DEG;
      else if (e.code === 'ArrowUp') last.pull = Math.min(MAX_PULL, last.pull + k);
      else if (e.code === 'ArrowDown') last.pull = Math.max(15, last.pull - k);
      else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) fire(currentAim());
    });

    api.loop(update, draw);
    load(0);

    return {
      start: function () {
        score = 0;
        total = 0;
        aces = 0;
        sparks.clear();
        pops.clear();
        load(0);
      },
      peek: function () { return { level: li, phase: phase, shots: shots, score: score, start: lv.start, last: last }; }
    };
  }

  A.register({
    id: 'slingshot',
    title: 'Slingshot',
    tagline: 'Bend one shot around the planets and into the gate.',
    genre: 'Physics',
    input: 'Mouse',
    color: 'sky',
    stats: [
      { key: 'gates', label: 'Gates reached', kind: 'tally' },
      { key: 'firstTry', label: 'First-try gates', kind: 'tally', headline: true },
      { key: 'launches', label: 'Probes launched', kind: 'tally' },
      { key: 'crashes', label: 'Probes crashed', kind: 'tally' },
      { key: 'fewest', label: 'Fewest launches to clear all ten', kind: 'low' },
      { key: 'flight', label: 'Longest winning flight', kind: 'high', format: function (v) { return v.toFixed(1) + ' s'; } }
    ],
    how: [
      'Drag back anywhere and let go to launch the probe.',
      'Planets pull on it. Use them to curve the shot into the green gate.',
      'Missed? Arrow keys fine-tune the same aim and Space fires it again.',
      'Fewer launches score more. There are ten systems.'
    ],
    logic: { LEVELS: LEVELS, build: build, fly: fly, step: step, velocity: velocity, W: W, H: H, MAX_PULL: MAX_PULL, POWER: POWER, STEP: STEP, MAX_FLIGHT: MAX_FLIGHT },
    thumb: function (ctx, w, h, t) {
      drawBody(ctx, { x: 150, y: 112, r: 38, color: 'sun' });
      drawBody(ctx, { x: 246, y: 60, r: 13, color: 'pink' });
      ctx.strokeStyle = U.alpha(C.sun, 0.2);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(150, 112, 62, 0, TAU); ctx.stroke();
      // a shot swinging under the planet
      const n = 26, head = (t * 0.45) % 1.25;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const x = 36 + 236 * k, y = 70 + 150 * Math.sin(k * Math.PI) * (0.55 + 0.45 * k) - 40 * k;
        const lit = k <= head;
        ctx.globalAlpha = lit ? 1 : 0.28;
        ctx.fillStyle = lit ? C.sun : C.soft;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.mint;
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -t * 16;
      ctx.beginPath(); ctx.arc(276, 32, 15, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.ink;
      ctx.beginPath(); ctx.arc(36, 70, 5, 0, TAU); ctx.fill();
    },
    create: create
  });
})();
