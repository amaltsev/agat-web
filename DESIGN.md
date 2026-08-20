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
| `xram7.js` | Agat-7 ОЗУ expansion card |
| `xram9.js` | Agat-9 ОЗУ expansion card ("Ext. RAM") |
| `videosel.js` | pure `$C7xx` mode decode, `videoSel7` / `videoSel9` |
| `videopal.js` | four palettes, `$C058-$C05B` |
| `machine.js` | the bus: memory maps, soft switches, slots, interrupt timers |
| `drive.js` | normalised `Media` container, head position, write lock |
| `aim840.js` | DSK840/NIB840 → AIM words, and a written track back to sectors |
| `gcr140.js` | 4-and-4 and 6-and-2 track synthesis, and reading it back |
| `unpack.js` | gzip both ways, and the embedded ROM blobs |
| `agc.js` | the `.agc` container: read, write, base64, gzip, patches |
| `image.js` | sniff and normalise any dropped file |
| `disk840.js` | 840K Teac controller |
| `disk140.js` | 140K Shugart controller |
| `video.js` | painters and `render()` |
| `font.js` | glyph blitting; keeps `{font, m0}` together |
| `mouse.js` | the three mice on their four fittings, and the pointer and touch input that feeds them |
| `keyboard.js` | browser `code` → scancode → Agat keymap, and the same table read backwards |
| `keyview.js` | the on-screen keyboard: three boards over that one table, and the container's controls as a card |
| `info.js` | the card under the controls: what the container says it is |
| `audio.js` | `$C030` edges → PCM |
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
- `readReg(a)` / `writeReg(a)` — for a card whose control *is* its `$Cn00` page,
  which on the Agat is common: the value rides in the address
- `ioRegs = false` — this card does not decode `$C08n` at all, so that page
  stays open bus. Both memory cards say so; the drives do not.
- `insert(media)` / `media` — anything that takes a disk
- `reset()` — the bus reset line, if the card latches anything
- `lamp(now)` — `0` dark, `1` spinning, `2` transferring, for the drive lamps

`lamp()` belongs to the card because only the card knows which of its registers
is the motor line — port C bit 7 on the 840K, `$C0E9` on the 140K — and which
read hands a byte to the CPU rather than merely being polled.

### Machine profiles

`Machine.PROFILES` is what each model *is*: base RAM, and a card with a size in
every slot. `App.build()` and `tools/harness.js`'s `makeMachine` both go through
`Machine.resolveSlots()` and `Machine.fit()`, so a tool and the browser cannot
end up testing different hardware — which they could, and briefly did, when each
spelled the card list out for itself.

An override is a slot map merged over the profile: a different card, a different
size, or `null` for a slot left empty. `App.slotDiff()` turns the live machine
back into the smallest map that describes it, so a container for a stock machine
carries no slots at all.

`Machine.SLOTS` is derived from the profiles and answers "which slot is the 140K
drive in", so nothing else has to know.

A mouse is the one card that is never in a profile — nothing that came with
either machine expects one — so it exists only as an override, and
`Machine.MOUSE_SLOTS` says where one goes when the gear popup or a tool asks for
it rather than naming the slot itself.

### Cards, where slots will not do

A slot number belongs to a model. The 140K drive is slot 3 on the Agat-7 and
slot 6 on the Agat-9, and the slot each machine leaves free for a mouse is not
the same one either — so a machine that has to survive being asked for on the
*other* model cannot be carried as a slot map. Two of them do have to: an
`.agc`'s `machine.slots`, when the address puts the program on the other
machine, and the gear popup's menus, which name cards and not places.

So the App holds what it is fitted with as **cards**, keyed by class:
`Machine.cardsOf()` reads a slot map into them and `Machine.slotsFor()` works
the slots back out for whichever model is being built, sending each card where
that model puts one. A class is the card's own name except for the mice, which
share `mouse`: a machine takes at most one, and swapping a «Марсианка» for a
Ниппель is one choice rather than a card added beside another.

There are two layers, merged class by class in `App.cardSlots()` on every build:
`agcCards`, what a container asked for, and `overCards`, what the menus and the
address say over the top of it. Class by class is the point — an address that
resizes the ЭмПЗУ says nothing about the mouse, and the container keeps it.
A slot a card was explicitly given is kept only on the model it was given for.

