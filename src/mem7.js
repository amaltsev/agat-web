// Agat-7 base memory.
//
// 32K, 64K or 128K, banked in 16K units through three windows covering $0000,
// $4000 and $8000. Which windows are actually switchable depends on how much
// RAM is fitted:
//
//    32K   $0000-$7FFF direct, $8000-$BFFF is open bus
//    64K   $0000-$7FFF direct, $8000-$BFFF banked
//   128K   $0000-$3FFF direct, $4000-$7FFF and $8000-$BFFF banked
//
// The bank register is $C0F0-$C0FF and takes its value from the low nibble of
// the *address*, on reads as well as writes — so `LDA $C0F3` and `STA $C0F3`
// both select state 3. The Agat-7 monitor drives it that way at $F862:
//
//   AND #$07 / TAY / LDA $F869,Y / TAY / STA $C0F0,Y / RTS
//
// Decode tables are verbatim from agat-emulator baseram.c:475-502. This is a
// genuinely different machine from the Agat-9, which banks in 8K units through
// a register file at $C100-$C1FF — see mem9 in machine.js.
(function (AGAT) {
  'use strict';

  var BLOCK = 0x4000;                 // 16K windows

  // 128K, state bit 3 set: both upper windows move.
  var NO1 = [1, 1, 4, 5, 1, 1, 4, 5];   // -> $4000-$7FFF
  var NO2 = [2, 3, 6, 7, 2, 3, 6, 7];   // -> $8000-$BFFF
  // 128K, state bit 3 clear: $4000-$7FFF is pinned to bank 1.
  var NO = [2, 3, 6, 7, 2, 3, 4, 5];    // -> $8000-$BFFF

  function Mem7(ramSize) {
    this.ramSize = ramSize || 0x8000;
    this.map = new Int32Array(3);
    this.state = 0;
    this.reset();
  }

  Mem7.prototype.reset = function () {
    this.map[0] = 0;
    this.map[1] = 1 * BLOCK;
    this.map[2] = 2 * BLOCK;
    this.state = 0;
  };

  Mem7.prototype.setState = function (state) {
    this.state = state & 0x0f;
    if (this.ramSize <= 0x8000) return;                 // 32K: nothing to bank
    if (this.ramSize <= 0x10000) {                      // 64K: one bit, one window
      this.map[2] = ((state & 1) ? 3 : 2) * BLOCK;
      return;
    }
    var s = state & 7;
    this.map[0] = 0;
    if (state & 8) {
      this.map[1] = NO1[s] * BLOCK;
      this.map[2] = NO2[s] * BLOCK;
    } else {
      this.map[1] = 1 * BLOCK;
      this.map[2] = NO[s] * BLOCK;
    }
  };

  // CPU address -> physical index, or -1 for open bus.
  Mem7.prototype.phys = function (a) {
    if (a >= 0xc000) return -1;
    if (a >= 0x8000 && this.ramSize <= 0x8000) return -1;
    return this.map[a >> 14] + (a & (BLOCK - 1));
  };

  Mem7.BLOCK = BLOCK;
  Mem7.NO = NO;
  Mem7.NO1 = NO1;
  Mem7.NO2 = NO2;
  AGAT.Mem7 = Mem7;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
