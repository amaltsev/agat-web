// gzip, and the unpacking for the gzip+base64 blobs in roms/. Uses the
// platform's own CompressionStream/DecompressionStream so the same code runs in
// the browser and under Node, and so the page needs no fetch() and works from
// file://.
//
// Both directions are promises, because the streams are: nothing here can be
// done in the middle of a synchronous function, which is why reading an .agc
// and writing one are the two asynchronous edges of the container code.
(function (AGAT) {
  'use strict';

  function b64ToBytes(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Bytes in, bytes out, through one of the two streams.
  //
  // The writer's own promises are dropped on purpose: when the data is not what
  // the stream was expecting — a `gz` field in a container that is not gzip —
  // both ends reject, and the read side is the one that gets to say so. Left
  // alone the write side would surface as an unhandled rejection, which in Node
  // takes the process down while the caller is still handling the error.
  function through(stream, bytes) {
    var w = stream.writable.getWriter(), ignore = function () {};
    w.write(bytes).then(ignore, ignore);
    w.close().then(ignore, ignore);
    return new Response(stream.readable).arrayBuffer().then(function (b) {
      return new Uint8Array(b);
    });
  }

  // gzip rather than raw deflate: it is what roms/ already carries, what
  // `gunzip` on a decoded payload understands, and the 18 bytes of header are
  // not worth a second format. The streams take no level — what comes out is
  // whatever the platform's zlib defaults to, which is why nothing here should
  // ever compare compressed bytes for equality.
  function gzip(bytes) { return through(new CompressionStream('gzip'), bytes); }
  function gunzip(bytes) { return through(new DecompressionStream('gzip'), bytes); }

  AGAT.gzip = gzip;
  AGAT.gunzip = gunzip;
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
