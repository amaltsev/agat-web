// A disk image as numbered 256-byte sectors, whatever it is stored as.
//
// The controllers read tracks; a file system reads sectors. This is the layer
// between them, and the only place that knows all five encodings answer the
// same two questions:
//
//   read(track, sector)          -> 256 bytes, or null if the track will not
//                                   decode
//   write(track, sector, bytes)  -> the same 256 bytes back where they came
//                                   from
//
// **Writes are surgical.** A sector image is patched in place; a stream image
// — .nib, .aim — has the one sector's data field re-encoded at the offset the
// decoder found it at, and nothing else in the track is touched. So an .aim
// with one file deleted from it is the .aim it was, byte for byte, apart from
// the sector that changed: the gaps, the sync fields, the index marks and the
// physical layout of every other sector survive. Rebuilding a track from its
// sectors would lose all of that, and on a disk formatted by something other
// than the standard formatter it would lose the disk.
//
// A track that will not decode is not an error here — a disk with a deliberately
// unreadable track is a normal thing to be handed — so `read` returns null and
// whoever asked decides what that means.
(function (AGAT) {
  'use strict';

  var SECSIZE = 256;

  // How the five kinds divide up. `stream` is the ones held as a byte stream
  // the controller reads rather than as sectors.
  var KINDS = {
    dsk140: { tracks: 35, perTrack: 16, stream: false },
    nib140: { tracks: 35, perTrack: 16, stream: true },
    dsk840: { tracks: 160, perTrack: 21, stream: false },
    nib840: { tracks: 160, perTrack: 21, stream: true },
    aim840: { tracks: 160, perTrack: 21, stream: true },
  };

  // `data` is the image payload — what `sniff` calls `payload`, minus any
  // header, and owned by the caller. It is written in place, and `pack()` is
  // what puts a stream image's working copy back into it.
  //
  // `opts.media` is the other way in: a `Media` that is already mounted — the
  // disk in a drive — in which case there is no image file behind it and
  // `data` is null. Writes then land in the stream the controller is reading,
  // which is the point: the machine sees the change, and the track is marked
  // written so a save keeps it.
  function Sectors(kind, data, opts) {
    opts = opts || {};
    var k = KINDS[kind];
    if (!k) throw new Error('not a disk image: ' + kind);
    this.kind = kind;
    this.data = data || null;
    this.tracks = k.tracks;
    this.perTrack = k.perTrack;
    this.stream = k.stream;
    this.prodos = !!opts.prodos;
    this.dirty = false;
    this.cache = {};                       // track -> decoded sectors + offsets
    if (opts.media) {
      this.media = opts.media;
    } else if (this.stream) {
      // The controller's own view, built by the same code the emulator mounts
      // an image with — so there is one definition of what a .nib or an .aim
      // holds, and no second transcription of it to drift.
      this.media = AGAT.mount({ kind: kind, payload: data, name: opts.name || '' });
    }
  }

  Sectors.prototype.trackLen = function (t) {
    var m = this.media;
    return (m.trackLen && m.trackLen[t]) || m.stride;
  };

  // A track decoded, cached. `bytes` is perTrack * 256, `at` where each
  // sector's field sits in the stream, `got` how many came back.
  Sectors.prototype.track = function (t) {
    if (this.cache[t]) return this.cache[t];
    var m = this.media, r;
    if (!this.stream) {
      var o = t * this.perTrack * SECSIZE;
      r = { bytes: this.data.subarray(o, o + this.perTrack * SECSIZE),
            at: null, got: this.perTrack };
    } else if (this.kind === 'nib140') {
      r = AGAT.gcr140.denibblizeTrack(m.bytes, m.trackBase(t), this.trackLen(t),
                                      t, this.prodos);
    } else {
      r = AGAT.aim840.desectorizeTrack(m.bytes, m.attrs, m.trackBase(t),
                                       this.trackLen(t), t);
    }
    this.cache[t] = r;
    return r;
  };

  Sectors.prototype.read = function (t, s) {
    if (t < 0 || t >= this.tracks || s < 0 || s >= this.perTrack) return null;
    var r = this.track(t);
    if (r.at && r.at[s] < 0) return null;
    if (!r.at && r.got < this.perTrack) return null;
    return r.bytes.subarray(s * SECSIZE, (s + 1) * SECSIZE);
  };

  // True when the sector was written. False when there is nowhere to put it —
  // an undecodable track, or a sector the formatter never laid down.
  Sectors.prototype.write = function (t, s, bytes) {
    if (t < 0 || t >= this.tracks || s < 0 || s >= this.perTrack) return false;
    if (bytes.length !== SECSIZE) throw new Error('a sector is 256 bytes');
    var r = this.track(t), m = this.media;
    if (!this.stream) {
      this.data.set(bytes, (t * this.perTrack + s) * SECSIZE);
      this.dirty = true;
      return true;
    }
    if (!r.at || r.at[s] < 0) return false;
    if (this.kind === 'nib140') {
      AGAT.gcr140.renibblizeSector(m.bytes, m.trackBase(t), this.trackLen(t),
                                   r.at[s], bytes);
    } else {
      AGAT.aim840.resectorizeSector(m.bytes, m.trackBase(t), this.trackLen(t),
                                    r.at[s], bytes);
    }
    r.bytes.set(bytes, s * SECSIZE);       // the cache, kept in step
    // What `App.writeBack` and the drive lamp read. Nothing looks at it on a
    // Media mounted here for an image file, and setting it costs nothing.
    m.markWritten(t);
    this.dirty = true;
    return true;
  };

  // The working copy back into `data`. A no-op for a sector image, which was
  // written straight through; for a stream image it is the inverse of the mount
  // above, and an untouched image comes back byte for byte.
  Sectors.prototype.pack = function () {
    var m = this.media, t, i, o, base;
    // A disk that came out of a drive has no image file behind it: the Media
    // is the disk, and the writes are already in it.
    if (!this.data) return null;
    if (!this.stream) return this.data;
    if (this.kind === 'nib140') {
      this.data.set(m.bytes.subarray(0, this.tracks * AGAT.Media.NIB140_TRACK));
    } else if (this.kind === 'nib840') {
      var used = AGAT.aim840.SECTORS * AGAT.aim840.NIB_RECORD;
      for (t = 0; t < this.tracks; t++) {
        this.data.set(m.bytes.subarray(m.trackBase(t), m.trackBase(t) + used),
                      t * used);
      }
    } else {
      var W = AGAT.aim840.AIM_TRACK;
      for (t = 0; t < this.tracks; t++) {
        base = m.trackBase(t);
        o = t * W * 2;
        for (i = 0; i < W; i++) {
          this.data[o + i * 2] = m.bytes[base + i];
          this.data[o + i * 2 + 1] = m.attrs[base + i];
        }
      }
    }
    return this.data;
  };

  Sectors.KINDS = KINDS;
  Sectors.SECSIZE = SECSIZE;
  AGAT.Sectors = Sectors;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
