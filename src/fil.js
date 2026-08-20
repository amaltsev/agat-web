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

  AGAT.loadFil = loadFil;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
