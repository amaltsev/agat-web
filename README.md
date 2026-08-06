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
while bytes are reaching the CPU. Disks of this era take their time — a boot can
be ten seconds of reading — and the lamp is what tells that apart from a hang.

The two remaining selectors are for the **video interrupt**. The default,
`raster`, is the hardware as measured off real boards — a level whose edges are
raster lines, which sets its own rate and so greys the rate selector out. The
other two are agat-emulator's readings of it, kept for comparison. See
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
treated as chosen, so a `7a`/`9a` filename does not override it. The file
itself is not in the address; carrying that is what the `.agc` container in
[TODO.md](TODO.md) is for.

### Examples

`examples/` holds two of Andrew Maltsev's own games, included with his
permission: **ПИТОНЧИК / Snake** as a `.fil`, and **ПУТЬ К
ВЕРШИНЕ / RISE OUT** as a 140K disk. The links on the page need a
served copy — `fetch` is blocked on `file://` — so they work on the
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
```

The full list, and what each one is for, is in
[DESIGN.md](DESIGN.md#tools-and-testing).

## Credits

The reference for nearly every hardware detail is **Agat Emulator** by NOP
(<https://sourceforge.net/projects/agatemulator/>, GPLv2) and **AgatF** by
Ravodin & co. Their ROMs are bundled here; see [ROMS.md](ROMS.md).

## Licence

MIT for the emulator, see [LICENSE](LICENSE). The ROMs and the example programs
are not ours — see [ROMS.md](ROMS.md).
