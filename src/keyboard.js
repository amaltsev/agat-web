// Keyboard.
//
// The machine reads $C000 for the last key with bit 7 set as the "a key is
// waiting" strobe, and clears the strobe with any access to $C010 — so only one
// key code is ever held.
//
// Getting from a browser event to that byte goes through the same table the
// real emulators use: a 2 x 4 x 0x80 map indexed by [layout][modifier][PC/AT
// set-1 scancode]. Layout is ЛАТ or РУС, modifier is normal / shift / ctrl /
// extended (the E0-prefixed keys — arrows, keypad Enter and so on). The byte
// found there is written to $C000 with bit 7 set.
//
// The table below is the shipped keyb/default.bin from agat-emulator, emitted
// verbatim; the RUS planes are a JCUKEN layout, so Cyrillic comes from where
// the key *is*, not from what the host keyboard thinks it types.
//
// The same table is also indexed backwards here, by the byte produced, because
// that is the direction every actual question runs in: a game wants ^, and the
// person at the keyboard needs to know which key sends one. `keyview.js` draws
// that answer; `routesTo` is where it comes from.
(function (AGAT) {
  'use strict';

  var LAT = 0, RUS = 1;
  var NORMAL = 0, SHIFT = 1, CTRL = 2, EXT = 3;

  // [layout][modifier] planes of 128 bytes, flattened.
  var KEYMAP = new Uint8Array([
    // LAT normal
    0x00,0x9b,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x30,0x2d,0x3d,0x88,0x89,
    0x51,0x57,0x45,0x52,0x54,0x59,0x55,0x49,0x4f,0x50,0x5b,0x5d,0x8d,0x00,0x41,0x53,
    0x44,0x46,0x47,0x48,0x4a,0x4b,0x4c,0x3b,0x27,0xc0,0x00,0x5c,0x5a,0x58,0x43,0x56,
    0x42,0x4e,0x4d,0x2c,0x2e,0x2f,0x00,0x2a,0x00,0x20,0x00,0x84,0x85,0x86,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x90,0x91,0x92,0x2d,0x93,0x94,0x9c,0x2b,0x9d,
    0x9e,0x9f,0x81,0x82,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    // LAT shift
    0x00,0x9b,0x21,0x40,0x23,0x24,0x25,0x5e,0x26,0x2a,0x28,0x29,0x5f,0x2b,0x88,0x89,
    0x71,0x77,0x65,0x72,0x74,0x79,0x75,0x69,0x6f,0x70,0x7b,0x7d,0x8d,0x00,0x61,0x73,
    0x64,0x66,0x67,0x68,0x6a,0x6b,0x6c,0x3a,0x22,0xde,0x00,0x7c,0x7a,0x78,0x63,0x76,
    0x62,0x6e,0x6d,0x3c,0x3e,0x3f,0x00,0x2a,0x00,0x20,0x00,0x84,0x85,0x86,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x90,0x91,0x92,0x2d,0x93,0x94,0x9c,0x2b,0x9d,
    0x9e,0x9f,0x81,0x82,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    // LAT ctrl
    0x00,0x9b,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x30,0x2d,0x3d,0x82,0x89,
    0x91,0x97,0x85,0x92,0x94,0x99,0x95,0x89,0x8f,0x90,0x9b,0x9d,0x8a,0x00,0x81,0x93,
    0x84,0x86,0x87,0x88,0x8a,0x8b,0x8c,0x3b,0x27,0x22,0x00,0x9c,0x9a,0x98,0x83,0x96,
    0x82,0x8e,0x8d,0x2c,0x2e,0x2f,0x00,0x2a,0x00,0x20,0x00,0x84,0x85,0x86,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x90,0x91,0x92,0x2d,0x93,0x94,0x9c,0x2b,0x9d,
    0x9e,0x9f,0x81,0x82,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    // LAT ext
    0x00,0x9b,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x30,0x2d,0x3d,0x82,0x89,
    0x00,0x97,0x85,0x92,0x94,0x99,0x95,0x89,0x8f,0x00,0x9b,0x9d,0x83,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x8a,0x8b,0x8c,0x3b,0x27,0x22,0x00,0x9c,0x9a,0x00,0x00,0x00,
    0x00,0x00,0x00,0x2c,0x2e,0x2f,0x00,0x00,0x00,0x20,0x00,0x84,0x85,0x86,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x8b,0x99,0x99,0x2d,0x88,0x94,0x95,0x2b,0x8a,
    0x9a,0x9a,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    // RUS normal
    0x00,0x9b,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x30,0x2d,0x3d,0x88,0x89,
    0x4a,0x43,0x55,0x4b,0x45,0x4e,0x47,0x5b,0x5d,0x5a,0x48,0x5f,0x8d,0x00,0x46,0x59,
    0x57,0x41,0x50,0x52,0x4f,0x4c,0x44,0x56,0x5c,0xc0,0x00,0x5c,0x51,0x5e,0x53,0x4d,
    0x49,0x54,0x58,0x42,0x40,0x2e,0x00,0x2a,0x00,0x20,0x00,0x84,0x85,0x86,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x90,0x91,0x92,0x2d,0x93,0x94,0x9c,0x2b,0x9d,
    0x9e,0x9f,0x81,0x82,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    // RUS shift
    0x00,0x9b,0x21,0x22,0x23,0x3b,0x25,0x3a,0x3f,0x2a,0x28,0x29,0x2d,0x2b,0x88,0x89,
    0x6a,0x63,0x75,0x6b,0x65,0x6e,0x67,0x7b,0x7d,0x7a,0x68,0x7f,0x8d,0x00,0x66,0x79,
    0x77,0x61,0x70,0x72,0x6f,0x6c,0x64,0x76,0x7c,0xde,0x00,0x7c,0x71,0x7e,0x73,0x6d,
    0x69,0x74,0x78,0x62,0x60,0x2c,0x00,0x2a,0x00,0x20,0x00,0x84,0x85,0x86,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x90,0x91,0x92,0x2d,0x93,0x94,0x9c,0x2b,0x9d,
    0x9e,0x9f,0x81,0x82,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    // RUS ctrl
    0x00,0x9b,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x30,0x2d,0x3d,0x82,0x89,
    0x91,0x97,0x85,0x92,0x94,0x99,0x95,0x89,0x8f,0x90,0x9b,0x9d,0x8a,0x00,0x81,0x93,
    0x84,0x86,0x87,0x88,0x8a,0x8b,0x8c,0x3b,0x27,0x22,0x00,0x9c,0x9a,0x98,0x83,0x96,
    0x82,0x8e,0x8d,0x2c,0x2e,0x2f,0x00,0x2a,0x00,0x20,0x00,0x84,0x85,0x86,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x90,0x91,0x92,0x2d,0x93,0x94,0x9c,0x2b,0x9d,
    0x9e,0x9f,0x81,0x82,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    // RUS ext
    0x00,0x9b,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x30,0x2d,0x3d,0x82,0x89,
    0x00,0x97,0x85,0x92,0x94,0x99,0x95,0x89,0x8f,0x00,0x9b,0x9d,0x83,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x8a,0x8b,0x8c,0x3b,0x27,0x22,0x00,0x9c,0x9a,0x00,0x00,0x00,
    0x00,0x00,0x00,0x2c,0x2e,0x2f,0x00,0x00,0x00,0x20,0x00,0x84,0x85,0x86,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x8b,0x99,0x99,0x2d,0x88,0x94,0x95,0x2b,0x8a,
    0x9a,0x9a,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,  ]);

  // Browser KeyboardEvent.code -> PC/AT set-1 make code. `true` marks the keys
  // that arrive with an E0 prefix on real hardware and so use the EXT plane.
  var SCAN = {
    Escape: 0x01,
    Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06,
    Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b,
    Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e, Tab: 0x0f,
    KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15,
    KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19,
    BracketLeft: 0x1a, BracketRight: 0x1b, Enter: 0x1c,
    KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23,
    KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26,
    Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, Backslash: 0x2b,
    KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30, KeyN: 0x31,
    KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35,
    NumpadMultiply: 0x37, Space: 0x39,
    F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f,
    F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44,
    Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49, NumpadSubtract: 0x4a,
    Numpad4: 0x4b, Numpad5: 0x4c, Numpad6: 0x4d, NumpadAdd: 0x4e,
    Numpad1: 0x4f, Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52,
    NumpadDecimal: 0x53, F11: 0x57, F12: 0x58,
  };

  var EXT_SCAN = {
    ArrowUp: 0x48, ArrowLeft: 0x4b, ArrowRight: 0x4d, ArrowDown: 0x50,
    Home: 0x47, End: 0x4f, PageUp: 0x49, PageDown: 0x51,
    Insert: 0x52, Delete: 0x53, NumpadEnter: 0x1c, NumpadDivide: 0x35,
  };

  // Code -> the glyph the Agat-7 draws for it. $20-$5F is ASCII apart from the
  // currency sign; $60-$7F is the Cyrillic band, in KOI-7 N2 order. Lives here
  // rather than with the on-screen board because it is what a code *is*, and
  // both the board and the remap's `"^"` have to read it.
  var CHAR = (function () {
    var t = [], i;
    for (i = 0; i < 128; i++) t.push('');
    for (i = 0x20; i < 0x60; i++) t[i] = String.fromCharCode(i);
    t[0x24] = '¤';
    var KOI = 'ЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ';
    for (i = 0; i < 32; i++) t[0x60 + i] = KOI.charAt(i);
    return t;
  })();

  // The codes with no glyph to name them by. These are the machine's own caps —
  // the arrow cluster, ↵, ПРОБЕЛ and F1-F3 — and the values are the ones
  // keyview.js paints on them.
  var NAMED = {
    Up: 0x99, Down: 0x9a, Left: 0x88, Right: 0x95,
    '↑': 0x99, '↓': 0x9a, '←': 0x88, '→': 0x95,
    Enter: 0x8d, '↵': 0x8d, Esc: 0x9b, Space: 0x20, Tab: 0x89, Bksp: 0x88,
    F1: 0x84, F2: 0x85, F3: 0x86,
  };

  var BY_CHAR = (function () {
    var out = {}, i;
    for (i = 0; i < 128; i++) if (CHAR[i]) out[CHAR[i]] = i;
    return out;
  })();

  // A code, written the way a person would write it: `$5E`, `0x5E`, a name from
  // the table above, or the character itself — `^`, `@`, `Ю`. -1 for none of
  // those, which is what lets a container name a key it got wrong and be told.
  function resolveCode(v) {
    if (typeof v === 'number') return v & 0xff;
    if (typeof v !== 'string' || !v) return -1;
    if (/^(\$|0x)[0-9a-f]{1,2}$/i.test(v)) return parseInt(v.replace(/^(\$|0x)/i, ''), 16);
    if (NAMED[v] !== undefined) return NAMED[v];
    if (BY_CHAR[v] !== undefined) return BY_CHAR[v];
    return -1;
  }

  // ---- the key set ---------------------------------------------------------
  //
  // A container can put a code on a host key: `"KeyW": "^"` for a game that
  // reads $5E. It is a layer in front of KEYMAP rather than an edit to it, and
  // it captures the key in *every* plane — W sends $5E in ЛАТ and in РУС, with
  // or without РЕГ and УПР — because a game's movement key must not change
  // under a modifier the player happens to be holding.
  //
  // The long form carries what the key is *for*:
  //
  //   "keys": { "KeyW": { "code": "^", "note": "Shoot right" } }
  //
  // which is the answer to the question someone actually has in front of an
  // unfamiliar game, and it reaches the on-screen board's tooltips through the
  // same route index as everything else.
  //
  // An entry with no code at all — `"Space": { "note": "Jump" }`, or a bare
  // `"Space": null` — declares a key the program uses *as it already is*. It
  // sends what the table has under it, exactly as it would with no container
  // loaded; all it adds is that the key is one of this program's, which is what
  // the "only mapped keys" board is drawn from. Without it a game whose keys
  // need no remapping could only join that board by being remapped to itself,
  // and a remap takes the key over in every plane, which is not the same thing.
  //
  // Kept by scancode, `scan + (ext ? 256 : 0)` as KEYNAME is, so the one lookup
  // in codeFor() covers the keyboard and the on-screen board at once.

  var REMAP = null;         // scancode -> code, the keys given one
  var USED = null;          // scancode -> true, every key the container names
  var NOTES = null;         // scancode -> what the key does
  var COUNT = 0;            // how many of them there are
  var REMAP_SRC = null;     // the map as it was given, for writing back out

  function setRemap(map) {
    var bad = [], ok = 0, on = 0, key, scan, code, ext, spec, k;
    ROUTES = null;                 // the backwards index is built from both
    REMAP = null;
    USED = null;
    NOTES = null;
    COUNT = 0;
    REMAP_SRC = null;
    if (!map) return { ok: 0, remapped: 0, bad: bad };
    REMAP = {};
    USED = {};
    NOTES = {};
    for (key in map) {
      spec = map[key];
      if (spec === null || spec === undefined) spec = {};
      else if (typeof spec !== 'object') spec = { code: spec };
      ext = Object.prototype.hasOwnProperty.call(EXT_SCAN, key);
      scan = ext ? EXT_SCAN[key] : SCAN[key];
      // A key that is not a key is named on its own; a key given a code that
      // cannot be read is named with the code, since that is the half at fault.
      if (scan === undefined) {
        bad.push(key + (spec.code ? ' → ' + spec.code : ''));
        continue;
      }
      k = scan + (ext ? 256 : 0);
      // No code is a declaration rather than a remap, so the table under the
      // key is left alone.
      if (spec.code !== undefined && spec.code !== null && spec.code !== '') {
        code = resolveCode(spec.code);
        if (code < 0) { bad.push(key + ' → ' + spec.code); continue; }
        REMAP[k] = code;
        on++;
      }
      USED[k] = true;
      NOTES[k] = spec.note || '';
      ok++;
    }
    COUNT = ok;
    REMAP_SRC = map;
    return { ok: ok, remapped: on, bad: bad };
  }

  function remap() { return REMAP_SRC; }

  // How many keys the container named, which is what tells a board with an
  // "only mapped keys" view whether it has anything to draw.
  function keyCount() { return COUNT; }

  // Which codes those keys reach, as a table of 128 indexed by the code's low
  // seven bits and holding the code itself — the set the "only mapped keys"
  // board keeps. A remapped key reaches its code from every plane at once. A key
  // declared as-is reaches whatever the table has under it in this layout,
  // unshifted and shifted, which is the pair of legends its cap carries; the
  // control plane is left out, because a cap the program only reaches under УПР
  // is not a cap it is asking anyone to find. Null when no keys were named at
  // all, which the board reads as "keep everything".
  //
  // The whole code and not a flag, because `$9B` and `$1B` share an index and a
  // board drawing one of them has to know which it was given.
  function usedCodes(layout) {
    if (!COUNT) return null;
    var out = [], key, k, scan, mod, v, i;
    for (i = 0; i < 128; i++) out.push(0);
    for (key in USED) {
      k = Number(key);
      scan = k & 255;
      if (REMAP[k] !== undefined) { out[REMAP[k] & 0x7f] = REMAP[k]; continue; }
      if (k >= 256) {
        v = KEYMAP[((layout * 4 + EXT) << 7) | scan];
        if (v) out[v & 0x7f] = v;
        continue;
      }
      for (mod = NORMAL; mod <= SHIFT; mod++) {
        v = KEYMAP[((layout * 4 + mod) << 7) | scan];
        if (v && !out[v & 0x7f]) out[v & 0x7f] = v;
      }
    }
    return out;
  }

  // Which plane a scancode is read from, given the modifiers.
  function planeFor(ext, ctrl, shift) {
    return ext ? EXT : ctrl ? CTRL : shift ? SHIFT : NORMAL;
  }

  // The table lookup itself, with the remap in front of it. Returns the byte to
  // put in $C000, or -1 for "nothing here" — the planes are sparse, and a hole
  // means the machine has no key that sends anything from this one.
  function codeFor(scan, layout, mod) {
    if (REMAP) {
      var r = REMAP[scan + (mod === EXT ? 256 : 0)];
      if (r !== undefined) return r | 0x80;
    }
    var v = KEYMAP[((layout * 4 + mod) << 7) | scan];
    return v ? (v | 0x80) : -1;
  }

  // Which scancode a browser event is, and whether it is one of the E0-prefixed
  // keys. Null for a key the table does not carry at all.
  function scanOf(e) {
    var ext = Object.prototype.hasOwnProperty.call(EXT_SCAN, e.code);
    var scan = ext ? EXT_SCAN[e.code] : SCAN[e.code];
    if (scan === undefined) return null;
    return { scan: scan, ext: ext, code: e.code };
  }

  // Returns the byte to put in $C000, or -1 for "not a key this machine has".
  function decode(e, layout) {
    var s = scanOf(e);
    if (!s) return -1;
    return codeFor(s.scan, layout, planeFor(s.ext, e.ctrlKey, e.shiftKey));
  }

  // ---- reading the table backwards -----------------------------------------
  //
  // Forwards — key to byte — is what the machine needs. Every question a person
  // has is the other way round: the game wants ^, which key is that? So index
  // the whole table once by the byte it produces. This is also what makes the
  // on-screen keyboard's caps light up without a second hand-written map: a cap
  // owns a code, and the code knows its keys.

  var ROUTES = null;

  function buildRoutes() {
    var i, layout, mod, scan, v, key, ext, k, r;
    ROUTES = [];
    for (i = 0; i < 128; i++) ROUTES.push([]);
    for (layout = 0; layout < 2; layout++) {
      for (mod = 0; mod < 4; mod++) {
        for (scan = 0; scan < 128; scan++) {
          v = KEYMAP[((layout * 4 + mod) << 7) | scan];
          k = scan + (mod === EXT ? 256 : 0);
          if (!v || !KEYNAME[k]) continue;
          // The two EXT planes are the same plane: an arrow key does not care
          // which layout is up, and listing it twice would only say so twice.
          if (mod === EXT && layout !== LAT) continue;
          // A remapped key no longer reaches what the table has under it, and
          // the board has to grey those legends out rather than keep offering
          // a key that now sends something else.
          if (REMAP && REMAP[k] !== undefined) continue;
          r = { layout: layout, mod: mod, scan: scan };
          // A key the container declared without remapping it still has a job,
          // and the job is the half worth reading out.
          if (NOTES && NOTES[k]) r.note = NOTES[k];
          ROUTES[v & 0x7f].push(r);
        }
      }
    }
    for (key in REMAP) {
      ext = Number(key) >= 256;
      ROUTES[REMAP[key] & 0x7f].push({
        scan: Number(key) & 255, ext: ext, mod: ext ? EXT : NORMAL,
        remap: true, note: NOTES[key],
      });
    }
  }

  // Every way to reach a code, as {layout, mod, scan}. The code is masked to 7
  // bits: bit 7 is the strobe the machine sets, not part of the character.
  function routesTo(code) {
    if (!ROUTES) buildRoutes();
    return ROUTES[code & 0x7f];
  }

  // Host key names for those routes, so a tooltip can say "ЛАТ Shift+6" rather
  // than "$07 plane 1". Only keys the tables carry appear; a scancode that is
  // in KEYMAP but that no browser key reaches is not a route at all.
  var KEYNAME = (function () {
    var out = {}, k;
    var PRETTY = {
      Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
      Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\',
      Comma: ',', Period: '.', Slash: '/', Space: 'Space', Enter: 'Enter',
      Tab: 'Tab', Escape: 'Esc', Backspace: 'Bksp',
      Insert: 'Ins', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      NumpadMultiply: 'Num *', NumpadAdd: 'Num +', NumpadSubtract: 'Num -',
      NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter',
    };
    function name(k) {
      if (PRETTY[k]) return PRETTY[k];
      if (k.indexOf('Key') === 0) return k.slice(3);
      if (k.indexOf('Digit') === 0) return k.slice(5);
      if (k.indexOf('Numpad') === 0) return 'Num ' + k.slice(6);
      return k;
    }
    for (k in SCAN) out[SCAN[k]] = name(k);
    for (k in EXT_SCAN) out[EXT_SCAN[k] + 256] = name(k);
    return out;
  })();

  function keyName(scan, mod) {
    return KEYNAME[scan + (mod === EXT ? 256 : 0)] || '$' + scan.toString(16);
  }

  // A route, said out loud: "ЛАТ Shift+6", "РУС X", "↑", "W (remap)", or
  // "W (Shoot right)" where the container said what the key is for. A remap
  // carries no layout because it ignores both, and is marked either way, so
  // that a key which only reaches this code because a container put it there is
  // not mistaken for something the machine's own table does. A key the
  // container only declared is a route the table already had, so it keeps its
  // layout and modifier and gains the note: "ЛАТ Space (Jump)".
  function routeName(r) {
    if (r.remap) {
      return keyName(r.scan, r.ext ? EXT : NORMAL) +
             ' (' + (r.note || 'remap') + ')';
    }
    var note = r.note ? ' (' + r.note + ')' : '';
    if (r.mod === EXT) return keyName(r.scan, EXT) + note;
    return (r.layout === RUS ? 'РУС ' : 'ЛАТ ') +
           (r.mod === SHIFT ? 'Shift+' : r.mod === CTRL ? 'Ctrl+' : '') +
           keyName(r.scan, r.mod) + note;
  }

  // Attach to a DOM element. `target` gets the listeners, `machine` receives
  // the decoded byte. Returns a detach function.
  //
  // The optional callbacks are what the on-screen keyboard watches: which key
  // went down and came back up, and whether a modifier is being held — a
  // modifier changes every cap on the board without producing a byte of its own.
  AGAT.attachKeyboard = function (el, machine, opts) {
    opts = opts || {};
    var shift = false, ctrl = false;

    function mods(e) {
      if (!opts.onMods || (e.shiftKey === shift && e.ctrlKey === ctrl)) return;
      shift = e.shiftKey; ctrl = e.ctrlKey;
      opts.onMods({ shift: shift, ctrl: ctrl });
    }
    function onKeyDown(e) {
      mods(e);
      if (e.metaKey || e.altKey) return;
      var m = machine.machine || machine;      // accept an App or a Machine
      var s = scanOf(e);
      if (!s) return;
      var v = codeFor(s.scan, m.cyrillic ? RUS : LAT,
                      planeFor(s.ext, e.ctrlKey, e.shiftKey));
      if (v < 0) return;
      m.kbdLatch = v & 0xff;
      if (opts.onKey) opts.onKey(v, s);
      e.preventDefault();
    }
    function onKeyUp(e) {
      mods(e);
      var s = scanOf(e);
      if (s && opts.onKeyUp) opts.onKeyUp(s);
    }
    // Leaving the window is a key-up nobody sends: without this a cap stays
    // lit, and a Shift released elsewhere leaves the board in the wrong plane.
    function onBlur() {
      shift = ctrl = false;
      if (opts.onMods) opts.onMods({ shift: false, ctrl: false });
      if (opts.onKeyUp) opts.onKeyUp(null);
    }
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('keyup', onKeyUp);
    el.addEventListener('blur', onBlur);
    return function () {
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('blur', onBlur);
    };
  };

  AGAT.keyboard = {
    decode: decode, codeFor: codeFor, scanOf: scanOf, planeFor: planeFor,
    routesTo: routesTo, routeName: routeName, keyName: keyName,
    setRemap: setRemap, remap: remap, resolveCode: resolveCode,
    keyCount: keyCount, usedCodes: usedCodes,
    KEYMAP: KEYMAP, SCAN: SCAN, EXT_SCAN: EXT_SCAN, CHAR: CHAR,
    LAT: LAT, RUS: RUS, NORMAL: NORMAL, SHIFT: SHIFT, CTRL: CTRL, EXT: EXT,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
