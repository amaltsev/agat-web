// 840K media: turning the three on-disk representations into one AIM-shaped
// stream (byte plane + attribute plane) for the Teac controller, and a written
// stream back into sectors.
//
//   .aim  the controller's own byte stream, 160 x 6464 16-bit words
//   .dsk  raw sectors, track*21 + sector, where track = cylinder*2 + head
//   .nib  160 x 21 records of 282 bytes: a 21-byte prolog then a 261-byte sector
//
// The sector layout, which both conversions produce:
//
//   AA x 22, [desync] 95 6A  vol trk sec 5A, AA x 7, [desync] 6A 95,
//   256 data bytes, checksum, 5A                                  = 297 words
//
// A synthesised track is one revolution long — 6250 bytes, which is 250 kbit/s
// for the 200 ms of a turn at 300 rpm — laid out in the .aim slot of 6464 words
// with an end mark at 6250 and gap behind the last sector. The length is what
// the factory computer test measures between index pulses (TESTKOM9's speed
// check wants it within 1%), and it is the room a formatter has: 21 records of
// 282 come to 5922 and leave none for the gaps one writes.
//
// Checksum is the add-with-deferred-carry the controller ROM computes at $C5CE.
(function (AGAT) {
  'use strict';

  var TRACKS = 160;
  var SECTORS = 21;
  var SECSIZE = 256;
  var AIM_TRACK = 6464;          // the .aim container's fixed per-track slot
  var PHYS_TRACK = 6250;         // one revolution: 250 kbit/s x 200 ms
  var SEC_WORDS = 297;           // what fromSectors emits per sector
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

  // The gap behind a synthesised track's last sector, and the end mark that
  // makes the revolution 6250 bytes long: what is left of the slot behind it is
  // never under the head.
  function pad(bytes, attrs, o, base) {
    while (o < base + AIM_TRACK) bytes[o++] = 0xaa;
    attrs[base + PHYS_TRACK] = A_END;
  }

  function physLen() {
    var trackLen = new Uint16Array(TRACKS);
    for (var t = 0; t < TRACKS; t++) trackLen[t] = PHYS_TRACK;
    return trackLen;
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
    var stride = AIM_TRACK;                           // 21 x 297 = 6237, then gap
    var bytes = new Uint8Array(TRACKS * stride);
    var attrs = new Uint8Array(TRACKS * stride);
    for (var t = 0; t < TRACKS; t++) {
      var o = t * stride;
      for (var sec = 0; sec < SECTORS; sec++) {
        var i;
        for (i = 0; i < 22; i++) bytes[o++] = 0xaa;
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
      pad(bytes, attrs, o, t * stride);
    }
    return media(bytes, attrs, stride, physLen(), s);
  }

  // .nib — the records are already prolog+sector in the controller's own
  // encoding; all that is missing is where the sync detector fires. In each
  // 282-byte record the prolog is
  //   FE AA x9 FF AA A4 95 6A vol trk sec 5A AA AA
  // so the A4 at offset 12 stands in for the first desync, and offset 21 (the
  // AA before 6A 95) for the second.
  function fromNib(s) {
    var src = s.payload;
    var stride = AIM_TRACK;                           // 21 x 282 = 5922, then gap
    var used = SECTORS * NIB_RECORD;
    var bytes = new Uint8Array(TRACKS * stride);
    var attrs = new Uint8Array(TRACKS * stride);
    for (var t = 0; t < TRACKS; t++) {
      bytes.set(src.subarray(t * used, (t + 1) * used), t * stride);
      pad(bytes, attrs, t * stride + used, t * stride);
      for (var sec = 0; sec < SECTORS; sec++) {
        var base = t * stride + sec * NIB_RECORD;
        attrs[base + 12] = A_DESYNC;
        attrs[base + 21] = A_DESYNC;
      }
    }
    var m = media(bytes, attrs, stride, physLen(), s);
    m.headerProtect = true;                           // as agat-emulator does
    return m;
  }

  // One .nib record, the way the records above are laid out, for a sector
  // that has to be written back into a .nib payload.
  function nibRecord(t, sec, data, out, o) {
    var i;
    out[o++] = 0xfe;
    for (i = 0; i < 9; i++) out[o++] = 0xaa;
    out[o++] = 0xff; out[o++] = 0xaa; out[o++] = 0xa4;
    out[o++] = 0x95; out[o++] = 0x6a;
    out[o++] = VOLUME; out[o++] = t; out[o++] = sec; out[o++] = 0x5a;
    out[o++] = 0xaa; out[o++] = 0xaa;
    out[o++] = 0xaa; out[o++] = 0x6a; out[o++] = 0x95;
    for (i = 0; i < SECSIZE; i++) out[o++] = data[i];
    out[o++] = checksum(data, 0);
    out[o++] = 0x5a;
  }

  // ---- the way back ---------------------------------------------------------

  // The 21 sectors of one track, read out of the stream the way the ROM reads
  // them: a sync mark, then 95 6A vol trk sec 5A; a sync mark, then 6A 95, the
  // data, and a checksum that has to agree. `got` counts the distinct sectors
  // found, and only a track with all 21 has a sector image to be saved as.
  // The mark carries either attribute value, and the walk wraps at `len` so a
  // field the index splits still counts.
  function desectorizeTrack(bytes, attrs, base, len, t) {
    var out = new Uint8Array(SECTORS * SECSIZE);
    var seen = new Uint8Array(SECTORS);
    var got = 0;
    var b = function (i) { return bytes[base + (i % len)]; };
    var marked = function (i) { return (attrs[base + (i % len)] & 0x81) !== 0; };
    var i = 0, want = -1;
    // Two passes over the track: an address whose data field lies past the
    // index is finished on the way round again.
    while (i < len * 2) {
      if (!marked(i)) { i++; continue; }
      if (b(i + 1) === 0x95 && b(i + 2) === 0x6a) {
        var trk = b(i + 4), sec = b(i + 5);
        want = (trk === t && sec < SECTORS && b(i + 6) === 0x5a) ? sec : -1;
        i += 7;
        continue;
      }
      if (want >= 0 && b(i + 1) === 0x6a && b(i + 2) === 0x95) {
        var cs = 0, k;
        for (k = 0; k < SECSIZE; k++) {
          if (cs & 0x100) ++cs;
          cs &= 0xff;
          cs += b(i + 3 + k);
        }
        if ((cs & 0xff) === b(i + 3 + SECSIZE) && !seen[want]) {
          for (k = 0; k < SECSIZE; k++) out[want * SECSIZE + k] = b(i + 3 + k);
          seen[want] = 1;
          got++;
        }
        i += 3 + SECSIZE + 1;
        want = -1;
        continue;
      }
      i++;
    }
    return { got: got, bytes: out };
  }

  // A medium as a .aim payload again: the two planes interleaved back into
  // 16-bit words. Every 840K medium keeps a whole 6464-word slot per track —
  // an early end mark and whatever the file had behind it included — so this
  // is a plain interleave and an unwritten .aim comes back byte for byte.
  function toAim(m) {
    var out = new Uint8Array(TRACKS * AIM_TRACK * 2);
    for (var t = 0; t < TRACKS; t++) {
      var base = m.trackBase(t), o = t * AIM_TRACK * 2;
      for (var i = 0; i < AIM_TRACK; i++) {
        out[o + i * 2] = m.bytes[base + i];
        out[o + i * 2 + 1] = m.attrs[base + i];
      }
    }
    return out;
  }

  AGAT.aim840 = {
    fromAim: fromAim, fromSectors: fromSectors, fromNib: fromNib,
    desectorizeTrack: desectorizeTrack, nibRecord: nibRecord, toAim: toAim,
    checksum: checksum,
    TRACKS: TRACKS, SECTORS: SECTORS, SECSIZE: SECSIZE,
    AIM_TRACK: AIM_TRACK, PHYS_TRACK: PHYS_TRACK, SEC_WORDS: SEC_WORDS,
    NIB_RECORD: NIB_RECORD,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
