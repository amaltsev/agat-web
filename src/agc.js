// .agc — the Agat Container.
//
// One JSON file holding everything needed to run an old program: the image, any
// patches to it, a title, the machine it wants, and the controls it is played
// with. A disk on its own says none of that — the model comes from a `7a` in
// the filename, and which host key sends the byte the game reads is a puzzle.
//
//   {
//     "agc": 1,
//     "title": "RISE OUT",
//     "author": "Andrew Maltsev",
//     "date": "1989",
//     "url": "https://…",
//     "machine": { "model": 7, "ram": 64,
//                  "slots": { "4": { "card": "xram", "ram": 64 } } },
//     "keys":    { "KeyW": { "code": "^" } },
//     "controls": { "Play": { "Up Down Left Right": "Move",
//                             "^": "Shoot right" } },
//     "hint": "Press РУС at the title screen or the menu comes up in Latin.",
//     "media": [ { "name": "rise-out.dsk", "data": ["…", "…"] } ]
//   }
//
// `date` is text, not a number: what is known about an old program is as often
// "circa 1985" or "1990-92" as it is a year.
//
// `hint` and `notes` split by who is reading. A hint is shown: this one under
// the controls, and `keys.<key>.hint` on the on-screen board. `notes` is the
// record — provenance, credits, what a patch does — and nothing reads it.
//
// Three encodings, and one rule that picks between them. Hex while a person can
// still read the bytes as bytes: `{ "at": 45312, "hex": "A9 60 85 84" }`, which
// is what a hand-written patch looks like. Above that, base64 in short lines,
// so a container is a file a diff can show rather than one endless token. And
// above *that*, gzipped base64 in a `gz` field, whenever gzip earns it — an
// Agat disk is mostly empty and shrinks by ten times or more, which is the
// difference between a container that costs more than the disk it carries and
// one that costs a tenth of it.
//
// The rule is the same for a payload and for a patch, and it is a size rule:
// hex up to `HEX_MAX`, then whichever of the two base64 forms is smaller — but
// gzip has to win by `GAIN`, because plain base64 is worth a few bytes. Dense
// 6502 code under a kilobyte does not win it; a sparse sector or a rewritten
// track does. Both fields are accepted wherever the other is; giving two at
// once is an error rather than a preference to resolve.
//
// The payload is the image as it was found, byte for byte; patches are the diff
// and are applied after decoding. That way a container carries a pristine copy
// of what it came from, and what has been changed is legible rather than baked
// in.
//
// Compression is the reason `parse` and `build` are the only asynchronous
// functions here: the platform's gzip is a stream. Everything between them
// works in bytes — a patch in memory is `{ at, bytes }` — so the encodings
// exist at the two edges and nowhere in the middle.
(function (AGAT) {
  'use strict';

  // The version a container is written as, and the newest one this can read.
  // Compression did not move it: `gz` arrived while this was the only reader
  // there has ever been, so there was nothing for a second version to tell
  // apart, and a format people hand-edit is better off with one.
  var VERSION = 1;

  // Cards a `machine.slots` entry may name. Anything else is dropped, entries
  // without a `card` included: a container from a newer emulator should run on
  // the hardware this one has rather than fail.
  var CARDS = {
    psrom: 1, xram: 1, xram9: 1, fdd140: 1, fdd840: 1,
    'mouse-nippel': 1, 'mouse-mars': 1, 'mouse-mm8031': 1,
  };

  // Base64 characters per line. 76 is the MIME width, and 57 bytes; being a
  // multiple of 4 it is a whole number of base64 groups, so every line decodes
  // on its own and none of them carries padding but the last.
  var LINE = 76;

  // Bytes of patch that still read as bytes. Above this a record is a rewritten
  // sector rather than a poke, so it goes to base64: hex would be three times
  // the size of something nobody reads by eye anyway.
  var HEX_MAX = 32;

  // What gzip has to save before it is used, as a fraction of the bytes it was
  // given — base64 expands both forms by the same 4/3, so the compressed length
  // decides it and the encoding never has to be tried twice. A tenth is well
  // clear of both ends of what is actually packed here: a disk saves nine
  // tenths, and the marginal cases — dense code, a short patch, a file that has
  // been compressed once already — save nothing or grow. Between those two
  // groups there is nothing at all, so the exact figure has never mattered; it
  // is only there so that a container does not lose a readable payload to buy
  // twelve bytes.
  var GAIN = 0.1;

  // The fields that carry bytes. A record gives exactly one of them, and any
  // other key on it is somebody's note and is kept.
  var ENCODINGS = { hex: 1, data: 1, gz: 1 };

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

  // The bytes one encoded record carries — a medium's payload or a patch, which
  // are written the same three ways. More than one encoding at once is refused
  // rather than resolved: a container is often hand-edited, and a file that says
  // two things should not have one of them quietly win.
  //
  // `what` names the record the way its reader can act on it, because none of
  // what this can throw would otherwise say where in the file to look.
  function decodeBytes(rec, what) {
    var given = [], k;
    for (k in ENCODINGS) if (rec[k] !== undefined) given.push(k);
    if (given.length > 1) {
      return Promise.reject(new Error(what + ' gives ' + given.join(' and ') +
                                      ' — a record carries one of them'));
    }
    if (!given.length) {
      return Promise.reject(new Error(what + ' gives none of hex, data or gz'));
    }
    if (given[0] === 'hex') {
      try {
        return Promise.resolve(fromHex(rec.hex));
      } catch (e) {
        return Promise.reject(new Error(what + ': ' + e.message));
      }
    }
    var raw;
    try {
      raw = decode64(rec[given[0]]);
    } catch (e) {
      // atob's own text names neither the record nor what was wrong with it.
      return Promise.reject(new Error(what + ': the ' + given[0] +
                                      ' is not valid base64'));
    }
    if (given[0] === 'data') return Promise.resolve(raw);
    return AGAT.gunzip(raw).then(null, function () {
      throw new Error(what + ': the gz is not valid gzip');
    });
  }

  // A record as it should be written, by the rule at the top of the file. `hex`
  // is offered only where hex means something — a patch — since a payload is
  // never a handful of bytes somebody reads. `gz` forces the choice either way,
  // for a container that is meant to stay editable or to be as small as it can.
  function encodeBytes(bytes, opts) {
    opts = opts || {};
    if (opts.hex && bytes.length <= HEX_MAX) {
      return Promise.resolve({ hex: toHex(bytes) });
    }
    if (opts.gz === false) return Promise.resolve({ data: encode64(bytes, opts.width) });
    return AGAT.gzip(bytes).then(function (z) {
      if (opts.gz !== true && z.length > bytes.length * (1 - GAIN)) {
        return { data: encode64(bytes, opts.width) };
      }
      return { gz: encode64(z, opts.width) };
    });
  }

  // A patched copy. The source is left alone because the container keeps it:
  // saving a container that was loaded from one has to write back the image it
  // was given, not the image it ran. Records are `{ at, bytes }` — whatever
  // they were written as, they were decoded on the way in.
  function applyPatches(bytes, patches) {
    if (!patches || !patches.length) return bytes;
    var out = new Uint8Array(bytes), i, j, at, b;
    for (i = 0; i < patches.length; i++) {
      at = patches[i].at;
      b = patches[i].bytes;
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
  //
  // Which encoding each record ends up in is not decided here. This says where
  // the changes are; `build` says how bytes are written, for a patch and for a
  // payload alike, and it is the only place that knows.
  function diff(orig, mod) {
    if (orig.length !== mod.length) {
      throw new Error('cannot diff a ' + mod.length + '-byte image against a ' +
                      orig.length + '-byte one — patches are byte-for-byte');
    }
    function record(at, end) {
      return { at: at, bytes: mod.slice(at, end) };
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

  // One paragraph of plain text, which is all a `hint` is: runs of whitespace —
  // an escaped `\n`, a string wrapped by whatever wrote the file — collapse to
  // single spaces. The page prints it as text and not as markup, so a line
  // break in the source would be lost there anyway; losing it here means the
  // file and the screen agree.
  function oneLine(s) {
    return s === undefined || s === null ? ''
         : String(s).replace(/\s+/g, ' ').trim();
  }

  // `machine.slots`: what this machine has that its model's stock complement
  // does not. Keys are slot numbers 0-7, values `{card, ram}` — kilobytes, as
  // `machine.ram` is — or `null` for a slot deliberately left empty. `card` is
  // required; an entry that gives only a size names no card to resize and is
  // dropped. Returns null when there is nothing to say, so a stock machine
  // carries no field.
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

  // Is this a container? Synchronous, because the sniffer asks it of every file
  // dropped on the page and has to answer before the size table is consulted.
  // Reading one is asynchronous — a payload may be gzipped — so this is the
  // half that stays with the sniffer, and `parse` is called by whoever is
  // prepared to wait.
  //
  // The first byte is what keeps this cheap: a 2 MB .aim is not JSON and is
  // turned down without being decoded. Once something does look like JSON the
  // whole of it is searched, because the key is only conventionally first and a
  // hand-edited file may put the media above it.
  function looks(bytes) {
    if (!looksLikeJson(bytes)) return false;
    return /"agc"\s*:/.test(text(bytes));
  }

  // Everything but the media: the container as `{ fields, media }`, or null for
  // "not a container". A file that says `"agc"` and then fails to parse is a
  // broken container rather than something else, and says so.
  function readJson(bytes, name) {
    if (!looksLikeJson(bytes)) return null;
    var src = text(bytes), c;
    try {
      c = JSON.parse(src);
    } catch (e) {
      // The same test `looks` makes, over the same text: a file the sniffer
      // called a container and the parser cannot read is a broken container,
      // and saying so beats "not a recognised Agat image".
      if (/"agc"\s*:/.test(src)) {
        throw new Error((name || '.agc') + ': not valid JSON — ' + e.message);
      }
      return null;
    }
    if (!c || typeof c !== 'object' || c.agc === undefined) return null;
    if (!(c.agc <= VERSION)) {
      throw new Error((name || '.agc') + ': made by a newer emulator (agc ' +
                      c.agc + ', this reads ' + VERSION + ')');
    }

    var machine = c.machine || {};
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
      keys: c.keys || {},
      controls: c.controls || {},
      // What the controls panel prints under the groups: the one thing the
      // container has to say to whoever is about to play, rather than to
      // whoever is reading the file.
      hint: oneLine(c.hint),
      media: [],
    };
    return { fields: out, media: c.media || [] };
  }

  // One patch record, decoded. `at` and the bytes are what the code works in;
  // anything else on the record is somebody's note about the patch and is
  // carried through, because a reader that quietly drops what it does not
  // understand will eventually eat one.
  function readPatch(p, label) {
    return decodeBytes(p, label + ': patch at ' + p.at).then(function (bytes) {
      var out = { at: p.at, bytes: bytes }, k;
      for (k in p) if (k !== 'at' && !ENCODINGS[k]) out[k] = p[k];
      return out;
    });
  }

  // One medium: the payload as it was packed, the patches as bytes, and the
  // image the machine actually runs.
  function readMedium(m, i, name, title) {
    var label = mediaLabel(name, i, m);
    return Promise.resolve().then(function () {
      if (!m || (m.data === undefined && m.gz === undefined)) {
        throw new Error(label + ' has no data');
      }
      return decodeBytes(m, label);
    }).then(function (raw) {
      var list = m.patches || [], i2, todo = [];
      for (i2 = 0; i2 < list.length; i2++) todo.push(readPatch(list[i2], label));
      return Promise.all(todo).then(function (patches) {
        var payload;
        try {
          payload = applyPatches(raw, patches);       // what the machine runs
        } catch (e) {
          throw new Error(label + ': ' + e.message);
        }
        return {
          name: m.name || title || 'image',
          bytes: raw,                                 // as packed, before patches
          patches: patches,
          payload: payload,
        };
      });
    });
  }

  // Null for "not a container" — the sniffer needs that answer for every file
  // dropped on the page, and `looks` is the cheap half of it. A promise because
  // a payload may be gzipped, and the platform's gzip is a stream.
  function parse(bytes, name) {
    var read;
    try {
      read = readJson(bytes, name);
    } catch (e) {
      return Promise.reject(e);
    }
    if (!read) return Promise.resolve(null);
    var out = read.fields, i, todo = [];
    for (i = 0; i < read.media.length; i++) {
      todo.push(readMedium(read.media[i], i, name, out.title));
    }
    return Promise.all(todo).then(function (media) {
      out.media = media;
      return out;
    });
  }

  // One medium as it is written: the payload, then the patches, each through
  // the same encoder. `gz` is the caller's override — true to compress whatever
  // it costs, false to keep the file editable, and undefined to let the size
  // rule decide, which is what the Save button does.
  function buildMedium(m, spec) {
    var e = { name: m.name || 'image' };
    return encodeBytes(m.bytes, { width: spec.width, gz: spec.gz })
      .then(function (enc) {
        var k;
        for (k in enc) e[k] = enc[k];
        var list = m.patches || [], i, todo = [];
        for (i = 0; i < list.length; i++) todo.push(buildPatch(list[i], spec));
        return Promise.all(todo);
      }).then(function (patches) {
        if (patches.length) e.patches = patches;
        return e;
      });
  }

  // A patch as it is written. `at` first and the bytes second, then whatever
  // else the record was carrying when it was read.
  function buildPatch(p, spec) {
    return encodeBytes(p.bytes, { width: spec.width, gz: spec.gz, hex: true })
      .then(function (enc) {
        var out = { at: p.at }, k;
        for (k in enc) out[k] = enc[k];
        for (k in p) if (k !== 'at' && k !== 'bytes') out[k] = p[k];
        return out;
      });
  }

  // The writer both `tools/mkagc.js` and the page's Save button go through, so
  // there is one definition of what a container looks like. Fields are added in
  // the documented order because JSON.stringify keeps insertion order, and a
  // format people are meant to hand-edit should read the same way every time.
  function build(spec) {
    var o = { agc: VERSION }, hint = oneLine(spec.hint);
    if (spec.title) o.title = spec.title;
    if (spec.author) o.author = spec.author;
    if (spec.date) o.date = String(spec.date);
    if (spec.url) o.url = spec.url;
    if (spec.notes) o.notes = spec.notes;
    o.machine = { model: spec.model === 9 ? 9 : 7, ram: spec.ram || 64 };
    if (spec.slots) o.machine.slots = spec.slots;
    if (spec.keys && Object.keys(spec.keys).length) o.keys = spec.keys;
    if (spec.controls && Object.keys(spec.controls).length) o.controls = spec.controls;
    // After the controls, because that is where it is printed and where it
    // reads as belonging.
    if (hint) o.hint = hint;
    var list = spec.media || [], i, todo = [];
    o.media = [];                    // in place, so the field keeps its order
    for (i = 0; i < list.length; i++) todo.push(buildMedium(list[i], spec));
    return Promise.all(todo).then(function (media) {
      o.media = media;
      return JSON.stringify(o, null, 2) + '\n';
    });
  }

  AGAT.agc = {
    looks: looks, parse: parse, build: build,
    encode64: encode64, decode64: decode64,
    fromHex: fromHex, toHex: toHex,
    decodeBytes: decodeBytes, encodeBytes: encodeBytes,
    applyPatches: applyPatches, diff: diff,
    VERSION: VERSION, LINE: LINE, HEX_MAX: HEX_MAX, GAIN: GAIN,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
