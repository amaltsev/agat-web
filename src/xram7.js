// Agat-7 ОЗУ expansion — the slot card that can take $8000-$BFFF over from base
// RAM, one 16K bank at a time out of its own 32K. On a 32K board it is the only
// thing that reaches those addresses at all. The stock machine here is 64K base
// + this + a 32K ЭмПЗУ.
//
// It powers up deselected (ТО4 §3.4.4: "после включения питания всегда
// происходит автоматическая установка нулевого слова состояния"), so it is
// never what a program finds at $8000-$BFFF at reset.
//
// Ported from agat-emulator xram7.c. The control register is the slot's whole
// $Cn00-$CnFF page and, like the ЭмПЗУ next door, takes its value from the
// address rather than the data — but only seven bits of it, so $C480 is another
// name for $C400 (xram7.c:154). Reading returns the state.
//
//   bits 2..0  16K bank within the card's RAM
//   bit 3      module selected. Set, the card answers $8000-$BFFF; clear, it
//              lets go and the address belongs to base RAM again — which has
//              anything there only on a 64K or 128K machine.
//   bit 4      write protect. The card still answers reads; stores are dropped.
//
// The card is invisible to the video controller, which scans base RAM and never
// this. That is not an omission: agat-emulator calls vid_invalidate_addr from
// baseram.c and from neither xram7.c nor psrom7.c, because on the boards the
// scanner is wired to the motherboard's memory.
(function (AGAT) {
  'use strict';

  var BANK_SHIFT = 14;                 // 16K banks
  var ADDR_MASK = (1 << BANK_SHIFT) - 1;

  function Xram7(opts) {
    opts = opts || {};
    this.size = opts.size || 0x8000;   // 32K, agat-emulator's default fitting
    this.ram = new Uint8Array(this.size);
    this.state = 0;
    this.rom = null;                   // no $Cn00 ROM; the page is the register
  }

  // The card does not decode $C080+16n. agat-emulator's xram7_init fills only
  // io_sel, never baseio_sel, so that page stays open bus — see Machine.ioRead.
  Xram7.prototype.ioRegs = false;

  // Deselected and back to bank 0, contents kept, as the chips do. (HRESET in
  // xram7.c:79 also clears the array; that is the emulator tidying up, not the
  // hardware.)
  Xram7.prototype.reset = function () { this.state = 0; };

  Xram7.prototype.saveState = function () {
    return { state: this.state, ram: this.ram };
  };

  Xram7.prototype.loadState = function (s) {
    this.state = s.state & 0x7f;
    if (s.ram) this.ram.set(s.ram);
  };

  // Whether $8000-$BFFF is the card's rather than base RAM's.
  Xram7.prototype.selected = function () { return (this.state & 0x08) !== 0; };

  Xram7.prototype.writeProtected = function () { return (this.state & 0x10) !== 0; };

  // One 16K bank, wrapped by however much RAM is fitted: with the default 32K
  // the 3-bit bank field reaches only two distinct banks and the rest alias.
  Xram7.prototype.offset = function (a) {
    return (((this.state & 7) << BANK_SHIFT) + (a & ADDR_MASK)) & (this.size - 1);
  };

  Xram7.prototype.read = function (a) { return this.ram[this.offset(a)]; };

  Xram7.prototype.write = function (a, v) {
    if (this.state & 0x10) return;
    this.ram[this.offset(a)] = v;
  };

  // The slot's $Cn00-$CnFF page. Seven bits of the address, not eight.
  Xram7.prototype.readReg = function () { return this.state & 0x7f; };
  Xram7.prototype.writeReg = function (a) { this.state = a & 0x7f; };

  Xram7.BANK_SHIFT = BANK_SHIFT;
  AGAT.Xram7 = Xram7;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
