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
    this.model = 9;
    this.ramSize = 0x20000;
    this.modelPinned = false;
    this.drives = {};                     // slot -> {name, kind}
    this.lastTime = 0;
    this.subFrameHz = opts.subFrameHz || 0;    // 0 = the machine's default
    this.soundLog = null;
    this.onStatus = opts.onStatus || function () {};
    this.frame = this.frame.bind(this);
  }

  App.prototype.init = function () {
    var self = this;
    return AGAT.loadRoms(window.AGAT_ROMS).then(function (roms) {
      self.roms = roms;
      self.build();
      AGAT.attachKeyboard(window, self, {
        onKey: function () { self.speaker.start(); self.speaker.resume(); },
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
        if (c && c.media) keep.push(c.media);
      }
    }
    var slots = AGAT.Machine.SLOTS[this.model];
    this.machine = new AGAT.Machine({
      model: this.model,
      ramSize: this.ramSize,
      sysmon: this.model === 7 ? this.roms.monitor7 : this.roms.monitor9,
    });
    if (slots.psrom && AGAT.Psrom7) this.machine.addCard(slots.psrom, new AGAT.Psrom7());
    this.machine.addCard(slots.fdd840, new AGAT.Disk840({ rom: this.roms.teac }));
    if (AGAT.Disk140) {
      this.machine.addCard(slots.fdd140, new AGAT.Disk140({
        rom: this.model === 7 ? this.roms.shugart7 : this.roms.shugart9,
      }));
    }
    this.video = new AGAT.Video(
      this.model === 7 ? this.roms.font7 : this.roms.font9,
      this.roms.palette,
      { m0: this.model === 7 ? 0x80 : 0x40 });
    this.drives = {};
    for (var i = 0; i < keep.length; i++) this.insert(keep[i]);
    if (this.subFrameHz) this.machine.setSubFrameHz(this.subFrameHz);
    this.machine.reset();
    this.resize();
    this.start();
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
    this.soundLog = {
      edges: [],
      zp: {},                                  // PLAY500's state, values seen
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
          ints: +(g0 / this.machine.subPeriod).toFixed(2),
          ms: +((e[i - 1] - e[run]) / AGAT.CPU_HZ * 1000).toFixed(1),
          flips: i - run,
        });
        run = i;
        if (i < e.length) i++;
      }
    }
    var zp = {};
    for (var k in L.zp) zp[App.PLAY500_ZP[k]] = Object.keys(L.zp[k]).map(Number);
    return {
      interruptHz: Math.round(AGAT.CPU_HZ / this.machine.subPeriod),
      play500: zp,
      totalFlips: e.length,
      spanMs: +((e[e.length - 1] - e[0]) / AGAT.CPU_HZ * 1000).toFixed(1),
      notes: out.slice(0, 40),
    };
  };

  App.prototype.toggleLayout = function () {
    return this.machine.toggleLayout();
  };

  App.prototype.setModel = function (model, ramSize) {
    this.model = model === 7 ? 7 : 9;
    this.ramSize = this.model === 9 ? 0x20000 : (ramSize || this.ramSize);
    this.build();
  };

  // ---- media ---------------------------------------------------------------

  App.prototype.slotFor = function (kind) {
    var slots = AGAT.Machine.SLOTS[this.model];
    return kind === 'nib140' ? slots.fdd140 : slots.fdd840;
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
  App.prototype.load = function (bytes, name) {
    var s = AGAT.sniff(bytes, name);
    if (!s.kind) {
      throw new Error(name + ': not a recognised Agat image (' + bytes.length + ' bytes)');
    }
    // Honour the machine the filename implies, unless the user has chosen one.
    if (s.hintModel && s.hintModel !== this.model && !this.modelPinned) {
      this.setModel(s.hintModel);
    }
    if (s.kind === 'fil') {
      if (!AGAT.loadFil) throw new Error('.fil loading is not built in yet');
      AGAT.loadFil(this.machine, s.payload);
      this.start();
      this.onStatus('loaded ' + (s.filName || name) + ' at $' +
                    s.loadAddr.toString(16).toUpperCase());
      return { kind: 'fil' };
    }
    var slot = this.insert(AGAT.mount(s));
    this.machine.reset();
    this.machine.bootSlot(slot);
    this.start();
    this.onStatus('booting ' + name + ' from slot ' + slot);
    return { kind: s.kind, slot: slot };
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
      for (var za in App.PLAY500_ZP) {
        var zv = m.read(Number(za));
        (this.soundLog.zp[za] || (this.soundLog.zp[za] = {}))[zv] = 1;
      }
      if (cpu.cycles > this.soundLog.until) {
        this.onStatus('sound recorded: ' + this.soundLog.edges.length +
                      ' flips — call agat.soundReport()');
        this.soundLog.until = Infinity;
        this.soundLog.done = true;
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

  App.prototype.describe = function () {
    var m = this.machine;
    if (!m) return '';
    var bits = ['Agat-' + m.model];
    if (m.model === 7) bits.push((this.ramSize >> 10) + 'K');
    bits.push(m.cyrillic ? 'РУС' : 'ЛАТ');
    bits.push(m.appleVideo
      ? 'apple ' + (m.text ? 'text' : (m.hires ? 'hires' : 'lores'))
      : (AGAT.MODE_NAMES[m.videoMode().vtype] || 'mode ?'));
    for (var s in this.drives) {
      var card = m.cards[s];
      bits.push('S' + s + ' ' + this.drives[s].kind +
                (card && card.track !== undefined ? ' T' + card.track : ''));
    }
    return bits.join(' · ');
  };

  AGAT.MODE_NAMES = {
    0: '64x64x4', 1: '128x128x4', 2: 'text 32', 3: '256x256x1',
    4: 'text 64', 5: '256x256x2', 6: '512x256x1', 10: 'text 64 inv',
  };

  AGAT.App = App;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
