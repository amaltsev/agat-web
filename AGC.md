# AGC — the Agat Container

Having the disk is not the same as knowing how to run it. Which machine — an
Agat-7 or an Agat-9, and with how much RAM? And which key on the keyboard in
front of you sends the byte the program is waiting for? None of that is in a
`.dsk`.

An `.agc` file is one program and everything needed to run it: the disk image
(with its patches, and with whatever a program has written to it), the machine,
the settings, and the keyboard.

It is JSON: everything a person writes or reads is text in the file, and only
the disk image inside it is packed — base64, gzipped when that makes it smaller,
which for an Agat disk is by ten times or more. Drop one on
[the emulator](https://amaltsev.github.io/agat-web/) and it runs.

The easiest way to get started is to load a bare image into the emulator and
press **Save AGC**: the container it writes is a text file you can edit.

---

## An example

```json
{
  "agc": 1,
  "title": "RISE OUT",
  "author": "Andrew Maltsev",
  "date": "1989",
  "url": "https://github.com/amaltsev/agat-web",
  "notes": "Carries the original 1989 sound data.",

  "machine": { "model": 7, "ram": 64 },

  "keys": {
    "KeyW": { "code": "^" }
  },
  "controls": {
    "Play": {
      "Up Down Left Right": "Move",
      "^": "Shoot right"
    }
  },
  "info": "A platform game written for the Agat-7 in 1989 and restored from the author's own tape.",
  "hint": "Press РУС at the title screen or the menu comes up in Latin.",

  "media": [
    {
      "name": "rise-out.dsk",
      "data": [
        "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2",
        "…"
      ],
      "patches": [ { "at": 45312, "hex": "A9 60 85 84" } ]
    }
  ]
}
```

Only `agc` is required, and in practice `media`: everything else has a sensible
default, and a container that carries nothing but an image is a valid one.

The `data` above is a 140K disk, and a real container carries one as `"gz"`
instead — the same bytes gzipped before the base64 — because that is ten times
smaller. [`media`](#media) describes both, and which one appears is only ever a
question of which is shorter.

---

## The fields

### Identity

| field | |
|---|---|
| `agc` | format version — `1`. Its presence is what identifies the file. |
| `title` | what the program is called |
| `author` | who wrote it |
| `date` | text, not a number: `"1989"`, `"circa 1985"`, `"1990-92"` |
| `url` | where it came from, or where it is written up |
| `notes` | provenance, credits, what a patch does. Ignored by the code. |

These fields are frequently the last place any of this is recorded. Fill them
in.

`title`, `author`, `date` and `url` are drawn on the **info card**, the last
thing on the page under the controls: the title, then who wrote it and when and
where it came from, with the `url` a link where it is `http`/`https` and printed
plainly where it is anything else. A container that names none of them, and
nothing below either, has no card — which is what a bare image gets.

Two more fields are drawn under that row, and they are the two the card is for:
[`info`](#info--what-the-program-is), which is what the program is at whatever
length that takes, and [`hint`](#hint--the-line-the-player-is-shown), the one
thing whoever is about to play has to be told, printed heavier because it is the
line worth acting on. `hint` inside a `keys` entry is the same word for one key
on the on-screen board.

`notes` is the odd one out: it is for the record and nothing reads it. Anything
the reader is meant to see is `info` or a hint; `notes` is the file talking to
whoever opens it.

### `machine`

| field | |
|---|---|
| `model` | `7` or `9` |
| `ram` | **base RAM in kilobytes**: `32`, `64` or `128`. Agat-7 only — the Agat-9 is always 128K. |
| `slots` | what this machine has that the model's stock complement does not. Optional. |

`ram` is base RAM on the motherboard, not the machine's total. It is not
cosmetic either: it is the only memory the video controller scans, and it masks
the video mode register's page field, so software can tell — a disk that expects
64K may fail on 128K.

The stock Agat-7 is **128K in three devices**: 64K of base RAM, a 32K ЭмПЗУ in
slot 2 and a 32K ОЗУ expansion in slot 4. The Agat-9 is 128K and two drives.
A container that wants that machine says nothing but `model` and `ram`.

#### `machine.slots`

Keyed by slot number, `0`-`7`. A slot not named keeps whatever the stock machine
puts there; `null` empties it.

```json
"machine": {
  "model": 7,
  "ram": 64,
  "slots": {
    "4": { "card": "xram", "ram": 128 },
    "2": null
  }
}
```

| field | |
|---|---|
| `card` | `"psrom"` (Agat-7 ЭмПЗУ), `"xram"` (Agat-7 ОЗУ expansion), `"xram9"` (Agat-9 ОЗУ expansion), `"fdd140"`, `"fdd840"`, `"mouse-nippel"`, `"mouse-mars"`, `"mouse-mars-rom"`, `"mouse-mm8031"` |
| `ram` | **kilobytes**, for the memory cards: `16`, `32`, `48`, `64` or `128` |

`card` is required: an entry that gives only a size names no card, and is
ignored.

A mouse is in no stock machine, so a program that wants one has to say
so — and which one, since the three speak different protocols and a
program supports the one it was written for (for example, MouseGraf 4.4
wants `mouse-nippel`, 1.6 `mouse-mars`).  `mouse-mars-rom` is the same
«Марсианка» on a printer card that carries its ROM page, which is a
different machine to the program looking for it: Klondike wants that one
and 1.6 will not touch it.  The slot is the container's to
choose; the page puts one in slot 6 on an Agat-7
and slot 4 on an Agat-9, which is what each model leaves free.

### The keyboard: `keys` and `controls`

Two blocks, and the difference between them is which side of the keyboard they
are indexed by.

| | indexed by | answers |
|---|---|---|
| `keys` | a **host key** — `KeyW`, `Space` | what to press, and what that key is for |
| `controls` | an **Agat code** — `^`, `$5E` | what the program reads, and what each code does |

`keys` puts an Agat code on a physical key of the keyboard in front of you, and
names the keys the program uses even where no remapping is needed. `controls`
does not touch the keyboard at all: it is the program's own list of codes,
grouped and captioned, which the page prints under the screen.

Either may appear alone. `keys` on its own gives the remap and a board winnowed
to the program's keys; `controls` on its own gives the panel and a board
winnowed to the codes it names, with nothing remapped. Together they answer both
halves of the same question, which is why `#kbd=used` draws them from both.

The left-hand sides look alike and are not: `"Space"` is a legal word in both,
and means the physical space bar in `keys` and the code `$20` in `controls`.

### `keys` — the keys the program uses

The Agat's keyboard is not your keyboard. A program that reads `^` is asking
for `$5E`, which in ЛАТ needs <kbd>Shift</kbd>+<kbd>6</kbd> and in РУС is on
<kbd>X</kbd>.

```json
"keys": {
  "KeyW": { "code": "^", "hint": "Shoot right" },
  "KeyA": "←",
  "Space": { "hint": "Jump" },
  "ArrowUp": null
}
```

The key on the left is a browser
[`KeyboardEvent.code`](https://developer.mozilla.org/docs/Web/API/UI_Events/Keyboard_event_code_values)
— `KeyW`, `Digit1`, `ArrowUp`, `Space` — which names a **physical key**, not a
character, so a remap is the same on any host layout. Every name this emulator
accepts, and what each of them sends unmapped, is in
[What each key sends](#what-each-key-sends).

The value is either the code to send, or `{ "code": …, "hint": … }`, or — with
no code at all — a declaration that the program uses the key **as it already
is**. `"Space": { "hint": "Jump" }` and a bare `"ArrowUp": null` change nothing
about what those keys send; they say that these are among the program's keys,
which is what the on-screen board's **Only mapped keys** view is drawn from. A
game whose controls need no remapping still has controls, and this is how it
names them.

A code may be written:

| form | example |
|---|---|
| the character itself | `"^"`, `"@"`, `"Ю"` |
| hex | `"$5E"`, `"0x5E"` |
| a name | `"Up"`, `"Down"`, `"Left"`, `"Right"`, `"Enter"`, `"Esc"`, `"Space"`, `"Tab"`, `"Bksp"`, `"F1"`, `"F2"`, `"F3"` |

Characters cover `$20`–`$7F`, which is ASCII plus the Agat's Cyrillic band in
KOI-7 N2 order, so `"Ю"` and `"Ч"` work as written. The one trap is `$24`, which
the Agat draws as `¤` rather than `$`: write it as `"¤"` or as `"$24"`.

A remapped key **takes that key over completely**: it sends its code in both
layouts and with or without <kbd>Shift</kbd> or <kbd>Ctrl</kbd>. A movement key
that changed meaning because a modifier was being held would be worse than no
remap at all. What the key used to send is unreachable while the container is
loaded, so remap keys the program does not otherwise need.

The `hint` says what the key *does*. It is the half worth writing: the on-screen
keyboard shows it, so hovering `^` reads **`W (Shoot right)`** rather than
leaving someone to work it out.

Naming every key a program uses, remapped or not, is what the winnowed board
needs: the machine's caps, with every one no listed key reaches shrunk to a
sliver, so the keys that are left keep the positions the Agat gives them. It is
drawn as three areas that collapse on their own — the typewriter, the arrows and
the numeric pad — so a program that uses none of the pad is not shown one, and
naming a single arrow brings the whole cluster. The board's own controls (СБР,
УПР, РУС/LAT, РЕГ) are not drawn: they are not the program's keys, and on a
phone they were most of the screen.

The menu offers this board only for a container that names keys or controls, and
on a handheld it is what such a container opens with.
`node tools/check.js keys <file.agc>` draws it in a terminal.

### `controls` — what the program reads, and what for

```json
"controls": {
  "Play": {
    "Up Down Left Right": "Движение",
    "Space": "Стоп",
    "^": "Выстрел вправо"
  },
  "Cheats": { "K": "Самоубийство", "К": "Конец игры" }
}
```

Groups in the order the file lists them, rows in the order the group lists them.
A row's key is **one or more codes separated by spaces**, written any of the ways
[above](#keys--the-keys-the-program-uses) — so the arrow cluster is one line
rather than four, and `"Space Enter"` is one line for a program that takes
either. The value is what that row *does*; `true` means a control worth naming
with nothing to add.

**Codes, never combinations.** The Agat keyboard is an encoder that puts one byte
in `$C000`. РЕГ adds `$20` across the letter block — that is why the caps are
dual-legend — so what a person calls РЕГ+К is the single code `$6B`, written
`"К"` or `"$6B"`. УПР collapses the same way into `$81`–`$9F`. There is nothing
a `+` could mean here, and it is not accepted.

Three things read this block:

- **The controls panel**, under the screen: a card of the groups, side by side.
  It is deliberately static. It prints what the *program* reads — `Q` is `$51`
  whatever is switched on — and the board beside it answers the other half, which
  host key reaches that code right now. The only host key on the panel is a
  container remap, `^ (W)`, because a remap holds in every plane and so is the
  only one that does not move under ЛАТ/РУС.
- **The winnowed board**, which takes the codes named here together with the ones
  the `keys` block reaches.
- **The keyboard menu**, which gains an entry per group, so the board can be cut
  to just the part of the game in hand. That choice rides in the address:
  `#kbd=used%3ACheats`. Tapping a group on the panel picks the same thing with a
  finger, and tapping the one already showing goes back to all of them.

Two traps worth knowing:

- **Do not name a group or a control with a bare digit.** JSON objects iterate
  integer-like keys first whatever the file says, so a control written `"1"`
  jumps to the front of its group. Write it `"$31"`.
- **Two controls can land on one cap.** `K` and `К` are the unshifted and
  shifted halves of a single Agat cap, so a container naming both gets one key
  on the board. It is drawn with both halves underlined and names both in its
  tooltip, and the board grows a **РЕГ** cap — the one control it otherwise
  never draws — because without a register the shifted half could not be
  reached by touch at all. Tap РЕГ, then the key. It is a one-shot, as it has to
  be with one finger, and it appears only when some cap needs it.

`node tools/check.js keys <file.agc>` prints the panel and the board together,
and `--group=NAME` cuts them the way the menu does.

### `info` — what the program is

```json
"info": "A platform game written for the Agat-7 in 1989 and restored from the author's own tape."
```

The description, printed under the author-date-url row. As long as it needs to
be: what the program does, who it was for, which release this is, what a patch
in it changed — the things a title has no room for and `notes` used to have to
swallow. A container that carries only this gets a card with only this on it.

Same **plain text** rule as the hint below, and the same reason: whitespace
collapses to one paragraph, and markup is printed rather than obeyed.

`info` and `notes` are easy to mix up, and the split is who is reading. `info`
is shown, so it is written for whoever opens the program; `notes` is not, so it
is written for whoever opens the file.

### `hint` — the line the player is shown

```json
"hint": "Press РУС at the title screen or the menu comes up in Latin."
```

One sentence or two, printed at the foot of the info card, and printed heavier
than the rest of it: it is the line worth acting on rather than reading. It is
for the thing no list of codes can say: which layout the program comes up in,
that the first disk is the one to boot, that the pause key is also the quit key.
A container with a hint and nothing else still gets the line — the card is drawn
for any one of the six things on it.

**Plain text.** No paragraph breaks, no Markdown, no HTML: the page prints it as
text, so a `<b>` shows up as `<b>`. Whitespace collapses, so a hint wrapped
across lines in the file is one line on the screen and is written back as one.

It is the same word as a key's `hint`, and the same rule: a hint is shown. This
one is the container's, and `keys.<key>.hint` is one key's. `notes` is the other
kind — the record, which nothing reads. A container can carry all three.

`node tools/check.js keys <file.agc>` prints the card under the panel, ending in
the hint, where the page puts both.

### `media`

A list, loaded in order. Disks go to whichever drive can read them; a `.fil` is
poked straight into memory.

| field | |
|---|---|
| `name` | the original filename. The **format is detected by size, not by this** — Agat images in the wild are routinely misnamed. |
| `data` | base64, as an array of lines |
| `gz` | the same bytes gzipped, then base64. `data` or `gz`, never both. |
| `patches` | changes to apply after decoding, in order; hex, base64 or gzipped |

Lines are 76 characters, which is 57 bytes and a whole number of base64 groups,
so each line stands on its own. A single long string is accepted on reading;
hand-wrapped lines of any width are too.

**`data` or `gz` is a size decision**, and the writer makes it: gzip is used
when it saves at least a tenth, and `data` otherwise. An Agat disk is mostly
empty and shrinks by ten times or more — a 140K disk that costs 208K as base64
costs 20K as `gz`, which is the difference between a container that costs more
than the disk it carries and one that costs a tenth of it. A `.fil` of packed
code may not clear the bar, and then it stays readable. Nothing else in a
container is ever compressed: the fields a person reads and edits are text
either way, and they are a few hundred bytes.

To read a `gz`: base64-decode it, then gunzip. On the command line, taking a
container's first payload apart is

```sh
python3 -c 'import json,sys;print("".join(json.load(open(sys.argv[1]))["media"][0]["gz"]))' \
  game.agc | base64 -d | gunzip > game.dsk
```

Anything the emulator takes, a container carries: `.aim`, `.dsk` and `.nib` at
140K and 840K, and `.fil` programs. A container inside a container is refused.

### `patches`

```json
"patches": [ { "at": 45312, "hex": "A9 60 85 84" },
             { "at": 46080, "data": ["…", "…"] },
             { "at": 49152, "gz":   ["…", "…"] } ]
```

`at` is a byte offset into the decoded payload, and the bytes to write are one
of `hex` — whitespace and commas allowed, so they can be grouped the way they
mean something — `data`, base64 in the same wrapped form as a payload, or `gz`,
gzipped and then base64. A reader takes all three. A record that gives two at
once is an error, not a preference to resolve.

The writer picks by size, and it is the same rule the payload gets: up to 32
bytes hex, above that whichever of base64 and gzip is smaller by a tenth. A poke
stays something to read, a rewritten sector does not cost three characters a
byte, and a rewritten track — 6K of base64 — drops by a third again. In practice
dense 6502 code under a kilobyte stays `data`, and a written disk track goes to
`gz`.

Any other key on a patch record is left alone — a container is hand-edited, and
a `"why"` beside the bytes should survive being loaded and saved.

The payload stays **the image exactly as it was found**, and changes live here.
That is the whole point of the split: a container carries a pristine copy of
what it came from, the change is legible to anyone reading the file, and saving
a container that was loaded writes back what it carried rather than the patched
result.

**What a program writes to a disk is saved the same way.** A 140K drive that has
been unlocked writes to the nibble stream in memory; saving reads each written
track back into the 16 sectors it was built from and records the difference
here. A game that keeps a high score costs a patch of a few hundred bytes — one
base64 block, by the size rule above — rather than a second copy of the disk.

A track that will not read back as sectors — a disk formatted some other way, a
write caught half done — has no sector image for a patch to be the difference
from. Then the whole nibble stream is saved instead, as a `.nib` payload with no
patches. It is a bigger file, but not a lossy one, and it reloads without any of
this having to know: media are identified by size.

---

## Making one

### From the emulator

**Save AGC** writes a container from the machine as it stands: what is in the
drives, the model and RAM, the live remap, and anything a program has written
to an unlocked disk. It asks nothing — including about compression, which is
decided per payload and per patch by whether it pays.

A container that was loaded from a file keeps its own title and filename. One
made from a bare image takes the image's name for both, so `game.dsk` saves as
`game.agc` titled `game.dsk` — rename it, and open it in a text editor to add an
author, a date and the keys.

### From the command line

```sh
node tools/mkagc.js game.dsk \
  --title="…" --author="…" --date=1989 --url=https://… \
  --model=7 --ram=64 --info="A platform game of 1989." \
  --hint="Press РУС at the title screen." \
  --key="KeyW:^:Shoot right" > game.agc
```

`--key` is `CODE:VALUE:HINT`, split on the first two colons, and may be repeated.
`--patch=AT:HEX` states a patch directly; `--diff=<modified image>` works the
patches out by comparing a changed copy against the original, which is how a
patch is usually arrived at.

`--plain` writes every payload and patch as base64 whatever it costs, for a
container meant to be hand-edited or read in a diff; `--gz` compresses even
where the saving is slight. Left alone, the size rule decides.

---

## Loading one

Drop it on the page, or use **Open…**, or name it in the address:

    index.html#agc=examples/rise-out.agc

The address form fetches the file, so it needs a served page — `fetch` is
blocked on `file://`, where **Open…** is the way in. The address's other keys go
into the machine the container builds rather than on top of it, so
`#agc=…&model=9` tries the program on the other machine without editing the
file, and the other machine is the one it boots on.

Every command-line tool takes a container wherever it takes an image, and runs
it on the machine the container names:

```sh
node tools/check.js sniff game.agc    # what it says it is
node tools/check.js boot  game.agc    # boot it and report where it got to
node tools/shot.js        game.agc    # boot it and write a PNG
```

---

## What each key sends

Every name below is accepted on the left of `keys`; anything else is ignored,
and the status line says which. The columns are what the key sends **when it is
not remapped**, which is also what a key declared as-is goes on sending.

Each cell gives the glyph the Agat draws and the code itself, written the way
`keys` and `controls` take it. The byte in `$C000` always has bit 7 set, so
`$40` and `$C0` are the same key; the tables give the 7-bit form wherever there
is a glyph to go with it.

A letter's two halves are one byte in two character sets: РЕГ adds exactly `$20`
across the block, which moves ASCII `@A-Z[\]^_` into the Agat's Cyrillic band in
KOI-7 N2 order. That is why both legends fit on one cap, and why `Ч` is РУС
<kbd>X</kbd> and nothing at all in ЛАТ.

Codes with no glyph are given in hex, written the way `keys` takes them. `—` is
a key the table maps to nothing: `Insert`, `Delete` and `F4`-`F12` are free to
take over, since nothing is lost. `Backspace` and `ArrowLeft` both send `$88`,
which is the machine having one `←`.

**Letters — these follow ЛАТ/РУС and РЕГ**

| `code` | ЛАТ | ЛАТ+РЕГ | РУС | РУС+РЕГ |
|---|---|---|---|---|
| `KeyQ` | Q $51 | Я $71 | J $4A | Й $6A |
| `KeyW` | W $57 | В $77 | C $43 | Ц $63 |
| `KeyE` | E $45 | Е $65 | U $55 | У $75 |
| `KeyR` | R $52 | Р $72 | K $4B | К $6B |
| `KeyT` | T $54 | Т $74 | E $45 | Е $65 |
| `KeyY` | Y $59 | Ы $79 | N $4E | Н $6E |
| `KeyU` | U $55 | У $75 | G $47 | Г $67 |
| `KeyI` | I $49 | И $69 | [ $5B | Ш $7B |
| `KeyO` | O $4F | О $6F | ] $5D | Щ $7D |
| `KeyP` | P $50 | П $70 | Z $5A | З $7A |
| `KeyA` | A $41 | А $61 | F $46 | Ф $66 |
| `KeyS` | S $53 | С $73 | Y $59 | Ы $79 |
| `KeyD` | D $44 | Д $64 | W $57 | В $77 |
| `KeyF` | F $46 | Ф $66 | A $41 | А $61 |
| `KeyG` | G $47 | Г $67 | P $50 | П $70 |
| `KeyH` | H $48 | Х $68 | R $52 | Р $72 |
| `KeyJ` | J $4A | Й $6A | O $4F | О $6F |
| `KeyK` | K $4B | К $6B | L $4C | Л $6C |
| `KeyL` | L $4C | Л $6C | D $44 | Д $64 |
| `KeyZ` | Z $5A | З $7A | Q $51 | Я $71 |
| `KeyX` | X $58 | Ь $78 | ^ $5E | Ч $7E |
| `KeyC` | C $43 | Ц $63 | S $53 | С $73 |
| `KeyV` | V $56 | Ж $76 | M $4D | М $6D |
| `KeyB` | B $42 | Б $62 | I $49 | И $69 |
| `KeyN` | N $4E | Н $6E | T $54 | Т $74 |
| `KeyM` | M $4D | М $6D | X $58 | Ь $78 |

**Digits and punctuation — these follow ЛАТ/РУС and РЕГ**

| `code` | ЛАТ | ЛАТ+РЕГ | РУС | РУС+РЕГ |
|---|---|---|---|---|
| `Digit1` | 1 $31 | ! $21 | 1 $31 | ! $21 |
| `Digit2` | 2 $32 | @ $40 | 2 $32 | " $22 |
| `Digit3` | 3 $33 | # $23 | 3 $33 | # $23 |
| `Digit4` | 4 $34 | ¤ $24 | 4 $34 | ; $3B |
| `Digit5` | 5 $35 | % $25 | 5 $35 | % $25 |
| `Digit6` | 6 $36 | ^ $5E | 6 $36 | : $3A |
| `Digit7` | 7 $37 | & $26 | 7 $37 | ? $3F |
| `Digit8` | 8 $38 | * $2A | 8 $38 | * $2A |
| `Digit9` | 9 $39 | ( $28 | 9 $39 | ( $28 |
| `Digit0` | 0 $30 | ) $29 | 0 $30 | ) $29 |
| `Minus` | - $2D | _ $5F | - $2D | - $2D |
| `Equal` | = $3D | + $2B | = $3D | + $2B |
| `BracketLeft` | [ $5B | Ш $7B | H $48 | Х $68 |
| `BracketRight` | ] $5D | Щ $7D | _ $5F | Ъ $7F |
| `Semicolon` | ; $3B | : $3A | V $56 | Ж $76 |
| `Quote` | ' $27 | " $22 | \ $5C | Э $7C |
| `Backquote` | @ $40 | ^ $5E | @ $40 | ^ $5E |
| `Backslash` | \ $5C | Э $7C | \ $5C | Э $7C |
| `Comma` | , $2C | < $3C | B $42 | Б $62 |
| `Period` | . $2E | > $3E | @ $40 | Ю $60 |
| `Slash` | / $2F | ? $3F | . $2E | , $2C |

**Editing — one code, whatever the layout**

| `code` | sends | `code` | sends |
|---|---|---|---|
| `Escape` | Esc $9B | `Enter` | ↵ $8D |
| `Backspace` | ← $88 | `Space` | space $20 |
| `Tab` | Tab $89 |  |  |

**Arrows and the nav cluster — one code, whatever the layout**

| `code` | sends | `code` | sends |
|---|---|---|---|
| `ArrowUp` | ↑ $99 | `End` | $8A |
| `ArrowLeft` | ← $88 | `PageUp` | ↑ $99 |
| `ArrowRight` | → $95 | `PageDown` | ↓ $9A |
| `ArrowDown` | ↓ $9A | `Insert` | — |
| `Home` | $8B | `Delete` | — |

**Function keys — one code, whatever the layout**

| `code` | sends | `code` | sends |
|---|---|---|---|
| `F1` | F1 $84 | `F7` | — |
| `F2` | F2 $85 | `F8` | — |
| `F3` | F3 $86 | `F9` | — |
| `F4` | — | `F10` | — |
| `F5` | — | `F11` | — |
| `F6` | — | `F12` | — |

**The numeric pad — one code, whatever the layout**

| `code` | sends | `code` | sends |
|---|---|---|---|
| `NumpadMultiply` | * $2A | `NumpadAdd` | + $2B |
| `Numpad7` | $90 | `Numpad1` | $9D |
| `Numpad8` | $91 | `Numpad2` | $9E |
| `Numpad9` | $92 | `Numpad3` | $9F |
| `NumpadSubtract` | - $2D | `Numpad0` | $81 |
| `Numpad4` | $93 | `NumpadDecimal` | $82 |
| `Numpad5` | $94 | `NumpadEnter` | $83 |
| `Numpad6` | $9C | `NumpadDivide` | / $2F |

---

## Notes for implementers

- The version is `agc`. A reader should refuse a file whose version it does not
  know rather than guess at it. There is only the one so far: compression
  arrived without moving it, because which encoding a record uses is written in
  the record and needs no number to tell it apart.
- Identify a container by the `agc` key, not by the extension.
- Unknown fields should be left alone, not dropped. A container is often
  hand-edited, and a reader that silently discards what it does not understand
  will eventually eat someone's notes.
- `ram` is in kilobytes and `date` is a string. Both are the kind of thing that
  is easy to guess wrong in a second implementation.
- `info` and `hint` are shown and `notes` is not. Keep all three, and do not let
  one be read as another: they are the same kind of prose written for different
  readers, and a reader that folds them together loses which is which for good.
- A payload carries `data` or `gz`, and a patch one of `hex`, `data` or `gz` —
  never two. Read any of them; refuse a record that gives more than one.
- Which encoding to *write* is a size decision and nothing else. The forms mean
  the same bytes, so a reader must take whichever it is handed, and a writer
  that only ever emitted `data` would still produce files this one reads.

The reference implementation is [`src/agc.js`](src/agc.js) — about 500 lines,
no dependencies, and the same file reads and writes. Both directions are
asynchronous there, because gzip in a browser is a stream; everything between
them works in plain bytes, and a patch in memory is `{ at, bytes }`.
