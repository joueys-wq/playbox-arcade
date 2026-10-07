/* Playbox core: the game registry, the page shell, and the helpers every game shares. */
(function () {
  'use strict';

  const TAU = Math.PI * 2;

  const colors = {
    bg: '#0E0C22', bg2: '#1B1842', line: '#2F2B63', soft: '#A6A2D4', ink: '#F3F0FF',
    coral: '#FF6257', sun: '#FFC93C', mint: '#3DDBA9', sky: '#4FB0FF', violet: '#9C82FF', pink: '#FF86C8'
  };
  const palette = [colors.coral, colors.sun, colors.mint, colors.sky, colors.violet, colors.pink];

  const FONTS = {
    display: '"Bungee", "Arial Black", Impact, sans-serif',
    body: '"Onest", "Segoe UI", system-ui, sans-serif',
    data: '"Martian Mono", "Cascadia Mono", Consolas, monospace'
  };
  const WEIGHTS = { display: 400, body: 500, data: 600 };
  function font(px, role, weight) {
    role = role || 'body';
    return (weight || WEIGHTS[role]) + ' ' + px + 'px ' + FONTS[role];
  }

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const util = {
    TAU: TAU,
    clamp: function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    rand: function (a, b) {
      if (a === undefined) return Math.random();
      if (b === undefined) return Math.random() * a;
      return a + Math.random() * (b - a);
    },
    randInt: function (a, b) { return a + Math.floor(Math.random() * (b - a + 1)); },
    pick: function (list) { return list[Math.floor(Math.random() * list.length)]; },
    shuffle: function (list, rnd) {
      rnd = rnd || Math.random;
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = list[i]; list[i] = list[j]; list[j] = t;
      }
      return list;
    },
    // Signed shortest distance from angle b to angle a, in (-PI, PI].
    angleDiff: function (a, b) {
      let d = (a - b) % TAU;
      if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
      return d;
    },
    // Small seeded generator (mulberry32) for puzzles that must be reproducible.
    rng: function (seed) {
      let s = seed >>> 0;
      return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    // Seconds as m:ss.
    clock: function (seconds) {
      const s = Math.max(0, Math.floor(seconds));
      return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    },
    // Both take #RRGGBB.
    mix: function (a, b, t) {
      const x = rgb(a), y = rgb(b);
      return 'rgb(' + Math.round(x[0] + (y[0] - x[0]) * t) + ',' + Math.round(x[1] + (y[1] - x[1]) * t) + ',' + Math.round(x[2] + (y[2] - x[2]) * t) + ')';
    },
    alpha: function (hex, a) {
      const c = rgb(hex);
      return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    },
    // Traces a rounded rectangle path.
    rr: function (ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  };

  /* ---------- storage: best scores, mute, per-game saves ---------- */
  const store = (function () {
    const KEY = 'playbox.v1';
    let data = {};
    try { data = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { data = {}; }
    if (typeof data !== 'object' || Array.isArray(data)) data = {};
    return {
      get: function (k, fallback) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : fallback; },
      set: function (k, v) {
        data[k] = v;
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* storage may be blocked; play on */ }
      }
    };
  })();

  /* ---------- sound: a tiny synth, no audio files ---------- */
  const sound = (function () {
    const PENTA = [0, 2, 4, 7, 9];
    let ctx = null, master = null, noiseBuf = null;
    let muted = !!store.get('muted', false);
    let recent = [];

    function resume() {
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          const comp = ctx.createDynamicsCompressor();
          master = ctx.createGain();
          master.gain.value = 0.55;
          master.connect(comp);
          comp.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') {
          const p = ctx.resume();
          if (p && p.catch) p.catch(function () {});
        }
      } catch (e) { ctx = null; }
    }
    // Returns the context when a sound may play now. Immediate sounds are rate limited so a
    // chain reaction cannot stack up dozens of voices in one frame.
    function ready(delayed) {
      if (muted || !ctx || ctx.state !== 'running') return null;
      if (!delayed) {
        const now = ctx.currentTime;
        recent = recent.filter(function (t) { return now - t < 0.05; });
        if (recent.length >= 6) return null;
        recent.push(now);
      }
      return ctx;
    }
    function tone(freq, dur, o) {
      try {
        o = o || {};
        const c = ready(!!o.delay);
        if (!c) return;
        const t0 = c.currentTime + (o.delay || 0), d = dur || 0.12;
        const vol = Math.max(0.0002, o.vol === undefined ? 0.18 : o.vol);
        const osc = c.createOscillator(), g = c.createGain();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(Math.max(20, freq), t0);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + d);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.012, d / 3));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
        osc.connect(g);
        g.connect(master);
        osc.start(t0);
        osc.stop(t0 + d + 0.03);
      } catch (e) { /* sound is optional */ }
    }
    function noise(dur, o) {
      try {
        o = o || {};
        const c = ready(!!o.delay);
        if (!c) return;
        if (!noiseBuf) {
          noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
          const ch = noiseBuf.getChannelData(0);
          for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
        }
        const t0 = c.currentTime + (o.delay || 0), d = Math.min(dur || 0.2, 0.9);
        const vol = Math.max(0.0002, o.vol === undefined ? 0.2 : o.vol);
        const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        src.buffer = noiseBuf;
        f.type = 'lowpass';
        f.frequency.setValueAtTime(o.freq || 1800, t0);
        if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t0 + d);
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
        src.connect(f);
        f.connect(g);
        g.connect(master);
        src.start(t0, Math.random() * 0.05, d + 0.02);
      } catch (e) { /* sound is optional */ }
    }

    return {
      tone: tone,
      noise: noise,
      resume: resume,
      isMuted: function () { return muted; },
      setMuted: function (v) { muted = !!v; store.set('muted', muted); },
      // Pentatonic scale degree, so any run of notes sounds musical.
      note: function (i, o) {
        const n = Math.max(0, Math.floor(i));
        const semis = PENTA[n % 5] + 12 * Math.floor(n / 5);
        tone(261.63 * Math.pow(2, semis / 12), (o && o.dur) || 0.22, { type: (o && o.type) || 'triangle', vol: (o && o.vol) || 0.18 });
      },
      click: function () { tone(520, 0.05, { type: 'triangle', vol: 0.12 }); },
      good: function () { tone(660, 0.09, { type: 'triangle' }); tone(990, 0.16, { type: 'triangle', delay: 0.07 }); },
      bad: function () { tone(190, 0.24, { type: 'sawtooth', to: 90, vol: 0.13 }); },
      boom: function () { noise(0.36, { freq: 900, to: 80, vol: 0.3 }); tone(110, 0.3, { to: 40, vol: 0.2 }); },
      win: function () { [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, 0.18, { type: 'triangle', delay: 0.001 + i * 0.09 }); }); },
      lose: function () { [392, 329.63, 261.63, 196].forEach(function (f, i) { tone(f, 0.22, { type: 'triangle', delay: 0.001 + i * 0.12, vol: 0.16 }); }); }
    };
  })();

  /* ---------- small canvas kits ---------- */
  function Particles() {
    const list = [];
    return {
      list: list,
      burst: function (x, y, o) {
        o = o || {};
        const n = o.count || 12;
        for (let i = 0; i < n; i++) {
          const a = o.angle === undefined ? Math.random() * TAU : o.angle + (Math.random() - 0.5) * (o.spread || 0);
          const sp = (o.speed || 120) * (0.35 + Math.random() * 0.65);
          list.push({
            x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
            life: (o.life || 0.6) * (0.6 + Math.random() * 0.4),
            size: o.size || 3, color: o.color || colors.ink,
            gravity: o.gravity || 0, drag: o.drag === undefined ? 1.6 : o.drag
          });
        }
        if (list.length > 700) list.splice(0, list.length - 700);
      },
      update: function (dt) {
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          p.age += dt;
          if (p.age >= p.life) { list.splice(i, 1); continue; }
          const k = Math.max(0, 1 - p.drag * dt);
          p.vx *= k;
          p.vy = p.vy * k + p.gravity * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
      },
      draw: function (ctx) {
        for (let i = 0; i < list.length; i++) {
          const p = list[i], a = 1 - p.age / p.life, s = p.size * (0.4 + 0.6 * a);
          ctx.globalAlpha = a;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
        }
        ctx.globalAlpha = 1;
      },
      clear: function () { list.length = 0; }
    };
  }

  function Floaters() {
    const list = [];
    return {
      add: function (x, y, text, color, size) {
        list.push({ x: x, y: y, text: String(text), color: color || colors.ink, size: size || 15, age: 0 });
        if (list.length > 50) list.shift();
      },
      update: function (dt) {
        for (let i = list.length - 1; i >= 0; i--) {
          const f = list[i];
          f.age += dt;
          f.y -= 36 * dt;
          if (f.age >= 0.9) list.splice(i, 1);
        }
      },
      draw: function (ctx) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          ctx.globalAlpha = Math.max(0, 1 - f.age / 0.9);
          ctx.fillStyle = f.color;
          ctx.font = font(f.size, 'data');
          ctx.fillText(f.text, f.x, f.y);
        }
        ctx.globalAlpha = 1;
      },
      clear: function () { list.length = 0; }
    };
  }

  function Stars(count, w, h) {
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({ x: Math.random() * w, y: Math.random() * h, r: 0.8 + Math.random() * 1.6, p: Math.random() * TAU, s: 0.5 + Math.random() * 1.5 });
    }
    return {
      list: list,
      draw: function (ctx, t, strength) {
        const k = strength === undefined ? 1 : strength;
        ctx.fillStyle = colors.ink;
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          ctx.globalAlpha = k * (0.2 + 0.3 * (0.5 + 0.5 * Math.sin(s.p + t * s.s)));
          ctx.fillRect(s.x, s.y, s.r, s.r);
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  // Traces a heart centred on (x, y), about 2.2 * s wide and 1.75 * s tall.
  function heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.87);
    ctx.bezierCurveTo(x - s * 1.9, y - s * 0.23, x - s * 0.9, y - s * 1.43, x, y - s * 0.58);
    ctx.bezierCurveTo(x + s * 0.9, y - s * 1.43, x + s * 1.9, y - s * 0.23, x, y + s * 0.87);
    ctx.closePath();
  }

  // Lives as a row of hearts. A game calls set() when the count changes and draw() each frame.
  // `mirror`, when given, hears about every change so the same row can be shown outside the
  // canvas too. Losing a heart or winning one back plays a short pop.
  function Hearts(mirror) {
    const fx = [];
    let now = -1, cap = 0;
    return {
      count: function () { return Math.max(0, now); },
      set: function (n, max, quiet) {
        n = Math.max(0, Math.round(n));
        max = Math.max(Math.round(max || 0), n);
        const was = quiet ? -1 : now;
        if (was < 0) fx.length = 0;
        for (let i = n; i < was; i++) fx.push({ i: i, lost: true, age: 0 });
        for (let i = Math.max(0, was); was >= 0 && i < n; i++) fx.push({ i: i, lost: false, age: 0 });
        if (mirror && (n !== now || max !== cap || quiet)) mirror(n, max, was);
        now = n;
        cap = max;
      },
      update: function (dt) {
        for (let i = fx.length - 1; i >= 0; i--) {
          fx[i].age += dt;
          if (fx[i].age >= 0.5) fx.splice(i, 1);
        }
      },
      // Draws the row starting at its left edge x, centred on y. `size` is the width of one heart.
      draw: function (ctx, x, y, size) {
        const s = size / 2.2;
        for (let i = 0; i < cap; i++) {
          const cx = x + size / 2 + i * size * 1.22, full = i < now;
          let scale = 1, ghost = -1;
          for (let k = 0; k < fx.length; k++) {
            if (fx[k].i !== i) continue;
            const p = fx[k].age / 0.5;
            if (fx[k].lost) ghost = p;
            else scale = p < 0.6 ? 0.3 + p / 0.6 : 1.3 - (p - 0.6) / 0.4 * 0.3;
          }
          heartPath(ctx, cx, y, s * (full ? scale : 1));
          if (full) {
            ctx.fillStyle = colors.coral;
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
            ctx.beginPath();
            ctx.arc(cx - s * 0.5 * scale, y - s * 0.38 * scale, s * 0.2 * scale, 0, TAU);
            ctx.fill();
          } else {
            ctx.fillStyle = colors.line;
            ctx.fill();
          }
          if (!full && ghost >= 0) { // the heart that just broke swells and fades
            ctx.globalAlpha = 1 - ghost;
            heartPath(ctx, cx, y, s * (1 + 0.9 * ghost));
            ctx.fillStyle = colors.coral;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      }
    };
  }

  /* ---------- registry ---------- */
  const games = [];
  const Arcade = {
    colors: colors, palette: palette, util: util, font: font, sound: sound,
    Particles: Particles, Floaters: Floaters, Stars: Stars, Hearts: Hearts, heartPath: heartPath,
    games: games,
    register: function (def) { games.push(def); }
  };
  window.Arcade = Arcade;
  if (typeof document === 'undefined') return; // logic-only use, e.g. tests

  /* ---------- page shell ---------- */
  let els = null, current = null, homeScroll = 0, focusTimer = 0, booted = false;
  const cards = {};
  const thumbStops = [];
  const SCROLLS = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 }; // keys that would scroll the page
  const PRESSES = { Space: 1, Enter: 1, NumpadEnter: 1 };                               // keys that press a focused button

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function media(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
  function fmt(def, v) {
    if (v === null || v === undefined) return '';
    return def.formatScore ? def.formatScore(v) : Number(v).toLocaleString('en-US');
  }
  function bestOf(def) {
    const v = store.get('best.' + def.id, null);
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  function submit(def, score) {
    if (typeof score !== 'number' || !isFinite(score)) return false;
    const prev = bestOf(def);
    const better = prev === null ? score > 0 : score > prev;
    if (!better) return false;
    store.set('best.' + def.id, score);
    if (current && current.def === def) setBestPill(current);
    return true;
  }
  function blurActive() {
    try { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } catch (e) { /* nothing focused */ }
  }

  /* ----- lifetime statistics, one set per game ----- */
  // Each game lists its own stats: { key, label, kind: 'tally' | 'high' | 'low', unit, format,
  // headline } or { label, derive(career) } for a line worked out from the others.
  function careerOf(def) {
    const saved = store.get('stats.' + def.id, null);
    const out = {};
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) Object.keys(saved).forEach(function (k) { out[k] = saved[k]; });
    return out;
  }
  function statText(s, career) {
    const v = s.derive ? s.derive(career) : career[s.key];
    if (v === undefined || v === null || v === '') return s.kind === 'tally' ? '0' : '---';
    if (s.format) return s.format(v, career);
    return (typeof v === 'number' ? (Math.round(v * 10) / 10).toLocaleString('en-US') : String(v)) + (s.unit || '');
  }
  // A label/value list of everything a game tracks, led by its best score and play count.
  function statSheet(def, career) {
    const dl = el('dl', 'sheet');
    const add = function (label, value, cls) {
      const row = el('div', 'sheet-row' + (cls ? ' ' + cls : ''));
      row.appendChild(el('dt', null, label));
      row.appendChild(el('dd', null, value));
      dl.appendChild(row);
    };
    const best = bestOf(def);
    add(def.bestLabel || 'Best ' + (def.scoreLabel || 'score').toLowerCase(), best === null ? '---' : fmt(def, best), 'lead');
    add('Times played', String(career.plays || 0));
    (def.stats || []).forEach(function (s) { add(s.label, statText(s, career)); });
    return dl;
  }
  function flushCareer(m) {
    if (!m || !m.dirty) return;
    m.dirty = false;
    m.flushedAt = performance.now();
    store.set('stats.' + m.def.id, m.career);
  }
  function record(m, key, value, dir) {
    if (typeof value !== 'number' || !isFinite(value)) return false;
    const prev = m.career[key];
    if (typeof prev === 'number' && (dir > 0 ? value <= prev : value >= prev)) return false;
    m.career[key] = value;
    m.dirty = true;
    // It is only news if it beats what stood when this run began, not a first entry and not a
    // mark set a moment ago in the same run.
    const stood = m.baseline[key];
    if (typeof stood === 'number' && (dir > 0 ? value > stood : value < stood)) m.broken[key] = true;
    return true;
  }
  function heartIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 3 24 20');
    svg.setAttribute('class', 'heart');
    svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', 'M12 21.5C-7 10.5 3-1.5 12 7C21-1.5 31 10.5 12 21.5Z');
    svg.appendChild(path);
    return svg;
  }

  /* ----- home: shelf and hi-score board ----- */
  function drawThumb(def, cv, t) {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(cv.width / 320, 0, 0, cv.height / 200, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, 320, 200);
    if (def.thumb) { try { def.thumb(ctx, 320, 200, t); } catch (e) { /* a thumbnail must never break the page */ } }
    ctx.restore();
  }

  function buildHome() {
    els.shelf.textContent = '';
    els.board.textContent = '';
    els.ledger.textContent = '';
    games.forEach(function (def) {
      const tint = 'var(--c-' + def.color + ')';

      const a = el('a', 'cab');
      a.href = '#' + def.id;
      a.style.setProperty('--cab', tint);
      const screen = el('div', 'cab-screen');
      const cv = document.createElement('canvas');
      cv.width = 480;
      cv.height = 300;
      cv.setAttribute('aria-hidden', 'true');
      screen.appendChild(cv);
      const body = el('div', 'cab-body');
      body.appendChild(el('h3', 'cab-title', def.title));
      body.appendChild(el('p', 'cab-pitch', def.tagline));
      const meta = el('div', 'cab-meta');
      meta.appendChild(el('span', 'tag', def.genre));
      meta.appendChild(el('span', 'tag', def.input));
      const best = el('span', 'cab-best');
      meta.appendChild(best);
      body.appendChild(meta);
      const feat = el('p', 'cab-stat');
      feat.hidden = true;
      body.appendChild(feat);
      a.appendChild(screen);
      a.appendChild(body);
      a.addEventListener('click', function (e) { e.preventDefault(); go(def.id); });

      // The thumbnail is a still until you point at it.
      let raf = 0, t0 = 0;
      const tick = function (now) { raf = requestAnimationFrame(tick); drawThumb(def, cv, 1.2 + (now - t0) / 1000); };
      const stop = function () { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
      const play = function () {
        if (raf || media('(prefers-reduced-motion: reduce)')) return;
        t0 = performance.now();
        raf = requestAnimationFrame(tick);
      };
      a.addEventListener('pointerenter', play);
      a.addEventListener('pointerleave', stop);
      a.addEventListener('focus', play);
      a.addEventListener('blur', stop);
      thumbStops.push(stop);
      drawThumb(def, cv, 1.2);
      els.shelf.appendChild(a);

      const row = el('li');
      row.style.setProperty('--cab', tint);
      row.appendChild(el('span', 'board-dot'));
      row.appendChild(el('span', 'board-name', def.title));
      row.appendChild(el('span', 'board-lead'));
      const score = el('span', 'board-score');
      row.appendChild(score);
      els.board.appendChild(row);

      // The stat sheet: one fold-out per game, open by default where there is room.
      const entry = el('details', 'ledger-item');
      entry.style.setProperty('--cab', tint);
      entry.open = window.innerWidth >= 700;
      const head = el('summary', 'ledger-head');
      head.appendChild(el('span', 'ledger-name', def.title));
      const plays = el('span', 'ledger-note');
      head.appendChild(plays);
      entry.appendChild(head);
      const sheet = el('div', 'ledger-body');
      entry.appendChild(sheet);
      els.ledger.appendChild(entry);

      cards[def.id] = { best: best, score: score, feat: feat, plays: plays, sheet: sheet };
    });
  }

  function refreshHome() {
    games.forEach(function (def) {
      const c = cards[def.id], b = bestOf(def), career = careerOf(def);
      if (!c) return;
      c.best.textContent = b === null ? '' : 'Best ' + fmt(def, b);
      c.score.textContent = b === null ? '---' : fmt(def, b);
      c.score.classList.toggle('empty', b === null);
      // each cabinet shows off the one number that game is proudest of
      const top = (def.stats || []).filter(function (s) { return s.headline; })[0];
      const has = !!top && (top.derive ? top.derive(career) : career[top.key]) !== undefined;
      c.feat.textContent = has ? top.label + ': ' + statText(top, career) : '';
      c.feat.hidden = !has;
      c.plays.textContent = career.plays ? career.plays + (career.plays === 1 ? ' play' : ' plays') : 'not played yet';
      c.sheet.textContent = '';
      c.sheet.appendChild(statSheet(def, career));
    });
  }

  function syncSound() {
    const on = !sound.isMuted();
    const list = document.querySelectorAll('.sound-toggle');
    for (let i = 0; i < list.length; i++) {
      list[i].textContent = on ? 'Sound on' : 'Sound off';
      list[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /* ----- overlays ----- */
  function hideOverlay() {
    clearTimeout(focusTimer);
    if (current) current.statsBack = null;
    els.overlay.hidden = true;
    els.overlay.removeAttribute('data-arming');
    els.overlay.textContent = '';
  }
  // `arm` keeps the buttons inert for a moment so a click meant for the game cannot restart it.
  function showOverlay(m, panel, focusEl, arm) {
    clearTimeout(focusTimer);
    m.statsBack = null;
    els.overlay.textContent = '';
    els.overlay.appendChild(panel);
    els.overlay.hidden = false;
    els.overlay.scrollTop = 0;
    if (arm) els.overlay.setAttribute('data-arming', ''); else els.overlay.removeAttribute('data-arming');
    focusTimer = setTimeout(function () {
      if (current !== m || els.overlay.hidden) return;
      els.overlay.removeAttribute('data-arming');
      if (focusEl && focusEl.isConnected) { try { focusEl.focus({ preventScroll: true }); } catch (e) { /* focus is a nicety */ } }
    }, arm ? 450 : 60);
  }
  function button(label, cls, fn) {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  function howList(def) {
    const ul = el('ul', 'panel-how');
    (def.how || []).forEach(function (line) { ul.appendChild(el('li', null, line)); });
    return ul;
  }

  function showIntro(m) {
    const d = m.def, p = el('div', 'panel');
    p.appendChild(el('p', 'panel-kicker', d.genre + ' / ' + d.input));
    p.appendChild(el('h2', 'panel-title', d.title));
    p.appendChild(el('p', 'panel-pitch', d.tagline));
    p.appendChild(howList(d));
    const b = bestOf(d);
    if (b !== null) p.appendChild(el('p', 'panel-note', 'Your best: ' + fmt(d, b)));
    const v = m.views[0];
    if (v && v.w > v.h * 1.2 && els.stage.clientWidth < 560 && window.innerHeight > window.innerWidth) {
      p.appendChild(el('p', 'panel-note', 'This game is wider than your screen. Turn the phone sideways for a bigger view.'));
    }
    const row = el('div', 'panel-actions');
    const play = button('Play', 'btn', function () { startGame(m); });
    row.appendChild(play);
    row.appendChild(button('Stats', 'btn quiet', function () { showStats(m); }));
    p.appendChild(row);
    showOverlay(m, p, play, false);
  }

  // The stats panel sits on top of whatever was showing (the intro, a pause, a result) and hands
  // back to it. Opened mid-play, it pauses the game and resumes it on the way out.
  function showStats(m) {
    if (current !== m) return;
    if (m.statsBack) { m.statsBack(); return; }
    flushCareer(m);
    const wasPlaying = m.state === 'playing';
    if (wasPlaying) { m.state = 'paused'; m.keys.clear(); }
    const under = els.overlay.hidden ? null : els.overlay.firstChild;
    if (under) els.overlay.removeChild(under);

    const d = m.def, p = el('div', 'panel');
    p.appendChild(el('p', 'panel-kicker', d.title));
    p.appendChild(el('h2', 'panel-title', 'Your numbers'));
    let sheet = statSheet(d, m.career);
    p.appendChild(sheet);
    const back = function () {
      if (current !== m) return;
      if (under) { showOverlay(m, under, under.querySelector('.btn'), false); syncTools(m); }
      else if (wasPlaying) resumeGame(m);
      else hideOverlay();
    };
    const row = el('div', 'panel-actions');
    const done = button(wasPlaying ? 'Back to the game' : 'Back', 'btn', back);
    row.appendChild(done);
    // erasing takes two presses, since nothing here can ask "are you sure?" in a dialog
    let armed = false;
    const wipe = button('Erase these numbers', 'btn quiet', function () {
      if (!armed) { armed = true; wipe.textContent = 'Press again to erase'; return; }
      armed = false;
      wipe.textContent = 'Erased';
      wipe.disabled = true;
      m.career = {};
      m.broken = {};
      m.baseline = {};
      m.dirty = false;
      store.set('stats.' + d.id, {});
      store.set('best.' + d.id, null);
      setBestPill(m);
      const fresh = statSheet(d, m.career);
      p.replaceChild(fresh, sheet);
      sheet = fresh;
    });
    row.appendChild(wipe);
    p.appendChild(row);
    showOverlay(m, p, done, false);
    m.statsBack = back;
    syncTools(m);
  }

  function startGame(m) {
    if (current !== m) return;
    m.timers = [];
    m.keys.clear();
    hideOverlay();
    m.state = 'playing';
    m.broken = {};
    m.baseline = {};
    Object.keys(m.career).forEach(function (k) { m.baseline[k] = m.career[k]; });
    m.career.plays = (Number(m.career.plays) || 0) + 1;
    m.dirty = true;
    blurActive();
    sound.resume();
    try { if (m.instance.start) m.instance.start(); } catch (err) { if (window.console) console.error(err); }
    m.last = performance.now();
    syncTools(m);
  }

  function pauseGame(m) {
    if (current !== m || m.state !== 'playing') return;
    m.state = 'paused';
    m.keys.clear();
    flushCareer(m);
    const p = el('div', 'panel');
    p.appendChild(el('p', 'panel-kicker', m.def.title));
    p.appendChild(el('h2', 'panel-title', 'Paused'));
    p.appendChild(howList(m.def));
    const row = el('div', 'panel-actions');
    const resume = button('Resume', 'btn', function () { resumeGame(m); });
    row.appendChild(resume);
    row.appendChild(button('Restart', 'btn quiet', function () { startGame(m); }));
    p.appendChild(row);
    showOverlay(m, p, resume, false);
    syncTools(m);
  }

  function resumeGame(m) {
    if (current !== m || m.state !== 'paused') return;
    hideOverlay();
    m.state = 'playing';
    m.last = performance.now();
    blurActive();
    syncTools(m);
  }

  function endGame(m, o) {
    if (current !== m || (m.state !== 'playing' && m.state !== 'paused')) return;
    m.state = 'over';
    m.keys.clear();
    const d = m.def, p = el('div', 'panel');
    const hasScore = typeof o.score === 'number';
    const isBest = hasScore ? submit(d, o.score) : false;
    p.appendChild(el('p', 'panel-kicker', d.title));
    p.appendChild(el('h2', 'panel-title', o.title || 'Game over'));
    if (hasScore) {
      const s = el('p', 'panel-score');
      s.appendChild(el('span', 'panel-score-label', d.scoreLabel || 'Score'));
      s.appendChild(el('span', 'panel-score-value', fmt(d, o.score)));
      p.appendChild(s);
      const b = bestOf(d);
      if (isBest) p.appendChild(el('p', 'panel-best', 'New best'));
      else if (b !== null) p.appendChild(el('p', 'panel-note', 'Your best: ' + fmt(d, b)));
    }
    (o.lines || []).forEach(function (line) { p.appendChild(el('p', 'panel-note', line)); });
    // call out up to three personal records this run beat
    (d.stats || []).filter(function (s) { return s.key && m.broken[s.key]; }).slice(0, 3).forEach(function (s) {
      p.appendChild(el('p', 'panel-record', 'New record. ' + s.label + ': ' + statText(s, m.career)));
    });
    flushCareer(m);
    const row = el('div', 'panel-actions');
    const again = button('Play again', 'btn', function () { startGame(m); });
    row.appendChild(again);
    row.appendChild(button('Stats', 'btn quiet', function () { showStats(m); }));
    row.appendChild(button('All games', 'btn quiet', function () { go(''); }));
    p.appendChild(row);
    showOverlay(m, p, again, true);
    syncTools(m);
  }

  function syncTools(m) {
    els.pause.textContent = m.state === 'paused' ? 'Resume' : 'Pause';
    els.pause.disabled = !(m.state === 'playing' || m.state === 'paused');
    els.restart.textContent = m.state === 'intro' ? 'Play' : 'Restart';
  }

  function setBestPill(m) {
    const b = bestOf(m.def);
    if (!m.bestEl) {
      m.bestEl = el('div', 'stat');
      m.bestEl.appendChild(el('span', 'stat-label', 'Best'));
      m.bestEl.appendChild(el('span', 'stat-value', ''));
      els.stats.appendChild(m.bestEl);
    }
    m.bestEl.lastChild.textContent = fmt(m.def, b);
    m.bestEl.hidden = b === null;
  }

  /* ----- the api each game receives ----- */
  function makeApi(m) {
    return {
      stage: els.stage, util: util, colors: colors, palette: palette, font: font, sfx: sound,
      Particles: Particles, Floaters: Floaters, Stars: Stars,
      touch: media('(pointer: coarse)'),
      get playing() { return m.state === 'playing'; },

      // Listeners, timers and the loop registered here are torn down when the player leaves.
      on: function (target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        m.cleanups.push(function () { target.removeEventListener(type, fn, opts); });
      },
      loop: function (update, draw) { m.update = update || null; m.draw = draw || null; },
      // Game-clock timer: it stops while paused and is dropped on restart.
      after: function (seconds, fn) {
        const t = { left: seconds, fn: fn, dead: false };
        m.timers.push(t);
        return t;
      },
      cancel: function (t) { if (t) t.dead = true; },

      key: function (code) { return m.keys.has(code); },
      onKey: function (fn) { m.keyDown.push(fn); },
      onKeyUp: function (fn) { m.keyUp.push(fn); },
      onResize: function (fn) {
        const f = function () { fn(els.stage.clientWidth, els.stage.clientHeight); };
        m.fitters.push(f);
        f();
      },

      // A canvas with a fixed logical size that scales to fit the stage.
      canvas: function (w, h, opts) {
        const reserve = (opts && opts.reserve) || 0;
        const c = document.createElement('canvas');
        c.className = 'game-canvas';
        const ctx = c.getContext('2d');
        const view = {
          canvas: c, ctx: ctx, w: w, h: h,
          point: function (e) {
            const r = c.getBoundingClientRect();
            return { x: (e.clientX - r.left) * w / (r.width || 1), y: (e.clientY - r.top) * h / (r.height || 1) };
          }
        };
        const fit = function () {
          const bw = els.stage.clientWidth, bh = els.stage.clientHeight - reserve;
          if (bw <= 0 || bh <= 0) return;
          const s = Math.min(bw / w, bh / h);
          const cw = Math.max(1, Math.floor(w * s)), ch = Math.max(1, Math.floor(h * s));
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const pw = Math.max(1, Math.round(cw * dpr)), ph = Math.max(1, Math.round(ch * dpr));
          c.style.width = cw + 'px';
          c.style.height = ch + 'px';
          if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
          ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0);
        };
        els.stage.appendChild(c);
        m.fitters.push(fit);
        m.views.push(view);
        fit();
        return view;
      },

      stat: function (label, value) {
        let node = m.statEls[label];
        if (!node) {
          node = el('div', 'stat');
          node.appendChild(el('span', 'stat-label', label));
          node.appendChild(el('span', 'stat-value', ''));
          els.stats.insertBefore(node, m.bestEl);
          m.statEls[label] = node;
        }
        const v = String(value);
        if (node.lastChild.textContent !== v) node.lastChild.textContent = v;
      },

      // Lives shown as hearts, in the play bar and (via the returned object's draw) on the canvas.
      lives: function (label) {
        const pill = el('div', 'stat stat-hearts');
        pill.appendChild(el('span', 'stat-label', label || 'Lives'));
        const row = el('span', 'hearts');
        row.setAttribute('role', 'img');
        pill.appendChild(row);
        els.stats.insertBefore(pill, m.bestEl);
        return Hearts(function (n, max, was) {
          while (row.childNodes.length < max) row.appendChild(heartIcon());
          while (row.childNodes.length > max) row.removeChild(row.lastChild);
          for (let i = 0; i < max; i++) {
            const h = row.childNodes[i];
            h.classList.remove('lost', 'gained');
            h.classList.toggle('full', i < n);
            if (was < 0) continue;
            if (i >= n && i < was) { h.getBoundingClientRect(); h.classList.add('lost'); }
            else if (i >= was && i < n) { h.getBoundingClientRect(); h.classList.add('gained'); }
          }
          row.setAttribute('aria-label', n + ' of ' + max + ' lives left');
        });
      },

      // Lifetime numbers for this game, saved in the browser. tally adds up, high and low keep
      // a record (and return true when it is beaten), keep stores a value as it is.
      tally: function (key, n) {
        m.career[key] = (Number(m.career[key]) || 0) + (n === undefined ? 1 : n);
        m.dirty = true;
      },
      high: function (key, value) { return record(m, key, value, 1); },
      low: function (key, value) { return record(m, key, value, -1); },
      keep: function (key, value) { m.career[key] = value; m.dirty = true; },
      career: function (key, fallback) { return m.career[key] === undefined ? fallback : m.career[key]; },

      best: function () { return bestOf(m.def); },
      submitScore: function (v) { return submit(m.def, v); },
      save: function (k, v) { store.set('save.' + m.def.id + '.' + k, v); },
      load: function (k, fallback) { return store.get('save.' + m.def.id + '.' + k, fallback); },
      gameOver: function (o) { endGame(m, o || {}); }
    };
  }

  /* ----- one frame ----- */
  function runTimers(m, dt) {
    const due = [];
    for (let i = 0; i < m.timers.length; i++) {
      const t = m.timers[i];
      if (t.dead) continue;
      t.left -= dt;
      if (t.left <= 0) { t.dead = true; due.push(t); }
    }
    if (!due.length) return;
    m.timers = m.timers.filter(function (t) { return !t.dead; });
    for (let i = 0; i < due.length; i++) {
      if (current !== m || m.state !== 'playing') return;
      due[i].fn();
    }
  }

  function frame(m, now) {
    if (current !== m) return;
    m.raf = requestAnimationFrame(m.tick);
    let dt = (now - m.last) / 1000;
    m.last = now;
    if (!(dt > 0)) dt = 0; else if (dt > 0.05) dt = 0.05;
    if (m.state === 'playing') {
      if (m.timers.length) runTimers(m, dt);
      if (current === m && m.state === 'playing' && m.update) m.update(dt);
    }
    if (current !== m) return;
    m.clock += dt;
    if (m.dirty && now - m.flushedAt > 2000) flushCareer(m); // save tracked numbers as play goes on
    if (m.draw) {
      for (let i = 0; i < m.views.length; i++) {
        const v = m.views[i];
        v.ctx.setTransform(v.canvas.width / v.w, 0, 0, v.canvas.height / v.h, 0, 0);
      }
      m.draw(dt, m.clock);
    }
  }

  /* ----- mounting ----- */
  function refit(m) {
    for (let i = 0; i < m.fitters.length; i++) {
      try { m.fitters[i](); } catch (e) { /* keep fitting the rest */ }
    }
  }
  // The stage fills whatever is left of the window under the play bar.
  function sizeStage() {
    if (!current) return;
    let pad = 0;
    try { pad = parseFloat(getComputedStyle(document.documentElement).paddingBottom) || 0; } catch (e) { pad = 0; }
    const top = els.wrap.getBoundingClientRect().top + (window.scrollY || 0);
    els.wrap.style.height = Math.max(300, Math.floor(window.innerHeight - top - pad - 16)) + 'px';
    refit(current);
  }

  function mount(def) {
    homeScroll = window.scrollY || 0;
    thumbStops.forEach(function (stop) { stop(); });
    els.home.hidden = true;
    els.play.hidden = false;
    els.page.classList.add('playing');
    els.play.style.setProperty('--cab', 'var(--c-' + def.color + ')');
    els.title.textContent = def.title;
    els.stats.textContent = '';
    els.stage.textContent = '';
    hideOverlay();
    window.scrollTo(0, 0);
    store.set('last', def.id);

    const m = {
      def: def, state: 'intro', instance: {},
      timers: [], cleanups: [], fitters: [], views: [], keyDown: [], keyUp: [], keys: new Set(),
      statEls: {}, bestEl: null, update: null, draw: null,
      raf: 0, tick: null, last: performance.now(), clock: 0, observer: null,
      career: careerOf(def), baseline: {}, broken: {}, dirty: false, flushedAt: performance.now(), statsBack: null
    };
    current = m;
    setBestPill(m);
    sizeStage();
    try { m.instance = def.create(makeApi(m)) || {}; } catch (err) { m.instance = {}; if (window.console) console.error(err); }
    sizeStage(); // the game has just added its readouts, which can make the play bar taller
    if (window.ResizeObserver) {
      m.observer = new ResizeObserver(function () { if (current === m) refit(m); });
      m.observer.observe(els.stage);
    }
    showIntro(m);
    syncTools(m);
    m.tick = function (now) { frame(m, now); };
    m.raf = requestAnimationFrame(m.tick);
  }

  function unmount() {
    const m = current;
    if (!m) return;
    flushCareer(m);
    current = null;
    cancelAnimationFrame(m.raf);
    clearTimeout(focusTimer);
    m.cleanups.forEach(function (off) { try { off(); } catch (e) { /* already gone */ } });
    try { if (m.instance.destroy) m.instance.destroy(); } catch (e) { /* nothing to clean */ }
    if (m.observer) m.observer.disconnect();
    hideOverlay();
    els.stage.textContent = '';
    els.stats.textContent = '';
  }

  function showHome() {
    els.play.hidden = true;
    els.home.hidden = false;
    els.page.classList.remove('playing');
    refreshHome();
    window.scrollTo(0, homeScroll);
  }

  function syncHash(def) {
    const want = def ? '#' + def.id : '';
    try { if (location.hash !== want) location.hash = want; } catch (e) { /* the page works without a hash */ }
  }

  function go(id) {
    let def = null;
    for (let i = 0; i < games.length; i++) if (games[i].id === id) def = games[i];
    const here = current ? current.def : null;
    if (here !== def) {
      if (current) unmount();
      if (def) mount(def); else showHome();
    }
    syncHash(def);
  }

  /* ----- boot ----- */
  function boot() {
    const $ = function (id) { return document.getElementById(id); };
    els = {
      page: $('page'), home: $('home'), play: $('play'), shelf: $('shelf'), board: $('board-list'), surprise: $('surprise'),
      ledger: $('ledger'), back: $('back'), title: $('play-title'), stats: $('stats'), restart: $('restart'), pause: $('pause'),
      sheetBtn: $('stats-btn'), wrap: $('stage-wrap'), stage: $('stage'), overlay: $('overlay')
    };
    buildHome();
    refreshHome();
    syncSound();

    els.surprise.addEventListener('click', function () {
      const last = store.get('last', '');
      const pool = games.filter(function (g) { return g.id !== last; });
      const pickFrom = pool.length ? pool : games;
      if (pickFrom.length) go(util.pick(pickFrom).id);
    });
    els.back.addEventListener('click', function () { go(''); });
    els.restart.addEventListener('click', function () { if (current) startGame(current); });
    els.pause.addEventListener('click', function () {
      if (!current) return;
      if (current.state === 'playing') pauseGame(current); else resumeGame(current);
    });
    els.sheetBtn.addEventListener('click', function () { if (current) showStats(current); });
    window.addEventListener('pagehide', function () { flushCareer(current); });
    const toggles = document.querySelectorAll('.sound-toggle');
    for (let i = 0; i < toggles.length; i++) {
      toggles[i].addEventListener('click', function () {
        sound.setMuted(!sound.isMuted());
        sound.resume();
        syncSound();
        sound.click();
      });
    }

    window.addEventListener('pointerdown', function () { sound.resume(); }, true);
    window.addEventListener('keydown', function (e) {
      const m = current;
      if (!m) return;
      if (e.key === 'Escape') {
        if (m.state === 'playing') pauseGame(m); else if (m.state === 'paused') resumeGame(m);
        e.preventDefault();
        return;
      }
      if (m.state !== 'playing' || e.ctrlKey || e.metaKey || e.altKey) return;
      sound.resume();
      // While playing, Space and Enter belong to the game, so they must not press a toolbar button
      // that happens to have focus. A focused control inside the game itself still gets them.
      if (PRESSES[e.code] && els.stage.contains(document.activeElement)) return;
      if (SCROLLS[e.code] || PRESSES[e.code]) e.preventDefault();
      m.keys.add(e.code);
      for (let i = 0; i < m.keyDown.length; i++) m.keyDown[i](e);
    });
    window.addEventListener('keyup', function (e) {
      const m = current;
      if (!m) return;
      m.keys.delete(e.code);
      if (m.state !== 'playing') return;
      if (PRESSES[e.code] && els.stage.contains(document.activeElement)) return;
      if (SCROLLS[e.code] || PRESSES[e.code]) e.preventDefault();
      for (let i = 0; i < m.keyUp.length; i++) m.keyUp[i](e);
    });
    window.addEventListener('blur', function () { if (current) current.keys.clear(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && current) { pauseGame(current); flushCareer(current); }
    });
    window.addEventListener('resize', sizeStage);
    // The play bar wraps onto more rows as readouts appear or grow; keep the stage fitted under it.
    if (window.ResizeObserver) new ResizeObserver(function () { if (current) sizeStage(); }).observe(els.play.querySelector('.playbar'));
    window.addEventListener('hashchange', function () { go((location.hash || '').replace(/^#/, '')); });

    try {
      if (document.fonts && document.fonts.load) {
        document.fonts.load(font(16, 'data'));
        document.fonts.load(font(16, 'display'));
      }
    } catch (e) { /* fallback fonts are fine */ }
  }

  function start(data) {
    if (booted) return;
    booted = true;
    boot();
    const want = (data && typeof data.game === 'string' && data.game) || (location.hash || '').replace(/^#/, '');
    if (want) go(want);
  }

  function init() {
    // When this page is hosted somewhere that can hot-swap it, hand back the open game.
    let hot = null;
    try { hot = window.claude && window.claude.hot; } catch (e) { hot = null; }
    try {
      if (hot && typeof hot.snapshot === 'function') hot.snapshot(function () { return { game: current ? current.def.id : '' }; });
    } catch (e) { /* optional */ }
    try {
      if (hot && typeof hot.ready === 'function') {
        hot.ready(start);
        setTimeout(function () { start({}); }, 1200);
        return;
      }
    } catch (e) { /* fall through to a plain start */ }
    start((hot && hot.data) || {});
  }

  Arcade.debug = { current: function () { return current; }, go: go };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
