// Unpacking for the gzip+base64 blobs in assets/. Uses DecompressionStream so
// the same code runs in the browser and under Node, and so the page needs no
// fetch() and works from file://.
(function (AGAT) {
  'use strict';

  function b64ToBytes(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function gunzip(bytes) {
    var ds = new DecompressionStream('gzip');
    var w = ds.writable.getWriter();
    w.write(bytes);
    w.close();
    return new Response(ds.readable).arrayBuffer().then(function (b) {
      return new Uint8Array(b);
    });
  }

  AGAT.unpack = function (b64) { return gunzip(b64ToBytes(b64)); };

  // A disk blob is the .aim word stream split in two: the data bytes, then the
  // per-word attribute bytes (0x01/0x80 desync, 0x02 end of track, 0x03/0x13
  // index mark).
  AGAT.unpackDisk = function (entry) {
    return AGAT.unpack(entry.data).then(function (blob) {
      var n = entry.tracks * AGAT.Disk840.TRACK_WORDS;
      return { bytes: blob.subarray(0, n), attrs: blob.subarray(n, n * 2) };
    });
  };

  AGAT.loadRoms = function (roms) {
    var keys = Object.keys(roms).filter(function (k) { return k !== 'palette'; });
    return Promise.all(keys.map(function (k) { return AGAT.unpack(roms[k]); }))
      .then(function (vals) {
        var out = { palette: roms.palette };
        keys.forEach(function (k, i) { out[k] = vals[i]; });
        return out;
      });
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
