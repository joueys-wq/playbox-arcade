/* Knucklebones: a dice duel. Stack matching dice to multiply them, and knock your rival's off the board. */
(function () {
  'use strict';
  const A = window.Arcade, U = A.util, C = A.colors;

  // A column scores each die times how many dice of that value share the column.
  function colScore(col) {
    const n = {};
    let s = 0;
    col.forEach(function (v) { n[v] = (n[v] || 0) + 1; });
    col.forEach(function (v) { s += v * n[v]; });
    return s;
  }
  function total(board) { return colScore(board[0]) + colScore(board[1]) + colScore(board[2]); }
  function full(board) { return board[0].length >= 3 && board[1].length >= 3 && board[2].length >= 3; }

  // Places die v in column c. Returns fresh copies: [the placer's board, the other board].
  function place(mine, theirs, c, v) {
    const m = mine.map(function (col) { return col.slice(); });
    const t = theirs.map(function (col) { return col.slice(); });
    m[c].push(v);
    t[c] = t[c].filter(function (x) { return x !== v; });
    return [m, t];
  }

  // The rival's brain: for each column, average over every roll you might get next, assuming you
  // answer with your best move. Now and then it simply plays a hunch, so it can be beaten.
  function choose(foe, you, v, rnd) {
    const legal = [0, 1, 2].filter(function (c) { return foe[c].length < 3; });
    if (rnd() < 0.12) return legal[Math.floor(rnd() * legal.length)];
    let best = -Infinity, picks = [];
    legal.forEach(function (c) {
      const next = place(foe, you, c, v), f = next[0], y = next[1];
      let value;
      if (full(f) || full(y)) {
        const d = total(f) - total(y);
        value = d + (d > 0 ? 100 : d < 0 ? -100 : 0);
      } else {
        let sum = 0;
        for (let roll = 1; roll <= 6; roll++) {
          let worst = Infinity;
          for (let pc = 0; pc < 3; pc++) {
            if (y[pc].length >= 3) continue;
            const reply = place(y, f, pc, roll);
            worst = Math.min(worst, total(reply[1]) - total(reply[0]));
          }
          sum += worst;
        }
        value = sum / 6;
      }
      if (value > best + 1e-9) { best = value; picks = [c]; }
      else if (Math.abs(value - best) <= 1e-9) picks.push(c);
    });
    return picks[Math.floor(rnd() * picks.length)];
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function dieEl(v) {
    const d = el('span', 'die');
    d.dataset.v = v;
    for (let i = 0; i < 9; i++) d.appendChild(document.createElement('i'));
    return d;
  }
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function drawDie(ctx, x, y, s, v, color) {
    U.rr(ctx, x, y, s, s, s * 0.16);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#17143A';
    PIPS[v].forEach(function (p) {
      ctx.beginPath();
      ctx.arc(x + s * (0.25 + 0.25 * (p % 3)), y + s * (0.25 + 0.25 * Math.floor(p / 3)), s * 0.085, 0, U.TAU);
      ctx.fill();
    });
  }

  function create(api) {
    const root = el('div', 'kb');
    const sides = {};
    ['foe', 'you'].forEach(function (who) {
      const side = el('div', 'kb-side kb-' + who);
      const info = el('div', 'kb-info');
      info.appendChild(el('span', 'kb-name', who === 'you' ? 'You' : 'Rival'));
      const tot = el('span', 'kb-total', '0');
      info.appendChild(tot);
      const board = el('div', 'kb-board');
      const cols = [];
      for (let c = 0; c < 3; c++) {
        const col = el(who === 'you' ? 'button' : 'div', 'kb-col');
        const slots = [el('span', 'kb-slot'), el('span', 'kb-slot'), el('span', 'kb-slot')];
        const score = el('span', 'kb-colscore');
        slots.forEach(function (s) { col.appendChild(s); });
        col.appendChild(score);
        if (who === 'you') {
          col.type = 'button';
          col.setAttribute('aria-label', 'Column ' + (c + 1));
          col.addEventListener('click', function () { play(c); col.blur(); });
        }
        board.appendChild(col);
        cols.push({ el: col, slots: slots, score: score });
      }
      if (who === 'foe') { side.appendChild(info); side.appendChild(board); }
      else { side.appendChild(board); side.appendChild(info); }
      sides[who] = { el: side, cols: cols, total: tot };
    });
    const mid = el('div', 'kb-mid');
    const rollBox = el('div', 'kb-roll');
    const msg = el('p', 'kb-msg', '');
    mid.appendChild(rollBox);
    mid.appendChild(msg);
    root.appendChild(sides.foe.el);
    root.appendChild(mid);
    root.appendChild(sides.you.el);
    api.stage.appendChild(root);

    let boards = { you: [[], [], []], foe: [[], [], []] };
    let turn = 'you', die = 1, busy = true, over = false, smash = null, fresh = null, rollDie = null;
    let knockedRun = 0; // rival dice knocked out in this duel

    function hud() {
      api.stat('Record', api.career('wins', 0) + ' won, ' + api.career('losses', 0) + ' lost');
      api.stat('Knocked out', knockedRun);
    }
    function render() {
      ['foe', 'you'].forEach(function (who) {
        const b = boards[who];
        for (let c = 0; c < 3; c++) {
          const col = sides[who].cols[c], dice = b[c], counts = {};
          dice.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
          for (let s = 0; s < 3; s++) {
            const slot = col.slots[s];
            slot.textContent = '';
            if (s >= dice.length) continue;
            const v = dice[s], d = dieEl(v);
            if (counts[v] === 2) d.classList.add('x2'); else if (counts[v] >= 3) d.classList.add('x3');
            if (smash && smash.who === who && smash.col === c && smash.v === v) d.classList.add('smash');
            if (fresh && fresh.who === who && fresh.col === c && s === dice.length - 1) d.classList.add('pop');
            slot.appendChild(d);
          }
          col.score.textContent = dice.length ? String(colScore(dice)) : '';
          if (who === 'you') col.el.disabled = busy || over || turn !== 'you' || dice.length >= 3;
        }
        sides[who].total.textContent = String(total(b));
        sides[who].el.classList.toggle('live', turn === who && !over);
      });
    }
    function showRoll(v, tumbling) {
      rollBox.textContent = '';
      rollDie = null;
      if (!v) return;
      rollDie = dieEl(v);
      if (tumbling) rollDie.classList.add('tumble');
      rollBox.appendChild(rollDie);
    }

    function beginTurn(who) {
      turn = who;
      busy = true;
      smash = null;
      fresh = null;
      die = U.randInt(1, 6);
      msg.textContent = who === 'you' ? 'Your roll...' : 'Rival rolls...';
      showRoll(U.randInt(1, 6), true);
      render();
      let n = 0;
      const spin = function () {
        n++;
        if (n < 5) {
          rollDie.dataset.v = U.randInt(1, 6);
          api.sfx.tone(300 + n * 40, 0.03, { type: 'square', vol: 0.05 });
          api.after(0.09, spin);
          return;
        }
        showRoll(die, false);
        api.sfx.click();
        if (turn === 'you') {
          busy = false;
          msg.textContent = 'You rolled a ' + die + '. Pick a column.';
          render();
        } else {
          msg.textContent = 'Rival rolled a ' + die + '.';
          api.after(0.75, function () { drop('foe', choose(boards.foe, boards.you, die, Math.random)); });
        }
      };
      api.after(0.09, spin);
    }

    function drop(who, c) {
      const other = who === 'you' ? 'foe' : 'you';
      busy = true;
      boards[who][c].push(die);
      if (who === 'you' && boards.you[c].filter(function (v) { return v === die; }).length === 3) api.tally('triples');
      fresh = { who: who, col: c };
      const knocked = boards[other][c].filter(function (v) { return v === die; }).length;
      showRoll(0, false);
      if (knocked) {
        if (who === 'you') { knockedRun += knocked; api.tally('knocked', knocked); hud(); }
        smash = { who: other, col: c, v: die };
        msg.textContent = (who === 'you' ? 'You knock out ' : 'Rival knocks out ') + (knocked === 1 ? 'a ' + die + '.' : knocked + ' dice.');
        api.sfx.boom();
      } else {
        msg.textContent = '';
        api.sfx.tone(220, 0.08, { type: 'triangle', to: 160, vol: 0.16 });
      }
      render();
      api.after(knocked ? 0.42 : 0.26, function () {
        if (knocked) boards[other][c] = boards[other][c].filter(function (v) { return v !== die; });
        smash = null;
        fresh = null;
        render();
        if (full(boards.you) || full(boards.foe)) api.after(0.7, finish);
        else api.after(0.3, function () { beginTurn(other); });
      });
    }
    function play(c) {
      if (!api.playing || busy || over || turn !== 'you' || boards.you[c].length >= 3) return;
      drop('you', c);
    }
    function finish() {
      const y = total(boards.you), f = total(boards.foe);
      over = true;
      if (y > f) {
        const run = api.career('run', 0) + 1;
        api.tally('wins');
        api.keep('run', run);
        api.high('streak', run);
        api.high('margin', y - f);
      } else {
        api.tally(y < f ? 'losses' : 'draws');
        api.keep('run', 0);
      }
      render();
      hud();
      if (y > f) api.sfx.win(); else api.sfx.lose();
      api.gameOver({
        title: y > f ? 'You win' : y < f ? 'Rival wins' : 'A draw',
        score: y > f ? y : undefined,
        lines: ['You ' + y + ', rival ' + f + '.', 'Record: ' + api.career('wins', 0) + ' won, ' + api.career('losses', 0) + ' lost' + (api.career('draws', 0) ? ', ' + api.career('draws', 0) + ' drawn.' : '.')]
      });
    }

    api.onKey(function (e) {
      if (e.repeat) return;
      if (e.code === 'Digit1' || e.code === 'Numpad1') play(0);
      else if (e.code === 'Digit2' || e.code === 'Numpad2') play(1);
      else if (e.code === 'Digit3' || e.code === 'Numpad3') play(2);
    });
    api.onResize(function (w, h) {
      // a short, wide screen (a phone on its side) puts the two boards next to each other
      const wide = h < 440 && w > h * 1.4;
      root.classList.toggle('wide', wide);
      const d = wide ? Math.min((h - 54) / 3.6, (w - 210) / 7.9) : Math.min((h - 96) / 8.4, (w - 30) / 3.9);
      root.style.setProperty('--die', U.clamp(Math.floor(d), 22, 72) + 'px');
    });
    api.loop(null, null);

    // carry over a win/loss record saved before the stat sheet existed
    const old = api.load('record', null);
    if (old && typeof old === 'object' && api.career('wins') === undefined && api.career('losses') === undefined && api.career('draws') === undefined) {
      if (Number(old.w)) api.keep('wins', Number(old.w));
      if (Number(old.l)) api.keep('losses', Number(old.l));
      if (Number(old.d)) api.keep('draws', Number(old.d));
    }
    render();
    hud();

    return {
      start: function () {
        boards = { you: [[], [], []], foe: [[], [], []] };
        over = false;
        knockedRun = 0;
        showRoll(0, false);
        hud();
        beginTurn(Math.random() < 0.5 ? 'you' : 'foe');
      },
      peek: function () { return { boards: boards, turn: turn, die: die, busy: busy, over: over, you: total(boards.you), foe: total(boards.foe) }; }
    };
  }

  A.register({
    id: 'knucklebones',
    title: 'Knucklebones',
    tagline: 'A dice duel of luck and spite against a cunning rival.',
    genre: 'Dice',
    input: 'Mouse or keys',
    color: 'violet',
    stats: [
      { key: 'wins', label: 'Duels won', kind: 'tally', headline: true },
      { key: 'losses', label: 'Duels lost', kind: 'tally' },
      { key: 'draws', label: 'Duels drawn', kind: 'tally' },
      { key: 'streak', label: 'Longest winning streak', kind: 'high' },
      { key: 'margin', label: 'Biggest winning margin', kind: 'high', unit: ' points' },
      { key: 'knocked', label: 'Rival dice knocked out', kind: 'tally' },
      { key: 'triples', label: 'Triples built', kind: 'tally' }
    ],
    scoreLabel: 'Winning total',
    how: [
      'You and your rival take turns rolling one die and placing it in a column of your own board.',
      'Matching dice in a column multiply: two 4s score 16, three score 36.',
      'Placing a die knocks every die of that value out of the rival\'s matching column.',
      'When either board fills up, the higher total wins. Click a column or press 1, 2 or 3.'
    ],
    logic: { colScore: colScore, total: total, full: full, place: place, choose: choose },
    thumb: function (ctx, w, h, t) {
      const s = 26, g = 4, ox = (w - (3 * s + 2 * g)) / 2;
      const foe = [[5, 5], [2], [6, 1, 3]], you = [[4, 4, 4], [6, 2], [3]];
      const colour = function (col, v) {
        const n = col.filter(function (x) { return x === v; }).length;
        return n >= 3 ? C.pink : n === 2 ? C.sun : C.ink;
      };
      for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) {
          const x = ox + c * (s + g), yTop = 94 - (r + 1) * (s + g) + g, yBot = 106 + r * (s + g);
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          U.rr(ctx, x, yTop, s, s, 5); ctx.fill();
          U.rr(ctx, x, yBot, s, s, 5); ctx.fill();
          if (foe[c][r]) drawDie(ctx, x, yTop, s, foe[c][r], colour(foe[c], foe[c][r]));
          if (you[c][r]) drawDie(ctx, x, yBot, s, you[c][r], colour(you[c], you[c][r]));
        }
      }
      const face = 1 + Math.floor(t * 3) % 6, bob = Math.sin(t * 6) * 3;
      drawDie(ctx, 44, 85 + bob, 30, face, C.ink);
    },
    create: create
  });
})();
