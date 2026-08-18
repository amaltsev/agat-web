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

**Only mapped keys** shrinks everything the loaded container does not name out
of the way, leaving the keys the program is played with where the machine puts
them — in three areas that collapse on their own, so an unused numeric pad
disappears and one named arrow brings the whole cluster. It needs a `.agc` that
says which keys those are, and on a phone it is what such a container opens
with.

A container that also groups its controls gets a **card under the screen** — what
the program reads and what each code does, in the groups its author wrote — and a
menu entry per group, so the board can be cut down to the movement keys or to the
cheats alone. Tapping a group on the card does the same thing, and tapping it
again goes back. The card says what the *program* wants and stays put; the board
says which of your keys reaches it and moves with ЛАТ/РУС. Both come from the
container's [`controls`](AGC.md#controls--what-the-program-reads-and-what-for).

The bar picks the **machine**; the ⚙ popup has its memory. The default Agat-7 is
the standard machine — 128K in three separate devices: 64K of base RAM, a 32K
ЭмПЗУ card in slot 2 and a 32K ОЗУ expansion in slot 4. Base RAM is the one to
set to match your disk, because it is the only memory the video controller scans
and its size masks the video mode register's page field, so software can tell.
The Agat-9's own 128K is fixed, but it takes a 128K ОЗУ expansion of its own in
slot 2 — a different card, and MouseGraf will not start without it.
A filename containing `7a` or `9a` picks the machine for you until you choose
one yourself.

Drives: 840K in slot 5 on both machines, 140K in slot 6 on the Agat-9 and slot 3
on the Agat-7. A dropped image goes to whichever drive can read it.

Each drive has a **lamp** in the bar: dim while its motor line is up, bright
while bytes are reaching the CPU, with the track its head is on beside it. Disks
of this era take their time — a boot can be ten seconds of reading — and the
lamp is what tells that apart from a hang.

Beside each lamp is **RO / RW**, the drive's write lock. Every disk arrives
read-only and the drive tells the program so; click `RO` and the drive will
write. That is what an Agat-9 system disk is asking for when it says «СИСТЕМА
ИСПОРЧЕНА», and what DOS needs before `SAVE` or `INIT` will work. Writes go to
memory and nowhere else — the file on your disk is never touched, and closing
the tab loses them; **Save AGC** lights up while there are any, and keeps them
as patches on the image they came from.

