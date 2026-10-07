/* Swarm: hold out against the horde, and pick an upgrade every time you level up. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors, TAU = U.TAU;

  const W = 900, H = 560;
  const MAX_ENEMIES = 110;

  const TYPES = {
    grunt: { r: 11, hp: 2, speed: 68, points: 10, xp: 1, color: C.coral },
    runner: { r: 8, hp: 1, speed: 132, points: 15, xp: 1, color: C.pink },
    brute: { r: 19, hp: 9, speed: 44, points: 50, xp: 4, color: C.violet }
  };

  // Each upgrade can be taken `max` times. `apply` changes the player's stats in place.
  const UPGRADES = [
    { id: 'rate', name: 'Rapid fire', text: 'Shoot 25% faster.', max: 5, apply: function (p) { p.rate *= 1.25; } },
    { id: 'shots', name: 'Split shot', text: 'One more shot in every volley.', max: 4, apply: function (p) { p.shots += 1; } },
    { id: 'dmg', name: 'Heavy rounds', text: 'Every shot hits one point harder.', max: 5, apply: function (p) { p.dmg += 1; } },
    { id: 'pierce', name: 'Piercing', text: 'Shots pass through one more enemy.', max: 4, apply: function (p) { p.pierce += 1; } },
    { id: 'speed', name: 'Thrusters', text: 'Move 12% faster.', max: 4, apply: function (p) { p.speed *= 1.12; } },
    { id: 'magnet', name: 'Magnet', text: 'Pull in shards from much further away.', max: 3, apply: function (p) { p.magnet *= 1.6; } },
    { id: 'heal', name: 'Repair', text: 'One more heart, and two refilled.', max: 4, apply: function (p) { p.maxHp += 1; p.hp = Math.min(p.maxHp, p.hp + 2); } },
    { id: 'nova', name: 'Pulse', text: 'A shockwave every few seconds. Stronger each time.', max: 5, apply: function (p) { p.nova += 1; } }
  ];

  // Enemy health over time: a gentle climb, then a steep one after two minutes, so that even a
  // fully upgraded ship is eventually overrun.
  function toughness(t) {
    const late = Math.max(0, t - 120) / 110;
    return 1 + t / 150 + late * late;
  }

  function freshPlayer() {
    return {
      x: W / 2, y: H / 2, r: 10, hp: 4, maxHp: 4, inv: 0, speed: 230,
      rate: 4.5, shots: 1, dmg: 1, pierce: 0, magnet: 85, nova: 0, novaT: 3,
      fireT: 0, level: 1, xp: 0, need: 5, taken: {}
    };
  }

  // Three different upgrades the player can still take.
  function offer(p) {
    const open = UPGRADES.filter(function (u) { return (p.taken[u.id] || 0) < u.max; });
    return U.shuffle(open).slice(0, 3);
  }

  // The upgrade picked most often across every run, for the stat sheet.
  function favourite(career) {
    let top = null, n = 0;
    UPGRADES.forEach(function (u) {
      const picked = career['up_' + u.id] || 0;
      if (picked > n) { n = picked; top = u; }
    });
    return top ? top.name + ' (' + n + ')' : undefined;
  }

  function drawEnemy(ctx, e, aim) {
    ctx.fillStyle = e.flash > 0 ? C.ink : e.color;
    if (e.type === 'runner') {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(aim);
      ctx.beginPath(); ctx.moveTo(e.r * 1.3, 0); ctx.lineTo(-e.r, -e.r * 0.9); ctx.lineTo(-e.r * 0.5, 0); ctx.lineTo(-e.r, e.r * 0.9); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (e.type === 'brute') {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + 0.5;
        ctx.lineTo(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = U.alpha(C.bg, 0.5);
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.45, 0, TAU); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(e.x, e.y - e.r); ctx.lineTo(e.x + e.r, e.y); ctx.lineTo(e.x, e.y + e.r); ctx.lineTo(e.x - e.r, e.y); ctx.closePath(); ctx.fill();
    }
  }
  function drawShip(ctx, x, y, ang, r, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(r * 1.5, 0); ctx.lineTo(-r, -r); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r, r); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function create(api) {
    const view = api.canvas(W, H), ctx = view.ctx;
    const sparks = api.Particles(), pops = api.Floaters();
    let p = freshPlayer(), enemies = [], bullets = [], gems = [], rings = [];
    let time = 0, score = 0, kills = 0, spawnT = 0, waveT = 25, wave = 0;
    let mouse = null, stick = null, touchMode = false, aimAng = 0, shake = 0, deadT = 0, phase = 'play';
    let choice = null, panel = null;
    const hearts = api.lives('Lives');

    function hud() {
      hearts.set(p.hp, p.maxHp);
      api.stat('Time', U.clock(time));
      api.stat('Level', p.level);
      api.stat('Kills', kills);
      api.stat('Score', score);
    }
    function closePanel() {
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      panel = null;
      choice = null;
    }
    function reset() {
      closePanel();
      p = freshPlayer();
      enemies = [];
      bullets = [];
      gems = [];
      rings = [];
      time = 0;
      score = 0;
      kills = 0;
      spawnT = 0.6;
      waveT = 25;
      wave = 0;
      shake = 0;
      deadT = 0;
      phase = 'play';
      stick = null;
      sparks.clear();
      pops.clear();
      hud();
    }

    function spawnEnemy(forceType) {
      if (enemies.length >= Math.min(160, MAX_ENEMIES + time / 6)) return;
      const side = U.randInt(0, 3);
      const x = side === 0 ? -24 : side === 1 ? W + 24 : U.rand(W);
      const y = side === 2 ? -24 : side === 3 ? H + 24 : U.rand(H);
      let type = forceType || 'grunt';
      if (!forceType) {
        const roll = Math.random();
        if (time > 50 && roll < 0.12) type = 'brute';
        else if (time > 18 && roll < 0.38) type = 'runner';
      }
      const T = TYPES[type];
      enemies.push({
        type: type, x: x, y: y, r: T.r, color: T.color, points: T.points, xp: T.xp,
        hp: Math.max(T.hp, Math.round(T.hp * toughness(time))), speed: T.speed * (1 + Math.min(0.5, time / 300)),
        kx: 0, ky: 0, flash: 0, dead: false
      });
    }
    function kill(e) {
      if (e.dead) return;
      e.dead = true;
      kills++;
      api.tally('kills');
      score += e.points;
      sparks.burst(e.x, e.y, { count: e.type === 'brute' ? 22 : 9, color: e.color, speed: 170 });
      for (let i = 0; i < e.xp; i++) gems.push({ x: e.x + U.rand(-8, 8), y: e.y + U.rand(-8, 8), age: 0, dead: false });
      if (gems.length > 160) gems.splice(0, gems.length - 160);
      api.sfx.tone(e.type === 'brute' ? 120 : 300, 0.09, { type: 'square', to: 80, vol: 0.07 });
    }
    function hurt(e, dmg) {
      e.hp -= dmg;
      e.flash = 0.08;
      if (e.hp <= 0) kill(e);
    }
    function shove(x, y, radius, force) {
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i], dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1;
        if (d > radius) continue;
        e.kx += dx / d * force;
        e.ky += dy / d * force;
      }
    }
    function levelUp() {
      p.xp -= p.need;
      p.level++;
      p.need = Math.floor(p.need * 1.25 + 3);
      const options = offer(p);
      api.sfx.win();
      if (!options.length) { p.hp = Math.min(p.maxHp, p.hp + 1); return; } // everything is maxed out
      choice = options;
      panel = document.createElement('div');
      panel.className = 'sw-choice';
      const h = document.createElement('h3');
      h.textContent = 'Level ' + p.level + '. Pick one.';
      panel.appendChild(h);
      const row = document.createElement('div');
      row.className = 'sw-cards';
      options.forEach(function (u, i) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sw-card';
        const k = document.createElement('kbd');
        k.textContent = 'Key ' + (i + 1);
        const name = document.createElement('b');
        name.textContent = u.name;
        const text = document.createElement('span');
        text.textContent = u.text;
        b.appendChild(k);
        b.appendChild(name);
        b.appendChild(text);
        b.addEventListener('click', function () { take(i); });
        row.appendChild(b);
      });
      panel.appendChild(row);
      api.stage.appendChild(panel);
    }
    function take(i) {
      if (!choice || !choice[i] || !api.playing) return;
      const u = choice[i];
      u.apply(p);
      p.taken[u.id] = (p.taken[u.id] || 0) + 1;
      api.tally('up_' + u.id);
      p.inv = Math.max(p.inv, 0.6);
      closePanel();
      api.sfx.good();
      hud();
    }

    function nearest() {
      let best = null, bd = Infinity;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i], d = (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }

    function update(dt) {
      sparks.update(dt);
      pops.update(dt);
      hearts.update(dt);
      shake = Math.max(0, shake - 30 * dt);
      if (choice) return; // the world waits while you choose

      if (phase === 'dead') {
        deadT -= dt;
        if (deadT <= 0) {
          phase = 'over';
          api.gameOver({
            title: 'Overrun', score: score,
            lines: ['You held out for ' + Math.floor(time / 60) + ':' + ('0' + Math.floor(time % 60)).slice(-2) + ' and reached level ' + p.level + '.', kills + ' down.']
          });
        }
        return;
      }
      if (phase !== 'play') return;
      time += dt;

      // spawning: a steady trickle that thickens, plus a surge every 25 seconds
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnEnemy();
        spawnT += 1 / Math.min(time > 300 ? 9 : 7, 0.7 + time * 0.03);
      }
      waveT -= dt;
      if (waveT <= 0) {
        wave++;
        waveT = 25;
        api.tally('surges');
        const n = Math.min(26, 5 + wave * 3);
        for (let i = 0; i < n; i++) spawnEnemy(i % 4 === 0 && time > 18 ? 'runner' : 'grunt');
        pops.add(W / 2, 70, 'SURGE ' + wave, C.coral, 22);
        api.sfx.tone(90, 0.5, { type: 'sawtooth', to: 180, vol: 0.12 });
      }

      // move
      let mx = (api.key('KeyD') || api.key('ArrowRight') ? 1 : 0) - (api.key('KeyA') || api.key('ArrowLeft') ? 1 : 0);
      let my = (api.key('KeyS') || api.key('ArrowDown') ? 1 : 0) - (api.key('KeyW') || api.key('ArrowUp') ? 1 : 0);
      if (stick) {
        const sx = stick.x - stick.ox, sy = stick.y - stick.oy, sl = Math.hypot(sx, sy);
        if (sl > 8) { mx = sx / sl * Math.min(1, sl / 50); my = sy / sl * Math.min(1, sl / 50); }
      }
      const ml = Math.hypot(mx, my);
      if (ml > 1) { mx /= ml; my /= ml; }
      p.x = U.clamp(p.x + mx * p.speed * dt, p.r, W - p.r);
      p.y = U.clamp(p.y + my * p.speed * dt, p.r, H - p.r);
      p.inv = Math.max(0, p.inv - dt);

      // aim: the mouse when there is one, otherwise the closest enemy
      const near = nearest();
      if (!touchMode && mouse) aimAng = Math.atan2(mouse.y - p.y, mouse.x - p.x);
      else if (near) aimAng = Math.atan2(near.y - p.y, near.x - p.x);

      // fire
      p.fireT -= dt;
      if (p.fireT <= 0 && (near || mouse)) {
        p.fireT = Math.max(p.fireT, -0.05) + 1 / p.rate;
        for (let i = 0; i < p.shots; i++) {
          const a = aimAng + (i - (p.shots - 1) / 2) * 0.13;
          bullets.push({ x: p.x + Math.cos(a) * 12, y: p.y + Math.sin(a) * 12, vx: Math.cos(a) * 620, vy: Math.sin(a) * 620, life: 1.1, pierce: p.pierce, hit: [], dead: false });
        }
        api.sfx.tone(700, 0.04, { type: 'square', to: 420, vol: 0.035 });
      }

      // pulse
      if (p.nova > 0) {
        p.novaT -= dt;
        if (p.novaT <= 0) {
          p.novaT = Math.max(2.4, 5.4 - p.nova * 0.5);
          const radius = 110 + p.nova * 14;
          rings.push({ x: p.x, y: p.y, age: 0, radius: radius });
          for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (Math.hypot(e.x - p.x, e.y - p.y) < radius + e.r) hurt(e, 1 + p.nova);
          }
          shove(p.x, p.y, radius + 30, 260);
          api.sfx.noise(0.25, { freq: 1200, to: 200, vol: 0.14 });
        }
      }

      // bullets
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) { b.dead = true; continue; }
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (e.dead || b.hit.indexOf(e) >= 0) continue;
          const dx = e.x - b.x, dy = e.y - b.y, rr = e.r + 5;
          if (dx * dx + dy * dy > rr * rr) continue;
          hurt(e, p.dmg);
          b.hit.push(e);
          if (b.pierce-- <= 0) { b.dead = true; break; }
        }
      }

      // enemies close in, and nudge each other apart so they do not stack
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead) continue;
        const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
        e.x += (dx / d * e.speed + e.kx) * dt;
        e.y += (dy / d * e.speed + e.ky) * dt;
        const k = Math.max(0, 1 - 5 * dt);
        e.kx *= k;
        e.ky *= k;
        e.flash = Math.max(0, e.flash - dt);
        if (d < e.r + p.r - 2 && p.inv <= 0) {
          p.hp--;
          p.inv = 1.3;
          shake = 12;
          shove(p.x, p.y, 150, 420);
          sparks.burst(p.x, p.y, { count: 20, color: C.mint, speed: 220 });
          api.sfx.boom();
          hud();
        }
      }
      for (let i = 0; i < enemies.length; i++) {
        const a = enemies[i];
        if (a.dead) continue;
        for (let j = i + 1; j < enemies.length; j++) {
          const b = enemies[j];
          if (b.dead) continue;
          const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
          if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
          const d = Math.hypot(dx, dy) || 0.01;
          if (d >= min) continue;
          const push = (min - d) / 2, ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
        }
      }

      // shards drift to the player once they are in range
      for (let i = 0; i < gems.length; i++) {
        const g = gems[i];
        g.age += dt;
        const dx = p.x - g.x, dy = p.y - g.y, d = Math.hypot(dx, dy) || 1;
        if (d < p.magnet) {
          const pull = 260 + (1 - d / p.magnet) * 420;
          g.x += dx / d * pull * dt;
          g.y += dy / d * pull * dt;
        }
        if (d < p.r + 9) {
          g.dead = true;
          p.xp++;
          score += 2;
          api.tally('shards');
          api.sfx.tone(880 + Math.min(600, p.xp * 30), 0.04, { type: 'triangle', vol: 0.07 });
        }
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        rings[i].age += dt;
        if (rings[i].age > 0.4) rings.splice(i, 1);
      }

      enemies = enemies.filter(function (e) { return !e.dead; });
      bullets = bullets.filter(function (b) { return !b.dead; });
      gems = gems.filter(function (g) { return !g.dead; });

      if (p.hp <= 0) {
        phase = 'dead';
        deadT = 1.1;
        api.high('stand', Math.floor(time));
        api.high('level', p.level);
        sparks.burst(p.x, p.y, { count: 70, color: C.mint, speed: 320, life: 1 });
        api.sfx.lose();
      } else if (p.xp >= p.need) {
        levelUp();
      }
      hud();
    }

    function draw(dt, t) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      if (shake > 0) ctx.translate(U.rand(-shake, shake) * 0.5, U.rand(-shake, shake) * 0.5);

      ctx.strokeStyle = U.alpha(C.line, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 30; x < W; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 40; y < H; y += 60) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();

      for (let i = 0; i < gems.length; i++) {
        const g = gems[i], s = 3.2 + Math.sin(g.age * 8 + i) * 0.8;
        ctx.fillStyle = C.sky;
        ctx.beginPath(); ctx.moveTo(g.x, g.y - s); ctx.lineTo(g.x + s, g.y); ctx.lineTo(g.x, g.y + s); ctx.lineTo(g.x - s, g.y); ctx.closePath(); ctx.fill();
      }
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i], k = r.age / 0.4;
        ctx.strokeStyle = U.alpha(C.sun, 1 - k);
        ctx.lineWidth = 5 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.radius * (0.2 + 0.8 * k), 0, TAU); ctx.stroke();
      }
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        drawEnemy(ctx, e, Math.atan2(p.y - e.y, p.x - e.x));
      }
      ctx.fillStyle = C.sun;
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        ctx.beginPath(); ctx.arc(b.x, b.y, 3.2, 0, TAU); ctx.fill();
      }
      if (phase === 'play') {
        if (p.inv <= 0 || Math.floor(t * 14) % 2 === 0) drawShip(ctx, p.x, p.y, aimAng, p.r, C.mint);
        ctx.strokeStyle = U.alpha(C.mint, 0.14);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.magnet, 0, TAU); ctx.stroke();
      }
      sparks.draw(ctx);
      pops.draw(ctx);
      ctx.restore();

      // experience bar and hull pips
      ctx.fillStyle = C.bg2;
      ctx.fillRect(0, 0, W, 6);
      ctx.fillStyle = C.sky;
      ctx.fillRect(0, 0, W * U.clamp(p.xp / p.need, 0, 1), 6);
      hearts.draw(ctx, 14, 26, 19);
      if (stick) {
        ctx.strokeStyle = U.alpha(C.ink, 0.35);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 50, 0, TAU); ctx.stroke();
        ctx.fillStyle = U.alpha(C.ink, 0.35);
        const sx = stick.x - stick.ox, sy = stick.y - stick.oy, sl = Math.hypot(sx, sy) || 1, k = Math.min(1, 50 / sl);
        ctx.beginPath(); ctx.arc(stick.ox + sx * k, stick.oy + sy * k, 18, 0, TAU); ctx.fill();
      }
      if (time < 5 && phase === 'play') {
        ctx.fillStyle = U.alpha(C.ink, 0.8);
        ctx.font = api.font(15, 'body');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(api.touch ? 'Drag to move. The ship aims and fires by itself.' : 'WASD or arrows to move. Aim with the mouse. It fires by itself.', W / 2, H - 16);
      }
    }

    api.on(view.canvas, 'pointerdown', function (e) {
      if (!api.playing) return;
      e.preventDefault();
      const pt = view.point(e);
      if (e.pointerType === 'touch') {
        touchMode = true;
        stick = { id: e.pointerId, ox: pt.x, oy: pt.y, x: pt.x, y: pt.y };
        try { view.canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
      } else {
        touchMode = false;
        mouse = pt;
      }
    });
    api.on(window, 'pointermove', function (e) {
      const pt = view.point(e);
      if (e.pointerType === 'touch') {
        if (stick && stick.id === e.pointerId) { stick.x = pt.x; stick.y = pt.y; }
      } else {
        touchMode = false;
        mouse = pt;
      }
    });
    const lift = function (e) { if (stick && stick.id === e.pointerId) stick = null; };
    api.on(window, 'pointerup', lift);
    api.on(window, 'pointercancel', lift);
    api.onKey(function (e) {
      if (!choice || e.repeat) return;
      if (e.code === 'Digit1' || e.code === 'Numpad1') take(0);
      else if (e.code === 'Digit2' || e.code === 'Numpad2') take(1);
      else if (e.code === 'Digit3' || e.code === 'Numpad3') take(2);
    });

    api.loop(update, draw);
    reset();

    return {
      start: reset,
      destroy: closePanel,
      peek: function () { return { time: time, score: score, kills: kills, hp: p.hp, level: p.level, xp: p.xp, need: p.need, enemies: enemies.length, bullets: bullets.length, gems: gems.length, choosing: !!choice, phase: phase, x: p.x, y: p.y, player: p, foes: enemies }; }
    };
  }

  A.register({
    id: 'swarm',
    title: 'Swarm',
    tagline: 'Hold out against the horde and build your ship as you go.',
    genre: 'Shooter',
    input: 'Keys and mouse',
    color: 'pink',
    stats: [
      { key: 'kills', label: 'Enemies destroyed', kind: 'tally', headline: true },
      { key: 'stand', label: 'Longest stand', kind: 'high', format: U.clock },
      { key: 'level', label: 'Highest level', kind: 'high' },
      { key: 'surges', label: 'Surges faced', kind: 'tally' },
      { key: 'shards', label: 'Shards collected', kind: 'tally' },
      { label: 'Favourite upgrade', derive: favourite }
    ],
    how: [
      'Move with WASD or the arrow keys. Aim with the mouse. The ship fires by itself.',
      'Collect the blue shards enemies drop to level up.',
      'Each level lets you pick one of three upgrades. Click one or press 1, 2 or 3.',
      'A surge arrives every 25 seconds. Each hit costs a heart, and you start with four.'
    ],
    logic: { UPGRADES: UPGRADES, freshPlayer: freshPlayer, offer: offer, toughness: toughness },
    thumb: function (ctx, w, h, t) {
      const px = 160, py = 104;
      const foes = [[52, 40, 'grunt'], [268, 52, 'grunt'], [282, 150, 'brute'], [40, 150, 'runner'], [120, 22, 'runner'], [222, 176, 'grunt'], [96, 178, 'grunt']];
      const aim = Math.atan2(foes[1][1] - py, foes[1][0] - px);
      foes.forEach(function (f, i) {
        const T = TYPES[f[2]], k = 0.5 + 0.5 * Math.sin(t * 1.2 + i);
        const x = f[0] + (px - f[0]) * 0.12 * k, y = f[1] + (py - f[1]) * 0.12 * k;
        drawEnemy(ctx, { type: f[2], x: x, y: y, r: T.r * 0.9, color: T.color, flash: 0 }, Math.atan2(py - y, px - x));
      });
      ctx.fillStyle = C.sun;
      for (let i = 0; i < 4; i++) {
        const d = 22 + ((t * 90 + i * 30) % 120);
        ctx.beginPath(); ctx.arc(px + Math.cos(aim) * d, py + Math.sin(aim) * d, 2.6, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = C.sky;
      [[190, 70], [130, 140], [205, 128]].forEach(function (g) { ctx.fillRect(g[0] - 2.5, g[1] - 2.5, 5, 5); });
      drawShip(ctx, px, py, aim, 9, C.mint);
    },
    create: create
  });
})();
