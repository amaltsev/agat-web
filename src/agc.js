// .agc — the Agat Container.
//
// One JSON file holding everything needed to run an old program: the image, any
// patches to it, a title, the machine it wants, the interrupt quirks it was
// tuned for, and the keys it is played with. A disk on its own says none of
// that — the model comes from a `7a` in the filename, the interrupt model from
// a menu, and which host key sends the byte the game reads is a puzzle.
//
//   {
//     "agc": 1,
//     "title": "RISE OUT",
//     "author": "Andrew Maltsev",
//     "date": "1989",
//     "url": "https://…",
//     "machine": { "model": 7, "ram": 64 },
//     "quirks":  { "irq": "raster", "rate": 0 },
//     "keys":    { "KeyW": { "code": "^", "note": "Shoot right" },
//                  "Space": { "note": "Jump" } },
//     "media": [ { "name": "rise-out.dsk", "data": ["…", "…"] } ]
//   }
//
// `date` is text, not a number: what is known about an old program is as often
// "circa 1985" or "1990-92" as it is a year.
//
// Two encodings, on purpose. The payload is bulk and gets base64, split into
// short lines so a container is a file a diff can show rather than one endless
// token. A patch is a handful of bytes that someone will want to *read* before
// running the file, so it gets hex: `{ "at": 45312, "hex": "A9 60 85 84" }`.
//
// The payload is the image as it was found, byte for byte; patches are the diff
// and are applied after decoding. That way a container carries a pristine copy
// of what it came from, and what has been changed is legible rather than baked
// in.
(function (AGAT) {
  'use strict';

  var VERSION = 1;

  // Base64 characters per line. 76 is the MIME width, and 57 bytes; being a
  // multiple of 4 it is a whole number of base64 groups, so every line decodes
  // on its own and none of them carries padding but the last.
  var LINE = 76;

  function encode64(bytes, width) {
    width = width || LINE;
    if (width % 4) throw new Error('base64 line width must be a multiple of 4');
    var step = width / 4 * 3, out = [], i, s, j, chunk;
    for (i = 0; i < bytes.length; i += step) {
      chunk = bytes.subarray(i, i + step);
      // Built a character at a time rather than through String.fromCharCode's
      // apply: a line is 57 bytes here, but nothing stops a caller asking for a
      // width that would overflow the argument list.
      s = '';
      for (j = 0; j < chunk.length; j++) s += String.fromCharCode(chunk[j]);
      out.push(btoa(s));
    }
    return out;
  }

  // Lines in, bytes out. Joined before decoding rather than decoded line by
  // line, so a hand-wrapped file whose lines are not whole groups still reads.
  function decode64(data) {
    var s = (typeof data === 'string' ? data : data.join('')).replace(/\s+/g, '');
    var bin = atob(s);
    var out = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Hex with whitespace and commas allowed, so a patch can be grouped the way
  // the bytes mean something: "A9 60  85 84".
  function fromHex(s) {
    var t = String(s).replace(/[\s,]+/g, '');
    if (t.length % 2) throw new Error('hex has an odd number of digits: ' + s);
    if (/[^0-9a-fA-F]/.test(t)) throw new Error('not hex: ' + s);
    var out = new Uint8Array(t.length / 2), i;
    for (i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
    return out;
  }

  function toHex(bytes) {
    var s = [], i;
    for (i = 0; i < bytes.length; i++) {
      s.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16).toUpperCase());
    }
    return s.join(' ');
  }

  // A patched copy. The source is left alone because the container keeps it:
  // saving a container that was loaded from one has to write back the image it
  // was given, not the image it ran.
  function applyPatches(bytes, patches) {
    if (!patches || !patches.length) return bytes;
    var out = new Uint8Array(bytes), i, j, at, b;
    for (i = 0; i < patches.length; i++) {
      at = patches[i].at;
      b = fromHex(patches[i].hex);
      if (!(at >= 0) || at + b.length > out.length) {
        throw new Error('patch at ' + at + ' (' + b.length +
                        ' bytes) falls outside a ' + out.length + '-byte image');
      }
      for (j = 0; j < b.length; j++) out[at + j] = b[j];
    }
    return out;
  }

  // Where two images differ, as patch records. Runs are joined across gaps of
  // up to 8 identical bytes, because a patch that reads as one change should be
  // one record: three separate `at`s for `A9 60 EA EA 85 84` helps nobody.
  function diff(orig, mod) {
    if (orig.length !== mod.length) {
      throw new Error('cannot diff a ' + mod.length + '-byte image against a ' +
                      orig.length + '-byte one — patches are byte-for-byte');
    }
    var out = [], at = -1, last = -1, i;
    for (i = 0; i < orig.length; i++) {
      if (orig[i] === mod[i]) continue;
      if (at < 0 || i - last > 8) {
        if (at >= 0) out.push({ at: at, hex: toHex(mod.subarray(at, last + 1)) });
        at = i;
      }
      last = i;
    }
    if (at >= 0) out.push({ at: at, hex: toHex(mod.subarray(at, last + 1)) });
    return out;
  }

  // Is this text at all, and does it start like an object? A container is UTF-8
  // JSON and every other format here is binary, so this rejects a 2 MB .aim on
  // its first byte rather than trying to decode it.
  function looksLikeJson(bytes) {
    var i;
    for (i = 0; i < bytes.length && i < 64; i++) {
      if (bytes[i] === 0x20 || (bytes[i] >= 0x09 && bytes[i] <= 0x0d)) continue;
      if (bytes[i] === 0xef && bytes[i + 1] === 0xbb && bytes[i + 2] === 0xbf) {
        i += 2;                                        // a UTF-8 BOM, skipped
        continue;
      }
      return bytes[i] === 0x7b;                        // '{'
    }
    return false;
  }

  function text(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  // Null for "not a container" — the sniffer needs that answer for every file
  // dropped on the page. A file that says `"agc"` and then fails to parse is a
  // broken container rather than something else, and says so.
  function parse(bytes, name) {
    if (!looksLikeJson(bytes)) return null;
    var src = text(bytes), c;
    try {
      c = JSON.parse(src);
    } catch (e) {
      if (/"agc"\s*:/.test(src.slice(0, 4096))) {
        throw new Error((name || '.agc') + ': not valid JSON — ' + e.message);
      }
      return null;
    }
    if (!c || typeof c !== 'object' || c.agc === undefined) return null;
    if (!(c.agc <= VERSION)) {
      throw new Error((name || '.agc') + ': made by a newer emulator (agc ' +
                      c.agc + ', this reads ' + VERSION + ')');
    }

    var machine = c.machine || {}, quirks = c.quirks || {};
    var out = {
      version: c.agc,
      name: name || '',
      title: c.title || '',
      // Who wrote the program, when, and where it came from — the container is
      // often the only place that will still say so.
      author: c.author || '',
      date: c.date === undefined ? '' : String(c.date),
      url: c.url || '',
      notes: c.notes || '',
      machine: {
        // Kilobytes, as `ram=` in the URL is; the App wants bytes and converts.
        model: machine.model === 9 ? 9 : machine.model === 7 ? 7 : 0,
        ram: Number(machine.ram) || 0,
      },
      quirks: {
        irq: quirks.irq || '',
        rate: Number(quirks.rate) || 0,
      },
      keys: c.keys || {},
      media: [],
    };

    var list = c.media || [], i, m;
    for (i = 0; i < list.length; i++) {
      m = list[i];
      if (!m || !m.data) throw new Error((name || '.agc') + ': media ' + i + ' has no data');
      var raw = decode64(m.data);
      out.media.push({
        name: m.name || (out.title || 'image'),
        bytes: raw,                                  // as packed, before patches
        patches: m.patches || [],
        payload: applyPatches(raw, m.patches),       // what the machine runs
      });
    }
    return out;
  }

  // The writer both `tools/mkagc.js` and the page's Save button go through, so
  // there is one definition of what a container looks like. Fields are added in
  // the documented order because JSON.stringify keeps insertion order, and a
  // format people are meant to hand-edit should read the same way every time.
  function build(spec) {
    var o = { agc: VERSION };
    if (spec.title) o.title = spec.title;
    if (spec.author) o.author = spec.author;
    if (spec.date) o.date = String(spec.date);
    if (spec.url) o.url = spec.url;
    if (spec.notes) o.notes = spec.notes;
    o.machine = { model: spec.model === 9 ? 9 : 7, ram: spec.ram || 64 };
    o.quirks = { irq: spec.irq || 'raster', rate: spec.rate || 0 };
    if (spec.keys && Object.keys(spec.keys).length) o.keys = spec.keys;
    o.media = (spec.media || []).map(function (m) {
      var e = { name: m.name || 'image' };
      e.data = encode64(m.bytes, spec.width);
      if (m.patches && m.patches.length) e.patches = m.patches;
      return e;
    });
    return JSON.stringify(o, null, 2) + '\n';
  }

  AGAT.agc = {
    parse: parse, build: build,
    encode64: encode64, decode64: decode64,
    fromHex: fromHex, toHex: toHex, applyPatches: applyPatches, diff: diff,
    VERSION: VERSION, LINE: LINE,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