### The pointer has to be captured, not tracked

All three mice report movement and none reports position, so there is no way to
tell the guest where the host's pointer is; its own cursor is somewhere else,
and the two drift apart the first time the guest's stops at the edge of its
screen while the host's keeps going. `AGAT.attachMouse` therefore takes the
pointer with `requestPointerLock` on a click and feeds `movementX/movementY` to
whichever card is fitted — agat-emulator does the same, and for the same reason
(`support.cpp:491-525`). Scale comes from the canvas as displayed, so a sweep
across it is a sweep across the screen whatever size the window is.

The trackpad paths accept the drift instead of curing it: an uncaptured input
is only a source of strokes, steering a cursor it never claims to be. A
touchscreen — no pointer to capture, no relative motion to read — always works
this way when a card is fitted: strokes on the canvas steer, a tap is button A,
a second finger held down is button B, and a touch beginning right after a tap
keeps the button down, which is the usual trackpad drag. `App.mouseTrackpad`,
set by the gear popup's checkbox, gives the desktop pointer the same manners:
no capture, movement taken only over the canvas. Both paths scale movement by
`TRACKPAD_GAIN` on top of the canvas scale — at 1:1 a finger overshoots — and
that constant is the tuning knob if a program ever wants a different feel.

The gestures alone cannot be the whole button story — MouseGraf waits on
button B before it will load, and a two-finger tap is beyond some hosts, the
devtools device emulator among them — so on touch hosts with a card fitted,
`index.html` overlays an A and a B button on the screen's lower corners. They
set the same two `btn` bits, held for as long as they are pressed, which is
also what makes a deliberate drag: one finger on the button, another stroking
the canvas.

The cards take fractional counts and keep the remainder themselves, because a
host pixel is not a step of a ball and the program may zero the counter between
any two of them. Everything above the card deals in counts and nothing above it
knows which mouse is fitted: `App.mouseCard()` finds it by `isMouse`, and all
three answer `move()` and carry the same two button bits.

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

`Machine.pollInterrupts` is the hardware and the only path: one 312-line
counter, an event per line, and a level that the arming latch gates but does not
stop. Everything is in CPU cycles.

```js
while (now >= this.nextLine) {
  this.nextLine += this.linePeriod;
  if (++this.rasterLine >= LINES) this.rasterLine = 0;
  ...
  this.irqRaw = irqAtLine(this.model, this.rasterLine);
}
this.cpu.irqLine = this.videoInts && this.irqRaw;
```

