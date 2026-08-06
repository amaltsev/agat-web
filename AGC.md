# AGC — the Agat Container

*По-русски: [AGC.ru.md](AGC.ru.md).*

An `.agc` file is one program and everything needed to run it: the disk image,
the machine, the settings, and the keyboard.

Having the disk is not the same as knowing how to run it. Which machine — an
Agat-7 or an Agat-9, and with how much RAM? Which interrupt model, given that
the wrong one moves a game's music by an octave? And which key on the keyboard
in front of you sends the byte the program is waiting for? None of that is in a
`.dsk`, and it is usually written down nowhere at all. A container holds it
next to the image, in one file that a person can read and edit.

It is JSON. Drop one on [the emulator](https://amaltsev.github.io/agat-web/) and
it runs.

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
  "quirks":  { "irq": "raster", "rate": 0 },

  "keys": {
    "KeyW": { "code": "^", "note": "Shoot right" }
  },

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

---

## The fields

### Identity

| field | |
|---|---|
| `agc` | format version — `1`. Its presence is what identifies the file. |
| `title` | what the program is called |
| `author` | who wrote it |
| `date` | **text**, not a number: `"1989"`, `"circa 1985"`, `"1990-92"` |
| `url` | where it came from, or where it is written up |
| `notes` | prose — provenance, credits, what a patch does. Ignored by the code. |

`date` is text because what is known about a program of this age is as often a
range or a guess as it is a year, and a container that cannot say "circa 1985"
would force someone to say `1985` and be wrong.

These fields are frequently the last place any of this is recorded. Fill them
in.

### `machine`

| field | |
|---|---|
| `model` | `7` or `9` |
| `ram` | **kilobytes**: `32`, `64` or `128`. Agat-7 only — the Agat-9 is always 128K. |

The RAM size is not cosmetic: it masks the video mode register's page field, so
software can tell, and a disk that expects 64K may fail on 128K.

A machine named here is treated as *chosen* — a `7a` or `9a` in a filename will
not override it.

### `quirks`

| field | |
|---|---|
| `irq` | `"raster"`, `"held"` or `"pulse"` — how the sub-frame interrupt reaches the CPU |
| `rate` | sub-frame interrupt in Hz; `0` means the machine's own default |

`raster` is the hardware as measured, and it sets its own rate, so `rate` is
ignored under it. The other two are agat-emulator's readings, kept for
comparison — see
[HARDWARE.md](HARDWARE.md#the-delivery-model).

This matters for anything that sequences sound on the interrupt count, which is
most Agat music: the pitch and the tempo come straight off this setting, and
`held` and `raster` are an octave apart.

### `keys` — the keyboard remap

The Agat's keyboard is not your keyboard. A program that reads `^` is asking
for `$5E`, which in ЛАТ needs <kbd>Shift</kbd>+<kbd>6</kbd> and in РУС is on
<kbd>X</kbd> — findable, but not while something is shooting at you.

```json
"keys": {
  "KeyW": { "code": "^", "note": "Shoot right" },
  "KeyA": "←"
}
```

The key on the left is a browser
[`KeyboardEvent.code`](https://developer.mozilla.org/docs/Web/API/UI_Events/Keyboard_event_code_values)
— `KeyW`, `Digit1`, `ArrowUp`, `Space` — which names a **physical key**, not a
character, so a remap is the same on any host layout.

The value is either the code to send, or `{ "code": …, "note": … }`. A code may
be written:

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

The `note` says what the key *does*. It is the half worth writing: the on-screen
keyboard shows it, so hovering `^` reads **`W (Shoot right)`** rather than
leaving someone to work it out, and a later "only the keys this game uses" mode
will be built from these.

### `media`

A list, loaded in order. Disks go to whichever drive can read them; a `.fil` is
poked straight into memory.

| field | |
|---|---|
| `name` | the original filename. The **format is detected by size, not by this** — Agat images in the wild are routinely misnamed. |
| `data` | base64, as an array of lines |
| `patches` | changes to apply after decoding, in order |

`data` is plain base64 — not compressed, so a container stays a text file that
ordinary tools can look inside. Lines are 76 characters, which is 57 bytes and a
whole number of base64 groups, so each line stands on its own. A single long
string is accepted on reading; hand-wrapped lines of any width are too.

Anything the emulator takes, a container carries: `.aim`, `.dsk` and `.nib` at
140K and 840K, and `.fil` programs. A container inside a container is refused.

### `patches`

```json
"patches": [ { "at": 45312, "hex": "A9 60 85 84" } ]
```

`at` is a byte offset into the decoded payload and `hex` the bytes to write —
whitespace and commas allowed, so bytes can be grouped the way they mean
something.

The payload stays **the image exactly as it was found**, and changes live here.
That is the whole point of the split: a container carries a pristine copy of
what it came from, the change is legible to anyone reading the file, and saving
a container that was loaded writes back what it carried rather than the patched
result.

---

## Making one

### From the emulator

**Save AGC** writes a container from the machine as it stands: what is in the
drives, the model and RAM, both interrupt settings, and the live remap. It asks
nothing.

A container that was loaded from a file keeps its own title and filename. One
made from a bare image takes the image's name for both, so `game.dsk` saves as
`game.agc` titled `game.dsk` — rename it, and open it in a text editor to add an
author, a date and the keys.

### From the command line

```sh
node tools/mkagc.js game.dsk \
  --title="…" --author="…" --date=1989 --url=https://… \
  --model=7 --ram=64 --irq=raster \
  --key="KeyW:^:Shoot right" > game.agc
```

`--key` is `CODE:VALUE:NOTE`, split on the first two colons, and may be repeated.
`--patch=AT:HEX` states a patch directly; `--diff=<modified image>` works the
patches out by comparing a changed copy against the original, which is how a
patch is usually arrived at.

---

## Loading one

Drop it on the page, or use **Open…**, or name it in the address:

    index.html#agc=examples/rise-out.agc

The address form fetches the file, so it needs a served page — `fetch` is
blocked on `file://`, where **Open…** is the way in. A container is applied
first and the address's other keys after it, so `#agc=…&model=9` tries the
program on the other machine without editing the file.

Every command-line tool takes a container wherever it takes an image, and runs
it on the machine the container names:

```sh
node tools/check.js sniff game.agc    # what it says it is
node tools/check.js boot  game.agc    # boot it and report where it got to
node tools/shot.js        game.agc    # boot it and write a PNG
```

---

## Notes for implementers

- The version is `agc`. A reader should refuse a file whose version it does not
  know rather than guess at it.
- Identify a container by the `agc` key, not by the extension.
- Unknown fields should be left alone, not dropped. A container is often
  hand-edited, and a reader that silently discards what it does not understand
  will eventually eat someone's notes.
- `ram` is in kilobytes and `date` is a string. Both are the kind of thing that
  is easy to guess wrong in a second implementation.

The reference implementation is [`src/agc.js`](src/agc.js) — about 200 lines,
no dependencies, and the same file reads and writes.
