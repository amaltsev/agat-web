// Agat-9 ОЗУ expansion — the "Ext. RAM" card, 128K of RAM that plugs into the
// same eight 8K windows the motherboard's own memory is addressed through.
// agat-emulator fits one in slot 2 as standard (sysconf.c:80).
//
// Ported from xram9.c. The card is the base RAM's mapping hardware over again,
// with two differences that are the whole point of it:
//
//   * its register file is the card's own $Cn00-$CnFF page, not $C100, so it
//     can be told apart from the motherboard;
//   * bit 7 of the register address is an *enable*. A store to $Cn8v points
//     window n at the card's bank v and takes that window over outright; a
//     store with bit 7 clear hands the window back to base RAM. At reset every
//     window is handed back, so a machine with the card fitted is the machine
//     without it until software says otherwise.
//
// The two top windows carry the ПЗУ paging as well, off a mode register of the
// card's own at $C080+16n — the same nibble the motherboard's $C080 takes, and
// the same asymmetry: with reads disabled the window is released and base RAM
// answers, but with writes disabled stores are dropped rather than forwarded.
//
//   bits 1..0  00 read RAM / 01 ROM read, RAM write / 10, 11 read RAM
//   bit 3      which 4K half of window 6's bank backs $D000-$DFFF
//
// Programs find the card by writing $C0n8 and reading the mode back: an empty
// slot answers $FF, and this answers with the slot's own $F0 in the high
// nibble. MouseGraf sweeps slots 1-4 that way before it will start.
(function (AGAT) {
  'use strict';

  var BANK_SHIFT = 13;                 // 8K banks, sixteen of them at 128K
  var BANK_SIZE = 1 << BANK_SHIFT;
  var WINDOWS = 8;

  function Xram9(opts) {
    opts = opts || {};
    // 128K is the only fitting agat-emulator offers (sysconf.c:154-156); a
    // smaller card aliases, as the Agat-7's do, because the bank field is four
    // bits wide whatever is behind it.
    this.size = opts.size || 0x20000;
    this.ram = new Uint8Array(this.size);
    this.map = new Uint8Array(WINDOWS);
    this.on = new Uint8Array(WINDOWS);
    this.mode = 1;
    this.ofs = 0;
    this.slot = -1;                    // set by Machine.addCard; picks $C080+16n
    this.rom = null;                   // the $Cn00 page is the register file
    this.reset();
  }

  // Windows back to the identity map and all of them released. The RAM keeps
  // its contents; xram9.c clears it on HRESET, but that is the emulator
  // tidying up rather than anything the chips do.
  Xram9.prototype.reset = function () {
    for (var i = 0; i < WINDOWS; i++) { this.map[i] = i; this.on[i] = 0; }
    this.setMode(1);
  };

  Xram9.prototype.setMode = function (v) {
    this.mode = v & 0x0b;
    // $D000-$DFFF is one half of window 6's bank; bit 3 picks which.
    this.ofs = (this.mode & 8) ? 0 : -0x1000;
  };

  // ---- $Cn00-$CnFF: the mapping register file -------------------------------
  //
  // Addressed rather than written, like everything else on this machine: the
  // window is bits 6-4 of the address and the bank is bits 3-0. The enable bit
  // is kept in the stored value because a read gives it back.

  Xram9.prototype.readReg = function (a) {
    return (a & 0x70) | this.map[(a & 0x70) >> 4];
  };

  Xram9.prototype.writeReg = function (a) {
    var i = (a & 0x70) >> 4;
    this.map[i] = a & 0x8f;
    this.on[i] = (a & 0x80) ? 1 : 0;
  };

  // ---- $C080+16n: the ПЗУ mode register -------------------------------------

  Xram9.prototype.read = function () {
    var res = this.mode | ((0x80 + this.slot * 16) & 0xf0);
    return (res & 3) ? res : (res | 2);
  };

  Xram9.prototype.write = function (reg) { this.setMode(reg); };

  // ---- memory ---------------------------------------------------------------

  // Has the card taken this window over? Asked of $0000-$BFFF, where an enabled
  // window is the card's for reads and writes alike.
  Xram9.prototype.owns = function (a) { return this.on[a >> BANK_SHIFT] === 1; };

  // The same question for $D000-$FFFF, which is two windows: 6 backs $D000-$DFFF
  // and 7 backs $E000-$FFFF.
  Xram9.prototype.ownsHigh = function (a) {
    return this.on[a < 0xe000 ? 6 : 7] === 1;
  };

  Xram9.prototype.readsRam = function () { return (this.mode & 3) !== 1; };
  Xram9.prototype.writesRam = function () { return (this.mode & 1) !== 0; };

  Xram9.prototype.phys = function (a) {
    return (((this.map[a >> BANK_SHIFT] & 0x0f) << BANK_SHIFT) |
            (a & (BANK_SIZE - 1))) & (this.size - 1);
  };

  // $D000-$DFFF is displaced by the mode's half-bank offset before the window
  // is worked out, which is what lets one 8K bank hold two $D000 pages.
  Xram9.prototype.physHigh = function (a) {
    return this.phys(a < 0xe000 ? (a + this.ofs) & 0xffff : a);
  };

  Xram9.prototype.readMem = function (a) { return this.ram[this.phys(a)]; };
  Xram9.prototype.writeMem = function (a, v) { this.ram[this.phys(a)] = v; };

  Xram9.prototype.readHigh = function (a) { return this.ram[this.physHigh(a)]; };
  Xram9.prototype.writeHigh = function (a, v) { this.ram[this.physHigh(a)] = v; };

  Xram9.BANK_SIZE = BANK_SIZE;
  AGAT.Xram9 = Xram9;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
