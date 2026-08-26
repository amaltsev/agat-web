// What a DOS 3.3 file looks like on the way in and on the way out.
//
// `dos33.js` knows the catalog, the T/S lists and the free map — where a file
// lives. This is the layer above it: what the bytes of a file *are*, and what
// they have to become for something outside the disk to hold them. A `B` file
// carries its load address in its own first four bytes; an `I` or an `A` file
// carries a length there instead; a `T` file ends its lines with `$8D` and
// nothing else; a `.fil` is the data stream with the catalog entry glued in
// front. None of that is the file system's business and all of it has to
// happen twice — once for `tools/dos.js` and once for the page — so it happens
// here instead, and the two cannot drift.
//
// No DOM and no `fs`: names, bytes and a `Dos33`. Whoever calls decides where
// the bytes came from and where they are going.
(function (AGAT) {
  'use strict';

  // The long view's fields, for one file. `sectors` is what the T/S chain
  // actually reaches, which is the number to believe — the catalog's own count
  // is a byte and saturates at 255. `len` and `addr` are what the file says
  // about itself, and a type that says nothing has neither.
  //
  // A file whose chain will not decode has `error` and nothing else: the disk
  // is telling us something, and a row of blanks would be a worse account of it
  // than the message.
  function describe(dos, entry) {
    var out = { tsTrack: entry.tsTrack, tsSector: entry.tsSector };
    try {
      var bytes = dos.read(entry);
      var len = dos.length(entry, bytes);
      out.sectors = Math.ceil(bytes.length / 256);
      if (len) {
        out.len = len.len;
        if (len.addr >= 0) out.addr = len.addr;
      }
    } catch (e) {
      out.error = e.message;
    }
    return out;
  }

  // The contents alone: the type's own prefix off the front, trimmed to the
  // length the file declares. For a type that declares nothing there is nothing
  // to trim to and the stream is all there is.
  function body(dos, entry, bytes) {
    var len = dos.length(entry, bytes);
    if (!len) return bytes;
    return bytes.subarray(len.at, Math.min(len.at + len.len, bytes.length));
  }

  // A DOS text file ends its lines with `$8D` — a carriage return with bit 7
  // set, as every printable byte in one has. `chars.decode` drops bit 7, so the
  // terminator arrives here as the `\x0D` escape and goes back out as one; the
  // escape re-encodes with bit 7 on, which is the byte DOS wants.
  function toText(bytes) {
    return AGAT.chars.decode(bytes).replace(/\\x0D/g, '\n');
  }

  function fromText(text) {
    return AGAT.chars.encode(String(text).replace(/\r\n/g, '\n').replace(/\n/g, '\\x0D'));
  }

  // `$2000`, `0x2000` or `2000` — hexadecimal either way, because an Agat
  // address written in decimal is not a thing anybody does. Nothing at all is
  // -1, which is "not given" rather than an error: only a `B` file needs one.
  // `label` is what to call it in the message, for a caller whose user typed it
  // somewhere with a name — a flag, a field.
  function parseAddr(v, label) {
    if (v === undefined || v === null || v === '') return -1;
    var s = String(v).replace(/^\$/, '').replace(/^0x/i, '');
    var n = /^[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : NaN;
    if (isNaN(n) || n < 0 || n > 0xffff) {
      throw new Error((label === undefined ? v : label) + ': not an address');
    }
    return n;
  }

  // A file name for the host's file system. The catalog allows characters a
  // directory will not, and a name is drawn rather than typed, so this is a
  // suggestion and not an identity.
  function outName(entry, ext) {
    return entry.name.replace(/[\\/\x00-\x1f]/g, '_') + ext;
  }

  // And the other way: what to call a file being put on the disk when nobody
  // said. The extension goes, the case goes up — DOS has no lower case.
  function defaultName(filename) {
    return String(filename).replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '')
      .toUpperCase();
  }

  // ---- out of the disk --------------------------------------------------

  // One file on its way out: `{name}` and either `bytes` or, for text, `text`.
  //
  //   fil    the data stream with its catalog entry in front — what the page
  //          loads, so a B file taken off a disk can be dropped on the emulator
  //   raw    the stream as DOS stores it, whole sectors and all
  //   body   the contents alone, per `body()` above
  //   text   the contents decoded to UTF-8
  //
  // Text comes back as a string rather than as UTF-8 bytes because neither
  // caller wants the bytes: Node writes the string, and a Blob takes one.
  //
  // Whether a file is the right *type* to be read as text is the caller's
  // question, not this one's: the CLI refuses without `--force` and the page
  // says so in the panel, and both want to phrase it their own way.
  function unpack(dos, entry, how) {
    var stream = dos.read(entry);
    if (how === 'text') {
      return { text: toText(body(dos, entry, stream)), name: outName(entry, '.txt') };
    }
    if (how === 'raw') return { bytes: stream, name: outName(entry, '.bin') };
    if (how === 'body') {
      return { bytes: body(dos, entry, stream), name: outName(entry, '.bin') };
    }
    return {
      bytes: AGAT.fil.build({ raw: entry.raw, type: entry.type,
                              locked: entry.locked, data: stream }),
      name: outName(entry, '.fil'),
    };
  }

  // ---- onto the disk ----------------------------------------------------

  // What a file becomes on its way onto the disk: `{name, type, locked, data}`,
  // where `data` is the stream DOS stores and `name` is what the file called
  // itself, or `''` if it did not.
  //
  // `input` is bytes, or a string when `opts.text` is set. The options are the
  // CLI's flags by another name:
  //
  //   text    the input is text, to be written as a `T` file
  //   raw     the input is already a DOS data stream; needs `type`
  //   type    the type byte, or -1 for "work it out"
  //   addr    the load address for a `B` file, and `addrLabel` what to call
  //           it if it will not parse
  //   locked  put it down locked
  //   name    what to call it, if the caller already knows
  //
  // With none of them, a `.fil` is recognized and unwrapped — name, type and
  // lock bit and all — and anything else is a `B` file, which is the one type
  // that cannot be guessed at because it needs an address.
  function pack(input, opts) {
    opts = opts || {};
    var type = opts.type === undefined ? -1 : opts.type;
    var name = opts.name || '';
    var locked = !!opts.locked;
    var data;

    if (opts.text) {
      if (type < 0) type = 0x00;
      data = fromText(input);
    } else if (!opts.raw && AGAT.fil.looks(input)) {
      var f = AGAT.fil.parse(input);
      if (!name) name = f.name;
      if (type < 0) type = f.type;
      if (!opts.locked) locked = f.locked;
      data = f.data;
    } else if (opts.raw) {
      if (type < 0) throw new Error('a raw stream needs a type');
      data = input;
    } else {
      if (type < 0) type = 0x04;
      if (type === 0x04) {
        var addr = parseAddr(opts.addr, opts.addrLabel);
        if (addr < 0) throw new Error('a B file needs a load address');
        data = new Uint8Array(4 + input.length);
        data[0] = addr & 0xff; data[1] = (addr >> 8) & 0xff;
        data[2] = input.length & 0xff; data[3] = (input.length >> 8) & 0xff;
        data.set(input, 4);
      } else if (type === 0x02 || type === 0x01) {
        // I and A: BASIC, and the first two bytes are how long the program is.
        data = new Uint8Array(2 + input.length);
        data[0] = input.length & 0xff; data[1] = (input.length >> 8) & 0xff;
        data.set(input, 2);
      } else {
        data = input;
      }
    }
    return { name: name, type: type, locked: locked, data: data };
  }

  AGAT.dosfile = {
    describe: describe, body: body,
    toText: toText, fromText: fromText,
    parseAddr: parseAddr, outName: outName, defaultName: defaultName,
    unpack: unpack, pack: pack,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