Both interrupts come off that one counter — the sub-frame IRQ from a bit of it,
NMI from its blanking edge — because that is how the boards do it; see
[the delivery model](HARDWARE.md#the-delivery-model). `irqPeriod()` reports the
assertion period, which is what the status line and the sound tools turn into a
rate.

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
| `aim840` | 160 tracks × 6464 words, a byte plane plus an attribute plane; a synthesised track is one 6250-byte revolution in that slot |

`image.js` sniffs, `aim840.js`/`gcr140.js` synthesise, `drive.js` holds the
result, and the controllers only ever see a `Media`.

### Containers sit in front of that

The format itself is specified in [AGC.md](AGC.md); this is how it is wired in.

An `.agc` is JSON, so `sniff` asks `agc.looks` before it consults the size
table — a table of disk sizes has no business being asked about text. `looks` is
the cheap half: the file starts with `{` and says `"agc":` in its first 4K.
Reading it is `agc.parse`, which is a **promise**, because a payload may be
gzipped and the platform's gzip is a stream — so `App.load` is one too, and
every caller of it waits. What comes out is a machine and a list of media, and
`App.applyAgc` sets the model, the RAM size and both interrupt settings *before*
build(), so the machine is taken apart once rather than four times, and then
hands each medium to the ordinary `load()` path, in order. A `.fil` in a
container therefore works because `.fil` already works.

Compression lives at those two edges and nowhere else. `parse` decodes each
payload and each patch — `hex`, `data` or `gz` — and hands back bytes; `build`
is the only thing that decides how bytes are written, by the size rule in
[AGC.md](AGC.md#media). In between, a patch is `{ at, bytes }`, so `diff`,
`applyPatches` and `writeBack` never see an encoding and stay synchronous.

`App.sources` is the other half: the file **as it arrived**, keyed by slot,
because nothing else keeps it. `drives[slot]` holds a name and a kind, the
mounted `Media` is normalised past recognition, and Save would otherwise have
nothing to write. Patches are kept beside those bytes rather than folded into
them, so a container that is loaded and saved again is the same file.

### Writing goes out the same door

`App.writeBack` is what stands between a written disk and a saved container. The
`Media` a controller writes to is a stream, and what a container should carry
is the image it came from, so every track the drive marked written is decoded
back — through `gcr140.denibblizeTrack` to 16 sectors, or
`aim840.desectorizeTrack` to 21 — and the difference comes out as patches; a
`.nib` or `.aim` source is its own baseline and the patches are simply what
moved (`aim840.toAim` interleaves the two planes back). It reads `this.sources`
and the card's media and touches neither, which is what makes saving twice
produce the same file and what lets the tests call it with a two-field stand-in
for an `App`.

Its one give-up is a track that will not decode. There is then no sector image
for a patch to be a difference from, so the whole stream is saved instead and
the entry is renamed `.nib` (140K) or `.aim` (840K) — which loads again unaided,
because media are identified by size.

The GCR encoder was verified **byte-for-byte against compiled `dsk2nib.c`** over
all 232,960 bytes of a track set. That is the only exact external oracle in the
project and it earned its keep: the 6-and-2 encoder's decrementing double loop
relies on `sind` being an unsigned char in C, and the wrap is load-bearing.

The decoder has no such oracle, so what stands in for one is the encoder: over a
whole real disk, denibblizing has to give back the sector image byte for byte,
and that test rides on the encoder's own chain of trust. It inverts the encoder
by construction rather than by a second derivation — the interleave is unwound
by walking a list of the `(dind, sind)` pairs generated by the encoder's own
loop control, backwards, so the two cannot drift apart.

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

## The keyboard, and the boards that draw it

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
`{ "code": "^", "hint": "Shoot right" }` — and that hint rides on the route, so
the board's tooltip answers the question someone actually has rather than the
one the index was built to answer.

An entry with **no code** — `"Space": { "hint": "Jump" }` — declares a key the
program uses as it already is. It adds nothing to `REMAP` and changes nothing
`codeFor()` returns; it only puts the key in the set the container named, and
its hint on the routes the table already had. Both kinds together are the key
set, and `keyCount()` and `usedCodes(layout)` are what a board asks about it.

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

### The winnowed board

A third view, `used`, keeps the machine's own caps but not the machine's own
board. Every cap the container's keys do not reach shrinks to a half-em sliver,
and it is drawn as **three areas that collapse independently** — the typewriter,
the arrow cluster and the numeric pad — each hidden outright when nothing in it
is named. A program that never touches the pad gets no column of slivers where
the pad was.

The cluster is the reason the areas exist. On the machine ↑ sits between ПВТ and
РЕД with ← ↓ → below, and those two caps are what hold it over ↓ — but ПВТ is a
cap this board does not draw, so the row closes up and ↑ ends halfway across it.
`USED_NAV` arranges the four arrows itself, and is marked `whole`: one arrow
in the key set brings all four, because a cluster missing one of its arms reads
worse than no cluster. `USED_MAIN` and `USED_PAD` are the machine's own blocks
with the caps this view never draws filtered out.

**It draws almost no controls.** СБР, УПР, РУС/LAT and the caps that send nothing
are the board's own furniture rather than the program's keys, and on a phone they
were most of what was on the screen. The exception is one **РЕГ**, and it is not
furniture: a cap named on both its legends can only send the unshifted one by
itself, so without a register the other control would be unreachable by touch.
`keysOnly` carries the left one and `plan()` draws it only when some cap is in
that position — Rise Out's Cheats board has it, its Menu board does not.

`usedCodes(layout, group)` says which codes this program reaches. Two sources,
because a container has two ways to say it: `controls` names codes outright, and
the key set contributes a remap's own code and, for a key declared as-is,
whatever the table has under it in this layout, unshifted and shifted. Naming a
group is asking for that group alone — the key set is the program's *whole* set,
so folding it back in would undo the narrowing. It returns the codes themselves
rather than flags, because
`capsUsed` then moves each onto the cap that owns it, the same order `light()`
takes: a code with a cap of its own goes there, the rest fall back to `capCode`.
So `$88` lands on `←`, and `$8B` on `К` where УПР makes it.

That fallback is why a kept cap remembers what it stands for. `$8B` has no cap on
this machine at all and is drawn on `K`; with no УПР to hold, a touch on that cap
has to send `$8B` rather than the `K` it is painted with, so `plan()` records the
code on the cap and `press()` and the tooltip use it.

**The legend the program reads goes on top.** The machine prints its letter caps
Cyrillic over Latin, so a cap kept for `U` is drawn `У` over `U` and the big
glyph on it is the one byte the game does not want — which is exactly how a
container's own author came to read the Cheats board as asking for `$75` and
`$64`. On the winnowed board the two halves swap when the program reads only the
lower one. The full АГАТ board never swaps: it is the machine, and the machine
prints them the other way round.

`kept(d, used)` is that record, one code per half — `keeps()` is the same thing
collapsed to the single byte a touch sends. Two halves are worth keeping apart
because a container can name both: Rise Out reads `K` and `К`, which are the
unshifted and shifted legends of one letter cap. `refresh()` underlines every
half the program actually reads, `reads()` gives the cap a tooltip line per
control, and `press()` sends the unshifted one — or the shifted one while a host
Shift is held, which is as far as one pointer and no РЕГ cap can go. A half kept
only as a stand-in is marked on neither legend, since the code on it is not the
one printed there; `marks()` is what draws that distinction.

An indent is measured in cap widths, so in a block that lost caps to slivers it
collapses with them — ПРОБЕЛ stays under the letters instead of nine ems to their
right — while a block that kept everything keeps its indents, which is what holds
↑ over ↓. The board is then sized off its own measured width in ems, the one
number the stylesheet cannot know: what is left depends on the container.

The winnowing is redone on every `refresh()`, since a key declared as-is is a
different cap in ЛАТ than in РУС. With no container loaded there is nothing to
winnow by and every cap it has is drawn; the menu greys the option out until
something names keys or controls, and on a handheld a container that names them
opens with it. `node tools/check.js keys <file.agc>` draws the same board in a
terminal, against a stub `document` — which is what makes it testable at all.

`setView('used:Cheats')` cuts it to one of the container's control groups. The
group rides *beside* the view rather than in it — everything below still asks
only whether the view is `used` — and a group the loaded container does not have
is dropped in `setView`, the one place every caller goes through, rather than
left to become a board winnowed down to nothing.

### The controls panel

`ControlPanel` draws the container's `controls`: a column per group, a line per
row, in file order. It is not a keyboard — no cap on it sends a byte. What it
says is **static on purpose**: it prints what the *program* reads, and `Q` is
`$51` whatever is switched on. Which host key reaches `$51` right now is the
board's question, and the board already answers it by moving the lit cap and
greying the rest.

**A group is a tap target**, though, and the whole tile is one: it cuts the board
beside it to that group, and tapping the live one goes back to all of them, so
the same target is the way out as well as the way in. It goes through the
`<select>` rather than around it — `onPick` sets the menu and calls the same
`applyKbd`/`saveUrl` the menu's own `change` does — so the two can never disagree
and the address follows a finger as well as it follows the menu. One delegated
`click` listener on the panel element, as the board has one for all its caps, and
`destroy()` takes it off again: the panel is rebuilt on every container load and
its host element is not, so a listener left behind would make one tap fire twice.

Pointer only, deliberately. Every keystroke on this page belongs to the machine,
so a focusable tile would be a tile that eats a key the emulator wanted; the
`<select>` in the bar reaches the same states from the keyboard.

The one host-side thing on the panel is a container remap, `^ (W)`. A remap holds
in every plane by construction, so it is the only host key that does not move
under ЛАТ/РУС and the only one the panel can honestly promise.

**The container's `hint`** is not on this panel: it is the container talking
rather than the keyboard, and it is drawn on the info card below with the rest of
what the container says about itself. Every child of the panel is a group, which
is what lets a tap anywhere inside it pick one.

The panel is also where the prose lives now. `controls` labels are indexed by
code, which is what the winnowed board's caps are, so `title()` reads them
straight off `controlLabel(code)`; `keys` hints still arrive the old way through
`routeName`, and a container written either way says something.

**Two controls, one cap.** `K` and `К` are the unshifted and shifted legends of a
single cap, so a container naming both gets one key on the winnowed board — drawn
with both halves underlined, naming both in its tooltip, sending the unshifted one
on a click and the shifted one after РЕГ or under a held Shift. `plan()` sets
`needShift` when it sees such a cap, which is what puts РЕГ on the board; the
latch is the same one-shot `stick` the АГАТ board uses, so it clears itself after
the key it was pressed for.

**УПР is not needed and is not drawn.** A cap kept as a stand-in for a control
code sends that code directly — `press()` uses `cap.sends`, not the legend — so
`$8B` on the `K` cap needs no modifier. What a container *cannot* currently do is
name `$4B` and `$8B` both: `capsUsed` keeps one code per cap index and the second
is dropped rather than made unreachable. Nothing in `examples/` does it, and the
fix would be to let a cap hold a third code, not to add УПР.

### The info card

`info.js` draws the last thing on the page: `title`, `author`, `date` and `url`
in two rows, then `info` — what the program is, at whatever length the container
took — and then `hint`. That is everything the container wrote to be read.
Nothing the emulator worked out goes on it, which is the status line's half, and
`notes` stays off it too, because it is the record and not something shown.

The hint is drawn in the page's ink and at weight 600, the only thing on the card
that is: it is the line worth acting on rather than reading, and above two
paragraphs of prose that has to be visible before the card is.

`drawInfo(el, about)` empties the element and refills it, so a second container's
identity replaces the first one's, and each of the six is drawn only if it is
there: a container naming an author and nothing else gets one line with an author
on it rather than a row of empty separators. `app.about()` is what the page hands
it — named for what it returns rather than `info()`, since `info` is one of the
six — and the title falls back the way `credit()` does, so a container that did
not name itself is still called by its filename. A bare image clears all six, so
the element ends up empty and `#info:empty` takes it off the page, the way the
controls card and the keyboard go when there is nothing to draw.

The `url` becomes an `<a>` only where it is `http`/`https`. A container is a file
from somewhere else, and a `javascript:` URL made clickable would be that file
running code on this page; anything else is printed as the text it is. On its own
row the link drops the scheme and a trailing slash, which there are noise.

`info` and `hint` go through `prose()`, which finds bare addresses in them and
links those the same way. The match has to start at a scheme, so nothing else in
a sentence can become one, and `trimTail` gives back a trailing `.,;:!?»` and a
closing bracket the address did not open — `see https://x/y.` ends in a full
stop, and `https://x/a_(b)` does not. Text and links are appended as separate
nodes, never as markup, so the paragraph stays the plain text AGC.md promises;
in prose the address keeps the scheme, because there it is part of a sentence
rather than a field of its own.

`node tools/check.js keys <file.agc>` draws the card under the panel, and
`tools/vectors.js` builds it against a stub DOM — the card is what the page shows
a player about a program, and it is worth checking without a browser.

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
| `recordSound(seconds)` | capture speaker edges and `PLAY500`'s zero page |
| `soundReport()` | group them into notes: frequency, length, interrupts per flip |
| `mouseReport()` | both halves of the mouse, and which slots the program pokes |

`soundReport()` reports each zero-page byte's values **with an occurrence
count**, sampled at interrupt cadence. A value the handler holds only briefly is
invisible to a 60 Hz sampler, which cost a round trip to discover.

`mouseReport()` exists because a mouse has two halves that fail identically on
screen — the page not feeding the card and the program not reading it — and the
cursor sitting still says nothing about which. It counts both directions, breaks
the machine's side down by register, and lists which slots the program touches
at all, which is what separates a mouse in a slot the program never scans from
one it scans and rejects. Called twice, it also reports the difference, so
waving the mouse between two calls is the test.

---

## Tools and testing

Everything runs headlessly against the shipping source.

```sh
node tools/cputest.js               # Klaus Dormann 6502 functional test
node tools/vectors.js               # pure-function tests, about a second
node tools/check.js modules         # index.html vs tools/modules.js
node tools/check.js kbdmenu         # the page's keyboard menu, load order and all
node tools/check.js urlkeys         # the page's address, around the whole loop
node tools/painters.js              # each video mode from a synthetic pattern

node tools/check.js boot   <image>  # boot and report where it got to
node tools/check.js io     <image>  # $C0xx histogram
node tools/check.js sniff  <file…>  # what the sniffer makes of each
node tools/check.js keys   <.agc>   # the controls panel and the winnowed board
node tools/check.js write  <image> --keys=…    # boot unlocked, say what was written
node tools/shot.js <image> [keys]   # boot, send keys, write a PNG
node tools/shot.js <image> --mouse=nippel --click=R --hold=L --move=60,0
                                    # ...and drive a mouse over it
node tools/corpus.js <dir> --md     # walk a directory, boot everything
node tools/debug.js …               # dump / trace / run-to-PC

node tools/mkagc.js <image> …       # pack an image and its settings into an .agc
node tools/mkagc.js a.dsk --diff=b.dsk    # ...with the difference as patches

node tools/tone.js "3,12,0" 16      # RISE OUT's PLAY500 handler on a bare machine
python3 tools/mkirqtest.py [out]    # the cross-emulator interrupt & sound test
python3 tools/build_roms.py --data <dir>
```

`tools/vectors.js` is the fast layer: pure functions, no machine, no disk, under
a second. `videoSel7`/`videoSel9` against a hand-transcribed table, `Mem7`
against the decode tables, the AIM checksum against sectors pulled from a real
`.aim`, `gcr140` against compiled `dsk2nib`, `AGAT.sniff` against the size
census, and a font case asserting glyph `$C1` renders correctly at `m0 = $80`.

The `.agc` cases pin what a hand-written container may rely on — the line width,
a build/parse round-trip, that a patch reaches the payload without touching the
packed copy, that `hex`, `data` and `gz` all say the same bytes and two of them
at once is refused, which of the three the writer reaches for at each size, that
a note left on a patch survives being saved, and that a `hint` survives beside
`notes` and collapses to the one line the panel prints — and the remap cases pin both directions of it at once: `W`
sending `$DE` in every plane, `$5E` naming `W` as a route, `$57` losing ЛАТ `W`,
and all three coming back when the remap is dropped.

`kbdmenu` and `urlkeys` are the two commands that test the page rather than
`src/`: each lifts the functions it needs out of `index.html` by name — failing
loudly if one is renamed — and runs them against stub `<select>`s. They are
there because both pieces are about load *order*. The keyboard menu has to hold
a bookmarked control group until the container that names it arrives; the
address has to be written as a difference from a container that is fetched long
after the fragment was read, and every interesting case is a pair — an address
and the container it names — which is exactly what a browser makes tedious to
reach and easy to get wrong. `urlkeys` runs the real loop: a fragment into the
menus, the menus into a machine, a real `.agc` loaded into it, and the machine
back out as a fragment.

`tools/corpus.js` walks a directory of images, infers the model from the path
(`*7a` → 7, `*9a` → 9, as `agat.sh` does), boots each, and emits a Markdown
table. The images stay local and uncommitted; the table is the regression
artifact.

`tools/shot.js` takes `--ram=`, `--psrom=` and `--xram=` in kilobytes for the
same reason, and that is what drives the factory memory test — see
[HARDWARE.md](HARDWARE.md#checking-both-cards-against-the-factory-test). A test
that declares the configuration and then verifies it is worth more than any
number of assertions written from the same reading of the source that produced
the bug.

Its `--mouse=`, `--click=`, `--hold=` and `--move=` do the same job for the
mice, and MouseGraf is the oracle: it draws its cursor's coordinates on screen,
so a run that says `--move=60,40` and comes back with a cursor 60 across and 40
down, with a line behind it where the button was held, has checked the card, the
counts and the buttons in one picture.

**What it does not check is the browser.** Those flags reach into the card and
set `btn` and `move()` directly, which is the whole point headlessly and is also
the seam every browser-side bug hides behind: pointer capture, the scale taken
off the canvas, which host button is which, and whether a click reaches the
machine at all. `tools/vectors.js` drives `attachMouse` against a stub DOM,
which catches a typo and nothing else — it cannot tell you that swallowing the
first click leaves MouseGraf looking dead, because the stub has no MouseGraf
behind it. Anything about the page itself has to be tried in a page.

`corpus.js` takes `--ram=` and `--nocards` too, which is how a table that has
moved gets attributed. Run it at the old size and diff: if the old table comes
back exactly, what changed was the default and not the emulator, and the images
that lost their picture are the images that want more memory than the machine
they were given.

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
