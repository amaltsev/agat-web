// A BASIC program, back into a listing.
//
// An `A` file is a tokenized BASIC program in Applesoft's format: a length in
// its own first two bytes, then a chain of lines — a two-byte pointer to the
// next line, a two-byte line number, then the line itself, literal characters
// and one-byte tokens mixed, ending in `$00`. A pointer of `$0000` ends the
// program. The pointers are addresses from wherever the program last was in
// memory and tell a reader nothing, so the chain is walked by its terminators
// and only the zero pointer is read.
//
// **The keyword table is the Agat's, not Apple's.** It is transcribed out of
// the interpreter — `B BASIC` at `$0F00` on the `basint` system disk, keywords
// at `$10D0` in Applesoft's own layout: 107 of them from `$80`, each stored as
// its characters with bit 7 set on the last. The order is Applesoft's
// throughout; eight of the words are the Agat's own, listed at `TOKENS`.
//
// **A variable name can be an index into a table saved after the program.**
// That is the Agat's own, not Apple's, and not every version does it: the
// Agat-9 factory test is written this way and the Agat-7 one is not. `$01` and
// an index stand for a name, and the table is what the file carries after its
// program — names in the same form as the keywords, `$00` padding in front of
// it and a four-byte trailer after it, index 1 being the first name. All
// thirteen `A` files in `examples/` fit that, largest index against table
// length; without it a listing prints dots where its variables should be.
//
// The spelling is the machine's, measured rather than assumed: `TESTKOM9_840`
// and `TESTCOM7_840` with their greeting renamed, so each disk falls to a `]`
// prompt, then `LOAD TESTX` and `LIST`. The line number is followed by one
// space; **a token carries a space on each side and a name from the table one
// in front**, which is what makes the Agat-7 test's line 1690 come out as
// `1690  IF  ST > 0 THEN 1720`. `$` draws as `¤` because that is the glyph in
// that cell of the Agat font, and the screen agrees.
(function (AGAT) {
  'use strict';

  // $80 up, in order. The eight that are not Applesoft's word for that token:
  //
  //   $88 GR=      $89 TEXT=    where Apple has GR and TEXT
  //   $8E !        $8F &        where Apple has HLIN and VLIN
  //   $90 MGR=     $91 HGR=     where Apple has HGR2 and HGR
  //   $92 RIBBON=  $93 &        where Apple has HCOLOR= and HPLOT
  //
  // `!` is the inline assembler the ИКП and factory-test programs are written
  // around; `&` appears three times over, at $8F, $93 and Apple's own $AF.
  var TOKENS = (
    'END FOR NEXT DATA INPUT DEL DIM READ GR= TEXT= PR# IN# CALL PLOT ! & ' +
    'MGR= HGR= RIBBON= & DRAW XDRAW HTAB HOME ROT= SCALE= SHLOAD TRACE ' +
    'NOTRACE NORMAL INVERSE FLASH COLOR= POP VTAB HIMEM: LOMEM: ONERR ' +
    'RESUME RECALL STORE SPEED= LET GOTO RUN IF RESTORE & GOSUB RETURN REM ' +
    'STOP ON WAIT LOAD SAVE DEF POKE PRINT CONT LIST CLEAR GET NEW TAB( TO ' +
    'FN SPC( THEN AT NOT STEP + - * / ^ AND OR > = < SGN INT ABS USR FRE ' +
    'SCRN( PDL POS SQR RND LOG EXP COS SIN TAN ATN PEEK LEN STR$ VAL ASC ' +
    'CHR$ LEFT$ RIGHT$ MID$'
  ).split(' ');

  var REM = 0xb2;                          // where a line stops being a program
  var NAME = 0x01;                         // and the index of one follows
  var BANG = 0x8e;                         // the assembler, one statement a line

  function tokenName(b) {
    return TOKENS[b - 0x80] || '{$' + b.toString(16).toUpperCase() + '}';
  }

  // Names, keywords and the catalog all end a string the same way: the last
  // character carries bit 7. Reads one run of them, stopping at a `$00` or at
  // the end, and says where it stopped.
  function names(bytes, at) {
    var out = [], cur = '', b;
    while (at < bytes.length) {
      b = bytes[at++];
      if (b === 0x00) {
        // Padding in front of the table — none, one, two and five of it in
        // `examples/` — and the `$00` that ends the table.
        if (cur || out.length) break;
        continue;
      }
      cur += AGAT.chars.glyph(b);
      if (b & 0x80) { out.push(cur); cur = ''; }
    }
    return out;
  }

  // ---- one line ------------------------------------------------------------

  // The pieces a listing is made of. `kind` says what each one is:
  //
  //   kw    a token, spaced the way the machine spaces it
  //   name  a variable out of the table, with the space the machine puts there
  //   str   a quoted string, its quotes included
  //   rem   everything after a REM
  //   txt   the rest — names spelled out, numbers, punctuation
  //
  // Which is all the highlighting there is to do, and it costs nothing: the
  // decoder has to know where a string starts and where a REM swallows the
  // rest of the line anyway, or it would read a `:` inside a comment as a
  // statement break and a `$8D` inside a string as a token.
  //
  // The `!` statements come back as rows of their own, because that is how the
  // machine lists them — line 10 of the Agat-9 test is three rows on its
  // screen. The assembler's own columns are not reproduced.
  function line(bytes, from, to, num, tab, rows) {
    var parts = [], txt = '', i, b, end, ix;
    var push = function (kind, s) {
      if (txt) { parts.push({ kind: 'txt', text: txt }); txt = ''; }
      if (s) parts.push({ kind: kind, text: s });
    };
    // The first row carries the line number, and each `!` after something has
    // been drawn starts another that does not.
    var row = function () {
      push('txt', '');
      rows.push({ num: num, parts: parts });
      num = null;
      parts = [];
    };
    for (i = from; i < to; i++) {
      b = bytes[i];
      if (b === REM) {
        push('kw', ' ' + tokenName(b) + ' ');
        parts.push({ kind: 'rem', text: AGAT.chars.decode(bytes, i + 1, to) });
        break;
      }
      if (b === BANG && (parts.length || txt)) row();
      if (b >= 0x80) { push('kw', ' ' + tokenName(b) + ' '); continue; }
      if (b === NAME && i + 1 < to) {
        ix = bytes[++i];
        push('name', ' ' + (tab[ix - 1] || '{' + ix + '}'));
        continue;
      }
      if (b === 0x22) {
        // A string runs to the closing quote or to the end of the line: one
        // left open is a line somebody typed, not a file we have misread.
        end = i + 1;
        while (end < to && bytes[end] !== 0x22) end++;
        push('str', AGAT.chars.decode(bytes, i, Math.min(end + 1, to)));
        i = end;
        continue;
      }
      txt += AGAT.chars.glyph(b);
    }
    row();
  }

  // ---- the program ---------------------------------------------------------

  // `{rows: [{num, parts}], names, error}`. `error` is set when the bytes run
  // out before the program does, and whatever was read is still in `rows` — a
  // truncated file is worth looking at, and saying nothing about it would be
  // worse than saying so.
  function list(bytes) {
    var rows = [], out = { rows: rows }, i = 0, next, num, end;
    var tab = [];
    // The table is read first, because a line needs it. Where the program ends
    // is found by the same walk that lists it, so this is that walk with
    // nothing drawn.
    while (i + 4 <= bytes.length) {
      next = bytes[i] | (bytes[i + 1] << 8);
      if (!next) break;
      end = i + 4;
      while (end < bytes.length && bytes[end] !== 0x00) end++;
      i = end + 1;
    }
    if (i + 2 <= bytes.length) tab = names(bytes, i + 2);
    out.names = tab;

    i = 0;
    while (i + 4 <= bytes.length) {
      next = bytes[i] | (bytes[i + 1] << 8);
      if (!next) return out;               // the end, properly reached
      num = bytes[i + 2] | (bytes[i + 3] << 8);
      end = i + 4;
      while (end < bytes.length && bytes[end] !== 0x00) end++;
      line(bytes, i + 4, end, num, tab, rows);
      if (end >= bytes.length) {
        out.error = 'the last line runs off the end of the file';
        return out;
      }
      i = end + 1;
    }
    out.error = rows.length ? 'the program does not end where the file does'
                            : 'no BASIC program here';
    return out;
  }

  // The same thing as one string, for whatever wants text rather than pieces.
  function text(bytes) {
    var got = list(bytes);
    var lines = got.rows.map(function (r) {
      var s = r.parts.map(function (p) { return p.text; }).join('');
      return (r.num === null ? '' : r.num + ' ') + s;
    });
    if (got.error) lines.push('*** ' + got.error);
    return lines.join('\n') + (lines.length ? '\n' : '');
  }

  AGAT.basic = { TOKENS: TOKENS, tokenName: tokenName, names: names,
                 list: list, text: text };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
