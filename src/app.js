// Browser glue: hold a machine, run a frame's worth of CPU per animation
// frame, draw the screen, feed the speaker, and route dropped files to
// whichever drive can read them.
(function (AGAT) {
  'use strict';

  var CYCLES_PER_FRAME = Math.round(AGAT.Speaker.CPU_HZ / 50);   // the Agat is 50 Hz

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
    this.machine.reset();
    this.resize();
    this.start();
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
    m.speakerEdges.length = 0;
    var from = cpu.cycles;
    var target = from + CYCLES_PER_FRAME;
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
