// 140K media: sector images turned into the GCR nibble track the Shugart
// controller reads. A direct port of agat-emulator's dsk2nib.c, which uses the
// same encoder fdd1.c does when it loads a track.
//
// Per track, 6656 bytes:
//   125-byte lead gap of FF FF FF FF 00 groups
//   16 x { D5 AA 96, 4-and-4 {vol,track,sector,xor}, DE AA EB,
//          00 FF FF 00 FF FF FF FF 00,
//          D5 AA AD, 0x157 bytes of 6-and-2, DE AA EB,
//          4 x (FF FF FF FF 00) }
//   tail gap out to 6656
//
// Sector numbering: the file is in sequential order, and sector i of the file
// is written with address-field number ren1[i] (DOS 3.3) or pren1[i] (ProDOS).
// Volume is 254, which both controllers hardcode.
(function (AGAT) {
  'use strict';

  var TRACKS = 35;
  var SECTORS = 16;
  var TRACK_LEN = 6656;
  var VOLUME = 254;

  var REN1 = [0x00, 0x0d, 0x0b, 0x09, 0x07, 0x05, 0x03, 0x01,
              0x0e, 0x0c, 0x0a, 0x08, 0x06, 0x04, 0x02, 0x0f];
  var PREN1 = [0x00, 0x02, 0x04, 0x06, 0x08, 0x0a, 0x0c, 0x0e,
               0x01, 0x03, 0x05, 0x07, 0x09, 0x0b, 0x0d, 0x0f];

  var CODE = [
    0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6, 0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
    0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
    0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
    0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
  ];

  // 4-and-4: one byte becomes two, odd bits then even bits, both with $AA set.
  function code44(b, out, o) {
    out[o] = (b >> 1) | 0xaa;
    out[o + 1] = b | 0xaa;
  }

  // 6-and-2. The outer loop counts *down* from 2 while the inner counts down
  // from 0x55; that is what interleaves the low bit-pairs into d[0..0x55].
  //
  // `sind` is an unsigned char in the original and the wrap is load-bearing: it
  // runs 2, 1, 0, 255, 254 … so three passes of the 86-step inner loop walk the
  // whole 256-byte sector. Without the mask a JS transcription goes negative,
  // `while (sind)` stays true, and it never terminates.
  function code62(src, so, out, o) {
    var d = new Uint8Array(0x157);
    var sind = 2, dind, v;
    while (sind) {
      for (dind = 0x55; dind >= 0; --dind) {
        sind = (sind - 1) & 0xff;
        v = src[so + sind];
        d[dind] = ((d[dind] << 1) | (v & 1)) & 0xff;
        v >>= 1;
        d[dind] = ((d[dind] << 1) | (v & 1)) & 0xff;
        v >>= 1;
        d[0x56 + sind] = v;
      }
    }
    var cs = 0;
    for (dind = 0; dind < 0x156; ++dind) {
      var v0 = d[dind];
      out[o + dind] = CODE[(v0 ^ cs) & 0x3f];
      cs = v0;
    }
    out[o + 0x156] = CODE[cs & 0x3f];
  }

  function nibblizeTrack(sectors, so, track, prodos, out, oo) {
    var order = prodos ? PREN1 : REN1;
    var d = oo;
    var i, k;
    var buf = new Uint8Array(4);
    while (d - oo < 128 - 4) {
      out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0x00;
    }
    for (k = 0; k < SECTORS; k++) {
      out[d++] = 0xd5; out[d++] = 0xaa; out[d++] = 0x96;
      buf[0] = VOLUME; buf[1] = track; buf[2] = order[k];
      buf[3] = buf[0] ^ buf[1] ^ buf[2];
      for (i = 0; i < 4; i++) { code44(buf[i], out, d); d += 2; }
      out[d++] = 0xde; out[d++] = 0xaa; out[d++] = 0xeb;

      out[d++] = 0x00; out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0x00;
      out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0x00;

      out[d++] = 0xd5; out[d++] = 0xaa; out[d++] = 0xad;
      code62(sectors, so + k * 256, out, d);
      d += 0x157;
      out[d++] = 0xde; out[d++] = 0xaa; out[d++] = 0xeb;

      for (i = 0; i < 4; i++) {
        out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0x00;
      }
    }
    while (d - oo < TRACK_LEN - 4) {
      out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0xff; out[d++] = 0x00;
    }
    // The last few bytes keep the buffer's 0x22 fill, as the reference encoder
    // leaves them — the gap loop stops 4 short and nothing else touches them.
    return d - oo;
  }

  function media(bytes, s) {
    return new AGAT.Media({
      kind: 'nib140', bytes: bytes, stride: TRACK_LEN, tracks: TRACKS,
      writeProtect: s.writeProtect, name: s.name,
    });
  }

  function fromNib(s) {
    var bytes = new Uint8Array(TRACKS * TRACK_LEN);
    bytes.set(s.payload.subarray(0, TRACKS * TRACK_LEN));
    return media(bytes, s);
  }

  function fromSectors(s) {
    var bytes = new Uint8Array(TRACKS * TRACK_LEN);
    bytes.fill(0x22);                     // what the reference encoder pads with
    for (var t = 0; t < TRACKS; t++) {
      nibblizeTrack(s.payload, t * SECTORS * 256, t, s.prodos, bytes, t * TRACK_LEN);
    }
    return media(bytes, s);
  }

  AGAT.gcr140 = {
    fromNib: fromNib, fromSectors: fromSectors, nibblizeTrack: nibblizeTrack,
    code44: code44, code62: code62,
    TRACKS: TRACKS, SECTORS: SECTORS, TRACK_LEN: TRACK_LEN, VOLUME: VOLUME,
    REN1: REN1, PREN1: PREN1, CODE: CODE,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
