// Sound. There is one bit of audio hardware: every access to $C030 flips the
// speaker cone. The machine records the CPU cycle of each flip; this turns that
// list into samples by walking the flips in order and holding the level between
// them, then queues one buffer per emulated frame.
//
// The held level goes through a DC blocker before it leaves, and that is not a
// nicety — it is the difference between hearing the machine and hearing a
// buzz. A cone cannot hold a displacement: driven to one side and left there it
// springs back to centre. Without that, a sound effect made of a handful of
// flips (RISE OUT's PLAY routine emits nine over four milliseconds) leaves the
// output pinned at full scale indefinitely, and every later buffer boundary
// turns into a click. What should be a 4 ms tick becomes a second of noise.
//
//   y[n] = x[n] - x[n-1] + R*y[n-1]
//
// R = 0.995 at 44.1 kHz puts the corner near 35 Hz: square waves pass, steps
// decay away over a few milliseconds, exactly as the cone does.
(function (AGAT) {
  'use strict';

  var CPU_HZ = AGAT.CPU_HZ || 1020484;

  // How far ahead of the audio clock we try to stay queued. Too little and any
  // hiccup leaves a gap; too much and the sound lags the picture.
  var TARGET_LEAD = 0.08;
  var MIN_LEAD = 0.02;
  var MAX_LEAD = 0.30;

  // DC blocker pole. Corner is about 35 Hz at 44.1 kHz.
  var R = 0.995;

  function Speaker(opts) {
    opts = opts || {};
    this.ctx = null;
    this.gain = null;
    this.level = 0;
    this.dcX = 0;                 // DC blocker history
    this.dcY = 0;
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
    var x0 = this.dcX, y0 = this.dcY;
    for (var i = 0; i < n; i++) {
      var cyc = fromCycle + (i + 1) * span / n;
      while (ei < edges.length && edges[ei] < cyc) { lvl = -lvl; ei++; }
      var x = lvl * 0.5;
      y0 = x - x0 + R * y0;
      x0 = x;
      out[i] = y0;
    }
    while (ei < edges.length) { lvl = -lvl; ei++; }
    this.level = lvl;
    this.dcX = x0;
    this.dcY = y0;

    var src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    var now = this.ctx.currentTime;

    // Buffers are queued back to back. The queue only stays honest if the
    // emulator produces emulated-seconds at the rate real seconds pass, which
    // is why the run loop is driven by the wall clock rather than by
    // requestAnimationFrame — at 60 Hz a 50 Hz frame budget runs 20% fast, and
    // on a 120 Hz display twice that, which is heard as pitch and tempo.
    var lead = this.nextStart - now;
    if (lead < MIN_LEAD) this.nextStart = now + TARGET_LEAD;   // queue ran dry
    else if (lead > MAX_LEAD) this.nextStart = now + TARGET_LEAD;  // ran away
    src.start(this.nextStart);
    this.nextStart += n / rate;
    this.lead = this.nextStart - now;
  };

  Speaker.CPU_HZ = CPU_HZ;
  AGAT.Speaker = Speaker;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
