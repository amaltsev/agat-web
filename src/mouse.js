// The two Agat mice, and the pointer capture that feeds them.
//
// Neither card reports where the mouse *is*. Both report how far it has moved,
// and that is the whole shape of the problem: there is no register anywhere to
// write the host pointer's position into, so the guest keeps a cursor of its
// own and the only way to steer it is to hand it the same movements a ball on
// a desk would have made. Hence attachMouse() below, which captures the
// pointer rather than tracking it — agat-emulator does the same, and for the
// same reason (support.cpp:491-525, `lock_mouse`).
//
// Ported from agat-emulator's mouse/nippelmouse.c and mouse/mouse9.c. Which
// registers each one answers on was checked against MouseGraf's own probes:
// 4.4 at $84F4 (Ниппель) and $84AD (parallel), 1.6 at $8040.
(function (AGAT) {
  'use strict';

  // A count is one step of the ball — the quantum both cards deal in. Host
  // movement arrives in counts too, but fractional, because a host pixel is
  // rarely exactly one step; the whole part goes into the counter and the
  // fraction stays outside it in `fx`/`fy`. That separation is not tidiness:
  // MouseGraf zeroes the Ниппель counters through $C0nC after reading them,
  // and a fraction kept inside the counter would be thrown away every time it
  // did — which measures as roughly a third of the movement going missing.
  function accumulate(m, dx, dy) {
    var ix, iy;
    m.fx += dx;
    m.fy += dy;
    ix = m.fx | 0;                     // toward zero, so the sign of the
    iy = m.fy | 0;                     // remainder follows the movement
    m.fx -= ix;
    m.fy -= iy;
    m.step(ix, iy);
  }

  // ---- Ниппель --------------------------------------------------------------
  //
  // A card of its own, with no ROM at all: five registers in the slot's
  // $C080+16n page and nothing else. Each axis is a 7-bit up/down counter
  // clocked by the ball's quadrature pulses, read as two nibbles with a button
  // riding in bit 3 of the high one.
  //
  //   $C0n8  r  X counter, bits 0-3      w  preset both counters to $22
  //   $C0n9  r  X counter, bits 4-6; bit 3 = button B
  //   $C0nA  r  Y counter, bits 0-3
  //   $C0nB  r  Y counter, bits 4-6; bit 3 = button A
  //   $C0nC  r  as $C0n8                 w  clear both counters
  //
  // The preset is what a program identifies the card by: write $C0nC and both
  // counters must read zero, write $C0n8 and both must read back $22.
  // MouseGraf 4.4 does exactly that, sweeping slots 6 down to 1.
  function MouseNippel() {
    this.isMouse = true;
    this.polls = 0;                    // reads of any register; see App.describe
    this.x = 0;                        // the two counters, 7 bits each
    this.y = 0;
    this.fx = 0;                       // the sub-count remainder, host side
    this.fy = 0;
    this.btn = 0;                      // bit 0 button A, bit 1 button B
    this.rom = null;
    this.slot = -1;
  }

  MouseNippel.prototype.name = 'Ниппель';

  MouseNippel.prototype.reset = function () {
    this.x = this.y = 0;
    this.fx = this.fy = 0;
    this.btn = 0;
  };

  // Y counts *down* as the pointer goes down the screen — nippelmouse.c
  // subtracts dymouse (`regs[1] -= ...`) where it adds dxmouse.
  MouseNippel.prototype.step = function (ix, iy) {
    this.x = (this.x + ix) & 0x7f;
    this.y = (this.y - iy) & 0x7f;
  };

  MouseNippel.prototype.move = function (dx, dy) { accumulate(this, dx, dy); };

  MouseNippel.prototype.read = function (reg) {
    this.polls++;
    switch (reg) {
      case 0x8: case 0xc: return this.x & 0x0f;
      case 0x9: return ((this.x >> 4) & 0x07) | ((this.btn & 2) ? 0x08 : 0);
      case 0xa: return this.y & 0x0f;
      case 0xb: return ((this.y >> 4) & 0x07) | ((this.btn & 1) ? 0x08 : 0);
      default: return 0xff;            // undecoded, like an empty slot
    }
  };

  MouseNippel.prototype.write = function (reg) {
    if (reg === 0x8) { this.x = this.y = 0x22; }
    if (reg === 0xc) { this.x = this.y = 0; }
  };

  // ---- the two mice on the printer card -------------------------------------
  //
  // Neither is a card of its own: the mouse plugs into the Agat-9 printer
  // card's КР580ВВ55 (8255), which is why agat-emulator's mouse9.c is
  // printer9.c with the cable swapped. The four registers are the 8255's, and
  // both mice share them:
  //
  //   $C0n0  port A, output — the ММ-8031's axis select
  //   $C0n1  port B, output — the mouse's own control lines
  //   $C0n2  port C, input  — the reading
  //   $C0n3  control        — written $89: A out, B out, C in
  //
  // Port C's top two bits are the buttons on both, active low. What the rest of
  // it means is where they part company.
  //
  // Neither has a ROM here. The real card has one, and MouseGraf 4.4 will not
  // look at a parallel mouse whose $Cn00 page does not start $18 $90 — which
  // leaves 1.6, probing the ports directly, as the only program in reach: it
  // speaks «Марсианка», so nothing here drives the ММ-8031. See HARDWARE.md.
  function Parallel(name) {
    this.isMouse = true;
    this.name = name;
    this.polls = 0;                    // reads of any register; see App.describe
    this.fx = 0;
    this.fy = 0;
    this.btn = 0;                      // bit 0 button A, bit 1 button B
    this.portA = 0;
    this.portB = 0;
    this.rom = null;
    this.slot = -1;
  }

  Parallel.prototype.move = function (dx, dy) { accumulate(this, dx, dy); };

  // Buttons are active low and live in the top two bits, and they are the live
  // part of the reading: mouse9.c refreshes them on the read rather than at the
  // latch, so a press registers without the program asking for a new sample.
  Parallel.prototype.withButtons = function (v) {
    v = (this.btn & 1) ? (v & ~0x80) : (v | 0x80);
    return ((this.btn & 2) ? (v & ~0x40) : (v | 0x40)) & 0xff;
  };

  Parallel.prototype.read = function (reg, now) {
    this.polls++;
    switch (reg & 3) {
      case 0: return this.portA;       // an 8255 output port reads back its latch
      case 1: return this.portB;
      case 2: return this.sample(now || 0);
      default: return 0xff;            // the control register is write-only
    }
  };

  Parallel.prototype.write = function (reg, v) {
    switch (reg & 3) {
      case 0: this.portA = v & 0xff; this.latch(); break;
      case 1: this.portB = v & 0xff; break;
      default: break;                  // the mode word changes nothing we model
    }
  };

  Parallel.prototype.latch = function () {};

  // ---- «Марсианка» ----------------------------------------------------------
  //
  // The crudest wire protocol there is: four direction lines in the bottom of
  // port C, active low, one asserted per step of the ball. Nothing is latched
  // and nothing is addressed — the driver samples port C in a tight loop,
  // notices it has changed, and looks the four bits up in a table of sixteen
  // (dx, dy) pairs. MouseGraf 1.6 does exactly that at $6039, and its table,
  // read out of the running program, is
  //
  //   bit 3 → x+1    bit 2 → x-1    bit 1 → y-1    bit 0 → y+1
  //
  // which is agat-emulator's read_mars confirmed from the other end.
  //
  // A step therefore has to be a *pulse*, because it is the change the driver
  // counts, not the level. How fast the pulses come is the ball's business on a
  // real mouse and the emulator's here, and the state advances only on a read
  // and only after this long — so a slow driver misses nothing, it just drains
  // the movement more slowly. What the number has to clear is the gap between
  // the driver's *two* reads, one to notice the change and one to decode it:
  // ten cycles or so in MouseGraf, which reads again three instructions later,
  // against the hundred-odd its loop takes to come round.
  var PULSE_CYCLES = 64;

  function MouseMars() {
    Parallel.call(this, '«Марсианка»');
    this.pendX = 0;                    // steps the ball owes the driver
    this.pendY = 0;
    this.lines = 0;                    // which direction lines are asserted
    this.at = 0;                       // when they last changed
  }
  MouseMars.prototype = Object.create(Parallel.prototype);
  MouseMars.prototype.constructor = MouseMars;

  MouseMars.prototype.reset = function () {
    this.fx = this.fy = 0;
    this.btn = 0;
    this.portA = this.portB = 0;
    this.pendX = this.pendY = 0;
    this.lines = 0;
    this.at = 0;
  };

  MouseMars.prototype.step = function (ix, iy) {
    this.pendX += ix;
    this.pendY += iy;
  };

  // Assert, idle, assert: a step and the gap after it, one pulse width apart.
  MouseMars.prototype.sample = function (now) {
    var l;
    if (now - this.at >= PULSE_CYCLES) {
      this.at = now;
      if (this.lines) this.lines = 0;
      else {
        l = 0;
        if (this.pendX > 0) { l |= 8; this.pendX--; }
        else if (this.pendX < 0) { l |= 4; this.pendX++; }
        if (this.pendY > 0) { l |= 1; this.pendY--; }
        else if (this.pendY < 0) { l |= 2; this.pendY++; }
        this.lines = l;
      }
    }
    // Bits 5-4 are not the driver's business and read high, as they do out of
    // agat-emulator's own reset value.
    return this.withButtons(0x30 | (~this.lines & 0x0f));
  };

  // ---- ММ-8031 --------------------------------------------------------------
  //
  // An intelligent mouse by comparison: a write to port A picks an axis — bit 7
  // clear for X, set for Y — and latches how far that axis has moved since it
  // was last asked. Port C then reads bits 5-2 as a signed number biased by 8,
  // so a standing mouse reads $20, with bits 1-0 high.
  //
  // The number is companded rather than linear (mouse9.c:129-147), which makes
  // the mouse ballistic: the further it has moved since the last read, the more
  // each step of the reported figure is worth.
  var COMPAND = [0, 1, 3, 6, 15, 35, 70, 100];
  var COMPAND_MAX = 4;                 // mouse9.c clamps the index, not the value

  function compandIndex(counts) {
    var s = counts < 0 ? -1 : 1, i;
    counts = Math.abs(counts);
    for (i = 7; i >= 0; --i) if (COMPAND[i] <= counts) break;
    if (i > COMPAND_MAX) i = COMPAND_MAX;
    return i * s;
  }

  function compandValue(index) {
    return COMPAND[Math.abs(index)] * (index < 0 ? -1 : 1);
  }

  function MouseMM8031() {
    Parallel.call(this, 'ММ-8031');
    this.x = 0;                        // free-running position, in counts
    this.y = 0;
    this.last = [0, 0];                // what the program has been told about
    this.state = 0x23;                 // port C, no motion; buttons go on at the read
  }
  MouseMM8031.prototype = Object.create(Parallel.prototype);
  MouseMM8031.prototype.constructor = MouseMM8031;

  MouseMM8031.prototype.reset = function () {
    this.x = this.y = 0;
    this.fx = this.fy = 0;
    this.btn = 0;
    this.last[0] = this.last[1] = 0;
    this.portA = this.portB = 0;
    this.state = 0x23;
  };

  MouseMM8031.prototype.step = function (ix, iy) {
    this.x += ix;
    this.y += iy;
  };

  // One axis, as far as the compander can express it and only that far: what it
  // could not express stays in the difference and comes out of the next read.
  // Y is reported inverted — mouse9.c negates it after the clamp.
  MouseMM8031.prototype.latch = function () {
    var axis = (this.portA & 0x80) ? 1 : 0;
    var index = compandIndex((axis ? this.y : this.x) - this.last[axis]);
    this.last[axis] += compandValue(index);
    if (axis) index = -index;
    this.state = 0x03 | (((index & 15) ^ 8) << 2);
  };

  MouseMM8031.prototype.sample = function () { return this.withButtons(this.state); };

  // ---- pointer capture ------------------------------------------------------

  // A sweep across the canvas is a sweep across the screen: 256 counts, which
  // for MouseGraf is 256 pixels, because one count moves its cursor by exactly
  // one. Taken from the canvas as it is displayed, so the pointer keeps that
  // relationship whatever size the window is.
  var SCREEN_COUNTS = 256;

  // Click to capture, Esc to let go. Tracking the pointer instead would work
  // for as long as the guest's cursor and the host's agreed, and they stop
  // agreeing the first time the guest's hits the edge of its screen and stops
  // while the host's keeps going — with nothing to read back, that error is
  // permanent.
  AGAT.attachMouse = function (canvas, app) {
    var doc = canvas.ownerDocument;

    function card() { return app.mouseCard(); }
    function captured() { return doc.pointerLockElement === canvas; }

    function scale() {
      var r = canvas.getBoundingClientRect();
      return [r.width ? SCREEN_COUNTS / r.width : 1,
              r.height ? SCREEN_COUNTS / r.height : 1];
    }

    canvas.addEventListener('mousedown', function (e) {
      var c = card();
      if (!c) return;
      // The click that hands the pointer over is still a click. Swallowing it
      // makes a program that is waiting for a button look dead, and MouseGraf's
      // title screen already looks dead: it draws no cursor until the button
      // comes, so nothing on screen answers the mouse until it does.
      if (!captured() && canvas.requestPointerLock) canvas.requestPointerLock();
      // Button 2 is the middle one; the Agat's mice have two, so it is left
      // alone rather than folded into either.
      if (e.button === 0) c.btn |= 1;
      if (e.button === 2) c.btn |= 2;
      e.preventDefault();
    });

    // On the window, not the canvas: a button released after the pointer has
    // been let go would otherwise stay down for the program forever.
    window.addEventListener('mouseup', function (e) {
      var c = card();
      if (!c) return;
      if (e.button === 0) c.btn &= ~1;
      if (e.button === 2) c.btn &= ~2;
    });

    window.addEventListener('mousemove', function (e) {
      var c = card(), s;
      if (!c || !captured()) return;
      s = scale();
      c.move((e.movementX || 0) * s[0], (e.movementY || 0) * s[1]);
    });

    // MouseGraf starts on the second button, so the menu that button usually
    // opens has to be out of the way — on the click that takes the pointer as
    // well as while it is held, since that first click now reaches the machine.
    canvas.addEventListener('contextmenu', function (e) {
      if (card()) e.preventDefault();
    });

    doc.addEventListener('pointerlockchange', function () {
      var c = card();
      app.mouseCaptured = captured();
      if (c && !app.mouseCaptured) c.btn = 0;   // nothing to release it later
    });
  };

  AGAT.MouseNippel = MouseNippel;
  AGAT.MouseMars = MouseMars;
  AGAT.MouseMM8031 = MouseMM8031;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
