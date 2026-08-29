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

### The installable copy

`manifest.json` and `sw.js` are what make a served copy an app: Chromium offers
Install, the window opens without chrome, and the system hands `.agc`, `.dsk`,
`.aim`, `.nib` and `.fil` to it. The manifest's `file_handlers` claim the types;
`launchQueue.setConsumer` in `index.html` turns the launch into the same
`loadFiles` call a drop makes, one `getFile()` apiece. Nothing in `src/` knows
any of this happened.

`sw.js` answers three ways, by what is asked for:

| | | |
| --- | --- | --- |
| the shell | stale-while-revalidate | the cache answers, the network refreshes behind it |
| `examples/`, and any image | cache-first, filled on use | a disk image does not change under its own name |
| everything else | network | no `respondWith`, so it is as if there were no worker |

The shell is stale-while-revalidate rather than cache-first behind a version
constant because a constant somebody has to remember to bump is the failure this
project would actually hit. A deploy is live on the second load, and the shell
moves as a set. `CACHE`'s name exists to throw everything away by hand, not to
stamp a release.

`SHELL` is `tools/modules.js` in load order, plus the two pages, the sheet, the
ROMs, the manifest and the icons — asserted by `node tools/check.js pwa`, which
also parses the manifest and looks on disk for every icon it names.

Registration is guarded by `location.protocol !== 'file:'`: a worker needs an
origin, a checkout opened by double-clicking `index.html` has none, and that has
to keep working exactly as it does today.

---

## Module map

Load order matters only in that a module's dependencies must already be on
`AGAT` when it is *used*, not when it is defined.

| | |
|---|---|
| `chars.js` | the Agat character set, both ways, and the fold two names are matched on |
| `cpu6502.js` | NMOS 6502. Passes the Klaus Dormann functional test. |
| `mem7.js` | Agat-7 16K window decode |
| `psrom7.js` | Agat-7 ЭмПЗУ card |
| `xram7.js` | Agat-7 ОЗУ expansion card |
| `xram9.js` | Agat-9 ОЗУ expansion card ("Ext. RAM") |
| `videosel.js` | pure `$C7xx` mode decode, `videoSel7` / `videoSel9` |
| `videopal.js` | the monitor color tables, and the Agat-9's four palettes at `$C058-$C05B` |
| `machine.js` | the bus: memory maps, soft switches, slots, interrupt timers |
| `drive.js` | normalized `Media` container, head position, write lock |
| `aim840.js` | DSK840/NIB840 → AIM words, and a written track back to sectors |
| `gcr140.js` | 4-and-4 and 6-and-2 track synthesis, and reading it back |
| `unpack.js` | gzip both ways, and the embedded ROM blobs |
| `agc.js` | the `.agc` container: read, write, base64, gzip, patches |
| `image.js` | sniff and normalize any dropped file |
| `sectors.js` | any of the five encodings as numbered 256-byte sectors, read *and* written |
| `dos33.js` | Agat DOS 3.3: the VTOC, the catalog, the free map, files in and out |
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
| `dosfile.js` | what a DOS file is on the way in and out: the type prefixes, the `.fil`, the `$8D` line endings |
| `basic.js` | an `A` file's tokens, back into the listing the machine prints |
| `disasm.js` | a `B` file's bytes, back into 6502 instructions |
| `dosui.js` | the file manager as a panel, mounted by `edit-dos.html` and by the emulator page |
| `state.js` | the machine as a snapshot: the `.agc` `state` block, both ways |
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
- `saveState()` / `loadState(s)` — the card's own registers, for a snapshot. A
  `Uint8Array` in what `saveState` returns is packed by `state.js`, so a card
  hands back `{ state: 0x80, ram: this.ram }` and never sees base64; `loadState`
  fills that array in place rather than replacing it.

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
opcode the hardware would have run is not a behavior worth reproducing.

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
is what makes re-entrancy fall out naturally rather than needing to be modeled.

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

