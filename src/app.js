// Browser glue: pick a disk, boot it, run one frame's worth of CPU per
// animation frame, draw the screen, feed the speaker.
(function (AGAT) {
  'use strict';

  var CYCLES_PER_FRAME = Math.round(AGAT.Speaker.CPU_HZ / 60);

  function App(opts) {
    this.canvas = opts.canvas;
    this.ctx2d = this.canvas.getContext('2d', { alpha: false });
    this.status = opts.status;
    this.roms = null;
    this.machine = null;
    this.video = null;
    this.speaker = new AGAT.Speaker();
    this.image = null;
    this.running = false;
    this.turbo = 1;
    this.diskName = null;
    this.model = opts.model || 9;
    this.frame = this.frame.bind(this);
  }

  App.prototype.say = function (msg) {
    if (this.status) this.status.textContent = msg;
  };

  App.prototype.init = function () {
    var self = this;
    return AGAT.loadRoms(window.AGAT_ROMS).then(function (roms) {
      self.roms = roms;
      self.video = new AGAT.Video(roms.font7, roms.palette);
      self.canvas.width = self.video.width;
      self.canvas.height = self.video.height;
      self.image = self.ctx2d.createImageData(self.video.width, self.video.height);
      AGAT.attachKeyboard(window, {
        keyDown: function (c) { if (self.machine) self.machine.keyDown(c); },
      }, { onKey: function () { self.speaker.start(); self.speaker.resume(); } });
    });
  };

  // Disk blobs are separate scripts so the page only pays for what is played.
  App.prototype.loadDisk = function (name) {
    var self = this;
    this.say('loading ' + name + '…');
    return new Promise(function (resolve, reject) {
      if (window.AGAT_DISKS && window.AGAT_DISKS[name]) return resolve();
      var s = document.createElement('script');
      s.src = 'assets/disk-' + name + '.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('cannot load assets/disk-' + name + '.js')); };
      document.head.appendChild(s);
    }).then(function () {
      return AGAT.unpackDisk(window.AGAT_DISKS[name]);
    }).then(function (disk) {
      self.diskName = name;
      self.machine = new AGAT.Machine({
        model: self.model,
        sysmon: self.model === 7 ? self.roms.sysmon7 : self.roms.sysmon9,
        fdcRom: self.roms.fd800,
        disk: disk,
      });
      self.machine.bootSlot(AGAT.Machine.SLOTS[self.model].fdd840);
      self.lastCycle = self.machine.cpu.cycles;
      self.running = true;
      self.say(name + ' — booting');
      requestAnimationFrame(self.frame);
    });
  };

  App.prototype.reboot = function () {
    if (this.diskName) this.loadDisk(this.diskName);
  };

  App.prototype.frame = function () {
    if (!this.running) return;
    var m = this.machine;
    var cpu = m.cpu;
    m.speakerEdges.length = 0;
    var from = cpu.cycles;
    var target = from + CYCLES_PER_FRAME * this.turbo;
    while (cpu.cycles < target && !cpu.halted) cpu.step();
    this.speaker.play(m.speakerEdges, from, cpu.cycles);

    this.video.render(m);
    this.image.data.set(this.video.pixels);
    this.ctx2d.putImageData(this.image, 0, 0);

    if (cpu.halted) {
      this.running = false;
      this.say(this.diskName + ' — stopped (illegal opcode at $' +
               cpu.jamPC.toString(16).toUpperCase() + ')');
      return;
    }
    requestAnimationFrame(this.frame);
  };

  App.prototype.modeName = function () {
    var m = this.machine;
    if (!m) return '';
    if (m.text) return 'text';
    return (m.hires ? 'hires' : 'lores') + (m.mixed ? ' + text' : '');
  };

  AGAT.App = App;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
