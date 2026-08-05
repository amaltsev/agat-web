// The 140K "Shugart" controller — an Apple Disk II clone. Slot 6 on the
// Agat-9, slot 3 on the Agat-7. Ported from agat-emulator fdd/fdd1.c.
//
//   $C0E0-$C0E7  stepper phases: phase = reg>>1, on = reg&1
//   $C0E8/$C0E9  motor off / on
//   $C0EA/$C0EB  select drive 1 / 2
//   $C0EC        read the data latch
//   $C0ED        write latch (writes are not implemented)
//   $C0EE        leave write mode; reading gives write-protect in bit 7
//   $C0EF        enter write mode
//
// The one subtlety worth stating plainly: each track byte is handed out exactly
// once. A second read of $C0EC before the disk has turned far enough returns a
// value with bit 7 CLEAR, and every boot loop in existence is an
// `LDA $C08C,X / BPL` spinning on precisely that. Return a ready byte too eagerly
// and nothing boots, with no diagnostic to show for it.
(function (AGAT) {
  'use strict';

  var CYCLES_PER_BYTE = 32;
  // A byte handed to the CPU within the last 50 ms keeps the lamp bright: long
  // enough to bridge the gaps between sectors, short enough that the end of a
  // load is visible at once.
  var LAMP_BUSY = AGAT.CPU_HZ / 20;
  var MAX_TRACK = 34;              // 35 tracks, 0..34
  var MAX_PHASE = 110;

  function Head() {
    this.phase = 20;               // half-tracks; fdd1.c starts here
    this.track = 10;
    this.index = 0;
    this.rotated = 0;
  }

  function Disk140(opts) {
    opts = opts || {};
    this.rom = opts.rom || null;
    this.media = null;
    this.heads = [new Head(), new Head()];
    this.drv = 0;
    this.motor = 0;
    this.writeMode = false;
    this.time = 0;
    this.last = 0xff;
    this.lastByteAt = -Infinity;   // cpu cycle the CPU last took a media byte
    this.seed = 0x2545f491;        // deterministic, so headless runs reproduce
  }

  Disk140.prototype.insert = function (media) {
    this.media = media;
    this.heads[this.drv].index = 0;
    this.heads[this.drv].rotated = 0;
  };

  Disk140.prototype.eject = function () { this.media = null; };

  // The soft switches are cleared: motor off, drive 1, read mode. The stepper
  // magnets are all off too, which leaves the head wherever it stood.
  Disk140.prototype.reset = function () {
    this.motor = 0;
    this.drv = 0;
    this.writeMode = false;
  };

  Disk140.prototype.hasDisk = function () { return !!this.media; };

  Object.defineProperty(Disk140.prototype, 'track', {
    get: function () { return this.heads[this.drv].track; },
  });
  Object.defineProperty(Disk140.prototype, 'pos', {
    get: function () { return this.heads[this.drv].index; },
  });

  // xorshift32 — the C uses rand(); we want the same shape without the
  // irreproducibility.
  Disk140.prototype.rand = function () {
    var x = this.seed;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this.seed = x;
    return x & 0xff;
  };

  // Turn the disk forward to `now`, one byte per rotation tick.
  Disk140.prototype.spin = function (now) {
    var h = this.heads[this.drv];
    if (!this.time || this.time > now) this.time = now;
    var dt = now - this.time;
    if (dt > CYCLES_PER_BYTE * 20000) dt = CYCLES_PER_BYTE * 20000;
    this.time = now - dt;
    var len = this.media ? this.media.stride : 6656;
    while (this.time <= now - CYCLES_PER_BYTE) {
      h.index = h.index + 1 >= len ? 0 : h.index + 1;
      h.rotated = 1;
      this.time += CYCLES_PER_BYTE;
    }
  };

  // fdd1.c fdd_select_phase: step towards whichever magnet is energised.
  Disk140.prototype.phase = function (p, on) {
    if (!on) return;
    var h = this.heads[this.drv];
    if (((h.phase + 1) & 3) === p && h.phase < MAX_PHASE) h.phase++;
    else if (((h.phase - 1) & 3) === p && h.phase > 0) h.phase--;
    var t = h.phase >> 1;
    if (t > MAX_TRACK) t = MAX_TRACK;
    if (t !== h.track) { h.track = t; h.rotated = 0; }
  };

  Disk140.prototype.access = function (reg, now) {
    this.spin(now);
    if (reg < 8) { this.phase(reg >> 1, reg & 1); return; }
    switch (reg) {
      case 0x8: this.motor = 0; break;
      case 0x9: this.motor = 1; break;
      case 0xa: case 0xb: this.drv = reg - 0xa; break;
      case 0xe: this.writeMode = false; break;
      case 0xf: this.writeMode = true; break;
      default: break;
    }
  };

  Disk140.prototype.readData = function (now) {
    var h = this.heads[this.drv];
    if (!this.media) return this.last = this.rand() | 0x80;
    if (!this.motor) {
      // With the motor off the head still floats over the media: fdd1.c returns
      // a value that intermittently refreshes with bit 7 set. A fixed byte here
      // lets a "wait for the drive to spin up" loop stall forever.
      if (!(this.rand() & 1)) this.last = (this.rand() & 0x7f) | 0x80;
      return this.last;
    }
    if (!h.rotated) return this.rand() & 0x7f;      // not ready: bit 7 clear
    h.rotated = 0;
    this.lastByteAt = now;
    return this.last = this.media.bytes[this.media.trackBase(h.track) + h.index];
  };

  Disk140.prototype.read = function (reg, now) {
    this.access(reg, now);
    switch (reg) {
      case 0xc: return this.readData(now);
      case 0xe: return this.media && this.media.writeProtect ? 0xff : 0x7f;
      case 0xa: case 0xb: return this.rand();
      default: return 0;
    }
  };

  Disk140.prototype.write = function (reg, val, now) {
    this.access(reg, now);
    // Writing is not implemented; the write-protect bit above tells software so.
  };

  // The drive lamp: 0 dark, 1 spinning, 2 transferring. The LED is on the motor
  // line, and the boot loop polls $C0EC about four times for every byte the
  // disk has actually turned far enough to give, so only a delivered byte —
  // never a poll — counts as a transfer.
  Disk140.prototype.lamp = function (now) {
    if (!this.media || !this.motor) return 0;
    return now - this.lastByteAt < LAMP_BUSY ? 2 : 1;
  };

  Disk140.CYCLES_PER_BYTE = CYCLES_PER_BYTE;
  Disk140.LAMP_BUSY = LAMP_BUSY;
  AGAT.Disk140 = Disk140;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
