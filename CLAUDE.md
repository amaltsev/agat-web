# agat-web

A browser emulator for the Soviet **Agat-7 / Agat-9** micros. Drop an `.aim`,
`.dsk`, `.nib` or `.fil` file on the page and it runs.

- [README.md](README.md) — what it is and how to use it
- [HARDWARE.md](HARDWARE.md) — the machine as emulated, and where each detail came from
- [DESIGN.md](DESIGN.md) — the JavaScript: module map, bus, video, audio, tools

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

## Before saying something works

```sh
node tools/vectors.js          # pure-function tests, ~1s
node tools/check.js modules    # index.html vs the module list
node tools/cputest.js          # Klaus Dormann; slow, run on CPU changes
```

Anything touching video, disks or timing should also be exercised headlessly —
`tools/check.js boot <image>`, `tools/shot.js`, `tools/tone.js`,
`tools/corpus.js` — before opening a browser. If a claim about behaviour can be
measured, measure it; several confident conclusions in this project's history
were wrong and the measurement is usually cheap.

## Things that are settled, and things that are not

Settled, with evidence, and expensive to relearn:

- The video controller scans **physical** RAM, never the CPU's bank windows.
- The glyph bit window belongs to the font: Agat-7 is `m0 = $80`, Agat-9 `$40`.
- The raster is **312 lines of 672 clocks** of the 10.5 MHz crystal — 15625 Hz
  line, 50.08 Hz frame, 256 displayed and 56 blanked. Both interrupts come off
  that one line counter, and the measured rates follow from it.
- In the `held` and `pulse` interrupt models the frame NMI and sub-frame IRQ are
  **two independent timers**, not one counter; folding them drops one IRQ in
  twenty. `raster` has one counter because the hardware does.
- Image formats are identified **by size, not extension**.
- The Agat-7 has **no** Apple video modes; do not add a fallback to them.
- Every sound in RISE OUT proper goes through `PLAY500` on the interrupt, never
  the busy-wait `PLAY`.

**Not settled:** whether `held` and `pulse` can be deleted. `raster` — the
hardware as measured and traced, a level whose edges are raster lines, 488 Hz on
the Agat-7 with half the frame asserted and 1953 Hz on the Agat-9 with one line
in eight — is now the default, and the other two are kept only for comparison
until more software has been heard under it. The evidence so far is that RISE
OUT's **original 1989 sound data** — restored to `examples/`, replacing a copy
retuned in 2026 for the single-tick model — sounds right to its author under
`raster`. Changing models moves its pitch by an octave, so the test is a
listening test. See
[HARDWARE.md](HARDWARE.md#the-delivery-model).

## Provenance

Nearly every hardware detail is transcribed from **Agat Emulator** by NOP
(GPLv2) and **AgatF** by Ravodin & co. Where a transcription is subtle, the
comment names the source file. Keep doing that — it turns disagreements into
lookups.

The bundled ROMs are theirs, not ours; see [ROMS.md](ROMS.md). The emulator is
MIT. `examples/` holds two of Андрей Мальцев's own games, included with his
permission.

## Two traps that look like emulator bugs

Both have cost real time here:

- A test 6502 that runs off into unset memory hits `$00` bytes, which are `BRK`,
  which vectors to `$FFFE`. If that points at an interrupt handler you get what
  looks exactly like a storm of spurious interrupts. A wrong stack frame or an
  unset `$FFFA` is enough.
- Writing an interrupt vector to `$FFFE` on an Agat-7 silently depends on an
  ЭмПЗУ card in slot 2. Install through the monitor at `$03FE` instead —
  especially for anything meant to be compared against another emulator.
