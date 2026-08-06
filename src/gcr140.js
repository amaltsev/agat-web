// 140K media: sector images turned into the GCR nibble track the Shugart
// controller reads, and back again. The encoder is a direct port of
// agat-emulator's dsk2nib.c, which uses the same one fdd1.c does when it loads
// a track; the decoder is its inverse and has no upstream to be ported from.
//
// The decoder exists so that a disk written while the machine runs can be saved
// as a handful of 256-byte patches on the sector image it came from, rather
// than as a whole nibble stream. It lives here, beside the encoder, because the
// two share every table and the only way to read one is against the other.
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

  // --- the way back ---------------------------------------------------------

  // CODE inverted; 0xff for the 192 byte values a disk byte can never be.
  var DECODE = (function () {
    var t = new Uint8Array(256), i;
    for (i = 0; i < 256; i++) t[i] = 0xff;
    for (i = 0; i < CODE.length; i++) t[CODE[i]] = i;
    return t;
  })();

  // Every (dind, sind) pair code62's double loop touches, in the order it
  // touches them. Generated by that loop's own control flow rather than by a
  // second derivation of it: decoding walks this list backwards, so the two
  // directions cannot drift apart. It is 258 pairs, not 256 — sind 0 and 1 are
  // visited twice, carrying the same source bits both times.
  var VISIT = (function () {
    var v = [], sind = 2, dind;
    while (sind) {
      for (dind = 0x55; dind >= 0; --dind) {
        sind = (sind - 1) & 0xff;
        v.push(dind, sind);
      }
    }
    return v;
  })();

  function decode44(a, b) { return ((a << 1) | 1) & b; }

  // The inverse of code62. False for a field that is not one: an invalid disk
  // byte, or a checksum that does not come out to the trailing nibble.
  function decode62(nib, o, out, oo) {
    var d = new Uint8Array(0x156), cs = 0, i, n, b, dind, sind;
    for (i = 0; i < 0x156; i++) {
      n = DECODE[nib[o + i]];
      if (n === 0xff) return false;
      cs ^= n;                                   // running, as the encoder's is
      d[i] = cs;
    }
    n = DECODE[nib[o + 0x156]];
    if (n === 0xff || n !== cs) return false;
    // d[0x56 + s] is the top six bits of byte s; the low pair is in d[0..0x55],
    // appended bit 0 first and then bit 1, once per pass. Unwinding pops two
    // bits at a time in the reverse of the order they went on.
    for (i = 0; i < 256; i++) out[oo + i] = d[0x56 + i] << 2;
    for (i = VISIT.length - 2; i >= 0; i -= 2) {
      dind = VISIT[i]; sind = VISIT[i + 1]; b = d[dind];
      out[oo + sind] = (out[oo + sind] & 0xfc) | ((b >> 1) & 1) | ((b & 1) << 1);
      d[dind] = b >> 2;
    }
    return true;
  }

  // Read one track's worth of nibbles back into the 16 sectors of a .dsk.
  //
  // The track is a ring, so a field may straddle its end and the scan wraps.
  // Sectors are placed by the number in the address field run back through the
  // interleave, which is what puts a sector DOS calls 13 at the file offset it
  // was nibblized from.
  //
  // Returns the sectors and how many were recovered; a caller that cannot use a
  // partial track compares `got` with SECTORS.
  function denibblizeTrack(bytes, base, len, track, prodos) {
    var order = prodos ? PREN1 : REN1;
    var out = new Uint8Array(SECTORS * 256);
    var seen = new Uint8Array(SECTORS);
    var field = new Uint8Array(0x157), sector = new Uint8Array(256);
    var p, q, n, i, vol, trk, sec, k, got = 0;

    function g(x) { return bytes[base + (x % len)]; }

    for (p = 0; p < len; p++) {
      if (g(p) !== 0xd5 || g(p + 1) !== 0xaa || g(p + 2) !== 0x96) continue;
      vol = decode44(g(p + 3), g(p + 4));
      trk = decode44(g(p + 5), g(p + 6));
      sec = decode44(g(p + 7), g(p + 8));
      if ((vol ^ trk ^ sec) !== decode44(g(p + 9), g(p + 10))) continue;
      // A sector image is in physical track order and has nowhere to record an
      // address field that disagrees with where the head is.
      if (trk !== track) continue;
      k = order.indexOf(sec);
      if (k < 0 || seen[k]) continue;
      // The data field follows after an epilogue and a gap. 64 bytes is well
      // clear of the 13 the encoder writes and well short of the next address
      // field, so a sector whose data field was never written is not credited
      // with the following sector's.
      for (n = 0, q = p + 11; n < 64; n++, q++) {
        if (g(q) === 0xd5 && g(q + 1) === 0xaa && g(q + 2) === 0xad) break;
      }
      if (n === 64) continue;
      for (i = 0; i < 0x157; i++) field[i] = g(q + 3 + i);
      if (!decode62(field, 0, sector, 0)) continue;
      out.set(sector, k * 256);
      seen[k] = 1;
      got++;
    }
    return { bytes: out, seen: seen, got: got };
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
    decode44: decode44, decode62: decode62, denibblizeTrack: denibblizeTrack,
    TRACKS: TRACKS, SECTORS: SECTORS, TRACK_LEN: TRACK_LEN, VOLUME: VOLUME,
    REN1: REN1, PREN1: PREN1, CODE: CODE, DECODE: DECODE,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
