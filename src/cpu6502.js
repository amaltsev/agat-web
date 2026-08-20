// NMOS 6502 — the Agat's К581ВМ1 is a straight 6502, so this is the plain
// part: full official set, the usual undocumented opcodes (games do hit them),
// real cycle counts including page-cross and branch penalties.
//
// The bus is anything with read(addr) / write(addr, value). Reads may have
// side effects (soft switches), so read-modify-write does the double access
// the real chip does.
(function (AGAT) {
  'use strict';

  var C = 0x01, Z = 0x02, I = 0x04, D = 0x08, B = 0x10, U = 0x20, V = 0x40, N = 0x80;

  function CPU(bus) {
    this.bus = bus;
    this.a = 0; this.x = 0; this.y = 0; this.s = 0xfd;
    this.p = I | U;
    this.pc = 0;
    this.cycles = 0;
    this.halted = false;      // set by a JAM/KIL opcode
    this.irqLine = false;     // level-triggered
    this.irqPending = false;  // one-shot, for sources with no line to hold
    this.nmiEdge = false;
  }

  // RESET drops any interrupt raised but not yet taken — the request is a
  // flip-flop and the reset line clears it. Held across, it makes the first
  // instruction after a reset vector through $FFFA/$FFFE instead.
  CPU.prototype.reset = function () {
    this.s = 0xfd;
    this.p = I | U;
    this.nmiEdge = false;
    this.irqPending = false;
    this.irqLine = false;
    this.pc = this.bus.read(0xfffc) | (this.bus.read(0xfffd) << 8);
    this.halted = false;
  };

  CPU.prototype.nmi = function () { this.nmiEdge = true; };
  CPU.prototype.irq = function () { this.irqPending = true; };

  // ---- helpers ------------------------------------------------------------

  CPU.prototype.rd = function (a) { return this.bus.read(a & 0xffff); };
  CPU.prototype.wr = function (a, v) { this.bus.write(a & 0xffff, v & 0xff); };

  CPU.prototype.push = function (v) {
    this.wr(0x100 | this.s, v);
    this.s = (this.s - 1) & 0xff;
  };
  CPU.prototype.pull = function () {
    this.s = (this.s + 1) & 0xff;
    return this.rd(0x100 | this.s);
  };

  CPU.prototype.setNZ = function (v) {
    this.p = (this.p & ~(Z | N)) | (v ? 0 : Z) | (v & N);
    return v;
  };

  CPU.prototype.interrupt = function (vec, brk) {
    this.push((this.pc >> 8) & 0xff);
    this.push(this.pc & 0xff);
    this.push(brk ? (this.p | B | U) : ((this.p & ~B) | U));
    this.p |= I;
    this.pc = this.rd(vec) | (this.rd(vec + 1) << 8);
    this.cycles += 7;
  };

  // ---- step ---------------------------------------------------------------

  CPU.prototype.step = function () {
    var start = this.cycles;

    // Timed interrupt sources get a chance before every instruction.
    if (this.bus.pollInterrupts) this.bus.pollInterrupts(this.cycles);

    if (this.nmiEdge) {
      this.nmiEdge = false;
      this.interrupt(0xfffa, false);
      return this.cycles - start;
    }
    if ((this.irqLine || this.irqPending) && !(this.p & I)) {
      this.irqPending = false;
      this.interrupt(0xfffe, false);
      return this.cycles - start;
    }
    if (this.halted) { this.cycles += 1; return 1; }

    var op = this.rd(this.pc);
    this.pc = (this.pc + 1) & 0xffff;

    var a = 0, v = 0, t = 0, lo = 0, hi = 0, base = 0;
    var self = this;

    // Addressing modes. Each returns the effective address; `pageCross`
    // records whether an indexed read has to pay the extra cycle.
    var pageCross = false;

    function imm() { var r = self.pc; self.pc = (self.pc + 1) & 0xffff; return r; }
    function zp() { return self.rd(imm()); }
    function zpx() { return (self.rd(imm()) + self.x) & 0xff; }
    function zpy() { return (self.rd(imm()) + self.y) & 0xff; }
    function abs() {
      var l = self.rd(imm()), h = self.rd(imm());
      return l | (h << 8);
    }
    function absx() {
      var b = abs(), r = (b + self.x) & 0xffff;
      pageCross = (b & 0xff00) !== (r & 0xff00);
      return r;
    }
    function absy() {
      var b = abs(), r = (b + self.y) & 0xffff;
      pageCross = (b & 0xff00) !== (r & 0xff00);
      return r;
    }
    function izx() {
      var p = (self.rd(imm()) + self.x) & 0xff;
      return self.rd(p) | (self.rd((p + 1) & 0xff) << 8);
    }
    function izy() {
      var p = self.rd(imm());
      var b = self.rd(p) | (self.rd((p + 1) & 0xff) << 8);
      var r = (b + self.y) & 0xffff;
      pageCross = (b & 0xff00) !== (r & 0xff00);
      return r;
    }
    function rel() {
      var d = self.rd(imm());
      return (self.pc + (d < 0x80 ? d : d - 256)) & 0xffff;
    }

    function branch(cond) {
      var target = rel();
      self.cycles += 2;
      if (cond) {
        self.cycles += ((self.pc & 0xff00) !== (target & 0xff00)) ? 2 : 1;
        self.pc = target;
      }
    }

    function cmp(reg, val) {
      var r = (reg - val) & 0xff;
      self.p = (self.p & ~C) | (reg >= val ? C : 0);
      self.setNZ(r);
    }

    function adc(m) {
      var c = self.p & C;
      if (self.p & D) {
        var l = (self.a & 0x0f) + (m & 0x0f) + c;
        var h = (self.a >> 4) + (m >> 4);
        if (l > 9) { l += 6; h += 1; }
        // N and V are computed from the binary-ish intermediate, as on NMOS.
        var bin = (self.a + m + c) & 0xff;
        self.p = (self.p & ~(V | N | Z | C));
        self.p |= (~(self.a ^ m) & (self.a ^ (h << 4)) & 0x80) ? V : 0;
        self.p |= ((h << 4) & 0x80);
        self.p |= bin ? 0 : Z;
        if (h > 9) h += 6;
        self.p |= (h > 15) ? C : 0;
        self.a = ((h << 4) | (l & 0x0f)) & 0xff;
      } else {
        var r = self.a + m + c;
        self.p = (self.p & ~(V | C)) |
          ((~(self.a ^ m) & (self.a ^ r) & 0x80) ? V : 0) | (r > 0xff ? C : 0);
        self.a = self.setNZ(r & 0xff);
      }
    }

    function sbc(m) {
      if (self.p & D) {
        var c = (self.p & C) ? 0 : 1;
        var l = (self.a & 0x0f) - (m & 0x0f) - c;
        var h = (self.a >> 4) - (m >> 4);
        if (l & 0x10) { l -= 6; h -= 1; }
        if (h & 0x10) h -= 6;
        var r = self.a - m - c;
        self.p = (self.p & ~(V | C)) |
          (((self.a ^ m) & (self.a ^ (r & 0xff)) & 0x80) ? V : 0) |
          (r >= 0 ? C : 0);
        self.setNZ(r & 0xff);
        self.a = ((h << 4) | (l & 0x0f)) & 0xff;
      } else {
        adc(m ^ 0xff);
      }
    }

    function asl(m) {
      self.p = (self.p & ~C) | ((m & 0x80) ? C : 0);
      return self.setNZ((m << 1) & 0xff);
    }
    function lsr(m) {
      self.p = (self.p & ~C) | (m & 1);
      return self.setNZ(m >> 1);
    }
    function rol(m) {
      var c = self.p & C;
      self.p = (self.p & ~C) | ((m & 0x80) ? C : 0);
      return self.setNZ(((m << 1) | c) & 0xff);
    }
    function ror(m) {
      var c = (self.p & C) ? 0x80 : 0;
      self.p = (self.p & ~C) | (m & 1);
      return self.setNZ((m >> 1) | c);
    }

    // Read-modify-write: the NMOS core writes the unmodified value back first.
    function rmw(addr, fn) {
      var m = self.rd(addr);
      self.wr(addr, m);
      self.wr(addr, fn(m));
    }

    // SLO, RLA, SRE, RRA, DCP and ISC are one read-modify-write instruction
    // each, and all six use the same seven addressing modes at the same offsets
    // from their opcode base — so the mode and the cycle count both come off the
    // low five bits. The counts are the legal read-modify-write ones, and none
    // of them pays a page-cross penalty: a read-modify-write does the extra
    // fetch whether or not the index carried.
    function illRmw() {
      switch (op & 0x1f) {
        case 0x03: self.cycles += 8; return izx();
        case 0x07: self.cycles += 5; return zp();
        case 0x0f: self.cycles += 6; return abs();
        case 0x13: self.cycles += 8; return izy();
        case 0x17: self.cycles += 6; return zpx();
        case 0x1b: self.cycles += 7; return absy();
      }
      self.cycles += 7; return absx();                  // 0x1f
    }

    function bit(m) {
      self.p = (self.p & ~(Z | N | V)) | ((self.a & m) ? 0 : Z) | (m & (N | V));
    }

    switch (op) {
      // --- load / store ---
      case 0xa9: this.a = this.setNZ(this.rd(imm())); this.cycles += 2; break;
      case 0xa5: this.a = this.setNZ(this.rd(zp())); this.cycles += 3; break;
      case 0xb5: this.a = this.setNZ(this.rd(zpx())); this.cycles += 4; break;
      case 0xad: this.a = this.setNZ(this.rd(abs())); this.cycles += 4; break;
      case 0xbd: this.a = this.setNZ(this.rd(absx())); this.cycles += 4 + pageCross; break;
      case 0xb9: this.a = this.setNZ(this.rd(absy())); this.cycles += 4 + pageCross; break;
      case 0xa1: this.a = this.setNZ(this.rd(izx())); this.cycles += 6; break;
      case 0xb1: this.a = this.setNZ(this.rd(izy())); this.cycles += 5 + pageCross; break;

      case 0xa2: this.x = this.setNZ(this.rd(imm())); this.cycles += 2; break;
      case 0xa6: this.x = this.setNZ(this.rd(zp())); this.cycles += 3; break;
      case 0xb6: this.x = this.setNZ(this.rd(zpy())); this.cycles += 4; break;
      case 0xae: this.x = this.setNZ(this.rd(abs())); this.cycles += 4; break;
      case 0xbe: this.x = this.setNZ(this.rd(absy())); this.cycles += 4 + pageCross; break;

      case 0xa0: this.y = this.setNZ(this.rd(imm())); this.cycles += 2; break;
      case 0xa4: this.y = this.setNZ(this.rd(zp())); this.cycles += 3; break;
      case 0xb4: this.y = this.setNZ(this.rd(zpx())); this.cycles += 4; break;
      case 0xac: this.y = this.setNZ(this.rd(abs())); this.cycles += 4; break;
      case 0xbc: this.y = this.setNZ(this.rd(absx())); this.cycles += 4 + pageCross; break;

      case 0x85: this.wr(zp(), this.a); this.cycles += 3; break;
      case 0x95: this.wr(zpx(), this.a); this.cycles += 4; break;
      case 0x8d: this.wr(abs(), this.a); this.cycles += 4; break;
      case 0x9d: this.wr(absx(), this.a); this.cycles += 5; break;
      case 0x99: this.wr(absy(), this.a); this.cycles += 5; break;
      case 0x81: this.wr(izx(), this.a); this.cycles += 6; break;
      case 0x91: this.wr(izy(), this.a); this.cycles += 6; break;

      case 0x86: this.wr(zp(), this.x); this.cycles += 3; break;
      case 0x96: this.wr(zpy(), this.x); this.cycles += 4; break;
      case 0x8e: this.wr(abs(), this.x); this.cycles += 4; break;

      case 0x84: this.wr(zp(), this.y); this.cycles += 3; break;
      case 0x94: this.wr(zpx(), this.y); this.cycles += 4; break;
      case 0x8c: this.wr(abs(), this.y); this.cycles += 4; break;

      // --- transfers / stack ---
      case 0xaa: this.x = this.setNZ(this.a); this.cycles += 2; break;
      case 0xa8: this.y = this.setNZ(this.a); this.cycles += 2; break;
      case 0x8a: this.a = this.setNZ(this.x); this.cycles += 2; break;
      case 0x98: this.a = this.setNZ(this.y); this.cycles += 2; break;
      case 0xba: this.x = this.setNZ(this.s); this.cycles += 2; break;
      case 0x9a: this.s = this.x; this.cycles += 2; break;
      case 0x48: this.push(this.a); this.cycles += 3; break;
      case 0x68: this.a = this.setNZ(this.pull()); this.cycles += 4; break;
      case 0x08: this.push(this.p | B | U); this.cycles += 3; break;
      case 0x28: this.p = (this.pull() & ~B) | U; this.cycles += 4; break;

      // --- logic / arithmetic ---
      case 0x09: this.a = this.setNZ(this.a | this.rd(imm())); this.cycles += 2; break;
      case 0x05: this.a = this.setNZ(this.a | this.rd(zp())); this.cycles += 3; break;
      case 0x15: this.a = this.setNZ(this.a | this.rd(zpx())); this.cycles += 4; break;
      case 0x0d: this.a = this.setNZ(this.a | this.rd(abs())); this.cycles += 4; break;
      case 0x1d: this.a = this.setNZ(this.a | this.rd(absx())); this.cycles += 4 + pageCross; break;
      case 0x19: this.a = this.setNZ(this.a | this.rd(absy())); this.cycles += 4 + pageCross; break;
      case 0x01: this.a = this.setNZ(this.a | this.rd(izx())); this.cycles += 6; break;
      case 0x11: this.a = this.setNZ(this.a | this.rd(izy())); this.cycles += 5 + pageCross; break;

      case 0x29: this.a = this.setNZ(this.a & this.rd(imm())); this.cycles += 2; break;
      case 0x25: this.a = this.setNZ(this.a & this.rd(zp())); this.cycles += 3; break;
      case 0x35: this.a = this.setNZ(this.a & this.rd(zpx())); this.cycles += 4; break;
      case 0x2d: this.a = this.setNZ(this.a & this.rd(abs())); this.cycles += 4; break;
      case 0x3d: this.a = this.setNZ(this.a & this.rd(absx())); this.cycles += 4 + pageCross; break;
      case 0x39: this.a = this.setNZ(this.a & this.rd(absy())); this.cycles += 4 + pageCross; break;
      case 0x21: this.a = this.setNZ(this.a & this.rd(izx())); this.cycles += 6; break;
      case 0x31: this.a = this.setNZ(this.a & this.rd(izy())); this.cycles += 5 + pageCross; break;

      case 0x49: this.a = this.setNZ(this.a ^ this.rd(imm())); this.cycles += 2; break;
      case 0x45: this.a = this.setNZ(this.a ^ this.rd(zp())); this.cycles += 3; break;
      case 0x55: this.a = this.setNZ(this.a ^ this.rd(zpx())); this.cycles += 4; break;
      case 0x4d: this.a = this.setNZ(this.a ^ this.rd(abs())); this.cycles += 4; break;
      case 0x5d: this.a = this.setNZ(this.a ^ this.rd(absx())); this.cycles += 4 + pageCross; break;
      case 0x59: this.a = this.setNZ(this.a ^ this.rd(absy())); this.cycles += 4 + pageCross; break;
      case 0x41: this.a = this.setNZ(this.a ^ this.rd(izx())); this.cycles += 6; break;
      case 0x51: this.a = this.setNZ(this.a ^ this.rd(izy())); this.cycles += 5 + pageCross; break;

      case 0x69: adc(this.rd(imm())); this.cycles += 2; break;
      case 0x65: adc(this.rd(zp())); this.cycles += 3; break;
      case 0x75: adc(this.rd(zpx())); this.cycles += 4; break;
      case 0x6d: adc(this.rd(abs())); this.cycles += 4; break;
      case 0x7d: adc(this.rd(absx())); this.cycles += 4 + pageCross; break;
      case 0x79: adc(this.rd(absy())); this.cycles += 4 + pageCross; break;
      case 0x61: adc(this.rd(izx())); this.cycles += 6; break;
      case 0x71: adc(this.rd(izy())); this.cycles += 5 + pageCross; break;

      case 0xe9: case 0xeb: sbc(this.rd(imm())); this.cycles += 2; break;
      case 0xe5: sbc(this.rd(zp())); this.cycles += 3; break;
      case 0xf5: sbc(this.rd(zpx())); this.cycles += 4; break;
      case 0xed: sbc(this.rd(abs())); this.cycles += 4; break;
      case 0xfd: sbc(this.rd(absx())); this.cycles += 4 + pageCross; break;
      case 0xf9: sbc(this.rd(absy())); this.cycles += 4 + pageCross; break;
      case 0xe1: sbc(this.rd(izx())); this.cycles += 6; break;
      case 0xf1: sbc(this.rd(izy())); this.cycles += 5 + pageCross; break;

      case 0xc9: cmp(this.a, this.rd(imm())); this.cycles += 2; break;
      case 0xc5: cmp(this.a, this.rd(zp())); this.cycles += 3; break;
      case 0xd5: cmp(this.a, this.rd(zpx())); this.cycles += 4; break;
      case 0xcd: cmp(this.a, this.rd(abs())); this.cycles += 4; break;
      case 0xdd: cmp(this.a, this.rd(absx())); this.cycles += 4 + pageCross; break;
      case 0xd9: cmp(this.a, this.rd(absy())); this.cycles += 4 + pageCross; break;
      case 0xc1: cmp(this.a, this.rd(izx())); this.cycles += 6; break;
      case 0xd1: cmp(this.a, this.rd(izy())); this.cycles += 5 + pageCross; break;

      case 0xe0: cmp(this.x, this.rd(imm())); this.cycles += 2; break;
      case 0xe4: cmp(this.x, this.rd(zp())); this.cycles += 3; break;
      case 0xec: cmp(this.x, this.rd(abs())); this.cycles += 4; break;
      case 0xc0: cmp(this.y, this.rd(imm())); this.cycles += 2; break;
      case 0xc4: cmp(this.y, this.rd(zp())); this.cycles += 3; break;
      case 0xcc: cmp(this.y, this.rd(abs())); this.cycles += 4; break;

      case 0x24: bit(this.rd(zp())); this.cycles += 3; break;
      case 0x2c: bit(this.rd(abs())); this.cycles += 4; break;

      // --- shifts ---
      case 0x0a: this.a = asl(this.a); this.cycles += 2; break;
      case 0x06: rmw(zp(), asl); this.cycles += 5; break;
      case 0x16: rmw(zpx(), asl); this.cycles += 6; break;
      case 0x0e: rmw(abs(), asl); this.cycles += 6; break;
      case 0x1e: rmw(absx(), asl); this.cycles += 7; break;

      case 0x4a: this.a = lsr(this.a); this.cycles += 2; break;
      case 0x46: rmw(zp(), lsr); this.cycles += 5; break;
      case 0x56: rmw(zpx(), lsr); this.cycles += 6; break;
      case 0x4e: rmw(abs(), lsr); this.cycles += 6; break;
      case 0x5e: rmw(absx(), lsr); this.cycles += 7; break;

      case 0x2a: this.a = rol(this.a); this.cycles += 2; break;
      case 0x26: rmw(zp(), rol); this.cycles += 5; break;
      case 0x36: rmw(zpx(), rol); this.cycles += 6; break;
      case 0x2e: rmw(abs(), rol); this.cycles += 6; break;
      case 0x3e: rmw(absx(), rol); this.cycles += 7; break;

      case 0x6a: this.a = ror(this.a); this.cycles += 2; break;
      case 0x66: rmw(zp(), ror); this.cycles += 5; break;
      case 0x76: rmw(zpx(), ror); this.cycles += 6; break;
      case 0x6e: rmw(abs(), ror); this.cycles += 6; break;
      case 0x7e: rmw(absx(), ror); this.cycles += 7; break;

      // --- inc / dec ---
      case 0xe6: rmw(zp(), function (m) { return self.setNZ((m + 1) & 0xff); }); this.cycles += 5; break;
      case 0xf6: rmw(zpx(), function (m) { return self.setNZ((m + 1) & 0xff); }); this.cycles += 6; break;
      case 0xee: rmw(abs(), function (m) { return self.setNZ((m + 1) & 0xff); }); this.cycles += 6; break;
      case 0xfe: rmw(absx(), function (m) { return self.setNZ((m + 1) & 0xff); }); this.cycles += 7; break;
      case 0xc6: rmw(zp(), function (m) { return self.setNZ((m - 1) & 0xff); }); this.cycles += 5; break;
      case 0xd6: rmw(zpx(), function (m) { return self.setNZ((m - 1) & 0xff); }); this.cycles += 6; break;
      case 0xce: rmw(abs(), function (m) { return self.setNZ((m - 1) & 0xff); }); this.cycles += 6; break;
      case 0xde: rmw(absx(), function (m) { return self.setNZ((m - 1) & 0xff); }); this.cycles += 7; break;
      case 0xe8: this.x = this.setNZ((this.x + 1) & 0xff); this.cycles += 2; break;
      case 0xc8: this.y = this.setNZ((this.y + 1) & 0xff); this.cycles += 2; break;
      case 0xca: this.x = this.setNZ((this.x - 1) & 0xff); this.cycles += 2; break;
      case 0x88: this.y = this.setNZ((this.y - 1) & 0xff); this.cycles += 2; break;

      // --- flow ---
      case 0x4c: this.pc = abs(); this.cycles += 3; break;
      case 0x6c:
        a = abs();
        // the NMOS page-wrap bug on the vector's low byte
        this.pc = this.rd(a) | (this.rd((a & 0xff00) | ((a + 1) & 0xff)) << 8);
        this.cycles += 5;
        break;
      case 0x20:
        a = abs();
        t = (this.pc - 1) & 0xffff;
        this.push((t >> 8) & 0xff); this.push(t & 0xff);
        this.pc = a; this.cycles += 6;
        break;
      case 0x60:
        this.pc = ((this.pull() | (this.pull() << 8)) + 1) & 0xffff;
        this.cycles += 6;
        break;
      case 0x40:
        this.p = (this.pull() & ~B) | U;
        this.pc = this.pull() | (this.pull() << 8);
        this.cycles += 6;
        break;
      case 0x00:
        this.pc = (this.pc + 1) & 0xffff;
        this.interrupt(0xfffe, true);
        break;

      case 0x10: branch(!(this.p & N)); break;
      case 0x30: branch(!!(this.p & N)); break;
      case 0x50: branch(!(this.p & V)); break;
      case 0x70: branch(!!(this.p & V)); break;
      case 0x90: branch(!(this.p & C)); break;
      case 0xb0: branch(!!(this.p & C)); break;
      case 0xd0: branch(!(this.p & Z)); break;
      case 0xf0: branch(!!(this.p & Z)); break;

      // --- flags ---
      case 0x18: this.p &= ~C; this.cycles += 2; break;
      case 0x38: this.p |= C; this.cycles += 2; break;
      case 0x58: this.p &= ~I; this.cycles += 2; break;
      case 0x78: this.p |= I; this.cycles += 2; break;
      case 0xb8: this.p &= ~V; this.cycles += 2; break;
      case 0xd8: this.p &= ~D; this.cycles += 2; break;
      case 0xf8: this.p |= D; this.cycles += 2; break;
      case 0xea: this.cycles += 2; break;

      // --- undocumented, the ones that show up in real code ---
      case 0xa7: this.a = this.x = this.setNZ(this.rd(zp())); this.cycles += 3; break;
      case 0xb7: this.a = this.x = this.setNZ(this.rd(zpy())); this.cycles += 4; break;
      case 0xaf: this.a = this.x = this.setNZ(this.rd(abs())); this.cycles += 4; break;
      case 0xbf: this.a = this.x = this.setNZ(this.rd(absy())); this.cycles += 4 + pageCross; break;
      case 0xa3: this.a = this.x = this.setNZ(this.rd(izx())); this.cycles += 6; break;
      case 0xb3: this.a = this.x = this.setNZ(this.rd(izy())); this.cycles += 5 + pageCross; break;

      case 0x87: this.wr(zp(), this.a & this.x); this.cycles += 3; break;
      case 0x97: this.wr(zpy(), this.a & this.x); this.cycles += 4; break;
      case 0x8f: this.wr(abs(), this.a & this.x); this.cycles += 4; break;
      case 0x83: this.wr(izx(), this.a & this.x); this.cycles += 6; break;

      case 0xc7: case 0xd7: case 0xcf: case 0xdf: case 0xdb: case 0xc3: case 0xd3:
        rmw(illRmw(), function (m) { m = (m - 1) & 0xff; cmp(self.a, m); return m; });
        break;

      case 0xe7: case 0xf7: case 0xef: case 0xff: case 0xfb: case 0xe3: case 0xf3:
        rmw(illRmw(), function (m) { m = (m + 1) & 0xff; sbc(m); return m; });
        break;

      case 0x07: case 0x17: case 0x0f: case 0x1f: case 0x1b: case 0x03: case 0x13:
        rmw(illRmw(), function (m) { m = asl(m); self.a = self.setNZ(self.a | m); return m; });
        break;

      case 0x27: case 0x37: case 0x2f: case 0x3f: case 0x3b: case 0x23: case 0x33:
        rmw(illRmw(), function (m) { m = rol(m); self.a = self.setNZ(self.a & m); return m; });
        break;

      case 0x47: case 0x57: case 0x4f: case 0x5f: case 0x5b: case 0x43: case 0x53:
        rmw(illRmw(), function (m) { m = lsr(m); self.a = self.setNZ(self.a ^ m); return m; });
        break;

      case 0x67: case 0x77: case 0x6f: case 0x7f: case 0x7b: case 0x63: case 0x73:
        rmw(illRmw(), function (m) { m = ror(m); adc(m); return m; });
        break;

      case 0x0b: case 0x2b:                                     // ANC
        this.a = this.setNZ(this.a & this.rd(imm()));
        this.p = (this.p & ~C) | ((this.a & 0x80) ? C : 0);
        this.cycles += 2;
        break;
      case 0x4b:                                                // ALR
        this.a = lsr(this.a & this.rd(imm())); this.cycles += 2; break;
      case 0x6b:                                                // ARR
        v = this.a & this.rd(imm());
        this.a = ((v >> 1) | ((this.p & C) ? 0x80 : 0)) & 0xff;
        this.setNZ(this.a);
        this.p = (this.p & ~(C | V)) | ((this.a & 0x40) ? C : 0) |
                 (((this.a ^ (this.a << 1)) & 0x40) ? V : 0);
        this.cycles += 2;
        break;
      case 0xcb:                                                // SBX
        v = this.rd(imm());
        t = (this.a & this.x) - v;
        this.p = (this.p & ~C) | (t >= 0 ? C : 0);
        this.x = this.setNZ(t & 0xff);
        this.cycles += 2;
        break;
      case 0x9b:                                                // TAS
        this.s = this.a & this.x;
        a = absy();
        this.wr(a, this.s & (((a >> 8) + 1) & 0xff));
        this.cycles += 5;
        break;
      case 0x9c:                                                // SHY
        a = absx(); this.wr(a, this.y & (((a >> 8) + 1) & 0xff)); this.cycles += 5; break;
      case 0x9e:                                                // SHX
        a = absy(); this.wr(a, this.x & (((a >> 8) + 1) & 0xff)); this.cycles += 5; break;
      case 0x9f: case 0x93:                                     // AHX
        a = (op === 0x9f) ? absy() : izy();
        this.wr(a, this.a & this.x & (((a >> 8) + 1) & 0xff));
        this.cycles += (op === 0x9f) ? 5 : 6;
        break;
      case 0xbb:                                                // LAS
        v = this.rd(absy()) & this.s;
        this.a = this.x = this.s = this.setNZ(v);
        this.cycles += 4 + pageCross;
        break;
      case 0x8b:                                                // XAA — unstable
        this.a = this.setNZ(this.a & this.x & this.rd(imm())); this.cycles += 2; break;
      case 0xab:                                                // LAX #imm — unstable
        this.a = this.x = this.setNZ(this.a & this.rd(imm())); this.cycles += 2; break;

      // undocumented NOPs of every flavor
      case 0x1a: case 0x3a: case 0x5a: case 0x7a: case 0xda: case 0xfa:
        this.cycles += 2; break;
      case 0x80: case 0x82: case 0x89: case 0xc2: case 0xe2:
        imm(); this.cycles += 2; break;
      case 0x04: case 0x44: case 0x64: zp(); this.cycles += 3; break;
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xd4: case 0xf4:
        zpx(); this.cycles += 4; break;
      case 0x0c: this.rd(abs()); this.cycles += 4; break;
      case 0x1c: case 0x3c: case 0x5c: case 0x7c: case 0xdc: case 0xfc:
        this.rd(absx()); this.cycles += 4 + pageCross; break;

      default:
        // 0x02, 0x12, ... — JAM. The real chip locks up; so do we, loudly.
        this.halted = true;
        this.jamOpcode = op;
        this.jamPC = (this.pc - 1) & 0xffff;
        this.cycles += 2;
        break;
    }

    return this.cycles - start;
  };

  // Run at least `n` cycles, returning how many were actually consumed.
  CPU.prototype.run = function (n) {
    var end = this.cycles + n;
    while (this.cycles < end && !this.halted) this.step();
    return this.cycles;
  };

  // The Agat 6502 clock, and the reference for every timing in the emulator.
  AGAT.CPU_HZ = 1020484;
  AGAT.CPU = CPU;
  AGAT.FLAGS = { C: C, Z: Z, I: I, D: D, B: B, U: U, V: V, N: N };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
