/* Keystorm: words fall out of the sky, and typing them is the only defence. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors, TAU = U.TAU;

  const W = 900, H = 560, GROUND = 504, TURRET_X = W / 2;
  const FONT = A.font(19, 'data');

  const WORDS = (
    'cat dog sun map key box jet owl ice fox gem hat ink jar kit log net oak pen rug sky top van wax yak zip arc bee cup dot elf fig gum hop ivy jam lab mud nut orb pod ray sap tin vow web zap bay cod dew ash ' +
    'moon star fire wind rain snow leaf tree rock sand wave bird fish frog wolf bear lion deer hawk crow gold iron salt milk rice corn lamp door wall roof road path ship boat sail kite drum harp bell coin ring king jump kick spin glow dark mist haze zone quiz jazz lava peak dune reef cave nest wing claw ' +
    'storm cloud flame spark light night comet orbit laser pixel robot magic sword armor tower spell ghost witch giant dwarf eagle tiger zebra shark whale snake mouse horse sheep camel apple lemon grape mango peach bread honey sugar spice juice piano flute radio video photo paint brush paper stone metal glass water river ocean beach coast field plant quick blaze crane frost glide joker knife vivid waltz yacht ' +
    'planet rocket meteor galaxy nebula cosmic fusion plasma shield cannon turret bullet target danger rescue escape hunter wizard dragon knight castle bridge tunnel temple forest jungle desert island harbor garden flower branch autumn winter spring summer breeze shadow mirror candle hammer anchor bottle basket button pocket jacket ribbon silver bronze copper marble rhythm puzzle riddle voyage zenith quartz oxygen hybrid jigsaw ' +
    'thunder lantern crystal phantom voyager eclipse gravity horizon monsoon tornado volcano glacier prairie harvest journey mystery fantasy emperor captain pilgrim warrior villain monster giraffe dolphin penguin panther buffalo raccoon lobster octopus sparrow peacock pumpkin avocado coconut popcorn biscuit pancake noodles mustard vanilla whisper balance compass network digital circuit battery antenna monitor printer scanner charger blanket curtain cushion chimney freedom courage justice harmony ' +
    'asteroid starship molecule particle spectrum infinity darkness daylight sunshine moonbeam twilight midnight blizzard mountain treasure backpack campfire firewall keyboard joystick software hardware internet password platform champion guardian sorcerer elephant kangaroo flamingo scorpion mosquito dinosaur squirrel hedgehog cinnamon broccoli sandwich lemonade umbrella calendar notebook envelope marathon festival carnival fountain aquarium building electric magnetic velocity momentum triangle parallel absolute creative powerful flexible ' +
    'adventure lightning blueprint labyrinth telescope satellite avalanche hurricane cathedral astronaut alligator butterfly crocodile porcupine chameleon jellyfish dandelion raspberry pineapple chocolate spaghetti orchestra saxophone xylophone algorithm invisible dangerous brilliant wonderful legendary explosion challenge celebrate discovery knowledge'
  ).split(' ');

  // Words grouped by their real length, so a typo in the list above can never mislabel one.
  const POOL = {};
  WORDS.forEach(function (w) { (POOL[w.length] = POOL[w.length] || []).push(w); });

  // The storm builds: longer words, shorter gaps, faster falls.
  function lengthRange(t) { return t < 15 ? [3, 4] : t < 40 ? [3, 5] : t < 75 ? [4, 6] : t < 115 ? [4, 7] : t < 160 ? [5, 8] : [5, 9]; }
  function spawnGap(t) { return Math.max(0.7, 2.2 - t * 0.009); }
  function fallSpeed(t, len) { return (26 + Math.min(46, t * 0.3)) * (1 - (len - 3) * 0.045); }
  function alive(w) { return !w.dead; }

  function plate(ctx, text, typed, x, y, o) {
    ctx.font = FONT;
    const tw = ctx.measureText(text).width, x0 = x - tw / 2;
    U.rr(ctx, x0 - 10, y - 16, tw + 20, 32, 6);
    ctx.fillStyle = o.locked ? U.alpha(C.sun, 0.18) : U.alpha(C.bg2, 0.92);
    ctx.fill();
    ctx.lineWidth = o.locked ? 2 : 1.5;
    ctx.strokeStyle = o.wrong ? C.coral : o.locked ? C.sun : o.gold ? U.alpha(C.sun, 0.8) : C.line;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const done = text.slice(0, typed);
    ctx.fillStyle = U.alpha(C.ink, 0.28);
    ctx.fillText(done, x0, y + 1);
    ctx.fillStyle = o.gold ? C.sun : C.ink;
    ctx.fillText(text.slice(typed), x0 + ctx.measureText(done).width, y + 1);
    return tw;
  }

  function create(api) {
    const view = api.canvas(W, H), ctx = view.ctx;
    const sparks = api.Particles(), pops = api.Floaters(), stars = api.Stars(80, W, GROUND);
    let words = [], target = null, bolts = [];
    let lives = 3, score = 0, streak = 0, bestStreak = 0, time = 0, spawnT = 0, goldT = 0;
    let hits = 0, presses = 0, shake = 0, flash = 0;
    let hudT = 0;
    const hearts = api.lives('Lives');

    function multiplier() { return 1 + Math.min(4, Math.floor(streak / 15)); }
    function hud() {
      api.stat('Score', score);
      api.stat('Streak', streak + (multiplier() > 1 ? '  x' + multiplier() : ''));
      api.stat('Speed', time > 5 ? Math.round(hits / 5 / (time / 60)) + ' wpm' : '-- wpm');
      api.stat('Accuracy', (presses ? Math.round(100 * hits / presses) : 100) + '%');
      hearts.set(lives, 3);
    }
    function reset() {
      words = [];
      target = null;
      bolts = [];
      lives = 3;
      score = 0;
      streak = 0;
      bestStreak = 0;
      time = 0;
      spawnT = 0.5;
      goldT = 20;
      hits = 0;
      presses = 0;
      shake = 0;
      flash = 0;
      sparks.clear();
      pops.clear();
      hud();
    }

    function spawn(gold) {
      const range = gold ? [5, 6] : lengthRange(time);
      const used = {};
      words.forEach(function (w) { used[w.text[0]] = true; });
      let text = null;
      for (let i = 0; i < 40 && !text; i++) {
        const pool = POOL[U.randInt(range[0], range[1])];
        if (!pool) continue;
        const cand = U.pick(pool);
        if (used[cand[0]] && i < 30) continue; // keep first letters unique for as long as that is possible
        if (words.some(function (w) { return w.text === cand; })) continue;
        text = cand;
      }
      if (!text) return;
      ctx.font = FONT;
      const tw = ctx.measureText(text).width;
      let x = W / 2;
      for (let i = 0; i < 8; i++) {
        x = U.rand(40 + tw / 2, W - 40 - tw / 2);
        const cx = x;
        if (words.every(function (w) { return w.y > 70 || Math.abs(w.x - cx) > (w.w + tw) / 2 + 26; })) break;
      }
      words.push({ text: text, typed: 0, x: x, y: -18, w: tw, vy: fallSpeed(time, text.length) * (gold ? 0.8 : 1), gold: !!gold, wrong: 0, dead: false });
    }

    function destroy(w, chained) {
      const pts = w.text.length * 10 * (chained ? 1 : multiplier());
      score += pts;
      pops.add(w.x, w.y - 24, '+' + pts, w.gold ? C.sun : C.mint, 14);
      sparks.burst(w.x, w.y, { count: 12 + w.text.length * 2, color: w.gold ? C.sun : C.sky, speed: 190 });
      w.dead = true;
      if (target === w) target = null;
      api.tally('words');
      if (w.gold && !chained) api.tally('gold');
      if (w.gold && !chained) { // a gold word clears the whole sky
        flash = 0.5;
        api.sfx.boom();
        words.forEach(function (o) { if (!o.dead) destroy(o, true); });
      }
    }
    function miss() {
      streak = 0;
      if (target) target.wrong = 0.18;
      api.sfx.tone(130, 0.07, { type: 'square', vol: 0.07 });
      hud();
    }
    function strike(w) {
      w.typed++;
      hits++;
      api.tally('keys');
      streak++;
      if (streak > bestStreak) bestStreak = streak;
      bolts.push({ x: w.x, y: w.y, age: 0 });
      api.sfx.tone(500 + w.typed * 45, 0.05, { type: 'square', vol: 0.06 });
      if (w.typed >= w.text.length) {
        destroy(w, false);
        words = words.filter(alive);
        api.sfx.good();
      }
      hud();
    }

    api.onKey(function (e) {
      if (e.key === 'Backspace') { // let go of the word you are locked on
        e.preventDefault();
        if (target) { target.typed = 0; target = null; }
        return;
      }
      if (e.key.length !== 1) return;
      const k = e.key.toLowerCase();
      if (k < 'a' || k > 'z') return;
      e.preventDefault();
      presses++;
      if (!target) {
        // lock on to the lowest word that starts with this letter
        let pick = null;
        for (let i = 0; i < words.length; i++) {
          const w = words[i];
          if (w.text[0] === k && (!pick || w.y > pick.y)) pick = w;
        }
        if (!pick) { miss(); return; }
        target = pick;
      } else if (target.text[target.typed] !== k) {
        miss();
        return;
      }
      strike(target);
    });

    function update(dt) {
      time += dt;
      spawnT -= dt;
      if (spawnT <= 0) { spawn(false); spawnT = spawnGap(time) * U.rand(0.8, 1.2); }
      goldT -= dt;
      if (goldT <= 0) { spawn(true); goldT = U.rand(20, 28); }

      let landed = false;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        w.y += w.vy * dt;
        if (w.wrong > 0) w.wrong -= dt;
        if (w.y >= GROUND - 14) {
          w.dead = true;
          landed = true;
          if (target === w) target = null;
          lives--;
          streak = 0;
          shake = 10;
          sparks.burst(w.x, GROUND, { count: 26, color: C.coral, speed: 220, angle: -Math.PI / 2, spread: 2.4, gravity: 300 });
          api.sfx.boom();
        }
      }
      if (landed) { words = words.filter(alive); hud(); }
      for (let i = bolts.length - 1; i >= 0; i--) {
        bolts[i].age += dt;
        if (bolts[i].age > 0.12) bolts.splice(i, 1);
      }
      sparks.update(dt);
      pops.update(dt);
      shake = Math.max(0, shake - 40 * dt);
      flash = Math.max(0, flash - dt);
      hearts.update(dt);
      hudT -= dt;
      if (hudT <= 0) { hudT = 0.5; hud(); } // keeps the live typing speed fresh

      if (lives <= 0) {
        const wpm = time > 1 ? Math.round(hits / 5 / (time / 60)) : 0;
        const acc = presses ? Math.round(100 * hits / presses) : 100;
        if (time >= 20) api.high('wpm', wpm);
        if (presses >= 40) api.high('accuracy', acc);
        api.high('streak', bestStreak);
        api.high('stand', Math.floor(time));
        api.gameOver({ title: 'The sky fell', score: score, lines: [wpm + ' words per minute at ' + acc + '% accuracy.', 'Longest streak: ' + bestStreak + ' keys.'] });
      }
    }

    function draw(dt, t) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      if (shake > 0) ctx.translate(U.rand(-shake, shake) * 0.5, U.rand(-shake, shake) * 0.5);
      stars.draw(ctx, t);

      // ground, hearts and turret
      ctx.fillStyle = C.bg2;
      ctx.fillRect(-20, GROUND, W + 40, H - GROUND + 20);
      ctx.fillStyle = C.line;
      ctx.fillRect(-20, GROUND, W + 40, 3);
      hearts.draw(ctx, 22, GROUND + 29, 22);
      ctx.fillStyle = C.soft;
      ctx.font = api.font(12, 'data');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(multiplier() > 1 ? 'STREAK BONUS x' + multiplier() : 'TYPE TO FIRE', W - 22, GROUND + 29);

      const aimAt = target || null;
      const ang = aimAt ? Math.atan2(aimAt.y - GROUND, aimAt.x - TURRET_X) : -Math.PI / 2;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(TURRET_X, GROUND - 4); ctx.lineTo(TURRET_X + Math.cos(ang) * 24, GROUND - 4 + Math.sin(ang) * 24); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = C.sun;
      ctx.beginPath(); ctx.arc(TURRET_X, GROUND, 15, Math.PI, TAU); ctx.fill();

      for (let i = 0; i < bolts.length; i++) {
        const b = bolts[i];
        ctx.strokeStyle = U.alpha(C.sun, 1 - b.age / 0.12);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(TURRET_X, GROUND - 6); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        w.w = plate(ctx, w.text, w.typed, w.x, w.y, { locked: w === target, gold: w.gold, wrong: w.wrong > 0 });
      }
      sparks.draw(ctx);
      pops.draw(ctx);
      ctx.restore();

      if (flash > 0) {
        ctx.fillStyle = U.alpha(C.sun, flash * 0.5);
        ctx.fillRect(0, 0, W, H);
      }
      if (api.touch && time < 6) {
        ctx.fillStyle = U.alpha(C.ink, 0.8);
        ctx.font = api.font(15, 'body');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('This one needs a real keyboard.', W / 2, H / 2);
      }
    }

    api.loop(update, draw);
    reset();

    return {
      start: reset,
      peek: function () {
        return { words: words.map(function (w) { return { text: w.text, typed: w.typed, y: Math.round(w.y), gold: w.gold }; }), target: target ? target.text : null, lives: lives, score: score, streak: streak, time: time };
      }
    };
  }

  A.register({
    id: 'keystorm',
    title: 'Keystorm',
    tagline: 'Words fall from the sky. Type them before they land.',
    genre: 'Typing',
    input: 'Keyboard',
    color: 'sun',
    stats: [
      { key: 'words', label: 'Words shot down', kind: 'tally' },
      { key: 'keys', label: 'Keys struck', kind: 'tally' },
      { key: 'wpm', label: 'Fastest typing', kind: 'high', unit: ' wpm', headline: true },
      { key: 'accuracy', label: 'Best accuracy', kind: 'high', unit: '%' },
      { key: 'streak', label: 'Longest streak', kind: 'high', unit: ' keys' },
      { key: 'gold', label: 'Gold words fired', kind: 'tally' },
      { key: 'stand', label: 'Longest storm weathered', kind: 'high', format: U.clock }
    ],
    how: [
      'Type a falling word to shoot it down. The first letter locks on.',
      'Finish the word you are locked on, or press Backspace to let it go.',
      'A long run of correct keys multiplies your score.',
      'Gold words clear the whole sky. Every word that lands costs a heart, and you have three.'
    ],
    logic: { WORDS: WORDS, POOL: POOL, lengthRange: lengthRange, spawnGap: spawnGap, fallSpeed: fallSpeed },
    thumb: function (ctx, w, h, t) {
      const drop = (t * 14) % 30;
      ctx.fillStyle = C.bg2;
      ctx.fillRect(0, 172, w, 28);
      ctx.fillStyle = C.line;
      ctx.fillRect(0, 172, w, 2);
      const typed = Math.floor((t * 3) % 6);
      ctx.strokeStyle = U.alpha(C.sun, 0.9);
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(160, 168); ctx.lineTo(118, 96 + drop); ctx.stroke();
      plate(ctx, 'comet', Math.min(5, typed), 118, 96 + drop, { locked: true });
      plate(ctx, 'jazz', 0, 236, 52 + drop * 0.7, {});
      plate(ctx, 'nebula', 0, 72, 30 + drop * 0.5, { gold: true });
      ctx.fillStyle = C.sun;
      ctx.beginPath(); ctx.arc(160, 172, 11, Math.PI, TAU); ctx.fill();
    },
    create: create
  });
})();
