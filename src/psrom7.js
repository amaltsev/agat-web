// Agat-7 ЭмПЗУ — the "ROM emulator" card, a slot card that puts RAM behind
// $D000-$FFFF. The Agat-7 has no built-in language card: base RAM stops at
// $BFFF, and everything above it is I/O and the 2K monitor. Software that wants
// a character generator at $D000, a disk driver at $E000 or a splash screen at
// $D800 — which is exactly how RISE OUT is laid out — needs this card.
//
// Ported from agat-emulator psrom7.c. The control register is the slot's whole
// $Cn00-$CnFF page and, like several Agat registers, takes its value from the
// address rather than the data: a store anywhere in the page sets the state to
// that address's low byte with bit 7 forced on. Reading returns the state.
//
//   bits 2..0  16K bank within the card's RAM
//   bit 5      read enable. Set, the card answers reads and ignores writes;
//              clear, it is write-only and reads fall through to the ROM.
//   bit 6      which 4K half of the bank appears at $D000-$DFFF
//
// Within a 16K bank: $0000-$0FFF and $1000-$1FFF are the two $D000 halves,
// $2000-$3FFF backs $E000-$FFFF. Read-enabled, it covers the monitor at $F800.
(function (AGAT) {
  'use strict';

  var BANK_SHIFT = 14;                 // 16K banks
  var ADDR_MASK = (1 << BANK_SHIFT) - 1;

  function Psrom7(opts) {
    opts = opts || {};
    // 32K as standard, and as agat-emulator fits it by default
    // (sysconf.c:143-146).
    // The 3-bit bank field reaches 128K, which is the most an override can ask
    // for; below that the top banks alias.
    this.size = opts.size || 0x8000;
    this.ram = new Uint8Array(this.size);
    this.state = 0x80;
    this.rom = null;                   // no $Cn00 ROM; the page is the register
  }

  // The card does not decode $C080+16n. agat-emulator's psrom7_init fills only
  // io_sel, never baseio_sel, so that page stays open bus — see Machine.ioRead.
  Psrom7.prototype.ioRegs = false;

  // Bank 0, reads off: the card is out of the way and $D000-$FFFF is the bare
  // machine again. Its RAM keeps its contents, as the chips do.
  Psrom7.prototype.reset = function () { this.state = 0x80; };

  // The card as a snapshot: the bank register and the chips behind it. A
  // Uint8Array here is packed by state.js; the card never sees base64.
  Psrom7.prototype.saveState = function () {
    return { state: this.state, ram: this.ram };
  };

  // Into the card that is already fitted, never over it: `ram` is filled in
  // place so everything holding a reference to it goes on holding the same
  // array. state.js has already checked the size matches.
  Psrom7.prototype.loadState = function (s) {
    this.state = s.state & 0xff;
    if (s.ram) this.ram.set(s.ram);
  };

  Psrom7.prototype.readsRam = function () { return (this.state & 0x20) !== 0; };

  // $D000-$DFFF comes from one half of the bank, $E000-$FFFF from the top half.
  Psrom7.prototype.offset = function (a) {
    if (a < 0xe000 && !(this.state & 0x40)) a -= 0x1000;
    return (((this.state & 7) << BANK_SHIFT) + (a & ADDR_MASK)) & (this.size - 1);
  };

  Psrom7.prototype.read = function (a) { return this.ram[this.offset(a)]; };

  // Writes land whenever the card is not read-enabled; with reads on, the card
  // is a ROM and stores are dropped.
  Psrom7.prototype.write = function (a, v) {
    if (this.readsRam()) return;
    this.ram[this.offset(a)] = v;
  };

  // The slot's $Cn00-$CnFF page.
  Psrom7.prototype.readReg = function () { return this.state | 0x80; };
  Psrom7.prototype.writeReg = function (a) { this.state = (a & 0xff) | 0x80; };

  Psrom7.BANK_SHIFT = BANK_SHIFT;
  AGAT.Psrom7 = Psrom7;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
