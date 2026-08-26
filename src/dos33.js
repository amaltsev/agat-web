// Agat DOS 3.3 — the catalog, the files, and the free map.
//
// A straight port of Apple DOS 3.3, and near enough byte-for-byte that the
// Apple layout can be read off any Agat disk: VTOC at track 17 sector 0, a
// chain of catalog sectors holding seven 35-byte entries each, and a file
// reached through a T/S list of (track, sector) pairs. What the port changed is
// small, and all of it is measured below rather than assumed.
//
// The VTOC, at track 17 sector 0:
//
//   +$01 +$02   first catalog sector
//   +$03        DOS release
//   +$06        volume, 254 on every disk here
//   +$09..      the disk's own name, CR-terminated — Apple DOS leaves this
//               area unused; two of the disks in examples/ carry a title in it
//   +$27        T/S pairs per list sector, 122
//   +$30 +$31   last track allocated, and which way the allocator was moving
//   +$34 +$35   tracks, sectors per track
//   +$36 +$37   bytes per sector, $0100
//   +$38..      the free map, four bytes a track
//
// **The free map is a big-endian bit per sector, and sector `s` is bit
// `32 - perTrack + s`** — so the highest sector of the track is the top bit and
// the map is right-open rather than left-. For the 16-sector disk that is
// Apple's own `16 + s`; for the 21-sector one it is `11 + s`, and nothing else
// fits. Checked against every allocated sector of the eight DOS disks in
// `examples/` — 8 996 of them, no disagreements.
//
// **The map does not fit in the VTOC on an 840K disk.** `$38-$FF` is 50 tracks
// and the disk has 160. The rest is in a sector of its own, 64 tracks to a
// sector from offset 0, living on the **first track it describes**: tracks
// 50-113 in track 50 sector 0, tracks 114-159 in track 114 sector 0. Those
// sectors are marked allocated in the map like anything else. Same evidence as
// above; on a 35-track disk the question never arises.
//
// **File types are `T I A B S R K D`** — bits 0..7 of the type byte, `$80` on
// top for locked. Apple's last two are `A` and `B` again; Agat's are `K` and
// `D`, and the table is on the disk: `D4 C9 C1 C2 D3 D2 CB C4` at track 2
// sector 9 of `examples/TESTKOM9_840.agc`, seven bytes ahead of the reversed
// `ДИСК N` the catalog header prints.
//
// **The catalog chain is interleaved.** Sector 0 links to 2, 2 to 4, up to 20,
// then 20 links back to 1 and the odd sectors run out to 19, which ends it —
// twenty sectors, each visited once. Nothing here depends on that; the chain is
// followed as a chain. It is worth knowing only because a reader expecting
// Apple's descending 15..1 will conclude the catalog is corrupt.
(function (AGAT) {
  'use strict';

  var SECSIZE = 256;
  var VTOC_TRACK = 17, VTOC_SECTOR = 0;
  var ENTRY = 35;                        // bytes per catalog entry
  var ENTRIES = 7;                       // per catalog sector
  var CAT_FIRST = 0x0b;                  // where a catalog sector's entries start
  var NAME_LEN = 30;
  var TS_FIRST = 0x0c;                   // where a T/S list's pairs start
  var TS_PAIRS = (SECSIZE - TS_FIRST) / 2;
  var MAP_AT = 0x38;                     // the free map inside the VTOC
  var MAP_IN_VTOC = (SECSIZE - MAP_AT) / 4;      // 50 tracks
  var MAP_PER_SECTOR = SECSIZE / 4;              // 64 tracks in a map sector
  var DELETED = 0xff;
  var TYPES = 'TIABSRKD';

  // Type byte <-> letter. The byte is a single bit, so the letter is which bit.
  function typeLetter(b) {
    for (var i = 0; i < 8; i++) if ((b & 0x7f) === (i ? 1 << (i - 1) : 0)) return TYPES.charAt(i);
    return '?';
  }

  function typeByte(letter) {
    var i = TYPES.indexOf(String(letter).toUpperCase());
    if (i < 0) return -1;
    return i ? 1 << (i - 1) : 0;
  }

  function Dos33(sectors) {
    this.sec = sectors;
    this.vtocAt = { track: VTOC_TRACK, sector: VTOC_SECTOR };
    this.reload();
  }

  Dos33.prototype.reload = function () {
    var v = this.sec.read(this.vtocAt.track, this.vtocAt.sector);
    if (!v) throw new Error('track ' + this.vtocAt.track + ' will not decode — no VTOC');
    if (v[0x36] !== 0x00 || v[0x37] !== 0x01 || !v[0x34] || !v[0x35]) {
      throw new Error('track ' + this.vtocAt.track + ' sector ' + this.vtocAt.sector +
                      ' is not a DOS 3.3 VTOC');
    }
    if (v[0x34] > this.sec.tracks || v[0x35] !== this.sec.perTrack) {
      throw new Error('the VTOC says ' + v[0x34] + ' tracks of ' + v[0x35] +
                      ', the image holds ' + this.sec.tracks + ' of ' + this.sec.perTrack);
    }
    this.vtoc = v;
    this.tracks = v[0x34];
    this.perTrack = v[0x35];
    this.volume = v[6];
    this.tsMax = v[0x27] || TS_PAIRS;
    return this;
  };

  Dos33.prototype.putVtoc = function () {
    if (!this.sec.write(this.vtocAt.track, this.vtocAt.sector, this.vtoc)) {
      throw new Error('the VTOC sector cannot be written');
    }
  };

  // The disk's own name, out of the area Apple DOS leaves empty. Empty when
  // there is nothing there, which is most disks.
  //
  // Bit 7 varies letter by letter — `ALICE_GAME_DISK_V3` has it on `A`, on all
  // three `_` and on the `3`, and off through the rest — so the field is text
  // with a video attribute painted over it and the attribute is dropped here.
  // What ends it is a control code: a CR on both of the disks that carry one.
  Dos33.prototype.title = function () {
    var v = this.vtoc, s = '', i, b;
    for (i = 0x08; i < 0x27; i++) {
      b = v[i] & 0x7f;
      if (b < 0x20) break;
      s += AGAT.chars.glyph(b);
    }
    return s.replace(/\s+$/, '');
  };

  // ---- the free map --------------------------------------------------------

  // Which sector holds the four bytes for this track, and where in it. Null for
  // a track past the end of the disk.
  Dos33.prototype.mapAt = function (t) {
    if (t < 0 || t >= this.tracks) return null;
    if (t < MAP_IN_VTOC) {
      return { track: this.vtocAt.track, sector: this.vtocAt.sector,
               off: MAP_AT + 4 * t, vtoc: true };
    }
    var base = MAP_IN_VTOC +
               MAP_PER_SECTOR * Math.floor((t - MAP_IN_VTOC) / MAP_PER_SECTOR);
    return { track: base, sector: 0, off: 4 * (t - base), vtoc: false };
  };

  // The four bytes as one big-endian word, or -1 when the map sector itself is
  // unreadable — which is a broken disk, not an empty track.
  Dos33.prototype.mapWord = function (t) {
    var a = this.mapAt(t);
    if (!a) return -1;
    var s = a.vtoc ? this.vtoc : this.sec.read(a.track, a.sector);
    if (!s) return -1;
    return ((s[a.off] << 24) | (s[a.off + 1] << 16) |
            (s[a.off + 2] << 8) | s[a.off + 3]) >>> 0;
  };

  Dos33.prototype.bit = function (s) { return 32 - this.perTrack + s; };

  Dos33.prototype.isFree = function (t, s) {
    var w = this.mapWord(t);
    return w >= 0 && ((w >>> this.bit(s)) & 1) === 1;
  };

  // Mark one sector free or allocated. Writes the map sector through, so a
  // caller does not have to know which of the two places it lives in.
  Dos33.prototype.setFree = function (t, s, free) {
    var a = this.mapAt(t);
    if (!a) return false;
    var buf = a.vtoc ? this.vtoc : this.sec.read(a.track, a.sector);
    if (!buf) return false;
    var w = ((buf[a.off] << 24) | (buf[a.off + 1] << 16) |
             (buf[a.off + 2] << 8) | buf[a.off + 3]) >>> 0;
    var b = this.bit(s);
    w = free ? (w | (1 << b)) >>> 0 : (w & ~(1 << b)) >>> 0;
    buf[a.off] = (w >>> 24) & 0xff;
    buf[a.off + 1] = (w >>> 16) & 0xff;
    buf[a.off + 2] = (w >>> 8) & 0xff;
    buf[a.off + 3] = w & 0xff;
    if (a.vtoc) this.putVtoc();
    else if (!this.sec.write(a.track, a.sector, buf)) return false;
    return true;
  };

  Dos33.prototype.freeCount = function () {
    var n = 0, t, s, w;
    for (t = 0; t < this.tracks; t++) {
      w = this.mapWord(t);
      if (w < 0) continue;
      for (s = 0; s < this.perTrack; s++) if ((w >>> this.bit(s)) & 1) n++;
    }
    return n;
  };

  // ---- the catalog ---------------------------------------------------------

  // Every catalog sector, in chain order. Stops on a link that repeats, so a
  // ring reads as a catalog rather than hanging.
  Dos33.prototype.catalogSectors = function () {
    var out = [], seen = {}, t = this.vtoc[1], s = this.vtoc[2], key, buf;
    while (t || s) {
      key = t + '/' + s;
      if (seen[key]) break;
      seen[key] = 1;
      buf = this.sec.read(t, s);
      if (!buf) break;
      out.push({ track: t, sector: s, bytes: buf });
      t = buf[1];
      s = buf[2];
    }
    return out;
  };

  // One entry, read out of a catalog sector. `at` is everything needed to write
  // it back.
  function readEntry(cat, i, dos) {
    var b = cat.bytes, o = CAT_FIRST + i * ENTRY, raw = b.subarray(o + 3, o + 3 + NAME_LEN);
    var t = b[o];
    // A tombstone's last name byte is the track, not a letter, so the name it
    // shows is one character short of what it was — which is what DOS shows too.
    var shown = t === DELETED ? raw.subarray(0, NAME_LEN - 1) : raw;
    return {
      at: { track: cat.track, sector: cat.sector, index: i, off: o },
      unused: t === 0,
      deleted: t === DELETED,
      // A deleted entry keeps its T/S list track in the last byte of the name,
      // which is how DOS undeletes and how the tool reports what was lost.
      tsTrack: t === DELETED ? b[o + 0x20] : t,
      tsSector: b[o + 1],
      type: b[o + 2] & 0x7f,
      locked: (b[o + 2] & 0x80) !== 0,
      typeLetter: typeLetter(b[o + 2]),
      raw: raw,
      name: AGAT.chars.decode(shown).replace(/\s+$/, ''),
      sectors: b[o + 33] | (b[o + 34] << 8),
      dos: dos,
    };
  }

  // Everything the catalog holds. `opts.deleted` keeps the tombstones, which is
  // the only way to see what was on a disk before somebody tidied it.
  Dos33.prototype.list = function (opts) {
    var out = [], cats = this.catalogSectors(), i, j, e;
    for (i = 0; i < cats.length; i++) {
      for (j = 0; j < ENTRIES; j++) {
        e = readEntry(cats[i], j, this);
        if (e.unused) continue;
        if (e.deleted && !(opts && opts.deleted)) continue;
        out.push(e);
      }
    }
    return out;
  };

  // Names are matched on what they *draw*, not on the bytes: see
  // `chars.fold` for why a name can be half Latin and half Cyrillic. `*` and
  // `?` are the whole of the pattern language.
  function rx(pattern) {
    var s = AGAT.chars.fold(pattern), out = '', i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      if (c === '*') out += '.*';
      else if (c === '?') out += '.';
      else if ('.+^${}()|[]\\/'.indexOf(c) >= 0) out += '\\' + c;
      else out += c;
    }
    return new RegExp('^' + out + '$');
  }

  Dos33.prototype.match = function (pattern, opts) {
    var re = rx(pattern), all = this.list(opts), out = [], i;
    for (i = 0; i < all.length; i++) {
      if (re.test(AGAT.chars.fold(all[i].name))) out.push(all[i]);
    }
    return out;
  };

  // Exactly one file, by name. Throws rather than guessing when a name reaches
  // two files — which it can, since two different byte strings can draw the
  // same word.
  Dos33.prototype.find = function (name) {
    var got = this.match(name), i, names;
    if (got.length === 1) return got[0];
    if (!got.length) throw new Error('no file called "' + name + '"');
    names = [];
    for (i = 0; i < got.length && i < 8; i++) names.push('"' + got[i].name + '"');
    if (got.length > names.length) names.push('and ' + (got.length - names.length) + ' more');
    throw new Error('"' + name + '" matches ' + got.length + ' files: ' + names.join(', '));
  };

  // ---- reading a file ------------------------------------------------------

  // The (track, sector) pairs a file is made of, and the list sectors that hold
  // them. A trailing run of (0,0) is padding in the last list sector and is
  // dropped; a (0,0) in the middle is a hole in a random-access text file and
  // is kept, as a null.
  Dos33.prototype.chain = function (entry) {
    var data = [], lists = [], seen = {}, t = entry.tsTrack, s = entry.tsSector;
    var buf, i, key;
    while (t || s) {
      key = t + '/' + s;
      if (seen[key]) break;
      seen[key] = 1;
      buf = this.sec.read(t, s);
      if (!buf) throw new Error('the T/S list at track ' + t + ' sector ' + s +
                                ' will not decode');
      lists.push([t, s]);
      for (i = TS_FIRST; i + 1 < SECSIZE; i += 2) {
        data.push(buf[i] || buf[i + 1] ? [buf[i], buf[i + 1]] : null);
      }
      t = buf[1];
      s = buf[2];
    }
    while (data.length && data[data.length - 1] === null) data.pop();
    return { data: data, lists: lists };
  };

  // The file's data stream: its sectors end to end. A hole reads as 256 zeros,
  // which is what DOS gives a program reading one.
  Dos33.prototype.read = function (entry) {
    var c = this.chain(entry), out = new Uint8Array(c.data.length * SECSIZE), i, b;
    for (i = 0; i < c.data.length; i++) {
      if (!c.data[i]) continue;
      b = this.sec.read(c.data[i][0], c.data[i][1]);
      if (!b) throw new Error('"' + entry.name + '": track ' + c.data[i][0] +
                              ' sector ' + c.data[i][1] + ' will not decode');
      out.set(b, i * SECSIZE);
    }
    return out;
  };

  // How long the file's *contents* are, as the file itself says: a `B` file
  // carries load address and length in its first four bytes, an `A` or `I` file
  // a length in its first two, and a `T` file ends at its first $00. Null when
  // the type says nothing, and the whole stream is all there is.
  Dos33.prototype.length = function (entry, bytes) {
    var t = entry.type;
    if (t === 0x04) {
      return { addr: bytes[0] | (bytes[1] << 8), at: 4,
               len: bytes[2] | (bytes[3] << 8) };
    }
    if (t === 0x02 || t === 0x01) {
      return { addr: -1, at: 2, len: bytes[0] | (bytes[1] << 8) };
    }
    if (t === 0x00) {
      for (var i = 0; i < bytes.length; i++) if (!bytes[i]) return { addr: -1, at: 0, len: i };
      return { addr: -1, at: 0, len: bytes.length };
    }
    return null;
  };

  // ---- writing -------------------------------------------------------------

  // Free sectors, in the order DOS would take them: outward from the track it
  // stopped on, in the direction it was going, and the highest sector of a
  // track first. Returns fewer than asked for when the disk cannot supply them.
  Dos33.prototype.pick = function (n) {
    var order = [], out = [], t, s, i;
    var last = this.vtoc[0x30], dir = this.vtoc[0x31] & 0x80 ? this.vtoc[0x31] - 256 : this.vtoc[0x31];
    if (!dir) dir = 1;
    if (last >= this.tracks) last = 0;
    for (t = last; t >= 0 && t < this.tracks; t += dir) order.push(t);
    for (t = last - dir; t >= 0 && t < this.tracks; t -= dir) order.push(t);
    for (i = 0; i < order.length && out.length < n; i++) {
      for (s = this.perTrack - 1; s >= 0 && out.length < n; s--) {
        if (this.isFree(order[i], s) && this.sec.read(order[i], s)) out.push([order[i], s]);
      }
    }
    return out;
  };

  // A catalog slot that can be written: an unused one, or a deleted one being
  // reused, which is what DOS does.
  Dos33.prototype.freeEntry = function () {
    var cats = this.catalogSectors(), i, j, e;
    for (i = 0; i < cats.length; i++) {
      for (j = 0; j < ENTRIES; j++) {
        e = readEntry(cats[i], j, this);
        if (e.unused || e.deleted) return e;
      }
    }
    return null;
  };

  // Write one catalog entry in place. The sector is read fresh rather than
  // taken from the entry, because the free map may have been written through
  // the same sector since the entry was read.
  Dos33.prototype.putEntry = function (at, fields) {
    var buf = at.sector === this.vtocAt.sector && at.track === this.vtocAt.track
            ? this.vtoc : this.sec.read(at.track, at.sector);
    if (!buf) throw new Error('catalog sector ' + at.track + '/' + at.sector +
                              ' will not decode');
    var o = at.off, i;
    buf[o] = fields.tsTrack;
    buf[o + 1] = fields.tsSector;
    buf[o + 2] = fields.type | (fields.locked ? 0x80 : 0);
    for (i = 0; i < NAME_LEN; i++) buf[o + 3 + i] = fields.raw[i];
    // The count is a byte that saturates: `A.ROOM` on the Alice disk is 259
    // sectors and its entry says 255. Nothing reads it — the T/S chain is what
    // a file is — so this only has to look like what DOS would have left.
    buf[o + 33] = Math.min(fields.sectors, 0xff);
    buf[o + 34] = 0;
    if (!this.sec.write(at.track, at.sector, buf)) {
      throw new Error('catalog sector ' + at.track + '/' + at.sector +
                      ' cannot be written');
    }
  };

  // A 30-byte catalog name from text, space-padded the way DOS pads it.
  function nameBytes(name) {
    var enc = AGAT.chars.encode(name), out = new Uint8Array(NAME_LEN), i;
    if (enc.length > NAME_LEN) {
      throw new Error('"' + name + '" is longer than ' + NAME_LEN + ' characters');
    }
    for (i = 0; i < NAME_LEN; i++) out[i] = i < enc.length ? enc[i] : 0xa0;
    return out;
  }

  Dos33.prototype.rename = function (entry, name) {
    var raw = nameBytes(name);
    this.putEntry(entry.at, {
      tsTrack: entry.deleted ? DELETED : entry.tsTrack,
      tsSector: entry.tsSector,
      type: entry.type, locked: entry.locked,
      raw: raw, sectors: entry.sectors,
    });
    if (entry.deleted) this.markDeleted(entry.at, entry.tsTrack);
    entry.raw = raw;
    entry.name = AGAT.chars.decode(raw).replace(/\s+$/, '');
    return entry;
  };

  // DOS's tombstone: $FF in the first byte, and the track it used to point at
  // parked in the last byte of the name.
  Dos33.prototype.markDeleted = function (at, tsTrack) {
    var buf = this.sec.read(at.track, at.sector);
    if (!buf) throw new Error('catalog sector ' + at.track + '/' + at.sector +
                              ' will not decode');
    buf[at.off] = DELETED;
    buf[at.off + 0x20] = tsTrack;
    if (!this.sec.write(at.track, at.sector, buf)) {
      throw new Error('catalog sector ' + at.track + '/' + at.sector +
                      ' cannot be written');
    }
  };

  // Free every sector the file held and tombstone its entry. The sectors are
  // freed first: an entry marked deleted with its sectors still allocated
  // merely wastes them, while the other order loses the chain that says which
  // they were.
  Dos33.prototype.remove = function (entry) {
    var c = this.chain(entry), i, freed = 0;
    for (i = 0; i < c.data.length; i++) {
      if (c.data[i] && this.setFree(c.data[i][0], c.data[i][1], true)) freed++;
    }
    for (i = 0; i < c.lists.length; i++) {
      if (this.setFree(c.lists[i][0], c.lists[i][1], true)) freed++;
    }
    this.markDeleted(entry.at, entry.tsTrack);
    entry.deleted = true;
    return freed;
  };

  // Write a new file. Everything is checked before anything is written: a disk
  // that cannot hold the file is left exactly as it was, rather than half full
  // of a file that is not in the catalog.
  Dos33.prototype.create = function (name, type, bytes, opts) {
    opts = opts || {};
    var raw = nameBytes(name);
    var nData = Math.ceil(bytes.length / SECSIZE) || 1;
    var nList = Math.ceil(nData / this.tsMax) || 1;
    var slot = this.freeEntry();
    if (!slot) throw new Error('the catalog is full');
    var got = this.pick(nData + nList);
    if (got.length < nData + nList) {
      throw new Error('"' + name + '" needs ' + (nData + nList) + ' sectors and ' +
                      got.length + ' are free');
    }
    // The list sectors come first, so a T/S list sits ahead of the data it
    // describes, as DOS leaves it.
    var lists = got.slice(0, nList), data = got.slice(nList), i, j, buf, o;
    for (i = 0; i < data.length; i++) {
      buf = new Uint8Array(SECSIZE);
      buf.set(bytes.subarray(i * SECSIZE, (i + 1) * SECSIZE));
      if (!this.sec.write(data[i][0], data[i][1], buf)) {
        throw new Error('track ' + data[i][0] + ' sector ' + data[i][1] +
                        ' cannot be written');
      }
    }
    for (i = 0; i < lists.length; i++) {
      buf = new Uint8Array(SECSIZE);
      if (i + 1 < lists.length) { buf[1] = lists[i + 1][0]; buf[2] = lists[i + 1][1]; }
      buf[5] = (i * this.tsMax) & 0xff;
      buf[6] = (i * this.tsMax) >> 8;
      for (j = 0; j < this.tsMax; j++) {
        o = i * this.tsMax + j;
        if (o >= data.length) break;
        buf[TS_FIRST + j * 2] = data[o][0];
        buf[TS_FIRST + j * 2 + 1] = data[o][1];
      }
      if (!this.sec.write(lists[i][0], lists[i][1], buf)) {
        throw new Error('track ' + lists[i][0] + ' sector ' + lists[i][1] +
                        ' cannot be written');
      }
    }
    for (i = 0; i < got.length; i++) this.setFree(got[i][0], got[i][1], false);
    this.vtoc[0x30] = got[got.length - 1][0];
    this.putVtoc();
    this.putEntry(slot.at, {
      tsTrack: lists[0][0], tsSector: lists[0][1],
      type: type, locked: !!opts.locked,
      raw: raw, sectors: nData + nList,
    });
    return { track: lists[0][0], sector: lists[0][1], sectors: nData + nList };
  };

  Dos33.typeLetter = typeLetter;
  Dos33.typeByte = typeByte;
  Dos33.nameBytes = nameBytes;
  Dos33.TYPES = TYPES;
  Dos33.SECSIZE = SECSIZE;
  Dos33.ENTRY = ENTRY;
  Dos33.ENTRIES = ENTRIES;
  Dos33.NAME_LEN = NAME_LEN;
  Dos33.TS_FIRST = TS_FIRST;
  Dos33.TS_PAIRS = TS_PAIRS;
  Dos33.MAP_AT = MAP_AT;
  Dos33.MAP_IN_VTOC = MAP_IN_VTOC;
  Dos33.MAP_PER_SECTOR = MAP_PER_SECTOR;
  Dos33.VTOC_TRACK = VTOC_TRACK;
  Dos33.VTOC_SECTOR = VTOC_SECTOR;
  AGAT.Dos33 = Dos33;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
