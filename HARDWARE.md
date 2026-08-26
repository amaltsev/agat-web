# The Agat, as emulated here

The Agat was a Soviet school micro of the mid-1980s. It is Apple II-adjacent —
a 6502, a `$C000` I/O page, seven card slots, `$C030` for the speaker — but it is
not an Apple II, and the places it diverges are exactly the places emulators get
it wrong: memory banking, the video controller, the floppy formats, and the
interrupt structure.

This document is what the emulator believes about the machine, and why. Where a
detail was transcribed from another emulator's source the file is named, so a
disagreement can be traced rather than argued about. The implementation of all
this is in [DESIGN.md](DESIGN.md).

The reference throughout is **Agat Emulator** by NOP
(<https://sourceforge.net/projects/agatemulator/>, GPLv2) and **AgatF** by
Ravodin & co.

Where those two disagree with the factory documentation — **ФгЗ.032.002 ТО4/ТО5,
Техническое описание, часть 1** — the manual wins on what the machine *was*, and
the emulators on what it *did*, because they were written against hardware that
still ran. ТО4 is typed on a typewriter and has its own errors, several of them
noted below; a claim from it that nothing else corroborates is a lead, not a
fact.

---

## The two machines

They differ in more than a badge, and picking the wrong one shows immediately.

### Agat-9

128K in sixteen 8K banks. The 64K the CPU sees is eight windows, each pointed at
a bank by a register file at `$C100-$C1FF` that is **addressed rather than
written**: a store to `$C1nv` sets window `n` to bank `v`, with the value riding
in the address rather than on the data bus. At reset the windows are the
identity map 0-7.

`$D000-$FFFF` is paged by `$C080-$C08F` — a write switches, a read only reports,
which is why the monitor can poll it without paging itself out from under its
own feet. The 2K monitor ROM is mapped as **4K, mirrored across `$F000-$FFFF`**.

That mirror is load-bearing. The MS_10..MS_18 loaders jump to `$F056`, which
aliases to `$F856` = `STA $C110,Y / RTS`. It is not a trampoline, it is the
monitor's set-mapping helper: with Y=0 it points the `$2000-$3FFF` window at
bank 0, so the loader's next reads at `$2010/$2025/$2026` are really zero page
`$10/$25/$26`.

The Agat-9 is the only one of the two with the Apple-compatible video modes.

### Agat-7

The standard machine is **128K in three separate devices**, not one setting:
64K of base RAM on the motherboard, a 32K ЭмПЗУ card in slot 2 and a 32K ОЗУ
expansion in slot 4. `memsizes_b` (`sysconf.c:28-50`) has no 128K-in-one-device
entry for this — the figure is these three added up. `Machine.PROFILES` carries
the whole thing.

The cards are agat-emulator's own default complement (`sysconf.c:72-77`,
`143-150`). The 64K is the factory manual's rather than agat-emulator's, which
starts from 32K (`sysconf.c:303-306`):

- ФгЗ.032.002 ТО4 табл.1 lists блок системный ФгЗ.038.650 as **"ОЗУ — 64К
  байт"** — that is the delivered system block.
- §2.1 gives RAM as "мин — 32К байт; макс — 256К" — 32K is the floor, not the
  standard.
- Табл.8 enumerates screen pages ЭС 0-7, and ЭС 4-7 are the two switchable
  arrays at `$8000-$BFFF`. A 32K board has no such pages.
- The stock monitor ROM carries a bank-select service at `$F85E`
  (`AND #$07 / LDA $F869,Y / STA $C0F0,Y`) with an eight-entry table, which on a
  32K board has nothing to talk to.

One line in the same manual argues the other way — page 40's "4ЭС и 16ЭПС —
АГАТ-7, АГАТ-8", which implies 32K of ООП and contradicts табл.8 three pages
earlier. It is a one-item list under "в зависимости от исполнения", so it reads
as a truncation.

agat-emulator's 32K is a choice in its configuration dialog, and copying it here
was the one place this project copied a default rather than a behavior. The
symptom was software that simply expects RAM at `$8000` — the ОЗУ card powers up
deselected and is not what it finds there.

Base RAM is 32/64/128K in **16K** banks through three windows (`$0000`, `$4000`,
`$8000`), with the bank register at `$C0F0-$C0FF` — also taking its value from
the low nibble of the address, on reads as well as writes. Decode tables are
transcribed verbatim from `baseram.c:475-502`.

