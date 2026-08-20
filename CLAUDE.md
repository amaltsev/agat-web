# agat-web

A browser emulator for the Soviet **Agat-7 / Agat-9** micros. Drop an `.aim`,
`.dsk`, `.nib`, `.fil` or `.agc` file on the page and it runs.

- [README.md](README.md) — what it is and how to use it
- [HARDWARE.md](HARDWARE.md) — the machine as emulated, and where each detail came from
- [DESIGN.md](DESIGN.md) — the JavaScript: module map, bus, video, audio, tools
- [AGC.md](AGC.md) — the `.agc` container format, field by field

## Hard constraints

**No build step, no dependencies.** Opening `index.html` from a checkout must
work. Do not introduce npm, a bundler, TypeScript, or a CDN link.

**`src/` is ES5 in one global namespace.** `var`, `function`, IIFEs hanging
things off `AGAT`. No `let`/`const`, arrow functions, classes, template literals
or modules — the same files are evaluated by Node in `tools/harness.js`, and
that is what lets every tool test the shipping code. `tools/` may use modern
Node freely; it never ships.

**`tools/modules.js` is the single ordered module list.** Adding a file to
`src/` means adding it there. `node tools/check.js modules` asserts `index.html`
agrees, and it catches the "works in Node, blank page in the browser" bug that is
otherwise very easy to create.

**The English is US English** — color, behavior, catalog, gray — with Russian
terms interspersed freely where they are the thing's own name (ЭмПЗУ, ЛАТ/РУС,
НГМД, табл.).

## Before saying something works

```sh
node tools/vectors.js          # pure-function tests, ~1s
node tools/check.js modules    # index.html vs the module list
node tools/cputest.js          # Klaus Dormann; slow, run on CPU changes
```

Anything touching video, disks or timing should also be exercised headlessly —
`tools/check.js boot <image>`, `tools/shot.js`, `tools/tone.js`,
`tools/corpus.js` — before opening a browser. If a claim about behavior can be
measured, measure it; several confident conclusions in this project's history
were wrong and the measurement is usually cheap.

## Things that are settled, and things that are not

Settled, with evidence, and expensive to relearn:

- The video controller scans **physical** RAM, never the CPU's bank windows —
  and on the Agat-7 only the *base* RAM. Neither memory card is ever a display
  page: `agat-emulator` calls `vid_invalidate_addr` from `baseram.c` and from
  neither `xram7.c` nor `psrom7.c`.
- The standard Agat-7 is **128K in three devices**, never one setting: 64K of
  base RAM, a 32K ЭмПЗУ in slot 2, a 32K ОЗУ expansion in slot 4. The cards are
  agat-emulator's default complement (`sysconf.c:72-77`, `143-150`); the 64K is
  the factory manual's, ФгЗ.032.002 ТО4 табл.1 — блок системный ФгЗ.038.650,
  "ОЗУ — 64К байт" — against agat-emulator's own 32K, which is a choice in its
  configuration dialog (`sysconf.c:303-306`) rather than a fitting ТО4
  describes. §2.1 gives 32K as the *minimum*.
- The Agat-7 has **six I/O slots, not seven**: ТО4 табл.9 gives X1-X7 the pages
  `$C100-$C600` and `$C090-$C0EF`, and the board spends the seventh slot's
  `$C080+16n` page on the base RAM bank register at `$C0F0-$C0FF` instead. That
  register has to be decoded *before* the slot range or an empty slot 7 eats it.
  At 32K of base RAM it **is not fitted** (`baseram.c:573`) and `$8000-$BFFF`
  belongs to the expansion card or to nobody.
