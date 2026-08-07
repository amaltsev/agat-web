// Browser glue: hold a machine, run a frame's worth of CPU per animation
// frame, draw the screen, feed the speaker, and route dropped files to
// whichever drive can read them.
(function (AGAT) {
  'use strict';

  var CPU_HZ = AGAT.CPU_HZ;
  var MAX_CATCHUP_MS = 60;      // after a stall, drop the backlog rather than sprint

  function App(opts) {
    opts = opts || {};
    this.canvas = opts.canvas;
    this.ctx2d = this.canvas.getContext('2d', { alpha: false });
    this.roms = null;
    this.machine = null;
    this.video = null;
    this.speaker = new AGAT.Speaker();
    this.image = null;
    this.running = false;
    this.model = opts.model === 9 ? 9 : 7;     // the commoner machine, and the
    var profile = AGAT.Machine.PROFILES[this.model];  // one most native
    this.ramSize = this.model === 9                   // software expects
      ? profile.ram : (opts.ramSize || profile.ram);  // (the 9 has no choice)

    // What this machine has that its profile does not: slot -> {card, ram} in
    // bytes, or null for a slot left empty. A container sets it, and so does the
    // gear popup; like the RAM size it is a standing choice, not something a
    // bare image dropped afterwards clears.
    this.slotOverrides = opts.slots || null;
    this.slots = AGAT.Machine.resolveSlots(this.model, this.slotOverrides);

    this.modelPinned = false;
    this.drives = {};                     // slot -> {name, kind}
    // What was loaded, as it arrived: slot -> {name, bytes, patches, kind,
    // offset, prodos}, plus 'fil:<name>' for programs poked into memory. The
    // mounted Media is normalised and the drives keep only a name, so without
    // this there is nothing left to write an .agc back out of. The last three
    // are what saving a disk that has been written to needs in order to put the
    // sectors back where they came from.
    this.sources = {};
    // A container's own fields, kept so that loading one and saving it again
    // does not quietly drop what it said about the program.
    this.title = '';                      // also what the status line shows
    this.author = '';
    this.date = '';                       // text: "1989", "circa 1985", "1990-92"
    this.url = '';
    this.notes = '';
    this.fromAgc = '';                    // the container's filename, if any
    this.lastTime = 0;
    this.subFrameHz = opts.subFrameHz || 0;    // 0 = the machine's default
    this.irqModel = opts.irqModel || 'raster';  // 'raster' | 'held' | 'pulse'
    this.soundLog = null;
    this.onStatus = opts.onStatus || function () {};
    // What the on-screen keyboard watches: the byte a host key produced, the
    // key coming back up, and a modifier being held — which changes every cap
    // on the board without producing a byte of its own.
    this.onKey = opts.onKey || function () {};
    this.onKeyUp = opts.onKeyUp || function () {};
    this.onMods = opts.onMods || function () {};
    this.frame = this.frame.bind(this);
  }

  App.prototype.init = function () {
    var self = this;
    return AGAT.loadRoms(window.AGAT_ROMS).then(function (roms) {
      self.roms = roms;
      self.build();
      AGAT.attachKeyboard(window, self, {
        onKey: function (v, info) {
          self.speaker.start(); self.speaker.resume();
          self.onKey(v, info);
        },
        onKeyUp: function (info) { self.onKeyUp(info); },
        onMods: function (m) { self.onMods(m); },
      });
    });
  };

  // (Re)create the machine for the current model. Media already inserted is
  // carried across, so switching machines does not mean re-dropping your disks.
  App.prototype.build = function () {
    var keep = [], s, c;
    if (this.machine) {
      for (s = 0; s < 8; s++) {
        c = this.machine.cards[s];
        // Which slot it was in comes along: the 140K drive is slot 6 on the
        // Agat-9 and slot 3 on the Agat-7, and `sources` is keyed by slot.
        if (c && c.media) keep.push({ from: s, media: c.media });
      }
    }
    this.slots = AGAT.Machine.resolveSlots(this.model, this.slotOverrides);
    this.machine = new AGAT.Machine({
      model: this.model,
      ramSize: this.ramSize,
      sysmon: this.model === 7 ? this.roms.monitor7 : this.roms.monitor9,
    });
    this.machine.fit(this.slots, this.roms);
    this.video = new AGAT.Video(
      this.model === 7 ? this.roms.font7 : this.roms.font9,
      this.roms.palette,
      { m0: this.model === 7 ? 0x80 : 0x40 });
    this.drives = {};
    // The disks move with the machine, and so must what each one was loaded
    // from — otherwise switching models between writing to a disk and saving
    // would leave Save looking in an empty slot. Staged rather than moved in
    // place, because two drives can trade slots.
    var moved = {}, i, to;
    for (i = 0; i < keep.length; i++) {
      to = this.insert(keep[i].media);
      if (to !== keep[i].from && this.sources[keep[i].from]) {
        moved[to] = this.sources[keep[i].from];
        delete this.sources[keep[i].from];
      }
    }
    for (var slot in moved) this.sources[slot] = moved[slot];
    if (this.subFrameHz) this.machine.setSubFrameHz(this.subFrameHz);
    this.machine.setIrqModel(this.irqModel);
    this.machine.reset();
    this.resize();
    this.start();
  };

  // How the sub-frame interrupt reaches the CPU: 'raster' is the hardware as
  // measured, 'held' and 'pulse' are agat-emulator's two readings of it.
  App.prototype.setIrqModel = function (name) {
    this.irqModel = name;
    return this.machine.setIrqModel(name);
  };

  // Sub-frame interrupt rate, the one RISE OUT's music rides on.
  App.prototype.setSubFrameHz = function (hz) {
    this.subFrameHz = hz;
    return this.machine.setSubFrameHz(hz);
  };

  // Record what the speaker is actually asked to do, for a few seconds, so a
  // sound that comes out wrong can be looked at rather than described.
  //   agat.recordSound(3)   ->  then agat.soundReport()
  App.prototype.recordSound = function (seconds) {
    var self = this;
    // Sample at the interrupt's own cadence, not once per animation frame: a
    // value the handler reloads every few interrupts is invisible at 60 Hz.
    this.machine.onSubInt = function () {
      var L = self.soundLog;
      if (!L) return;
      for (var a in App.PLAY500_ZP) {
        var v = self.machine.read(Number(a));
        (L.zp[a] || (L.zp[a] = {}))[v] = (L.zp[a][v] || 0) + 1;
      }
      // Zero page lives in the Agat-7's window 0, so the handler and a sampler
      // running at another moment can be looking at different banks entirely.
      if (self.machine.mem7) {
        var st = self.machine.mem7.state;
        (L.bank[st] || (L.bank[st] = {}))[self.machine.read(0x84)] = 1;
      }
    };
    this.soundLog = {
      edges: [],
      zp: {},                                  // PLAY500's state, values seen
      bank: {},                                // Agat-7 window state -> $84 seen
      until: this.machine.cpu.cycles + (seconds || 3) * AGAT.CPU_HZ,
    };
    return 'recording ' + (seconds || 3) + 's of speaker activity';
  };

  // PLAY500 keeps its whole state in these. $84 is the note-length unit and the
  // usual suspect: the note runs $82 x $84 interrupts, so a $84 of 0 wraps the
  // countdown to 256 and stretches every sound by a factor of sixteen.
  App.PLAY500_ZP = { 0x81: 'period', 0x82: 'duration', 0x83: 'unitCount',
                     0x84: 'unit', 0x85: 'periodReload', 0x89: 'loop', 0x8a: 'busy' };

  App.prototype.soundReport = function () {
    var L = this.soundLog;
    if (!L || !L.edges.length) return 'nothing recorded — call agat.recordSound(3) first';
    var e = L.edges, out = [], run = 0, i;
    for (i = 1; i <= e.length; i++) {
      var g = i < e.length ? e[i] - e[i - 1] : -1;
      var g0 = e[run + 1] - e[run];
      if (i === e.length || Math.abs(g - g0) > g0 * 0.25) {
        out.push({
          hz: Math.round(AGAT.CPU_HZ / (2 * g0)),
          ints: +(g0 / this.machine.irqPeriod()).toFixed(2),
          ms: +((e[i - 1] - e[run]) / AGAT.CPU_HZ * 1000).toFixed(1),
          flips: i - run,
        });
        run = i;
        if (i < e.length) i++;
      }
    }
    // Report each byte's values with how many interrupts saw them, commonest
    // first — a value the handler only holds briefly still shows up.
    var zp = {};
    for (var k in L.zp) {
      var counts = L.zp[k];
      zp[App.PLAY500_ZP[k]] = Object.keys(counts)
        .sort(function (p, q) { return counts[q] - counts[p]; })
        .slice(0, 8)
        .map(function (v) { return Number(v) + 'x' + counts[v]; })
        .join(' ');
    }
    var banks = {};
    for (var b in L.bank) banks['state ' + b] = Object.keys(L.bank[b]).join(',');
    var sp = this.speaker;
    return {
      audio: sp.enabled
        ? 'on, ' + (sp.ctx ? sp.ctx.state : '?') + ', vol ' + sp.volume
        : 'NOT STARTED — the AudioContext needs a user gesture',
      latency: sp.latency(),
      interruptHz: Math.round(AGAT.CPU_HZ / this.machine.irqPeriod()),
      play500: zp,
      unitPerBank: banks,
      totalFlips: e.length,
      spanMs: +((e[e.length - 1] - e[0]) / AGAT.CPU_HZ * 1000).toFixed(1),
      notes: out.slice(0, 40),
    };
  };

  App.prototype.toggleLayout = function () {
    return this.machine.toggleLayout();
  };

  // Switching machines takes the new one's own RAM size unless told otherwise:
  // an Agat-9's 128K is not a sensible thing to carry over to an Agat-7 just
  // because a filename's `7a` moved the model.
  App.prototype.setModel = function (model, ramSize) {
    this.model = model === 7 ? 7 : 9;
    var profile = AGAT.Machine.PROFILES[this.model];
    this.ramSize = this.model === 9 ? profile.ram : (ramSize || profile.ram);
    this.build();
  };

  // ---- media ---------------------------------------------------------------

  App.prototype.slotFor = function (kind) {
    return AGAT.Machine.slotOf(this.slots, kind === 'nib140' ? 'fdd140' : 'fdd840');
  };

  // What the drive lamps show: every drive the model has, empty or not, so the
  // bar does not reflow the moment a disk is dropped into one of them.
  App.prototype.driveLamps = function () {
    var S = AGAT.Machine, now = this.machine.cpu.cycles, out = [], i;
    var want = [[S.slotOf(this.slots, 'fdd840'), '840K'],
                [S.slotOf(this.slots, 'fdd140'), '140K']];
    for (i = 0; i < want.length; i++) {
      var slot = want[i][0], card = this.machine.cards[slot];
      if (!card || !card.lamp) continue;
      var media = card.media;
      out.push({
        slot: slot,
        label: want[i][1],
        name: this.drives[slot] ? this.drives[slot].name : '',
        track: card.track,
        lamp: card.lamp(now),
        locked: !media || media.locked,
        // The disk claimed it was protected, which is worth showing even now
        // that the lock is the user's to set.
        headerProtect: !!(media && media.headerProtect),
        canUnlock: this.canUnlock(slot),
        written: !!(media && media.isWritten()),
      });
    }
    return out;
  };

  // Only the 140K controller writes. The 840K models no data-write register at
  // all, so unlocking one of its disks would promise something that cannot
  // happen; the lock stays on and the drive says why.
  App.prototype.canUnlock = function (slot) {
    var card = this.machine.cards[slot];
    return !!(card && card.media && card.media.kind === 'nib140' &&
              this.sources[slot]);
  };

  App.prototype.setLocked = function (slot, locked) {
    if (!this.canUnlock(slot)) return false;
    this.machine.cards[slot].media.locked = !!locked;
    return true;
  };

  // Has anything been written to a disk since it was mounted? What the Save
  // button uses to say there is something new to save.
  App.prototype.hasWrites = function () {
    for (var s = 0; s < 8; s++) {
      var card = this.machine.cards[s];
      if (card && card.media && card.media.isWritten()) return true;
    }
    return false;
  };

  App.prototype.ejectAll = function () {
    for (var s = 0; s < 8; s++) {
      var card = this.machine.cards[s];
      if (card && card.eject) card.eject();
    }
    this.drives = {};
  };

  App.prototype.insert = function (media) {
    var slot = this.slotFor(media.kind);
    var card = this.machine.cards[slot];
    if (!card || !card.insert) throw new Error('no drive for ' + media.kind);
    card.insert(media);
    this.drives[slot] = { name: media.name, kind: media.kind };
    return slot;
  };

  // Disks are inserted and booted; .fil files are poked straight into memory.
  //
  // `from` is the container entry this came out of, when it came out of one:
  // the bytes as they were packed and the patches applied to them, so a
  // container that is loaded and saved again writes back what it carried
  // rather than the patched image it ran.
  //
  // `over` is what beats a container about the machine — the page hands it what
  // the address said. It reaches the container branch and nowhere else, and
  // never travels with `from`: a container inside a container is refused.
  App.prototype.load = function (bytes, name, from, over) {
    var s = AGAT.sniff(bytes, name);
    if (!s.kind) {
      throw new Error(name + ': not a recognised Agat image (' + bytes.length + ' bytes)');
    }
    if (s.kind === 'agc') {
      if (from) throw new Error(name + ': a container inside a container');
      return this.applyAgc(s.agc, over);
    }
    // A file dropped on its own belongs to no container, and the last one's
    // title and remap are about a different program: a game's movement keys
    // silently applying to the next disk would be worse than no remap at all.
    if (!from) {
      this.title = this.author = this.date = this.url = '';
      this.notes = this.fromAgc = '';
      AGAT.keyboard.setRemap(null);
    }
    // Honour the machine the filename implies, unless the user has chosen one.
    if (s.hintModel && s.hintModel !== this.model && !this.modelPinned) {
      this.setModel(s.hintModel);
    }
    if (s.kind === 'fil') {
      if (!AGAT.loadFil) throw new Error('.fil loading is not built in yet');
      AGAT.loadFil(this.machine, s.payload);
      this.remember('fil:' + name, name, bytes, from, s);
      this.start();
      this.onStatus('loaded ' + (s.filName || name) + ' at $' +
                    s.loadAddr.toString(16).toUpperCase());
      return { kind: 'fil' };
    }
    var slot = this.insert(AGAT.mount(s));
    this.remember(slot, name, bytes, from, s);
    this.machine.reset();
    this.machine.bootSlot(slot);
    this.start();
    this.onStatus('booting ' + name + ' from slot ' + slot);
    return { kind: s.kind, slot: slot };
  };

  // Keyed by slot, so re-dropping a disk into a drive replaces what was there
  // rather than saving both.
  App.prototype.remember = function (key, name, bytes, from, s) {
    this.sources[key] = {
      name: name,
      bytes: from ? from.bytes : bytes,
      patches: from ? from.patches : [],
      kind: s.kind,
      offset: s.offset || 0,
      prodos: !!s.prodos,
    };
  };

  // ---- containers ----------------------------------------------------------

  // A container's slot map, kilobytes to bytes. `null` — an emptied slot —
  // survives as null, which is what it means.
  function scaleSlots(slots) {
    var out = {}, n;
    for (n in slots) {
      out[n] = slots[n] && { card: slots[n].card, ram: slots[n].ram * 1024 || 0 };
    }
    return out;
  }

  // The other direction, and only where the machine differs from its profile —
  // a container for a stock Agat-7 should not have to spell one out.
  App.prototype.slotDiff = function () {
    var base = AGAT.Machine.resolveSlots(this.model, null);
    var out = {}, any = false, n, mine, theirs;
    for (n in base) {
      if (!this.slots[n]) { out[n] = null; any = true; }
    }
    for (n in this.slots) {
      mine = this.slots[n];
      theirs = base[n];
      if (theirs && theirs.card === mine.card && (theirs.ram || 0) === (mine.ram || 0)) {
        continue;
      }
      out[n] = mine.ram ? { card: mine.card, ram: mine.ram >> 10 }
                        : { card: mine.card };
      any = true;
    }
    return any ? out : null;
  };

  // A container names a machine, so applying one is a rebuild: the model, the
  // RAM size and both interrupt settings go in together and build() applies
  // them all at once, rather than the machine being taken apart four times.
  //
  // `over` is whatever overrules the container — {model, ramSize, slots,
  // irqModel, subFrameHz}, in this object's own units, each key honoured only
  // if it is there. It belongs here, before the build, rather than in a second
  // one afterwards: build() resets the CPU and boots nothing, so a rebuild once
  // the media has loaded leaves the machine in the monitor with the disk still
  // in the drive.
  App.prototype.applyAgc = function (c, over) {
    over = over || {};
    // A container describes a whole machine, so the drives start empty: a disk
    // left in another drive is not part of what it says, and build() would
    // otherwise carry it across into the machine the container asked for.
    this.ejectAll();
    var model = over.model || c.machine.model;
    if (model) {
      this.modelPinned = true;         // as deliberate as a machine off the menu
      this.model = model;
    }
    this.ramSize = this.model === 9 ? 0x20000
                 : (over.ramSize || (c.machine.ram ? c.machine.ram * 1024
                                     : AGAT.Machine.PROFILES[this.model].ram));
    // Slot sizes and slot numbers, kilobytes in the file and bytes in here.
    // Asked for by name rather than by truth, because a `null` here is the
    // profile's own cards and has to survive as that.
    this.slotOverrides = 'slots' in over ? over.slots
                       : (c.machine.slots ? scaleSlots(c.machine.slots) : null);
    if (over.irqModel || c.quirks.irq) this.irqModel = over.irqModel || c.quirks.irq;
    this.subFrameHz = over.subFrameHz !== undefined ? over.subFrameHz
                                                   : (c.quirks.rate || 0);
    this.build();

    var keys = AGAT.keyboard.setRemap(c.keys);
    this.sources = {};                 // the container is the whole set
    this.title = c.title;
    this.author = c.author;
    this.date = c.date;
    this.url = c.url;
    this.notes = c.notes;
    this.fromAgc = c.name;
    for (var i = 0; i < c.media.length; i++) {
      this.load(c.media[i].payload, c.media[i].name, c.media[i]);
    }
    this.onStatus(this.credit() +
                  (keys.ok ? ' — ' + keys.ok + ' key' + (keys.ok > 1 ? 's' : '') +
                             (keys.remapped ? ', ' + keys.remapped + ' remapped' : '')
                           : '') +
                  (keys.bad.length ? ' — ignored ' + keys.bad.join(', ') : ''));
    return { kind: 'agc', title: c.title, media: c.media.length };
  };

  // The program, said the way a container names it: "RISE OUT — Andrew
  // Maltsev, 1989". The run loop's own status line has no room for this, so it
  // is worth saying once, on the load that brought it in.
  App.prototype.credit = function () {
    var who = [this.author, this.date].filter(Boolean).join(', ');
    return (this.title || this.fromAgc) + (who ? ' — ' + who : '');
  };

  // What a saved container should be called: the one it came from, or the
  // loaded image with its extension swapped. A title good enough to publish is
  // a decision for whoever renames the file afterwards.
  App.prototype.agcName = function () {
    if (this.fromAgc) return this.fromAgc;
    for (var k in this.sources) {
      return this.sources[k].name.replace(/\.[^.\/]*$/, '') + '.agc';
    }
    return '';
  };

  // One source as it should be saved: the file it arrived as, plus what has
  // been written to it since.
  //
  // A written track is decoded back to the 16 sectors it was nibblized from and
  // the difference comes out as patches, so a container still carries the image
  // as it was found and what changed stays legible. `this.sources` is left
  // alone and the baseline is the patched image the machine actually mounted,
  // so saving twice gives the same file rather than the same patch twice.
  //
  // A track that will not decode — a disk formatted some other way, a write
  // caught half done — has no sector image to be the difference from. Then the
  // nibble stream itself is what is saved, which is a bigger and duller file
  // but not a lossy one.
  App.prototype.writeBack = function (key) {
    var src = this.sources[key];
    var entry = { name: src.name, bytes: src.bytes, patches: src.patches };
    var card = this.machine.cards[key], gcr = AGAT.gcr140;
    var media = card && card.media;
    if (!media || !media.isWritten()) return entry;

    var base = AGAT.agc.applyPatches(src.bytes, src.patches);
    var out = new Uint8Array(base), ok = true, t, got;
    if (src.kind === 'nib140') {
      out.set(media.bytes.subarray(0, gcr.TRACKS * gcr.TRACK_LEN), src.offset);
    } else if (src.kind === 'dsk140') {
      for (t = 0; t < media.tracks && ok; t++) {
        if (!media.written[t]) continue;
        got = gcr.denibblizeTrack(media.bytes, media.trackBase(t),
                                  media.trackLen[t], t, src.prodos);
        if (got.got !== gcr.SECTORS) ok = false;
        else out.set(got.bytes, src.offset + t * gcr.SECTORS * 256);
      }
    } else {
      ok = false;
    }
    if (!ok) {
      return {
        name: src.name.replace(/\.[^.\/]*$/, '') + '.nib',
        bytes: new Uint8Array(media.bytes),
        patches: [],
      };
    }
    return {
      name: src.name,
      bytes: src.bytes,
      patches: src.patches.concat(AGAT.agc.diff(base, out)),
    };
  };

  // The machine as it stands, as a container: what is in the drives, the model
  // and RAM it is running as, both interrupt settings, and the live remap.
  App.prototype.toAgc = function () {
    var media = [], k;
    for (k in this.sources) media.push(this.writeBack(k));
    return AGAT.agc.build({
      title: this.title || (media.length ? media[0].name : ''),
      author: this.author,
      date: this.date,
      url: this.url,
      notes: this.notes,
      model: this.model,
      ram: this.ramSize >> 10,
      slots: this.slotDiff(),
      irq: this.irqModel,
      rate: this.subFrameHz,
      keys: AGAT.keyboard.remap(),
      media: media,
    });
  };

  App.prototype.readFile = function (file) {
    var self = this;
    return file.arrayBuffer().then(function (buf) {
      return self.load(new Uint8Array(buf), file.name);
    });
  };

  // ---- run loop ------------------------------------------------------------

  App.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.lastTime = 0;
    requestAnimationFrame(this.frame);
  };

  App.prototype.stop = function () { this.running = false; };

  App.prototype.reset = function () {
    this.machine.reset();
    this.start();
  };

  App.prototype.boot = function (slot) {
    this.machine.reset();
    this.machine.bootSlot(slot === undefined ? this.slotFor('aim840') : slot);
    this.start();
  };

  App.prototype.resize = function () {
    var v = this.video;
    if (this.canvas.width !== v.width || this.canvas.height !== v.height) {
      this.canvas.width = v.width;
      this.canvas.height = v.height;
      this.image = null;
    }
    // Also covers the first call, where the canvas already happens to be the
    // right size and so nothing above fires.
    if (!this.image) this.image = this.ctx2d.createImageData(v.width, v.height);
  };

  App.prototype.frame = function () {
    if (!this.running) return;
    var m = this.machine, cpu = m.cpu;

    // Run as many cycles as real time has passed, not a fixed budget per
    // animation frame: requestAnimationFrame follows the display, which is
    // rarely 50 Hz, and tying the CPU to it makes the machine run fast or slow
    // depending on the monitor. Music generated inside the 1 kHz interrupt
    // hears that directly.
    var t = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    if (!this.lastTime) this.lastTime = t - 20;
    var dt = t - this.lastTime;
    this.lastTime = t;
    if (dt > MAX_CATCHUP_MS) dt = MAX_CATCHUP_MS;

    if (this.soundLog) {
      for (var si = 0; si < m.speakerEdges.length; si++) {
        this.soundLog.edges.push(m.speakerEdges[si]);
      }
      if (cpu.cycles > this.soundLog.until) {
        this.onStatus('sound recorded: ' + this.soundLog.edges.length +
                      ' flips — call agat.soundReport()');
        this.soundLog.until = Infinity;
        this.soundLog.done = true;
        m.onSubInt = null;
      }
      if (this.soundLog.done) this.soundLog.until = -1;
    }
    m.speakerEdges.length = 0;
    var from = cpu.cycles;
    var target = from + Math.round(dt * 0.001 * CPU_HZ);
    while (cpu.cycles < target && !cpu.halted) cpu.step();
    this.speaker.play(m.speakerEdges, from, cpu.cycles);

    this.video.render(m);
    this.resize();
    this.image.data.set(
      this.video.pixels.subarray(0, this.video.width * this.video.height * 4));
    this.ctx2d.putImageData(this.image, 0, 0);

    if (cpu.halted) {
      this.running = false;
      this.onStatus('stopped — illegal opcode at $' +
                    cpu.jamPC.toString(16).toUpperCase());
      return;
    }
    requestAnimationFrame(this.frame);
  };

  // What is running, in one line: the program, the machine, the video mode and
  // what is in the drives. Only what nothing else on the page states — the
  // keyboard layout is on its own button, which can also change it, and the head
  // position is on the drive lamp, which is lit because the head is moving.
  App.prototype.describe = function () {
    var m = this.machine;
    if (!m) return '';
    var bits = [];
    // A container's title survives in the status line, which the run loop
    // otherwise overwrites twice a second with the machine's state.
    if (this.title) bits.push(this.title);
    bits.push('Agat-' + m.model);
    if (m.model === 7) bits.push((this.ramSize >> 10) + 'K');
    bits.push(m.appleVideo
      ? 'apple ' + (m.text ? 'text' : (m.hires ? 'hires' : 'lores'))
      : (AGAT.MODE_NAMES[m.videoMode().vtype] || 'mode ?'));
    for (var s in this.drives) {
      bits.push('S' + s + ' ' + this.drives[s].kind);
    }
    return bits.join(' · ');
  };

  AGAT.MODE_NAMES = {
    0: '64x64x4', 1: '128x128x4', 2: 'text 32', 3: '256x256x1',
    4: 'text 64', 5: '256x256x2', 6: '512x256x1', 10: 'text 64 inv',
  };

  AGAT.App = App;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
