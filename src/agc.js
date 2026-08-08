// .agc — the Agat Container.
//
// One JSON file holding everything needed to run an old program: the image, any
// patches to it, a title, the machine it wants, the interrupt quirks it was
// tuned for, and the controls it is played with. A disk on its own says none of
// that — the model comes from a `7a` in the filename, the interrupt model from
// a menu, and which host key sends the byte the game reads is a puzzle.
//
//   {
//     "agc": 1,
//     "title": "RISE OUT",
//     "author": "Andrew Maltsev",
//     "date": "1989",
//     "url": "https://…",
//     "machine": { "model": 7, "ram": 64,
//                  "slots": { "4": { "card": "xram", "ram": 64 } } },
//     "quirks":  { "irq": "raster", "rate": 0 },
//     "keys":    { "KeyW": { "code": "^" } },
//     "controls": { "Play": { "Up Down Left Right": "Move",
//                             "^": "Shoot right" } },
//     "media": [ { "name": "rise-out.dsk", "data": ["…", "…"] } ]
//   }
//
// `date` is text, not a number: what is known about an old program is as often
// "circa 1985" or "1990-92" as it is a year.
//
// Two encodings, on purpose. The payload is bulk and gets base64, split into
// short lines so a container is a file a diff can show rather than one endless
// token. A patch of a few bytes is something someone will want to *read* before
// running the file, so it gets hex: `{ "at": 45312, "hex": "A9 60 85 84" }`. A
// patch that is a rewritten disk sector is not read by eye and would be three
// times the size in hex, so past `HEX_MAX` it takes the payload's base64,
// wrapped the same way: `{ "at": 45312, "data": ["…", "…"] }`. Either form is
// accepted wherever a patch is; giving both is an error.
//
// The payload is the image as it was found, byte for byte; patches are the diff
// and are applied after decoding. That way a container carries a pristine copy
// of what it came from, and what has been changed is legible rather than baked
// in.
(function (AGAT) {
  'use strict';

  // The version a container is written as, and the newest one this can read.
  // `build` still writes `agc: 1` unless it emits something a version-1 reader
  // would get wrong — see `formatVersion`.
  var VERSION = 2;

  // Cards a `machine.slots` entry may name. Anything else is dropped: a
  // container from a newer emulator should run on the hardware this one has
  // rather than fail, and the `agc:` version is what refuses when it must.
  var CARDS = { psrom: 1, xram: 1, fdd140: 1, fdd840: 1 };

  // Base64 characters per line. 76 is the MIME width, and 57 bytes; being a
  // multiple of 4 it is a whole number of base64 groups, so every line decodes
  // on its own and none of them carries padding but the last.
  var LINE = 76;

  // Bytes of patch that still read as bytes. Above this a record is a rewritten
  // sector rather than a poke, so it goes to base64: hex would be three times
  // the size of something nobody reads by eye anyway.
  var HEX_MAX = 32;

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

  // What one patch record says to write. Both keys at once is refused rather
  // than resolved: a container is often hand-edited, and a file that says two
  // things should not have one of them quietly win.
  function patchBytes(p) {
    var hasHex = p.hex !== undefined, hasData = p.data !== undefined;
    if (hasHex && hasData) {
      throw new Error('patch at ' + p.at + ' gives both hex and data');
    }
    if (hasData) {
      try {
        return decode64(p.data);
      } catch (e) {
        // atob's own text names neither the patch nor what was wrong with it.
        throw new Error('patch at ' + p.at + ': the data is not valid base64');
      }
    }
    if (!hasHex) throw new Error('patch at ' + p.at + ' gives neither hex nor data');
    return fromHex(p.hex);
  }

  // A patched copy. The source is left alone because the container keeps it:
  // saving a container that was loaded from one has to write back the image it
  // was given, not the image it ran.
  function applyPatches(bytes, patches) {
    if (!patches || !patches.length) return bytes;
    var out = new Uint8Array(bytes), i, j, at, b;
    for (i = 0; i < patches.length; i++) {
      at = patches[i].at;
      b = patchBytes(patches[i]);
      if (!(at >= 0) || at + b.length > out.length) {
        throw new Error('patch at ' + at + ' (' + b.length +
                        ' bytes) falls outside a ' + out.length + '-byte image');
      }
      for (j = 0; j < b.length; j++) out[at + j] = b[j];
    }
    return out;
  }

  // Which entry of which container, said so a reader can act on it: the file to
  // open, and the media entry inside it to look at. `applyPatches` and the
  // base64 decoder are given bytes and nothing else, so what they throw is true
  // but unplaceable; every throw out of the media loop wears this.
  function mediaLabel(name, i, m) {
    return (name || '.agc') + ': media ' + i +
           (m && m.name ? ' (' + m.name + ')' : '');
  }

  // Where two images differ, as patch records. Runs are joined across gaps of
  // up to 8 identical bytes, because a patch that reads as one change should be
  // one record: three separate `at`s for `A9 60 EA EA 85 84` helps nobody.
  // `width` is the base64 line width for the records that get base64, and
  // defaults to the payload's.
  function diff(orig, mod, width) {
    if (orig.length !== mod.length) {
      throw new Error('cannot diff a ' + mod.length + '-byte image against a ' +
                      orig.length + '-byte one — patches are byte-for-byte');
    }
    function record(at, end) {
      var bytes = mod.subarray(at, end);
      return bytes.length > HEX_MAX
        ? { at: at, data: encode64(bytes, width) }
        : { at: at, hex: toHex(bytes) };
    }
    var out = [], at = -1, last = -1, i;
    for (i = 0; i < orig.length; i++) {
      if (orig[i] === mod[i]) continue;
      if (at < 0 || i - last > 8) {
        if (at >= 0) out.push(record(at, last + 1));
        at = i;
      }
      last = i;
    }
    if (at >= 0) out.push(record(at, last + 1));
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
  // `machine.slots`: what this machine has that its model's stock complement
  // does not. Keys are slot numbers 0-7, values `{card, ram}` — kilobytes, as
  // `machine.ram` is — or `null` for a slot deliberately left empty. Returns
  // null when there is nothing to say, so a stock machine carries no field.
  function parseSlots(slots) {
    if (!slots || typeof slots !== 'object') return null;
    var out = {}, any = false, n, e, slot;
    for (n in slots) {
      slot = Number(n);
      if (!(slot >= 0 && slot <= 7)) continue;
      e = slots[n];
      if (e === null) { out[slot] = null; any = true; continue; }
      if (!e || !CARDS[e.card]) continue;
      out[slot] = { card: e.card, ram: Number(e.ram) || 0 };
      any = true;
    }
    return any ? out : null;
  }

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
        slots: parseSlots(machine.slots),
      },
      quirks: {
        irq: quirks.irq || '',
        rate: Number(quirks.rate) || 0,
      },
      keys: c.keys || {},
      controls: c.controls || {},
      media: [],
    };

    var list = c.media || [], i, m, raw, payload;
    for (i = 0; i < list.length; i++) {
      m = list[i];
      if (!m || !m.data) throw new Error(mediaLabel(name, i, m) + ' has no data');
      try {
        raw = decode64(m.data);
      } catch (e) {
        // atob's own text names neither the file nor the entry, and says
        // nothing else worth keeping.
        throw new Error(mediaLabel(name, i, m) + ': the data is not valid base64');
      }
      try {
        payload = applyPatches(raw, m.patches);      // what the machine runs
      } catch (e) {
        throw new Error(mediaLabel(name, i, m) + ': ' + e.message);
      }
      out.media.push({
        name: m.name || (out.title || 'image'),
        bytes: raw,                                  // as packed, before patches
        patches: m.patches || [],
        payload: payload,
      });
    }
    return out;
  }

  function hasBase64Patch(media) {
    var i, p, j;
    for (i = 0; i < (media || []).length; i++) {
      p = media[i].patches || [];
      for (j = 0; j < p.length; j++) if (p[j].data !== undefined) return true;
    }
    return false;
  }

  // Which version to stamp a container with. Everything a version-1 reader knows
  // still means what it meant, so a container that says nothing more is written
  // as version 1 and older builds keep opening it. Two things are the
  // exceptions: `machine.slots`, which a reader that ignored it would answer by
  // silently running the wrong hardware, and a base64 patch, which a version-1
  // reader would answer by complaining that undefined is not hex. Both are
  // stamped 2 and refused rather than misread.
  function formatVersion(spec) {
    return spec.slots || hasBase64Patch(spec.media) ? 2 : 1;
  }

  // The writer both `tools/mkagc.js` and the page's Save button go through, so
  // there is one definition of what a container looks like. Fields are added in
  // the documented order because JSON.stringify keeps insertion order, and a
  // format people are meant to hand-edit should read the same way every time.
  function build(spec) {
    var o = { agc: formatVersion(spec) };
    if (spec.title) o.title = spec.title;
    if (spec.author) o.author = spec.author;
    if (spec.date) o.date = String(spec.date);
    if (spec.url) o.url = spec.url;
    if (spec.notes) o.notes = spec.notes;
    o.machine = { model: spec.model === 9 ? 9 : 7, ram: spec.ram || 64 };
    if (spec.slots) o.machine.slots = spec.slots;
    o.quirks = { irq: spec.irq || 'raster', rate: spec.rate || 0 };
    if (spec.keys && Object.keys(spec.keys).length) o.keys = spec.keys;
    if (spec.controls && Object.keys(spec.controls).length) o.controls = spec.controls;
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
    fromHex: fromHex, toHex: toHex, patchBytes: patchBytes,
    applyPatches: applyPatches, diff: diff,
    VERSION: VERSION, LINE: LINE, HEX_MAX: HEX_MAX,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
