// A 6502 program, back into instructions.
//
// The `B` file the panel dumps as memory is usually code, and a hex dump of
// code is the one view that tells you least about it. This is the same bytes
// read the way the CPU reads them: one instruction to a row, at the address
// the file loads at.
//
// It disassembles **from the first byte forward**, which is what a linear
// disassembler can do and no more. Data inside a program — a table, a message,
// the byte after a `JSR` that a routine picks up off the stack — is read as
// instructions and comes out as nonsense, and one such byte shifts everything
// after it until the stream happens to resynchronise. That is a property of
// the problem, not a bug to be fixed here: nothing on the disk says which
// bytes are code.
//
// The opcode table is the NMOS 6502's, `src/cpu6502.js`'s own set: 151 official
// instructions and the undocumented ones the CPU also runs, since a program
// that uses one is exactly the program worth looking at. `ill` marks those, so
// the page can draw them differently — in a stream that has gone out of step
// they are what most of the rows are, and that is the tell.
//
// The mnemonics are the usual ones (oxyron.de/html/opcodes02.html, the table
// agat-emulator's `cpu/cpu6502.c` is also from). `tools/vectors.js` checks
// every one of the 256 lengths against what the CPU actually consumes, so the
// table cannot drift from the core that runs it.
(function (AGAT) {
  'use strict';

  // Mode names, and how many bytes each instruction in one takes.
  //
  // `BRK` is the one place where that is not what the CPU does: it pushes the
  // address of the byte *after* its operand, so a `BRK` really eats two. It is
  // listed as one byte, the way the monitor lists it, because what follows a
  // `BRK` in a file is far more often something else's first byte than a
  // signature nobody reads.
  var LEN = {
    imp: 1, acc: 1,
    imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, rel: 2,
    abs: 3, abx: 3, aby: 3, ind: 3
  };

  // The matrix, sixteen opcodes to a row, `$00` first. `JAM` is the opcode
  // that stops the CPU dead; it takes no operand and no bytes follow it that
  // mean anything.
  var TABLE = (
    /* 0- */ 'BRK/imp ORA/izx JAM/imp SLO/izx NOP/zp  ORA/zp  ASL/zp  SLO/zp  ' +
             'PHP/imp ORA/imm ASL/acc ANC/imm NOP/abs ORA/abs ASL/abs SLO/abs ' +
    /* 1- */ 'BPL/rel ORA/izy JAM/imp SLO/izy NOP/zpx ORA/zpx ASL/zpx SLO/zpx ' +
             'CLC/imp ORA/aby NOP/imp SLO/aby NOP/abx ORA/abx ASL/abx SLO/abx ' +
    /* 2- */ 'JSR/abs AND/izx JAM/imp RLA/izx BIT/zp  AND/zp  ROL/zp  RLA/zp  ' +
             'PLP/imp AND/imm ROL/acc ANC/imm BIT/abs AND/abs ROL/abs RLA/abs ' +
    /* 3- */ 'BMI/rel AND/izy JAM/imp RLA/izy NOP/zpx AND/zpx ROL/zpx RLA/zpx ' +
             'SEC/imp AND/aby NOP/imp RLA/aby NOP/abx AND/abx ROL/abx RLA/abx ' +
    /* 4- */ 'RTI/imp EOR/izx JAM/imp SRE/izx NOP/zp  EOR/zp  LSR/zp  SRE/zp  ' +
             'PHA/imp EOR/imm LSR/acc ALR/imm JMP/abs EOR/abs LSR/abs SRE/abs ' +
    /* 5- */ 'BVC/rel EOR/izy JAM/imp SRE/izy NOP/zpx EOR/zpx LSR/zpx SRE/zpx ' +
             'CLI/imp EOR/aby NOP/imp SRE/aby NOP/abx EOR/abx LSR/abx SRE/abx ' +
    /* 6- */ 'RTS/imp ADC/izx JAM/imp RRA/izx NOP/zp  ADC/zp  ROR/zp  RRA/zp  ' +
             'PLA/imp ADC/imm ROR/acc ARR/imm JMP/ind ADC/abs ROR/abs RRA/abs ' +
    /* 7- */ 'BVS/rel ADC/izy JAM/imp RRA/izy NOP/zpx ADC/zpx ROR/zpx RRA/zpx ' +
             'SEI/imp ADC/aby NOP/imp RRA/aby NOP/abx ADC/abx ROR/abx RRA/abx ' +
    /* 8- */ 'NOP/imm STA/izx NOP/imm SAX/izx STY/zp  STA/zp  STX/zp  SAX/zp  ' +
             'DEY/imp NOP/imm TXA/imp ANE/imm STY/abs STA/abs STX/abs SAX/abs ' +
    /* 9- */ 'BCC/rel STA/izy JAM/imp SHA/izy STY/zpx STA/zpx STX/zpy SAX/zpy ' +
             'TYA/imp STA/aby TXS/imp TAS/aby SHY/abx STA/abx SHX/aby SHA/aby ' +
    /* A- */ 'LDY/imm LDA/izx LDX/imm LAX/izx LDY/zp  LDA/zp  LDX/zp  LAX/zp  ' +
             'TAY/imp LDA/imm TAX/imp LXA/imm LDY/abs LDA/abs LDX/abs LAX/abs ' +
    /* B- */ 'BCS/rel LDA/izy JAM/imp LAX/izy LDY/zpx LDA/zpx LDX/zpy LAX/zpy ' +
             'CLV/imp LDA/aby TSX/imp LAS/aby LDY/abx LDA/abx LDX/aby LAX/aby ' +
    /* C- */ 'CPY/imm CMP/izx NOP/imm DCP/izx CPY/zp  CMP/zp  DEC/zp  DCP/zp  ' +
             'INY/imp CMP/imm DEX/imp SBX/imm CPY/abs CMP/abs DEC/abs DCP/abs ' +
    /* D- */ 'BNE/rel CMP/izy JAM/imp DCP/izy NOP/zpx CMP/zpx DEC/zpx DCP/zpx ' +
             'CLD/imp CMP/aby NOP/imp DCP/aby NOP/abx CMP/abx DEC/abx DCP/abx ' +
    /* E- */ 'CPX/imm SBC/izx NOP/imm ISC/izx CPX/zp  SBC/zp  INC/zp  ISC/zp  ' +
             'INX/imp SBC/imm NOP/imp SBC/imm CPX/abs SBC/abs INC/abs ISC/abs ' +
    /* F- */ 'BEQ/rel SBC/izy JAM/imp ISC/izy NOP/zpx SBC/zpx INC/zpx ISC/zpx ' +
             'SED/imp SBC/aby NOP/imp ISC/aby NOP/abx SBC/abx INC/abx ISC/abx'
  ).split(/\s+/);

  // The mnemonics of the official 151. Everything else the table names is
  // something the NMOS part does rather than something it was sold as doing —
  // and two of these words are also spelled by an opcode that is not official:
  // the 27 `NOP`s that are not `$EA`, and the `SBC` at `$EB`.
  var LEGAL = 'ADC AND ASL BCC BCS BEQ BIT BMI BNE BPL BRK BVC BVS CLC CLD ' +
    'CLI CLV CMP CPX CPY DEC DEX DEY EOR INC INX INY JMP JSR LDA LDX LDY ' +
    'LSR NOP ORA PHA PHP PLA PLP ROL ROR RTI RTS SBC SEC SED SEI STA STX ' +
    'STY TAX TAY TSX TXA TXS TYA';

  // `{name, mode, len, ill}` for one opcode. Frozen at load: the table is read
  // once and the rows come out of it.
  var OPS = (function () {
    var out = [], i, p, name, mode;
    for (i = 0; i < 256; i++) {
      p = TABLE[i].split('/');
      name = p[0];
      mode = p[1];
      out.push({
        name: name, mode: mode, len: LEN[mode],
        ill: LEGAL.indexOf(name) < 0 ||
             (name === 'NOP' && i !== 0xea) || i === 0xeb
      });
    }
    return out;
  })();

  function hx(n, wide) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < wide) s = '0' + s;
    return s;
  }

  // The operand, as it is written. A branch is given its target rather than
  // its displacement — the displacement is a thing to work out, and the address
  // is the thing to read.
  function operand(o, at, b1, b2, base) {
    var w = b1 | (b2 << 8);
    switch (o.mode) {
      case 'imp': return '';
      case 'acc': return 'A';
      case 'imm': return '#$' + hx(b1, 2);
      case 'zp': return '$' + hx(b1, 2);
      case 'zpx': return '$' + hx(b1, 2) + ',X';
      case 'zpy': return '$' + hx(b1, 2) + ',Y';
      case 'izx': return '($' + hx(b1, 2) + ',X)';
      case 'izy': return '($' + hx(b1, 2) + '),Y';
      case 'abs': return '$' + hx(w, 4);
      case 'abx': return '$' + hx(w, 4) + ',X';
      case 'aby': return '$' + hx(w, 4) + ',Y';
      case 'ind': return '($' + hx(w, 4) + ')';
    }
    // rel: the byte is signed, and counts from the instruction after this one.
    return '$' + hx((base + at + 2 + (b1 < 0x80 ? b1 : b1 - 256)) & 0xffff, 4);
  }

  // One instruction at `at`, as it would run at `base + at`. An instruction
  // whose operand is past the end of the bytes is not one: the last byte or two
  // of a file come back as `data`, one byte at a time, which is also what the
  // machine would find there.
  //
  //   {addr, at, len, name, arg, ill, data}
  function one(bytes, at, base) {
    base = base || 0;
    var op = bytes[at], o = OPS[op];
    var row = { addr: (base + at) & 0xffff, at: at, op: op,
                name: o.name, mode: o.mode, len: o.len, ill: o.ill, arg: '' };
    if (at + o.len > bytes.length) {
      row.len = 1;
      row.name = '???';
      row.ill = true;
      row.data = true;
      return row;
    }
    row.arg = operand(o, at, bytes[at + 1], bytes[at + 2], base);
    return row;
  }

  // The whole of it, one row an instruction, from the first byte forward.
  function lines(bytes, base) {
    var out = [], at = 0, row;
    while (at < bytes.length) {
      row = one(bytes, at, base);
      out.push(row);
      at += row.len;
    }
    return out;
  }

  // The same thing as text: address, the instruction's own bytes, then the
  // instruction. Three byte columns, because that is the longest there is.
  function text(bytes, base) {
    return lines(bytes, base).map(function (r) {
      var b = '', i;
      for (i = 0; i < 3; i++) {
        b += (i < r.len ? hx(bytes[r.at + i], 2) : '  ') + ' ';
      }
      return hx(r.addr, 4) + '- ' + b + ' ' + r.name + (r.arg ? ' ' + r.arg : '');
    }).join('\n') + (bytes.length ? '\n' : '');
  }

  AGAT.disasm = { OPS: OPS, one: one, lines: lines, text: text };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
