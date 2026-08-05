// The Agat as the MS_* disks see it. Two machines, selected by `model`:
//
// Agat-7 — flat 64K, the 2K monitor at $F800-$FFFF, an Apple-style language
//   card at $C080-$C08F behind $D000-$FFFF.
//
// Agat-9 — 128K in sixteen 8K banks. The 64K the CPU sees is eight windows,
//   each pointed at a bank by a mapping register; the register file lives at
//   $C100-$C1FF and is addressed rather than written: a store to $C1nv sets
//   window n to bank v (the value rides in the address). At reset the windows
//   are the identity map 0-7. $D000-$FFFF is switched by $C080-$C08F, and the
//   2K monitor is mapped as 4K, mirrored, covering $F000-$FFFF.
//
// All of that is from agatemulator's baseram.c/baserom.c (GPLv2), which is the
// emulator these disks are known to run under. It matters: the MS_10..MS_18
// loader jumps to $F056, which on the Agat-9 aliases to $F856 = `STA $C110,Y /
// RTS`. That is not a trampoline, it is the monitor's set-mapping helper — with
// Y=0 it points the $2000-$3FFF window at bank 0, so the loader's next reads at
// $2010/$2025/$2026 are really zero page $10/$25/$26.
//
// Anything unproven is logged rather than guessed at: `machine.trace` receives
// every $C0xx access with the PC that made it.
(function (AGAT) {
  'use strict';

  var BANK_SHIFT = 13;                 // 8K banks
  var BANK_SIZE = 1 << BANK_SHIFT;
  var STARTUP_MAP = [0, 1, 2, 3, 4, 5, 6, 7];

  function Machine(opts) {
    opts = opts || {};
    this.rom = opts.sysmon || new Uint8Array(0x800);
    this.slotRom = new Uint8Array(0x800);                // $C000-$C7FF window

    // Agat-7 puts its 2K monitor at $F800-$FFFF and leaves $D000-$F7FF open;
    // Agat-9 maps the same 2K as 4K, mirrored, covering $F000-$FFFF. See the
    // header for why that mirror matters.
    this.model = opts.model === 7 ? 7 : 9;
    this.romBase = this.model === 9 ? 0xf000 : 0xf800;

    // Agat-9 is always 128K. Agat-7 ships 32/64/128K and the amount is visible
    // to software: the video mode register's page field is masked by it.
    this.ramSize = this.model === 9 ? 0x20000
                 : (opts.ramSize || 0x20000);
    this.ram = new Uint8Array(this.ramSize);
    this.map = Uint8Array.from(STARTUP_MAP);          // Agat-9 8K windows
    this.mem7 = this.model === 7 ? new AGAT.Mem7(this.ramSize) : null;

    // $D000-$FFFF paging. The Agat-9 calls it ПЗУ mode and sets it directly
    // from the address; mode&3 picks RAM-read / RAM-write, mode&8 picks which
    // half of the window's bank backs $D000-$DFFF. Reset state is mode 1:
    // ROM readable, RAM writable, which is how these disks find it.
    this.psromMode = 1;
    this.psromOfs = 0;

    this.cards = [];                       // cards[slot], see addCard()
    this.psrom = null;                     // Agat-7 ЭмПЗУ, if fitted

    // Video. `mode` is the $C7xx register; `appleVideo` says whether the
    // Apple-compatible switches have taken over the display, which only ever
    // happens on the Agat-9 — the Agat-7 has no Apple modes and wires that
    // address range to interrupt control instead.
    this.mode = 0;
    this.prevMode = 0;
    this.appleVideo = false;
    this.palette = new AGAT.Palette();
    this.text = true;
    this.mixed = false;
    this.page2 = false;
    this.hires = false;
    // Video interrupts. The Agat raster runs at 50 Hz: the start of a frame
    // raises NMI, and a fixed number of sub-frame ticks per frame raise IRQ
    // (20 on the Agat-7, 40 on the Agat-9). Software arms them at $C04x and
    // disarms at $C05x on the Agat-7 or $C02x on the Agat-9 — note that those
    // are different addresses on the two machines, and swapping them hangs
    // software that otherwise runs.
    // Two independent timers, exactly as agat-emulator sets them up:
    // 1000000/50 us between frames, and that divided by 20 (Agat-7) or 40
    // (Agat-9) between sub-frame ticks. They are not one counter — every
    // sub-frame tick raises IRQ, *including* the one that coincides with a
    // frame, which also raises NMI. Folding them into one counter drops one
    // IRQ in twenty, and RISE OUT's PLAY500 sequences its music on the IRQ
    // count, so a missing tick is audible.
    // agat-emulator sets delay = 1000000/50 CPU cycles for the frame timer and
    // that / 20 (Agat-7) or / 40 (Agat-9) for the sub-frame, giving 50 Hz and
    // 1 kHz. Whether the hardware really ticked at 1 kHz is disputed — RISE
    // OUT's author remembers ~500 Hz — and since a game that sequences music on
    // the interrupt count hears the difference as an octave, it is adjustable.
    this.videoInts = false;
    var us = AGAT.CPU_HZ / 1000000;
    this.subDivisor = opts.subDivisor || (this.model === 7 ? 20 : 40);
    this.framePeriod = 20000 * us;
    this.subPeriod = (20000 / this.subDivisor) * us;
    this.nextFrame = 0;
    this.nextSub = 0;
    this.inVblank = false;
    this.speaker = 0;           // toggles; the audio layer samples the edges
    this.speakerEdges = [];
    this.kbdLatch = 0;

    // Game inputs. Buttons read their state in bit 7; the paddles are the
    // Apple-style one-shot, timed from the $C070 trigger.
    this.buttons = [0, 0, 0];
    this.paddles = [128, 128, 128, 128];
    this.paddleTrigger = -1e9;
    // Keyboard layout indicator: $FF Latin, $7F Cyrillic, masked $C0 on Agat-9.
    this.cyrillic = false;

    this.trace = null;
    this.ioSeen = Object.create(null);

    this.cpu = new AGAT.CPU(this);
    var self = this;
    this.cpu.reset = AGAT.CPU.prototype.reset;
    this.clock = function () { return self.cpu.cycles; };
  }

  // Where each machine puts its floppy controllers.
  Machine.SLOTS = {
    7: { fdd840: 5, fdd140: 3, psrom: 2 },
    9: { fdd840: 5, fdd140: 6 },
  };

  // Called before every instruction; cheap when interrupts are disarmed.
  Machine.prototype.pollInterrupts = function (now) {
    if (!this.videoInts) {
      this.nextSub = now + this.subPeriod;
      this.nextFrame = now + this.framePeriod;
      return;
    }
    while (now >= this.nextSub) {
      this.nextSub += this.subPeriod;
      this.cpu.irq();
      if (this.onSubInt) this.onSubInt();      // diagnostics hook
    }
    while (now >= this.nextFrame) {
      this.nextFrame += this.framePeriod;
      this.inVblank = true;
      this.cpu.nmi();
    }
  };

  Machine.prototype.reset = function () {
    this.videoInts = false;
    this.nextSub = this.cpu ? this.cpu.cycles + this.subPeriod : 0;
    this.nextFrame = this.cpu ? this.cpu.cycles + this.framePeriod : 0;
    this.mode = this.prevMode = 0;
    this.appleVideo = false;
    this.palette.reset();
    if (this.mem7) this.mem7.reset();
    else this.map = Uint8Array.from(STARTUP_MAP);
    this.psromMode = 1;
    this.psromOfs = 0;
    this.cpu.reset();
  };

  // $C700-$C7FF: the value is the low byte of the address, on reads as well as
  // writes. Reading returns $FF on the Agat-7 and the previous mode on Agat-9.
  Machine.prototype.videoSel = function (lo) {
    var prev = this.prevMode;
    this.prevMode = this.mode;
    this.mode = lo;
    this.appleVideo = false;
    return this.model === 7 ? 0xff : prev;
  };

  // The decoded mode, as the renderer wants it.
  Machine.prototype.videoMode = function () {
    return this.model === 7 ? AGAT.videoSel.sel7(this.mode, this.ramSize)
                            : AGAT.videoSel.sel9(this.mode);
  };

  // Enter a slot's card ROM directly — the emulator's equivalent of typing
  // PR#6. Some disks' loaders never get entered by the monitor's slot scan, and
  // it is what a "Boot" button should do.
  Machine.prototype.bootSlot = function (n) {
    this.cpu.s = 0xff;
    this.cpu.p = 0x24;
    this.cpu.pc = 0xc000 + n * 0x100;
  };

  // Install a card. `card` may expose rom (256 bytes at $Cn00), read(reg, now)
  // and write(reg, val, now) for its $C080+16n register file.
  Machine.prototype.addCard = function (n, card) {
    this.cards[n] = card;
    if (card && card.rom) this.slotRom.set(card.rom, n * 0x100);
    if (card instanceof AGAT.Psrom7) this.psrom = card;
    return card;
  };

  // ---- bus ---------------------------------------------------------------

  // CPU address -> physical RAM index. On the Agat-7 the map is the identity
  // and this is a no-op; on the Agat-9 each 8K window can point at any of the
  // sixteen banks.
  Machine.prototype.phys = function (a) {
    if (this.model === 7) return this.mem7.phys(a);
    return (this.map[a >> BANK_SHIFT] << BANK_SHIFT) | (a & (BANK_SIZE - 1));
  };

  // $D000-$DFFF is backed by one half of its window's bank, chosen by mode bit
  // 3; $E000-$FFFF by the window above it.
  Machine.prototype.psromAddr = function (a) {
    return a < 0xe000 ? this.phys((a + this.psromOfs - 0x1000) & 0xffff) : this.phys(a);
  };

  Machine.prototype.psromReadsRam = function () { return (this.psromMode & 3) !== 1; };
  Machine.prototype.psromWritesRam = function () {
    var m = this.psromMode & 3;
    return m === 1 || m === 3;
  };

  Machine.prototype.read = function (a) {
    if (a >= 0xc700 && a < 0xc800) return this.videoSel(a & 0xff);
    if (a < 0xc000) {
      var p = this.phys(a);
      return p < 0 ? 0xff : this.ram[p];             // Agat-7 open bus reads $FF
    }
    if (a < 0xc100) return this.ioRead(a);
    if (a < 0xc200 && this.model === 9) {
      // Mapping register file: reading back gives the window's current bank.
      return (a & 0xf0) | this.map[(a & 0xf0) >> 4];
    }
    if (a < 0xc800) {
      var pc = this.cards[(a >> 8) & 7];
      if (pc && pc.readReg) return pc.readReg(a);
      return this.slotRom[a - 0xc000];
    }
    if (a < 0xd000) return 0;
    if (this.model === 7) {
      // The ЭмПЗУ card, when it has reads enabled, covers the monitor too.
      if (this.psrom && this.psrom.readsRam()) return this.psrom.read(a);
      return a >= 0xf800 ? this.rom[a - 0xf800] : 0xff;
    }
    if (this.psromReadsRam()) return this.ram[this.psromAddr(a)];
    return a >= this.romBase ? this.rom[(a - this.romBase) & (this.rom.length - 1)] : 0;
  };

  Machine.prototype.write = function (a, v) {
    if (a >= 0xc700 && a < 0xc800) { this.videoSel(a & 0xff); return; }
    if (a < 0xc000) {
      var p = this.phys(a);
      if (p >= 0) this.ram[p] = v;
      return;
    }
    if (a < 0xc100) { this.ioWrite(a, v); return; }
    if (a < 0xc200 && this.model === 9) {
      // A store to $C1nv sets window n to bank v — the value is in the address,
      // the byte written is ignored.
      this.map[(a & 0xf0) >> 4] = a & 0x0f;
      return;
    }
    if (a < 0xc800) {
      var wc = this.cards[(a >> 8) & 7];
      if (wc && wc.writeReg) wc.writeReg(a);
      return;                                     // slot ROM is otherwise read-only
    }
    if (a < 0xd000) return;
    if (this.model === 7) {
      if (this.psrom) this.psrom.write(a, v);     // no base RAM up here
      return;
    }
    if (this.psromWritesRam()) this.ram[this.psromAddr(a)] = v;
  };

  // $C080-$C08F. The Agat-9 takes the whole mode from the low nibble of the
  // address, in one access and with no Apple-style "two reads to arm writing" —
  // but only a *write* switches. A read just reports the current mode, which is
  // why the monitor can poll it without paging itself out from under its feet.
  Machine.prototype.langCard = function (reg, isWrite) {
    if (!isWrite) return;
    this.psromMode = reg & 0x0f;
    this.psromOfs = (this.psromMode & 8) ? 0x1000 : 0;
  };

  Machine.prototype.psromStatus = function () {
    var res = this.psromMode | 0xf0;
    return (res & 3) ? res : (res | 2);
  };

  // ---- $C0xx -------------------------------------------------------------

  Machine.prototype.note = function (a, v, w) {
    var k = (w ? 'W' : 'R') + a.toString(16);
    this.ioSeen[k] = (this.ioSeen[k] || 0) + 1;
    if (this.trace) this.trace(w ? 'W' : 'R', a, v, this.cpu.pc);
  };

  Machine.prototype.ioRead = function (a) {
    var lo = a & 0xff;
    var v = 0;
    if (lo >= 0x80) {
      var slot = (lo >> 4) - 8;
      var reg = lo & 0x0f;
      var card = this.cards[slot];
      if (slot === 0) v = this.psromStatus();
      else if (card && card.read) v = card.read(reg, this.cpu.cycles);
      this.note(a, v, false);
      return v;
    }
    if (lo >= 0xf0 && this.model === 7) {                  // bank register
      this.mem7.setState(lo & 0x0f);
      this.note(a, 0xff, false);
      return 0xff;
    }
    if (lo === 0x19) { v = this.inVblank ? 0x80 : 0x00; this.note(a, v, false); return v; }
    switch (lo & 0xf0) {
      case 0x00: v = this.kbdLatch; break;                 // $C000 keyboard
      case 0x10: this.kbdLatch &= 0x7f; v = this.kbdLatch; break;
      case 0x20: if (this.model === 9) this.setVideoInts(false); v = 0; break;
      case 0x40: this.setVideoInts(true); v = 0; break;
      case 0x30: this.toggleSpeaker(); v = 0; break;
      case 0x50: this.videoSwitch(lo & 0x0f); v = 0; break;
      case 0x60: v = this.readAnalog(lo & 0x0f); break;
      case 0x70: this.paddleTrigger = this.cpu.cycles; v = 0; break;
      default: v = 0; break;
    }
    this.note(a, v, false);
    return v;
  };

  Machine.prototype.ioWrite = function (a, v) {
    var lo = a & 0xff;
    this.note(a, v, true);
    if (lo >= 0x80) {
      var slot = (lo >> 4) - 8;
      var reg = lo & 0x0f;
      var card = this.cards[slot];
      if (slot === 0) this.langCard(reg, true);
      else if (card && card.write) card.write(reg, v, this.cpu.cycles);
      return;
    }
    if (lo >= 0xf0 && this.model === 7) { this.mem7.setState(lo & 0x0f); return; }
    switch (lo & 0xf0) {
      case 0x10: this.kbdLatch &= 0x7f; break;
      case 0x20: if (this.model === 9) this.setVideoInts(false); break;
      case 0x40: this.setVideoInts(true); break;
      case 0x30: this.toggleSpeaker(); break;
      case 0x50: this.videoSwitch(lo & 0x0f); break;
      default: break;
    }
  };

  // $C060-$C067. $C060 is the cassette input, $C061/$C062 the two buttons,
  // $C064-$C067 the paddle one-shots.
  //
  // $C063 answers $80. It is read exactly once on the whole 840K disk — by the
  // boot loader, which does BIT $C063 and jumps into a stack-trashing decoy
  // unless N comes back set. That is the loader's tamper check, and on the real
  // machine the input it reads sits high.
  Machine.prototype.readAnalog = function (n) {
    switch (n) {
      case 0: return 0;
      case 1: case 2: return this.buttons[n - 1] ? 0x80 : 0;
      case 3: return (this.cyrillic ? 0x7f : 0xff) &
                     (this.model === 9 ? 0xc0 : 0xff);
      case 4: case 5: case 6: case 7: {
        var dt = this.cpu.cycles - this.paddleTrigger;
        return dt < this.paddles[n - 4] * 11 ? 0x80 : 0;
      }
      default: return 0;
    }
  };

  // $C050-$C05F. On the Agat-7 this whole page disables video interrupts and
  // touches nothing else. On the Agat-9 the low half is the Apple video
  // switches and the high half is the palette register.
  // Change the sub-frame interrupt rate. `hz` is the interrupt frequency.
  Machine.prototype.setSubFrameHz = function (hz) {
    this.subDivisor = Math.max(1, Math.round(hz / 50));
    this.subPeriod = (20000 / this.subDivisor) * (AGAT.CPU_HZ / 1000000);
    this.nextSub = this.cpu.cycles + this.subPeriod;
    return AGAT.CPU_HZ / this.subPeriod;
  };

  Machine.prototype.setVideoInts = function (on) {
    if (on && !this.videoInts) {
      this.nextSub = this.cpu.cycles + this.subPeriod;
      this.nextFrame = this.cpu.cycles + this.framePeriod;
    }
    this.videoInts = on;
  };

  Machine.prototype.videoSwitch = function (n) {
    if (this.model === 7) { this.setVideoInts(false); return; }
    if (n & 8) { this.palette.select(n & 7); return; }
    this.appleVideo = true;
    switch (n) {
      case 0x0: this.text = false; break;
      case 0x1: this.text = true; break;
      case 0x2: this.mixed = false; break;
      case 0x3: this.mixed = true; break;
      case 0x4: this.page2 = false; break;
      case 0x5: this.page2 = true; break;
      // Low-res was never implemented on the Agat, so $C056 selects hires too.
      case 0x6: this.hires = true; break;
      case 0x7: this.hires = true; break;
      default: break;
    }
  };

  Machine.prototype.toggleSpeaker = function () {
    this.speaker ^= 1;
    if (this.speakerEdges.length < 200000) this.speakerEdges.push(this.cpu.cycles);
  };

  // The keyboard table's bytes already carry bit 7 where it means something
  // (0x88 is the left arrow, not a stripped 0x08), so set it rather than
  // rebuild the value.
  Machine.prototype.keyDown = function (code) { this.kbdLatch = (code | 0x80) & 0xff; };

  // ЛАТ / РУС. Software reads which is active at $C063.
  Machine.prototype.toggleLayout = function () {
    this.cyrillic = !this.cyrillic;
    return this.cyrillic;
  };

  AGAT.Machine = Machine;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
