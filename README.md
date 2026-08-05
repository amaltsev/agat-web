# agat-web

An **Agat-7 / Agat-9** emulator in the browser. Drop an `.aim`, `.dsk`, `.nib`
or `.fil` file on the screen and it runs.

Open `index.html`. No build step, no dependencies, no server — plain `<script>`
tags and everything it needs is in the repository.

The Agat was a Soviet school micro of the mid-1980s, Apple II-adjacent but not
an Apple II: a 6502 and some familiar soft switches, wrapped around genuinely
different memory banking and a video controller with its own set of modes.

---

## Using it

Drag a file onto the screen, or use **Open…**. Formats are recognised **by
size, not by extension** — Agat images in the wild are routinely misnamed, and
one of the system disks in circulation is called `.800.dsk` while actually being
an `.aim`.

| | |
|---|---|
| `.aim` | flux-level 840K images, 160 × 6464 16-bit words |
| `.dsk` | sector images, 140K and 840K, with or without the "Agathe" header |
| `.nib` | nibble images, 140K (35 × 6656) and 840K (160 × 21 × 282) |
| `.fil` | a single program with its DOS 3.3 catalogue entry, poked straight into memory |

**Boot** is `PR#N` — restart from the disk. **Reset** cold-starts into the
machine's own monitor, which is where you land with no disk in. Keys go through
the Agat's own scancode table, so **ЛАТ/РУС** switches to a JCUKEN layout and
Cyrillic comes from where a key sits, not from what your host keyboard types;
software reads which layout is live at `$C063`.

Drives: 840K in slot 5 on both machines, 140K in slot 6 on the Agat-9 and slot 3
on the Agat-7. A dropped image goes to whichever drive can read it.

### Examples

`examples/` holds two of Андрей Мальцев's own games (Орёл, 1988-89), included
with his permission: **ПИТОНЧИК** as a `.fil`, and **ПУТЬ К ВЕРШИНЕ / RISE OUT**
as a 140K disk. The links on the page need a served copy — `fetch` is blocked on
`file://` — so from a local file use **Open…** instead.

---

## The two machines

They differ in more than a badge, and picking the wrong one shows.

**Agat-9** — 128K in sixteen 8K banks. The 64K the CPU sees is eight windows,
each pointed at a bank by a register at `$C100-$C1FF` that is *addressed* rather
than written: a store to `$C1nv` sets window `n` to bank `v`, the value riding in
the address. `$D000-$FFFF` is paged by `$C080-$C08F` — a write switches, a read
only reports — and the 2K monitor is mapped as 4K, mirrored across `$F000-$FFFF`.
It is the only one of the two with the Apple-compatible video modes.

**Agat-7** — 32/64/128K in 16K banks through three windows, with the bank
register at `$C0F0-$C0FF` (also taking its value from the address, on reads as
well as writes). ROM is 2K at `$F800-$FFFF` and *not* mirrored. **The RAM size is
visible to software**, because it masks the page field of the video mode
register — so set it to match your disk.

Base RAM stops at `$BFFF`, so an **ЭмПЗУ card** is fitted in slot 2 to put RAM
behind `$D000-$FFFF`. Plenty of Agat-7 software needs it: RISE OUT keeps its
character generator at `$D000`, its black-and-white splash at `$D800` and its
disk driver at `$E000`, and without the card all of that is written into a void
— the game loads, animates its colour title, and then shows an empty screen.

## Video

The mode register is `$C700-$C7FF` on both machines, value taken from the low
byte of the address. The native raster is 512 × 256.

| mode | | |
|---|---|---|
| Text 32×32 | both | character + attribute pairs; bit 5 forces normal, bit 3 flashes |
| Text 64×32 | both | no attributes; the Agat-7 also has an inverse variant |
| 64×64×4 | Agat-7 | 16 colours, high nibble is the left pixel |
| 128×128×4 | both | |
| 256×256×1 | both | |
| 256×256×2 | Agat-9 | 16K, interleaved: low 8K even scanlines, high 8K odd |
| 512×256×1 | Agat-9 | same interleave |
| Apple text / lores / hires | Agat-9 only | 280×192, mono |

Video interrupts are two independent timers: 20000 µs between frames (NMI) and
that divided by 20 on the Agat-7 or 40 on the Agat-9 between sub-frame ticks
(IRQ). They are *not* one counter: the tick that coincides with a frame raises
both. Software arms them at `$C04x` and disarms at `$C05x` on the Agat-7 or
`$C02x` on the Agat-9 — different addresses on the two machines. `$C019` reads
the vertical-blank flag in bit 7.

