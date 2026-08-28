// The machine as a snapshot — the `state` block of an .agc container.
//
// A container says what a program is: the disk it came on, the writes it has
// made, the machine it wants. What it cannot say on its own is where the
// program had got to, so reopening one always starts it from the boot ROM.
// `state` is the other half: the RAM, the CPU, the drive heads, the raster
// counter — everything the 6502 can observe, and nothing it cannot.
//
// Two rules run through all of it.
//
// **Restore writes into the machine that is already built; it never builds
// one.** App.build() has already made a Machine from Machine.PROFILES and fit
// its cards by the time a container's media load, so restoring is `ram.set()`
// and `cpu.pc = ...` into that. Which sounds like an implementation detail and
// is in fact the whole design: the live machine is a knot of deliberate
// aliases — `machine.cpu.bus` is the machine, `machine.psrom` is the same
// object as `machine.cards[2]`, `machine.rom` and `video.font` point into the
// shared ROM bundle, `Palette.cur` is one of four shared tables, a mouse's ROM
// is a subarray view of another card's. Anything that rebuilt a machine from
// JSON would have to reconstruct every one of those, and would silently get one
// of them wrong. Writing into what is there reconstructs none of them.
//
// The price is that the machine has to be the right shape first, which is what
// `fits` is for, and refusing is a real outcome: `#agc=game.agc&model=9` asks
// for a machine the snapshot is not about, and the container boots instead.
//
// **Host state is not in here.** The speaker's queue, the pointer capture, the
// wall clock and the diagnostics counters are the page's, not the machine's,
// and they resynchronise by themselves. What a program can read at $C030 — the
// cone's position — is the machine's, and that is saved.
(function (AGAT) {
  'use strict';

  // The snapshot's own version, inside the block rather than on `agc`: a
  // container carrying a state a reader does not understand is still a
  // container, and should boot rather than be refused.
  var VERSION = 1;

  // Every field of Machine that a program can reach and that reset() sets. RAM,
  // the cards and the two banking arrangements are handled apart, because they
  // are arrays or live on another object.
  var MACHINE_FIELDS = [
    'mode', 'prevMode', 'appleVideo', 'text', 'mixed', 'page2', 'hires',
    'videoInts', 'inVblank', 'rasterLine', 'nextLine', 'irqRaw',
    'psromMode', 'psromOfs', 'kbdLatch', 'cyrillic', 'speaker',
  ];

  // The CPU is entirely field-addressable — the addressing modes are closures
  // built fresh inside step() and nothing survives a call — so this is all of
  // it. `jamPC` is only there once an illegal opcode has stopped the machine.
  // `cycles` is not in here: it is the clock every other stamp in the machine
  // is measured against, so it sits at the top of the block rather than inside
  // the CPU that happens to count it.
  var CPU_FIELDS = [
    'a', 'x', 'y', 's', 'p', 'pc',
    'halted', 'irqLine', 'irqPending', 'nmiEdge',
  ];

  function copyFields(from, to, names) {
    for (var i = 0; i < names.length; i++) {
      if (from[names[i]] !== undefined) to[names[i]] = from[names[i]];
    }
    return to;
  }

  // ---- bytes ---------------------------------------------------------------
  //
  // The same three encodings a payload or a patch uses, chosen by the same size
  // rule: hex up to 32 bytes so a window map stays readable, and above that
  // whichever of base64 and gzip is smaller. A mostly-empty 128K of RAM is a
  // few kilobytes gzipped, which is what makes carrying it at all reasonable.

  function pack(bytes) {
    return AGAT.agc.encodeBytes(bytes, { hex: true });
  }

  function unpack(rec, what) {
    return AGAT.agc.decodeBytes(rec, what);
  }

  // Every Uint8Array in a saved object, packed in place. A card hands back
  // `{ state: 0x80, ram: this.ram }` and never sees base64 — which is the point
  // of doing it here rather than in each card.
  function packAll(o) {
    var todo = [], k;
    for (k in o) {
      if (o[k] instanceof Uint8Array) todo.push(packOne(o, k));
    }
    return Promise.all(todo).then(function () { return o; });
  }

  function packOne(o, k) {
    return pack(o[k]).then(function (enc) { o[k] = enc; });
  }

  // The other direction, into a **copy**: the keys named are decoded back to
  // bytes and everything else is carried over as the number or flag it was. A
  // copy because what is handed in is the container as it was parsed, which
  // belongs to whoever parsed it — decoding over the top of it would leave the
  // App holding a half-unpacked container, and the same file could then not be
  // opened twice.
  function unpackAll(o, keys, what) {
    var out = {}, todo = [], i, k;
    for (k in o) out[k] = o[k];
    for (i = 0; i < keys.length; i++) {
      if (out[keys[i]] !== undefined && out[keys[i]] !== null) {
        todo.push(unpackOne(out, keys[i], what + ' ' + keys[i]));
      }
    }
    return Promise.all(todo).then(function () { return out; });
  }

  function unpackOne(o, k, what) {
    return unpack(o[k], what).then(function (bytes) { o[k] = bytes; });
  }

  // Which keys of a card's record carry bytes. Asked of the card's class rather
  // than guessed from the value, because on the way in a packed record is an
  // object and so is everything else.
  var CARD_BYTES = {
    psrom: ['ram'],
    xram: ['ram'],
    xram9: ['ram', 'map', 'on'],
  };

  function cardBytes(name) {
    return CARD_BYTES[name] || [];
  }

  // ---- does this state fit this machine? -----------------------------------
  //
  // Synchronous and pure, so the answer can be had — and tested — without
  // decompressing anything. Returns the empty string when the state fits, and
  // otherwise the sentence saying why not, in the terms the person reading the
  // status line can act on: the model, the memory size, the slot.
  function fits(app, s) {
    if (!s || typeof s !== 'object') return 'the state block is not an object';
    if (s.version === undefined) return 'the state block gives no version';
    if (!(s.version <= VERSION)) {
      return 'the state was made by a newer emulator (state ' + s.version +
             ', this reads ' + VERSION + ')';
    }
    var m = app.machine, sm = s.machine || {};
    if (sm.model !== m.model) {
      return 'the state is for an Agat-' + sm.model +
             ' and this is an Agat-' + m.model;
    }
    if (sm.ramSize !== m.ramSize) {
      return 'the state is for ' + (sm.ramSize >> 10) + 'K of base RAM and ' +
             'this machine has ' + (m.ramSize >> 10) + 'K';
    }
    var want = s.slots || {}, have = app.slots || {}, n, w, h;
    for (n in want) {
      w = want[n];
      h = have[n];
      if (!h) return 'the state wants a ' + w.card + ' in slot ' + n +
                     ' and this machine has an empty slot';
      if (h.card !== w.card) {
        return 'the state wants a ' + w.card + ' in slot ' + n +
               ' and this machine has a ' + h.card;
      }
      if ((w.size || 0) !== (h.ram || 0)) {
        return 'the state wants ' + ((w.size || 0) >> 10) + 'K in slot ' + n +
               ' and this machine has ' + ((h.ram || 0) >> 10) + 'K';
      }
      if ((w.drives || 1) !== (h.drives || 1)) {
        return 'the state wants ' + (w.drives || 1) + ' drives on slot ' + n +
               ' and this machine has ' + (h.drives || 1);
      }
    }
    for (n in have) {
      if (!want[n]) {
        return 'this machine has a ' + have[n].card + ' in slot ' + n +
               ' and the state does not';
      }
    }
    return '';
  }

  // ---- out ------------------------------------------------------------------

  // The machine as it stands. A promise, because the byte arrays are packed and
  // the platform's gzip is a stream.
  //
  // `cycles` is saved as it is rather than rebased to zero: every other stamp
  // in the machine — the next raster line, both drives' byte clocks, the
  // «Марсианка»'s step timer — is an absolute value on that one scale, and
  // moving it would mean adjusting each of them for a tidier number in a field
  // nobody reads.
  function save(app) {
    var m = app.machine, out = { version: VERSION, cycles: m.cpu.cycles };
    out.cpu = copyFields(m.cpu, {}, CPU_FIELDS);
    if (m.cpu.halted && m.cpu.jamPC !== undefined) out.cpu.jamPC = m.cpu.jamPC;

    var sm = { model: m.model, ramSize: m.ramSize };
    copyFields(m, sm, MACHINE_FIELDS);
    sm.palette = m.palette.index;
    // The two machines bank differently and each carries only its own: the
    // Agat-7's $C0Fx nibble, from which Mem7 works its three windows out again,
    // and the Agat-9's eight window registers, which are not derived from
    // anything and are saved as they are.
    if (m.mem7) sm.mem7 = m.mem7.state;
    else sm.map = m.map;
    sm.ram = m.ram;
    out.machine = sm;

    var slots = {}, todo = [packAll(sm)], n, card;
    for (n in app.slots) {
      card = m.cards[n];
      slots[n] = saveCard(app, Number(n), card);
      todo.push(packAll(slots[n]));
    }
    out.slots = slots;
    return Promise.all(todo).then(function () { return out; });
  }

  // One slot. The card's own fields come from the card, because only it knows
  // which of them is state — the same reason lamp() belongs to the card — and
  // what is added here is what the slot rather than the card is: which card is
  // in it, how big it is, how many drives hang off it, and whether the disk in
  // each of them can be written to.
  //
  // `locked` is a drive each, and a snapshot taken before there were two
  // carries the one flag — which is D1's, as it was then.
  function saveCard(app, n, card) {
    var spec = app.slots[n], out = {}, k, own, d;
    if (card && card.saveState) {
      own = card.saveState();
      for (k in own) out[k] = own[k];
    }
    out.card = spec.card;
    if (spec.ram) out.size = spec.ram;
    if (spec.drives > 1) out.drives = spec.drives;
    if (card && card.mediaAt) {
      out.locked = [];
      for (d = 0; d < (card.drives || 1); d++) {
        out.locked.push(card.mediaAt(d) ? card.mediaAt(d).locked : null);
      }
    }
    return out;
  }

  // ---- back in --------------------------------------------------------------

  // Into the machine App.build() has already made. Rejects with what `fits`
  // said when the machine is the wrong shape, which is the one thing a caller
  // has to be ready for: a container that names a state and is opened on
  // another machine boots instead of resuming.
  function restore(app, s) {
    return Promise.resolve().then(function () {
      var why = fits(app, s);
      if (why) throw new Error(why);
      var keys = ['ram'], names = [], todo = [], n;
      if (s.machine.map !== undefined) keys.push('map');
      todo.push(unpackAll(s.machine, keys, 'state: machine'));
      for (n in s.slots) {
        names.push(n);
        todo.push(unpackAll(s.slots[n], cardBytes(s.slots[n].card),
                            'state: slot ' + n));
      }
      return Promise.all(todo).then(function (done) {
        var out = { cycles: s.cycles, cpu: s.cpu, machine: done[0], slots: {} };
        for (var i = 0; i < names.length; i++) out.slots[names[i]] = done[i + 1];
        return out;
      });
    }).then(function (decoded) {
      return apply(app, decoded);
    });
  }

  // Everything decoded, written in one pass. Nothing here allocates: every
  // array is filled in place so that whatever else holds a reference to it —
  // and on this machine plenty does — goes on holding the same one.
  function apply(app, s) {
    var m = app.machine, sm = s.machine;

    m.ram.set(sm.ram);
    copyFields(sm, m, MACHINE_FIELDS);
    m.palette.setIndex(sm.palette);
    // Mem7's three window offsets are worked out from the nibble, so putting
    // the nibble back through setState is both shorter than saving them and the
    // only way they cannot disagree.
    if (m.mem7) m.mem7.setState(sm.mem7);
    else if (sm.map) m.map.set(sm.map);

    var n, card;
    for (n in s.slots) {
      card = m.cards[n];
      if (!card) continue;
      if (card.loadState) card.loadState(s.slots[n]);
      // The disk itself is not in here — the container's payload and its
      // patches already are the written disk, so a restored drive finds what it
      // was reading. What the state carries is the lock, which is the person's
      // choice rather than the program's and would otherwise come back on.
      setLocks(card, s.slots[n].locked);
    }

    copyFields(s.cpu, m.cpu, CPU_FIELDS);
    if (s.cpu.jamPC !== undefined) m.cpu.jamPC = s.cpu.jamPC;
    m.cpu.cycles = s.cycles;

    // The edge log is the page's, not the machine's, and every stamp in it is
    // older than the clock that was just restored. The cone's position came
    // back with the rest of the machine, so the next flip is an edge from where
    // the program left it.
    m.speakerEdges.length = 0;
    return s;
  }

  // The write locks, one per drive — or the single flag a snapshot taken
  // before there were two carries, which is the first drive's.
  function setLocks(card, locked) {
    var list, d, media;
    if (locked === undefined || locked === null || !card.mediaAt) return;
    list = locked instanceof Array ? locked : [locked];
    for (d = 0; d < list.length; d++) {
      media = card.mediaAt(d);
      if (media && list[d] !== null && list[d] !== undefined) {
        media.locked = !!list[d];
      }
    }
  }

  // What the status line says about a resumed machine: where the program was,
  // and how long it had been running. Seconds because the cycle count means
  // nothing to anyone, and $ because every other address on this page is hex.
  function describe(s) {
    return 'resumed at $' + (s.cpu.pc | 0).toString(16).toUpperCase() +
           ', ' + (s.cycles / AGAT.CPU_HZ).toFixed(1) + 's in';
  }

  AGAT.state = {
    VERSION: VERSION,
    fits: fits, save: save, restore: restore, describe: describe,
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
