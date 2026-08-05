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
- Frame NMI and sub-frame IRQ are **two independent timers**, not one counter.
- Image formats are identified **by size, not extension**.
- The Agat-7 has **no** Apple video modes; do not add a fallback to them.
- Every sound in RISE OUT proper goes through `PLAY500` on the interrupt, never
  the busy-wait `PLAY`.

**Not settled:** how the sub-frame IRQ is delivered. agat-emulator holds the
line for 600 cycles (Agat-7), so a short handler re-enters ~10 times per tick;
the alternative is one interrupt per tick at half the rate. Held is the default
and the author judges it the closer of the two by ear, but RISE OUT's sound is
still not right, so treat this as open. Both the rate and the hold are runtime
controls and the source should not quietly commit to either. See
[HARDWARE.md](HARDWARE.md#the-delivery-model-which-is-not-settled).

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
