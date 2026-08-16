// The Agat as the MS_* disks see it. Two machines, selected by `model`:
//
// Agat-7 — 64K of base RAM and the 2K monitor at $F800-$FFFF, plus the two
//   cards that make up the standard machine: a ЭмПЗУ in slot 2 behind
//   $D000-$FFFF and an ОЗУ expansion in slot 4 that can take $8000-$BFFF over
//   from base RAM, 32K each. The 64K and 128K fittings of base RAM bank
//   $8000-$BFFF (and, at 128K, $4000-$7FFF) through $C0F0-$C0FF; the 32K
//   fitting has no bank register on the board at all, and Mem7 is a no-op above
//   $7FFF. Machine.PROFILES has the whole complement.
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

  // The raster, as measured on real boards and traced through both schematics.
  // A frame is 312 lines of 672 clocks of the 10.5 MHz video crystal: 15625 Hz
  // line rate, 50.08 Hz frame, 256 lines displayed and 56 blanked. Used by the
  // `raster` interrupt model; see HARDWARE.md.
  var LINES = 312;
  var DISPLAYED = 256;

  // Is the sub-frame interrupt asserted on this line?
  // Agat-7: bit 4 of the counter, low for 16 lines out of 32. Because the count
  // runs 0..255 and then 0..55, the release that begins at line 304 is half
  // length — the one-of-ten short pulse the scope traces show.
  // Agat-9: the timing PROM's one line in eight, the last of each character row.
  function irqAtLine(model, line) {
    return model === 7 ? (line & 16) === 0 : (line & 7) === 7;
  }

  function Machine(opts) {
    opts = opts || {};
    this.rom = opts.sysmon || new Uint8Array(0x800);
    // $C000-$C7FF window. An empty slot's page is open bus and reads $FF
    // (agat-emulator fills io_sel with empty_read, apple2.c:22) — not $00,
    // which is a value the memory cards' state registers can legitimately hold
    // and so would make every empty slot look like an ОЗУ card to a program
    // scanning for one.
    this.slotRom = new Uint8Array(0x800);
    for (var i = 0; i < this.slotRom.length; i++) this.slotRom[i] = 0xff;

    // Agat-7 puts its 2K monitor at $F800-$FFFF and leaves $D000-$F7FF open;
    // Agat-9 maps the same 2K as 4K, mirrored, covering $F000-$FFFF. See the
    // header for why that mirror matters.
    this.model = opts.model === 7 ? 7 : 9;
    this.romBase = this.model === 9 ? 0xf000 : 0xf800;

    // Base RAM, which is not all the RAM: the Agat-7's cards bring their own and
    // this counts none of it. The Agat-9 is always 128K. The Agat-7 has 64K as
    // standard and takes 32K or 128K, and the amount is visible to software —
    // the video mode register's page field is masked by it.
    this.ramSize = this.model === 9 ? 0x20000
                 : (opts.ramSize || Machine.PROFILES[7].ram);
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
    this.xram = null;                      // Agat-7 ОЗУ expansion, if fitted

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
    // Video interrupts. Software arms both at $C04x and disarms them at $C05x
    // on the Agat-7 or $C02x on the Agat-9 — different addresses on the two
    // machines, and swapping them hangs software that otherwise runs.
    //
    // One 312-line counter drives both, as on the boards. The Agat-7 buffers
    // bit 4 of it onto the IRQ line, so the line is asserted for 16 lines and
    // released for 16 — 488 Hz, ten assertions a frame, with the last release
    // cut to 8 lines by the counter's reload. The Agat-9's timing PROM pulses
    // the line low for one line in every eight: 1953 Hz, 39 a frame. NMI is the
    // same counter's blanking edge, which the two machines buffer in opposite
    // senses.
    //
    // The sub-frame interrupt is a LEVEL, and that matters more than the rate
    // does: a 6502 whose IRQ line is still low re-enters the handler as soon as
    // RTI restores I, so a short handler runs many times per assertion —
    // roughly the assertion's length over its own.
    this.videoInts = false;
    var us = AGAT.CPU_HZ / 1000000;
    this.inVblank = false;
    // The free-running line counter and the level it produces, which the arming
    // latch gates but does not stop.
    this.linePeriod = 20000 * us / LINES;
    this.rasterLine = 0;
    this.nextLine = 0;
    this.irqRaw = false;
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

  // The two machines in their standard configuration: how much base RAM, and
  // what is in every slot. One table, so App and tools/harness build the same
  // machine instead of each keeping its own card list.
  //
  // The Agat-7 is 64K on the motherboard plus two 32K cards — a ЭмПЗУ in slot 2
  // behind $D000-$FFFF and an ОЗУ expansion in slot 4 that can take
  // $8000-$BFFF over from base RAM. That is 128K, in three separate devices
  // rather than one setting.
  //
  // 64K is the base RAM of the delivered machine: ФгЗ.032.002 ТО4 табл.1 gives
  // блок системный ФгЗ.038.650 as "ОЗУ — 64К байт", §2.1 gives 32K as the
  // minimum rather than the standard, and табл.8 enumerates screen pages ЭС 0-7,
  // of which ЭС 4-7 exist only on a board with the two switchable arrays. The
  // 32K default agat-emulator starts from (sysconf.c:303-306) is a choice in its
  // configuration dialog, not a fitting the manual describes; its card
  // complement (sysconf.c:72-77, 143-150) is what we follow here.
  //
  // `ram` is base RAM only, which is also all the video controller can ever
  // scan.
  Machine.PROFILES = {
    7: {
      ram: 0x10000,
      slots: {
        2: { card: 'psrom', ram: 0x8000 },
        3: { card: 'fdd140' },
        4: { card: 'xram', ram: 0x8000 },
        5: { card: 'fdd840' },
      },
    },
    9: {
      ram: 0x20000,
      slots: {
        5: { card: 'fdd840' },
        6: { card: 'fdd140' },
      },
    },
  };

  // Which slot holds which card, by name — what everything that wants "the 140K
  // drive" asks. Derived from the profiles so there is nothing to keep in step.
  Machine.SLOTS = (function () {
    var out = {}, model, slots, n;
    for (model in Machine.PROFILES) {
      out[model] = {};
      slots = Machine.PROFILES[model].slots;
      for (n in slots) out[model][slots[n].card] = Number(n);
    }
    return out;
  })();

  // A profile's slots with overrides merged over them. An override may name a
  // different card, a different size, or both; `null` empties the slot. Keys
  // are slot numbers, and sizes are bytes — the .agc that carries them speaks
  // kilobytes and converts on the way in.
  Machine.resolveSlots = function (model, overrides) {
    var base = Machine.PROFILES[model === 7 ? 7 : 9].slots, out = {}, n, o, was;
    for (n in base) {
      out[n] = { card: base[n].card };
      if (base[n].ram) out[n].ram = base[n].ram;
    }
    for (n in (overrides || {})) {
      o = overrides[n];
      was = out[n];
      if (!o) { delete out[n]; continue; }
      if (!o.card && !was) continue;                 // a size for an empty slot
      out[n] = { card: o.card || was.card };
      // A size survives a slot being re-sized but not re-carded: 32K of ЭмПЗУ
      // says nothing about the drive someone puts there instead.
      if (o.ram) out[n].ram = o.ram;
      else if (was && out[n].card === was.card && was.ram) out[n].ram = was.ram;
    }
    return out;
  };

  // Which slot holds the named card in a resolved map, or -1.
  Machine.slotOf = function (slots, card) {
    for (var n in slots) if (slots[n].card === card) return Number(n);
    return -1;
  };

  // Populate the slots from a resolved map. `roms` carries the two floppy ROMs;
  // the memory cards have none, their $Cn00 page being the register itself.
  Machine.prototype.fit = function (slots, roms) {
    roms = roms || {};
    for (var n in slots) {
      var spec = slots[n], card = null;
      switch (spec.card) {
        case 'psrom':
          if (AGAT.Psrom7) card = new AGAT.Psrom7({ size: spec.ram });
          break;
        case 'xram':
          if (AGAT.Xram7) card = new AGAT.Xram7({ size: spec.ram });
          break;
        case 'fdd840':
          if (AGAT.Disk840) card = new AGAT.Disk840({ rom: roms.teac });
          break;
        case 'fdd140':
          if (AGAT.Disk140) {
            card = new AGAT.Disk140({
              rom: this.model === 7 ? roms.shugart7 : roms.shugart9,
            });
          }
          break;
        default: break;
      }
      if (card) this.addCard(Number(n), card);
    }
    return this;
  };

  // Called before every instruction. One line counter, running whether or not
  // software has armed anything: on the boards the counter is always counting
  // and $C04x only enables the buffer that puts it on the bus, so $C019 answers
  // from the live raster and arming mid-frame picks the line counter up where
  // it is.
  Machine.prototype.pollInterrupts = function (now) {
    while (now >= this.nextLine) {
      this.nextLine += this.linePeriod;
      if (++this.rasterLine >= LINES) this.rasterLine = 0;
      var line = this.rasterLine;
      this.inVblank = line >= DISPLAYED;
      // The Agat-7 takes NMI where blanking starts and the Agat-9 where it
      // ends: one signal, buffered in opposite senses on the two machines.
      if (line === (this.model === 7 ? DISPLAYED : 0) && this.videoInts) this.cpu.nmi();
      var on = irqAtLine(this.model, line);
      if (on && !this.irqRaw && this.onSubInt) this.onSubInt();  // diagnostics
      this.irqRaw = on;
    }
    this.cpu.irqLine = this.videoInts && this.irqRaw;
  };

  // Lines between assertions of the sub-frame interrupt — what the status line
  // and the sound tools report a rate from.
  Machine.prototype.irqPeriod = function () {
    return this.linePeriod * (this.model === 7 ? 32 : 8);
  };

  // Every register the CPU can read has to be back at its power-on value before
  // cpu.reset() fetches the vector, and that includes the ones on cards. The
  // ЭмПЗУ matters most: read-enabled, it answers $D000-$FFFF from its own RAM,
  // so the monitor and all three vectors come from the card rather than the
  // ROM. Cards are reset in slot order, before the CPU.
  Machine.prototype.reset = function () {
    this.videoInts = false;
    this.inVblank = false;
    this.rasterLine = 0;
    this.nextLine = this.cpu ? this.cpu.cycles + this.linePeriod : 0;
    this.irqRaw = irqAtLine(this.model, 0);
    this.mode = this.prevMode = 0;
    this.appleVideo = false;
    this.text = true;
    this.mixed = false;
    this.page2 = false;
    this.hires = false;
    this.palette.reset();
    if (this.mem7) this.mem7.reset();
    else this.map = Uint8Array.from(STARTUP_MAP);
    this.psromMode = 1;
    this.psromOfs = 0;
    this.kbdLatch = 0;
    for (var s = 0; s < this.cards.length; s++) {
      var c = this.cards[s];
      if (c && c.reset) c.reset();
    }
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
    if (AGAT.Psrom7 && card instanceof AGAT.Psrom7) this.psrom = card;
    if (AGAT.Xram7 && card instanceof AGAT.Xram7) this.xram = card;
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
      // A selected ОЗУ expansion owns $8000-$BFFF outright, whatever base RAM
      // would have put there. Deselecting hands the address straight back —
      // agat-emulator does the same thing by broadcasting XRAM_RELEASE and
      // letting baseram reclaim the window (xram7.c:150-156, baseram.c:532-540).
      if (this.xram && a >= 0x8000 && this.xram.selected()) return this.xram.read(a);
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
      if (this.xram && a >= 0x8000 && this.xram.selected()) {
        this.xram.write(a, v);                       // dropped if write-protected
        return;
      }
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
    // Base RAM bank register, which is $C0F0-$C0FF and so sits inside the
    // $C080+16n slot range — the Agat-7 has six I/O slots, not seven, and the
    // board spends the seventh slot's page on this instead (ТО4 табл.9: X1-X7
    // get $C090-$C0EF, and $C0F0 is the ООП switch). It has to be decoded
    // before the slot range or the empty slot 7 swallows it.
    //
    // On a 32K board it is not fitted — agat-emulator installs it only above
    // $8000 of RAM (baseram.c:573) — and Mem7.setState is already a no-op at
    // that size, so the read answering $FF is what an undecoded address does
    // either way.
    if (lo >= 0xf0 && this.model === 7) {
      this.mem7.setState(lo & 0x0f);
      this.note(a, 0xff, false);
      return 0xff;
    }
    if (lo >= 0x80) {
      var slot = (lo >> 4) - 8;
      var reg = lo & 0x0f;
      var card = this.cards[slot];
      if (slot === 0) v = this.psromStatus();
      // The memory cards decode their $Cn00 page and nothing else — neither
      // xram7.c nor psrom7.c ever fills baseio_sel — so $C0Ax and $C0Cx are open
      // bus on an Agat-7, not a window into whichever card sits in that slot.
      else if (card && card.read && card.ioRegs !== false) {
        v = card.read(reg, this.cpu.cycles);
      }
      this.note(a, v, false);
      return v;
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
    if (lo >= 0xf0 && this.model === 7) { this.mem7.setState(lo & 0x0f); return; }
    if (lo >= 0x80) {
      var slot = (lo >> 4) - 8;
      var reg = lo & 0x0f;
      var card = this.cards[slot];
      if (slot === 0) this.langCard(reg, true);
      else if (card && card.write && card.ioRegs !== false) {
        card.write(reg, v, this.cpu.cycles);
      }
      return;
    }
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

  // $C04x arms both interrupts, $C05x (Agat-7) or $C02x (Agat-9) disarms them.
  // This only connects the counter to the CPU: the counter itself never stops,
  // so arming mid-frame picks it up wherever it has got to.
  Machine.prototype.setVideoInts = function (on) {
    if (!on) this.cpu.irqLine = false;      // disarming drops the line at once
    this.videoInts = on;
  };

  // $C050-$C05F. On the Agat-7 this whole page disables video interrupts and
  // touches nothing else. On the Agat-9 the low half is the Apple video
  // switches and the high half is the palette register.
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
