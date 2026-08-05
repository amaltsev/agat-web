// Media — what a controller actually reads.
//
// Every image format is normalised at mount time into one of two shapes, so no
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
    this.writeProtect = !!opts.writeProtect;
    this.name = opts.name || '';
  }

  function fill(arr, v) {
    for (var i = 0; i < arr.length; i++) arr[i] = v;
    return arr;
  }

  Media.prototype.trackBase = function (t) { return t * this.stride; };

  Media.NIB140_TRACK = NIB140_TRACK;
  Media.NIB140_TRACKS = NIB140_TRACKS;
  Media.AIM840_TRACK = AIM840_TRACK;
  Media.AIM840_TRACKS = AIM840_TRACKS;
  AGAT.Media = Media;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
