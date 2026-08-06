# agat-web

An **Agat-7 / Agat-9** emulator in the browser. Drop an `.aim`, `.dsk`, `.nib`
or `.fil` file on the screen and it runs.

**[Run it now](https://amaltsev.github.io/agat-web/)** — the current `main`,
hosted, examples included.

Or clone and open `index.html`. No build step, no dependencies, no server —
plain `<script>` tags and everything it needs is in the repository.

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
| `.aim` | tagged track images, 840K, 160 × 6464 16-bit words — data byte plus attribute |
| `.dsk` | sector images, 140K and 840K, with or without the "Agathe" header |
| `.nib` | nibble images, 140K (35 × 6656) and 840K (160 × 21 × 282) |
| `.fil` | a single program with its DOS 3.3 catalogue entry, poked straight into memory |
| `.agc` | an Agat Container: one of the above plus the machine and keys it wants |

**Boot** is `PR#N` — restart from the disk. **Reset** cold-starts into the
machine's own monitor, which is where you land with no disk in.

Keys go through the Agat's own scancode table, so **ЛАТ/РУС** switches to a
JCUKEN layout and Cyrillic comes from where a key sits, not from what your host
keyboard types.

**Keyboard** draws that mapping instead of leaving you to guess it: the Agat's
own board, or the PC keys the table maps, with the cap your keypress reaches lit
up and `$C000` shown underneath. Switching ЛАТ/РУС moves the lit cap and greys
out what the other layout can no longer type — РУС cannot reach `' , / ;` and
ЛАТ cannot reach `Ю`, `Ч` or `Ъ`. Caps can be clicked, so a key your host will
not send is still reachable. Hovering one names every host key that reaches it.

Pick the **machine and RAM size** to match your disk: the Agat-7 shipped in
three sizes and software can tell, because the RAM size masks the video mode
register's page field. The default is an Agat-7 with 64K. A filename containing
`7a` or `9a` picks the machine for you until you choose one yourself.

Drives: 840K in slot 5 on both machines, 140K in slot 6 on the Agat-9 and slot 3
on the Agat-7. A dropped image goes to whichever drive can read it.

Each drive has a **lamp** in the bar: dim while its motor line is up, bright
while bytes are reaching the CPU, with the track its head is on beside it. Disks
of this era take their time — a boot can be ten seconds of reading — and the
lamp is what tells that apart from a hang.

The **⚙** holds the settings a machine is run under rather than driven by: the
volume, and two selectors for the **video interrupt**. The default, `raster`, is
the hardware as measured off real boards — a level whose edges are raster lines,
which sets its own rate and so greys the rate selector out. The other two are
agat-emulator's readings of it, kept for comparison. See
[HARDWARE.md](HARDWARE.md#the-delivery-model). They only matter for software
that sequences sound on the interrupt count, where they set both the pitch and
the tempo — an octave apart between `held` and `raster`.

Every one of those settings rides in the address, so a machine that runs a
program properly is a bookmark:

    index.html#model=7&ram=64&irq=raster
    index.html#model=7&ram=128&irq=held&rate=500

`model` is 7 or 9, `ram` is 32, 64 or 128 (Agat-7 only — the Agat-9 is always
128K), `irq` is `raster`, `held` or `pulse`, and `rate` is the sub-frame
interrupt in Hz, which only the last two obey. A machine named in the URL is
treated as chosen, so a `7a`/`9a` filename does not override it.

`agc=` names a container, which carries the file itself:

    index.html#agc=examples/rise-out.agc

A container is fetched, so this needs a served page. It is applied first and the
other keys after it, so `#agc=…&model=9` still tries the program on the other
machine.

## `.agc` — the Agat Container

Knowing how to run an old program is more than having its disk: which machine,
how much RAM, which interrupt model, and which host key sends the byte it reads.
An `.agc` is all of that in one JSON file, which the page takes like any other.
The format is written up field by field in [AGC.md](AGC.md), and in Russian in
[AGC.ru.md](AGC.ru.md).

```json
{
  "agc": 1,
  "title": "RISE OUT",
  "author": "Andrew Maltsev",
  "date": "1989",
  "url": "https://…",
  "machine": { "model": 7, "ram": 64 },
  "quirks":  { "irq": "raster", "rate": 0 },
  "keys":    { "KeyW": { "code": "^", "note": "Shoot right" } },
  "media": [ { "name": "rise-out.dsk", "data": ["…base64…"] } ]
}
```

`keys` is the **keyboard remap**, and it is what makes a game with awkward
controls playable: `^` is `$5E`, four keys away in ЛАТ and under a Shift, and
this puts it on W in both layouts and under any modifier. A code may be written
as the character itself, as `$5E`, or by name (`Up`, `Enter`, `Esc`, `F1`), and
the short form `"KeyW": "^"` works where there is nothing to say about it.

The `note` is the useful half. The on-screen keyboard reads the remap the same
way it reads the shipped table, so the cap lights on a keypress and hovering `^`
reads **W (Shoot right)** — which is the question someone in front of an
unfamiliar game actually has.

`date` is **text**, not a number: what is known about an old program is as often
`"circa 1985"` or `"1990-92"` as it is a year.

`media[].data` is plain base64 in short lines, and the payload is the image
**as it was found**. Anything changed goes in `media[].patches` as
`{ "at": 45312, "hex": "A9 60 85 84" }`, applied after decoding — so a container
carries a pristine copy of what it came from and the change stays legible.

`title`, `author`, `date`, `url` and `notes` are for the record — often the
container is the only place left that says who wrote a program and when.
Nothing but `agc` and `media` is required.

**Save .agc** writes one out from the machine as it stands: what is in the
drives, the model and RAM, both interrupt settings and the live remap. It asks
nothing. A container that was loaded from a file keeps its own title and
filename; one made from a bare image takes the image's name for both, so
`irqtest.dsk` saves as `irqtest.agc` titled `irqtest.dsk` — rename it
afterwards if it deserves better. From the command line:

```sh
node tools/mkagc.js game.dsk --title="…" --author="…" --date=1989 \
  --model=7 --ram=64 --irq=raster --key="KeyW:^:Shoot right" > game.agc
```

`--diff=<patched image>` works out the patches by comparing, and `--patch=AT:HEX`
states one directly.

### Examples

`examples/` holds two of Andrew Maltsev's own games, included with his
permission: **ПИТОНЧИК / Snake** as a `.fil`, and **RISE OUT** as a 140K disk.
Each is bundled as an `.agc` alongside the original image, so it comes up on the
machine it wants. The links on the page need a served copy — `fetch` is blocked
on `file://` — so they work on the
[hosted build](https://amaltsev.github.io/agat-web/), and from a local
file use **Open…** instead.

`examples/irqtest.dsk` is an interrupt and sound test, and it is meant to be run
under **other** emulators too — it is a bootable 140K disk because every Agat
emulator boots one, and it installs its handler through the monitor so it needs
no particular slot configuration. It flips the speaker every *n* interrupts for
exactly 1000 interrupts, then is silent for 500, for *n* = 1, 2, 4, round and
round. Both pitch and duration derive from the interrupt alone, so it reports
the rate *and* whether the counting matches. Here it gives three brief tones near
7400, 3950 and 2050 Hz — the carrier is the handler's own length, so those hold
under any level model — with the whole round taking about 0.7 s under `raster`
and a sixth less under `held`. Three leisurely one-second tones at 500, 250 and
125 Hz instead mean the IRQ is being treated as an edge, which is exactly what
the `pulse` model gives.

---

## Documentation

| | |
|---|---|
| [AGC.md](AGC.md) · [AGC.ru.md](AGC.ru.md) | the `.agc` container, field by field — in English and in Russian |
| [HARDWARE.md](HARDWARE.md) | the machine as emulated — memory models, video modes, interrupts, floppy formats, and where each detail was transcribed from |
| [DESIGN.md](DESIGN.md) | the JavaScript — module map, the bus, the render and audio pipelines, the run loop, the test tools |
| [CLAUDE.md](CLAUDE.md) | the short version: constraints, what to run before believing a change, what is settled and what is not |
| [ROMS.md](ROMS.md) | the bundled ROMs and where they came from |

## What is not there

Disk **writing** — images are read-only and the write-protect bit says so.
Several Agat-9 system disks print «СИСТЕМА ИСПОРЧЕНА» as a result.
Also absent: the Agat-7 ДопОЗУ extra-RAM card, NTSC artefact colour for the
Apple modes, 80-column and Apple //e modes, mouse, printer and tape.

## Development

```sh
node tools/vectors.js               # pure-function tests, about a second
node tools/check.js modules         # index.html vs tools/modules.js
node tools/cputest.js               # Klaus Dormann 6502 functional test
node tools/check.js boot <image>    # boot and report where it got to
node tools/shot.js <image> [keys]   # boot, send keys, write a PNG
node tools/mkagc.js <image> …       # pack an image and its settings into an .agc
```

Every tool takes an `.agc` wherever it takes an image, and runs it on the
machine the container names.

The full list, and what each one is for, is in
[DESIGN.md](DESIGN.md#tools-and-testing).

## Credits

This emulator is a transcription more than an invention. Almost nothing in it
was worked out from first principles — it was read out of other people's work,
and it would not exist without any of the following.

- **Agat Emulator** by NOP — <https://sourceforge.net/projects/agatemulator/>,
  GPLv2. The reference for nearly every hardware detail: the two memory maps
  (`baseram.c`), the video modes and painters (`videoprocs.c`, `videosel7.c`,
  `videosel9.c`), both floppy controllers (`fdd.c`, `fdd1.c`) and the sector
  encoders (`dsk2nib.c`, `dsk2hfe.c`). The keyboard's scancode table is its
  shipped `keyb/default.bin` emitted verbatim, and the undocumented-opcode set
  is checked against its `cpu/cpu6502.c`. The bundled ROMs, character
  generators and palette are from its data package.
- **AgatF** by Ravodin & co. — the second reading of the same hardware, and the
  source of the same five ROMs under different names, byte-for-byte identical.
  See [ROMS.md](ROMS.md) for both, with checksums.
- **agatcomp.ru** — the hardware archive, and the source of two things measured
  rather than inferred. The [clock-frequency page][clocks] reports 19.97093 ms
  between frame interrupts, averaged over six boards with a calibrated Ч3-63
  counter, which is what pins the raster at 312 lines of 672 clocks. And the
  on-screen keyboard is transcribed from its [photograph of the Клавиатура][kbd],
  which is what settles that a keycap is a *code* rather than a scancode.
- **The Agat hardware replica project** — <https://agat-hardware.sourceforge.io/>.
  Running its PROM images through the Agat-9's video state machine is how the
  312-state cycle and its 39 interrupt lines were established.
- **Klaus Dormann's 6502 functional test** —
  <https://github.com/Klaus2m5/6502_65C02_functional_tests>. `tools/` bundles a
  built `6502_functional_test.bin`; the source project is published under GPLv3.
- **The 6502 opcode matrix at** <https://www.oxyron.de/html/opcodes02.html> — the
  undocumented opcodes and their addressing modes, by way of agat-emulator's
  transcription of it.

Where a transcription is subtle the source file is named in a comment, so a
disagreement is a lookup rather than an argument.

[clocks]: https://agatcomp.ru/agat/Hardware/useful/clock.shtml
[kbd]: https://www.agatcomp.ru/agat/Hardware/Key_Joy/KeyClassic/kbd15.jpg

## Licence

MIT for the emulator, see [LICENSE](LICENSE). Three sets of bundled files are
not ours and are not MIT: the ROMs, character generators and palette in
`roms/roms.js` — see [ROMS.md](ROMS.md) — the example programs in `examples/`,
and `tools/6502_functional_test.bin`, which is built from Klaus Dormann's
GPLv3 test sources. None of the three is part of the emulator itself; the test
binary is read by `tools/cputest.js` and never ships to the browser.
