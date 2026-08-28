// Agat 840K floppy controller (контроллер НГМД 840К), the card whose boot ROM
// is agatF-fd800.bin at $C500.
//
// The card is two КР580ВВ55 (8255) parports wired to a drive; software sees 16
// registers at $C080 + slot*16. What the ROM at $C500 and the on-disk drivers
// actually use:
//
//   +2 r/w     8255 #1 port C, the drive lines themselves: bit2 step
//              direction, bit3 drive select, bit4 side, bit6 write mode,
//              bit7 motor. Readable, and drivers do read it back
//   +3 write   8255 #1 control: mode words, and PC bit set/reset ($0x)
//   +5 write   data byte to be written; the register is busy until the shift
//              register takes it, at the next byte boundary
//   +7 write   8255 #2 control: same as +3, plus the read/write handshake
//              enables in PC2/PC4, which change nothing here
//   +8 write   strobe — write a sync mark ("запись синхро") on the byte last
//              handed over
//   +9 write   strobe — step pulse / drive command latch
//   +A write   strobe — clear the "sync seen" latch
//   +1 read    drive status: bit7 busy, bit6 the track-0 sensor, bit5 the disk
//              is writable, bit4 index
//   +4 read    data byte from the head, clears "ready"
//   +6 read    bit7 = a byte is waiting (reading) or the write register is
//              free (writing), bit6 = no sync mark seen since the strobe
//
// The .aim image is exactly this byte stream: one byte per 16-bit word, low byte
// the data, high byte an attribute. That is why no GCR/MFM decoding appears
// anywhere — the card's separator already did it, and the image is taken from
// the separator's output. Attribute values, per the HxC thread on the format
// (hxc2001.com/floppy/forum/viewtopic.php?t=1385):
//
//   0x01, 0x80   desync mark          0x02   end of track
//   0x03         index mark start     0x13   index mark end
//
// The +A strobe does not seek to the next sync mark; it only clears a flip-flop.
// The head keeps streaming byte after byte either way, and bit6 goes low once a
// flagged byte has gone past. Read the ROM at $C55C against $C574 and it can
// only be that: the first strobe is followed by a wait on bit6 (find the
// address mark), the second by a wait on bit7 alone (just take the next byte).
// A model that re-searched on every strobe would skip from $95 to the next mark
// and never match the $6A behind it.
//
// Writing is the same stream the other way. A byte stored at +5 waits in the
// 8255 until the byte boundary, when the shift register takes it and it
// occupies the slot the head is entering — so a byte written just after an
// address field's $5A lands behind the $5A, not on it. The +8 strobe marks the
// byte handed over most recently: a driver writes $A4, then $FF, and strobes
// before waiting for the register (agatcomp.ru, fl840k_write.shtml — the
// sequencer stitches the sync gap onto the byte in flight, and on read the $FF
// is lost, the decoder locking on it and delivering the $95 behind it). That is
// the byte the boot ROM discards after waiting for bit 6 ($C565), and the byte
// agat-emulator's fdd.c marks with 0x0100 (rotate_sector). A byte the head
// passes in write mode without a mark loses any old mark, as in fdd.c: a
// rewritten sector carries only the marks its writer put there. The clock keeps
// turning in write mode — the factory formatter waits for the index with write
// mode already set — and a driver that falls behind leaves the old byte in the
// slot it missed.
//
// Media: MFM, 300 rpm, 250 kbit/s — one byte every 32 µs, which at the Agat's
// 1.02 MHz is 32.66 cycles. 80 cylinders x 2 sides x 21 sectors x 256 bytes =
// 860,160 bytes, and the two sides interleave: logical track = cylinder*2 + side.
(function (AGAT) {
  'use strict';

  var TRACKS = 160;
  var TRACK_WORDS = 6464;

  var A_DESYNC = 0x81;      // 0x01 and 0x80 both mark a desync
  var A_MARK = 0x01;        // the one a write puts down, as fdd.c does
  var A_END = 0x02;
  var A_INDEX_START = 0x03;
  var A_INDEX_END = 0x13;

  // How much of a track without an index attribute reads as "index": 128
  // bytes, 4.2 ms of a 200 ms turn. agat-emulator's `no_mark` says 64; the
  // factory test says 128 — TESTKOM9's speed check (APTEST1, $7900) counts
  // 100 µs ticks while the index is high and wants 1980-2020 of them, which
  // is 200 ms of revolution less a 4 ms pulse, and a 2 ms pulse counts 2023.
  var INDEX_WIDTH = 0x80;

  // 250 kbit/s MFM is one byte every 32 µs; the Agat's 6502 runs at 1.02 MHz.
  var CYCLES_PER_BYTE = 1020484 / 31250;

  // A byte handed to the CPU within the last 50 ms keeps the lamp bright: long
  // enough to bridge the gaps between sectors, short enough that the end of a
  // load is visible at once.
  var LAMP_BUSY = AGAT.CPU_HZ / 20;

  // One drive's head. The cable carries two, and where each of them stands is
  // the drive's own business — a driver that switches drives and reads without
  // seeking finds the head where it left it.
  function Head() {
    this.cyl = 0;                       // head cylinder, 0..79
    this.pos = 0;                       // byte index within the track
    this.lastWritePos = 0;              // the slot the last written byte went to
  }

  function Disk840(opts) {
    opts = opts || {};
    this.rom = opts.rom || null;        // the card's $Cn00 boot ROM
    // A drive each. Machines were as good as always fitted with one, so
    // `drives` is 1 unless a container asks for two.
    this.drives = opts.drives === 2 ? 2 : 1;
    this.disks = [null, null];
    this.heads = [new Head(), new Head()];
    this.side = 0;                      // 0 or 1
    this.syncSeen = false;              // a desync mark has passed since the strobe
    this.atIndex = false;               // head is inside an index mark
    this.ready = false;
    this.data = 0;
    this.nextByteAt = 0;                // cpu cycle when the next byte arrives
    this.lastByteAt = -Infinity;        // cpu cycle the CPU last took a byte
    this.portC = 0;                     // 8255 #1 port C: the drive control lines
    this.latch = 0;                     // the byte +5 stored, waiting for the boundary
    this.latched = false;
    this.latchMark = false;             // a +8 strobe arrived while it waited
    this.trace = null;                  // set to a fn(reg, val, now) to log writes

    this.stepOutward = opts.stepOutward === undefined ? 1 : opts.stepOutward;
    if (opts.media) this.insert(opts.media);
  }

  // Which drive, defaulting to the first: everything that does not care about
  // the second says nothing and gets D1.
  function which(drv) { return drv === 1 ? 1 : 0; }

  Disk840.prototype.insert = function (media, drv) {
    var d = which(drv);
    this.disks[d] = media;
    this.heads[d].pos = 0;
    this.ready = false;
    this.syncSeen = false;
    this.latched = false;
  };

  // One drive, or both when none is named — which is what emptying the machine
  // wants.
  Disk840.prototype.eject = function (drv) {
    if (drv === undefined) this.disks[0] = this.disks[1] = null;
    else this.disks[which(drv)] = null;
  };

  Disk840.prototype.mediaAt = function (drv) { return this.disks[which(drv)]; };

  // Where one drive's head stands, for a lamp that draws both. The side is the
  // controller's — one head select line goes to both drives — so only the
  // cylinder is the drive's own.
  Disk840.prototype.trackAt = function (drv) {
    return this.heads[which(drv)].cyl * 2 + this.side;
  };

  // Reset clears the 8255s, so the drive lines — motor, side, direction, select
  // — all drop. The head does not move: nothing drives the stepper, and the boot
  // ROM's recalibrate is what finds cylinder 0 again.
  Disk840.prototype.reset = function () {
    this.portC = 0;
    this.side = 0;
    this.ready = false;
    this.syncSeen = false;
    this.latched = false;
  };

  // `cyl`, `pos` and `lastWritePos` are the selected drive's, read and written
  // as if they were the controller's — which is what every line inside the card
  // was written against, and what a driver switching drives means by them.
  function head(name) {
    Object.defineProperty(Disk840.prototype, name, {
      get: function () { return this.heads[this.drv][name]; },
      set: function (v) { this.heads[this.drv][name] = v; },
    });
  }

  head('cyl');
  head('pos');
  head('lastWritePos');

  // Which of the 160 stored tracks is under the head: cylinder 0 side 0 is
  // track 0, cylinder 0 side 1 is track 1, cylinder 1 side 0 is track 2, and so
  // on — which is what lets a 140K disk be read as sectors 0-16 of the evens.
  Object.defineProperty(Disk840.prototype, 'track', {
    get: function () { return this.cyl * 2 + this.side; },
  });

  Disk840.prototype.hasDisk = function () { return !!this.media; };

  // Which drive port C has selected. Consulted only on a controller fitted with
  // two: the line's sense is not established here — agat-emulator's fdd.c
  // ignores bit 3 altogether, and nothing in `examples/` exercises it — so a
  // machine with one drive reads the disk in it whatever the bit says, rather
  // than resting on a guess. Bit set is taken as the second drive.
  Object.defineProperty(Disk840.prototype, 'drv', {
    get: function () {
      return this.drives === 2 ? (this.portC >> PC_DRIVE) & 1 : 0;
    },
  });

  // The disk under the head, and the head itself: both belong to the selected
  // drive, so every read and write inside the card reaches one drive's disk
  // only by naming them.
  Object.defineProperty(Disk840.prototype, 'media', {
    get: function () { return this.disks[this.drv]; },
  });

  // The clock keeps turning in write mode on this controller, so a snapshot has
  // to carry the byte boundary's phase as well as the head: `nextByteAt` is a
  // float, a whole number of byte times ahead of the last one, and rounding it
  // would make the disk turn at the wrong speed. `side` and `writeMode` are not
  // here — both are bits of `portC` and come back with it.
  //
  // Both heads, because where each drive left its own is the drive's. The
  // selected drive's three are written flat as well, which is what a snapshot
  // taken before there were two carries and all a one-drive machine needs.
  Disk840.prototype.saveState = function () {
    var out = { cyl: this.cyl, pos: this.pos, syncSeen: this.syncSeen,
                atIndex: this.atIndex, ready: this.ready, data: this.data,
                nextByteAt: this.nextByteAt, lastByteAt: this.lastByteAt,
                portC: this.portC, latch: this.latch, latched: this.latched,
                latchMark: this.latchMark, lastWritePos: this.lastWritePos,
                heads: [] };
    for (var i = 0; i < this.heads.length; i++) {
      out.heads.push({ cyl: this.heads[i].cyl, pos: this.heads[i].pos,
                       lastWritePos: this.heads[i].lastWritePos });
    }
    return out;
  };

  Disk840.prototype.loadState = function (s) {
    this.syncSeen = !!s.syncSeen;
    this.atIndex = !!s.atIndex;
    this.ready = !!s.ready;
    this.data = s.data;
    this.nextByteAt = s.nextByteAt;
    // JSON has no -Infinity; null is the constructor's "no byte yet".
    this.lastByteAt = s.lastByteAt === null || s.lastByteAt === undefined
                    ? -Infinity : s.lastByteAt;
    this.latch = s.latch;
    this.latched = !!s.latched;
    this.latchMark = !!s.latchMark;
    this.setPortC(s.portC);            // `side` follows it, as it does live
    // The heads last, because which of them `cyl` and `pos` mean is decided by
    // the port C that was just put back. A snapshot from before there were two
    // carries the flat three alone, and they are the selected drive's.
    var list = s.heads || [], i;
    for (i = 0; i < this.heads.length && i < list.length; i++) {
      this.heads[i].cyl = list[i].cyl;
      this.heads[i].pos = list[i].pos;
      this.heads[i].lastWritePos = list[i].lastWritePos;
    }
    if (!list.length) {
      this.cyl = s.cyl;
      this.pos = s.pos;
      this.lastWritePos = s.lastWritePos;
    }
  };

  var PC_DIR = 2;      // port C bit 2: step direction
  var PC_DRIVE = 3;    // port C bit 3: drive select
  var PC_SIDE = 4;     // port C bit 4: head/side select
  var PC_WRITE = 6;    // port C bit 6: write mode
  var PC_MOTOR = 7;    // port C bit 7: motor

  Object.defineProperty(Disk840.prototype, 'writeMode', {
    get: function () { return ((this.portC >> PC_WRITE) & 1) === 1; },
  });

  // One step pulse. Clamping at the end stops is what makes the boot ROM's
  // four-pulse recalibrate land on cylinder 0 no matter where it started.
  Disk840.prototype.step = function () {
    var out = ((this.portC >> PC_DIR) & 1) === this.stepOutward;
    this.cyl += out ? 1 : -1;
    if (this.cyl < 0) this.cyl = 0;
    if (this.cyl > 79) this.cyl = 79;
    this.ready = false;
  };

  // Port C itself, which is also readable at +2: drivers set the motor line and
  // read it straight back to see whether a controller is there at all.
  Disk840.prototype.setPortC = function (v) {
    this.portC = v & 0xff;
    this.side = (this.portC >> PC_SIDE) & 1;
  };

  // 8255 control port. Values with bit 7 clear are the chip's bit set/reset
  // command for port C: bits 3-1 pick the bit, bit 0 is the value. Values with
  // bit 7 set are mode words, which say nothing about the drive lines.
  Disk840.prototype.control = function (v) {
    if (v & 0x80) return;
    var bit = (v >> 1) & 7;
    this.setPortC(v & 1 ? this.portC | (1 << bit) : this.portC & ~(1 << bit));
  };

  // Spin the disk forward to `now`. Bytes the CPU was too slow to collect are
  // lost, exactly as they would be on the real drive. In write mode the byte
  // waiting in the register goes into the first slot the head enters, and
  // every slot passed loses its sync mark unless the strobe put one there.
  Disk840.prototype.tick = function (now) {
    var m = this.media;
    if (!m || now < this.nextByteAt) return;
    var track = this.track;
    if (track >= m.tracks) return;
    var len = m.trackLen[track] || m.stride;
    // Byte boundaries keep their phase: the next one is a whole number of
    // byte times after the last, however late the CPU came to look. Set from
    // `now` instead, the disk would turn at the polling rate — a loop that
    // looks every 50 cycles would see one byte per 50 cycles and a
    // revolution half again too long, which is what TESTKOM9's speed check
    // measures.
    var steps = 1 + Math.floor((now - this.nextByteAt) / CYCLES_PER_BYTE);
    this.nextByteAt += steps * CYCLES_PER_BYTE;
    if (steps > len) steps = len + steps % len;    // whole turns change nothing
    var base = m.trackBase(track);
    var marked = m.hasIndexMark(track);
    var writing = this.writeMode && !m.writeProtect;
    for (var i = 0; i < steps; i++) {
      this.pos = this.pos + 1 >= len ? 0 : this.pos + 1;
      var at = base + this.pos;
      if (writing) {
        m.attrs[at] &= ~A_DESYNC;
        if (this.latched) {
          m.bytes[at] = this.latch;
          if (this.latchMark) m.attrs[at] |= A_MARK;
          this.lastWritePos = this.pos;
          this.latched = false;
          m.markWritten(track);
        }
      }
      var a = m.attrs[at];
      if (a & A_DESYNC) this.syncSeen = true;
      else if (a === A_INDEX_START) this.atIndex = true;
      else if (a === A_INDEX_END) this.atIndex = false;
    }
    // A track with no index attribute still has to say where it begins, or
    // software that waits for the index before counting sectors off has nothing
    // to wait for and starts wherever the head happened to be. The first
    // INDEX_WIDTH bytes of such a track are the index, as in fdd.c's `no_mark`.
    if (!marked) this.atIndex = this.pos < INDEX_WIDTH;
    this.data = m.bytes[base + this.pos];
    this.ready = true;
  };

  Disk840.prototype.read = function (reg, now) {
    this.tick(now);
    switch (reg) {
      case 1:
        // Drive status: bit7 busy, bit6 the track-0 sensor, bit4 the index —
        // low while the index hole is under the sensor. The boot ROM steps four
        // times, spins until bit7 clears, then reverses if bit6 is still set,
        // so answering "ready, and bit6 clear once we are home" makes that
        // recalibrate terminate on cylinder 0.
        // Bit 5 is the write-protect sense, set while the disk can be
        // written: fdd.c's `x |= 0x20`, and what the factory formatter tests
        // with AND #$20 as soon as it has set write mode.
        return (this.cyl === 0 ? 0x00 : 0x40) | (this.atIndex ? 0x00 : 0x10) |
               (this.media && !this.media.writeProtect ? 0x20 : 0x00);
      case 2:
        return this.portC;
      case 4:
        this.ready = false;
        this.lastByteAt = now;
        return this.data;
      case 6:
        return (this.ready ? 0x80 : 0) | (this.syncSeen ? 0 : 0x40);
      default:
        return 0;
    }
  };

  Disk840.prototype.write = function (reg, val, now) {
    this.tick(now);
    if (this.trace) this.trace(reg, val, now);
    switch (reg) {
      case 0x02: this.setPortC(val); break;     // port C written whole
      case 0x03: this.control(val); break;      // 8255 #1 — the drive lines
      case 0x05: this.writeData(val, now); break;
      case 0x08: this.writeSync(); break;
      case 0x09: this.step(); break;            // step pulse
      case 0x0a: this.syncSeen = false; break;  // clear the sync latch
      default: break;                           // 8255 #2 mode words
    }
  };

  // A byte into the write register. It reaches the track at the next byte
  // boundary, in tick(); until then the register reads busy. A locked disk
  // takes nothing and says so in the status register.
  Disk840.prototype.writeData = function (val, now) {
    if (!this.media || !this.writeMode || this.media.writeProtect) return;
    if (!((this.portC >> PC_MOTOR) & 1)) return;
    this.latch = val & 0xff;
    this.latched = true;
    this.latchMark = false;
    this.ready = false;
    this.lastByteAt = now;
  };

  // The sync strobe. It marks the byte handed over most recently — the one
  // still waiting in the register if there is one, otherwise the one the shift
  // register took at the last boundary.
  Disk840.prototype.writeSync = function () {
    var m = this.media;
    if (!m || !this.writeMode || m.writeProtect) return;
    if (this.latched) { this.latchMark = true; return; }
    var track = this.track;
    if (track >= m.tracks) return;
    m.attrs[m.trackBase(track) + this.lastWritePos] |= A_MARK;
    m.markWritten(track);
  };

  // The drive lamp: 0 dark, 1 spinning, 2 transferring. The real drive's LED
  // hangs off the motor line, which the $C500 ROM raises before it does
  // anything else and never lowers; the bright state is what separates a drive
  // that is reading from one that is merely turning.
  // `drv` asks about one drive of the two: the motor line reaches the selected
  // drive alone, so the other is dark.
  Disk840.prototype.lamp = function (now, drv) {
    if (drv !== undefined && which(drv) !== this.drv) return 0;
    if (!this.media || !((this.portC >> PC_MOTOR) & 1)) return 0;
    return now - this.lastByteAt < LAMP_BUSY ? 2 : 1;
  };

  Disk840.TRACK_WORDS = TRACK_WORDS;
  Disk840.TRACKS = TRACKS;
  Disk840.CYCLES_PER_BYTE = CYCLES_PER_BYTE;
  Disk840.LAMP_BUSY = LAMP_BUSY;
  AGAT.Disk840 = Disk840;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
