# How agat-web is built

The machine this emulates is described in [HARDWARE.md](HARDWARE.md). This is
about the JavaScript: what the pieces are, why they are shaped the way they are,
and which decisions are load-bearing.

---

## The constraint everything else follows from

**Open `index.html` and it runs.** No build step, no dependencies, no bundler, no
server. Plain `<script>` tags.

That is not minimalism for its own sake. An emulator is a thing people clone in
five years to run one old disk, and a toolchain is the part that rots. The cost
is real and accepted: everything in `src/` is **ES5 in one global namespace**,
`var` and `function`, no modules, no classes, no arrow functions.

```js
(function (AGAT) {
  'use strict';
  // ...
  AGAT.Thing = Thing;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
```

The payoff is that the *same files* run in the browser and under Node with no
packaging — `tools/harness.js` evaluates them into a `vm` context and gets a
working machine. Every tool in `tools/` is therefore testing the code that
actually ships.

`tools/` is the exception and uses whatever Node supports; it never ships.

### The module list is a single source of truth

`tools/modules.js` holds the ordered list. `index.html`'s `<script>` tags and the
Node harness both derive from it, and `node tools/check.js modules` asserts the
two agree.

This one check kills the entire class of "works headlessly, blank page in the
browser" bug, which is otherwise very easy to introduce and very annoying to
diagnose. Run it before believing anything.

---

## Module map

Load order matters only in that a module's dependencies must already be on
`AGAT` when it is *used*, not when it is defined.

| | |
|---|---|
| `cpu6502.js` | NMOS 6502. Passes the Klaus Dormann functional test. |
| `mem7.js` | Agat-7 16K window decode |
| `psrom7.js` | Agat-7 ЭмПЗУ card |
| `videosel.js` | pure `$C7xx` mode decode, `videoSel7` / `videoSel9` |
| `videopal.js` | four palettes, `$C058-$C05B` |
| `machine.js` | the bus: memory maps, soft switches, slots, interrupt timers |
| `drive.js` | normalised `Media` container and head position |
| `aim840.js` | DSK840/NIB840 → AIM words |
| `gcr140.js` | 4-and-4 and 6-and-2 track synthesis |
| `agc.js` | the `.agc` container: read, write, base64, patches |
| `image.js` | sniff and normalise any dropped file |
| `disk840.js` | 840K Teac controller |
| `disk140.js` | 140K Shugart controller |
| `video.js` | painters and `render()` |
| `font.js` | glyph blitting; keeps `{font, m0}` together |
| `keyboard.js` | browser `code` → scancode → Agat keymap, and the same table read backwards |
| `keyview.js` | the on-screen keyboard: two boards over that one table |
| `audio.js` | `$C030` edges → PCM |
| `unpack.js` | embedded ROM decompression |
| `fil.js` | `.fil` loading |
| `app.js` | browser glue: run loop, media routing, diagnostics |

Flat `src/` on purpose: two consumers have to agree on the file set, and a flat
list is the easiest thing to keep them agreeing on.

---

## The bus

`Machine` is the bus. The CPU holds a reference to it and calls `read(a)`,
`write(a, v)` and `pollInterrupts(cycles)`; everything else — banking, soft
switches, cards — is behind those.

Cards are registered by slot and may expose:

- `rom` — 256 bytes mapped at `$Cn00`
- `read(reg, now)` / `write(reg, v, now)` — the `$C08n` register file
- `insert(media)` / `media` — anything that takes a disk
- `reset()` — the bus reset line, if the card latches anything
- `lamp(now)` — `0` dark, `1` spinning, `2` transferring, for the drive lamps

`lamp()` belongs to the card because only the card knows which of its registers
is the motor line — port C bit 7 on the 840K, `$C0E9` on the 140K — and which
read hands a byte to the CPU rather than merely being polled.

`Machine.SLOTS` is the per-model slot table, so nothing else has to know where a
controller lives.

### Reset has to reach the cards

Loading an image resets the machine; it does not build a new one. So
`Machine.reset()` is the whole contract for "as if freshly switched on", and
every register a program can leave set has to be cleared there — including the
ones on cards, which is what a card's `reset()` is for. It runs over the slots
in order and only then calls `cpu.reset()`, because the vector fetch has to see
the restored bus.