The 16-entry LUT is a monitor's color table from `videopal.js`: the machine
outputs bare 4-bit codes and the monitor decides what color each is, so there
is a table per monitor — `color16`, `color8`, `color16inv`, `gray`, values and
reasoning in [HARDWARE.md](HARDWARE.md#the-monitor-and-the-sixteen-colors) —
picked in the gear popup, by a container's `machine.monitor`, or by `monitor=`
in the address. `App.setMonitor` repaints without rebuilding the machine.

**Painters iterate over source addresses, not screen coordinates.** Every
`addr → (x, y)` formula therefore keeps the same shape as
`videoprocs.c`/`videosel7.c`/`videosel9.c` and can be compared with them line by
line. This is worth more than it looks when a mode is one pixel out.

The flash timer is driven from CPU cycles, not wall clock, so `tools/shot.js`
output is reproducible.

---

## Disks

Every image format is normalized at mount time into one of two shapes, so no
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

`App.disks` is the other half: every disk the session holds, in the order a
container lists them, each entry the file **as it arrived** —
`{id, name, kind, offset, prodos, bytes, patches, media}` — because nothing else
keeps it. The mounted `Media` is normalized past recognition and Save would
otherwise have nothing to write. Patches are kept beside those bytes rather than
folded into them, so a container that is loaded and saved again is the same file.

The entry owns its `media`, and that is what makes a disk moveable: `mount`,
`unmount` and `place` put one in a drive and take it out again, `diskIn(slot,
drv)` and `mountedAt(entry)` are the two directions of the same question, and a
disk no drive is holding is still in the list and still saved. A machine holds
two disks at the most and a container may carry more.

Which drive a container's medium goes in is `in` (`agc.js` reads it as `mount`),
and on the way out `mountSpecs` writes the fewest of them that reproduce the
arrangement: it replays the load, and any disk the fill order would put
somewhere else is given an `in` and the replay is run again. A container of one
disk therefore says nothing about drives at all.

### Writing goes out the same door

`App.writeBack` is what stands between a written disk and a saved container. The
`Media` a controller writes to is a stream, and what a container should carry
is the image it came from, so every track the drive marked written is decoded
back — through `gcr140.denibblizeTrack` to 16 sectors, or
`aim840.desectorizeTrack` to 21 — and the difference comes out as patches; a
`.nib` or `.aim` source is its own baseline and the patches are simply what
moved (`aim840.toAim` interleaves the two planes back). It reads the entry and
its media and touches neither, which is what lets the tests call it with a
two-field stand-in for an `App`.

The patch list is recomputed rather than added to, and `agc.repatch` is the one
rule for it: an **annotated** record — anything carrying a key beyond its
address and bytes — is somebody's writing and is kept verbatim at the front; a
plain one is a machine's arithmetic and is thrown away, the difference being
taken again against a baseline with the annotated records applied. Appending
instead is what leaves a change and its undo both in the file, two records at
one address that cancel. Moving the kept records to the front is safe in every
order they could have been in, because the recomputed difference is measured
against them and its target is the finished image, so a written byte that lands
on an annotated one still wins and still lands after it. `tools/dos.js` saves
through the same function.

Its one give-up is a track that will not decode. There is then no sector image
for a patch to be a difference from, so the whole stream is saved instead and
the entry is renamed `.nib` (140K) or `.aim` (840K) — which loads again unaided,
because media are identified by size.

The GCR encoder was verified **byte-for-byte against compiled `dsk2nib.c`** over
all 232,960 bytes of a track set. It is one of the project's two exact external
oracles — the other is `tools/goldens`, DOS's own INIT beside the formatter —
and it earned its keep: the 6-and-2 encoder's decrementing double loop
relies on `sind` being an unsigned char in C, and the wrap is load-bearing.

The decoder has no such oracle, so what stands in for one is the encoder: over a
whole real disk, denibblizing has to give back the sector image byte for byte,
and that test rides on the encoder's own chain of trust. It inverts the encoder
by construction rather than by a second derivation — the interleave is unwound
by walking a list of the `(dind, sind)` pairs generated by the encoder's own
loop control, backwards, so the two cannot drift apart.

Track synthesis uses a seeded xorshift, not `Math.random`, so headless runs
reproduce.

### Sectors, and the surgical write

`sectors.js` is the other view of a disk: `read(track, sector)` and
`write(track, sector, bytes)` over any of the five encodings. A controller reads
tracks and a file system reads sectors, and this is the one place that knows
they are the same disk.

The write is the part worth understanding. A `.dsk` is patched in place; a
`.nib` or an `.aim` has **that one sector's data field re-encoded where the
decoder found it**, and nothing else in the track is touched. So the decoders
now report positions as well as bytes — `denibblizeTrack` returns `at[k]`, the
offset of sector `k`'s 6-and-2 field, and `desectorizeTrack` the offset of its
256 data bytes — and `renibblizeSector` and `resectorizeSector` write one back
there, as a ring, since a field may straddle the index.

The alternative — rebuild the track from its sectors — is what `App.writeBack`
does for a drive that has been written to, and it is right there, because the
machine really did rewrite those tracks. Here nothing rewrote them: a file
manager that reformatted a track to delete a file would throw away the gaps, the
sync fields, the index marks and the physical layout of every sector it did not
mean to touch, and on a disk formatted by anything but the standard formatter it
would throw away the disk. Writing an 82-sector file into `Klondike.aim` moves
0.99% of the 2 MB file, all of it inside the sectors written, and the disk still
boots to a pixel-identical screen.

`dos33.js` sits on top of that, and the format it reads is in its own header —
including the two things about the 840K disk that are not Apple's and cost the
most to find: the free map's bit order, and the fact that the map does not fit
in the VTOC and continues in a sector of its own. Between them,
`chars.js`, `sectors.js` and `dos33.js` are the whole of the file system, with
no Node in any of them.

### The file manager, twice over

`dos33.js` says where a file lives. What a file *is* — a `B` file's four bytes
of address and length, an `A` file's two of length, a `T` file's `$8D` line
endings, a `.fil`'s catalog entry glued in front — is one layer up, in
`dosfile.js`, and it is there rather than in the tool because two things need
it. `tools/dos.js` is the command line, `dosui.js` is the panel, and neither
implements any of it: `describe` is what `ls -l` prints and what the panel puts
in a row's length column and under an open row, `pack` is what `put` and **Add file…** both hand to
`Dos33.create`, `unpack` is `get` and the download buttons. Nothing in it
touches `fs` or the DOM.

### A disk with nothing on it

`Dos33.format` writes what INIT leaves behind minus the system: a VTOC, an empty
catalog and a free map. The panel's **Empty** and `dos.js new` are that one
call, so the two produce the same disk.

Nothing about the layout is invented. `tools/goldens` holds track 17 of two
disks that the DOS booting `examples/TESTKOM9_840.agc` INIT'd itself under this
emulator — an 840K one in its own drive, a 140K one in the other controller —
and `vectors.js` compares the VTOC field by field, the catalog chain link by
link and the free map track by track against them, in the only test of the
format that does not run through the code being tested. `check.js dosnew` runs
it the other way: that DOS is handed a disk made here, and catalogs it, saves a
program to it and counts the free sectors before `dos33.js` reads back what it
wrote.

The exceptions the comparison names are the interesting part. Both 140K INITs
seen here — that DOS and БЕЙСИК А7.1 on the hardware — hold sector 0 of the last
track back for something neither of them says, and no disk in the collection has
it held, so the formatter does not copy the reservation.

`dosui.js` draws the catalog into whatever element it is handed and is told,
per disk, whether writing is allowed. Two pages mount it:

- **`edit-dos.html`** opens an image file. Thirteen of the modules and no ROMs
  — no CPU, no video, no machine — which is why the page loads instantly and why
  `check.js modules` asserts its script list is a *subsequence* of the module
  list rather than equal to it. It saves through the File System Access API
  where there is one, so Save writes over the file that was opened, and
  downloads where there is not.
- **the emulator page**, on the `⋯` beside a drive lamp, over the disk in that
  drive.

The second is what the `opts.media` arm of the `Sectors` constructor is for. A
mounted disk has no image file behind it — the `Media` *is* the disk — so
`data` is null, `pack()` returns null, and a write goes straight into the
stream the controller is reading. It also calls `media.markWritten(t)`, which
is what makes `App.writeBack` and the lit **Save AGC** button see the change:
a file deleted from the panel and a file deleted by a program running on the
machine are the same event by the time they reach a save.

The write lock is `setWritable` rather than part of `mount`, because it changes
while the panel is up: the drive's own RO/RW button is right beside the `⋯`
that opened it. `syncLamps` compares the two every tick and pushes the drive's
answer in, so the panel says the same thing as the button whichever end was
used — and setting it redraws without shutting the row that is open, since
unlocking a disk to delete the file you are looking at should leave you looking
at it.

**A running DOS does not need rebooting to see the edit.** Measured rather than
assumed, and the assumption was wrong: Agat DOS 3.3 reads the VTOC and the
catalog fresh for every command rather than holding them from boot. With
`TESTKOM9_840` booted to a `]` prompt, deleting `APTEST2` through a `Sectors`
over the live `Media` moved `CATALOG` from `3076 СВОБОДНО` to `3110` and took
the file off the listing, and a following `SAVE X` allocated two sectors from
the *new* free map — 3109 to 3107 — leaving a coherent disk. So the panel does
not have to warn about a stale catalog. What was not measured is a program with
a file already open, which holds its own T/S list in a file buffer; deleting
that file underneath it is a different question.

The per-file actions expand under the row rather than dropping out of a `⋯`
menu: the strip is where they are, with room for the rename field beside them.
**View** is the one thing that gets a layer, because it is the one whose point
is room — a hex dump is 70 columns wide, a text file is as long as it is, and
the strip lives inside a list that scrolls. It draws into the panel's own root
rather than into `document.body`, since `DosUI` is handed a host element and
does not reach outside it, and it offers five readings of the same file: the
text of a `T` one, the listing of an `A` one, `dosfile.hexdump` over the body,
over the whole stream, or over the body at the address a `B` file loads at, and
that last one disassembled. The editor is inside it,
on **Edit**, for a `T` file.

`hexdump` is in `dosfile.js` rather than in the panel because it is pure — 16
bytes to a line, `chars.glyph` for the text column, so `$E0` reads as `Ю` and a
`$8D` as a dot — which is what lets `vectors.js` test it without a document.

`basic.js` is one of those views: an `A` file is a tokenized program in
Applesoft's format, and this turns it back into the listing. Two things in it
had to be found rather than assumed, and both were:

- **The keyword table is the Agat's.** It is transcribed out of the interpreter
  — `B BASIC` at `$0F00` on `SysImages7a/basint.140.dsk`, keywords at `$10D0`,
  Applesoft's own layout of 107 words from `$80` with bit 7 ending each. Eight
  of the words are not Apple's: `GR=` `TEXT=` `!` `&` `MGR=` `HGR=` `RIBBON=`
  `&`, where Apple has `GR` `TEXT` `HLIN` `VLIN` `HGR2` `HGR` `HCOLOR=`
  `HPLOT`.
- **A variable can be an index into a table saved after the program**, which
  Applesoft has no equivalent of. `$01` and an index stand for a name; the
  table follows the program's `$0000`, in the same bit-7 form as the keywords,
  with `$00` padding in front and a four-byte trailer after. Not every version
  writes one — the Agat-9 factory test does and the Agat-7 one does not — and
  without it a listing shows dots where the variables should be. All thirteen
  `A` files in `examples/` fit it, largest index against table length, and
  `SEDIT` decodes to `CH = ¤24: CV = ¤25`, which are the monitor's own cursor
  cells.

The spelling was measured, not guessed. Both factory-test disks were copied,
their greeting renamed with `dos.js mv` so the disk falls to a `]` prompt, and
the program listed there: `node tools/shot.js c7.agc "LOAD_TESTX~LIST_1690,1720~"`.
The line number takes one space, a token takes one on each side, and a name out
of the table takes one in front — which is what makes
`1690  IF  ST > 0 THEN 1720` come out with two spaces after the number and two
before `ST`. An `!` statement gets a row of its own, as it does on the screen;
its assembler's columns do not.

The listing is the one view drawn as pieces rather than as text, because
`basic.list` has to know where a string starts and where a `REM` swallows the
line in order to read the line at all. Handing those out is free; re-finding
them with a regular expression afterwards would be neither.

`disasm.js` is the sixth: a `B` file is usually code, and a hex dump of code is
the view that says least about it. It is a linear disassembler — from the first
byte forward, one instruction to a row, at the address the file loads at — and
it says so, because nothing on the disk marks which bytes are code. A table, a
message, the byte a routine picks up off its own return address: each is read as
an instruction, and one of them shifts every row after it until the stream
happens to fall back into step.

Its table is the NMOS set, the undocumented opcodes included, since a program
that uses one is exactly the program worth reading — and each of those carries
`ill`, which the panel colors. A run of them is the tell that the disassembly
has walked into data. It is a second copy of what `cpu6502.js` knows, written
the other way round, so `vectors.js` steps the CPU on all 256 opcodes and checks
that each consumed as many bytes as the table claims. `BRK` is the one
deliberate disagreement — the CPU eats the byte after it, and the listing shows
one byte, the way the monitor does.

`check.js dosui` is how it is tested: the real `DosUI` drawn into a stub
document and clicked on, with the assertions against the `Dos33` underneath. It
is the only way to test a module whose every operation is a click on something
it drew, and it catches the gap that matters — a delete that leaves the row on
the screen, a rename that reaches the wrong entry.

---

## The machine as a snapshot

`state.js` writes and reads the `.agc` `state` block — the RAM, the CPU, the
raster counter, every card's registers, both drives' heads. [AGC.md](AGC.md#state--the-machine-as-it-stood)
is the format; this is the one idea it turns on.

**Restore writes into the machine `build()` already made. It never builds one.**
By the time a container's media load, `App.build()` has constructed a `Machine`
from `Machine.PROFILES` and fitted its cards, so putting a snapshot back is
`ram.set(bytes)` and `cpu.pc = …` into that machine.

That is not a shortcut, it is the whole design, because the live machine is a
knot of deliberate aliases and a rebuild would have to reconstruct every one of
them:

| | |
|---|---|
| `machine.cpu.bus === machine` | a reference cycle; `JSON.stringify` throws on it outright |
| `machine.psrom === machine.cards[2]` | one card under two names, and likewise `xram`, `xram9` |
| `machine.rom`, `video.font` | views into the shared `App.roms`, not copies |
| `Palette.cur` | one of four shared module tables, not a copy of one |
| `video.palette` | a shared table in `AGAT.MONITORS` |
| a mouse's `rom` | `roms.mouse.subarray(0x700, 0x800)` — a view sharing a buffer |

Cloning any of those and getting one wrong would be silent. Filling arrays in
place gets none of them wrong, and `Palette.setIndex` exists so that even the
palette comes back as one of the four rather than beside them.

The price is that the machine has to be the right shape first, and `state.fits`
is that check: same model, same base RAM, same card class and size in every
slot, both ways round. It is synchronous and returns the sentence saying why not,
which is also what makes `#agc=game.agc&model=9` do something sensible — the
address asks for a machine the snapshot is not about, so the container boots and
the status line says so. One mechanism, not two.

What is **not** in a snapshot is as deliberate: the speaker's queue, the pointer
capture, the wall clock and the diagnostics counters are the page's rather than
the machine's and resynchronise by themselves; the disk is carried by the
medium's patches, as it is in any container, so a restored drive finds the disk
it was reading and saving twice gives the same file. `Video` has nothing to save
at all — `flash` is recomputed from `cpu.cycles` each `render()`, `idx` and
`pixels` are scratch, and `width`/`height` are set by the painter.

`cycles` is saved as it stands rather than rebased to zero, because every other
timestamp in the machine — the next raster line, both drives' byte clocks, the
«Марсианка»'s step timer — is an absolute value on that one scale.

`node tools/check.js state <image>` is the oracle: it boots a machine, runs it,
saves it, restores into a second, and then runs **both** the same distance again
and requires them to still agree on the clock, the screen and every byte of RAM.
Two machines that agree at the moment of the restore and drift a second later is
exactly the failure this can have, and nothing cheaper catches it.

---

## Audio

There is one bit of audio hardware, so the pipeline is short: `Machine` records
the CPU cycle of every `$C030` access into `speakerEdges`, and once per frame
`Speaker.play(edges, from, to)` walks them in order, holding the level between
edges, and queues one buffer.

Two things in there are not optional.

**A DC blocker.** A speaker cone cannot hold a displacement — driven to one side
and left there it springs back to center. Without the filter, a sound effect made
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
- **Caps gray out per layout.** A legend is `near` if some host key reaches it
  now, `far` if only the other layout does, `dead` if none ever does. РУС
  cannot type `' , / ;`; ЛАТ cannot type `Ю`, `Ч` or `Ъ`.

`attachKeyboard` goes on `window`, so it sees every key on the page and
`preventDefault`s the ones the machine takes. `typingInto` is what keeps that
from eating a panel's rename field or its text editor: an `input`, a
`textarea`, a `select` or anything `contenteditable` owns its own keys. A
`button` does not — clicking one leaves it focused, and the machine has to go
on taking keys after somebody has pressed Pause.

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
the single answer to "which key sends this". The board then grays ЛАТ `W` and
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
host key at all. РЕГ and УПР are one-shot latches, since a pointer cannot hold a
modifier and press a key at once, and УПР is where the cap's byte is not its own:
`ctrlCode` folds `$40-$5F` to `$00-$1F` — the encoder's own relation, and
`capCode` backwards — so УПР+К sends `$0B` and УПР+Ш the `$9B` РЕД also sends.
It takes precedence over РЕГ, as `planeFor` reads the modifiers on the host. `tools/vectors.js` asserts the transcription both ways — no
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
↑ over ↓. The last row left in a block has no indent at all: an indent holds a
row against the rows around it, and there is nothing above Snake's space bar to
hold it against.

**ПРОБЕЛ grows into what is left over.** Nine units on a row of their own are the
widest thing on the winnowed board, and every other cap was sized down to make
room for them. `uw` in the table is where it starts instead — half the machine's
width — and `size()` hands it whatever the widest row in its block leaves over,
never more than its machine width. So it reaches the end of the letters where
there are letters, is the whole block where it is the only row left, and is the
machine's own nine units on a board with nothing winnowed away. Snake's board
went from 31.5 units of width to 19.0 that way, which on a 366px phone is a 41px
cap instead of a 25px one.

The board is then sized off its own measured width in ems, the one number the
stylesheet cannot know: what is left depends on the container. Rounded up, with a
tenth of an em to spare — the board is a flex row of blocks, and a divisor a
hundredth short of the measure puts the last block on a line of its own, which
for Snake is the arrows under the space bar rather than beside it. The 26px
ceiling is what keeps a two-key board from being drawn as two enormous keys.
`check.js keys` prints every row's laid-out width and then the measure beside the
divisor, since a wrapped block and a stretched cap both draw exactly like the
ones that are not.

The winnowing is redone on every `refresh()`, since a key declared as-is is a
different cap in ЛАТ than in РУС. With no container loaded there is nothing to
winnow by and every cap it has is drawn; the menu carries the option only while
something names keys or controls, and on a handheld a container that names them
opens with it. The entry ships in the static markup, so an address naming it is
answered before any container is — and `syncKbd` hands the board back to
`wantKbd` when it takes the entry out, or a bookmarked `kbd=used` would be spent
on a menu that has not got the file yet. `node tools/check.js keys <file.agc>` draws the same board in a
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
graying the rest.

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

**Pausing is that loop not being scheduled**, and nothing else: `cpu.cycles`
stops advancing, and every timestamp hung off it — the next raster line, both
drives' byte clocks — stays where it was. `start()` zeroing `lastTime` is what
makes coming back cheap: the first frame after a minute's pause takes its usual
20 ms rather than a minute of catch-up.

`App.paused` is separate from `running` and **sticky**, because every path that
touches the machine calls `start()` on its way out — `build()`, `loadOne()`,
`reset()`, `boot()` — and a pause any of them undid would be a pause that never
lasted. So `start()` refuses while it is set, and what clears it is only the
things that mean *run this*: the button, Boot, Reset, and a file arriving. The
gear's settings deliberately do not; resizing a card is not an instruction to
run.

The Save AGC panel takes the same hold while it is open, so a snapshot is of the
moment the button was pressed rather than of wherever the program got to while
the box was being read. It gives the hold back only if it took it — a machine
already paused by hand stays paused when the panel closes.

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
node tools/check.js modules         # the pages vs tools/modules.js
node tools/check.js kbdmenu         # the page's keyboard menu, load order and all
node tools/check.js urlkeys         # the page's address, around the whole loop
node tools/check.js dosui           # the file manager, over a stub document
node tools/check.js dosnew          # a disk formatted here, given to a real DOS
node tools/painters.js              # each video mode from a synthetic pattern

node tools/check.js boot   <image>  # boot and report where it got to
node tools/check.js io     <image>  # $C0xx histogram
node tools/check.js sniff  <file…>  # what the sniffer makes of each
node tools/check.js keys   <.agc>   # the controls panel and the winnowed board
node tools/check.js write  <image> --keys=…    # boot unlocked, say what was written
node tools/check.js state  <image>  # save the machine mid-run, restore it into a
                                    # fresh one, and run both on
node tools/shot.js <image> [keys]   # boot, send keys, write a PNG
node tools/shot.js <image> --mouse=nippel --click=R --hold=L --move=60,0
                                    # ...and drive a mouse over it
node tools/corpus.js <dir> --md     # walk a directory, boot everything
node tools/debug.js …               # dump / trace / run-to-PC

node tools/agc.js make <image> …    # pack images and their settings into an .agc
node tools/agc.js make a.dsk --diff=b.dsk # ...with the difference as patches
node tools/agc.js info  <.agc>      # what one holds
node tools/agc.js edit  <.agc> …    # change what it says
node tools/agc.js get   <.agc> …    # media out of it, as files
node tools/agc.js add|rm <.agc> …   # media into it, media out of it
node tools/agc.js merge <.agc>      # patches folded into the image

node tools/dos.js ls    <image>     # the catalog of a DOS 3.3 disk
node tools/dos.js get   <image> NAME [out]     # a file off it, as a .fil
node tools/dos.js put   <image> FILE [NAME]    # a file onto it
node tools/dos.js tget  <image> NAME           # ...as UTF-8 text
node tools/dos.js rm|mv <image> …   # delete, rename
node tools/dos.js new   <file> [140|840]       # a formatted disk with nothing on it

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

**The stub scope is the maintenance cost, and it is easy to underpay.** Lifting
the page's functions means re-declaring every page variable they touch and
building the App with every argument `index.html` builds it with — so *adding* a
control to the page breaks these two as surely as renaming a function does, and
adding one is the far commoner edit. The two ways it goes wrong are not equally
loud. Miss a variable and the command dies on a `ReferenceError` before its
first assertion: one bare line, no pass/fail count, which reads like less than a
failed test and invites being skimmed past. Supply the variable but not the App
argument and it goes green while standing for a machine the page does not build.
The monitor menu managed both.

So `open()` mirrors `index.html`'s own `new AGAT.App({…})` argument for
argument, and a stub `<select>` is built from the table the page's own menu is
built from — `Object.keys(AGAT.MONITORS)` for the monitor — which makes a value
added there a value the test already offers. Neither is a formality: the second
kind of failure is silent, and only the first announces itself at all.

`tools/corpus.js` walks a directory of images, boots each on the machine
`--model` names — the Agat-9 unless it says otherwise — and emits a Markdown
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
