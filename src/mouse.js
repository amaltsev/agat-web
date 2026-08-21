// The two Agat mice, and the pointer and touch input that feeds them.
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
    m.moves++;                         // both tallies are for mouseReport(),
    m.counts += Math.abs(ix) + Math.abs(iy);   // which is the only way to see
    m.step(ix, iy);                            // which side of the card is dead
  }

  // What every card carries for App.mouseReport(): what the host has put in,
  // and what the machine has taken out, per register. A mouse that does nothing
  // is either not being fed or not being read, and nothing on screen says which.
  function countersFor(m) {
    m.moves = 0;                       // host movement events
    m.counts = 0;                      // whole counts they came to
    m.polls = 0;                       // register reads by the machine
    m.regs = [];                       // and by register within the page
    for (var i = 0; i < 16; i++) m.regs.push(0);
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
    countersFor(this);
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

  // The two counters, the remainder held outside them, and the buttons. The
  // read counts `countersFor` keeps are diagnostics and stay out of it.
  MouseNippel.prototype.saveState = function () {
    return { x: this.x, y: this.y, fx: this.fx, fy: this.fy, btn: this.btn };
  };

  MouseNippel.prototype.loadState = function (s) {
    this.x = s.x; this.y = s.y;
    this.fx = s.fx; this.fy = s.fy;
    this.btn = s.btn;
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
    this.regs[reg & 15]++;
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
  // Two of the four registers say nothing about the mouse and everything about
  // the card it hangs off, and a program reads them before it will look at the
  // ports at all:
  //
  //   $Cn00  the card's ROM page — the last 256 bytes of roms/cm6337.rom, which
  //          begin $18 $90 — fitted, or an empty $FF page
  //   $C0n1  port B before anything has written it. The 8255 comes up with all
  //          three ports inputs, so this is the card's pins and not a latch
  //
  // The two travel together — a card either carries the ROM and answers $FF
  // there or carries neither — because that is how the programs test it, and
  // they want opposite cards:
  //
  //   MouseGraf 4.4   ROM page required; never reads $C0n1 at all
  //   Klondike        ROM page and $C0n1 = $FF, both, or the slot is skipped
  //   MouseGraf 1.6   empty page and $C0n1 ≠ $FF, in the mode it starts in
  //
  // So Machine.fit builds the same «Марсианка» on either card and lets the
  // choice be the machine's; see HARDWARE.md.
  //
  // Only the page, never the 2K: the driver proper lives in the card's
  // $C800-$CFFF expansion window, which nothing here decodes. A program that
  // calls the ROM rather than driving the ports itself will not work.
  function Parallel(name, rom) {
    this.isMouse = true;
    this.name = name;
    countersFor(this);
    this.fx = 0;
    this.fy = 0;
    this.btn = 0;                      // bit 0 button A, bit 1 button B
    this.rom = rom || null;            // the printer card's $Cn00 page
    this.portBIdle = this.rom ? 0xff : 0x00;
    this.portA = 0;
    this.portB = this.portBIdle;
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

  // The two ports and the buttons, which is all either parallel mouse shares.
  // `portBIdle` is not state: it says which card the mouse is on, and state.js
  // has already checked that the fitted card is the same one.
  Parallel.prototype.saveState = function () {
    return { fx: this.fx, fy: this.fy, btn: this.btn,
             portA: this.portA, portB: this.portB };
  };

  Parallel.prototype.loadState = function (s) {
    this.fx = s.fx; this.fy = s.fy;
    this.btn = s.btn;
    this.portA = s.portA;
    this.portB = s.portB;
  };

  Parallel.prototype.read = function (reg, now) {
    this.polls++;
    this.regs[reg & 15]++;
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
  // port C, active low, one asserted per step of the ball. Nothing is addressed
  // and nothing is counted — the driver samples port C in a tight loop,
  // notices it has changed, and looks the four bits up in a table of sixteen
  // (dx, dy) pairs. MouseGraf 1.6 does exactly that at $6039, and its table,
  // read out of the running program, is
  //
  //   bit 3 → x+1    bit 2 → x-1    bit 1 → y-1    bit 0 → y+1
  //
  // which is agat-emulator's read_mars confirmed from the other end.
  //
  // A step is closer to a level than a pulse: the mouse asserts a direction
  // line and the driver takes it down through RES, which is what the RES line
  // is for and why both drivers here clear after every reading — MouseGraf 1.6
  // 32 cycles after the assert, Klondike 89-103.
  //
  // But it cannot be *only* RES, and this is where the number comes from. Two
  // things have to be true at once:
  //
  //   The step outlives the driver's decode window. A driver notices the
  //   change on one read and decodes the lines on a later one — 14 cycles later
  //   in MouseGraf 1.6, 102 in Klondike, which goes through its button handler
  //   on the way — and a step that ends in between is counted by nobody.
  //
  //   The step does not outlive the program that ignored it. MouseGraf 1.6
  //   polls this port on its title screen, waiting on a button, and never
  //   clears: a line latched until RES would still be up when the editor
  //   started, the editor would take it for its idle state, and the mouse would
  //   be dead for the rest of the session. It was not, on the real machine, so
  //   the УВК-01 lets go of a step by itself as well.
  //
  // The same number does for both because it is also the third thing — the
  // interval to the *next* step, which is how fast the ball rolls. At the
  // УВК-01's 0.5mm a step (Nippel Mouse Card, руководство программиста §1)
  // that makes 256 cycles about 2 m/s of hand movement, a little above the
  // 1.5 m/s the same manual works out as the fastest the card's counters could
  // follow and calls more than the manipulator itself allows.
  var STEP_CYCLES = 256;

  // The name carries the card, because which card the same mouse is on is the
  // difference between a program driving it and a program not seeing it, and
  // the status line is where that gets noticed.
  function MouseMars(rom) {
    Parallel.call(this, '«Марсианка»' + (rom ? ' (w/ROM)' : ''), rom);
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
    this.portA = 0;
    this.portB = this.portBIdle;
    this.pendX = this.pendY = 0;
    this.lines = 0;
    this.at = 0;
  };

  // Plus what the ball still owes the driver, which lines are asserted, and
  // when they last changed — `at` is a cpu-cycle stamp like every other.
  MouseMars.prototype.saveState = function () {
    var out = Parallel.prototype.saveState.call(this);
    out.pendX = this.pendX;
    out.pendY = this.pendY;
    out.lines = this.lines;
    out.at = this.at;
    return out;
  };

  MouseMars.prototype.loadState = function (s) {
    Parallel.prototype.loadState.call(this, s);
    this.pendX = s.pendX;
    this.pendY = s.pendY;
    this.lines = s.lines;
    this.at = s.at;
  };

  MouseMars.prototype.step = function (ix, iy) {
    this.pendX += ix;
    this.pendY += iy;
  };

  // RES — pin A9 on the cable, driven by port A bit 7. A driver that writes $80
  // and then $00 after reading the lines is asking for the next step rather
  // than the one it has already counted, and both drivers here do it after
  // every reading. It is the driver's half of the bargain above: the step it
  // ends early is a step the interval does not have to end for it.
  MouseMars.prototype.latch = function () {
    if (this.portA & 0x80) this.lines = 0;
  };

  // One step at a time: assert it, hold it for the driver, and take it down
  // again a step interval later if the driver has not.
  MouseMars.prototype.sample = function (now) {
    var l;
    if (now - this.at >= STEP_CYCLES) {
      if (this.lines) { this.lines = 0; this.at = now; }
      else {
        l = 0;
        if (this.pendX > 0) { l |= 8; this.pendX--; }
        else if (this.pendX < 0) { l |= 4; this.pendX++; }
        if (this.pendY > 0) { l |= 1; this.pendY--; }
        else if (this.pendY < 0) { l |= 2; this.pendY++; }
        // A ball that is not rolling starts no clock, so the interval is
        // already open when movement begins and its first step goes out at once.
        if (l) { this.lines = l; this.at = now; }
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

  function MouseMM8031(rom) {
    Parallel.call(this, 'ММ-8031', rom);
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
    this.portA = 0;
    this.portB = this.portBIdle;
    this.state = 0x23;
  };

  // Plus the free-running position, what each axis has already been told, and
  // the latched port C reading.
  MouseMM8031.prototype.saveState = function () {
    var out = Parallel.prototype.saveState.call(this);
    out.x = this.x;
    out.y = this.y;
    out.last = [this.last[0], this.last[1]];
    out.state = this.state;
    return out;
  };

  MouseMM8031.prototype.loadState = function (s) {
    Parallel.prototype.loadState.call(this, s);
    this.x = s.x;
    this.y = s.y;
    this.last[0] = s.last[0];
    this.last[1] = s.last[1];
    this.state = s.state;
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

  // The trackpad paths scale that down further: a finger, or a pointer that
  // also has menus to reach, overshoots at 1:1 where the captured pointer does
  // not. One number for both paths, hard-coded until use says whether it wants
  // to be a setting or a per-container value.
  var TRACKPAD_GAIN = 0.35;

  // A touch that ends within TAP_MS having moved under TAP_SLOP css pixels is
  // a tap. A tap holds button A for CLICK_MS — long enough that no polling
  // loop misses it — and a touch beginning within DRAG_MS of a tap keeps the
  // button down instead, which is the usual trackpad drag.
  var TAP_MS = 250;
  var TAP_SLOP = 12;
  var CLICK_MS = 100;
  var DRAG_MS = 300;

  // Click to capture, Esc to let go. Tracking the pointer instead would work
  // for as long as the guest's cursor and the host's agreed, and they stop
  // agreeing the first time the guest's hits the edge of its screen and stops
  // while the host's keeps going — with nothing to read back, that error is
  // permanent.
  //
  // The trackpad paths live with that: an uncaptured pointer or a finger is
  // only ever a source of strokes, steering a cursor it does not claim to be.
  // A touchscreen gets nothing else — it has no pointer to capture and no
  // relative motion to read — and `app.mouseTrackpad`, the gear popup's
  // checkbox, gives the desktop pointer the same manners for comparison.
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
      // comes, so nothing on screen answers the mouse until it does. On the
      // trackpad setting there is no handing over, and a click is only a click.
      if (!app.mouseTrackpad && !captured() && canvas.requestPointerLock) {
        canvas.requestPointerLock();
      }
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
      var c = card(), s, g;
      if (!c) return;
      // Captured, the pointer is the ball, 1:1. On the trackpad setting it is
      // a finger on a pad instead: scaled down, and listened to only over the
      // canvas, because the same pointer still has the rest of the page to
      // cross without dragging the guest's cursor along.
      if (captured()) g = 1;
      else if (app.mouseTrackpad && e.target === canvas) g = TRACKPAD_GAIN;
      else return;
      s = scale();
      c.move((e.movementX || 0) * s[0] * g, (e.movementY || 0) * s[1] * g);
    });

    // ---- touch, trackpad-style always ---------------------------------------
    //
    // Strokes steer, a tap is button A, a second finger is button B, and a
    // touch straight after a tap drags. Touch events rather than pointer
    // events, because canceling the touch is also what cancels the mouse
    // events the browser would synthesize from it — one preventDefault covers
    // the click, the scroll and the long-press callout together. With no card
    // fitted every handler stands aside and the canvas scrolls like the rest
    // of the page.
    var finger = null;      // the steering touch: id, last position, tap bookkeeping
    var bFingerId = null;   // the second touch, holding button B down
    var clickTimer = null;  // pending release of a tap's button A
    var lastTap = 0;        // when the last tap ended, for the drag window

    function releaseA() {
      var c = card();
      clickTimer = null;
      if (c) c.btn &= ~1;
    }

    canvas.addEventListener('touchstart', function (e) {
      var c = card(), t, i;
      if (!c) return;
      e.preventDefault();
      app.mouseTouch = true;
      for (i = 0; i < e.changedTouches.length; i++) {
        t = e.changedTouches[i];
        if (finger === null) {
          finger = { id: t.identifier, x: t.clientX, y: t.clientY,
                     t0: e.timeStamp, moved: 0, two: false, drag: false };
          if (e.timeStamp - lastTap <= DRAG_MS) {
            // A drag grows out of the tap before it: keep that tap's button
            // down instead of releasing and pressing again.
            if (clickTimer !== null) { clearTimeout(clickTimer); clickTimer = null; }
            finger.drag = true;
            c.btn |= 1;
          }
        } else if (bFingerId === null) {
          // The second finger is button B for as long as it is down — MouseGraf
          // starts on B, so it has to be more than a gesture. It also marks the
          // first finger as half of a pair, which is not a tap when it lifts.
          bFingerId = t.identifier;
          finger.two = true;
          c.btn |= 2;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', function (e) {
      var c = card(), s, t, i, dx, dy;
      if (!c || finger === null) return;
      e.preventDefault();
      for (i = 0; i < e.changedTouches.length; i++) {
        t = e.changedTouches[i];
        if (t.identifier !== finger.id) continue;
        dx = t.clientX - finger.x;
        dy = t.clientY - finger.y;
        finger.x = t.clientX;
        finger.y = t.clientY;
        finger.moved += Math.abs(dx) + Math.abs(dy);
        s = scale();
        c.move(dx * s[0] * TRACKPAD_GAIN, dy * s[1] * TRACKPAD_GAIN);
      }
    }, { passive: false });

    function touchEnd(e) {
      var c = card(), t, i;
      if (!c) { finger = null; bFingerId = null; return; }
      e.preventDefault();
      for (i = 0; i < e.changedTouches.length; i++) {
        t = e.changedTouches[i];
        if (bFingerId !== null && t.identifier === bFingerId) {
          bFingerId = null;
          c.btn &= ~2;
        } else if (finger !== null && t.identifier === finger.id) {
          if (finger.drag) {
            c.btn &= ~1;
          } else if (!finger.two && e.type === 'touchend' &&
                     e.timeStamp - finger.t0 <= TAP_MS &&
                     finger.moved <= TAP_SLOP &&
                     !(c.btn & 1)) {
            // The last test is the on-screen A button: a tap while it is held
            // must not schedule a release the button's own finger still owns.
            c.btn |= 1;
            clickTimer = setTimeout(releaseA, CLICK_MS);
            lastTap = e.timeStamp;
          }
          finger = null;
        }
      }
    }
    canvas.addEventListener('touchend', touchEnd, { passive: false });
    canvas.addEventListener('touchcancel', touchEnd, { passive: false });

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
