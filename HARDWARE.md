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

32/64/128K in **16K** banks through three windows (`$0000`, `$4000`, `$8000`),
with the bank register at `$C0F0-$C0FF` — also taking its value from the low
nibble of the address, on reads as well as writes. Decode tables are transcribed
verbatim from `baseram.c:475-502`.

ROM is 2K at `$F800-$FFFF` and **not** mirrored.

**The RAM size is visible to software**, because it masks the page field of the
video mode register: `page = (mode >> 4) & ((ramSize >> 13) - 1)`. Set it to
match the disk or the picture comes from the wrong address.

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
loads, animates its colour title, and then shows an empty screen.

---

## Slots

| | Agat-7 | Agat-9 |
|---|---|---|
| ЭмПЗУ | 2 | — |
| 140K Shugart | 3 | 6 |
| 840K Teac | 5 | 5 |

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
| 64×64×4 | Agat-7 | 16 colours, high nibble is the left pixel |
| 128×128×4 | both | |
| 256×256×1 | both | |
| 256×256×2 | Agat-9 | 16K, interleaved: low 8K even scanlines, high 8K odd |
| 512×256×1 | Agat-9 | same interleave |
| Apple text / lores / hires | Agat-9 only | 280×192, mono |

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
the measured board is the one-in-eight modelled here, two other blocks give two
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

`raster` is the default. The other two are kept selectable for comparison, and
are expected to go once enough software has been heard under `raster`:

| model | what it is |
|---|---|
| `raster` | **the default** — the above: one 312-line counter, level, phase locked to the frame |
| `held` | agat-emulator's — two free timers at 50 Hz and 1000/2000 Hz, line held `N_RBINT_DELAY` cycles per tick (600 Agat-7, 70 Agat-9: `videosel.c:110`, `cpu.c`'s `CPU_INTR_IRQ`/`NOIRQ` pair) |
| `pulse` | the same two timers, one handler entry per tick |

In agat-emulator's source `N_RB_7 = 16` is the *repaint* block count and has
nothing to do with any of this; `N_RBINT_7 = 20` is the separate interrupt
divisor, and 20 × 50 = 1000 Hz looks chosen to be a round number as much as
anything.

`held` and `pulse` keep their timers deliberately independent of each other:
every tick raises IRQ, *including* the one that coincides with a frame, and
folding them into one counter drops one IRQ in twenty. Under `raster` the
question does not arise, because there genuinely is one counter.

The bundled RISE OUT carries its **original 1989 sound data**, and under
`raster` it sounds right to its author. The copy that shipped here before had
been hand-retuned in 2026 to compensate for the single-tick model, which is the
sort of thing a wrong timebase makes people do — and the fact that undoing that
compensation and switching to `raster` agree is the best confirmation the model
has.

`held`'s 600 cycles of 1020 is a 59% duty cycle where the hardware's is 50%, so
it is much closer than it looks in total handler entries — but it bunches them
at twice the rate. Measured on `PLAY500`'s handler through `tools/tone.js`,
switching `held` → `raster` costs 14% of the entries and stretches a fixed-length
note by 16%, while halving the rate at which the bursts repeat. Since the ear
takes the repetition rate for the pitch, **`raster` sounds an octave below
`held`** — which is what `PLAY500`'s name says it should be, and what RISE OUT's
author remembers.

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

`$84` is worth watching: `PLAY500` never initialises it, so if it is 0 when a
sound starts, `DEC $83` wraps and every unit becomes 256 entries instead of 4.

---

## Keyboard

Keys go through the Agat's own scancode table (`keyb.c:14-83`), so **ЛАТ/РУС**
switches to a JCUKEN layout and Cyrillic comes from where a key sits, not from
what the host keyboard types. `$C000` is the latch, `$C010` clears the strobe.
Software reads which layout is live at `$C063`: `$FF`/`$7F` masked `$C0` on the
Agat-9, `$FF` on the Agat-7.

---

## Floppies

### 840K "Teac" (slot 5, both machines)

Two 8255s at `$C0D0-$C0DF`. The disk surface is described by `.aim` images: 160
tracks of 6464 16-bit little-endian words, where the low byte is data and the
high byte is an attribute — `0x01`/`0x80` desync (the hardware sync detector
fired), `0x02` end of track, `0x03`/`0x13` index mark start/end.

The sector checksum is an **ADC-with-carry chain**, not an XOR.

### 140K "Shugart" (slot 3 on Agat-7, slot 6 on Agat-9)

A Disk II clone (`fdd/fdd1.c`), with the same GCR 6-and-2 sector encoding and
4-and-4 address fields.

The `Rotated` flag is what boot loops poll on: each track byte is handed out
once, and a re-read before the next rotation tick returns bit 7 **clear**.
Getting this wrong hangs every 140K disk with no diagnostic.

### Image formats

Recognised **by size, not by extension** — extensions in the wild lie, and one
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

A DOS 3.3 file plus its catalogue entry: 30-byte name, type at `0x27` (must
satisfy `(type & 0x7F) == 4`), load address at `0x28`, length at `0x2A`, payload
at `0x2C`, padded so that `(size - 40) % 256 == 0`.

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

Disk **writing** — images are read-only and the write-protect bit says so.
Several Agat-9 system disks print «СИСТЕМА ИСПОРЧЕНА» as a result.

Also absent: the Agat-7 ДопОЗУ extra-RAM card, NTSC artefact colour for the
Apple modes, 80-column/Videoterm/DHGR and Apple //e modes, cycle-accurate raster
splits, mouse, printer, SCSI, tape and clock.
