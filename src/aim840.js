// 840K media: turning the three on-disk representations into one AIM-shaped
// stream (byte plane + attribute plane) for the Teac controller.
//
//   .aim  the controller's own byte stream, 160 x 6464 16-bit words
//   .dsk  raw sectors, track*21 + sector, where track = cylinder*2 + head
//   .nib  160 x 21 records of 282 bytes: a 21-byte prolog then a 261-byte sector
//
// The sector layout, which both conversions produce:
//
//   AA x 23, [desync] 95 6A  vol trk sec 5A, AA x 7, [desync] 6A 95,
//   256 data bytes, checksum, 5A                                  = 298 words
//
// Checksum is the add-with-deferred-carry the controller ROM computes at $C5CE.
(function (AGAT) {
  'use strict';

  var TRACKS = 160;
  var SECTORS = 21;
  var SECSIZE = 256;
  var AIM_TRACK = 6464;          // the .aim container's fixed per-track slot
  var SEC_WORDS = 298;           // what fromSectors emits per sector
  var NIB_RECORD = 282;          // .nib: 21-byte prolog + 261-byte sector
  var VOLUME = 0xfe;

  var A_DESYNC = 0x01;
  var A_END = 0x02;

  function checksum(src, off) {
    var cs = 0;
    for (var i = 0; i < SECSIZE; i++) {
      if (cs & 0x100) ++cs;
      cs &= 0xff;
      cs += src[off + i];
    }
    return cs & 0xff;
  }

  function media(bytes, attrs, stride, trackLen, s) {
    return new AGAT.Media({
      kind: 'aim840', bytes: bytes, attrs: attrs, stride: stride,
      tracks: TRACKS, trackLen: trackLen,
      writeProtect: s.writeProtect, name: s.name,
    });
  }

  // .aim — split the interleaved 16-bit words into two planes.
  function fromAim(s) {
    var raw = s.payload;
    var n = TRACKS * AIM_TRACK;
    var bytes = new Uint8Array(n);
    var attrs = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      bytes[i] = raw[i * 2];
      attrs[i] = raw[i * 2 + 1];
    }
    // A track may end early; the format marks that with attribute 0x02.
    var trackLen = new Uint16Array(TRACKS);
    for (var t = 0; t < TRACKS; t++) {
      var len = AIM_TRACK;
      for (var k = 0; k < AIM_TRACK; k++) {
        if (attrs[t * AIM_TRACK + k] === A_END) { len = k; break; }
      }
      trackLen[t] = len || AIM_TRACK;
    }
    return media(bytes, attrs, AIM_TRACK, trackLen, s);
  }

  // .dsk — synthesise the stream. Port of dsk_sector_to_aim() in
  // agatemulator-qt tools/dsk2hfe.c.
  function fromSectors(s) {
    var src = s.payload;
    var stride = SECTORS * SEC_WORDS;                 // 6258
    var bytes = new Uint8Array(TRACKS * stride);
    var attrs = new Uint8Array(TRACKS * stride);
    for (var t = 0; t < TRACKS; t++) {
      var o = t * stride;
      for (var sec = 0; sec < SECTORS; sec++) {
        var i;
        for (i = 0; i < 23; i++) bytes[o++] = 0xaa;
        attrs[o] = A_DESYNC; bytes[o++] = 0x00;
        bytes[o++] = 0x95; bytes[o++] = 0x6a;
        bytes[o++] = VOLUME; bytes[o++] = t; bytes[o++] = sec;
        bytes[o++] = 0x5a;
        for (i = 0; i < 7; i++) bytes[o++] = 0xaa;
        attrs[o] = A_DESYNC; bytes[o++] = 0x00;
        bytes[o++] = 0x6a; bytes[o++] = 0x95;
        var so = (t * SECTORS + sec) * SECSIZE;
        for (i = 0; i < SECSIZE; i++) bytes[o++] = src[so + i];
        bytes[o++] = checksum(src, so);
        bytes[o++] = 0x5a;
      }
    }
    return media(bytes, attrs, stride, null, s);
  }

  // .nib — the records are already prolog+sector in the controller's own
  // encoding; all that is missing is where the sync detector fires. In each
  // 282-byte record the prolog is
  //   FE AA x9 FF AA A4 95 6A vol trk sec 5A AA AA
  // so the A4 at offset 12 stands in for the first desync, and offset 21 (the
  // AA before 6A 95) for the second.
  function fromNib(s) {
    var src = s.payload;
    var stride = SECTORS * NIB_RECORD;                // 5922
    var bytes = new Uint8Array(TRACKS * stride);
    bytes.set(src.subarray(0, TRACKS * stride));
    var attrs = new Uint8Array(TRACKS * stride);
    for (var t = 0; t < TRACKS; t++) {
      for (var sec = 0; sec < SECTORS; sec++) {
        var base = t * stride + sec * NIB_RECORD;
        attrs[base + 12] = A_DESYNC;
        attrs[base + 21] = A_DESYNC;
      }
    }
    var m = media(bytes, attrs, stride, null, s);
    m.headerProtect = true;                           // as agat-emulator does
    return m;
  }

  AGAT.aim840 = {
    fromAim: fromAim, fromSectors: fromSectors, fromNib: fromNib,
    checksum: checksum,
    TRACKS: TRACKS, SECTORS: SECTORS, SECSIZE: SECSIZE,
    AIM_TRACK: AIM_TRACK, SEC_WORDS: SEC_WORDS, NIB_RECORD: NIB_RECORD,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
