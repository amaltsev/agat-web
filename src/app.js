// Browser glue: hold a machine, run a frame's worth of CPU per animation
// frame, draw the screen, feed the speaker, and route dropped files to
// whichever drive can read them.
(function (AGAT) {
  'use strict';

  var CPU_HZ = AGAT.CPU_HZ;
  var MAX_CATCHUP_MS = 60;      // after a stall, drop the backlog rather than sprint
  var MOUSE_QUIET = 15 * CPU_HZ;   // no read for this long: the program is not using it

  // What one load — a gesture, or a container — has brought in so far.
  function newPending() { return { disks: [], boot: '', decided: false }; }

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
    // Held still on purpose, as against merely not running. It is sticky —
    // start() refuses while it is set — because everything that touches the
    // machine calls start() on its way out, and a pause any of them undid would
    // be a pause that never lasted. What clears it is the things that mean "run
    // this": the button itself, Boot, Reset, and a file arriving.
    this.paused = false;
    // The take being made and the take being played, at most one of each and
    // never both: starting either stops the other. `recording` is the one this
    // session holds — a container carries one, deliberately.
    this.recorder = null;
    this.player = null;
    this.recording = null;
    this.model = opts.model === 9 ? 9 : 7;     // the commoner machine, and the
    var profile = AGAT.Machine.PROFILES[this.model];  // one most native
    this.ramSize = this.model === 9                   // software expects
      ? profile.ram : (opts.ramSize || profile.ram);  // (the 9 has no choice)

    // What this machine has that its profile does not, in two layers, each by
    // card class rather than by slot — see Machine.cardsOf. `agcCards` is what
    // a container asked for and `overCards` is what the gear popup and the
    // address say over the top of it; build() merges them and works out the
    // slots for whichever model is being built. Like the RAM size they are
    // standing choices, not something a bare image dropped afterwards clears.
    this.agcModel = 0;                    // what a container named, 0 if none
    this.agcRam = 0;                      // its base RAM in bytes, 0 if unsaid
    this.agcCards = null;
    this.agcMonitor = '';                 // the monitor it asked for, '' if unsaid
    // The machine as the container found it, still packed, or null. Unlike the
    // fields above it is not a standing choice: it belongs to the one file, and
    // what it is for after the load is the Save popup's checkbox, which offers
    // to write a state back for a container that came with one.
    this.agcState = null;
    this.overCards = opts.cards || null;
    this.slotOverrides = null;            // derived: the merge, as slots
    this.slots = AGAT.Machine.resolveSlots(this.model, this.cardSlots());

    // Which monitor the machine is plugged into — a name in AGAT.MONITORS.
    // A standing choice like the RAM size: the machine outputs a 4-bit color
    // code and the monitor decides what color that is, so software drawn for
    // one monitor looks wrong on another.
    this.monitor = AGAT.MONITORS[opts.monitor] ? opts.monitor : AGAT.MONITOR_DEFAULT;
    // The media kind of the drive booted last, so Boot starts that one
    // again. A kind and not a slot: switching models moves the 140K drive
    // from slot 3 to slot 6, and the disk moves with it.
    this.lastBoot = '';
    // Every disk this session holds, in the order a container lists them:
    //
    //   { id, name, kind, offset, prodos, bytes, patches, media }
    //
    // `media` is what a drive reads and null for a .fil, which is in this list
    // so that saving keeps it. The rest is the file as it arrived — what a
    // written disk is put back into to work out its patches — and the entry
    // owns its media, so a disk can be taken out of one drive and put in
    // another without anything having to be re-keyed.
    //
    // A machine has two drives at the most and a container may carry more
    // disks than that; what is not in a drive is still the session's, still
    // saved, and still in this list.
    this.disks = [];
    this.nextDiskId = 1;
    // A container's own fields, kept so that loading one and saving it again
    // does not quietly drop what it said about the program.
    this.title = '';                      // also the head of the info card
    this.author = '';
    this.date = '';                       // text: "1989", "circa 1985", "1990-92"
    this.url = '';
    this.notes = '';                      // the record; nothing draws it
    this.info = '';                       // what the program is, at any length
    this.hint = '';                       // the line at the foot of that card
    this.fromAgc = '';                    // the container's filename, if any
    this.lastTime = 0;
    // Whether the page is holding the pointer for the machine. A mouse card is
    // a standing choice like the RAM size; being captured is not, and the
    // status line has to say so — a captured pointer is one the rest of the
    // page has stopped receiving.
    this.mouseCaptured = false;
    // The two ways movement reaches the card without the pointer being held:
    // the gear popup's trackpad checkbox, and a touchscreen, which has no
    // pointer to hold and steers trackpad-style whenever a card is fitted.
    this.mouseTrackpad = false;           // the checkbox, from index.html
    this.mouseTouch = false;              // a touch has fed the card
    this.mousePolls = -1;                 // the card's read count, last status line
    this.mouseSeen = 0;                   // and the cycle it last went up
    this.bootNote = '';                   // why a container's `boot` was not honored
    this.soundLog = null;
    // Set by startOpen and spent by the first file of that gesture that turns
    // out to be loadable: see startOpen.
    this.freshOpen = false;
    // Whether a gesture is still arriving, and what it has brought so far —
    // the drives it filled and what it asked to boot. One load makes one boot
    // decision, and it is made when the last of it is in: see finishOpen.
    this.opening = false;
    this.pending = newPending();
    this.agcBoot = '';                    // the container's own `boot`, for Save
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
      if (AGAT.attachMouse) AGAT.attachMouse(self.canvas, self);
    });
  };

  // ---- input ---------------------------------------------------------------
  //
  // Every way a person reaches the machine, in four calls. Not tidiness: an
  // action recorder has to see each input once and a replay has to be able to
  // produce it, and neither is possible while a DOM handler writes $C000 or a
  // card's button bits itself.
  //
  // What goes through here is what the machine can see — the byte in the
  // keyboard latch, the ЛАТ/РУС bit at $C063, whole mouse counts and the two
  // buttons — never host units. `mouseMove` takes pixels because the page has
  // nothing else to offer, and hands back the counts they came to.

  App.prototype.key = function (code) {
    if (this.player) return;              // a replay owns the machine
    this.machine.keyDown(code);
    if (this.recorder) this.recorder.add('k', code | 0x80);
  };

  // ЛАТ / РУС, which software reads at $C063 and the host keyboard reads to
  // decide which plane a key is in.
  App.prototype.setLayout = function (rus) {
    if (this.player) return this.machine.cyrillic;
    if (this.recorder) this.recorder.add('l', rus ? 1 : 0);
    return this.machine.setLayout(rus);
  };

  App.prototype.toggleLayout = function () {
    return this.setLayout(!this.machine.cyrillic);
  };

  // Host pixels into the mouse counters, `[ix, iy]` back — the whole counts the
  // card took, which is nothing at all for a movement smaller than a count.
  // Null where no mouse is fitted.
  App.prototype.mouseMove = function (dx, dy) {
    var c = this.mouseCard();
    if (!c || this.player) return null;
    var step = c.move(dx, dy);
    // Only where it came to a count: a recording of every host pixel would be
    // mostly zeroes, and zeroes the machine never saw.
    if (this.recorder && (step[0] || step[1])) {
      this.recorder.add('m', step[0], step[1]);
    }
    return step;
  };

  // One button, by bit: 0 is A, 1 is B.
  App.prototype.mouseButton = function (n, down) {
    var c = this.mouseCard();
    if (c) this.mouseButtons(down ? (c.btn | (1 << n)) : (c.btn & ~(1 << n)));
  };

  // Both at once — what letting go of the pointer does, since nothing will
  // report the release of a button held while it goes.
  App.prototype.mouseButtons = function (mask) {
    var c = this.mouseCard();
    if (!c || this.player) return;
    c.setBtn(mask);
    if (this.recorder) this.recorder.add('b', c.btn);
  };

  // The mouse card, if one is fitted. All three answer move() and carry the
  // same two button bits, so nothing outside src/mouse.js has to know which.
  App.prototype.mouseCard = function () {
    var m = this.machine, s;
    if (!m) return null;
    for (s = 0; s < 8; s++) if (m.cards[s] && m.cards[s].isMouse) return m.cards[s];
    return null;
  };

  // Why a mouse is doing nothing, in one line each. A mouse has two halves that
  // fail identically on screen — the page not feeding the card, and the program
  // not reading it — and the machine cannot tell you which, so this counts both
  // and says which one is at zero. Call it, wave the mouse, call it again: the
  // second call reports the difference as well as the totals.
  //
  //   agat.mouseReport()
  App.prototype.mouseReport = function () {
    var m = this.machine, card = this.mouseCard(), out = [], n, i, reads;
    var slots = [], seen = [];
    for (n in this.slots) slots.push(n + ':' + this.slots[n].card);
    out.push('machine   Agat-' + this.model + ' ' + (this.ramSize >> 10) + 'K, slots ' +
             slots.sort().join(' '));
    if (!card) {
      out.push('mouse     none fitted — pick one in the gear popup');
      console.log(out.join('\n'));
      return 'no mouse';
    }
    out.push('card      ' + card.name + ' in slot ' + card.slot +
             ' ($C0' + (0x80 + card.slot * 16).toString(16).toUpperCase() + '-$C0' +
             (0x8f + card.slot * 16).toString(16).toUpperCase() + ')');

    // The host half. Movement only reaches the card while the pointer is held
    // or a trackpad path is feeding it, and the commonest reason for this to be
    // zero is that none of the three is true.
    var prev = this.mouseLast || {};
    out.push('pointer   ' + (this.mouseCaptured ? 'held'
             : this.mouseTrackpad ? 'trackpad — moves over the screen feed it'
             : this.mouseTouch ? 'touch — strokes on the screen feed it'
             : 'NOT held — click the screen first'));
    out.push('host→card ' + card.moves + ' moves, ' + card.counts + ' counts' +
             (prev.moves === undefined ? '' : '   (+' + (card.moves - prev.moves) +
              ' moves, +' + (card.counts - prev.counts) + ' counts since last report)'));
    out.push('buttons   ' + (card.btn & 1 ? 'A' : '-') + (card.btn & 2 ? 'B' : '-') +
             '   (host left is A, right is B)');

    // The machine half, per register, so a program reading the wrong ones shows
    // up as plainly as a program reading none.
    reads = [];
    for (i = 0; i < 16; i++) {
      if (card.regs[i]) reads.push('$C0' + (0x80 + card.slot * 16 + i).toString(16).toUpperCase() +
                                   '×' + card.regs[i]);
    }
    out.push('card→cpu  ' + card.polls + ' reads' +
             (prev.polls === undefined ? '' : '   (+' + (card.polls - prev.polls) +
              ' since last report)'));
    out.push('registers ' + (reads.length ? reads.join(' ') : 'NONE — the program has never read this card'));

    // And which slots the program does poke, which is how a mouse in a slot the
    // program never scans tells itself apart from one it scans and rejects.
    var per = {}, addr, s, e;
    for (n in m.ioSeen) {
      addr = parseInt(n.slice(1), 16);
      if (addr < 0xc090 || addr > 0xc0ef) continue;
      s = ((addr & 0xff) >> 4) - 8;    // as ioRead decodes it: the low byte
      e = per[s] || (per[s] = { r: 0, w: 0 });
      if (n.charAt(0) === 'R') e.r += m.ioSeen[n];
      else e.w += m.ioSeen[n];
    }
    for (i = 1; i <= 7; i++) {
      if (per[i]) seen.push('s' + i + ' r' + per[i].r + '/w' + per[i].w);
    }
    out.push('slot i/o  ' + (seen.length ? seen.join('   ') : 'none'));
    out.push('program   pc=$' + m.cpu.pc.toString(16).toUpperCase());
    this.mouseLast = { moves: card.moves, counts: card.counts, polls: card.polls };
    console.log(out.join('\n'));
    return card.name + ': host→card ' + card.moves + ' moves, card→cpu ' + card.polls + ' reads';
  };

  // (Re)create the machine for the current model. Media already inserted is
  // carried across, so switching machines does not mean re-dropping your disks.
  App.prototype.build = function () {
    // What is in which drive, as entries rather than slots: the 140K drive is
    // slot 6 on the Agat-9 and slot 3 on the Agat-7, and a disk stays in the
    // drive it was in — D2 of the old machine is D2 of the new one.
    this.machineChanged();             // a rebuilt machine is not the one recorded
    var keep = [], i, at;
    for (i = 0; i < this.disks.length; i++) {
      at = this.mountedAt(this.disks[i]);
      if (at) keep.push({ entry: this.disks[i], drv: at.drv });
    }
    this.slots = AGAT.Machine.resolveSlots(this.model, this.cardSlots());
    this.machine = new AGAT.Machine({
      model: this.model,
      ramSize: this.ramSize,
      sysmon: this.model === 7 ? this.roms.monitor7 : this.roms.monitor9,
    });
    this.machine.fit(this.slots, this.roms);
    this.video = new AGAT.Video(
      this.model === 7 ? this.roms.font7 : this.roms.font9,
      AGAT.monitorPalette(this.monitor),
      { m0: this.model === 7 ? 0x80 : 0x40 });
    for (i = 0; i < keep.length; i++) {
      this.place(keep[i].entry, keep[i].drv);
    }
    this.machine.reset();
    this.resize();
    this.start();
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

  // Repaints rather than rebuilds: the monitor is on the far side of the RGB
  // connector, so changing it changes no machine state at all.
  App.prototype.setMonitor = function (name) {
    this.monitor = AGAT.MONITORS[name] ? name : AGAT.MONITOR_DEFAULT;
    if (this.video) this.video.setPalette(AGAT.monitorPalette(this.monitor));
  };

  // Switching machines takes the new one's own RAM size unless told otherwise:
  // an Agat-9's 128K is not a sensible thing to carry over to an Agat-7 just
  // because the menu moved the model.
  App.prototype.setModel = function (model, ramSize) {
    this.model = model === 7 ? 7 : 9;
    var profile = AGAT.Machine.PROFILES[this.model];
    this.ramSize = this.model === 9 ? profile.ram : (ramSize || profile.ram);
    this.build();
  };

  // ---- media ---------------------------------------------------------------

  App.prototype.slotFor = function (kind) {
    return AGAT.Machine.slotForKind(this.slots, kind);
  };

  // Every drive the machine is fitted with, in the order the lamps are drawn:
  // the 840K controller and then the 140K, each with the one drive it has
  // unless a container asked for two.
  App.prototype.driveList = function () {
    var S = AGAT.Machine, out = [], i, d;
    var want = [[S.slotOf(this.slots, 'fdd840'), '840K'],
                [S.slotOf(this.slots, 'fdd140'), '140K']];
    for (i = 0; i < want.length; i++) {
      var slot = want[i][0], card = this.machine.cards[slot];
      if (!card || !card.lamp) continue;
      for (d = 0; d < (card.drives || 1); d++) {
        out.push({ slot: slot, drv: d, drives: card.drives || 1,
                   label: want[i][1] });
      }
    }
    return out;
  };

  // The disk in one drive, as the entry that carries what it was loaded from,
  // or null. The card holds the media and this list holds everything else
  // about it, and they are matched by identity — a medium is in one drive of
  // one machine and there is nothing else it could be.
  App.prototype.diskIn = function (slot, drv) {
    var card = this.machine.cards[slot];
    var media = card && card.mediaAt ? card.mediaAt(drv) : null;
    if (!media) return null;
    for (var i = 0; i < this.disks.length; i++) {
      if (this.disks[i].media === media) return this.disks[i];
    }
    return null;
  };

  // Which drive an entry is in, `{slot, drv}`, or null for one on the shelf.
  App.prototype.mountedAt = function (entry) {
    var list = this.driveList(), i, card;
    if (!entry || !entry.media) return null;
    for (i = 0; i < list.length; i++) {
      card = this.machine.cards[list[i].slot];
      if (card.mediaAt(list[i].drv) === entry.media) {
        return { slot: list[i].slot, drv: list[i].drv };
      }
    }
    return null;
  };

  // Put a disk in a drive. A disk is in one drive at a time, so it comes out of
  // wherever it was, and whatever was in this one goes back on the shelf —
  // which is what carrying a floppy from drive to drive does.
  App.prototype.mount = function (entry, slot, drv) {
    var card = this.machine.cards[slot], at = this.mountedAt(entry);
    if (!card || !card.insert || !entry || !entry.media) return false;
    // The media kind, not the file's: a .dsk and a .nib of the same disk are
    // one drive's business, and AGAT.mount normalized both to one of two.
    if (this.slotFor(entry.media.kind) !== slot) return false;
    this.machineChanged();
    if (at) this.machine.cards[at.slot].eject(at.drv);
    card.insert(entry.media, drv);
    return true;
  };

  App.prototype.unmount = function (slot, drv) {
    var card = this.machine.cards[slot];
    this.machineChanged();
    if (card && card.eject) card.eject(drv);
  };

  // Where a disk goes when nobody has said: the drive its size belongs to, and
  // the first one of those that is empty. `want` asks for one drive in
  // particular and takes it whether or not something was there — a rebuild puts
  // each disk back where it was. -1 when the machine has no such drive or every
  // one of them is full, and then the disk stays on the shelf.
  App.prototype.place = function (entry, want) {
    var slot = this.slotFor(entry.media.kind), card = this.machine.cards[slot];
    if (!card || !card.insert) return -1;
    if (want !== undefined && want < (card.drives || 1)) {
      return this.mount(entry, slot, want) ? slot : -1;
    }
    var spot = this.machine.freeSpot(entry.media.kind);
    return spot && this.mount(entry, spot.slot, spot.drv) ? spot.slot : -1;
  };

  // What the drive lamps show: every drive the machine has, empty or not, so
  // the bar does not reflow the moment a disk is dropped into one of them.
  App.prototype.driveLamps = function () {
    var now = this.machine.cpu.cycles, list = this.driveList(), out = [], i;
    for (i = 0; i < list.length; i++) {
      var d = list[i], card = this.machine.cards[d.slot];
      var entry = this.diskIn(d.slot, d.drv), media = entry && entry.media;
      out.push({
        slot: d.slot,
        drv: d.drv,
        drives: d.drives,
        label: d.label,
        name: entry ? entry.name : '',
        kind: entry ? entry.kind : '',
        track: card.trackAt(d.drv),
        lamp: card.lamp(now, d.drv),
        locked: !media || media.locked,
        // The disk claimed it was protected, which is worth showing even now
        // that the lock is the user's to set.
        headerProtect: !!(media && media.headerProtect),
        canUnlock: this.canUnlock(entry),
        written: !!(media && media.isWritten()),
      });
    }
    return out;
  };

  // A disk can be unlocked once there is one: every entry carries the file it
  // arrived as, which is what a save needs in order to keep the writes.
  App.prototype.canUnlock = function (entry) {
    return !!(entry && entry.media);
  };

  App.prototype.setLocked = function (entry, locked) {
    if (!this.canUnlock(entry)) return false;
    this.machineChanged();
    entry.media.locked = !!locked;
    return true;
  };

  // Has anything been written to a disk since it was mounted? What the Save
  // button uses to say there is something new to save. Every disk the session
  // holds, not only the ones in a drive: a disk written to and then taken out
  // is still a disk with something new on it.
  App.prototype.hasWrites = function () {
    for (var i = 0; i < this.disks.length; i++) {
      if (this.disks[i].media && this.disks[i].media.isWritten()) return true;
    }
    return false;
  };

  // Can this disk go in that drive? The controllers read different disks, and
  // this is the whole of what the panel's list of disks is filtered by.
  App.prototype.fitsDrive = function (entry, slot) {
    return !!(entry && entry.media && this.slotFor(entry.media.kind) === slot);
  };

  // A blank disk: the right number of zero bytes, and nothing else. What a box
  // of new floppies held, and DOS's own INIT is what puts a catalog on it,
  // exactly as it did on the machine.
  App.prototype.blankDisk = function (kind) { return this.newDisk(kind, false); };

  // The same disk with a VTOC and an empty catalog already on it, for the
  // machine that has no DOS to INIT one with — a program saving its data, a
  // disk built here and read on the hardware.
  App.prototype.dosDisk = function (kind) { return this.newDisk(kind, true); };

  // Formatted before it is mounted, so what the session carries and saves is
  // the disk itself rather than a blank and a patch over it.
  //
  // It arrives unlocked, unlike every disk that comes from a file: there is
  // nothing on it to protect, and a locked blank is of no use to anybody.
  App.prototype.newDisk = function (kind, formatted) {
    var sizes = { dsk140: 143360, dsk840: 860160 };
    if (!sizes[kind]) throw new Error('no blank of kind ' + kind);
    var stem = formatted ? 'dos' : 'blank';
    var name = stem + '.dsk', n = 1, i, taken = true;
    while (taken) {
      taken = false;
      for (i = 0; i < this.disks.length; i++) {
        if (this.disks[i].name === name) taken = true;
      }
      if (taken) name = stem + '-' + (++n) + '.dsk';
    }
    var s = { kind: kind, name: name, payload: new Uint8Array(sizes[kind]),
              offset: 0, prodos: false };
    if (formatted) AGAT.Dos33.format(new AGAT.Sectors(kind, s.payload, {}));
    var entry = this.remember(name, s.payload, null, s, AGAT.mount(s));
    entry.media.locked = false;
    return entry;
  };

  // One file, into one drive, and nothing else touched. Everything else that
  // opens a file replaces the session — see startOpen — and this is the other
  // gesture: the disk in this drive, changed, while the machine goes on
  // running whatever it was running.
  //
  // A container is taken for its media and for nothing else: the machine it
  // asks for, its title, its keys and the state it was saved in are what
  // opening it as a session means, and this drive is not that. Asynchronous
  // for the one reason `load` is — a container's payload may be gzipped.
  App.prototype.openInto = function (slot, drv, bytes, name) {
    var self = this;
    return Promise.resolve().then(function () {
      var s = AGAT.sniff(bytes, name);
      if (s.kind !== 'agc') {
        if (!s.kind || s.kind === 'fil') throw new Error(name + ': not a disk image');
        return self.putIn(slot, drv, { name: name, bytes: bytes, sniffed: s,
                                       media: AGAT.mount(s), from: null });
      }
      return AGAT.agc.parse(bytes, name).then(function (c) {
        // `looks` said this was a container and the JSON says otherwise.
        if (!c) throw new Error(name + ': not a disk image');
        var pick = self.mediumFor(c, slot, drv);
        if (!pick) throw new Error(name + ': carries no disk this drive can read');
        return self.putIn(slot, drv, pick);
      });
    });
  };

  // Which of a container's media goes in this drive: the one the container
  // puts here, and the first the drive can read otherwise. What a medium is is
  // read off its bytes as everywhere else, and mounting it is what says which
  // controller it belongs to.
  App.prototype.mediumFor = function (c, slot, drv) {
    var fits = [], i, m, s, media, spot;
    for (i = 0; i < c.media.length; i++) {
      m = c.media[i];
      s = AGAT.sniff(m.payload, m.name);
      if (!s.kind || s.kind === 'agc' || s.kind === 'fil') continue;
      media = AGAT.mount(s);
      if (this.slotFor(media.kind) !== slot) continue;
      spot = this.mountSpot(m.mount);
      fits.push({ name: m.name, bytes: m.payload, sniffed: s, media: media,
                  from: m,
                  here: !!(spot && spot.slot === slot && spot.drv === drv) });
    }
    for (i = 0; i < fits.length; i++) if (fits[i].here) return fits[i];
    return fits[0] || null;
  };

  // The disk in the drive, and in the session's list so a save keeps it. A
  // medium out of a container brings its patches and its pristine bytes with
  // it, and is locked unless the container said the program may write to it —
  // the same rule loadOne follows.
  App.prototype.putIn = function (slot, drv, item) {
    if (this.slotFor(item.media.kind) !== slot) {
      throw new Error(item.name + ' is a ' + item.sniffed.kind +
                      ', which this drive cannot read');
    }
    var entry = this.remember(item.name, item.bytes, item.from, item.sniffed,
                              item.media);
    if (item.from && item.from.writable) entry.media.locked = false;
    this.mount(entry, slot, drv);
    return entry;
  };

  // A disk the session no longer wants: out of its drive, and out of the list,
  // so a container saved afterwards does not carry it.
  App.prototype.forget = function (entry) {
    var at = this.mountedAt(entry), i;
    if (at) this.unmount(at.slot, at.drv);
    for (i = 0; i < this.disks.length; i++) {
      if (this.disks[i] === entry) { this.disks.splice(i, 1); return true; }
    }
    return false;
  };

  App.prototype.ejectAll = function () {
    for (var s = 0; s < 8; s++) {
      var card = this.machine.cards[s];
      if (card && card.eject) card.eject();
    }
    this.lastBoot = '';
  };

  // One gesture — a drop, a Load, a link, the address — is about to hand
  // over files, and whatever was open before is not part of what it says. The
  // clear cannot happen here, for two reasons: a gesture carries any number of
  // files and they belong together, and a file that turns out not to be an
  // image should leave the running machine alone rather than empty it. So this
  // only arms it, and `loadOne` spends it on the first file that loads.
  //
  // Files together, not one after another: Load takes several and so does a
  // drop, and that is how a container comes to name two disks — a system disk
  // and a blank for it to write on.
  App.prototype.startOpen = function () {
    this.freshOpen = true;
    this.opening = true;
    this.pending = newPending();
  };

  // Spending it: the drives are emptied and the disk list with them, so that
  // what gets saved is what was opened. The two go together — an entry is what
  // a disk arrived as, and Save reads it to work out what the program wrote —
  // and a disk left in a drive that the container would not carry is exactly
  // the container that does not run.
  App.prototype.takeFresh = function () {
    if (!this.freshOpen) return;
    this.freshOpen = false;
    this.ejectAll();
    this.disks = [];
  };

  // The rest of the gesture has arrived. Everything it named is in the drives
  // or in memory, and this is where the one boot happens — unless what was
  // opened has already said what boots, which is what a container does.
  App.prototype.finishOpen = function () {
    var p = this.pending;
    this.opening = false;
    this.pending = newPending();
    if (!p.decided) this.decideBoot(p);
    this.start();
  };

  // The boot itself. Without a `boot` the first disk opened wins, whichever
  // drive it went into; with no disk at all there is nothing to boot and
  // whatever a .fil left running stands. A `boot` that names a card this
  // machine was not built with is not honored — there is no slot to enter —
  // and the default is taken instead, with the reason on the status line.
  App.prototype.decideBoot = function (p) {
    var slot = -1, note = '';
    this.bootNote = '';
    if (p.boot === 'none') return;
    if (p.boot === 'monitor') { this.machine.reset(); return; }
    if (p.boot) {
      slot = this.bootSlotOf(p.boot);
      if (slot < 0) this.bootNote = note = 'no ' + p.boot + ' in this machine';
    }
    if (slot < 0) slot = p.disks.length ? p.disks[0] : -1;
    if (slot < 0) {
      if (note) this.onStatus(note);
      return;
    }
    this.bootFrom(slot);
    var entry = this.diskIn(slot, 0);
    this.onStatus('booting ' + (entry ? entry.name : 'slot ' + slot) +
                  ' from slot ' + slot + (note ? ' — ' + note : ''));
  };

  // A `boot` value as a slot of the machine that got built; -1 for a card it
  // has not got. Machine.slotNamed is the rule.
  App.prototype.bootSlotOf = function (spec) {
    return AGAT.Machine.slotNamed(this.slots, spec);
  };

  // Reset and enter a slot's card ROM — ПР#n, and the whole of what starting a
  // disk is. The drive is remembered: Boot on its own starts the same one.
  App.prototype.bootFrom = function (slot) {
    var entry = this.diskIn(slot, 0);
    this.lastBoot = entry ? entry.kind : '';
    this.machine.reset();
    this.machine.bootSlot(slot);
  };

  // Which drive Boot means: the one whose disk was booted last while it still
  // holds one, else whichever drive has a disk in it. The 840K controller is
  // the fallback when both are empty, because entering its ROM is what the
  // monitor's own start does.
  App.prototype.bootDrive = function () {
    var kinds = [this.lastBoot, 'nib140', 'aim840'], i, slot, card;
    for (i = 0; i < kinds.length; i++) {
      if (!kinds[i]) continue;
      slot = this.slotFor(kinds[i]);
      card = this.machine.cards[slot];
      if (card && card.hasDisk && card.mediaAt(0)) return slot;
    }
    return this.slotFor('aim840');
  };

  // Disks are inserted and .fil files poked straight into memory. Neither
  // boots: what starts is one decision, made once the whole gesture — or the
  // whole container — is in. See finishOpen.
  //
  // `from` is the container entry this came out of, when it came out of one:
  // the bytes as they were packed and the patches applied to them, so a
  // container that is loaded and saved again writes back what it carried
  // rather than the patched image it ran.
  //
  // `over` is what beats a container about the machine — the page hands it what
  // the address said. It reaches the container branch and nowhere else, and
  // never travels with `from`: a container inside a container is refused.
  //
  // A promise, because a container's payload may be gzipped: everything a
  // caller does after a load — the status line, the address, the keyboard —
  // waits on it, and every failure arrives as a rejection rather than as a
  // throw out of a function that had already returned.
  App.prototype.load = function (bytes, name, from, over) {
    var self = this;
    return Promise.resolve().then(function () {
      return self.loadOne(bytes, name, from, over);
    });
  };

  // The load itself. `load` is the wrapper that turns everything this can throw
  // into a rejection; `applyAgc` calls this one directly because it is already
  // inside the chain that catches them.
  App.prototype.loadOne = function (bytes, name, from, over) {
    var s = AGAT.sniff(bytes, name), self = this;
    if (!s.kind) {
      throw new Error(name + ': not a recognized Agat image (' + bytes.length + ' bytes)');
    }
    if (s.kind === 'agc') {
      if (from) throw new Error(name + ': a container inside a container');
      return AGAT.agc.parse(bytes, name).then(function (c) {
        // `looks` said this was one and the JSON says otherwise: some other
        // file that mentions `agc` in its first few lines.
        if (!c) {
          throw new Error(name + ': not a recognized Agat image (' +
                          bytes.length + ' bytes)');
        }
        return self.applyAgc(c, over);
      });
    }
    // A file dropped on its own belongs to no container, and the last one's
    // title and remap are about a different program: a game's movement keys
    // silently applying to the next disk would be worse than no remap at all.
    // What was open before goes the same way, and for the same reason — see
    // startOpen. Here rather than a line earlier: an unreadable file has said
    // so above and left the machine as it was.
    if (!from) {
      this.takeFresh();
      this.title = this.author = this.date = this.url = '';
      this.notes = this.info = this.hint = this.fromAgc = this.agcBoot = '';
      this.agcState = null;
      // The take goes with them: it is a session with *that* program, and its
      // snapshot would put the old RAM back over the new disk.
      this.recording = null;
      AGAT.keyboard.setRemap(null);
      AGAT.keyboard.setControls(null);
    }
    if (s.kind === 'fil') {
      if (!AGAT.loadFil) throw new Error('.fil loading is not built in yet');
      AGAT.loadFil(this.machine, s.payload);
      this.remember(name, bytes, from, s, null);
      this.onStatus('loaded ' + (s.filName || name) + ' at $' +
                    s.loadAddr.toString(16).toUpperCase());
      return this.loaded({ kind: 'fil' });
    }
    var entry = this.remember(name, bytes, from, s, AGAT.mount(s));
    // Where the container said it goes, if it said; the first drive that can
    // read it otherwise. A `none` leaves it on the shelf: the session carries
    // it and no drive holds it.
    var spot = from ? this.mountSpot(from.mount) : undefined;
    var slot = spot === null ? -1
             : spot && this.mount(entry, spot.slot, spot.drv) ? spot.slot
             : this.place(entry);
    // Every disk arrives locked unless the container says otherwise, which is
    // the container speaking for the program: see Media.
    if (from && from.writable) entry.media.locked = false;
    if (slot < 0) {
      this.onStatus(name + ' — no free drive, kept for saving');
      return this.loaded({ kind: s.kind, slot: -1 });
    }
    this.pending.disks.push(slot);
    this.onStatus(name + ' in ' + this.driveLabel(slot, this.mountedAt(entry).drv));
    return this.loaded({ kind: s.kind, slot: slot });
  };

  // What a drive is called on the page and on the status line: the controller
  // alone while it has one drive, since `D1` means nothing until there is a D2
  // to tell it from.
  App.prototype.driveLabel = function (slot, drv) {
    var list = this.driveList(), i, out = 'slot ' + slot;
    for (i = 0; i < list.length; i++) {
      if (list[i].slot !== slot || list[i].drv !== (drv || 0)) continue;
      out = list[i].label + (list[i].drives > 1 ? ' D' + (list[i].drv + 1) : '');
    }
    return out;
  };

  // A container's `in`, as a drive of the machine that got built. See
  // Machine.spotFor: `undefined`, `null` and `{slot, drv}` are all answers.
  App.prototype.mountSpot = function (spec) {
    return this.machine.spotFor(spec);
  };

  // One medium is in. Inside a gesture the boot waits for the rest of it; a
  // load that is not part of one — a tool, a test, the address — is the whole
  // of what was opened and decides here.
  App.prototype.loaded = function (r) {
    if (this.opening) this.start();
    else this.finishOpen();
    return r;
  };

  // One more disk the session holds — the file as it arrived, and the media a
  // drive will read. Appended, because the order is the order a container
  // lists them in and saving keeps it. What keeps the list from growing over a
  // session is the gesture's clear — see startOpen.
  App.prototype.remember = function (name, bytes, from, s, media) {
    var entry = {
      id: this.nextDiskId++,
      name: name,
      bytes: from ? from.bytes : bytes,
      patches: from ? from.patches : [],
      kind: s.kind,
      offset: s.offset || 0,
      prodos: !!s.prodos,
      media: media || null,
    };
    this.disks.push(entry);
    return entry;
  };

  // ---- containers ----------------------------------------------------------

  // The two card layers as one override map for the model being built, kept in
  // `slotOverrides` because that is what the machine and the .agc writer speak.
  // Worked out on every build rather than stored, since a change of model moves
  // the cards: a mouse at slot 4 on an Agat-9 is a mouse at slot 6 on an Agat-7.
  App.prototype.cardSlots = function () {
    var M = AGAT.Machine;
    this.slotOverrides = M.slotsFor(this.model,
                                    M.mergeCards(this.agcCards, this.overCards),
                                    this.agcModel || this.model);
    return this.slotOverrides;
  };

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
      if (theirs && theirs.card === mine.card &&
          (theirs.ram || 0) === (mine.ram || 0) &&
          (theirs.drives || 1) === (mine.drives || 1)) {
        continue;
      }
      out[n] = { card: mine.card };
      if (mine.ram) out[n].ram = mine.ram >> 10;
      // A second drive is the container's to ask for and nothing on the page
      // fits one, so this is the only way it survives a save.
      if (mine.drives > 1) out[n].drives = mine.drives;
      any = true;
    }
    return any ? out : null;
  };

  // A container names a machine, so applying one is a rebuild: the model, the
  // RAM size and the cards go in together and build() applies them all at once,
  // rather than the machine being taken apart three times.
  //
  // `over` is whatever overrules the container — {model, ramSize, cards}, in
  // this object's own units, each key honored only if it is there. It belongs
  // here, before the build, rather than in a second one afterwards: build()
  // resets the CPU and boots nothing, so a rebuild once the media has loaded
  // leaves the machine in the monitor with the disk still in the drive.
  //
  // The cards overrule class by class rather than wholesale: an address that
  // resizes the ЭмПЗУ is not an address saying anything about the mouse.
  App.prototype.applyAgc = function (c, over) {
    over = over || {};
    // A container describes a whole machine, so the drives start empty: a disk
    // left in another drive is not part of what it says, and build() would
    // otherwise carry it across into the machine the container asked for.
    // Which is the gesture's clear as well, so it is spent here rather than
    // left armed for a file opened alongside the container to fire it at the
    // container's own media.
    this.freshOpen = false;
    this.ejectAll();
    // What the container asks for, kept as it asked for it and beside the
    // machine that gets built: the page writes an address that says only where
    // the two differ, so it needs the container's own answer to every question
    // the address can ask. Zero for the two it did not answer.
    this.agcModel = c.machine.model;
    this.agcRam = c.machine.ram * 1024 || 0;
    // Slot sizes and slot numbers, kilobytes in the file and bytes in here.
    // Read at the model the container named, because that is the machine its
    // slot numbers are about.
    this.agcCards = c.machine.slots
      ? AGAT.Machine.cardsOf(this.agcModel || this.model,
                             AGAT.agc.scaleSlots(c.machine.slots))
      : null;
    var model = over.model || this.agcModel;
    if (model) this.model = model;
    this.ramSize = this.model === 9 ? 0x20000
                 : (over.ramSize || this.agcRam
                    || AGAT.Machine.PROFILES[this.model].ram);
    this.agcMonitor = c.machine.monitor || '';
    this.agcBoot = c.machine.boot || '';
    this.agcState = c.state || null;
    this.recording = null;             // a take belongs to the program it is of
    this.monitor = over.monitor || this.agcMonitor || AGAT.MONITOR_DEFAULT;
    this.overCards = 'cards' in over ? over.cards : null;
    this.build();

    var keys = AGAT.keyboard.setRemap(c.keys);
    var ctl = AGAT.keyboard.setControls(c.controls);
    this.disks = [];                   // the container is the whole set
    this.title = c.title;
    this.author = c.author;
    this.date = c.date;
    this.url = c.url;
    this.notes = c.notes;
    this.info = c.info;
    this.hint = c.hint;
    this.fromAgc = c.name;
    // In order, and one at a time: the media are loaded into a machine that
    // each of them changes — a drive is taken, a model is settled — and the
    // status line below is about all of them together. Nothing boots as it
    // goes in; the container is a whole machine and says for itself what
    // starts, which is decided below once every medium is in.
    var self = this, chain = Promise.resolve();
    var outer = this.pending, opening = this.opening;
    this.pending = newPending();
    this.pending.boot = this.agcBoot;
    this.opening = true;
    c.media.forEach(function (m) {
      chain = chain.then(function () {
        return self.loadOne(m.payload, m.name, m);
      });
    });
    return chain.then(function () {
      var p = self.pending;
      self.pending = outer;                // back to the gesture that held it
      self.opening = opening;
      outer.decided = true;                // the container has said what boots
      self.decideBoot(p);
      // Last, over the top of the boot the media just did: a container that
      // carries a machine resumes it rather than starting the program again.
      // The disks have to be in first — the drives' heads are part of what is
      // being put back, and there has to be a drive to put them in.
      return self.restoreState(c.state);
    }).then(function (note) {
      return self.agcLoaded(c, keys, ctl, note);
    });
  };

  // The container's machine, if it brought one. A state that does not fit the
  // machine that got built — the address named the other model, a card was
  // resized — is refused rather than forced, and the container boots as it
  // would have without one; the reason goes on the status line, because a
  // program silently starting from the beginning is exactly the kind of thing
  // nobody would think to ask about.
  App.prototype.restoreState = function (state) {
    if (!state || !AGAT.state) return Promise.resolve('');
    return AGAT.state.restore(this, state).then(function (s) {
      return AGAT.state.describe(s);
    }, function (e) {
      return 'booted — ' + e.message;
    });
  };

  // The line a container's load leaves behind: what it is, and what it brought
  // with it that the page will be drawing.
  App.prototype.agcLoaded = function (c, keys, ctl, note) {
    this.onStatus(this.credit() +
                  (this.bootNote ? ' — ' + this.bootNote : '') +
                  (note ? ' — ' + note : '') +
                  (keys.ok ? ' — ' + keys.ok + ' key' + (keys.ok > 1 ? 's' : '') +
                             (keys.remapped ? ', ' + keys.remapped + ' remapped' : '')
                           : '') +
                  (ctl.rows ? ' — ' + ctl.rows + ' control' + (ctl.rows > 1 ? 's' : '') +
                              ' in ' + ctl.groups + ' group' + (ctl.groups > 1 ? 's' : '')
                            : '') +
                  (keys.bad.length || ctl.bad.length
                    ? ' — ignored ' + keys.bad.concat(ctl.bad).join(', ') : ''));
    return { kind: 'agc', title: c.title, media: c.media.length };
  };

  // The program, said the way a container names it: "RISE OUT — Andrew
  // Maltsev, 1989". The run loop's own status line has no room for this, so it
  // is worth saying once, on the load that brought it in.
  App.prototype.credit = function () {
    var who = [this.author, this.date].filter(Boolean).join(', ');
    return (this.title || this.fromAgc) + (who ? ' — ' + who : '');
  };

  // The same thing standing still, for the card under the controls: the six
  // fields the container wrote to be read, and nothing the emulator worked out.
  // `about` rather than `info`, because `info` is one of the six. The title
  // falls back to the file's name for credit()'s reason — a container that did
  // not name itself is still called something — and a bare image has none of
  // them, which is what leaves the card empty and hidden.
  App.prototype.about = function () {
    return {
      title: this.title || this.fromAgc,
      author: this.author,
      date: this.date,
      url: this.url,
      info: this.info,
      hint: this.hint,
    };
  };

  // A stamp for a filename: local time, because it is read by whoever is
  // sitting in front of the machine, and in the order that sorts.
  function stamp(d) {
    function pad(n, w) {
      var s = String(n);
      while (s.length < w) s = '0' + s;
      return s;
    }
    return pad(d.getFullYear(), 4) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) +
           '-' + pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2);
  }

  // One we wrote ourselves, to be taken off before the next goes on: without
  // this a container saved three times is called `game-…-…-….agc`.
  var STAMPED = /-\d{8}-\d{6}$/;

  // A name with its extension off. Android's downloads append `.json` to a
  // container — it is JSON, and the phone believes the type over the name — so
  // `game-20260827-000000.agc.json` comes back, and the stamp is only the last
  // thing in the name once that is gone. Both extensions come off together.
  function base(name) {
    return name.replace(/\.json$/i, '').replace(/\.[^.\/]*$/, '');
  }

  // What a saved container should be called: the one it came from with a fresh
  // timestamp, or the loaded image with its extension swapped. A title good
  // enough to publish is a decision for whoever renames the file afterwards.
  //
  // The stamp is what keeps a re-save from being an overwrite. A container is
  // loaded to be changed — another disk, a card, a snapshot taken further in —
  // and saving it back under the name it arrived as leaves two files the
  // browser tells apart by a `(1)` and nobody else can tell apart at all. The
  // bare image keeps its plain name because that save is a first one: there is
  // no earlier container of that name to sit beside.
  App.prototype.agcName = function (now) {
    if (this.fromAgc) {
      return base(this.fromAgc).replace(STAMPED, '') +
             '-' + stamp(now || new Date()) + '.agc';
    }
    return this.disks.length ? base(this.disks[0].name) + '.agc' : '';
  };

  // One disk as it should be saved: the file it arrived as, plus what has been
  // written to it since, plus where it is — the drive it sits in and whether a
  // program may write to it.
  //
  // A written track is decoded back to the sectors it was built from — 16 on
  // the 140K, 21 on the 840K — and the difference comes out as patches, so a
  // container still carries the image as it was found and what changed stays
  // legible. The entry is left alone, and the whole plain part of the
  // patch list is recomputed against the finished image rather than added to —
  // see `agc.repatch`, which is what keeps a change and its undo from both
  // ending up in the file. A stream image (.nib, .aim) is its own baseline and
  // the patches are simply what moved.
  //
  // A track that will not decode — a disk formatted some other way, a write
  // caught half done — has no sector image to be the difference from. Then the
  // stream itself is what is saved, as .nib for the 140K and .aim for the 840K,
  // which is a bigger and duller file but not a lossy one.
  App.prototype.writeBack = function (src) {
    var out0 = { name: src.name, bytes: src.bytes, patches: src.patches };
    var gcr = AGAT.gcr140, aim = AGAT.aim840;
    var media = src.media;
    if (!media || !media.isWritten()) return out0;

    var base = AGAT.agc.applyPatches(src.bytes, src.patches);
    var out = new Uint8Array(base), ok = true, t, got, sec;
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
    } else if (src.kind === 'aim840') {
      out.set(aim.toAim(media), src.offset);
    } else if (src.kind === 'dsk840' || src.kind === 'nib840') {
      for (t = 0; t < media.tracks && ok; t++) {
        if (!media.written[t]) continue;
        got = aim.desectorizeTrack(media.bytes, media.attrs, media.trackBase(t),
                                   media.trackLen[t] || media.stride, t);
        if (got.got !== aim.SECTORS) { ok = false; break; }
        if (src.kind === 'dsk840') {
          out.set(got.bytes, src.offset + t * aim.SECTORS * aim.SECSIZE);
        } else {
          for (sec = 0; sec < aim.SECTORS; sec++) {
            aim.nibRecord(t, sec, got.bytes.subarray(sec * aim.SECSIZE,
                                                     (sec + 1) * aim.SECSIZE),
                          out, src.offset + (t * aim.SECTORS + sec) * aim.NIB_RECORD);
          }
        }
      }
    } else {
      ok = false;
    }
    if (!ok) {
      var raw = media.kind === 'aim840';
      return {
        name: src.name.replace(/\.[^.\/]*$/, '') + (raw ? '.aim' : '.nib'),
        bytes: raw ? aim.toAim(media) : new Uint8Array(media.bytes),
        patches: [],
      };
    }
    return {
      name: src.name,
      bytes: src.bytes,
      patches: AGAT.agc.repatch(src.bytes, src.patches, out),
    };
  };

  // A disk as a container's `media` entry: what writeBack makes of it, and
  // then where it is. The lock is the medium's own and travels with it, so it
  // is written here rather than with the machine; `in` is written only where
  // the drives would not be filled the way they stand, which is what keeps a
  // container of one disk saying nothing about drives at all.
  App.prototype.saveMedium = function (entry, specs) {
    var out = this.writeBack(entry);
    if (entry.media && !entry.media.locked) out.writable = true;
    if (entry.media && specs[entry.id]) out.mount = specs[entry.id];
    return out;
  };

  // Which disks have to be told where to go, id -> `in`, and the rest is the
  // order doing it by itself. Worked out by playing the load back: the drives
  // are filled from the list, and wherever that puts a disk somewhere it is
  // not, that disk is given an `in` and the whole thing is played again. It
  // settles, because each pass pins one more disk down — and a container of one
  // disk, or of two in the order their drives take them, comes out saying
  // nothing about drives at all.
  App.prototype.mountSpecs = function () {
    var specs = {}, actual = {}, i, pass, entry, sim, bad;
    var same = function (a, b) {
      return !a === !b && (!a || (a.slot === b.slot && a.drv === b.drv));
    };
    for (i = 0; i < this.disks.length; i++) {
      if (this.disks[i].media) {
        actual[this.disks[i].id] = this.mountedAt(this.disks[i]);
      }
    }
    for (pass = 0; pass <= this.disks.length; pass++) {
      sim = this.mountMap(specs);
      bad = null;
      for (i = 0; i < this.disks.length && !bad; i++) {
        entry = this.disks[i];
        if (entry.media && !same(sim[entry.id], actual[entry.id])) bad = entry;
      }
      if (!bad) break;
      specs[bad.id] = actual[bad.id]
        ? this.slots[actual[bad.id].slot].card + (actual[bad.id].drv ? ':2' : '')
        : 'none';
    }
    return specs;
  };

  // Where the drives end up when a container carrying these disks, with these
  // `in` values on them, is opened: id -> {slot, drv} or null. The same rules
  // loadOne follows, including a disk that says `in` taking a drive from one
  // that did not.
  App.prototype.mountMap = function (specs) {
    var out = {}, held = {}, i, entry, spot, slot, card, d, key;
    for (i = 0; i < this.disks.length; i++) {
      entry = this.disks[i];
      if (!entry.media) continue;
      out[entry.id] = null;
      spot = specs[entry.id] === 'none' ? null
           : specs[entry.id] ? this.mountSpot(specs[entry.id])
           : undefined;
      if (spot === null) continue;
      if (spot === undefined) {
        slot = this.slotFor(entry.media.kind);
        card = this.machine.cards[slot];
        if (!card || !card.insert) continue;
        for (d = 0; d < (card.drives || 1); d++) {
          if (held[slot + ':' + d] === undefined) { spot = { slot: slot, drv: d }; break; }
        }
        if (!spot) continue;                     // every drive of that size full
      }
      key = spot.slot + ':' + spot.drv;
      if (held[key] !== undefined) out[held[key]] = null;   // turned out of it
      held[key] = entry.id;
      out[entry.id] = spot;
    }
    return out;
  };

  // The machine as it stands, as a container: what is in the drives, the model
  // and RAM it is running as, the live remap and the controls it came in with.
  // A promise: what a payload is written as is decided by trying it, and the
  // platform's gzip is a stream.
  //
  // `opts.state` adds the machine itself — the RAM, the CPU, the drive heads.
  // Off unless asked for, because a container is a program to hand to somebody
  // and one person's session in the middle of it is a different document.
  App.prototype.toAgc = function (opts) {
    var media = [], i, self = this, specs = this.mountSpecs();
    // In the order the list holds them, which is the order a container was
    // read in and the order the drives are filled in on the way back.
    for (i = 0; i < this.disks.length; i++) {
      media.push(this.saveMedium(this.disks[i], specs));
    }
    var state = opts && opts.state && AGAT.state
              ? AGAT.state.save(this) : Promise.resolve(null);
    return state.then(function (st) {
      return self.agcSpec(media, st);
    });
  };

  // The spec AGAT.agc.build is handed, split out so there is one list of what a
  // container is made of whether or not a state is going into it.
  App.prototype.agcSpec = function (media, state) {
    return AGAT.agc.build({
      state: state,
      title: this.title || (media.length ? media[0].name : ''),
      author: this.author,
      date: this.date,
      url: this.url,
      notes: this.notes,
      model: this.model,
      ram: this.ramSize >> 10,
      monitor: this.monitor,
      boot: this.agcBoot,
      slots: this.slotDiff(),
      keys: AGAT.keyboard.remap(),
      controls: AGAT.keyboard.controls(),
      info: this.info,
      hint: this.hint,
      media: media,
    });
  };

  App.prototype.readFile = function (file) {
    var self = this;
    return self.fileBytes(file).then(function (bytes) {
      return self.load(bytes, file.name);
    });
  };

  // The file's bytes and nothing more, for whoever is going to decide what to
  // do with them — `openInto` puts one disk in one drive rather than replacing
  // the session, and so cannot go through `load`.
  App.prototype.fileBytes = function (file) {
    return file.arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  };

  // ---- recording -------------------------------------------------------------
  //
  // One take at a time, and never a take and a replay at once. See record.js
  // for what is in one and why the disk ends it.

  App.prototype.startRecording = function (opts) {
    var self = this;
    this.stopPlaying();
    this.stopRecording('user');
    // Held while the snapshot is taken: state.save() encodes the RAM a turn
    // later, so a machine that steps in between is saved from two cycles at
    // once — and stamped with neither.
    var was = this.running;
    this.stop();
    var rec = new AGAT.Recorder(this, opts);
    return rec.start().then(function () {
      self.recorder = rec;
      if (was) self.start();
      return rec;
    });
  };

  // The take, or null where there was none. Kept as `recording`: a container
  // carries one, and this is it.
  App.prototype.stopRecording = function (why) {
    if (!this.recorder) return null;
    this.recording = this.recorder.stop(why || 'user');
    this.recorder = null;
    return this.recording;
  };

  // Play one back. The machine is restored to where the take began and the run
  // loop feeds the inputs in; the doors are shut meanwhile, so nothing a person
  // does reaches the machine until it is over. Rejects the way a container's
  // state does — a recording of one machine does not play on another.
  App.prototype.startPlaying = function (rec) {
    var self = this;
    this.stopRecording('machine');
    rec = rec || this.recording;
    if (!rec || !rec.state) {
      return Promise.reject(new Error('nothing recorded'));
    }
    this.stop();
    var p = new AGAT.Player(this, rec);
    return p.start().then(function (s) {
      self.player = p;
      self.paused = false;
      self.start();
      return s;
    });
  };

  // The machine goes on running live from wherever the replay had got to,
  // which is what taking over will be when there is a control for it.
  App.prototype.stopPlaying = function () {
    var p = this.player;
    this.player = null;
    return p;
  };

  // Anything that changes the machine without being an input ends both. A take
  // that cannot be played back is worse than a short one, and a replay whose
  // machine has been reset underneath it is not a replay.
  App.prototype.machineChanged = function () {
    this.stopRecording('machine');
    this.stopPlaying();
  };

  // ---- run loop ------------------------------------------------------------

  App.prototype.start = function () {
    if (this.running || this.paused) return;
    this.running = true;
    // Zeroed rather than set to now, so the first frame back takes its usual
    // 20 ms instead of the whole length of the pause: the machine goes on from
    // where it stopped rather than running the pause off in catch-up.
    this.lastTime = 0;
    requestAnimationFrame(this.frame);
  };

  App.prototype.stop = function () { this.running = false; };

  // The machine out to a cycle, stopping on the way at anything a replay has to
  // put in. The frame loop turns elapsed time into a target; this turns a
  // target into instructions, and it is the seam a speed control and a rewind
  // will both want — neither of them changes what a cycle is.
  App.prototype.runTo = function (target) {
    var cpu = this.machine.cpu, p, stop;
    while (cpu.cycles < target && !cpu.halted) {
      p = this.player;
      stop = p ? Math.min(target, p.nextCycle()) : target;
      while (cpu.cycles < stop && !cpu.halted) cpu.step();
      if (!p) break;
      p.apply(cpu.cycles);
      if (p.done()) { this.stopPlaying(); break; }
    }
    if (this.recorder && this.recorder.wrote()) this.stopRecording('write');
  };

  // The machine held still. Nothing is saved and nothing is put back — the
  // frame loop simply stops being scheduled, so cpu.cycles stops advancing and
  // every timestamp hung off it stays where it was.
  App.prototype.setPaused = function (on) {
    this.paused = !!on;
    if (this.paused) this.stop();
    else this.start();
  };

  App.prototype.reset = function () {
    this.paused = false;               // Reset and Boot mean "run this"
    this.machineChanged();
    this.machine.reset();
    this.start();
  };

  App.prototype.boot = function (slot) {
    this.paused = false;
    this.machineChanged();
    this.bootFrom(slot === undefined ? this.bootDrive() : slot);
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
    this.runTo(target);
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

  // What is running, in one line: the machine and the video mode. Only what
  // nothing else on the page states — the keyboard layout is on its own button,
  // which can also change it; the drives are on their lamps, down to which image
  // each holds and where its head is; and what the program is called is on the
  // info card, which the run loop does not overwrite. The line is short by
  // design: it is read at a glance beside a picture, and a line that grows a
  // word moves everything under it on a phone.
  //
  // The bits of that line rather than the line itself: a bit is a string, or
  // `{text, cls, title}` where it has a color and a sentence of its own. The
  // page paints them with a `·` between, and the sentence goes where a sentence
  // on a line this narrow has to go — the tooltip. Nothing else calls this.
  App.prototype.describe = function () {
    var m = this.machine;
    if (!m) return [];
    var bits = [];
    // A held machine is not on this line: the Pause button is showing ▶ with a
    // lit border, which is where the eye already is, and a word that comes and
    // goes is a line whose length comes and goes with it.
    bits.push('Agat-' + m.model);
    if (m.model === 7) bits.push((this.ramSize >> 10) + 'K');
    bits.push(m.appleVideo
      ? 'apple ' + (m.text ? 'text' : (m.hires ? 'hires' : 'lores'))
      : (AGAT.MODE_NAMES[m.videoMode().vtype] || 'mode ?'));
    var mouse = this.mouseCard();
    if (mouse) {
      // How long since the program last read the card. It is the one thing that
      // tells "busy, or waiting for a button" apart from "this program does not
      // speak to this mouse", and nothing else says so: MouseGraf 4.4 wants the
      // Ниппель and will not look at a parallel mouse, 1.6 is the other way
      // round, and both sit there looking perfectly alive either way.
      //
      // Measured in emulated seconds and generously, because a program that is
      // loading is a program not reading its mouse, and MouseGraf spends ten
      // seconds pulling the editor off the disk.
      if (mouse.polls !== this.mousePolls) {
        this.mousePolls = mouse.polls;
        this.mouseSeen = m.cpu.cycles;
      }
      // The card's own name and nothing else: which mouse it is answers what a
      // word like "mouse" in front of it would have said. Both states are a
      // color on that name and a sentence in the tooltip — the line has one row
      // to fit in, and these are the two things about a mouse worth noticing
      // from across the desk rather than reading. Quiet takes the color where
      // both hold: a pointer that is held and unread is the case that wants the
      // other mouse, not the other key.
      var quiet = m.cpu.cycles - this.mouseSeen > MOUSE_QUIET;
      var fed = this.mouseCaptured || this.mouseTrackpad || this.mouseTouch;
      bits.push({
        text: mouse.name,
        cls: quiet ? 'quiet' : (fed ? 'held' : ''),
        title: (this.mouseCaptured
                  ? 'Mouse, holding the pointer — Esc gives it back'
                  : fed
                  ? 'Mouse, trackpad-style — strokes over the screen steer it'
                  : 'Mouse — click the screen to hand the pointer over') +
               (quiet ? '\nThis program is not reading the card. If it wants a mouse ' +
                        'at all, it wants another one.' : ''),
      });
    }
    return bits;
  };

  AGAT.MODE_NAMES = {
    0: '64x64x4', 1: '128x128x4', 2: 'text 32', 3: '256x256x1',
    4: 'text 64', 5: '256x256x2', 6: '512x256x1', 10: 'text 64 inv',
  };

  AGAT.App = App;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