The Agat-7 ЭмПЗУ shows why this is not a formality. Left read-enabled, it
answers `$D000-$FFFF` from its own RAM, so the monitor and all three vectors
come from the card rather than the ROM. A disk dropped onto a machine in that
state still runs its boot ROM, and still fails, because the loader's first call
into the monitor lands in the previous program's data. RAM contents are the
exception and deliberately survive — reset is not a power cycle, and `.fil`
loading fills memory itself.

### `phys()` is the seam

`phys(a)` maps a CPU address to a physical RAM offset, and it is the only place
that knows about banking. Two consequences:

- `.fil` loading pokes through it byte by byte, because a program can straddle a
  window boundary and on the Agat-7 the windows are 16K — this cannot be one
  `memcpy`.
- **Video does not use it.** The video controller scans physical RAM directly.
  There is deliberately no `readRam()` accessor that translates through the CPU
  map, because if one existed a painter would eventually call it and the bug
  would be subtle.

---

## The CPU

`cpu6502.js` is a straightforward interpreter, one big `switch`, addressing modes
as small closures. It is not cycle-accurate at the bus level; it accumulates a
cycle count per instruction, including the page-cross penalties.

### Undocumented opcodes

All of them are implemented — the same 105 agat-emulator carries in
`cpu/cpu6502.c`, from `oxyron.de/html/opcodes02.html`, and the same twelve
JAM/KIL codes halt. agat-emulator gates its set behind an `undoc` flag that its
Qt build turns **on** by default (`CFG_INT_CPU_EXT = 1`, `sysconf.c`) with a
checkbox to turn it off; there is no flag here, because refusing to run an
opcode the hardware would have run is not a behaviour worth reproducing.

Cycle counts matter more here than in most emulators: the sub-frame interrupt is
the Agat's music clock, so an instruction that is a few cycles cheap moves pitch
and tempo. `SLO`, `RLA`, `SRE`, `RRA`, `DCP` and `ISC` all share one addressing
pattern keyed on the opcode's low five bits — `illRmw()` resolves the mode and
the count together — and take the legal read-modify-write counts: 5 zp, 6 zpx, 6
abs, 7 absx, 7 absy, 8 izx, 8 izy, with **no page-cross penalty**, because a
read-modify-write does the extra fetch whether or not the index carried.

Klaus Dormann's test covers none of this — not the undocumented opcodes and not
anyone's cycle counts — so `tools/vectors.js` checks all 105 against
agat-emulator's table directly. Note that its table is not right everywhere:
`BRK` is listed as 8 cycles rather than 7, `$3D AND absx` as 3 rather than 4 and
`$E1 SBC izx` as 4 rather than 6, so it is worth reading as a cross-check rather
than as an authority.

`step()` polls interrupts **before** each instruction:

```js
CPU.prototype.step = function () {
  var start = this.cycles;
  if (this.bus.pollInterrupts) this.bus.pollInterrupts(this.cycles);
  if (this.nmiEdge) { this.nmiEdge = false; this.interrupt(0xfffa, false); return this.cycles - start; }
  if ((this.irqLine || this.irqPending) && !(this.p & I)) {
    this.irqPending = false;
    this.interrupt(0xfffe, false);
    return this.cycles - start;
  }
  // ... fetch and execute
};
```

There are deliberately **two** IRQ inputs:

- `irqLine` — a level. Stays asserted until something clears it, so the handler
  re-enters after `RTI` restores `I`. This is what the video interrupt uses.
- `irqPending` — a one-shot, for sources with no line to hold.

`interrupt()` pushes PCH, PCL, P and sets `I`, exactly as the hardware does — and
touches A, X and Y not at all, because the hardware doesn't either. Preserving
registers is the handler's job.

Taking an interrupt consumes a `step()` without executing an instruction, which
is what makes re-entrancy fall out naturally rather than needing to be modelled.

### Interrupt timing

`setIrqModel()` picks one of two code paths, both in CPU cycles.

`Machine.pollRaster` is the hardware and the default: one 312-line counter, an
event per line, and a level that the arming latch gates but does not stop.

```js
while (now >= this.nextLine) {
  this.nextLine += this.linePeriod;
  if (++this.rasterLine >= LINES) this.rasterLine = 0;
  ...
  this.irqRaw = irqAtLine(this.model, this.rasterLine);
}
this.cpu.irqLine = this.videoInts && this.irqRaw;
```

`Machine.pollInterrupts` is agat-emulator's, two independent counters:

