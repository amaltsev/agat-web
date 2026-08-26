// The renderer.
//
// Native Agat modes paint into a 512x256 buffer of palette indices, expanded
// once per frame through a 16-entry color table. Painters iterate over *source
// addresses* rather than screen coordinates, so every addr -> (x,y) formula
// stays in the same shape as agat-emulator's video/videoprocs.c and can be
// compared with it line by line.
//
// Two things that are easy to get wrong and are load-bearing here:
//
//   - `base` is a physical RAM offset. The video hardware scans memory itself
//     and does not go through the CPU's bank windows. On the Agat-9 a page
//     number reaches $1E000, well past the 64K the CPU can see at once.
//   - the glyph bit window is a property of the font. Agat-7 characters live in
//     bits 7..1, Agat-9 in bits 6..0. Font and mask travel together.
//
// The whole frame is redrawn every time. The C invalidates per written byte
// because it repaints into a shared GDI bitmap; here the worst mode reads 16K
// and writes 128K, which costs less than a write hook on every RAM store would.
(function (AGAT) {
  'use strict';

  var W = 512, H = 256;                 // native raster
  var APPLE_W = 280, APPLE_H = 192;
  var V = AGAT.VTYPE;

  function Video(font, palette, opts) {
    opts = opts || {};
    this.setFont(font, opts.m0);
    this.setPalette(palette);
    this.idx = new Uint8Array(W * H);
    // One row of Apple hires dots, unpacked: the color of a dot depends on the
    // one after it, which is in the next byte every seventh dot.
    this.hgrBits = new Uint8Array(APPLE_W + 1);
    this.hgrPal = new Uint8Array(APPLE_W);
    this.pixels = new Uint8ClampedArray(W * H * 4);
    this.width = W;
    this.height = H;
    this.flash = false;
  }

  // Agat-7 glyphs occupy bits 7..1, Agat-9 bits 6..0 — pass the matching m0.
  Video.prototype.setFont = function (font, m0) {
    this.font = font || new Uint8Array(2048);
    this.m0 = m0 || 0x80;
  };

  Video.prototype.setPalette = function (pal) {
    this.palette = pal || AGAT.monitorPalette();
    this.rgb = new Uint8Array(16 * 3);
    for (var i = 0; i < 16; i++) {
      var c = this.palette[i] || [0, 0, 0];
      this.rgb[i * 3] = c[0]; this.rgb[i * 3 + 1] = c[1]; this.rgb[i * 3 + 2] = c[2];
    }
  };

  // ---- glyphs --------------------------------------------------------------

  // One 8x7 glyph. `dx` is how many buffer pixels a dot occupies.
  Video.prototype.glyph = function (o, ch, tc, bc, dx) {
    var f = this.font, m0 = this.m0, idx = this.idx;
    var g = (ch & 0xff) * 8;
    for (var r = 0; r < 8; r++) {
      var bits = f[g + r], m = m0, p = o + r * W;
      for (var k = 0; k < 7; k++, m >>= 1) {
        var c = (bits & m) ? tc : bc;
        for (var d = 0; d < dx; d++) idx[p++] = c;
      }
    }
  };

  function paintBlock(idx, x, y, w, h, c) {
    for (var r = 0; r < h; r++) {
      var o = (y + r) * W + x;
      for (var k = 0; k < w; k++) idx[o++] = c;
    }
  }

  // ---- native painters -----------------------------------------------------

  // 64x64x4, Agat-7 only. 32 bytes/row, two 4-bit pixels each, high nibble left.
  Video.prototype.lgr = function (ram, mask, base) {
    var idx = this.idx;
    for (var a = 0; a < 0x800; a++) {
      var b = ram[(base + a) & mask];
      var x = ((a << 1) & 63) << 3;
      var y = ((a >> 5) & 63) << 2;
      paintBlock(idx, x, y, 8, 4, b >> 4);
      paintBlock(idx, x + 8, y, 8, 4, b & 15);
    }
  };

  // 128x128x4. 64 bytes/row, high nibble left.
  Video.prototype.mgr = function (ram, mask, base) {
    var idx = this.idx;
    for (var a = 0; a < 0x2000; a++) {
      var b = ram[(base + a) & mask];
      var x = ((a << 1) & 127) << 2;
      var y = ((a >> 6) & 127) << 1;
      paintBlock(idx, x, y, 4, 2, b >> 4);
      paintBlock(idx, x + 4, y, 4, 2, b & 15);
    }
  };

  // 256x256x1. 32 bytes/row, MSB leftmost.
  Video.prototype.hgr = function (ram, mask, base, pal) {
    var idx = this.idx, c0 = pal.c2[0], c1 = pal.c2[1];
    for (var a = 0; a < 0x2000; a++) {
      var b = ram[(base + a) & mask];
      var o = ((a >> 5) & 255) * W + (((a << 3) & 255) << 1);
      for (var k = 0; k < 8; k++, b = (b << 1) & 0xff) {
        var c = (b & 0x80) ? c1 : c0;
        idx[o++] = c; idx[o++] = c;
      }
    }
  };

  // 512x256x1, Agat-9. 16K interleaved: low 8K is the even scanlines, high 8K
  // the odd ones.
  Video.prototype.dgr = function (ram, mask, base, pal) {
    var idx = this.idx, c0 = pal.c2[0], c1 = pal.c2[1];
    for (var a = 0; a < 0x4000; a++) {
      var b = ram[(base + a) & mask];
      var y = (a >> 5) & ~1;
      if (y & 0x100) y -= 0xff;
      var o = y * W + ((a & 63) << 3);
      for (var k = 0; k < 8; k++, b = (b << 1) & 0xff) {
        idx[o++] = (b & 0x80) ? c1 : c0;
      }
    }
  };

  // 256x256x2, Agat-9. Same interleave, four colors, MSB pair leftmost.
  Video.prototype.mcgr = function (ram, mask, base, pal) {
    var idx = this.idx, p = pal.c4;
    for (var a = 0; a < 0x4000; a++) {
      var b = ram[(base + a) & mask];
      var y = (a >> 5) & ~1;
      if (y & 0x100) y -= 0xff;
      var o = y * W + (((a & 63) << 2) << 1);
      for (var n = 0; n < 4; n++, b = (b << 2) & 0xff) {
        var c = p[b >> 6];
        idx[o++] = c; idx[o++] = c;
      }
    }
  };

  // Text 32x32: character and attribute byte pairs.
  //
  // Attribute: bits 2..0 plus bit 4 give a 4-bit foreground; bit 5 forces normal
  // video, bit 3 flashes, and with both clear the cell is permanently inverse.
  Video.prototype.t32 = function (ram, mask, base, pal) {
    var bg0 = pal.c1[0];
    for (var a = 0; a < 0x800; a += 2) {
      var ch = ram[(base + a) & mask];
      var atr = ram[(base + a + 1) & mask];
      var tc = (atr & 7) | ((atr & 16) ? 8 : 0);
      var bc = bg0;
      var sel = atr & 0x28;
      if (sel === 0 || (sel === 8 && this.flash)) { bc = tc; tc = bg0; }
      var x = 32 + 14 * ((a >> 1) & 31);
      var y = 8 * ((a >> 6) & 31);
      this.glyph(y * W + x, ch, tc, bc, 2);
    }
  };

  // Text 64x32: no attributes, one color pair for the whole screen.
  Video.prototype.t64 = function (ram, mask, base, tc, bc) {
    for (var a = 0; a < 0x800; a++) {
      var x = 32 + 7 * (a & 63);
      var y = 8 * ((a >> 6) & 31);
      this.glyph(y * W + x, ram[(base + a) & mask], tc, bc, 1);
    }
  };

  // ---- Apple-compatible painters (Agat-9 only) -----------------------------

  function appleTextRow(row, page2) {
    return (page2 ? 0x0800 : 0x0400) + (row & 7) * 0x80 + (row >> 3) * 0x28;
  }
  function appleHiresRow(y, page2) {
    return (page2 ? 0x4000 : 0x2000) +
           (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;
  }

  // The character set an Apple program writes is not the one the Agat-9's font
  // is in. $80-$FF is normal video and reaches the font unchanged; the inverse
  // and flashing halves below it carry six bits of character, which the
  // controller reads out of the font's own $80 block — bit 7 set, bit 6 clear
  // (videoprocs.c, apaint_t40_addr). That block is `@A-Z` again, and differs
  // from the $C0-$DF one at exactly two codes: `·` at $9E and `Ё` at $9F,
  // which is the Ё a Russian program prints.
  function appleGlyphOf(ch) {
    return ch < 0x80 ? 0x80 + (ch & 0x3f) : ch;
  }

  // Glyph bits are 6..0 here whatever font window the machine's own text modes
  // use: these modes are on the Agat-9 alone, whose m0 is $40.
  Video.prototype.appleGlyph = function (o, ch, tc, bc) {
    var f = this.font, idx = this.idx, g = appleGlyphOf(ch) * 8;
    for (var r = 0; r < 8; r++) {
      var bits = f[g + r], p = o + r * W;
      for (var k = 0; k < 7; k++) idx[p++] = ((bits >> (6 - k)) & 1) ? tc : bc;
    }
  };

  // Bits 7..6 are the attribute: 0 is inverse, 1 is inverse while the flash is
  // on, 2 and 3 are normal. The pair it inverts is the palette register's,
  // the same one the native text modes take their background from.
  Video.prototype.appleText = function (m, first, last, page2) {
    var c2 = m.palette.cur.c2, fg = c2[1], bg = c2[0];
    for (var row = first; row < last; row++) {
      var b = appleTextRow(row, page2);
      for (var col = 0; col < 40; col++) {
        var c = m.ram[m.phys(b + col)], atr = c >> 6;
        var inv = atr === 0 || (atr === 1 && this.flash);
        this.appleGlyph(row * 8 * W + col * 7, c, inv ? bg : fg, inv ? fg : bg);
      }
    }
  };

  var GR_PAL = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];

  Video.prototype.appleLores = function (m, first, last, page2) {
    var idx = this.idx;
    for (var row = first; row < last; row++) {
      var b = appleTextRow(row, page2);
      for (var col = 0; col < 40; col++) {
        var v = m.ram[m.phys(b + col)];
        for (var half = 0; half < 2; half++) {
          var c = GR_PAL[(half ? v >> 4 : v) & 15];
          for (var r = 0; r < 4; r++) {
            var o = (row * 8 + half * 4 + r) * W + col * 7;
            for (var k = 0; k < 7; k++) idx[o++] = c;
          }
        }
      }
    }
  };

  // Apple hires is a color mode: the dot clock runs at twice the color
  // subcarrier, so a lone dot comes out tinted by the column it lands in and
  // bit 7 of its byte shifts the whole septet by half a dot into the other
  // pair. agat-emulator paints the artifact rather than the signal
  // (video/videoprocs.c, apaint_hgr_addr_color) and these are its two color
  // pairs: bit 7 clear gives violet/green, set gives cyan/red — the Agat
  // palette's stand-ins for the Apple's blue/orange.
  var HGR_PAIRS = [[5, 10], [6, 9]];
  var HGR_WHITE = 15, HGR_BLACK = 0;

  // A dot whose neighbour on either side is lit reads as white; only an
  // isolated one keeps its color. `wasc` carries the previous dot's color, so
  // a run of two or more comes out white all the way along.
  //
  // What the C does and this does not is `fill` — bleeding a color into the
  // dark dot that follows a run — because it sets `fill` from
  // `cursystype != SYSTEM_9` and these modes exist on no other machine here.
  Video.prototype.appleHires = function (m, first, last, page2) {
    var idx = this.idx, bits = this.hgrBits, pal = this.hgrPal;
    for (var y = first; y < last; y++) {
      var b = appleHiresRow(y, page2), x = 0, col, k, v;
      for (col = 0; col < 40; col++) {
        v = m.ram[m.phys(b + col)];
        for (k = 0; k < 7; k++, x++) { bits[x] = (v >> k) & 1; pal[x] = v >> 7; }
      }
      bits[APPLE_W] = 0;                // nothing follows the last dot of a row
      var o = y * W, wasc = HGR_BLACK;
      for (x = 0; x < APPLE_W; x++) {
        var c = HGR_BLACK;
        if (bits[x]) {
          c = (wasc || bits[x + 1]) ? HGR_WHITE : HGR_PAIRS[pal[x]][x & 1];
        }
        idx[o + x] = wasc = c;
      }
    }
  };

  // ---- frame ---------------------------------------------------------------

  Video.prototype.render = function (m) {
    // 200 ms flash, counted in CPU cycles so headless renders are reproducible.
    this.flash = (((m.cpu.cycles / 204097) | 0) & 1) !== 0;
    this.idx.fill(0);

    if (m.appleVideo) {
      this.width = APPLE_W; this.height = APPLE_H;
      var page2 = m.page2;
      if (m.text) this.appleText(m, 0, 24, page2);
      else {
        var split = m.mixed ? 20 : 24;
        if (m.hires) this.appleHires(m, 0, split * 8, page2);
        else this.appleLores(m, 0, split, page2);
        if (m.mixed) this.appleText(m, split, 24, page2);
      }
      return this.expand();
    }

    this.width = W; this.height = H;
    var sel = m.videoMode();
    var pal = m.palette.cur;
    var ram = m.ram, mask = ram.length - 1;
    switch (sel.vtype) {
      case V.LGR:  this.lgr(ram, mask, sel.base); break;
      case V.MGR:  this.mgr(ram, mask, sel.base); break;
      case V.HGR:  this.hgr(ram, mask, sel.base, pal); break;
      case V.DGR:  this.dgr(ram, mask, sel.base, pal); break;
      case V.MCGR: this.mcgr(ram, mask, sel.base, pal); break;
      case V.T32:  this.t32(ram, mask, sel.base, pal); break;
      case V.T64:  this.t64(ram, mask, sel.base, pal.c2[1], pal.c2[0]); break;
      case V.T64I: this.t64(ram, mask, sel.base, 0, 15); break;
      default: break;
    }
    return this.expand();
  };

  Video.prototype.expand = function () {
    var idx = this.idx, px = this.pixels, rgb = this.rgb;
    var stride = W - this.width;
    var si = 0, di = 0;
    for (var y = 0; y < this.height; y++) {
      for (var x = 0; x < this.width; x++) {
        var c = idx[si++] * 3;
        px[di++] = rgb[c]; px[di++] = rgb[c + 1]; px[di++] = rgb[c + 2]; px[di++] = 255;
      }
      si += stride;
    }
    return px;
  };

  // ---- text dump for the headless tools ------------------------------------

  Video.charOf = AGAT.chars.glyph;

  // Reads the live text page for whatever mode is currently selected.
  Video.dumpText = function (m) {
    var out = [], row, col, s, b;
    if (m.appleVideo) {
      for (row = 0; row < 24; row++) {
        s = '';
        b = appleTextRow(row, m.page2);
        for (col = 0; col < 40; col++) s += Video.charOf(m.ram[m.phys(b + col)]);
        out.push('|' + s + '|');
      }
      return out.join('\n');
    }
    var sel = m.videoMode();
    var mask = m.ram.length - 1;
    if (sel.vtype === V.T32) {
      for (row = 0; row < 32; row++) {
        s = '';
        for (col = 0; col < 32; col++) {
          s += Video.charOf(m.ram[(sel.base + row * 64 + col * 2) & mask]);
        }
        out.push('|' + s + '|');
      }
    } else if (sel.vtype === V.T64 || sel.vtype === V.T64I) {
      for (row = 0; row < 32; row++) {
        s = '';
        for (col = 0; col < 64; col++) {
          s += Video.charOf(m.ram[(sel.base + row * 64 + col) & mask]);
        }
        out.push('|' + s + '|');
      }
    } else {
      out.push('(graphics, vtype ' + sel.vtype + ' base $' +
               sel.base.toString(16).toUpperCase() + ')');
    }
    return out.join('\n');
  };

  Video.W = W;
  Video.H = H;
  Video.APPLE_W = APPLE_W;
  Video.APPLE_H = APPLE_H;
  AGAT.Video = Video;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
