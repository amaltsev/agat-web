// The Agat character set: 128 codes, and the glyph each one draws.
//
// `$20-$5F` is ASCII with one substitution — `$24` is the ГОСТ currency sign
// `¤`, not `$` — and `$60-$7F` is upper-case Cyrillic in KOI-7 N2 order.
// Bit 7 is the video attribute, not part of the code: the Agat-7 font's low
// 128 glyphs are a byte-for-byte mirror of its high 128, so `$C1` and `$41`
// are the same letter drawn normal and inverse.
//
// Measured against the shipped fonts rather than assumed: every code from
// `$00` to `$7F` in `agathe7.fnt` matches the one `$80` above it, and the
// Agat-9's `$80-$FF` is the same set again. The Agat-9's *lower* half is a
// different set — lower-case Latin at `$40-$5F`, lower-case Cyrillic at
// `$60-$7F` — which nothing here covers, and which nothing DOS stores uses:
// a catalog name and the text of a `T` file both carry bit 7 set throughout.
//
// Two directions and a third that is neither. `glyph` and `code` are the
// encoding. `fold` is for *matching* a name somebody typed against a name on a
// disk, and it throws information away on purpose — see below.
(function (AGAT) {
  'use strict';

  var KOI7 = 'ЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ';

  // Code -> glyph. Empty for the 32 control codes, which draw something but
  // nothing anybody would name a file with.
  var CHAR = (function () {
    var t = [], i;
    for (i = 0; i < 128; i++) t.push('');
    for (i = 0x20; i < 0x60; i++) t[i] = String.fromCharCode(i);
    t[0x24] = '¤';
    for (i = 0; i < 32; i++) t[0x60 + i] = KOI7.charAt(i);
    return t;
  })();

  var BY_CHAR = (function () {
    var t = {}, i;
    for (i = 0; i < 128; i++) if (CHAR[i]) t[CHAR[i]] = i;
    // `$` is not in the set, but it is what somebody typing at a US keyboard
    // will press for the cap the machine draws `¤` on.
    t.$ = 0x24;
    return t;
  })();

  // The Cyrillic letters whose Agat glyph is near enough to a Latin one that
  // the two were used interchangeably — `MAШИHИCT` on the ИКП disk is `M A H C
  // T` in Latin and `Ш И` in Cyrillic, in one name. Which of the two a name on
  // a disk actually holds is not something anybody remembers, so matching folds
  // them together. The glyphs are *not* identical — the Agat-7 draws `А` with a
  // flat top and `A` with a pointed one — so this is only ever for lookup, and
  // `ls` prints what the bytes really say.
  var LOOKALIKE = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H',
                    'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X' };

  // One byte as the character it draws; '.' for a control code, so that a dump
  // keeps its columns.
  function glyph(b) {
    return CHAR[b & 0x7f] || '.';
  }

  // One character as the code that draws it, or -1. Lower case is accepted and
  // folded up: the set has no lower case at all in the half DOS writes.
  function code(ch) {
    var c = BY_CHAR[ch];
    if (c === undefined) c = BY_CHAR[ch.toUpperCase()];
    return c === undefined ? -1 : c;
  }

  // Bytes to text. Bit 7 is dropped, control codes come out as `\xNN` and a
  // literal backslash is doubled, so the result goes back through `encode`
  // unchanged whatever the file held.
  function decode(bytes, from, to) {
    var s = '', i, b, g;
    for (i = from || 0; i < (to === undefined ? bytes.length : to); i++) {
      b = bytes[i];
      g = CHAR[b & 0x7f];
      if (g === '\\') s += '\\\\';
      else if (g) s += g;
      else s += '\\x' + ('0' + (b & 0x7f).toString(16).toUpperCase()).slice(-2);
    }
    return s;
  }

  // Text to bytes, bit 7 set — normal video, which is what DOS stores. Throws
  // on a character the machine cannot draw rather than dropping it: a name
  // silently missing a letter is worse than a refusal.
  function encode(s) {
    var out = [], i = 0, c, n;
    while (i < s.length) {
      c = s.charAt(i);
      if (c === '\\' && s.charAt(i + 1) === '\\') { out.push(0xdc); i += 2; continue; }
      if (c === '\\' && s.charAt(i + 1) === 'x') {
        n = parseInt(s.substr(i + 2, 2), 16);
        if (isNaN(n)) throw new Error('bad \\x escape in "' + s + '"');
        out.push((n & 0x7f) | 0x80);
        i += 4;
        continue;
      }
      n = code(c);
      if (n < 0) throw new Error('"' + c + '" is not in the Agat character set');
      out.push(n | 0x80);
      i++;
    }
    return new Uint8Array(out);
  }

  // What two names are compared as: case folded, Cyrillic look-alikes folded
  // onto their Latin twins, trailing spaces gone.
  function fold(s) {
    var out = '', i, c;
    s = s.toUpperCase();
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      out += LOOKALIKE[c] || c;
    }
    return out.replace(/\s+$/, '');
  }

  AGAT.chars = {
    CHAR: CHAR, KOI7: KOI7, LOOKALIKE: LOOKALIKE,
    glyph: glyph, code: code, decode: decode, encode: encode, fold: fold,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
