// The Agat-9 palette register, $C058-$C05B.
//
// Two flip-flops, each set by its own address: $C058/$C059 clear/set bit 0,
// $C05A/$C05B clear/set bit 1. Together they choose one of four small palettes
// that the 1bpp and 2bpp modes and the text background index into. The 4bpp
// modes and text *foregrounds* bypass this entirely and address the 16 hardware
// colours directly.
//
// The Agat-7 has no such register — its $C05x page is interrupt control — so it
// is permanently on palette 0.
//
// Values are verbatim from agat-emulator video/videopal.c:4-33; the comments
// are that file's own labels for them.
(function (AGAT) {
  'use strict';

  var PALETTES = [
    { name: '8/a', c1: [0], c2: [0, 15], c4: [0, 1, 2, 4] },
    { name: '9/a', c1: [4], c2: [15, 0], c4: [15, 1, 2, 4] },
    { name: '8/b', c1: [0], c2: [0, 2], c4: [0, 0, 2, 4] },
    { name: '9/b', c1: [5], c2: [2, 0], c4: [0, 1, 0, 4] },
  ];

  function Palette() {
    this.regs = [0, 0];
    this.index = 0;
    this.cur = PALETTES[0];
  }

  // Called for any access in $C058-$C05F; $C05C-$C05F are no-ops.
  Palette.prototype.select = function (reg) {
    if (reg > 3) return;
    this.regs[reg >> 1] = reg & 1;
    this.index = this.regs[0] | (this.regs[1] << 1);
    this.cur = PALETTES[this.index];
  };

  Palette.prototype.reset = function () {
    this.regs[0] = this.regs[1] = 0;
    this.index = 0;
    this.cur = PALETTES[0];
  };

  Palette.LIST = PALETTES;
  AGAT.Palette = Palette;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