The sub-frame rate matters more than it looks, because software sequences sound
on it. RISE OUT has two players: `PLAY` busy-waits in a cycle-counted delay
loop, used only for the reset and reboot beeps, while every sound in the game
proper goes through `PLAY500` («МУЗЫКА В ПРЕРЫВ.») — avoiding a busy-wait was
the point, so that sound never stutters the animation. Its handler flips `$C030`
once every *n* interrupts, where *n* is the note's period byte:

```
30E3: DEC $81        ; tick down the note period
30E5: BNE $30F2
30E7: STA $C030      ; flip the speaker
30EC: LDA $85        ; reload the period
30EE: STA $81
```

Two flips make one cycle, so the tone is `IRQ / (2n)` and the note length is
`$82 × $84` interrupts. **The interrupt rate is therefore the pitch and the
tempo**, and it is disputed. agat-emulator sets the sub-frame timer to
`1000000 / 50 / 20` = 1000 CPU cycles and decrements it in whole cycles, so
under that emulator it is 1 kHz — at which `PLAY500`'s fastest note, *n* = 1, is
500 Hz, which would be where the routine gets its name. RISE OUT's author
remembers the hardware interrupt itself being nearer 500 Hz, which would make
that note 250 Hz. The difference is an octave, so the rate is a control on the
page rather than a constant in the source; `agat.setSubFrameHz(hz)` does the
same from the console.

`tools/tone.js` runs that handler, hand-assembled, on a bare machine, which is
how the timing here was checked: interrupts land 1019/1022 cycles apart, a note
lasts exactly `$82 × $84` of them, and the speaker flips every `$81`. For the
table `3,12 / 4,8 / 2,16` at `$84 = 16` that is 144 ms and 14 flips — tones of
41.7, 62.5 and 31.25 Hz, which is to say not tones at all but a short crunch.

`$84` is worth watching. It is not initialised by `PLAY500` itself, so if it is
ever 0 when a sound starts, `DEC $83` wraps and every unit becomes 256
interrupts instead of 16 — the same table then runs for a second and a half.
`agat.recordSound(3)` captures the flips during real play and
`agat.soundReport()` groups them into notes with their frequency, length and
period in interrupts, and reports the values `PLAY500`'s zero page held while
recording.

For the same reason the run loop is driven by the wall clock rather than by
`requestAnimationFrame`: a 50 Hz frame budget issued at a 60 Hz refresh runs the
machine 20% fast, and at 120 Hz twice that.

Two things worth knowing if you read the code. The video controller scans
**physical** RAM and does not go through the CPU's bank windows — a page number
reaches `$1E000`, well past the 64K the CPU can see at once. And the glyph bit
window belongs to the font: Agat-7 characters live in bits 7..1, Agat-9 in bits
6..0, so font and mask always travel together.

## What is not there

Disk **writing** — images are read-only and the write-protect bit says so.
Several Agat-9 system disks print «СИСТЕМА ИСПОРЧЕНА» as a result.
Also absent: the Agat-7 ДопОЗУ extra-RAM card, NTSC artefact colour for the
Apple modes, 80-column and Apple //e modes, mouse, printer and tape.

---

## Development

```sh
node tools/cputest.js               # Klaus Dormann 6502 functional test
node tools/vectors.js               # pure-function tests, about a second
node tools/check.js modules         # index.html vs tools/modules.js
node tools/painters.js              # each video mode from a synthetic pattern

node tools/check.js boot   <image>  # boot and report where it got to
node tools/check.js io     <image>  # $C0xx histogram
node tools/check.js sniff  <file…>  # what the sniffer makes of each
node tools/shot.js <image> [keys]   # boot, send keys, write a PNG
node tools/corpus.js <dir> --md     # walk a directory, boot everything

python3 tools/build_roms.py --data <dir>   # regenerate roms/roms.js
```

`tools/modules.js` is the single ordered module list; `index.html` and the Node
harness both come from it, and `check.js modules` asserts they agree. Everything
in `src/` is plain ES5 in one global namespace, so the same files run in the
browser and under Node with no packaging.

The reference for nearly every hardware detail is **Agat Emulator** by NOP
(<https://sourceforge.net/projects/agatemulator/>, GPLv2) and **AgatF** by
Ravodin & co. Their ROMs are bundled here; see [ROMS.md](ROMS.md). Where a
transcription is subtle the source says which file it came from — `baseram.c`
for the memory maps, `videoprocs.c`/`videosel7.c`/`videosel9.c` for the video,
`fdd.c`/`fdd1.c` for the controllers, `dsk2nib.c`/`dsk2hfe.c` for the sector
encoders, `keyb.c` for the keymap.

## Licence

MIT for the emulator, see [LICENSE](LICENSE). The ROMs and the example programs
are not ours — see [ROMS.md](ROMS.md).
