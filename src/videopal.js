// Color, in its two halves: the monitor tables that turn the machine's 4-bit
// color codes into RGB, and the Agat-9 palette register at $C058-$C05B.
(function (AGAT) {
  'use strict';

  // ---- the monitor ---------------------------------------------------------
  //
  // The machine puts a bare 4-bit code on the RGB connector — R, G, B and a
  // brightness bit — and turning that into a color is the monitor's job, so
  // there is a table per monitor rather than one palette. Values are
  // agatcomp.ru's measured table, «Таблица цветов ЭВМ АГАТ» at
  // Hardware/useful/ColorSet.shtml.
  //
  // `color16` is the common monitor, the second modification of the
  // Электроника 32 ВТЦ 202: the brightness bit raises intensity, so codes 8-F
  // are the bright half — with $8 a near-black gray, far darker than the dim
  // colors. The first modification read the bit the other way, codes 8-F
  // *darker*, and early Agat-9s shipped with it; that is `color16inv`, built
  // from the same levels since ЯБ3.089.026 ТО л.47 gives names rather than
  // measurements: bit 3 flipped, except that $0 stays black — dimming black
  // is still black, and the ТО names both $0 and $8 черный, with $7 белый and
  // $F серый the only white/gray pair. On a monitor
  // with the brightness bit not wired at all the two halves are identical,
  // which is `color8` — and software developed on one mixes codes freely
  // between them, which is why it needs the same monitor here to look right.
  // `gray` is the composite «Видеосигнал» connector: a ladder fixed by the
  // output circuitry, in which green is darker than red — the source stresses
  // that this is not an error.
  var COLOR16 = [
    [0, 0, 0],       [217, 0, 0],     [0, 217, 0],     [217, 217, 0],
    [0, 0, 217],     [217, 0, 217],   [0, 217, 217],   [217, 217, 217],
    [38, 38, 38],    [255, 38, 38],   [38, 255, 38],   [255, 255, 38],
    [38, 38, 255],   [255, 38, 255],  [38, 255, 255],  [255, 255, 255],
  ];
  var GRAYS = [0, 130, 89, 221, 65, 194, 151, 241,
               39, 185, 148, 244, 108, 229, 197, 255];

  function remap(f) {
    var out = [], i;
    for (i = 0; i < 16; i++) out.push(COLOR16[f(i)]);
    return out;
  }

  var MONITORS = {
    color16: COLOR16,
    color8: remap(function (i) { return i & 7; }),
    color16inv: remap(function (i) { return i ? i ^ 8 : 0; }),
    gray: GRAYS.map(function (g) { return [g, g, g]; }),
  };

  AGAT.MONITORS = MONITORS;
  AGAT.MONITOR_DEFAULT = 'color16';
  AGAT.monitorPalette = function (name) {
    return MONITORS[name] || MONITORS[AGAT.MONITOR_DEFAULT];
  };

  // ---- the Agat-9 palette register, $C058-$C05B ------------------------------
  //
  // Two flip-flops, each set by its own address: $C058/$C059 clear/set bit 0,
  // $C05A/$C05B clear/set bit 1. Together they choose one of four small palettes
  // that the 1bpp and 2bpp modes and the text background index into. The 4bpp
  // modes and text *foregrounds* bypass this entirely and address the 16 hardware
  // colors directly.
  //
  // The Agat-7 has no such register — its $C05x page is interrupt control — so it
  // is permanently on palette 0.
  //
  // Values are verbatim from agat-emulator video/videopal.c:4-33; the comments
  // are that file's own labels for them.
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