**The bank register sits inside the `$C080+16n` slot range and must be decoded
before it.** The Agat-7 has six I/O slots, not seven: табл.9 gives X1-X7 the
`D̅S̅` pages `$C090-$C0EF` and the `I̅/̅O̅S̅` pages `$C100-$C600`, and the board
spends what would be the seventh slot's page on this register. Testing
`lo >= 0x80` first hands `$C0F0-$C0FF` to an empty slot 7, which pins
`$8000-$BFFF` to one array and is what the factory test's `ОШИБКА ВКЛЮЧЕНИЯ
БАНКА` reports.

**At 32K there is no bank register on the board.** agat-emulator installs it
only above `$8000` of RAM (`baseram.c:573`), so `$C0F0-$C0FF` is an undecoded
address that reads `$FF` and changes nothing, and `$8000-$BFFF` belongs to the
expansion card or to no one.

ROM is 2K at `$F800-$FFFF` and **not** mirrored.

**The base RAM size is visible to software**, because it masks the page field of
the video mode register: `page = (mode >> 4) & ((ramSize >> 13) - 1)`. Set it to
match the disk or the picture comes from the wrong address. Only base RAM is
scanned — see the note under the expansion card below.

Base RAM stops at `$BFFF`. There is no built-in language card.

### ЭмПЗУ (Agat-7, slot 2)

The "ROM emulator" card, which puts RAM behind `$D000-$FFFF`. Ported from
`psrom7.c`.

The control register is the slot's **whole `$Cn00-$CnFF` page**, and like several
Agat registers it takes its value from the address: a store anywhere in the page
sets the state to that address's low byte with bit 7 forced on. Reading returns
the state.

| bits | |
|---|---|
| 2..0 | 16K bank within the card's RAM |
| 5 | read enable. Set, the card answers reads and ignores writes; clear, it is write-only and reads fall through to ROM |
| 6 | which 4K half of the bank appears at `$D000-$DFFF` |

Within a 16K bank, `$0000-$0FFF` and `$1000-$1FFF` are the two `$D000` halves and
`$2000-$3FFF` backs `$E000-$FFFF`. Read-enabled, the card covers the monitor at
`$F800` — which is how software installs its own reset and interrupt vectors.

Plenty of Agat-7 software needs this card. RISE OUT keeps its character
generator at `$D000`, its black-and-white splash at `$D800` and its disk driver
at `$E000`; without the card all of that is written into a void, and the game
loads, animates its color title, and then shows an empty screen.

32K as fitted, up to 128K — the bank field is three bits wide, and below 128K
the top banks alias.

### Checking both cards against the factory test

`examples/TESTOZU7_140.agc` asks for the machine's memory configuration and then
verifies it, which makes it the one measurement that can tell a wrong card from a
wrong emulator. Its **исполнение** is the fitting — `0` = 32K, `1` = 64K,
`2` = 128K — and the stock machine passes all three of its branches:

```sh
node tools/shot.js examples/TESTOZU7_140.agc 111  --model=7            # ОЗУ,    base RAM 64K
node tools/shot.js examples/TESTOZU7_140.agc 2401 --model=7            # ДОПОЗУ, slot 4, 32K
node tools/shot.js examples/TESTOZU7_140.agc 4201 --model=7            # ПЗУ,    slot 2, 32K
node tools/shot.js examples/TESTOZU7_140.agc 101  --model=7 --ram=32   # ОЗУ,    base RAM 32K
node tools/shot.js examples/TESTOZU7_140.agc 121  --model=7 --ram=128  # ОЗУ,    base RAM 128K
```

A clean run shows the pass counter advancing with no error lines. Declaring one
size and giving the emulator another — `--xram=16` against исполнение 0 — makes
it report mismatches, which is how you confirm the test is really reaching the
card and not agreeing with itself.

All three base RAM fittings pass. `--ram=64` with исполнение 1 used to report
`ОШИБКА ВКЛЮЧЕНИЯ БАНКА =F1(F0)`, which is the bank register being decoded after
the slot range and swallowed by the empty slot 7 — see the `$C0F0` note above.

The full menu, transcribed from the 1986 factory manual, is in
[examples/TESTOZU7_140.md](examples/TESTOZU7_140.md).

### ОЗУ expansion (Agat-7, slot 4)

The card that can take `$8000-$BFFF` over from base RAM, and the only thing that
reaches it at all on a 32K board. Ported from `xram7.c`.

It powers up **deselected** — ТО4 §3.4.4, "после включения питания всегда
происходит автоматическая установка нулевого слова состояния" — so it is never
what a program finds at `$8000-$BFFF` at reset.

Its control register is the slot's **whole `$Cn00-$CnFF` page** and takes its
value from the address, like the ЭмПЗУ's — but only **seven** bits of it
(`xram7.c:154`), so `$C480` is another name for `$C400`. Reading returns the
state.

| bits | |
|---|---|
| 2..0 | 16K bank within the card's RAM |
| 3 | module selected. Set, the card answers `$8000-$BFFF`; clear, it lets go |
| 4 | write protect. The card still answers reads; stores are dropped |

The window is **arbitrated, not shared**. While bit 3 is set the card owns
`$8000-$BFFF` outright, whatever base RAM would have put there; clearing it
hands the address straight back, which on a 64K or 128K board means the banked
base RAM behind it, contents intact. agat-emulator does this by broadcasting
`SYS_COMMAND_XRAM_RELEASE` and letting `baseram` reclaim the window
(`xram7.c:150-156`, `baseram.c:532-540`); here it is one predicate on the read
path.

**Neither memory card is a display page.** The video controller scans base RAM
and never these — agat-emulator calls `vid_invalidate_addr` from `baseram.c` and
from neither `xram7.c` nor `psrom7.c`, because on the boards the scanner is
wired to the motherboard's memory. A picture cannot be put in the expansion.

**Neither card decodes `$C080+16n` either.** Both fill `io_sel` and never
`baseio_sel`, so `$C0Ax` and `$C0Cx` are open bus on an Agat-7 rather than a
window into whichever card sits in that slot.

### ОЗУ expansion (Agat-9, slot 2)

A different card for a different machine: 128K addressed through the same eight
8K windows as the motherboard's own RAM, rather than a single 16K aperture.
agat-emulator fits one as standard (`sysconf.c:80`) and calls it *Ext. RAM*.
Ported from `xram9.c`.

Its register file is the slot's `$Cn00-$CnFF` page — `$C200-$C2FF` in slot 2 —
and reads the same way base RAM's does at `$C100`: the window is bits 6-4 of the
address and the bank is bits 3-0. What the motherboard's file has no use for is
**bit 7, the enable**. A store to `$Cn8v` points window *n* at the card's bank
*v* and gives the card that window outright; a store with bit 7 clear hands it
back. Every window is handed back at reset, so a machine with the card fitted
behaves as one without it until software says otherwise, and a program can take
`$2000-$3FFF` alone and leave the rest of the map where it was.

Unlike the Agat-7's cards this one **does** decode `$C080+16n`, where it keeps a
ПЗУ mode register of its own with the motherboard's nibble: `mode & 3` picks
read-RAM / ROM-read-RAM-write, `mode & 8` picks which 4K half of window 6's bank
backs `$D000-$DFFF`. That register is how the card is found — a program writes
`$C0n8` and reads it back, getting the slot's own `$F0` in the high nibble where
an empty slot answers `$FF`. MouseGraf sweeps slots 1-4 that way before it will
start.

The two top windows are arbitrated the way the Agat-7's aperture is, with one
asymmetry worth keeping: with **reads** disabled the card releases the window
and the motherboard answers, but with **writes** disabled stores are *dropped*
rather than forwarded (`xram9.c`, `xram_restore_segment` case 6). That is the
card's write protection, and passing the store on would defeat it.

128K is the only fitting agat-emulator offers; a smaller card set here aliases,
because the bank field is four bits wide whatever is behind it.

---

## Slots

| | Agat-7 | Agat-9 |
|---|---|---|
| ЭмПЗУ | 2 | — |
| ОЗУ expansion | 4 | 2 |
| 140K Shugart | 3 | 6 |
| 840K Teac | 5 | 5 |
| mouse, if asked for | 6 | 4 |

This is the stock complement, in `Machine.PROFILES`; an `.agc` or the gear popup
can move a card or resize it. A mouse is never part of it — see
[Mice](#mice) — and the slot above is only where one goes by default.

An **empty slot reads `$FF`**, both its `$Cn00` page and its `$C080+16n`
registers — open bus, as agat-emulator leaves both (`empty_read`, apple2.c:22
and memory.c:4). That is not a detail in either place, because a program looking
for a card asks a question and reads the answer back, and `$00` is an answer a
card can give:

- A memory card's state register **is** its `$Cn00` page and reads back what was
  last written to it, so a program hunting for one writes `$Cn00` to every slot
  and keeps the pages that answer `$00`. An empty slot answering `$00` is
  indistinguishable from an ОЗУ card sitting deselected in bank 0, and MouseGraf
  1.6 picks the *last* such slot it finds — so it would patch its loader to
  write to a slot with nothing in it and load 16K over the top of itself.
- MouseGraf 1.6 takes any slot whose `$C0n1` is not `$FF` for a printer card
  with a mouse on it. With `$00` there it stops at slot 1 and never reaches the
  slot the mouse is actually in.

---

## Video

The mode register is `$C700-$C7FF` on both machines, value taken from the low
byte of the address. The Agat-7 returns `$FF` on read; the Agat-9 returns the
previous mode byte. Decode differs per machine (`videosel7.c` / `videosel9.c`).

The native raster is **512 × 256**, presented at 4:3.

| mode | | |
|---|---|---|
| Text 32×32 | both | character + attribute pairs; bit 5 forces normal, bit 3 flashes |
| Text 64×32 | both | no attributes; the Agat-7 also has an inverse variant |
| 64×64×4 | Agat-7 | 16 colors, high nibble is the left pixel |
| 128×128×4 | both | |
| 256×256×1 | both | |
| 256×256×2 | Agat-9 | 16K, interleaved: low 8K even scanlines, high 8K odd |
| 512×256×1 | Agat-9 | same interleave |
| Apple text / lores / hires | Agat-9 only | 280×192, in color |

Two properties that are easy to get wrong and both load-bearing:

**The video controller scans physical RAM.** It does not go through the CPU's
bank windows at all. On the Agat-9 a page number reaches `$1E000`, well past the
64K the CPU can see at once. Any accessor that translates through the CPU map is
wrong for video, so this emulator does not have one.

**The glyph bit window belongs to the font.** Agat-7 characters live in bits
7..1 (`m0 = $80`), Agat-9 in bits 6..0 (`m0 = $40`). Verified by rendering glyph
`$C1` of `agathe7.fnt` (`10 28 44 44 7C 44 44 00`), which is a clean `A` only at
`m0 = $80`. Font and mask must travel together as one object.

**Agat-7 has no Apple video modes at all.** `videoinit.c:342-350` wires `$C05x`
on `SYSTEM_7` to interrupt-disable only; `vsel_ap` is installed for `SYSTEM_9`
and the Apple systypes. An "unknown mode falls back to Apple text" rule would
mask real decode bugs, so the Agat-7 path must not have one.

**Apple hires is a color mode, and its text is not the Agat's own.** Two
transcriptions from `video/videoprocs.c`, both of which show up in the first
screen of a ported game:

- `apaint_hgr_addr_color` paints the artifact rather than the signal. A lone
  dot is colored by the column it lands in; bit 7 of its byte picks the pair —
  clear is фиолетовый/лайм `$5`/`$A`, set is бирюзовый/красный `$6`/`$9`, the
  Agat palette standing in for the Apple's blue and orange. Two lit dots side
  by side read as white, and the neighbour that whitens the seventh dot of a
  byte is in the *next* byte, so a row has to be unpacked before it is painted.
  What the C also has and the Agat-9 does not is `fill`, the bleed into the
  dark dot after a colored run: it sets that from `cursystype != SYSTEM_9`.
- `apaint_t40_addr` remaps the character, and **the fold stops at `$80`**:
  `$80-$FF` is normal video and indexes the Agat-9 font directly, while the
  inverse and flashing halves below it carry six bits of character, which the
  controller reads out of the font's own `$80` block as `$80 + (ch & $3F)`.
  Bits 7..6 are the attribute: `0` inverse, `1` inverse while the flash is on,
  `2` and `3` normal. Without the fold an Apple program's `(C) 1985` comes out
  as `PCT 1985`, which looks like a font bug and is not one.

  The boundary is the whole question, because `$80-$9F` and `$C0-$DF` are the
  same `@A-Z` glyphs apart from two codes — `·` at `$9E`, **`Ё` at `$9F`** —
  and `$C0-$DF` carries `^` and `_` in their place. A fold that swallowed
  `$80-$9F` as well prints every Russian `Ё` as `_`;
  the Alice game in `examples/` prints one in «сушёными фруктами», which is
  where the boundary can be read off the screen. agat-emulator's Windows trunk
  folds `< $A0` onto `$A0-$DF` (`videoprocs.c` at r281) and loses those two
  glyphs; its Qt tree — 1.29.1, and the lineage the Linux package is built
  from — folds `< $80` onto `$80`, and is what is transcribed here.

### The monitor, and the sixteen colors

The machine puts a bare 4-bit code on the RGB connector — R, G, B and a
brightness bit — and turning that into a color is entirely the monitor's job,
so the emulator has a color table per monitor rather than one palette
(`src/videopal.js`, selected in the gear popup, by `machine.monitor` in a
container and by `monitor=` in the address). The values are agatcomp.ru's
measured table, «Таблица цветов ЭВМ АГАТ» at
<https://agatcomp.ru/agat/Hardware/useful/ColorSet.shtml>:

| code | `color16` | `color8` | `gray` |
|---|---|---|---|
| `0` чёрный | 0,0,0 | 0,0,0 | 0 |
| `1` бордовый | 217,0,0 | 217,0,0 | 130 |
| `2` зелёный | 0,217,0 | 0,217,0 | 89 |
| `3` оливковый | 217,217,0 | 217,217,0 | 221 |
| `4` флот | 0,0,217 | 0,0,217 | 65 |
| `5` фиолетовый | 217,0,217 | 217,0,217 | 194 |
| `6` бирюзовый | 0,217,217 | 0,217,217 | 151 |
| `7` серебряный | 217,217,217 | 217,217,217 | 241 |
| `8` серый | 38,38,38 | 0,0,0 | 39 |
| `9` красный | 255,38,38 | 217,0,0 | 185 |
| `A` лайм | 38,255,38 | 0,217,0 | 148 |
| `B` жёлтый | 255,255,38 | 217,217,0 | 244 |
| `C` синий | 38,38,255 | 0,0,217 | 108 |
| `D` фуксия | 255,38,255 | 217,0,217 | 229 |
| `E` голубой | 38,255,255 | 0,217,217 | 197 |
| `F` белый | 255,255,255 | 217,217,217 | 255 |

`color16` is the common monitor, the second modification of the Электроника 32
ВТЦ 202, where the brightness bit raises intensity — note the asymmetry: the
"dim" colors sit at 217, nearly as bright as the bright half's 255, while `$8`
is a near-black gray far darker than any of them. The **first** modification
read the bit the other way, codes `8`-`F` darker, and early Agat-9s apparently
shipped with it. ЯБ3.089.026 ТО л.47 (табл.5) gives its colors by name:

| | | | |
|---|---|---|---|
| `0` черный | `4` синий | `8` черный | `C` темно-синий |
| `1` красный | `5` сиреневый | `9` коричневый | `D` фиолетовый |
| `2` салатовый | `6` голубой | `A` зеленый | `E` бирюзовый |
| `3` желтый | `7` белый | `B` хаки | `F` серый |

That is `color16inv`, built from `color16`'s own levels since the ТО gives
names rather than measurements: bit 3 flipped, **except that `$0` stays
black** — dimming black is still black, which is why the ТО has two blacks
(`$0` and `$8` are both черный) and only one white/gray pair (`$7` белый, `$F`
серый); a pure flip would wrongly hand `$0` the common monitor's near-black
gray. Period software knew about the split: Picler had a setting for which way
the brightness bit went.

`color8` is a monitor with the brightness bit not wired at all, on which the
two halves of the code space are indistinguishable — and software developed on
one mixes codes freely between them, which is why running such a program on a
16-color table looks wrong and is not an emulator bug. `gray` is the composite
«Видеосигнал» connector's ladder, fixed by the output circuitry; green darker
than red is measured, not a typo — the source stresses it.

---

## Interrupts

Both interrupts come off the video controller's line counter, and on the real
boards there is only one of those. A frame is **312 lines of 672 clocks** of the
10.5 MHz video crystal: a 15625 Hz line rate and a 50.08 Hz frame, with 256
lines displayed and 56 blanked. That structure is measured, not inferred —
[agatcomp's clock-frequency page][clocks] reports 19.97093 ms between frame
interrupts, averaged over six boards with a calibrated Ч3-63 counter, and
312 × 672 / 10.4984 MHz predicts 19.9710 ms.

Software arms both at `$C04x` and disarms them at `$C05x` on the Agat-7 or
`$C02x` on the Agat-9 — **different addresses on the two machines**, and
swapping them hangs software that otherwise runs. `$C019` reads the blanking
state in bit 7.

### Where each signal comes from

On the **Agat-7** the line counter is a pair of К555ИЕ7 (74193) at D51/D52
counting `~СР`, one step per line. Its load inputs are grounded and
`NAND(~КР, СЧY3, СЧY4, СЧY5)` reloads it at Y=56, while the carry out of Y=255
toggles the `КР` flip-flop — so the count runs **0…255 displayed, then 0…55
blanked**, 312 lines. The IRQ line is `СЧY4`, bit 4 of that counter, taken
straight to the bus; NMI is `КР`. Both reach the bus through one К155ЛП8 (74125
quad tri-state buffer) at D94, whose enables come from a К155ТМ2 at D83 that
`~C04X` presets and `~C05X` clears. That is the whole circuit: the arming latch
does not gate a pulse, it connects a free-running counter to the bus.

On the **Agat-9** there is no counter at all. Two К573РФ2 PROMs at D62/D63 plus
К555ТМ9 registers form a state machine: the current line state addresses the
PROMs, which return the next state along with `КГИ`, `КСИ` and `VIRQ`. Running
[the replica project's ROM images][repl] through it gives a cycle of exactly
**312 states**, `VIRQ` low on 39 of them — every line ≡ 7 (mod 8), the last line
of each character row — and `КГИ` low for 256 lines and high for 56, the
opposite sense to the Agat-7's `КР`. `VIRQ` is bit 7 of D63, and D19 is another
К155ЛП8 buffering it to the 6502 with a 3K3 pull-up.

D63's address carries three mode bits (`VCA`, `VCB` and one more) above the line
number, so the Agat-9's interrupt pattern is per video mode: the block matching
the measured board is the one-in-eight modeled here, two other blocks give two
lines in eight confined to lines 70…197, and four never assert at all. Only the
first is emulated, and the mode register does not reach the pattern.

### What that produces

| | Agat-7 | Agat-9 |
|---|---|---|
| sub-frame IRQ | bit 4 of the line counter | one line in eight, from the PROM |
| period | 32 lines, **488.2 Hz** | 8 lines, **1952.8 Hz** |
| asserted | 16 lines ≈ 1045 cycles | 1 line ≈ 65 cycles |
| per frame | 10, one release cut to 8 lines | 39 |
| NMI edge | blanking starts | blanking ends |

The two independently measured numbers on that page both land: 1952.80 Hz
against 1952.83 predicted, and frame ÷ IRQ = 38.9993 against 39.

The Agat-7's **476 Hz** is the one figure there that is wrong. It comes from a
1.05 ms cursor reading on an uncalibrated scope, doubled. The author's own
description of the waveform — "of ten pulses nine last 1.05 ms, the tenth is
twice shorter; the pauses are identical" — is the Agat-7 counter's reload at
line 312 cutting the last release in half, and it pins the half-period to
frame ÷ 19.5 = 1.0242 ms using only the 7-digit frame measurement. Hence
488.2 Hz, and hence the ratio to the Agat-9 being exactly 4.

### The delivery model

The sub-frame interrupt is a **level**, not an edge, and on the Agat-7 the line
is low half the time. A 6502 whose IRQ line is still asserted re-enters the
handler as soon as `RTI` restores `I` — one foreground instruction gets to run
between entries — so while armed, an Agat-7 spends about half its cycles inside
a short handler, in 1 ms slices ten times a frame. Nothing shortens that pulse: on the
Agat-7 the processor cell wires bus A22 to the 6502's pin 4 with one 3K3
pull-up and no capacitor, on the Agat-9 the buffer output reaches pin 4 the same
way, and in both cases the driver is tri-state rather than open collector, so
nothing on another card can shape it either.

That the Agat-9 replaced a counter bit with a one-line pulse, from a PROM that
could have emitted any pattern at all, is the clearest evidence available that
the Agat-7's duty cycle was understood at the time to be a wart.

One 312-line counter drives both interrupts, level, phase locked to the frame,
and that is the only model emulated. Because there genuinely is one counter, a
question that dogs a two-timer approximation does not arise here: the sub-frame
assertion that coincides with the frame is the same count as the NMI, not a
second timer's tick to be kept or dropped.

The bundled RISE OUT carries its **original 1989 sound data**, and under this
model it sounds right to its author. The copy that shipped here before had been
hand-retuned in 2026 to compensate for a single-tick interrupt, which is the
sort of thing a wrong timebase makes people do — and the fact that undoing that
compensation and arriving at the raster from the schematics agree is the best
confirmation the model has.

[clocks]: https://agatcomp.ru/agat/Hardware/useful/clock.shtml
[repl]: https://agat-hardware.sourceforge.io/

### Why this matters: sound

There is one bit of audio hardware — every access to `$C030` flips the speaker
cone — so anything that makes a tone is counting something.

RISE OUT has two players. `PLAY` busy-waits in a cycle-counted delay loop and is
used only for the reset and reboot beeps. Every sound in the game proper goes
through `PLAY500` («МУЗЫКА В ПРЕРЫВ.»), driven from the sub-frame interrupt —
avoiding a busy-wait was the point, so that sound never stutters the animation.

Its handler flips `$C030` once every *n* interrupts, where *n* is the note's
period byte:

```
30E3: DEC $81        ; tick down the note period
30E5: BNE $30F2
30E7: STA $C030      ; flip the speaker
30EC: LDA $85        ; reload the period
30EE: STA $81
30F2: DEC $83        ; tick down the note length
30F4: BNE $3102
30F6: DEC $82
30F8: BEQ $3103      ; note over, advance the table
30FC: LDA $84        ; reload the unit
30FE: STA $83
3102: RTI
```

Two flips make one cycle, so the tone is `entries / (2n)` and the note lasts
`$82 × $84` entries. The interrupt is therefore both the pitch and the tempo,
which is what makes this the sharpest available probe of the delivery model.

The common path through that handler is 29 cycles including the interrupt
sequence, 38 when it flips — far shorter than either machine's assertion, so it
re-enters throughout. That makes `entries / (2n)` the frequency of the flips
*within* a burst; the waveform as a whole repeats at the assertion rate, and
that is the pitch you hear.

`$84` is worth watching: `PLAY500` never initializes it, so if it is 0 when a
sound starts, `DEC $83` wraps and every unit becomes 256 entries instead of 4.

---

## Keyboard

Keys go through the Agat's own scancode table (`keyb.c:14-83`), so **ЛАТ/РУС**
switches to a JCUKEN layout and Cyrillic comes from where a key sits, not from
what the host keyboard types. `$C000` is the latch, `$C010` clears the strobe.
Software reads which layout is live at `$C063`: `$FF`/`$7F` masked `$C0` on the
Agat-9, `$FF` on the Agat-7.

### The keyboard itself

The board drawn by `keyview.js` is transcribed from a photograph of the
machine's Клавиатура, [kbd15.jpg][kbd] at agatcomp.ru. Reading it against the
scancode table settles several things that are not obvious from the table alone:

- **The caps are dual-legend, Cyrillic over Latin** — `Й/J`, `Ц/C`, `Ш/[`,
  `Ю/@`, `Ч/^`, `Э/\`. Those are one byte read in two character sets: `$40-$5F`
  is ASCII `@A-Z[\]^_`, and the Agat-7's font carries upper-case Cyrillic in
  KOI-7 N2 order at `$60-$7F`. **РЕГ adds exactly `$20`** across the whole
  letter block, which is what lets both legends live on one cap. Away from the
  letters the shift is `$10`: `;`/`+`, `-`/`=`, `:`/`*`, `,`/`<`.
- **The two fonts agree above `$80` and differ below it.** `$80-$FF` is one
  128-character set on both machines — `$A0-$BF` punctuation and digits,
  `$C0-$DF` Latin `@A-Z[\]^_`, `$E0-$FF` upper-case Cyrillic in KOI-7 N2 order
  — and the Agat-7's lower half is a byte-for-byte mirror of it, so bit 7 is the
  video attribute and nothing else. The Agat-9's lower half is a *different* set:
  lower-case Latin at `$40-$5F` and lower-case Cyrillic at `$60-$7F`. So the
  same keypress draws a different glyph on the two machines, and a DOS catalog
  name or a `T` file — everything in which carries bit 7 — reads the same on
  both. Measured against `agathe7.fnt` and `agathe9.fnt` glyph by glyph:
  `chars.js` is that shared set, and `tools/dos.js` reads names through it.
- **The board has F1, F2 and F3 and no more**, and the table has codes at
  exactly scancodes `$3B $3C $3D` (`$84 $85 $86`) and nothing for F4-F12.
- **There is no Tab or Backspace cap.** `←` is the backspace, and both the
  host's Backspace and its ArrowLeft reach it, because both are `$88`.
- **`РЕД` is the Esc**, `$9B`, in the same form as the arrows and the rest of
  the board's control codes. The scancode table cannot say so on its own — `$9B`
  comes from the host's Esc and from `УПР`+`Ш` alike, the ASCII control
  relation — which is why `keyview.js` drew it on `Ш` until this was corrected.
- The digit row is the ГОСТ one — `;/+ 1/! 2/" 3/# 4/¤ 5/% 6/& 7/' 8/( 9/) 0
  -/=` — and its legends check out against the character generator: what the
  `4` cap calls `¤` really is what the Agat-7 font draws at `$24`, where ASCII
  has `$`.
- **`ПВТ` sends nothing** the shipped table carries, and neither does the pad's
  `=`.
- The numeric pad runs `1 2 3 / 4 5 6 / 7 8 9 / 0 . =`, inverted from a PC's,
  and every cap on it sends a control code in `$81-$9F` rather than a digit.

Which host key reaches a given cap therefore **changes with the layout**: `РУС
normal` reaches `$40 $5E $5F` (`Ю Ч Ъ`), which `ЛАТ normal` cannot, and `ЛАТ
normal` reaches `$27 $2C $2F $3B` (`' , / ;`), which `РУС` cannot.

[kbd]: https://www.agatcomp.ru/agat/Hardware/Key_Joy/KeyClassic/kbd15.jpg

---

## Mice

A mouse was bought separately and nothing that came with the machine expects
one, so no profile fits a mouse: the gear popup or an `.agc` puts one in the
slot the model leaves free — 6 on the Agat-7, 4 on the Agat-9
(`Machine.MOUSE_SLOTS`).

**All three are relative devices, and no register on any of them says where the
mouse is.** That is the fact everything else follows from, including the page
having to capture the pointer rather than track it: the guest keeps a cursor of
its own, the two drift apart the first time the guest's stops at the edge of its
screen while the host's keeps going, and there is nothing to read back that
would let the drift be corrected.

Three mice on four fittings, and software that proves each one: MouseGraf 4.4
wants the Ниппель, 1.6 the «Марсианка», and Klondike the «Марсианка» on the
other card. One count is one pixel of MouseGraf's cursor
in both, measured — 40 counts of Ниппель movement move the coordinates it
displays by exactly 40 — so the page makes a sweep across the canvas 256 counts.

### Ниппель (`nippelmouse.c`)

A card of its own, with no ROM at all. Each axis is a **7-bit up/down counter**
clocked by the ball, read as two nibbles, with a button riding in bit 3 of each
high one:

| | read | write |
|---|---|---|
| `$C0n8` | X counter, bits 0-3 | preset both counters to `$22` |
| `$C0n9` | X counter, bits 4-6; bit 3 = button B | |
| `$C0nA` | Y counter, bits 0-3 | |
| `$C0nB` | Y counter, bits 4-6; bit 3 = button A | |
| `$C0nC` | as `$C0n8` | clear both counters |

Y counts *down* as the pointer goes down the screen. The preset is what a
program identifies the card by, and MouseGraf 4.4's probe at `$84F4` is exactly
that: sweep slots 6 down to 1, write `$C0nC` and require both counters to read
zero, write `$C0n8` and require both to read back `$22`.

Seven bits is the whole range, so the counter **wraps at 128 counts** and a
program that reads slower than the mouse moves cannot tell 130 from 2. That is
the hardware's limit and not something to paper over. What *is* ours is the
sub-count remainder — a host pixel is rarely exactly one step of a ball — and it
has to be kept outside the counter, because MouseGraf zeroes the counter through
`$C0nC` after reading it and a fraction kept inside would be thrown away every
time. Left inside, roughly a third of the movement goes missing.

### «Марсианка» and ММ-8031 (`mouse9.c`)

Neither is a card of its own: the mouse hangs off the **Agat-9 printer card's
КР580ВВ55 (8255)**, which is why agat-emulator's `mouse9.c` is `printer9.c` with
the cable swapped.

| | |
|---|---|
| `$C0n0` | port A, output — the ММ-8031's axis select, and RES on bit 7 |
| `$C0n1` | port B, output — the mouse's control lines |
| `$C0n2` | port C, input — the reading |
| `$C0n3` | control, written `$89`: A out, B out, C in |

Port C's top two bits are the buttons on both, **active low**: bit 7 button A,
bit 6 button B. The rest is where they part company.

agatcomp's pin table for the cable — a three-row СНП34, rows A and C — gives the
УВК-01 its buttons on `C8`/`C9` and its four direction lines on `C2`-`C5`, which
against the direction bits below fixes the mapping at **C*n* → port C bit *n*−2**
and puts КН2 (левая) on bit 7. The same table gives the ММ-8031's two buttons the
other way round, on `C9`/`C8`; that is *not* modeled here, and neither
agat-emulator nor anything measurable settles it — MouseGraf would then start on
a different physical button depending on which mouse was plugged in.

The **«Марсианка»** is the crudest wire protocol there is: four direction lines
in the bottom of port C, active low, one asserted per step of the ball. Nothing
is latched and nothing is addressed. MouseGraf 1.6 samples port C in a tight
loop at `$6039`, notices it has changed, and indexes a table of sixteen
`(dx, dy)` pairs at `$6317` with the four bits inverted. Read out of the running
program, that table is

    bit 3 → x+1    bit 2 → x−1    bit 1 → y−1    bit 0 → y+1

which is agat-emulator's `read_mars` confirmed from the other end, and Klondike's
own table at `$1EBF` a third time.

The cable's **RES** line (pin `A9`) is **port A bit 7**, and it is the driver's
way of taking a step down when it has counted it: agatcomp's account has the
driver reading the directions and then resetting the circuit, agat-emulator does
it in `printer_io_w` (`regs[2] |= 0x0F` on a write with bit 7 set), and both
programs here pulse `$80`/`$00` after **every** reading — measured, 120 steps of
120, MouseGraf 1.6 32 cycles after the step appeared and Klondike 89-103.

### How long a step lasts, and why it is one number

`STEP_CYCLES` is squeezed from three directions at once, and 256 is where they
meet.

**It has to outlive the driver's decode window.** A driver notices the change on
one read and decodes the lines on a later one, and since the read that asserts a
step is the read that notices it, the window starts there — a requirement to be
met, not a race to be narrowed. Measured with the lines held indefinitely:

| | notices | decodes | window |
|---|---|---|---|
| MouseGraf 1.6 | `$603C` | `$620E` | **14 cycles** |
| Klondike | `$1E58` | `$1E7D` | **102 cycles**, its button handler in between |

At 64 the step ended inside Klondike's window every time — it saw the change,
went through `$1A8A`, and decoded an idle port, so its cursor never moved however
far the mouse did, while its buttons worked perfectly.

**It must not outlive the program that ignored it.** The step also ends by
itself, and that is not a convenience: MouseGraf 1.6 polls this port on its title
screen waiting for a button and never clears it, so a line latched until RES
would still be up when the editor started, the editor would take it for its idle
state, and the mouse would be dead for the rest of the session. Measured, with
the self-clear removed: wave the mouse at the title screen and 40 counts into the
editor move the cursor by nought. It cannot have done that on the real machine,
so the УВК-01 lets go of a step by itself as well.

**And it is the interval to the next step**, which is the ball rolling. At the
УВК-01's 0.5 mm resolution one step per 256 cycles is about 2 m/s of hand
movement, a little above the 1.5 m/s the Nippel manual works out as the fastest
its counters could follow and calls more than the manipulator itself allows.
MouseGraf 1.6 is indifferent to the width in any case, measured: its own poll
loop is the slower limit, and a burst of 40 counts moves its cursor 117 pixels
under 64 or 256 alike, 40 counts fed slowly exactly 40.

The **ММ-8031** is an intelligent mouse by comparison. A write to port A picks
an axis — bit 7 clear for X, set for Y — and latches how far that axis has moved
since it was last asked; port C then reads bits 5-2 as a signed number biased by
8, so a standing mouse reads `$20`, with bits 1-0 high. The number is
**companded** rather than linear — index 0-7 is 0, 1, 3, 6, 15, 35, 70, 100
counts, clamped to ±4 (`mouse9.c:129-147`) — which makes the mouse ballistic:
the further it has moved since the last read, the more each step of the reported
figure is worth. Whether that table is the hardware's or a reconstruction is not
established; it appears in agat-emulator and nowhere else found.

### The card the mouse is on, and why there are two of them

Two registers say nothing about the mouse and everything about the card, and a
program reads both before it will look at the ports at all:

- the card's **`$Cn00` ROM page** — `cm6337.rom`, bundled as `mouse`, of which
  only the last 256 bytes are used — fitted, or an empty `$FF` page;
- **`$C0n1`**, port B before anything has written it. The 8255 comes up with all
  three ports inputs, so what a program reads there is the card's pins.

The two travel together, and the programs want opposite cards:

- **MouseGraf 4.4** finds a parallel mouse by scanning slot ROM pages from
  `$C700` down for the `$18 $90` that page starts with, and will not touch the
  ports of a card without it. It never reads `$C0n1` at all.
- **Klondike** (Р. Бадер, `tmp/Klondike.aim`) sweeps slots 2-6 at `$0864` and
  takes a slot only if `$Cn00` reads `$18` **and** `$C0n1` reads `$FF`. Both, or
  it moves on — and having found nothing it leaves `$AE` at zero and polls slot
  0's `$C082` for ever.
- **MouseGraf 1.6** looks at the same page first and has *two* modes, on bit 7
  of its own `$6F` (`$8023-$8033`): with the bit set it accepts the ROM's `$18`,
  and with it clear — which is how it starts — it accepts only `$FF`, an empty
  page, and rejects the slot outright otherwise. It never reaches the ports. Its
  `$C0n1` test is the other way round from Klondike's: with `$FF` there its poll
  count drops from 1029 to nought, measured.

So there is no one card, and the emulator fits **three**: a «Марсианка» on a
bare card (`mouse-mars`, `$FF` page and `$00` at port B — what 1.6 wants), the
same mouse on a card with the ROM (`mouse-mars-rom` — what Klondike wants), and
the ММ-8031, which is only ever on the second (`mouse-mm8031`). The ROM is on
the card and not on the cable, so the choice is about the machine rather than
about the mouse. Fitting the ROM under 1.6 measurably stops it dead: it rejects
slot 6 at `$8026` and never reads the mouse.

The driver proper is in the card's `$C800-$CFFF` expansion window, which nothing
here decodes, so a program that calls the ROM instead of driving the ports will
not work. Neither MouseGraf does, and neither does Klondike.

### Which button

MouseGraf **starts on button B and draws with button A**, on both cards and both
versions — measured by dragging each in turn and seeing which left a line. Its
startup wait reads only the register B sits in, so a press of A there is not
merely ignored, it is never looked at. The page maps A to the host's left button
and B to its right, which puts the drawing button under the finger that expects
it and makes "press the right button to begin" the price.

Until that button comes, MouseGraf draws **no cursor at all** — its title screen
polls the one register and nothing else. A mouse that is working perfectly is
therefore indistinguishable, on screen, from one that is not, which is why the
click that captures the pointer is also delivered to the machine rather than
being spent on the capture.

Choosing the mouse a program was not written for fails just as quietly, and
worse: 4.4's wait loop polls the parallel port whether or not it found a mouse
there, so a «Марсианка» will start it, the editor will come up, and the cursor
will sit at 128:128 for ever. The status line reports a card that has gone
fifteen emulated seconds without being read, which catches a Ниппель under 1.6
but not that case — nothing distinguishes "read and not understood" from
"read and understood" from outside the program.

Choosing the wrong *card* for the right mouse fails the same way and is easier
to do, since both fittings are the same mouse in the menu: Klondike with a bare
«Марсианка» simply never finds it, deals its hand, and answers the keyboard.
The status line names the card as well as the mouse for that reason.

---

## The game port

No joystick is fitted, and **that is a state software reads**, not one it
cannot see. agat-emulator gives the empty port its own pair of handlers in
`joystick/joystick.c` — `joy_button_none` and `joy_status_none`, the procs a
machine gets unless its joystick device is DEV_MOUSE or DEV_JOYSTICK — and both
answer `$FF`:

- **`$C061`/`$C062` idle high.** A fitted stick pulls them down and releases
  them high when pressed, which is what `joy_button_joy` answers `$7F`/`$FF`
  for. So bit 7 set on both is "nothing plugged in", not "both buttons held".
- **`$C064-$C067` never expire.** With no potentiometer across it the 558's
  timing capacitor never charges, so bit 7 stays set however long after the
  `$C070` trigger it is read.

Both halves are load-bearing, and two programs read them:

- **Алиса в стране чудес** probes at `$98AC`. `LDA $C061 / ORA $C062 / BMI` is
  the whole first test — high means no stick. Failing that it triggers `$C070`
  and counts 27-cycle loops until each one-shot drops, and calls a stick fitted
  if either count comes back nonzero. Note that a one-shot which reads *low*
  straight away counts 1, not 0: only a line that never drops reads as absent.
- **`im_cp.140.img`** stops on «КАЛИБРОВКА ДЖОЙСТИКА — ЦЕНТРИРУЙТЕ ДЖОЙСТИК И
  НАЖМИТЕ КНОПКУ 0» when the buttons read low, and goes straight into the game
  when they read high. It reads `$C061` and `$C062` once each and nothing else.

A port answering `$00` on the buttons and timing out at mid-scale is a centered
joystick with its buttons up. Alice hands the controls to it and stops reading
the keyboard, which looks exactly like a broken keyboard and is not one.
Fitting a joystick means driving these from a real input; it does not mean
softening what an empty port says.

---

## Floppies

### 840K "Teac" (slot 5, both machines)

Two 8255s at `$C0D0-$C0DF`. Port C of the first is the drive itself — bit 2 step
direction, bit 3 drive select, bit 4 side, bit 6 write mode, bit 7 motor — and it
is **readable at `$C0D2`** as well as settable a bit at a time through the
control port at `$C0D3`. MouseGraf's driver raises the motor line and reads it
straight back to decide whether there is a controller in the slot at all; a
register that always answers `$00` sends it into a retry loop it never leaves.

One byte every 32 µs — 32.66 cycles — and the byte clock keeps its phase
however often the CPU looks: a loop that polls every 50 cycles still sees 6250
bytes go by in the 200 ms of a revolution. That is what TESTKOM9's speed check
counts between index pulses (`APTEST1`, `$7900`), and it prints «200.2».

The disk surface is described by `.aim` images: 160
tracks of 6464 16-bit little-endian words, where the low byte is data and the
high byte is an attribute — `0x01`/`0x80` desync (the hardware sync detector
fired), `0x02` end of track, `0x03`/`0x13` index mark start/end.

The sector checksum is an **ADC-with-carry chain**, not an XOR.

The status register at `$C0D1` carries bit 4 as the **index**, low while the
start of the track is under the head, and bit 5 as the **write-protect sense**,
set while the disk can be written (`fdd.c`, `x |= 0x20`); the factory formatter
tests it with `AND #$20` the moment it has set write mode. Loaders that count sectors off rather than
matching sector numbers — MouseGraf 4.4's is one — poll `AND #$90` on it before
they read, and without it they begin wherever the head happens to be and load a
whole track's worth of data out of phase. Almost no `.aim` in circulation
carries the `0x03`/`0x13` attribute pair, so the signal has to come from
somewhere else: agat-emulator calls the first `0x40` bytes of an unmarked track
the index (`fdd/fdd.c`, `no_mark`); here it is `0x80` — 4.2 ms of a 200 ms
turn — because TESTKOM9's speed check (`APTEST1`, `$7900`) counts 100 µs ticks
while the index is high and accepts 1980-2020 of them: 200 ms less a 4 ms
pulse sits in the middle of that window, and a 2 ms pulse counts 2023 and
fails.

#### Writing

Port C bit 6 is write mode; `$C0D5` takes the byte to be written and `$C0D8` is
the **sync strobe** («запись синхро»). The reference driver is the one on the
factory computer test (`examples/TESTCOM7_840.agc`, ТЕСТ 'НГМД', disassembled at
`$DE5E-$DEFD`): write mode, one `$AA` at once, then on each "register free" (bit
7 of `$C0D6`) `$AA` ×4, `$A4`, `$FF` with the strobe **immediately after it**,
`$6A $95`, 256 data bytes at 27 cycles each, the checksum, `$5A`, `$AA`; then
the write-protect bit is checked and read mode restored. The formatter is the
same routine writing address fields too, from the index, and it measures the
track it reads back to size its gaps.

The model here follows the hardware's two-stage pipeline: a byte stored at
`$C0D5` waits in the 8255 until the byte boundary, when the shift register takes
it and it occupies the slot the head is entering. So a byte written just after
an address field's `$5A` lands behind the `$5A`, not on it, and the rotation
clock keeps running in write mode — the formatter waits for the index with write
mode already set. The strobe marks (attribute `0x01`) **the byte handed over
most recently**: agatcomp.ru's study of the write sequencer
(`Hardware/DZU/fl840k/fl840k_write.shtml`) shows the sync gap stitched onto the
end of the byte in flight and the `$FF` lost on read, the decoder locking on it
and delivering the `$95` behind it; agat-emulator's `fdd.c` marks the same word
(`rotate_sector`, `|= 0x0100`); and the boot ROM at `$C565` discards exactly
that byte after waiting for bit 6. A slot the head passes in write mode without
a strobe loses any old mark, as in `fdd.c`, so a rewritten sector carries only
the marks its writer put there. Real `.aim` files carry the mark on the byte
before `$95 $6A` / `$6A $95` throughout.

What settled it was the factory test itself: with the disk unlocked, ТЕСТ 'НГМД'
formats all 160 tracks, reads them back and answers «ТЕСТ ПРОШЕЛ БЕЗ
ЗАМЕЧАНИЙ», and every track it wrote decodes back to its 21 sectors.

Every synthesised track — from a `.dsk` or a `.nib` — is one revolution long:
**6250 bytes**, which is 250 kbit/s for the 200 ms of a turn at 300 rpm, laid
in the `.aim` slot of 6464 words with an end mark at 6250 and gap behind the
last sector. That length is what TESTKOM9's speed check measures between index
pulses (`APTEST1`, `$7900`: 2000 ± 20 counts of its loop, i.e. 300 rpm ± 1%),
and it is the room a formatter has — the 21 records of a `.nib` come to 5922
and leave none for the gaps it writes. A `.aim` turns over its own length, the
end mark's or the whole 6464-word slot; a converter-made one that fills the slot
turns 3% slow, which is what the image says.

### 140K "Shugart" (slot 3 on Agat-7, slot 6 on Agat-9)

A Disk II clone (`fdd/fdd1.c`), with the same GCR 6-and-2 sector encoding and
4-and-4 address fields.

| | |
|---|---|
| `$C0E0-$C0E7` | stepper phases: phase = `reg>>1`, on = `reg&1` |
| `$C0E8` / `$C0E9` | motor off / on |
| `$C0EA` / `$C0EB` | select drive 1 / 2 |
| `$C0EC` | read the data latch; in write mode, shift the latch out |
| `$C0ED` | load the data latch |
| `$C0EE` | leave write mode; reading gives write-protect in bit 7 |
| `$C0EF` | enter write mode |

The `Rotated` flag is what boot loops poll on: each track byte is handed out
once, and a re-read before the next rotation tick returns bit 7 **clear**.
Getting this wrong hangs every 140K disk with no diagnostic.

#### Writing

The same register file the other way round: `STA $C08D,X` loads the latch and
the `ORA $C08C,X` after it puts the byte on the track, which is the pair DOS
3.3's write loop is built from.

The model is **a byte of track per byte written**, not per rotation tick. While
write mode is set the rotation clock does not move the head at all; each
shift-out moves it one. That is a deliberate departure from the read path, and
it follows from the media being a stream of bytes rather than of bit-cells: a
self-sync `$FF` is ten bit-cells and DOS spends 40 cycles on each, against the
32 the rotation is quantised to, so a rotating head would strand stale gap bytes
between the sync bytes the next read has to lock onto. The upshot is that write
timing does not have to be right for the data to be, which is forgiving of
software this emulator has never seen.

`index` names the byte the head last dealt with, read or written, so a write
goes to the one after it. A program that reads an address field and then starts
writing therefore lands on the gap behind it rather than on top of its own
prologue.

Every disk is mounted **locked**, whatever the image says about itself, and
`$C0EE` reports it (`$C0D1` bit 5 on the 840K); the drive's `RO` control in the
page is what clears it.

### Image formats

Recognized **by size, not by extension** — extensions in the wild lie, and one
system disk in circulation is named `.800.dsk` while actually being an `.aim`.

| size | |
|---|---|
| 143360 / 143364 / 143488 | DSK140 |
| 232960 | NIB140 |
| 860160 / 860164 / 860288 | DSK840 |
| 947520 | NIB840 |
| 2068480 | AIM840 |

An optional 256-byte prefix carries the 33-byte signature `Agathe emulator
virtual disk\x0D\x0A\x1A""AD`; header byte 48 ≠ 0 means write-protected.

### `.fil`

A DOS 3.3 file with a 40-byte header glued in front, padded so that
`(size - 40) % 256 == 0`. Everything from `0x28` on is the file's DOS data
stream — what DOS keeps in its data sectors, byte for byte, which is what lets
`tools/dos.js` take a file off a disk and put it back unchanged.

| | |
|---|---|
| `0x00` | 30-byte name, high-bit KOI-7, `$A0` padded |
| `0x1E` | five zero bytes |
| `0x23` | the stream's length in bytes, address prefix included |
| `0x25` | the load address |
| `0x27` | DOS file type, `$80` for locked |
| `0x28` | the stream |

The two fields at `0x23` and `0x25` restate what a `B` file's own first four
bytes already say, and 123 of the 156 `.fil` files in the archive leave them
zero, so nothing reads them. A `B` file's stream begins with load address at
`0x28` and length at `0x2A`, which is where `fil.js` reads them.

**The page loads `B` files only** — `(type & 0x7F) == 4`, which is what
`AGAT.sniff` tests for. `AGAT.fil.parse` reads any type, because a `T` or `A`
file is a perfectly good thing to carry between disks even though nothing can
poke it into memory and run it.

Loading is not a jump. Fill RAM with `$60` (`RTS`, so a stray jump lands
somewhere harmless), poke the program in through the bank windows, then forge
the warm-start vector `$3F2/$3F3/$3F4 = lo, hi, hi ^ $A5` and release reset — the
monitor's own RESET handler sees a valid pair and does `JMP ($3F2)`.

---

## Monitor entry points worth knowing

The Agat-7 monitor's IRQ vector points into ROM at `$FA26`:

```
FA26: 85 45      STA $45          ; save A
FA28: 68 48      PLA / PHA        ; peek at the pushed status
FA2A: 0A 0A 0A   ASL ASL ASL      ; test the B flag
FA2D: 30 03      BMI  (BRK path)
FA2F: 6C FE 03   JMP ($03FE)      ; IRQ -> user vector
```

So the Apple convention holds: the user IRQ vector is `$03FE/$03FF`, and the
handler restores A from `$45` before `RTI`. `$FFFA` points straight at `$03FB`,
where it expects an *instruction* rather than an address.

This is how portable software installs an interrupt handler without needing an
ЭмПЗУ card — which matters for anything meant to run on more than one
configuration.

---

## Not emulated

The Agat-7 ДопОЗУ extra-RAM card, the joystick,
80-column/Videoterm/DHGR and Apple //e modes, cycle-accurate raster
splits, printer, SCSI, tape and clock. The printer card is emulated only as far
as the mice that hang off it need — its 8255 without a cable, and without the
ROM that would let a program find it.
