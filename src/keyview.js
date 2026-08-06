// The keyboard, drawn.
//
// Two boards over one table. The АГАТ board is the machine's own keyboard,
// transcribed from a photograph of its Клавиатура —
// https://www.agatcomp.ru/agat/Hardware/Key_Joy/KeyClassic/kbd15.jpg — and the
// PC board is the set of scancodes `keyboard.js` maps, which is where your
// fingers actually are. A host keypress lights a cap on either.
//
// What the photograph settles, and what the whole file rests on:
//
//   - A cap is a *code*, not a scancode. The real caps are dual-legend, Й over
//     J, Ю over @, Ч over ^. Those are one byte read in two character sets:
//     $40-$5F is ASCII `@A-Z[\]^_` and, shifted up by $20, the Agat-7 font's
//     upper-case Cyrillic in KOI-7 N2 order. РЕГ adds exactly $20 across the
//     whole letter block, which is why the two legends fit on one cap.
//   - So the host key that reaches a given cap changes with ЛАТ/РУС, and some
//     caps cannot be reached at all in one of them: РУС cannot type `' , / ;`
//     and ЛАТ cannot type Ю, Ч or Ъ. The board greys those out — which is the
//     whole reason it exists, since a game wanting a key you cannot find
//     otherwise gives no clue which one it is.
//   - The digit row is the ГОСТ one, and its legends were checked against the
//     character generator: the `4` cap's ¤ really is what the Agat-7 font draws
//     at $24, where ASCII has `$`.
//
// No DOM is touched at load: tools/harness.js evaluates every src/ module in a
// sandbox with no `document`, so the tables below stay testable there.
(function (AGAT) {
  'use strict';

  var K = AGAT.keyboard;

  // Code -> the glyph the Agat-7 draws for it. Lives in keyboard.js, next to the
  // table it indexes.
  var CHAR = K.CHAR;

  // The three kinds of cap, as the tables below spell them:
  //
  //   L(u)      a letter: unshifted `u`, shifted `u + $20`, and the shifted
  //             half — the Cyrillic one — painted on top, as the real caps are
  //   P(u, s)   punctuation: the unshifted legend on top, as the real caps have
  //   C(text)   a caption instead of legends, with one code or none at all
  function L(u) { return { u: u, s: u + 0x20, up: 's' }; }
  function P(u, s) { return { u: u, s: s, up: 'u' }; }
  function C(text, o) { o = o || {}; o.cap = text; return o; }

  // Which cap owns a code. УПР sends $81-$9F, which is the letter's own code
  // less $40 — the ASCII control relation — and no cap carries those directly,
  // so a Ctrl'd byte is shown on the letter it was made from. $88 is the
  // exception that needs no rule: it is already the ← cap's own code.
  function capCode(code) {
    code &= 0x7f;
    return (code >= 0x01 && code <= 0x1f) ? 0x40 + code : code;
  }

  // ---- the АГАТ board ------------------------------------------------------
  //
  // `w` is a cap's width in units and `gap` the space before it; `pad` is the
  // row's left indent, and the stagger is the real board's. `act` marks a cap
  // that does something other than send a byte: СБР resets, РУС and LAT switch
  // layout, УПР and РЕГ are the modifiers, and ПВТ, РЕД and the pad's `=` send
  // nothing the shipped table carries.

  var AGAT_MAIN = [
    { pad: 0, keys: [
      C('СБР', { act: 'reset', red: 1 }),
      P(0x3b, 0x2b), P(0x31, 0x21), P(0x32, 0x22), P(0x33, 0x23),
      P(0x34, 0x24), P(0x35, 0x25), P(0x36, 0x26), P(0x37, 0x27),
      P(0x38, 0x28), P(0x39, 0x29), { u: 0x30, up: 'u' }, P(0x2d, 0x3d),
      C('ПВТ', { act: 'none', red: 1, w: 1.5, gap: 0.2 }),
      C('↑', { code: 0x99, red: 1 }),
      C('РЕД', { act: 'none', red: 1 }),
    ] },
    { pad: 0.1, keys: [
      C('УПР', { act: 'ctrl', red: 1, w: 1.3 }),
      L(0x4a), L(0x43), L(0x55), L(0x4b), L(0x45), L(0x4e),
      L(0x47), L(0x5b), L(0x5d), L(0x5a), L(0x48), P(0x3a, 0x2a),
      C('←', { code: 0x88, red: 1, gap: 0.2 }),
      C('↓', { code: 0x9a, red: 1 }),
      C('→', { code: 0x95, red: 1 }),
    ] },
    { pad: 0.2, keys: [
      C('РУС', { act: 'layout', red: 1, w: 1.4 }),
      L(0x46), L(0x59), L(0x57), L(0x41), L(0x50), L(0x52),
      L(0x4f), L(0x4c), L(0x44), L(0x56), L(0x5c), P(0x2e, 0x3e),
      C('LAT', { act: 'layout', red: 1, gap: 0.1 }),
      C('↵', { code: 0x8d, red: 1, w: 1.6 }),
    ] },
    { pad: 0.4, keys: [
      C('РЕГ', { act: 'shift', red: 1, w: 1.6 }),
      L(0x51), L(0x5e), L(0x53), L(0x4d), L(0x49), L(0x54),
      L(0x58), L(0x42), L(0x40), P(0x2c, 0x3c), P(0x2f, 0x3f), L(0x5f),
      C('РЕГ', { act: 'shift', red: 1, w: 1.6, gap: 0.1 }),
    ] },
    { pad: 4.2, keys: [C('ПРОБЕЛ', { code: 0x20, w: 9 })] },
  ];

  // The pad's caps are numbered 1-9 top to bottom, where a PC numpad runs 7-9
  // first, and every one of them sends a control code rather than a digit.
  // Paired here by the digit printed on the cap, which is what someone pressing
  // Num 5 expects; the tooltip names the route either way.
  var AGAT_PAD = [
    { keys: [C('1', { code: 0x9d }), C('2', { code: 0x9e }), C('3', { code: 0x9f })] },
    { keys: [C('4', { code: 0x93 }), C('5', { code: 0x94 }), C('6', { code: 0x9c })] },
    { keys: [C('7', { code: 0x90 }), C('8', { code: 0x91 }), C('9', { code: 0x92 })] },
    { keys: [C('0', { code: 0x81 }), C('.', { code: 0x82 }), C('=', { act: 'none' })] },
    { gapTop: 1, keys: [C('F1', { code: 0x84, red: 1 }), C('F2', { code: 0x85, red: 1 }),
                        C('F3', { code: 0x86, red: 1 })] },
  ];

  // ---- the PC board --------------------------------------------------------
  //
  // Keyed by scancode: here the mapping is exact and there is nothing to look
  // up. F4-F12 are drawn because the keys are under your fingers, and they come
  // out dead because the table has nothing in them — which is the Agat having
  // only F1, F2 and F3.

  // The caption defaults to the key's own name, but the pad overrides it: in a
  // block of its own a cap reads better as `7` than as `Num 7`, while the
  // tooltips still need the long name to tell the two 7s apart.
  function S(name, o) {
    o = o || {}; o.scan = K.SCAN[name];
    if (o.cap === undefined) o.cap = K.keyName(o.scan, K.NORMAL);
    return o;
  }
  function X(name, o) {
    o = o || {}; o.scan = K.EXT_SCAN[name]; o.ext = 1;
    if (o.cap === undefined) o.cap = K.keyName(o.scan, K.EXT);
    return o;
  }
  function row(names) {
    var out = [], i;
    for (i = 0; i < names.length; i++) out.push(S(names[i]));
    return out;
  }

  var PC_MAIN = [
    { keys: [S('Escape', { w: 1.6 })].concat(
      row(['F1', 'F2', 'F3']), [S('F4', { gap: 0.25 })],
      row(['F5', 'F6', 'F7']), [S('F8', { gap: 0.25 })],
      row(['F9', 'F10', 'F11', 'F12'])) },
    { gapTop: 0.5, keys: row(['Backquote', 'Digit1', 'Digit2', 'Digit3',
      'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
      'Minus', 'Equal']).concat([S('Backspace', { w: 2 })]) },
    { keys: [S('Tab', { w: 1.5 })].concat(row(['KeyQ', 'KeyW', 'KeyE', 'KeyR',
      'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft',
      'BracketRight']), [S('Backslash', { w: 1.5 })]) },
    { keys: [C('Ctrl', { act: 'ctrl', w: 1.8 })].concat(row(['KeyA', 'KeyS',
      'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon',
      'Quote']), [S('Enter', { w: 2.2 })]) },
    { keys: [C('Shift', { act: 'shift', w: 2.3 })].concat(row(['KeyZ', 'KeyX',
      'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']),
      [C('Shift', { act: 'shift', w: 2.7 })]) },
    { pad: 1.5, keys: [C('ЛАТ/РУС', { act: 'layout', w: 2.4 }),
                       S('Space', { w: 8 })] },
  ];

  var PC_NAV = [
    { gapTop: 1.6, keys: [X('Insert', { w: 1.4 }), X('Home', { w: 1.4 }),
                          X('PageUp', { w: 1.4 })] },
    { keys: [X('Delete', { w: 1.4 }), X('End', { w: 1.4 }),
             X('PageDown', { w: 1.4 })] },
    { gapTop: 0.6, pad: 1, keys: [X('ArrowUp')] },
    { keys: [X('ArrowLeft'), X('ArrowDown'), X('ArrowRight')] },
  ];

  var PC_PAD = [
    { gapTop: 1.6, keys: [X('NumpadDivide', { cap: '/' }),
                          S('NumpadMultiply', { cap: '*' }),
                          S('NumpadSubtract', { cap: '-' }),
                          S('NumpadAdd', { cap: '+' })] },
    { keys: [S('Numpad7', { cap: '7' }), S('Numpad8', { cap: '8' }),
             S('Numpad9', { cap: '9' })] },
    { keys: [S('Numpad4', { cap: '4' }), S('Numpad5', { cap: '5' }),
             S('Numpad6', { cap: '6' })] },
    { keys: [S('Numpad1', { cap: '1' }), S('Numpad2', { cap: '2' }),
             S('Numpad3', { cap: '3' })] },
    { keys: [S('Numpad0', { cap: '0', w: 2 }),
             S('NumpadDecimal', { cap: '.' }),
             X('NumpadEnter', { cap: '⏎' })] },
  ];

  var VIEWS = {
    agat: [AGAT_MAIN, AGAT_PAD],
    pc: [PC_MAIN, PC_NAV, PC_PAD],
  };

  // ---- the view ------------------------------------------------------------

  // `el` is the container, `app` the App whose machine the caps type into.
  // `opts.onLayout` is called when a ЛАТ/РУС cap is clicked, so the page can
  // switch the machine and keep its own button in step.
  function KeyView(el, app, opts) {
    opts = opts || {};
    this.el = el;
    this.app = app;
    this.onLayout = opts.onLayout || function () {};
    this.view = '';
    this.caps = [];
    this.byCode = {};      // code -> caps carrying it, for the АГАТ board
    this.byScan = {};      // scancode -> cap, for the PC board
    this.rus = !!opts.rus;
    this.shift = false;
    this.ctrl = false;
    this.stick = 0;        // modifier caps latched by pointer, not held down
    this.down = {};        // scancode -> the caps it is holding down
    this.setView(opts.view === 'pc' ? 'pc' : 'agat');
  }

  KeyView.prototype.setView = function (name) {
    name = VIEWS[name] ? name : 'agat';
    if (name === this.view) return;
    this.view = name;
    this.build();
  };

  KeyView.prototype.build = function () {
    var blocks = VIEWS[this.view], self = this, i;
    if (this.release) this.unwatch();     // switching views rebuilds everything
    this.el.innerHTML = '';
    this.caps = [];
    this.byCode = {};
    this.byScan = {};
    this.down = {};

    var board = document.createElement('div');
    board.className = 'kb-board kb-' + this.view;
    for (i = 0; i < blocks.length; i++) board.appendChild(this.block(blocks[i]));
    this.el.appendChild(board);

    this.readout = document.createElement('div');
    this.readout.className = 'kb-readout';
    this.el.appendChild(this.readout);

    // One listener for the whole board: the caps are rebuilt on every view
    // change, and per-cap listeners would have to be rebuilt with them. The
    // pointer-up is on the document because a press that ends off the cap it
    // started on is still a release, and the cap must come back up.
    board.addEventListener('pointerdown', function (e) { self.press(e); });
    board.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    this.release = function () { self.light(null); };
    document.addEventListener('pointerup', this.release);
    document.addEventListener('pointercancel', this.release);

    this.refresh();
  };

  KeyView.prototype.block = function (rows) {
    var wrap = document.createElement('div'), i, j, r, el;
    wrap.className = 'kb-block';
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      el = document.createElement('div');
      el.className = 'kb-row';
      if (r.pad) el.style.marginLeft = r.pad * 2.3 + 'em';
      if (r.gapTop) el.style.marginTop = r.gapTop * 0.5 + 'em';
      for (j = 0; j < r.keys.length; j++) el.appendChild(this.cap(r.keys[j]));
      wrap.appendChild(el);
    }
    return wrap;
  };

  // Every cap is two stacked spans. A legend cap fills both with glyphs; a
  // caption cap puts its word in the top and, on the PC board, the byte it
  // currently sends in the bottom.
  KeyView.prototype.cap = function (def) {
    var el = document.createElement('button');
    var top = document.createElement('span');
    var bot = document.createElement('span');
    el.type = 'button';
    el.tabIndex = -1;                 // the canvas keeps the keyboard focus
    el.style.width = (def.w || 1) * 2.3 + 'em';
    if (def.gap) el.style.marginLeft = def.gap * 2.3 + 'em';
    if (def.cap !== undefined) {
      top.className = 'kb-word';
      top.textContent = def.cap;
    } else {
      top.textContent = CHAR[def[def.up]] || '';
      bot.textContent = CHAR[def[def.up === 'u' ? 's' : 'u']] || '';
    }
    el.appendChild(top);
    el.appendChild(bot);

    var cap = { def: def, el: el, top: top, bot: bot };
    this.caps.push(cap);
    el.__cap = cap;
    this.index(cap);
    return el;
  };

  // Which key events light this cap. On the АГАТ board a cap owns codes and any
  // host key producing one lights it; on the PC board it owns its scancode.
  KeyView.prototype.index = function (cap) {
    var d = cap.def, self = this;
    function code(c) {
      if (c === undefined) return;
      (self.byCode[c & 0x7f] || (self.byCode[c & 0x7f] = [])).push(cap);
    }
    if (d.scan !== undefined) this.byScan[d.scan + (d.ext ? 256 : 0)] = cap;
    else { code(d.u); code(d.s); code(d.code); }
  };

  // ---- state ---------------------------------------------------------------

  KeyView.prototype.setLayout = function (rus) {
    this.rus = !!rus;
    this.refresh();
  };

  KeyView.prototype.setMods = function (m) {
    this.shift = !!m.shift;
    this.ctrl = !!m.ctrl;
    this.refresh();
  };

  KeyView.prototype.shifted = function () {
    return this.shift || !!(this.stick & 1);
  };
  KeyView.prototype.ctrled = function () {
    return this.ctrl || !!(this.stick & 2);
  };
  KeyView.prototype.mod = function () {
    return this.ctrled() ? K.CTRL : this.shifted() ? K.SHIFT : K.NORMAL;
  };
  KeyView.prototype.layout = function () {
    return this.rus ? K.RUS : K.LAT;
  };

  // 2 if some host key reaches this code in the live layout and modifier, 1 if
  // one does in another, 0 if none ever does. The difference between 2 and 1 is
  // what the board re-greys when ЛАТ and РУС are swapped.
  KeyView.prototype.reach = function (code) {
    if (code === undefined) return 0;
    var rs = K.routesTo(code), layout = this.layout(), mod = this.mod();
    var i, any = 0;
    for (i = 0; i < rs.length; i++) {
      any = 1;
      // A remapped key ignores both layout and modifier, so it reaches its code
      // now whatever the board is showing.
      if (rs[i].remap || rs[i].mod === K.EXT) return 2;
      if (rs[i].layout === layout && rs[i].mod === mod) return 2;
    }
    return any;
  };

  KeyView.prototype.title = function (code) {
    var rs = K.routesTo(code), names = [], i;
    for (i = 0; i < rs.length; i++) names.push(K.routeName(rs[i]));
    return '$' + hex2(code & 0x7f) +
           (CHAR[code & 0x7f] ? ' ‘' + CHAR[code & 0x7f] + '’' : '') + ' — ' +
           (names.length ? names.join(', ') : 'no host key sends this');
  };

  // Re-class every cap. Cheap enough to run on any change: a few hundred nodes,
  // and nothing reads layout back out of the DOM.
  KeyView.prototype.refresh = function () {
    var i, cap, d, cls, live;
    for (i = 0; i < this.caps.length; i++) {
      cap = this.caps[i];
      d = cap.def;
      cls = 'kb-cap' + (d.red ? ' red' : '');
      if (d.act === 'shift' && this.shifted()) cls += ' on';
      if (d.act === 'ctrl' && this.ctrled()) cls += ' on';
      if (d.act === 'layout' && (d.cap === 'LAT') !== this.rus) cls += ' on';
      if (d.act === 'none') cls += ' dead';

      if (d.scan !== undefined) {
        // The PC board: the byte this key sends right now, under its own name.
        live = K.codeFor(d.scan, this.layout(),
                         K.planeFor(d.ext, this.ctrled(), this.shifted()));
        cap.bot.className = 'kb-sends' + (live < 0 ? ' dead' : ' lit');
        cap.bot.textContent = live < 0 ? '—' : sends(live);
        if (live < 0) cls += ' dead';
        cap.el.title = d.cap + (live < 0 ? ' — nothing in this plane'
                                         : ' → ' + this.title(live));
      } else if (d.code !== undefined) {
        // A caption cap has one code and so no half to light: all it can say is
        // whether this layout reaches it.
        cap.top.className = 'kb-word ' + this.state(d.code, false);
        cap.el.title = this.title(d.code);
      } else if (d.u !== undefined) {
        // The lit half is whichever legend the live register would send, which
        // is not always the top one: a letter cap paints its shifted, Cyrillic
        // half above and a digit cap paints its unshifted half above.
        var now = this.shifted() ? d.s : d.u;
        var upper = d.up === 'u' ? d.u : d.s;
        var lower = d.up === 'u' ? d.s : d.u;
        cap.top.className = 'kb-half ' + this.state(upper, upper === now);
        cap.bot.className = 'kb-half ' + this.state(lower, lower === now);
        cap.el.title = this.title(d.u) +
          (d.s === undefined ? '' : '\nРЕГ ' + this.title(d.s));
      }
      if (cap.el.className !== cls) cap.el.className = cls;
    }
    this.sync();
  };

  // A legend's three states: unreachable at all, reachable but not from this
  // layout, and reachable now — plus `lit` for the half the current register
  // actually sends.
  KeyView.prototype.state = function (code, active) {
    var r = this.reach(code);
    return (r === 0 ? 'dead' : r === 1 ? 'far' : 'near') + (active ? ' lit' : '');
  };

  // The latch, as software sees it. $C000 holds one code with bit 7 as the "a
  // key is waiting" strobe, and any touch of $C010 clears it.
  KeyView.prototype.sync = function () {
    var m = this.app && this.app.machine;
    if (!this.readout || !m) return;
    var v = m.kbdLatch & 0xff, ch = CHAR[v & 0x7f];
    var txt = '$C000 = $' + hex2(v) + (ch ? ' ‘' + ch + '’' : '') +
              (v & 0x80 ? ' · waiting' : ' · read') +
              '   $C063 = ' + (m.cyrillic ? 'РУС' : 'ЛАТ');
    if (this.readout.textContent !== txt) this.readout.textContent = txt;
  };

  function hex2(v) {
    return (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
  }

  // What a key sends, said in one cap's worth of space. Space and the control
  // codes have no glyph, and a machine that is about to receive $8D is better
  // served by being told $8D than by a dot standing in for it.
  function sends(code) {
    code &= 0x7f;
    return code > 0x20 ? CHAR[code] : '$' + hex2(code);
  }

  // ---- input ---------------------------------------------------------------

  // A host keypress, from attachKeyboard. `code` is the byte it produced, which
  // is how the cap is found on the АГАТ board; `info` carries the scancode,
  // which is how it is found on the PC one. A null `info` means everything up.
  //
  // The key-up carries no code — and by then the layout may have changed under
  // it anyway — so what went down is remembered rather than looked up twice.
  KeyView.prototype.light = function (info, code, on) {
    var i, list, cap, key;
    if (!info) {
      for (i = 0; i < this.caps.length; i++) rm(this.caps[i].el);
      this.down = {};
      return;
    }
    key = info.scan + (info.ext ? 256 : 0);
    if (!on) {
      list = this.down[key] || [];
      for (i = 0; i < list.length; i++) rm(list[i].el);
      delete this.down[key];
      return;
    }
    if (this.view === 'pc') {
      cap = this.byScan[key];
      list = cap ? [cap] : [];
    } else {
      list = this.byCode[code & 0x7f] || this.byCode[capCode(code)] || [];
    }
    for (i = 0; i < list.length; i++) add(list[i].el);
    this.down[key] = list;
  };

  // classList.toggle's second argument is not universally honoured, and these
  // run on every keystroke.
  function add(el) { if (el.className.indexOf(' down') < 0) el.className += ' down'; }
  function rm(el) { el.className = el.className.replace(' down', ''); }

  // Clicking a cap types it. The code goes straight into the latch rather than
  // back through the scancode table: a cap knows its own byte, and several caps
  // have no host key at all.
  KeyView.prototype.press = function (e) {
    var el = e.target, cap, code, d;
    while (el && !el.__cap) el = el.parentNode;
    e.preventDefault();
    cap = el && el.__cap;
    if (!cap) return;
    d = cap.def;
    add(cap.el);

    if (d.act === 'shift') { this.stick ^= 1; this.refresh(); return; }
    if (d.act === 'ctrl') { this.stick ^= 2; this.refresh(); return; }
    if (d.act === 'layout') { this.onLayout(); return; }
    if (d.act === 'reset') { this.app.reset(); return; }
    if (d.act === 'none') return;

    if (d.scan !== undefined) {
      code = K.codeFor(d.scan, this.layout(),
                       K.planeFor(d.ext, this.ctrled(), this.shifted()));
      if (code < 0) return;
    } else {
      code = d.code !== undefined ? d.code : this.shifted() ? d.s : d.u;
      if (code === undefined) return;
    }
    this.app.machine.kbdLatch = (code | 0x80) & 0xff;
    // A latched modifier is a one-shot, as it has to be with one pointer.
    if (this.stick) { this.stick = 0; this.refresh(); } else this.sync();
  };

  KeyView.prototype.unwatch = function () {
    document.removeEventListener('pointerup', this.release);
    document.removeEventListener('pointercancel', this.release);
    this.release = null;
  };

  KeyView.prototype.destroy = function () {
    this.unwatch();
    this.el.innerHTML = '';
    this.caps = [];
    this.readout = null;
  };

  AGAT.KeyView = KeyView;
  AGAT.keyview = {
    CHAR: CHAR, VIEWS: VIEWS, capCode: capCode,
    AGAT_MAIN: AGAT_MAIN, AGAT_PAD: AGAT_PAD,
    PC_MAIN: PC_MAIN, PC_NAV: PC_NAV, PC_PAD: PC_PAD,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