The **⚙** holds the settings a machine is run under rather than driven by: the
volume, the machine's memory sizes, and whether it has a mouse. The video
interrupt is not among them — it comes off the line counter, exactly as the
boards produce it, and there is nothing to choose. See
[HARDWARE.md](HARDWARE.md#the-delivery-model).

**Mouse** is off unless you ask, because nothing that came with either machine
expects one, and it asks *which*: the three Soviet mice speak different
protocols and a program drives the one it was written for. The «Марсианка» is
offered twice over, once on each of the two cards it hung off, because a program
looks the card over before it will look at the mouse and they do not agree about
what it should find. Pick the wrong one and the program gives no sign whatever —
the mouse turns red in the status line when nothing is reading the card, and
green while the machine is holding the pointer. A container is the better place to settle it, since the
program is what knows: an `.agc` names the mouse along with the rest of the
machine, and then nobody has to guess.

Click the screen to hand the pointer over and Esc to take it back — none of
these mice can report a position, so there is no way to point them at anything,
and the page has to capture the pointer the way a real one moved a ball. That
first click is passed to the machine as well, so a single click both takes the
pointer and reaches the program. The host's left button is the card's button A
and its right is button B; which one a program wants is its own business, and a
program that draws no cursor until it has been given a button looks exactly like
a mouse that does not work. MouseGraf, for the record, starts on the right
button and draws with the left.

Every one of those settings rides in the address, so a machine that runs a
program properly is a bookmark:

    index.html#ram=128&xram=128
    index.html#model=9&mouse=mars-rom

Each key is a *difference* from the standard machine, and only the differences
are written — the standard Agat-7 has an address with nothing in it at all.
`model` is 7 or 9; `ram` is base RAM in KB — 32, 64 or 128, Agat-7 only, since
the Agat-9 is always 128K; `psrom` and `xram` size the two Agat-7 memory cards
in KB and `xram9` the Agat-9's, with `0` for a slot left empty; `mouse` is
`nippel`, `mars`, `mars-rom` or `mm8031`, and empty for no mouse. A card can be
given a slot of its own — `mouse=nippel:3` — for a machine that had one
somewhere other than the slot this page leaves free. A machine named in the URL
is treated as chosen, so a `7a`/`9a` filename does not override it.

`agc=` names a container, which carries the file itself:

    index.html#agc=examples/rise-out.agc
    index.html#agc=https://example.org/games/tetris.agc

A container is fetched, so this needs a served page. The name is a path beside
the page or an `https://` URL to one hosted anywhere that lets this page fetch
it — a container needs no copy here to be linked and run, only a host that
sends `Access-Control-Allow-Origin`. The other keys go into the machine it
builds rather than on top of it, so `#agc=…&model=9` tries the program on the
other machine and it is the other machine the program boots on.

They are differences from the container in the same way they are otherwise
differences from the standard machine: a container running as its author meant
it to leaves `#agc=…` and nothing else, and a key appears only where the machine
and the container disagree. So an address stays right if the container is later
edited — and a container that the address *cannot* name, one dropped on the page
or opened by hand, has its machine written out in full instead, since reopening
the address will not bring it back.

## `.agc` — the Agat Container

Knowing how to run an old program is more than having its disk: which machine,
how much RAM, which cards, and which host key sends the byte it reads.
An `.agc` is all of that in one JSON file, which the page takes like any other.
The format is written up field by field in [AGC.md](AGC.md).

```json
{
  "agc": 1,
  "title": "RISE OUT",
  "author": "Andrew Maltsev",
  "date": "1989",
  "url": "https://…",
  "machine": { "model": 7, "ram": 64 },
  "keys":    { "KeyW": { "code": "^", "hint": "Shoot right" },
               "Space": { "hint": "Jump" } },
  "media": [ { "name": "rise-out.dsk", "data": ["…base64…"] } ]
}
```

`keys` is **the keys the program is played with**, and it is what makes a game
with awkward controls playable. An entry with a code is a remap: `^` is `$5E`,
four keys away in ЛАТ and under a Shift, and this puts it on W in both layouts
and under any modifier. A code may be written as the character itself, as `$5E`,
or by name (`Up`, `Enter`, `Esc`, `F1`), and the short form `"KeyW": "^"` works
where there is nothing to say about it. An entry with **no** code names a key
the program uses as it already is, and changes nothing about what it sends.

The `hint` is the useful half. The on-screen keyboard reads the key set the same
way it reads the shipped table, so the cap lights on a keypress and hovering `^`
reads **W (Shoot right)** — which is the question someone in front of an
unfamiliar game actually has.

`date` is **text**, not a number: what is known about an old program is as often
`"circa 1985"` or `"1990-92"` as it is a year.

`media[].data` is base64 in short lines, and the payload is the image **as it
was found**. Anything changed goes in `media[].patches` as
`{ "at": 45312, "hex": "A9 60 85 84" }`, applied after decoding — so a container
carries a pristine copy of what it came from and a small change stays legible.
A patch past 32 bytes is base64 like the payload instead. What a program writes
to an unlocked disk is saved the same way: the written track is read back into
the sectors it was built from, so a saved game costs a patch and not a second
copy of the disk.

Bulk is gzipped where that helps: a payload or a patch that gets at least a
tenth smaller is written as `gz` instead of `data`, base64 either way. An Agat
disk is mostly empty, so a 140K game is around 20K of container rather than
217K — while everything a person reads or edits stays text, and a short patch
stays hex.

`title`, `author`, `date`, `url` and `notes` are for the record — often the
container is the only place left that says who wrote a program and when. The
first four head the info card under the controls; `notes` is not drawn at all,
and nothing reads it. Under them go the two fields written to be read: `info`,
which is what the program is at whatever length that takes, and a **hint** —
one line of plain text, printed heavier because it is the line worth acting on,
for what no list of codes says, like which layout the program comes up in or
which disk to boot from. A key's own `hint` is the same word on the on-screen
board. Both are plain text, with one thing recognised in them: a bare
`http`/`https` address becomes a link.
Nothing but `agc` and `media` is required.

**Save .agc** writes one out from the machine as it stands: what is in the
drives, the model and its memory, and the live remap. Cards are written down
only where they differ from the stock machine, so a container for an ordinary
Agat-7 stays short. It asks nothing. A container that was loaded from a file
keeps its own title and filename; one made from a bare image takes the image's
name for both, so `game.dsk` saves as `game.agc` titled `game.dsk` — rename it
afterwards if it deserves better. From the command line:

```sh
node tools/mkagc.js game.dsk --title="…" --author="…" --date=1989 \
  --model=7 --ram=64 --key="KeyW:^:Shoot right" \
  --hint="Press РУС at the title screen." > game.agc
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

Three more come from [agatcomp.ru](https://agatcomp.ru/), and they are here for
the mouse, which is the one thing about an Agat program that a disk cannot tell
you: **Klondike и Pusher** (Р. Бадер, 1992) wants a «Марсианка» on the
printer card *with* its ROM page, **MouseGraf 1.6** (Бадер и Багашев, 1992)
measurably needs that page *empty*, and **MouseGraf 4.4** (1994) will not look
at a card whose page is empty, so it is fitted the way Klondike is. A program
that finds the wrong card draws no cursor at all, which looks exactly like a
mouse that does not work — so each container states its fitting, and the status
line names the card it got once the container is running.

`examples/TESTOZU7_140.agc` is the **factory memory test**, which asks you to
declare the machine's memory and then verifies that it really is that — so it is
the one thing here that can tell a wrong card from a wrong emulator. The stock
Agat-7 passes all three of its branches, and base RAM passes at all three
fittings. Its menu, transcribed from the 1986 manual, is in
[examples/TESTOZU7_140.md](examples/TESTOZU7_140.md); the short version is that
**исполнение starts at 0**, where `0` is 32K — so the stock 64K board is `1`.

`examples/TESTCOM7_840.agc` is the **factory computer test** on an 840K disk —
Бейсик, звук, интерфейс, НГМД, магнитофон. Its ТЕСТ 'НГМД' formats the disk it
came on, reads it back and verifies it, which is what settled how the 840K
drive writes; unlock the drive (`RO` → `RW`) before you run it, and it answers
«ТЕСТ ПРОШЕЛ БЕЗ ЗАМЕЧАНИЙ». `examples/TESTKOM9_840.agc` is the Agat-9 one
(Фг.00033-01 12 01), menu-driven, and its disk test passes the same way.

---

## Documentation

| | |
|---|---|
| [AGC.md](AGC.md) | the `.agc` container, field by field |
| [HARDWARE.md](HARDWARE.md) | the machine as emulated — memory models, video modes, interrupts, floppy formats, and where each detail was transcribed from |
| [DESIGN.md](DESIGN.md) | the JavaScript — module map, the bus, the render and audio pipelines, the run loop, the test tools |
| [CLAUDE.md](CLAUDE.md) | the short version: constraints, what to run before believing a change, what is settled and what is not |
| [ROMS.md](ROMS.md) | the bundled ROMs and where they came from |

## What is not there

NTSC artefact colour for the Apple modes, 80-column and Apple //e modes,
printer and tape.

## Development

```sh
node tools/vectors.js               # pure-function tests, about a second
node tools/check.js modules         # index.html vs tools/modules.js
node tools/cputest.js               # Klaus Dormann 6502 functional test
node tools/check.js boot <image>    # boot and report where it got to
node tools/check.js write <image> --keys=…   # boot unlocked, say what was written
node tools/shot.js <image> [keys]   # boot, send keys, write a PNG
node tools/mkagc.js <image> …       # pack an image and its settings into an .agc
```

Every tool takes an `.agc` wherever it takes an image, and runs it on the
machine the container names.

The full list, and what each one is for, is in
[DESIGN.md](DESIGN.md#tools-and-testing).

## Credits

This emulator is a transcription more than an invention. Most of what it knows
about the hardware was read out of other people's work rather than worked out
from first principles, and where something *was* worked out here — the raster
that both interrupts come off, the mouse step timings, the 140K write path — it
was by disassembling programs and measuring them against those same sources.
It would not exist without any of the following.

- **Agat Emulator** by NOP — <https://sourceforge.net/projects/agatemulator/>,
  GPLv2. The reference for most hardware details: the two memory maps
  (`baseram.c`), the video modes and painters (`videoprocs.c`, `videosel7.c`,
  `videosel9.c`), both floppy controllers (`fdd.c`, `fdd1.c`) and the sector
  encoders (`dsk2nib.c`, `dsk2hfe.c`). The keyboard's scancode table is its
  shipped `keyb/default.bin` emitted verbatim, and the undocumented-opcode set
  is checked against its `cpu/cpu6502.c`. The bundled ROMs, character
  generators and palette are from its data package.
- **AgatF** by Ravodin & co. — the second reading of the same hardware, and the
  source of the same five ROMs under different names, byte-for-byte identical.
  See [ROMS.md](ROMS.md) for both, with checksums.
- **agatcomp.ru** — the hardware archive, and the source of nearly everything
  here that did not come out of an emulator's source. The scanned factory
  documentation it publishes — **ФгЗ.032.002 ТО4/ТО5, часть 1**, in [Агат-7,
  комплект 5][docs] — is what settles fittings, slot assignments and power-on
  states, the questions about what the machine *was* rather than what it did.
  The [Ниппель mouse card's manual and schematic][mouse] are the register map
  and the cable's pin table behind `src/mouse.js`. The
  [clock-frequency page][clocks] reports 19.97093 ms between frame interrupts,
  averaged over six boards with a calibrated Ч3-63 counter, which is what pins
  the raster at 312 lines of 672 clocks. The on-screen keyboard is transcribed
  from its [photograph of the Клавиатура][kbd], which is what settles that a
  keycap is a *code* rather than a scancode. And four of the programs in
  `examples/` are from there.
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

[docs]: https://agatcomp.ru/agat/Paper/DocsShtat/A7_K5.shtml
[mouse]: https://agatcomp.ru/agat/Hardware/Key_Joy/MouseUVK.shtml
[clocks]: https://agatcomp.ru/agat/Hardware/useful/clock.shtml
[kbd]: https://www.agatcomp.ru/agat/Hardware/Key_Joy/KeyClassic/kbd15.jpg

## Licence

MIT for the emulator, see [LICENSE](LICENSE). Three sets of bundled files are
not ours and are not MIT: the ROMs, character generators and palette in
`roms/roms.js` — see [ROMS.md](ROMS.md) — the example programs in `examples/`,
and `tools/6502_functional_test.bin`, which is built from Klaus Dormann's
GPLv3 test sources. None of the three is part of the emulator itself; the test
binary is read by `tools/cputest.js` and never ships to the browser.

`examples/TESTOZU7_140.agc`, `examples/TESTCOM7_840.agc` and
`examples/TESTKOM9_840.agc` are Soviet factory diagnostics of the 1980s, and `examples/Klondike.agc` and the two
`examples/MouseGraf-*.agc` are Р. Бадер's and Ю. Багашев's programs of 1992-94,
all from
[agatcomp.ru](https://agatcomp.ru/). Their licences are **unknown**; they are
included on the assumption that something of that origin and age is as close to
public domain as anything gets, and any of them will be removed if the rights
holder would rather it were not here.
