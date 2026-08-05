// Sound. There is one bit of audio hardware: every access to $C030 flips the
// speaker cone. The machine records the CPU cycle of each flip; this turns that
// list into samples by walking the flips in order and holding the level between
// them, then queues one buffer per emulated frame.
(function (AGAT) {
  'use strict';

  var CPU_HZ = 1020484;      // the Agat's 6502 clock, near enough to the Apple's

  function Speaker(opts) {
    opts = opts || {};
    this.ctx = null;
    this.gain = null;
    this.level = 0;
    this.nextStart = 0;
    this.volume = opts.volume === undefined ? 0.25 : opts.volume;
    this.enabled = false;
  }

  Speaker.prototype.start = function () {
    if (this.ctx) return;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.ctx.destination);
    this.enabled = true;
  };

  Speaker.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  Speaker.prototype.setVolume = function (v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  };

  // `edges` are CPU cycle counts of speaker flips within [fromCycle, toCycle).
  Speaker.prototype.play = function (edges, fromCycle, toCycle) {
    if (!this.enabled || !this.ctx) { this.level = edges.length & 1 ? -this.level : this.level; return; }
    var rate = this.ctx.sampleRate;
    var span = toCycle - fromCycle;
    var n = Math.max(1, Math.round(span * rate / CPU_HZ));
    var buf = this.ctx.createBuffer(1, n, rate);
    var out = buf.getChannelData(0);
    var lvl = this.level || 1;
    var ei = 0;
    for (var i = 0; i < n; i++) {
      var cyc = fromCycle + (i + 1) * span / n;
      while (ei < edges.length && edges[ei] < cyc) { lvl = -lvl; ei++; }
      out[i] = lvl;
    }
    while (ei < edges.length) { lvl = -lvl; ei++; }
    this.level = lvl;

    var src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    var now = this.ctx.currentTime;
    // Keep a small lead so buffers butt up against each other without gaps,
    // but resynchronise if we ever fall behind.
    if (this.nextStart < now + 0.005) this.nextStart = now + 0.05;
    src.start(this.nextStart);
    this.nextStart += n / rate;
  };

  Speaker.CPU_HZ = CPU_HZ;
  AGAT.Speaker = Speaker;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