- The ОЗУ expansion powers up **deselected** (ТО4 §3.4.4: "после включения
  питания всегда происходит автоматическая установка нулевого слова состояния"),
  so it is never what a program finds at `$8000-$BFFF` at reset. Software that
  simply expects RAM there wants base RAM, which is why 32K of it is the wrong
  default and not a card-selection bug to be papered over.
- `Machine.PROFILES` is the single definition of what each machine is.
  `App.build()` and `tools/harness.js` both go through it; do not spell a card
  list out anywhere else.
- `examples/TESTOZU7_140.agc` is the factory memory test: it declares a
  configuration and then verifies it, which beats any assertion written from the
  same reading of the source that produced the bug. Its **исполнение is
  0 = 32K, 1 = 64K, 2 = 128K** — it starts at 0, and a probe that starts at 1
  concludes 32K is not a fitting. It is what caught the bank register being
  swallowed by slot 7: `ОШИБКА ВКЛЮЧЕНИЯ БАНКА =F1(F0)`. The menu is in
  [examples/TESTOZU7_140.md](examples/TESTOZU7_140.md).
- The glyph bit window belongs to the font: Agat-7 is `m0 = $80`, Agat-9 `$40`.
- The raster is **312 lines of 672 clocks** of the 10.5 MHz crystal — 15625 Hz
  line, 50.08 Hz frame, 256 displayed and 56 blanked. Both interrupts come off
  that one line counter, and the measured rates follow from it.
- The sub-frame interrupt is the raster's, and the **only** model: 488 Hz on the
  Agat-7 with half the frame asserted, 1953 Hz on the Agat-9 with one line in
  eight, a level rather than an edge in both. agat-emulator's two free-running
  timers were carried here for comparison and are gone; do not reintroduce a
  selectable model. What closed the question was a listening test — RISE OUT's
  **original 1989 sound data**, restored to `examples/` in place of a copy
  retuned in 2026 for a single-tick interrupt, sounds right to its author under
  the raster, and the two corrections were arrived at independently.
- Image formats are identified **by size, not extension**.
- On the 140K drive, **write mode stops the rotation clock**: the head moves one
  byte per byte written, never one per 32 cycles. A self-sync `$FF` is 40 cycles
  against a 32-cycle quantum, so a rotating head strands stale gap bytes in the
  sync field. A write lands on the byte *after* `index`, which is where
  `readData` leaves it.
- The Agat-7 has **no** Apple video modes; do not add a fallback to them.
- On the 840K controller a byte written to `+5` lands in the slot **after** the
  one under the head, and the `+8` sync strobe marks **the byte handed over
  last** — the `$FF` a driver writes before it strobes, which the read side then
  discards. Three sources agree (agat-emulator `fdd.c`, agatcomp.ru's
  `fl840k_write.shtml`, the boot ROM at `$C565`) and
  `examples/TESTCOM7_840.agc`'s ТЕСТ 'НГМД' formats, verifies and passes on it. The clock keeps turning in write
  mode; do not carry the 140K's write-driven head over.
- Every sound in RISE OUT proper goes through `PLAY500` on the interrupt, never
  the busy-wait `PLAY`.

**Not settled:** whether more of the Agat-9's interrupt PROM should be modeled.
D63's address carries three mode bits above the line number, so the pattern is
per video mode: only the one-in-eight block matching the measured board is
emulated, and the mode register does not reach it. See
[HARDWARE.md](HARDWARE.md#the-delivery-model).

## Provenance

Nearly every hardware detail is transcribed from **Agat Emulator** by NOP
(GPLv2) and **AgatF** by Ravodin & co. Where a transcription is subtle, the
comment names the source file. Keep doing that — it turns disagreements into
lookups.

The factory documentation — **ФгЗ.032.002 ТО4/ТО5**, part 1 — is the other
source, and the one to reach for when the question is what the machine *was*
rather than what it *did*: fittings, slot assignments, power-on states. It is
typed on a typewriter and contradicts itself in places, so cite the табл. or §
and say when something else disagrees.

The bundled ROMs are theirs, not ours; see [ROMS.md](ROMS.md). The emulator is
MIT. `examples/` holds two of Андрей Мальцев's own games, included with his
permission, and six programs of unknown license from agatcomp.ru — the three
factory tests, Klondike and the two MouseGrafs — kept on the terms README's
license section states.

## Two traps that look like emulator bugs

Both have cost real time here:

- A test 6502 that runs off into unset memory hits `$00` bytes, which are `BRK`,
  which vectors to `$FFFE`. If that points at an interrupt handler you get what
  looks exactly like a storm of spurious interrupts. A wrong stack frame or an
  unset `$FFFA` is enough.
- Writing an interrupt vector to `$FFFE` on an Agat-7 silently depends on an
  ЭмПЗУ card in slot 2. Install through the monitor at `$03FE` instead —
  especially for anything meant to be compared against another emulator.

## Development

Commit on 'main' unless specifically asked to branch.
