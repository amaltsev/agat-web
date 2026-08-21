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
//     and ЛАТ cannot type Ю, Ч or Ъ. The board grays those out — which is the
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
  // less $40 — the ASCII control relation — and most of those have no cap of
  // their own, so a Ctrl'd byte is shown on the letter it was made from. The
  // ones that do have a cap need no rule and are held by `CARRIED` instead:
  // $88 is the ← cap's own code, and $9B is РЕД's.
  function capCode(code) {
    code &= 0x7f;
    return (code >= 0x01 && code <= 0x1f) ? 0x40 + code : code;
  }

  // ---- the АГАТ board ------------------------------------------------------
  //
  // `w` is a cap's width in units and `gap` the space before it; `pad` is the
  // row's left indent, and the stagger is the real board's. `uw` is where a cap
  // starts on the winnowed board, for one the machine makes far wider than a
  // program needs it: it grows from there to fill the block it is in, so this is
  // the width it has when nothing is beside it. `act` marks a cap that does
  // something other than send a byte: СБР resets, РУС and LAT switch layout,
  // УПР and РЕГ are the modifiers, and ПВТ and the pad's `=` send nothing the
  // shipped table carries.
  //
  // РЕД is the Esc, $9B. The scancode table cannot say which cap owns that byte,
  // since host Esc and УПР+Ш both produce it.

  // The arrow caps are named rather than written in place, because two boards
  // put them in two different places: here they are where the machine has them,
  // ↑ between ПВТ and РЕД with ← ↓ → on the row below, and the winnowed board
  // gathers them into a cluster of their own. `nav` is what says a cap belongs
  // to that cluster.
  var UP = C('↑', { code: 0x99, red: 1, nav: 1 });
  var DOWN = C('↓', { code: 0x9a, red: 1, nav: 1 });
  var LEFT = C('←', { code: 0x88, red: 1, nav: 1, gap: 0.2 });
  var RIGHT = C('→', { code: 0x95, red: 1, nav: 1 });

  var AGAT_MAIN = [
    { pad: 0, keys: [
      C('СБР', { act: 'reset', red: 1 }),
      P(0x3b, 0x2b), P(0x31, 0x21), P(0x32, 0x22), P(0x33, 0x23),
      P(0x34, 0x24), P(0x35, 0x25), P(0x36, 0x26), P(0x37, 0x27),
      P(0x38, 0x28), P(0x39, 0x29), { u: 0x30, up: 'u' }, P(0x2d, 0x3d),
      C('ПВТ', { act: 'none', red: 1, w: 1.5, gap: 0.2 }),
      UP,
      C('РЕД', { code: 0x9b, red: 1 }),
    ] },
    { pad: 0.1, keys: [
      C('УПР', { act: 'ctrl', red: 1, w: 1.3 }),
      L(0x4a), L(0x43), L(0x55), L(0x4b), L(0x45), L(0x4e),
      L(0x47), L(0x5b), L(0x5d), L(0x5a), L(0x48), P(0x3a, 0x2a),
      LEFT, DOWN, RIGHT,
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
    { pad: 4.2, keys: [C('ПРОБЕЛ', { code: 0x20, w: 9, uw: 4.5 })] },
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

  // ---- the winnowed board --------------------------------------------------
  //
  // `used` is the machine's own board with everything the loaded container did
  // not name shrunk to a sliver, so that the program's keys are the only ones
  // left legible and stay where the Agat puts them. The machine's layout is
  // what groups them: where a program's keys land on the Agat's board is what
  // someone looking for them needs to see.
  //
  // It is three areas that collapse on their own — the typewriter, the arrow
  // cluster and the numeric pad — because a program that uses none of the pad
  // is better served by not being shown a column of slivers where the pad was,
  // and because ↑ has to stay over ↓. On the machine ↑ is held in place between
  // ПВТ and РЕД; ПВТ is a cap this board does not draw at all, so the row closes
  // up around ↑ and the cluster is arranged here instead.
  //
  // What it does not draw: СБР, УПР, РУС/LAT and РЕГ. They are the board's
  // controls rather than the program's keys, and on the phone this view exists
  // for they were most of what was left on the screen.

  function copy(d, o) {
    var out = {}, k;
    for (k in d) out[k] = d[k];
    for (k in o) out[k] = o[k];
    return out;
  }

  // Whole or not at all: half a cross of arrows reads worse than none, and the
  // four of them together are three caps' worth of space.
  var USED_NAV = [
    { pad: 1, keys: [copy(UP)] },
    { keys: [copy(LEFT, { gap: 0 }), copy(DOWN), copy(RIGHT)] },
  ];
  USED_NAV.whole = true;

  // A block of the machine's board, less the caps this one does not draw: the
  // controls, the caps that send nothing at all, and the arrows the cluster
  // above now carries.
  //
  // With one exception, and it is the exception that makes the board usable by
  // touch. A cap named on both its legends can only send the unshifted one by
  // itself, so the left РЕГ is kept — not as furniture, but as the only way to
  // reach the other control. plan() draws it when some cap is in that position
  // and winnows it away when none is.
  function keysOnly(block) {
    var out = [], keys, r, i, j, d, shift = 0;
    for (i = 0; i < block.length; i++) {
      r = block[i];
      keys = [];
      for (j = 0; j < r.keys.length; j++) {
        d = r.keys[j];
        if (d.act === 'shift') { if (!shift++) keys.push(d); continue; }
        if (!d.act && !d.nav) keys.push(d);
      }
      if (keys.length) out.push({ pad: r.pad, gapTop: r.gapTop, keys: keys });
    }
    return out;
  }

  var USED_MAIN = keysOnly(AGAT_MAIN);
  var USED_PAD = keysOnly(AGAT_PAD);

  var VIEWS = {
    agat: [AGAT_MAIN, AGAT_PAD],
    pc: [PC_MAIN, PC_NAV, PC_PAD],
    used: [USED_MAIN, USED_NAV, USED_PAD],
  };

  // How wide a winnowed-away cap is drawn, in the same em units as the rest. Not
  // zero: the keys that are left have to stay in the positions the board gives
  // them, and a row that closed up over its gaps would put them somewhere the
  // machine never had them.
  var SLIVER = 0.5;

  // A cap's width in units, on the board it is being drawn for. ПРОБЕЛ is nine
  // units on the machine and it is what the winnowed board would be sized to
  // fit — a row of nine units and one key against rows of slivers — so there it
  // starts at half that and size() gives it whatever its block leaves over.
  function units(def, used) {
    return (used && def.uw !== undefined ? def.uw : def.w) || 1;
  }

  // Which codes the machine's own board carries on a cap of their own, and so
  // which cap owns a code there: $88 is the ← cap, $99 the ↑ one and $9B РЕД,
  // and a code with a cap of its own belongs to it rather than to the letter
  // capCode would otherwise send it to. This is the same order light() takes, as
  // a table, because the winnowed board is always the АГАТ one.
  var CARRIED = (function () {
    var out = [], rows = [AGAT_MAIN, AGAT_PAD], i, j, k, d;
    for (i = 0; i < 128; i++) out.push(0);
    for (i = 0; i < rows.length; i++) {
      for (j = 0; j < rows[i].length; j++) {
        for (k = 0; k < rows[i][j].keys.length; k++) {
          d = rows[i][j].keys[k];
          if (d.u !== undefined) out[d.u & 0x7f] = 1;
          if (d.s !== undefined) out[d.s & 0x7f] = 1;
          if (d.code !== undefined) out[d.code & 0x7f] = 1;
        }
      }
    }
    return out;
  })();

  // The codes a container's keys reach, moved onto the caps that own them. The
  // value kept is the code itself, not a flag, because a cap reached this way is
  // not always sending its own byte: `$8B` has no cap on this machine and lands
  // on `K`, which is where УПР makes it.
  function capsUsed(raw) {
    var out = [], i, c;
    if (!raw) return null;
    for (i = 0; i < 128; i++) out.push(0);
    for (i = 0; i < 128; i++) {
      if (!raw[i]) continue;
      c = CARRIED[i] ? i : capCode(i);
      if (!out[c]) out[c] = raw[i];
    }
    return out;
  }

  // What each half of a cap is kept for, which is `keeps` before it collapses to
  // one byte. A letter cap has two legends and the container may have named
  // both — Rise Out reads `K` and `К`, which are the halves of one key — and a
  // board that remembered only the half a touch sends would draw the other one
  // as scenery.
  //
  // The value is the code the half stands for, and that is not always the legend
  // printed on it: `$8B` has no cap and is kept on `K`, where УПР makes it. Ask
  // `marks()` whether a legend is itself what the program reads.
  var NONE = { u: 0, s: 0 };       // nothing kept, for a board that winnows nothing

  function kept(d, used) {
    if (d.act) return NONE;
    if (d.code !== undefined) return { u: used[d.code & 0x7f] || 0, s: 0 };
    return { u: d.u === undefined ? 0 : used[d.u & 0x7f] || 0,
             s: d.s === undefined ? 0 : used[d.s & 0x7f] || 0 };
  }

  // Which caps that board keeps: the ones carrying a code the container named,
  // and nothing else. A cap that does something rather than sending a byte is
  // not one of the program's keys and is not drawn.
  // The answer is the code the cap stands for, which is what a touch on it has
  // to send: the cap's own byte where it carries one, and the program's key
  // where the cap is only standing in for it. 0 for a cap this board drops.
  // Where both legends are named the unshifted one is what a touch sends, since
  // this board draws no РЕГ to hold.
  function keeps(d, used) {
    var n = kept(d, used);
    return n.u || n.s;
  }

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
    this.group = '';       // which control group the winnowed board is cut to
    this.caps = [];
    this.blocks = [];
    this.board = null;
    this.byCode = {};      // code -> caps carrying it, for the АГАТ board
    this.byScan = {};      // scancode -> cap, for the PC board
    this.rus = !!opts.rus;
    this.shift = false;
    this.ctrl = false;
    this.stick = 0;        // modifier caps latched by pointer, not held down
    this.down = {};        // scancode -> the caps it is holding down
    this.setView(opts.view);        // setView is what knows the names
  }

  // `used:Cheats` is the winnowed board narrowed to one of the container's
  // control groups. The group rides beside the view rather than in it: what is
  // drawn is still the winnowed board, and everything below — plan, winnow,
  // size — asks only whether the view is `used`.
  //
  // A group the loaded container does not have is dropped here, in the one place
  // every caller goes through, rather than left to become a board winnowed down
  // to nothing.
  KeyView.prototype.setView = function (name) {
    var cut = String(name || '').indexOf(':');
    var group = cut < 0 ? '' : name.slice(cut + 1);
    name = cut < 0 ? name : name.slice(0, cut);
    name = VIEWS[name] ? name : 'agat';
    if (group && !hasGroup(group)) group = '';
    if (name === this.view && group === this.group) return;
    if (name === this.view) { this.group = group; this.refresh(); return; }
    this.view = name;
    this.group = group;
    this.build();
  };

  function hasGroup(name) {
    var gs = K.controlGroups() || [], i;
    for (i = 0; i < gs.length; i++) if (gs[i].name === name) return true;
    return false;
  }

  KeyView.prototype.build = function () {
    var blocks = VIEWS[this.view], self = this, i;
    if (this.release) this.unwatch();     // switching views rebuilds everything
    this.el.innerHTML = '';
    this.caps = [];
    this.blocks = [];
    this.byCode = {};
    this.byScan = {};
    this.down = {};

    var board = document.createElement('div');
    board.className = 'kb-board kb-' + this.view;
    for (i = 0; i < blocks.length; i++) board.appendChild(this.block(blocks[i]));
    this.board = board;
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

  // The rows and blocks are kept as well as the caps: the winnowed board hides
  // the ones it empties, and a hidden row is not a row of nothing, it is gone.
  KeyView.prototype.block = function (rows) {
    var wrap = document.createElement('div');
    var rec = { el: wrap, rows: [], whole: !!rows.whole }, i, j, r, el, row, cap;
    wrap.className = 'kb-block';
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      el = document.createElement('div');
      el.className = 'kb-row';
      if (r.pad) el.style.marginLeft = r.pad * 2.3 + 'em';
      if (r.gapTop) el.style.marginTop = r.gapTop * 0.5 + 'em';
      row = { el: el, pad: r.pad || 0, caps: [] };
      for (j = 0; j < r.keys.length; j++) {
        cap = this.cap(r.keys[j]);
        row.caps.push(cap);
        el.appendChild(cap.el);
      }
      rec.rows.push(row);
      wrap.appendChild(el);
    }
    this.blocks.push(rec);
    return wrap;
  };

  // Every cap is two stacked spans. A legend cap fills both with glyphs; a
  // caption cap puts its word in the top and, on the PC board, the byte it
  // currently sends in the bottom.
  KeyView.prototype.cap = function (def) {
    var el = document.createElement('button');
    var top = document.createElement('span');
    var bot = document.createElement('span');
    var w = units(def, this.view === 'used') * 2.3 + 'em';
    el.type = 'button';
    el.tabIndex = -1;                 // the canvas keeps the keyboard focus
    el.style.width = w;
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

    var cap = { def: def, el: el, top: top, bot: bot, w: w,
                gone: false, hide: false, sends: 0, kept: NONE };
    this.caps.push(cap);
    el.__cap = cap;
    this.index(cap);
    return cap;
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
  // what the board re-grays when ЛАТ and РУС are swapped.
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

  // What a code is, said out loud: the byte, its glyph, what the container says
  // it does, and every host key that reaches it. The label comes from `controls`,
  // which is where the prose lives now — `keys` hints still arrive through
  // routeName, so a container written either way says something.
  KeyView.prototype.title = function (code) {
    var rs = K.routesTo(code), names = [], i;
    var label = K.controlLabel(code);
    for (i = 0; i < rs.length; i++) names.push(K.routeName(rs[i]));
    return '$' + hex2(code & 0x7f) +
           (CHAR[code & 0x7f] ? ' ‘' + CHAR[code & 0x7f] + '’' : '') +
           (label ? ' — ' + label : '') + ' — ' +
           (names.length ? names.join(', ') : 'no host key sends this');
  };

  // Whether this legend is one the container named. A cap standing in for a code
  // it does not carry — `$8B` drawn on `K` — has nothing to mark: the legend on
  // it is not what the program reads, which is what the tooltip is for.
  KeyView.prototype.marks = function (cap, code) {
    return (cap.kept.u && cap.kept.u === code) ||
           (cap.kept.s && cap.kept.s === code);
  };

  // What this cap does in this program, every named legend of it. Two controls
  // on one cap get a line each, which is the only place they are both spelled
  // out — the board can mark both but can only send one.
  KeyView.prototype.reads = function (cap) {
    var out = [];
    if (cap.kept.u) out.push(this.title(cap.kept.u));
    if (cap.kept.s) out.push('РЕГ ' + this.title(cap.kept.s));
    return out.join('\n');
  };

  // Which codes this program's keys reach, on the caps that own them. Null when
  // no container has named any, and then nothing is winnowed away — a board
  // asked to show only a program's keys, with no program loaded, is the whole
  // keyboard rather than an empty one.
  KeyView.prototype.used = function () {
    return capsUsed(K.usedCodes(this.layout(), this.group));
  };

  // Which caps this board draws, decided a block at a time. A block the
  // container never mentions is hidden whole by winnow(); a `whole` block —
  // the arrow cluster — is all of it or none, since its caps hold each other in
  // position and a gap in the middle of them is worse than no cluster.
  //
  // The winnowing is the one thing the layout changes without a keypress: a key
  // declared as-is sends a different code in РУС than in ЛАТ, and so lands on a
  // different cap.
  //
  // Two passes over every block rather than one per block, because whether РЕГ
  // is drawn is a question about the whole board: the cap that needs it may be
  // in a block the first pass has not reached.
  KeyView.prototype.plan = function (used) {
    var i, j, k, b, r, cap;
    this.needShift = false;
    for (i = 0; i < this.blocks.length; i++) {
      b = this.blocks[i];
      b.any = 0;
      b.thin = false;
      for (j = 0; j < b.rows.length; j++) {
        r = b.rows[j];
        for (k = 0; k < r.caps.length; k++) {
          cap = r.caps[k];
          cap.kept = used ? kept(cap.def, used) : NONE;
          cap.sends = cap.kept.u || cap.kept.s;
          // Both halves named is the only case a register can help with. Where
          // only the shifted one is, `sends` is already it and a touch is enough.
          if (cap.kept.u && cap.kept.s) this.needShift = true;
          if (cap.sends) b.any = 1;
        }
      }
    }
    for (i = 0; i < this.blocks.length; i++) {
      b = this.blocks[i];
      for (j = 0; j < b.rows.length; j++) {
        r = b.rows[j];
        for (k = 0; k < r.caps.length; k++) {
          cap = r.caps[k];
          cap.hide = !used ? false
                   : cap.def.act === 'shift' ? !this.needShift
                   : !(b.whole ? b.any : cap.sends);
          if (cap.hide) b.thin = true;
        }
      }
    }
  };

  // Re-class every cap. Cheap enough to run on any change: a few hundred nodes,
  // and nothing reads layout back out of the DOM.
  KeyView.prototype.refresh = function () {
    var used = this.view === 'used' ? this.used() : null;
    var i, cap, d, cls, live, gone;
    if (this.view === 'used') this.plan(used);
    for (i = 0; i < this.caps.length; i++) {
      cap = this.caps[i];
      d = cap.def;
      gone = !!cap.hide;
      if (gone !== cap.gone) {
        cap.gone = gone;
        cap.el.style.width = gone ? SLIVER + 'em' : cap.w;
        cap.el.style.marginLeft = gone || !d.gap ? '' : d.gap * 2.3 + 'em';
        cap.el.title = '';
      }
      if (gone) {
        if (cap.el.className !== 'kb-cap gone') cap.el.className = 'kb-cap gone';
        continue;
      }
      cls = 'kb-cap' + (d.red ? ' red' : '');
      if (d.act === 'shift' && this.shifted()) cls += ' on';
      if (d.act === 'ctrl' && this.ctrled()) cls += ' on';
      if (d.act === 'layout' && (d.cap === 'LAT') !== this.rus) cls += ' on';
      if (d.act === 'none') cls += ' dead';
      // On the winnowed board this is the one control drawn, and it is drawn
      // among a program's keys where it needs saying what it is for.
      if (d.act === 'shift') cap.el.title = 'РЕГ — the shifted half of a cap, for the next key';

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
        cap.top.className = 'kb-word ' + this.state(d.code, false) +
                            (cap.kept.u ? ' named' : '');
        cap.el.title = this.title(d.code);
      } else if (d.u !== undefined) {
        // The lit half is whichever legend the live register would send, which
        // is not always the top one: a letter cap paints its shifted, Cyrillic
        // half above and a digit cap paints its unshifted half above.
        var now = this.shifted() ? d.s : d.u;
        var upper = d.up === 'u' ? d.u : d.s;
        var lower = d.up === 'u' ? d.s : d.u;
        // The machine's order is the wrong one on the winnowed board when the
        // program reads the lower legend only. A cap kept for `U` is printed
        // У over U, so the big glyph on it is the one byte the game does not
        // want, and the board answers "which key?" with the wrong character.
        // Put the legend this program reads on top. A cap kept for both keeps
        // the machine's order, since neither half is the answer on its own.
        if (this.marks(cap, lower) && !this.marks(cap, upper)) {
          var swap = upper; upper = lower; lower = swap;
        }
        cap.top.textContent = CHAR[upper] || '';
        cap.bot.textContent = CHAR[lower] || '';
        cap.top.className = 'kb-half ' + this.state(upper, upper === now) +
                            (this.marks(cap, upper) ? ' named' : '');
        cap.bot.className = 'kb-half ' + this.state(lower, lower === now) +
                            (this.marks(cap, lower) ? ' named' : '');
        cap.el.title = this.title(d.u) +
          (d.s === undefined ? '' : '\nРЕГ ' + this.title(d.s));
      }
      // On the winnowed board the question is what this key does in *this*
      // program: every legend the container named, and the cap may be standing
      // in for a code it does not carry at all.
      if (cap.sends) cap.el.title = this.reads(cap);
      if (cap.el.className !== cls) cap.el.className = cls;
    }
    // Run on the winnowed board whether or not anything was winnowed: a
    // container being unloaded has to give the rows and the size back.
    if (this.view === 'used') { this.winnow(); this.size(); }
    this.sync();
  };

  // A row with nothing left on it is a row of slivers, and a block of those is
  // a numeric pad this program never mentions: both go altogether, which is
  // most of what makes the winnowed board fit a phone.
  //
  // An indent is measured in cap widths, so in a block that lost caps to slivers
  // it collapses with them: ПРОБЕЛ's four-and-a-fifth caps of indent are
  // four-and-a-fifth slivers, which keeps it under the letters it sits under on
  // the machine instead of nine ems out to their right. A block that kept
  // everything keeps its indents, which is what holds ↑ over ↓ in the cluster.
  //
  // An indent holds a row against the rows around it, so the last row left in a
  // block has none: Snake's board is ПРОБЕЛ and the arrows, and four slivers of
  // stagger in front of the space bar are four slivers of nothing.
  KeyView.prototype.winnow = function () {
    var i, j, k, b, r, live;
    for (i = 0; i < this.blocks.length; i++) {
      b = this.blocks[i];
      b.live = 0;
      for (j = 0; j < b.rows.length; j++) {
        r = b.rows[j];
        live = false;
        for (k = 0; k < r.caps.length; k++) if (!r.caps[k].gone) live = true;
        r.el.style.display = live ? '' : 'none';
        if (live) b.live++;
      }
      // Second pass: whether a row is the only one left is a question about the
      // block, and the first pass is what answers it.
      for (j = 0; j < b.rows.length; j++) {
        r = b.rows[j];
        if (r.pad) r.el.style.marginLeft = padOf(b, r) + 'em';
      }
      b.el.style.display = b.live ? '' : 'none';
    }
  };

  // A row's indent in ems: cap widths on a block that kept its caps, sliver
  // widths on one that did not, and none at all where it is the only row left.
  function padOf(b, r) {
    return b.live > 1 ? r.pad * (b.thin ? SLIVER : 2.3) : 0;
  }

  // Size the winnowed board off its own width, which is the one number the
  // stylesheet cannot know: what is left after winnowing is whatever this
  // container asked for. The 22px is the board's own padding and border, which
  // do not scale with the font; the ceiling stops a four-key board from being
  // drawn as four enormous keys. A browser without container units drops the
  // whole declaration and keeps the rule in the stylesheet.
  //
  // The measure is rounded *up*, with a tenth of an em to spare, because the
  // board wraps: it is a flex row of blocks, and a divisor a hundredth short of
  // what the caps lay out in puts the last block on a line of its own. Snake's
  // board is ПРОБЕЛ and the arrows, and that is the difference between the
  // arrows beside the space bar and under it.
  //
  // A block is as wide as its widest row, and a cap with a `uw` takes whatever
  // the rows beside it leave over: ПРОБЕЛ ends under the letters instead of
  // stopping short of them, and where it is the whole block it is the whole
  // block. Measured first and stretched after, since the width to fill is the
  // widest row and that is not known until every row is measured.
  KeyView.prototype.size = function () {
    var wide = 0, most, w, i, j, b, rows;
    for (i = 0; i < this.blocks.length; i++) {
      b = this.blocks[i];
      if (b.el.style.display === 'none') continue;
      rows = [];
      most = 0;
      for (j = 0; j < b.rows.length; j++) {
        w = b.rows[j].el.style.display === 'none' ? -1 : rowWide(b, b.rows[j]);
        rows.push(w);
        if (w > most) most = w;
      }
      for (j = 0; j < b.rows.length; j++) {
        if (rows[j] >= 0) fill(b.rows[j], most - rows[j]);
      }
      wide += most + (wide ? 1.4 : 0); // and the board's, between the blocks
    }
    var fit = (Math.ceil(wide * 10) + 1) / 10;
    this.board.style.fontSize = wide
      ? 'min(calc((100cqw - 22px) / ' + fit.toFixed(1) + '), 26px)' : '';
  };

  // What a row lays out in, in ems, with every cap at the width the table gives
  // it. The 0.18 is the row's flex gap in the stylesheet, between every pair.
  function rowWide(b, r) {
    var w = padOf(b, r), k, cap;
    for (k = 0; k < r.caps.length; k++) {
      cap = r.caps[k];
      w += cap.gone ? SLIVER
         : units(cap.def, true) * 2.3 + (cap.def.gap || 0) * 2.3;
    }
    return w + 0.18 * (r.caps.length - 1);
  }

  // Hand a row's slack to the cap that grows, and there is at most one on a row.
  // A winnowed-away cap is a sliver holding a place and does not take it, and no
  // cap grows past the width the machine gives it: a board with nothing winnowed
  // away is the machine's own proportions, ПРОБЕЛ's nine units included.
  function fill(r, slack) {
    var k, cap;
    for (k = 0; k < r.caps.length; k++) {
      cap = r.caps[k];
      if (cap.gone || cap.def.uw === undefined) continue;
      cap.w = Math.min(cap.def.uw * 2.3 + slack, (cap.def.w || 1) * 2.3) + 'em';
      cap.el.style.width = cap.w;
      return;
    }
  }

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

  // classList.toggle's second argument is not universally honored, and these
  // run on every keystroke.
  function add(el) { if (el.className.indexOf(' down') < 0) el.className += ' down'; }
  function rm(el) { el.className = el.className.replace(' down', ''); }

  // Clicking a cap types it. The code goes straight into the latch rather than
  // back through the scancode table: a cap knows its own byte, and several caps
  // have no host key at all.
  //
  // On the winnowed board a cap sends the program's key it was kept for, which
  // is not always its own byte: `$8B` has no cap on this machine and is drawn on
  // `K`, where УПР makes it, and that board draws no УПР.
  //
  // Where the container named both legends of one cap the unshifted one is what
  // a touch sends, since this board draws no РЕГ to hold either. A host Shift
  // held down reaches the other, which is the whole of what one pointer and no
  // modifier caps can offer.
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

    if (cap.sends) {
      code = this.shifted() && cap.kept.s ? cap.kept.s : cap.sends;
    } else if (d.scan !== undefined) {
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
    this.blocks = [];
    this.board = null;
    this.readout = null;
  };

  // ---- the controls panel --------------------------------------------------
  //
  // The container's `controls`, drawn as a card: a column per group, a line per
  // row, in the order the file lists them. It is not a keyboard — it carries no
  // listeners and nothing on it is pressable. It says what the *program* reads —
  // `Q` is $51 whatever is switched on — and the board beside it answers the
  // other half, which host key reaches that code now. The panel is static for
  // exactly that reason: graying and relocation belong to the board, which
  // already does both.
  //
  // The one host-side thing on it is a container remap, `^ (W)`. A remap holds
  // in every plane by construction, so it is the only host key that does not
  // move under ЛАТ/РУС and the only one this panel can honestly promise.

  // The container's own line to whoever is about to play — its `hint` — is not
  // here: it is the container talking rather than the keyboard, and it is drawn
  // with the rest of what the container says about itself on the info card below
  // (`info.js`).
  //
  // A group is also a tap target: it cuts the board beside it down to that group,
  // which is the `used:<name>` the keyboard menu offers. `opts.onPick` is how the
  // page hears about it, and it gets '' for "all of them again".
  //
  // Pointer only, deliberately. Every keystroke on this page belongs to the
  // machine, so a focusable tile would be a tile that eats a key the emulator
  // wanted; the `<select>` in the bar reaches the same states from the keyboard
  // and is the accessible route to them.
  function ControlPanel(el, opts) {
    var self = this;
    opts = opts || {};
    this.el = el;
    this.onPick = opts.onPick || function () {};
    this.groups = [];
    this.active = '';
    this.build();
    // One listener for the whole panel, as the board has: the groups are rebuilt
    // whenever a container is, and per-tile listeners would have to be rebuilt
    // with them. `click` and not `pointerdown`, because this is a choice rather
    // than a keypress — a touch that turns into a scroll should not make it.
    this.tap = function (e) { self.pick(e); };
    el.addEventListener('click', this.tap);
  }

  // A tap anywhere inside a group is a tap on the group, and a tap on the one
  // the board is already cut to goes back to the whole container — the same
  // target is the way out as well as the way in, which is the only way out a
  // board with no menu in reach would have.
  ControlPanel.prototype.pick = function (e) {
    var el = e.target;
    while (el && el !== this.el && !el.__group) el = el.parentNode;
    if (!el || !el.__group) return;
    this.onPick(el.__group === this.active ? '' : el.__group);
  };

  function span(cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  // Which host key the container nailed to this code, or ''. routesTo carries
  // both kinds of route and only the remaps are taken: the rest come from the
  // machine's own table, which is indexed by layout.
  function remappedTo(code) {
    var rs = K.routesTo(code), i;
    for (i = 0; i < rs.length; i++) {
      if (rs[i].remap) return K.keyName(rs[i].scan, rs[i].ext ? K.EXT : K.NORMAL);
    }
    return '';
  }

  // A row's codes, as one string: `↑ ↓ ← →`, or `^ (W)` where a host key was
  // nailed to it. The parenthesis is dropped when it would only repeat the code,
  // which is most letters — `K (K)` tells nobody anything.
  function codeList(codes) {
    var out = [], i, name, host;
    for (i = 0; i < codes.length; i++) {
      name = K.codeName(codes[i]);
      host = remappedTo(codes[i]);
      out.push(host && host !== name ? name + ' (' + host + ')' : name);
    }
    return out.join(' ');
  }

  ControlPanel.prototype.build = function () {
    var gs = K.controlGroups() || [], box, head, line, g, i, j;
    this.el.innerHTML = '';
    this.groups = [];
    for (i = 0; i < gs.length; i++) {
      g = gs[i];
      box = document.createElement('div');
      box.className = 'ctl-group';
      box.__group = g.name;             // what a tap anywhere inside it picks
      head = span('ctl-name', g.name);
      box.appendChild(head);
      for (j = 0; j < g.rows.length; j++) {
        line = document.createElement('div');
        line.className = 'ctl-line';
        line.appendChild(span('ctl-code', codeList(g.rows[j].codes)));
        if (g.rows[j].label) line.appendChild(span('ctl-what', g.rows[j].label));
        box.appendChild(line);
      }
      this.groups.push({ name: g.name, el: box });
      this.el.appendChild(box);
    }
  };

  // Which group the board beside this panel is currently cut to, so that a board
  // showing four caps is not left looking like the container lost the rest. Also
  // what a tap on that same group toggles back off.
  ControlPanel.prototype.mark = function (group) {
    var i, on;
    this.active = group || '';
    for (i = 0; i < this.groups.length; i++) {
      on = !!group && this.groups[i].name === group;
      this.groups[i].el.className = 'ctl-group' + (on ? ' on' : '');
    }
  };

  ControlPanel.prototype.destroy = function () {
    this.el.removeEventListener('click', this.tap);
    this.el.innerHTML = '';
    this.groups = [];
  };

  AGAT.KeyView = KeyView;
  AGAT.ControlPanel = ControlPanel;
  AGAT.keyview = {
    CHAR: CHAR, VIEWS: VIEWS, capCode: capCode, SLIVER: SLIVER,
    keeps: keeps, kept: kept, capsUsed: capsUsed, CARRIED: CARRIED,
    AGAT_MAIN: AGAT_MAIN, AGAT_PAD: AGAT_PAD,
    PC_MAIN: PC_MAIN, PC_NAV: PC_NAV, PC_PAD: PC_PAD,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