```js
while (now >= this.nextSub) {
  this.nextSub += this.subPeriod;
  if (this.irqHold) { this.irqUntil = now + this.irqHold; this.cpu.irqLine = true; }
  else this.cpu.irq();
  if (this.onSubInt) this.onSubInt();
}
if (this.cpu.irqLine && now >= this.irqUntil) this.cpu.irqLine = false;
while (now >= this.nextFrame) { this.nextFrame += this.framePeriod; this.inVblank = true; this.cpu.nmi(); }
```

`irqHold` selects between its two variants — non-zero holds the line for that
many cycles, zero pulses it once per tick. Both stay until `raster` has been
confirmed by ear; see [the delivery model](HARDWARE.md#the-delivery-model).
`irqPeriod()` reports the assertion period whichever path is live.

`onSubInt` is a diagnostics hook, used by `recordSound()` to sample zero page at
the interrupt's own cadence rather than once per animation frame.

---

## Video

The whole frame is redrawn every time. No dirty tracking, no raster blocks.

```
painters --> Uint8Array(512*256) of palette indices --> Uint32Array(16) LUT --> ImageData
```

The C invalidates per written byte because it repaints into a shared GDI bitmap.
Here the worst mode reads 16K and writes 128K per frame, which costs less than a
write hook on every RAM store would — and it removes an entire category of
staleness bug.

**Painters iterate over source addresses, not screen coordinates.** Every
`addr → (x, y)` formula therefore keeps the same shape as
`videoprocs.c`/`videosel7.c`/`videosel9.c` and can be compared with them line by
line. This is worth more than it looks when a mode is one pixel out.

The flash timer is driven from CPU cycles, not wall clock, so `tools/shot.js`
output is reproducible.

---

## Disks

Every image format is normalised at mount time into one of two shapes, so no
controller ever has to know about file formats:

| | |
|---|---|
| `nib140` | 35 tracks × 6656 bytes, a GCR nibble stream |
| `aim840` | 160 tracks × N words, a byte plane plus an attribute plane |

`image.js` sniffs, `aim840.js`/`gcr140.js` synthesise, `drive.js` holds the
result, and the controllers only ever see a `Media`.

### Containers sit in front of that

The format itself is specified in [AGC.md](AGC.md); this is how it is wired in.

An `.agc` is JSON, so `sniff` asks `agc.parse` before it consults the size
table — a table of disk sizes has no business being asked about text. What comes
out is a machine and a list of media, and `App.applyAgc` sets the model, the RAM
size and both interrupt settings *before* build(), so the machine is taken apart
once rather than four times, and then hands each medium to the ordinary `load()`
path. A `.fil` in a container therefore works because `.fil` already works.

`App.sources` is the other half: the file **as it arrived**, keyed by slot,
because nothing else keeps it. `drives[slot]` holds a name and a kind, the
mounted `Media` is normalised past recognition, and Save would otherwise have
nothing to write. Patches are kept beside those bytes rather than folded into
them, so a container that is loaded and saved again is the same file.

The GCR encoder was verified **byte-for-byte against compiled `dsk2nib.c`** over
all 232,960 bytes of a track set. That is the only exact external oracle in the
project and it earned its keep: the 6-and-2 encoder's decrementing double loop
relies on `sind` being an unsigned char in C, and the wrap is load-bearing.

Track synthesis uses a seeded xorshift, not `Math.random`, so headless runs
reproduce.

---

## Audio

There is one bit of audio hardware, so the pipeline is short: `Machine` records
the CPU cycle of every `$C030` access into `speakerEdges`, and once per frame
`Speaker.play(edges, from, to)` walks them in order, holding the level between
edges, and queues one buffer.

Two things in there are not optional.

**A DC blocker.** A speaker cone cannot hold a displacement — driven to one side
and left there it springs back to centre. Without the filter, a sound effect made
of a handful of flips leaves the output pinned at full scale indefinitely and
every later buffer boundary becomes a click. `y[n] = x[n] - x[n-1] + R·y[n-1]`
with `R = 0.995` puts the corner near 35 Hz at 44.1 kHz: square waves pass, steps
decay over a few milliseconds, exactly as the cone does.

**Buffers are never dropped.** If the queue runs dry or runs away it resynchs,
but discarding a buffer discards audio.

**The queue lead is the latency, and it has to be trimmed continuously.**
Buffers are queued back to back, so the lead only changes through drift — and the
audio hardware clock does not run at exactly the rate `performance.now()`
reports. Correcting only at a wide upper bound lets the lead settle anywhere
below that bound and stay there, which is how this once reached a third of a
second. So the lead is eased back toward `TARGET_LEAD` on *every* buffer, by up
to half a millisecond, which is inaudible and far more correction than the drift
needs; the audible hard resync then stays rare.

    TARGET_LEAD  50 ms      MIN_LEAD  20 ms      MAX_LEAD  90 ms

The browser's own output stage sits on top of that and is often the larger half.
`agat.speaker.latency()` reports both, and `soundReport()` includes it.

The `AudioContext` needs a user gesture, and it must be **any** gesture —
`pointerdown` or `keydown` anywhere on the document. Wiring it only to the canvas
and the keyboard meant a program that wants neither ran silently while happily
recording thousands of speaker edges.

---

## The keyboard, and the two boards that draw it

`keyboard.js` maps forwards: browser `code` → PC/AT scancode → a byte, through
agat-emulator's shipped `[layout][modifier][scancode]` table. Every question a
*person* has runs the other way — this game wants `^`, which key is that? — so
the table is also indexed by the byte it produces. `routesTo(code)` returns
every `{layout, mod, scan}` that reaches a code, and `routeName` says it out
loud: `"ЛАТ Shift+6, РУС X"`.

That index is the whole basis of `keyview.js`, and it is why there is no second
hand-written map to keep in step.

**A cap is a code, not a scancode.** The machine's caps are dual-legend, `Й`
over `J`, `Ю` over `@`, `Ч` over `^`, because `$40-$5F` is ASCII `@A-Z[\]^_`
and, plus `$20`, the Agat-7 font's Cyrillic in KOI-7 N2 order — and РЕГ adds
exactly `$20` across the whole letter block. So the АГАТ board indexes its caps
`byCode` and lights whichever cap owns the byte a keypress produced. Two
consequences fall straight out and are the point of the thing:

- **The lit cap moves when ЛАТ/РУС is switched.** Host `Q` reaches `Я` in ЛАТ
  and `Й` in РУС, because those are different bytes.
- **Caps grey out per layout.** A legend is `near` if some host key reaches it
  now, `far` if only the other layout does, `dead` if none ever does. РУС
  cannot type `' , / ;`; ЛАТ cannot type `Ю`, `Ч` or `Ъ`.

### The remap is a layer, not an edit

A container can put a code on a host key — `"KeyW": "^"` — and it captures that
key in **every** plane: both layouts, with or without Shift and Ctrl. A game's
movement key that changed meaning under a modifier the player happened to be
holding would be worse than no remap.

The long form carries what the key is *for* —
`{ "code": "^", "note": "Shoot right" }` — and that note rides on the route, so
the board's tooltip answers the question someone actually has rather than the
one the index was built to answer.

That is one `if` at the top of `codeFor()`, and it is deliberately the *only*
place, because everything else already runs through there: the keypress path,
and the PC board's per-cap "what does this send right now" line. The other
direction — `buildRoutes()` — drops the table entries whose scancode has been
taken over and adds the remap's own, so `routesTo` and `routeName` keep being
the single answer to "which key sends this". The board then greys ЛАТ `W` and
tooltips `^` as `W (remap)` without knowing a remap exists.

`capCode` handles the one case the index cannot: УПР sends `$81-$9F`, which is
the letter's own code less `$40`, so a Ctrl'd byte is shown on the letter it was
made from.

The PC board is the same caps over `byScan`, where the mapping is exact and
there is nothing to look up; each cap carries its own name and, under it, the
byte it would send right now. `F4-F12` are drawn and come out dead, which is the
Agat having only F1, F2 and F3.

Clicking a cap puts its code straight into the latch rather than going back
through the scancode table: a cap knows its own byte, and several caps have no
host key at all. `tools/vectors.js` asserts the transcription both ways — no
code a host key sends is without a cap, no cap is unreachable, and every cap
drawn dead really is.

---

## The run loop

Driven by the **wall clock**, not by `requestAnimationFrame`'s cadence:

```js
var t = performance.now();
var dt = t - this.lastTime; this.lastTime = t;
if (dt > MAX_CATCHUP_MS) dt = MAX_CATCHUP_MS;      // after a stall, drop the backlog
var target = cpu.cycles + Math.round(dt * 0.001 * CPU_HZ);
while (cpu.cycles < target && !cpu.halted) cpu.step();
```

`rAF` follows the display, which is rarely 50 Hz. Issuing a fixed 50 Hz frame
budget on a 60 Hz refresh runs the machine 20% fast, and at 120 Hz twice that —
audible immediately as pitch and tempo in anything that makes sound, and the
reason the audio queue would otherwise drift.

---

## Diagnostics

`window.agat` is the `App`. Beyond `machine`, `video` and `drives`:

| | |
|---|---|
| `setSubFrameHz(hz)` | sub-frame interrupt rate |
| `setIrqModel(name)` | delivery model: `raster`, `held` or `pulse` |
| `recordSound(seconds)` | capture speaker edges and `PLAY500`'s zero page |
| `soundReport()` | group them into notes: frequency, length, interrupts per flip |

`soundReport()` reports each zero-page byte's values **with an occurrence
count**, sampled at interrupt cadence. A value the handler holds only briefly is
invisible to a 60 Hz sampler, which cost a round trip to discover.

---

## Tools and testing

Everything runs headlessly against the shipping source.

```sh
node tools/cputest.js               # Klaus Dormann 6502 functional test
node tools/vectors.js               # pure-function tests, about a second
node tools/check.js modules         # index.html vs tools/modules.js
node tools/painters.js              # each video mode from a synthetic pattern

node tools/check.js boot   <image>  # boot and report where it got to
node tools/check.js boot <image> --irq=raster    # ...under a given interrupt model
node tools/check.js io     <image>  # $C0xx histogram
node tools/check.js sniff  <file…>  # what the sniffer makes of each
node tools/shot.js <image> [keys]   # boot, send keys, write a PNG
node tools/corpus.js <dir> --md     # walk a directory, boot everything
node tools/debug.js …               # dump / trace / run-to-PC

node tools/mkagc.js <image> …       # pack an image and its settings into an .agc
node tools/mkagc.js a.dsk --diff=b.dsk    # ...with the difference as patches

node tools/tone.js "3,12,0" 16      # RISE OUT's PLAY500 handler on a bare machine
node tools/tone.js "3,12,0" 16 0 raster    # ...under a given interrupt model
python3 tools/mkirqtest.py          # rebuild examples/irqtest.dsk
python3 tools/build_roms.py --data <dir>
```

`tools/vectors.js` is the fast layer: pure functions, no machine, no disk, under
a second. `videoSel7`/`videoSel9` against a hand-transcribed table, `Mem7`
against the decode tables, the AIM checksum against sectors pulled from a real
`.aim`, `gcr140` against compiled `dsk2nib`, `AGAT.sniff` against the size
census, and a font case asserting glyph `$C1` renders correctly at `m0 = $80`.

The `.agc` cases pin what a hand-written container may rely on — the line width,
a build/parse round-trip, and that a patch reaches the payload without touching
the packed copy — and the remap cases pin both directions of it at once: `W`
sending `$DE` in every plane, `$5E` naming `W` as a route, `$57` losing ЛАТ `W`,
and all three coming back when the remap is dropped.

`tools/corpus.js` walks a directory of images, infers the model from the path
(`*7a` → 7, `*9a` → 9, as `agat.sh` does), boots each, and emits a Markdown
table. The images stay local and uncommitted; the table is the regression
artifact.

### Two traps worth knowing about

Both cost real time in this project and both look exactly like emulator bugs.

**A harness whose 6502 runs off into the weeds BRKs back through `$FFFE`.** `$00`
bytes are `BRK`, `BRK` vectors to `$FFFE`, and if that points at an interrupt
handler you get a storm of handler entries that is indistinguishable from
spurious interrupts. A wrong return address on the stack, or an unset `$FFFA`,
is enough to trigger it.

**A test that writes its vector to `$FFFE` silently depends on an ЭмПЗУ card.**
Install through the monitor at `$03FE` instead. Anything meant to compare two
emulators must not depend on either machine's configuration.

---

## Adding a machine feature

Roughly, in the order that keeps each step verifiable:

1. Read the reference implementation and note the file and line in a comment.
2. If it is a pure function — a decode, an encoder — put it in its own module and
   add a case to `tools/vectors.js` first.
3. Wire it into `machine.js` behind a card or a soft-switch case.
4. Add the module to `tools/modules.js`; `check.js modules` will keep
   `index.html` honest.
5. Verify headlessly (`check.js boot`, `shot.js`) before opening a browser.
