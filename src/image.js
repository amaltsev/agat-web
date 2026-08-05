// Working out what a dropped file is.
//
// By SIZE, not by extension — extensions on real Agat images lie routinely.
// SysImages9a/onix.800.dsk is 2 068 480 bytes, i.e. an .aim; half the
// SysImages7a/*.140.dsk files are 232 960 bytes, i.e. nibble images. Agat
// Emulator itself sniffs `strstr(path,"nib")`, which is why it mis-handles
// exactly those files; AgatF classifies purely by size, and so do we.
//
// A file may carry a 256-byte "Agathe emulator virtual disk" header in front of
// the payload; the +4 and +128 variants are trailing epilogues instead. The two
// are mutually exclusive in practice.
(function (AGAT) {
  'use strict';

  var HEADER_SIZE = 256;
  var SIGNATURE = 'Agathe emulator virtual disk\r\n\x1aAD';   // 33 bytes

  // payload size -> kind. Trailing epilogues give the extra accepted totals.
  var SIZES = {
    143360: 'dsk140', 143364: 'dsk140', 143488: 'dsk140',
    232960: 'nib140',
    860160: 'dsk840', 860164: 'dsk840', 860288: 'dsk840',
    947520: 'nib840',
    2068480: 'aim840',
  };

  // How many bytes of each kind are actually payload; the rest is epilogue.
  var PAYLOAD = {
    dsk140: 143360, nib140: 232960,
    dsk840: 860160, nib840: 947520, aim840: 2068480,
  };

  function hasHeader(b) {
    if (b.length < HEADER_SIZE) return false;
    for (var i = 0; i < SIGNATURE.length; i++) {
      if (b[i] !== SIGNATURE.charCodeAt(i)) return false;
    }
    return true;
  }

  // A .fil is a DOS 3.3 file plus its catalogue entry: 40-byte header, then the
  // body padded to whole 256-byte sectors. Type at 0x27 must be B ($04/$84).
  function isFil(b) {
    return b.length > 44 && (b.length - 40) % 256 === 0 && (b[0x27] & 0x7f) === 4;
  }

  AGAT.sniff = function (bytes, name) {
    name = name || '';
    var head = hasHeader(bytes);
    var body = head ? bytes.subarray(HEADER_SIZE) : bytes;
    var kind = SIZES[body.length] || null;

    if (!kind && isFil(bytes)) {
      return {
        kind: 'fil', name: name, payload: bytes,
        loadAddr: bytes[0x28] | (bytes[0x29] << 8),
        length: bytes[0x2a] | (bytes[0x2b] << 8),
        fileType: bytes[0x27],
        filName: filName(bytes),
      };
    }
    if (!kind) return { kind: null, name: name, size: bytes.length };

    return {
      kind: kind,
      name: name,
      payload: body.subarray(0, PAYLOAD[kind]),
      writeProtect: head ? bytes[48] !== 0 : false,
      // Agat Emulator's own heuristic, and the only signal a file carries about
      // its sector order.
      prodos: /\.po$/i.test(name) || /\.po\b/i.test(name),
      // agat.sh infers the machine from the path; so do we, as a default only.
      hintModel: /7a|\bagat-?7\b/i.test(name) ? 7
               : /9a|\bagat-?9\b/i.test(name) ? 9 : null,
    };
  };

  function filName(b) {
    var s = '';
    for (var i = 0; i < 30; i++) {
      var c = b[i] & 0x7f;
      if (c === 0x20 && (b[i] === 0xa0)) continue;
      if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
    }
    return s.trim();
  }

  // Normalise into the shape the controllers read.
  AGAT.mount = function (s) {
    switch (s.kind) {
      case 'aim840': return AGAT.aim840.fromAim(s);
      case 'dsk840': return AGAT.aim840.fromSectors(s);
      case 'nib840': return AGAT.aim840.fromNib(s);
      case 'nib140': return AGAT.gcr140.fromNib(s);
      case 'dsk140': return AGAT.gcr140.fromSectors(s);
      default:
        throw new Error('not a disk image: ' + (s.name || '') +
                        (s.size ? ' (' + s.size + ' bytes)' : ''));
    }
  };

  AGAT.SIZES = SIZES;
  AGAT.HEADER_SIZE = HEADER_SIZE;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
