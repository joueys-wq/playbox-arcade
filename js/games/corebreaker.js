/* Core Breaker: breakout bent into a circle. Punch through the turning rings and crack the core. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors, TAU = U.TAU;

  const S = 640, CX = S / 2, CY = S / 2;
  const TRACK = 296;   // radius the paddle rides on
  const PAD_T = 10;    // paddle thickness
  const BALL = 6;
  const CORE = 34;
  const RIM = TRACK - PAD_T / 2 - BALL; // where the ball's centre meets the paddle
  const RING_IN = 64, RING_STEP = 30, RING_T = 22;
  const RING_COLORS = [C.coral, C.sun, C.mint, C.sky, C.violet];

  function buildLevel(n) {
    const rings = [], count = Math.min(5, 2 + Math.ceil(n / 2));
    for (let i = 0; i < count; i++) {
      const segs = 8 + i * 4, r0 = RING_IN + i * RING_STEP, bricks = [];
      for (let k = 0; k < segs; k++) bricks.push(n >= 3 && Math.random() < Math.min(0.5, 0.12 * (n - 2)) ? 2 : 1);
      rings.push({
        r0: r0, r1: r0 + RING_T, n: segs, bricks: bricks,
        gap: 5 / (r0 + RING_T / 2),                 // angular gap between neighbours
        off: Math.random() * TAU,                   // current rotation
        spin: (i % 2 ? -1 : 1) * Math.min(0.6, 0.14 + 0.05 * n) * (1 - i * 0.08),
        color: RING_COLORS[i % RING_COLORS.length]
      });
    }
    return { rings: rings, coreHp: 2 + Math.ceil(n / 2), speed: Math.min(470, 280 + 22 * n), padW: Math.max(0.2, 0.31 - 0.012 * n) };
  }

  // Rebuilds the ball's velocity from a radial part (+ is outward) and a tangential part.
  function setVel(b, nx, ny, vr, vt) {
    b.vx = nx * vr - ny * vt;
    b.vy = ny * vr + nx * vt;
  }

  // Moves the ball through dt in substeps short enough that it cannot skip a brick, and records
  // what it hit. Everything is worked out in polar terms, so a turning ring is only an angle offset.
  function advance(st, dt, events) {
    const b = st.ball;
    const steps = Math.max(1, Math.ceil(st.speed * dt / 3)), h = dt / steps;
    for (let s = 0; s < steps; s++) {
      const px = b.x, py = b.y;
      b.x += b.vx * h;
      b.y += b.vy * h;
      const dx = b.x - CX, dy = b.y - CY, r = Math.hypot(dx, dy) || 0.001;
      const nx = dx / r, ny = dy / r;
      const vr = b.vx * nx + b.vy * ny, vt = -b.vx * ny + b.vy * nx;

      if (r < CORE + BALL) {
        if (vr < 0) {
          setVel(b, nx, ny, -vr, vt);
          events.push({ type: 'core', x: b.x, y: b.y });
        }
        continue;
      }

      if (r >= RIM) {
        if (vr > 0 && r <= RIM + 14) {
          const off = U.angleDiff(Math.atan2(dy, dx), st.pad.a);
          if (Math.abs(off) <= st.pad.w + BALL / r) {
            // Where it strikes the paddle steers it. Some sideways speed is shed on every bounce
            // so the ball always heads back in towards the rings.
            let ur = -vr, ut = vt * 0.7 + U.clamp(off / st.pad.w, -1, 1) * 0.6 * st.speed;
            const m = Math.hypot(ur, ut) || 1;
            ur = ur / m * st.speed;
            ut = ut / m * st.speed;
            if (ur > -0.5 * st.speed) {
              ur = -0.5 * st.speed;
              ut = (ut < 0 ? -1 : 1) * Math.sqrt(st.speed * st.speed - ur * ur);
            }
            setVel(b, nx, ny, ur, ut);
            b.x = CX + nx * (RIM - 0.5);
            b.y = CY + ny * (RIM - 0.5);
            events.push({ type: 'paddle' });
            continue;
          }
        }
        if (r > TRACK + 44) { events.push({ type: 'lost' }); return; }
        continue;
      }

      // Every brick the ball is touching takes the hit; the first one decides the bounce.
      const ang = Math.atan2(dy, dx), pr = Math.hypot(px - CX, py - CY), reach = BALL / r;
      let bounced = false;
      for (let i = 0; i < st.rings.length; i++) {
        const ring = st.rings[i];
        if (r + BALL <= ring.r0 || r - BALL >= ring.r1) continue;
        const seg = TAU / ring.n;
        const rel = ((ang - ring.off) % TAU + TAU) % TAU;
        const base = Math.floor(rel / seg);
        for (let d = -1; d <= 1; d++) {
          const k = (base + d + ring.n) % ring.n;
          if (ring.bricks[k] <= 0) continue;
          const off = U.angleDiff(rel, (k + 0.5) * seg);
          if (Math.abs(off) > seg / 2 - ring.gap / 2 + reach) continue;
          if (!bounced) {
            // Bounce away from whichever face it came through.
            if (pr - BALL >= ring.r1 - 0.01) setVel(b, nx, ny, Math.abs(vr), vt);
            else if (pr + BALL <= ring.r0 + 0.01) setVel(b, nx, ny, -Math.abs(vr), vt);
            else setVel(b, nx, ny, vr, (off >= 0 ? 1 : -1) * Math.abs(vt));
            bounced = true;
          }
          ring.bricks[k]--;
          events.push({ type: 'brick', ring: i, dead: ring.bricks[k] <= 0, x: CX + nx * (ring.r0 + RING_T / 2), y: CY + ny * (ring.r0 + RING_T / 2) });
        }
      }
      if (bounced) {
        b.x = px;
        b.y = py;
      }
    }
  }

  function drawRing(ctx, ring) {
    const seg = TAU / ring.n, mid = ring.r0 + RING_T / 2;
    ctx.lineWidth = RING_T;
    for (let k = 0; k < ring.n; k++) {
      if (ring.bricks[k] <= 0) continue;
      const a0 = ring.off + k * seg + ring.gap / 2, a1 = ring.off + (k + 1) * seg - ring.gap / 2;
      ctx.strokeStyle = ring.color;
      ctx.beginPath(); ctx.arc(CX, CY, mid, a0, a1); ctx.stroke();
      if (ring.bricks[k] > 1) { // armoured bricks carry a dark band
        ctx.strokeStyle = U.alpha(C.bg, 0.45);
        ctx.lineWidth = RING_T * 0.36;
        ctx.beginPath(); ctx.arc(CX, CY, mid, a0 + ring.gap, a1 - ring.gap); ctx.stroke();
        ctx.lineWidth = RING_T;
      }
    }
  }

  function create(api) {
    const view = api.canvas(S, S), ctx = view.ctx;
    const sparks = api.Particles(), pops = api.Floaters(), stars = api.Stars(60, S, S);
    const events = [];
    let st = null, level = 1, lives = 3, score = 0, phase = 'serve', wait = 0;
    let mouseAng = null, useMouse = false, trail = [], coreFlash = 0;
    let rally = 0;
    const hearts = api.lives('Lives');

    function hud() {
      hearts.set(lives, 5);
      api.stat('Level', level);
      api.stat('Rally', rally);
      api.stat('Score', score);
    }
    function newLevel(n) {
      const L = buildLevel(n);
      level = n;
      if (api.playing) api.high('level', n);
      st = {
        ball: { x: CX, y: CY + RIM - 1, vx: 0, vy: 0, stuck: true },
        pad: { a: st ? st.pad.a : Math.PI / 2, w: L.padW },
        rings: L.rings, coreHp: L.coreHp, coreMax: L.coreHp, speed: L.speed
      };
      phase = 'serve';
      trail = [];
      hud();
    }
    function launch() {
      if (phase !== 'serve') return;
      const a = st.pad.a + Math.PI + U.rand(-0.3, 0.3); // towards the centre, a little off axis
      st.ball.vx = Math.cos(a) * st.speed;
      st.ball.vy = Math.sin(a) * st.speed;
      st.ball.stuck = false;
      phase = 'play';
      api.sfx.tone(330, 0.1, { type: 'triangle', to: 520 });
    }
    function handle(ev) {
      if (ev.type === 'brick') {
        const ring = st.rings[ev.ring];
        score += (ev.dead ? 25 : 10) * level;
        if (ev.dead) api.tally('bricks');
        sparks.burst(ev.x, ev.y, { count: ev.dead ? 12 : 5, color: ring.color, speed: 150 });
        api.sfx.note(4 + ev.ring * 2 + (ev.dead ? 1 : 0), { dur: 0.12, vol: 0.13 });
      } else if (ev.type === 'core') {
        st.coreHp--;
        coreFlash = 0.3;
        score += 50 * level;
        sparks.burst(ev.x, ev.y, { count: 16, color: C.ink, speed: 200 });
        api.sfx.tone(180, 0.2, { type: 'square', to: 90, vol: 0.14 });
        if (st.coreHp <= 0) {
          api.tally('cores');
          score += 250 * level;
          pops.add(CX, CY - 60, '+' + (250 * level), C.sun, 22);
          sparks.burst(CX, CY, { count: 80, color: C.sun, speed: 340, life: 1.1 });
          api.sfx.win();
          if (lives < 5) lives++;
          st.ball.stuck = true;
          phase = 'cleared';
          wait = 1.6;
        }
      } else if (ev.type === 'paddle') {
        rally++;
        api.high('rally', rally);
        api.sfx.tone(260, 0.06, { type: 'triangle', vol: 0.14 });
      } else if (ev.type === 'lost') {
        lives--;
        rally = 0;
        api.tally('lost');
        api.sfx.bad();
        if (lives <= 0) {
          phase = 'dead';
          hud();
          api.gameOver({ title: 'The core holds', score: score, lines: ['You reached level ' + level + '.'] });
          return;
        }
        st.ball.stuck = true;
        phase = 'serve';
        trail = [];
      }
      hud();
    }

    function update(dt) {
      for (let i = 0; i < st.rings.length; i++) st.rings[i].off += st.rings[i].spin * dt;

      // The arrow keys pull the paddle towards that side of the ring; the mouse sets it directly.
      const kx = (api.key('ArrowRight') || api.key('KeyD') ? 1 : 0) - (api.key('ArrowLeft') || api.key('KeyA') ? 1 : 0);
      const ky = (api.key('ArrowDown') || api.key('KeyS') ? 1 : 0) - (api.key('ArrowUp') || api.key('KeyW') ? 1 : 0);
      if (kx || ky) {
        useMouse = false;
        st.pad.a += U.clamp(U.angleDiff(Math.atan2(ky, kx), st.pad.a), -4 * dt, 4 * dt);
      } else if (useMouse && mouseAng !== null) {
        st.pad.a += U.clamp(U.angleDiff(mouseAng, st.pad.a), -18 * dt, 18 * dt);
      }

      if (phase === 'play') {
        events.length = 0;
        advance(st, dt, events);
        for (let i = 0; i < events.length; i++) {
          handle(events[i]);
          if (phase !== 'play') break;
        }
        trail.push(st.ball.x, st.ball.y);
        if (trail.length > 24) trail.splice(0, 2);
      } else if (phase === 'cleared') {
        wait -= dt;
        if (wait <= 0) newLevel(level + 1);
      }
      if (st.ball.stuck) {
        st.ball.x = CX + Math.cos(st.pad.a) * (RIM - 1);
        st.ball.y = CY + Math.sin(st.pad.a) * (RIM - 1);
      }
      coreFlash = Math.max(0, coreFlash - dt);
      hearts.update(dt);
      sparks.update(dt);
      pops.update(dt);
    }

    function draw(dt, t) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, S, S);
      stars.draw(ctx, t, 0.6);
      hearts.draw(ctx, 16, 26, 20);

      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(CX, CY, TRACK, 0, TAU); ctx.stroke();

      for (let i = 0; i < st.rings.length; i++) drawRing(ctx, st.rings[i]);

      if (st.coreHp > 0) {
        const pulse = 1 + 0.05 * Math.sin(t * 5);
        ctx.fillStyle = U.alpha(C.sun, 0.18);
        ctx.beginPath(); ctx.arc(CX, CY, CORE * 1.35 * pulse, 0, TAU); ctx.fill();
        ctx.fillStyle = coreFlash > 0 ? C.ink : C.sun;
        ctx.beginPath(); ctx.arc(CX, CY, CORE, 0, TAU); ctx.fill();
        ctx.fillStyle = C.bg;
        ctx.font = api.font(24, 'display');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(st.coreHp), CX, CY + 2);
      }

      ctx.strokeStyle = C.mint;
      ctx.lineWidth = PAD_T;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(CX, CY, TRACK, st.pad.a - st.pad.w, st.pad.a + st.pad.w); ctx.stroke();
      ctx.lineCap = 'butt';

      if (phase === 'play' || phase === 'serve') {
        for (let i = 0; i < trail.length; i += 2) {
          ctx.fillStyle = U.alpha(C.ink, 0.04 + 0.3 * (i / trail.length));
          ctx.beginPath(); ctx.arc(trail[i], trail[i + 1], BALL * (0.4 + 0.6 * i / trail.length), 0, TAU); ctx.fill();
        }
        ctx.fillStyle = C.ink;
        ctx.beginPath(); ctx.arc(st.ball.x, st.ball.y, BALL, 0, TAU); ctx.fill();
      }
      sparks.draw(ctx);
      pops.draw(ctx);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (phase === 'serve') {
        ctx.fillStyle = U.alpha(C.ink, 0.85);
        ctx.font = api.font(15, 'body');
        ctx.fillText(api.touch ? 'Tap to serve' : 'Click or press Space to serve', CX, CY + 240);
      } else if (phase === 'cleared') {
        ctx.fillStyle = C.sun;
        ctx.font = api.font(34, 'display');
        ctx.fillText('CORE CRACKED', CX, CY);
      }
    }

    function point(e) {
      const p = view.point(e);
      mouseAng = Math.atan2(p.y - CY, p.x - CX);
      useMouse = true;
    }
    api.on(window, 'pointermove', point);
    api.on(view.canvas, 'pointerdown', function (e) {
      if (!api.playing) return;
      e.preventDefault();
      point(e);
      launch();
    });
    api.onKey(function (e) {
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) launch();
    });

    api.loop(update, draw);
    newLevel(1);

    return {
      start: function () {
        lives = 3;
        score = 0;
        rally = 0;
        sparks.clear();
        pops.clear();
        st = null;
        newLevel(1);
      },
      peek: function () { return { level: level, lives: lives, score: score, phase: phase, coreHp: st.coreHp, pad: st.pad.a, ball: { x: st.ball.x, y: st.ball.y }, bricks: st.rings.reduce(function (n, r) { return n + r.bricks.filter(function (v) { return v > 0; }).length; }, 0) }; }
    };
  }

  A.register({
    id: 'corebreaker',
    title: 'Core Breaker',
    tagline: 'Breakout bent into a circle, with rings that turn.',
    genre: 'Arcade',
    input: 'Mouse or keys',
    color: 'mint',
    stats: [
      { key: 'bricks', label: 'Bricks broken', kind: 'tally' },
      { key: 'cores', label: 'Cores cracked', kind: 'tally', headline: true },
      { key: 'level', label: 'Highest level reached', kind: 'high' },
      { key: 'rally', label: 'Longest rally', kind: 'high', unit: ' returns' },
      { key: 'lost', label: 'Balls lost', kind: 'tally' }
    ],
    how: [
      'Move the mouse around the ring to swing the paddle. Arrow keys pull it towards that side.',
      'Click or press Space to serve.',
      'Break through the turning rings and hit the core until its number reaches zero.',
      'Let the ball escape the ring and it costs a heart. Each cleared level wins one back.'
    ],
    logic: { buildLevel: buildLevel, advance: advance, CX: CX, CY: CY, RIM: RIM, TRACK: TRACK, BALL: BALL, CORE: CORE },
    thumb: function (ctx, w, h, t) {
      const cx = 160, cy = 100;
      const rings = [[26, 6, C.coral, 0.5], [44, 9, C.sun, -0.35], [62, 12, C.mint, 0.25]];
      ctx.lineWidth = 13;
      rings.forEach(function (r, ri) {
        const seg = TAU / r[1];
        for (let k = 0; k < r[1]; k++) {
          if ((k * 7 + ri * 3) % 5 === 0) continue; // a few bricks already gone
          ctx.strokeStyle = r[2];
          ctx.beginPath(); ctx.arc(cx, cy, r[0], t * r[3] + k * seg + 0.06, t * r[3] + (k + 1) * seg - 0.06); ctx.stroke();
        }
      });
      ctx.fillStyle = C.sun;
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, TAU); ctx.fill();
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 92, 0, TAU); ctx.stroke();
      const pa = 0.9 + Math.sin(t * 1.3) * 0.5;
      ctx.strokeStyle = C.mint;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, 92, pa - 0.3, pa + 0.3); ctx.stroke();
      ctx.lineCap = 'butt';
      const br = 70 + Math.sin(t * 2.2) * 14;
      ctx.fillStyle = C.ink;
      ctx.beginPath(); ctx.arc(cx + Math.cos(pa - 0.1) * br, cy + Math.sin(pa - 0.1) * br, 4, 0, TAU); ctx.fill();
    },
    create: create
  });
})();
