// An action recording: the machine as it stood, and every input since.
//
// A snapshot says where a program had got to. A recording says what happened
// next — the keys, the layout, the mouse — each stamped with the cycle it
// landed on, so playing it back into the same snapshot runs the same program
// the same way. Nothing about the host is in it: not a scancode, not a pixel,
// not a millisecond.
//
// **What makes this possible is that the machine is a function of its state and
// its inputs.** Nothing here reads a clock: the raster counter, both drives'
// byte clocks and the «Марсианка»'s step timer are all stamps on `cpu.cycles`,
// and there is no random number anywhere in `src/`. So a replay that puts the
// same bytes in the same registers on the same cycles is not an approximation
// of the session — it is the session.
//
// Which leaves the disk, and it is why a recording stops at the first write.
// The media are not in the snapshot: they come from the container's payload and
// its patches (see state.js), so the disk a replay finds is the disk as it
// stands now, not as it stood when recording began. A program that wrote a file
// and read it back would read the future. Carrying the disk with the recording
// is the answer, and until it is carried, `markWritten` ends the take.
//
// The inputs, in the units the machine sees them:
//
//   k  code       the byte in the keyboard latch, $C000
//   l  0 | 1      ЛАТ / РУС, which software reads at $C063
//   m  ix iy      whole mouse counts, the host's pixels already spent
//   b  mask       the two mouse buttons, bit 0 A and bit 1 B
//   x  wall       nothing reached the machine: the take was picked up again
//                 here, and this is when by the clock on the wall
//
// Each event is `[dcycles, kind, ...]`, the cycles since the one before it —
// relative because a recording is a list of things that happened one after
// another, and absolute stamps in a file this long are mostly the same leading
// digits over and over.
(function (AGAT) {
  'use strict';

  var VERSION = 1;

  // Every write any drive has done, as one number. The per-track `written`
  // flags cannot answer this: a track written twice looks like a track written
  // once, and a disk that arrived written looks like a disk being written now.
  function writeCount(machine) {
    var n = 0, s, card, d, media;
    for (s = 0; s < 8; s++) {
      card = machine.cards[s];
      if (!card || !card.mediaAt) continue;
      for (d = 0; d < (card.drives || 1); d++) {
        media = card.mediaAt(d);
        if (media) n += media.writes || 0;
      }
    }
    return n;
  }

  // ---- recording ------------------------------------------------------------

  // Takes the App-shaped thing state.js takes — `machine` and `slots` — so a
  // tool can record a session with no page under it.
  function Recorder(app, opts) {
    this.app = app;
    this.name = (opts && opts.name) || '';
    this.state = null;
    this.events = [];
    this.wall = 0;                     // when this was recorded, for the person
    this.edited = 0;                   // and when it was last added to
    this.autoplay = false;
    this.cycles = 0;                   // and for the machine: where it began
    this.last = 0;                     // the cycle the last event landed on
    this.ended = 0;
    this.stopped = '';
    this.writes = 0;
  }

  // The machine has to be held while this runs. state.save() reads the RAM
  // through a reference and encodes it a turn later, so a machine that steps in
  // between is saved half from one cycle and half from another — and the cycle
  // stamped here would be neither.
  Recorder.prototype.start = function () {
    var self = this, m = this.app.machine;
    this.wall = Date.now();
    this.cycles = this.last = m.cpu.cycles;
    this.writes = writeCount(m);
    return AGAT.state.save(this.app).then(function (st) {
      self.state = st;
      return self;
    });
  };

  // A take picked up again, from the cycle the machine is on. Everything it
  // recorded after this cycle is dropped, and what happens from here is
  // recorded over it — which is sound because the machine got here by playing
  // those same events back, so the state this continues from is the state the
  // kept half produces.
  //
  // The snapshot and the wall clock are the take's own: this is the same
  // recording, longer. What marks the join is an `x` event carrying the
  // moment, which nothing reads yet and which is the only trace in the file
  // that the take was made in more than one sitting.
  Recorder.prototype.extend = function (take) {
    var now = this.app.machine.cpu.cycles, at = take.cycles, i, e;
    this.state = take.state;
    this.name = take.name || this.name;
    this.wall = take.wall;
    this.autoplay = !!take.autoplay;
    this.cycles = take.cycles;
    this.events = [];
    for (i = 0; i < take.events.length; i++) {
      e = take.events[i];
      if (at + e[0] > now) break;
      at += e[0];
      this.events.push(e);
    }
    this.last = at;
    this.edited = Date.now();
    this.writes = writeCount(this.app.machine);
    this.add('x', this.edited);
    return Promise.resolve(this);
  };

  // One input, at the cycle the machine is on. Called from the App's four
  // doors, which is the whole of what a person can do to the machine.
  Recorder.prototype.add = function (kind, a, b) {
    var now = this.app.machine.cpu.cycles;
    var e = [now - this.last, kind];
    if (a !== undefined) e.push(a);
    if (b !== undefined) e.push(b);
    this.last = now;
    this.events.push(e);
  };

  // Whether a drive has been written to since this began — the one thing that
  // ends a take without anybody asking. Called from the run loop.
  Recorder.prototype.wrote = function () {
    return writeCount(this.app.machine) !== this.writes;
  };

  // `why` is 'user', 'write' or 'machine', and it is kept: a recording that
  // stops on a write stops mid-sentence, and whoever plays it back should be
  // able to say so.
  Recorder.prototype.stop = function (why) {
    this.ended = this.app.machine.cpu.cycles;
    this.stopped = why || 'user';
    return this.data();
  };

  Recorder.prototype.data = function () {
    var out = {
      version: VERSION,
      name: this.name,
      wall: this.wall,
      cycles: this.cycles,
      ended: this.ended || this.app.machine.cpu.cycles,
      stopped: this.stopped || 'user',
      state: this.state,
      events: this.events,
    };
    // Both only where they are something: a take made in one sitting has no
    // edit to report, and one nobody has asked to start by itself says so by
    // not saying anything.
    if (this.edited) out.edited = this.edited;
    if (this.autoplay) out.autoplay = true;
    return out;
  };

  // ---- playing it back ------------------------------------------------------

  function Player(app, rec) {
    this.app = app;
    this.rec = rec;
    this.events = (rec && rec.events) || [];
    this.i = 0;
    // Where the next event lands, absolute. Infinity once they are spent, so
    // the run loop asks for nothing and runs to its own target.
    this.next = this.events.length ? rec.cycles + this.events[0][0] : Infinity;
    this.end = rec ? rec.ended : 0;
  }

  // Into the machine the App has already built, exactly as a container's state
  // block goes in — including the refusal, which is the same refusal: a
  // recording of an Agat-9 does not play on an Agat-7.
  Player.prototype.start = function () {
    var self = this;
    return AGAT.state.restore(this.app, this.rec.state).then(function (s) {
      self.next = self.events.length
        ? self.rec.cycles + self.events[0][0] : Infinity;
      self.i = 0;
      return s;
    });
  };

  // The cycle the run loop must not step past. Not a promise that an event
  // lands there — a replay stopped early leaves it where it was.
  Player.prototype.nextCycle = function () { return this.next; };

  // Everything due at or before `now`, in order. The run loop stops on
  // `nextCycle` and calls this, so "before" only happens where an instruction
  // straddles the stamp — a few cycles, and always the same few.
  Player.prototype.apply = function (now) {
    var e;
    while (this.i < this.events.length && this.next <= now) {
      e = this.events[this.i++];
      this.inject(e[1], e[2], e[3]);
      this.next = this.i < this.events.length
        ? this.next + this.events[this.i][0] : Infinity;
    }
  };

  // An input, put where a person's would have gone — into the machine and the
  // card, not through the App's doors. The doors are shut while a replay runs,
  // and they are what a recorder listens to: going through them would have a
  // replay record itself.
  Player.prototype.inject = function (kind, a, b) {
    var m = this.app.machine, c;
    switch (kind) {
      case 'k': m.keyDown(a); break;
      case 'l': m.setLayout(!!a); break;
      case 'm':
        c = this.app.mouseCard();
        if (c) c.step(a, b);            // whole counts: accumulate() is spent
        break;
      case 'b':
        c = this.app.mouseCard();
        if (c) c.setBtn(a);
        break;
      default: break;                   // a kind from a later version
    }
  };

  // Every event played and the machine run out to where the recording ended.
  Player.prototype.done = function () {
    return this.i >= this.events.length &&
           this.app.machine.cpu.cycles >= this.end;
  };

  // How far in, as a fraction, for whatever draws a progress bar.
  Player.prototype.at = function () {
    var span = this.end - this.rec.cycles;
    if (span <= 0) return 1;
    var done = (this.app.machine.cpu.cycles - this.rec.cycles) / span;
    return done < 0 ? 0 : done > 1 ? 1 : done;
  };

  AGAT.Recorder = Recorder;
  AGAT.Player = Player;
  AGAT.record = { VERSION: VERSION, writeCount: writeCount };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
