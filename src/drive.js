// Media — what a controller actually reads.
//
// Every image format is normalized at mount time into one of two shapes, so no
// controller ever has to know about file formats:
//
//   nib140   35 tracks x 6656 bytes, a GCR nibble stream
//   aim840   160 tracks x N words, byte plane + attribute plane
//
// The attribute plane is the .aim high byte: 0x01/0x80 desync (the hardware
// sync detector fired), 0x02 end of track, 0x03/0x13 index mark start/end.
(function (AGAT) {
  'use strict';

  var NIB140_TRACK = 6656;
  var NIB140_TRACKS = 35;
  var AIM840_TRACK = 6464;
  var AIM840_TRACKS = 160;

  function Media(opts) {
    this.kind = opts.kind;                 // 'nib140' | 'aim840'
    this.bytes = opts.bytes;               // Uint8Array, tracks * stride
    this.attrs = opts.attrs || null;       // aim840 only
    this.stride = opts.stride;
    this.tracks = opts.tracks;
    this.trackLen = opts.trackLen ||
      fill(new Uint16Array(opts.tracks), opts.stride);
    // Every disk arrives locked, whatever it says about itself: a program that
    // writes to the disk it booted from is doing something the person watching
    // has not asked for, and the tab holds the only copy. `headerProtect` keeps
    // what the file claimed, which is worth saying in the drive's tooltip even
    // though nothing turns on it.
    this.locked = true;
    this.headerProtect = !!opts.writeProtect;
    // Which tracks have been written since the disk was mounted. Per track
    // rather than per byte because saving works a track at a time: a written
    // track is decoded back to its 16 sectors whole.
    this.written = new Uint8Array(opts.tracks);
    // Per track: 0 not looked at, 1 no index mark, 2 index mark present. Filled
    // in by hasIndexMark().
    this.indexed = null;
    this.name = opts.name || '';
  }

  // The bit software reads at $C0EE, and the one the user controls: the same
  // bit, so a disk that refuses writes is a disk that says so beforehand.
  Object.defineProperty(Media.prototype, 'writeProtect', {
    get: function () { return this.locked; },
  });

  Media.prototype.markWritten = function (t) {
    this.written[t] = 1;
    if (this.indexed) this.indexed[t] = 0;      // the attributes may have moved
  };

  Media.prototype.isWritten = function () {
    for (var t = 0; t < this.written.length; t++) if (this.written[t]) return true;
    return false;
  };

  function fill(arr, v) {
    for (var i = 0; i < arr.length; i++) arr[i] = v;
    return arr;
  }

  Media.prototype.trackBase = function (t) { return t * this.stride; };

  // Does this track carry an index mark — a 0x03/0x13 attribute pair? Most .aim
  // images do not, and every stream synthesised from sectors or nibbles has
  // none, so the controller has to fall back to the start of the track for the
  // index signal. Scanned once per track and cached.
  Media.prototype.hasIndexMark = function (t) {
    if (!this.attrs) return false;
    if (!this.indexed) this.indexed = new Uint8Array(this.tracks);
    if (!this.indexed[t]) {
      var base = this.trackBase(t), len = this.trackLen[t] || this.stride;
      this.indexed[t] = 1;
      for (var i = 0; i < len; i++) {
        if ((this.attrs[base + i] & 0xef) === 0x03) { this.indexed[t] = 2; break; }
      }
    }
    return this.indexed[t] === 2;
  };

  Media.NIB140_TRACK = NIB140_TRACK;
  Media.NIB140_TRACKS = NIB140_TRACKS;
  Media.AIM840_TRACK = AIM840_TRACK;
  Media.AIM840_TRACKS = AIM840_TRACKS;
  AGAT.Media = Media;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
