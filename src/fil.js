// .fil — a DOS 3.3 file with its catalog entry in front, loaded straight
// into memory instead of through a disk.
//
//   0x00  30  name, high-bit ASCII, $A0 padded
//   0x27   1  DOS file type; must be B ($04, or $84 when locked)
//   0x28   2  load address, little-endian
//   0x2A   2  length, little-endian
//   0x2C   …  the program, padded out to whole 256-byte sectors
//
// AgatF's FILoader runs this at power-on, before the CPU's first cycle: it
// fills RAM with $60 (RTS, so a stray jump lands somewhere harmless), pokes the
// program in, and then forges the warm-start vector at $3F2/$3F3 with its
// validity byte $3F4 = hi ^ $A5. The monitor's own RESET handler sees a valid
// pair and does JMP ($3F2), which is what actually starts the program — the
// loader never sets the PC itself.
(function (AGAT) {
  'use strict';

  var HEADER = 0x2c;

  function poke(m, a, v) {
    var p = m.phys(a);
    if (p >= 0) m.ram[p] = v;
  }

  function loadFil(m, bytes) {
    if (bytes.length < HEADER + 1) throw new Error('.fil too short');
    var type = bytes[0x27];
    if ((type & 0x7f) !== 4) {
      throw new Error('.fil is not a B (binary) file: type $' +
                      type.toString(16).toUpperCase());
    }
    var addr = bytes[0x28] | (bytes[0x29] << 8);
    var len = bytes[0x2a] | (bytes[0x2b] << 8);
    if (addr + len > 0xffff) throw new Error('.fil runs past $FFFF');
    if (addr < 0xd000 && addr + len > 0xbfff) {
      throw new Error('.fil would overlap the I/O page at $C000');
    }
    if (addr >= 0xd000) {
      // Would need the program placed under the $D000-$FFFF paging window and
      // the reset vector forged there too. Nothing seen so far needs it.
      throw new Error('.fil loading above $D000 is not implemented');
    }

    m.reset();
    m.ram.fill(0x60);                       // RTS everywhere

    // Poke through the bank windows: a program can straddle a window boundary,
    // and on the Agat-7 the windows are 16K, so this cannot be one memcpy.
    for (var i = 0; i < len; i++) {
      var p = m.phys((addr + i) & 0xffff);
      if (p >= 0) m.ram[p] = bytes[HEADER + i];
    }

    poke(m, 0x3f2, addr & 0xff);
    poke(m, 0x3f3, (addr >> 8) & 0xff);
    poke(m, 0x3f4, ((addr >> 8) ^ 0xa5) & 0xff);

    // Release the CPU: the monitor's reset path takes the warm-start branch.
    m.cpu.reset();
    return { addr: addr, length: len, type: type };
  }

  // ---- the container, for any type ------------------------------------------
  //
  // A .fil is the file's DOS data stream with a 40-byte header glued in front,
  // and the stream is what DOS keeps in the file's data sectors, byte for byte:
  // `bytes.subarray(0x28)` written into a fresh file and `bytes` read back out
  // of one are the same thing, padding included. Which is why `get` and `put`
  // can round-trip through it without knowing what the file *is*.
  //
  //   0x00  30  name, high-bit KOI-7, $A0 padded
  //   0x1E   5  zero
  //   0x23   2  the stream's length in bytes, load-address prefix included
  //   0x25   2  the load address
  //   0x27   1  DOS file type, $80 for locked
  //   0x28   …  the stream, padded out to whole 256-byte sectors
  //
  // The two fields at 0x23 and 0x25 restate what a `B` file's own first four
  // bytes already say, and 123 of the 156 .fil files in the archive leave them
  // zero — so they are written but never believed. `loadFil` above reads the
  // stream's own copy, as the emulator has always done.
  var FIL_HEADER = 0x28;

  function looks(bytes) {
    return bytes.length >= FIL_HEADER + 256 &&
           (bytes.length - FIL_HEADER) % 256 === 0 &&
           AGAT.Dos33.typeLetter(bytes[0x27]) !== '?';
  }

  function parse(bytes) {
    if (!looks(bytes)) throw new Error('not a .fil: ' + bytes.length + ' bytes');
    var raw = bytes.subarray(0, 30);
    return {
      raw: raw,
      name: AGAT.chars.decode(raw).replace(/\s+$/, ''),
      type: bytes[0x27] & 0x7f,
      locked: (bytes[0x27] & 0x80) !== 0,
      addr: bytes[0x25] | (bytes[0x26] << 8),
      data: bytes.subarray(FIL_HEADER),
    };
  }

  // `f.data` is the stream as DOS holds it; the padding to a whole sector is
  // added here, so a caller hands over exactly what it read off the disk.
  function build(f) {
    var data = f.data;
    var n = Math.ceil(data.length / 256) * 256 || 256;
    var out = new Uint8Array(FIL_HEADER + n), i;
    for (i = 0; i < 30; i++) out[i] = f.raw ? f.raw[i] : 0xa0;
    // The length written is the file's own, not the padded one: a `B` file
    // says how long it is in its third and fourth bytes, and four for the
    // prefix itself is what `CSI.FIL` and `SNAKE.FIL` both carry here.
    if (f.type === 4) {
      var len = 4 + (data[2] | (data[3] << 8));
      out[0x23] = len & 0xff;
      out[0x24] = (len >> 8) & 0xff;
      out[0x25] = data[0];
      out[0x26] = data[1];
    }
    out[0x27] = (f.type & 0x7f) | (f.locked ? 0x80 : 0);
    out.set(data, FIL_HEADER);
    return out;
  }

  AGAT.loadFil = loadFil;
  AGAT.fil = { HEADER: FIL_HEADER, looks: looks, parse: parse, build: build };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
