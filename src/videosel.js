// The video mode register, $C700-$C7FF on both machines.
//
// The value is the low byte of the *address*, on reads as well as writes — so
// `LDA $C7B2` and `STA $C7B2` both select mode $B2. Reading returns $FF on the
// Agat-7 and the previous mode byte on the Agat-9.
//
// Layout of the mode byte:
//
//   bits 1..0   type      0/1/2/3, meaning depends on the machine
//   bits 3..2   subpage   which 2K quarter of an 8K page (text and lgr only)
//   bits 7..4   page      which 8K page of physical RAM
//
// Both decoders are transcriptions of agat-emulator video/videosel7.c and
// videosel9.c. `vtype` keeps that source's numbering so the two can be compared
// line by line:
//
//   0 64x64x4   1 128x128x4   2 Text32   3 256x256x1   4 Text64
//   5 256x256x2 6 512x256x1   10 Text64 inverse
//
// `base` is a PHYSICAL RAM offset. The video hardware scans memory directly and
// does not go through the CPU's bank windows.
(function (AGAT) {
  'use strict';

  var LGR = 0, MGR = 1, T32 = 2, HGR = 3, T64 = 4, MCGR = 5, DGR = 6, T64I = 10;

  // Agat-7. The page field is masked by how much RAM is fitted, so the same
  // mode byte means different things on a 32K and a 128K machine.
  function sel7(mode, ramSize) {
    var blocks = (ramSize >> 14) || 2;               // 16K units
    var page = (mode >> 4) & (blocks * 2 - 1);
    var subpage = (mode >> 2) & 3;
    var type = mode & 3;
    switch (type) {
      case 0:
        return r(LGR, (page << 13) + (subpage << 11), 0x800, 1);
      case 1:
        return r(MGR, page << 13, 0x2000, 1);
      case 2:
        page &= 7;
        if (mode & 0x80) {
          // 64-column text; bit 2 doubles as normal-vs-inverse here.
          return r((mode & 4) ? T64 : T64I, (page << 13) + (subpage << 11), 0x800, 1);
        }
        return r(T32, (page << 13) + (subpage << 11), 0x800, 2);
      default:
        return r(HGR, page << 13, 0x2000, 1);
    }
  }

  // Agat-9. Drops 64x64x4 and inverse text, adds the two interleaved modes.
  function sel9(mode) {
    var page = (mode >> 4) & 7;
    var subpage = (mode >> 2) & 3;
    var type = mode & 3;
    if (type !== 2 && (mode & 8)) page |= 8;         // 4th page bit
    switch (type) {
      case 0:
        page &= ~1;                                   // 16K aligned
        return r(MCGR, page << 13, 0x4000, 1);
      case 1:
        return r(MGR, page << 13, 0x2000, 1);
      case 2:
        if (mode & 0x80) {
          return r(T64, (page << 13) + (subpage << 11), 0x800, 1);
        }
        return r(T32, (page << 13) + (subpage << 11), 0x800, 2);
      default:
        if (mode & 0x80) {
          page &= ~1;
          return r(DGR, page << 13, 0x4000, 1);
        }
        return r(HGR, page << 13, 0x2000, 1);
    }
  }

  function r(vtype, base, size, elSize) {
    return { vtype: vtype, base: base, size: size, elSize: elSize };
  }

  AGAT.videoSel = { sel7: sel7, sel9: sel9 };
  AGAT.VTYPE = { LGR: LGR, MGR: MGR, T32: T32, HGR: HGR, T64: T64,
                 MCGR: MCGR, DGR: DGR, T64I: T64I };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
