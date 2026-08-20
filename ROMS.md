# Bundled ROMs

`roms/roms.js` embeds eight binary blobs, ~9 KB gzipped, so that cloning the
repository and opening `index.html` is enough to run something. None of it is
ours. Regenerate with `python3 tools/build_roms.py --data <agat-emulator data dir>`.

| key | file | bytes | md5 |
|---|---|---|---|
| `monitor7` | `roms/monitor7.rom` | 2048 | `4af780cb333807b87dab689a813781ca` |
| `monitor9` | `roms/monitor9.rom` | 2048 | `011bfc048693e7f9dce33a44253477ac` |
| `teac` | `roms/teac.rom` | 256 | `6a3c80d51455d0187faeadebd136df26` |
| `shugart7` | `roms/shugart7.rom` | 256 | `31ec46c2d227320170353607ad1ac8ac` |
| `shugart9` | `roms/shugart9.rom` | 256 | `21f62cc6c64e0d01d19bc1f8e560ff81` |
| `mouse` | `roms/cm6337.rom` | 2048 | `99073a7dfe03a67a0c6625619b2c0844` |
| `font7` | `fnts/agathe7.fnt` | 2048 | `746e4e13e003f4d85be22c72c26fec7e` |
| `font9` | `fnts/agathe9.fnt` | 2048 | `3394cec9b91432a7e97da461a5e6a39f` |

Paths are relative to the data tree of **Agat Emulator** by NOP
(<https://sourceforge.net/projects/agatemulator/>, GPLv2), as shipped in its
`agat-emulator-data` package.

The same five ROMs are distributed with **AgatF** (Ravodin & co., 2010) under
different names, and are byte-for-byte identical — verified by the md5s above:

    teac.rom     == agatF-fd800.bin
    shugart7.rom == agatF-fd140-105.bin
    shugart9.rom == agatF-fd140-173.bin
    monitor7.rom == agatF-sysmon7.bin
    monitor9.rom == agatF-sysmon9.bin

The fonts are **not** interchangeable that way — AgatF's differ — so `--agatf`
is a fallback for the five ROMs and nothing else. `cm6337.rom` has no AgatF
fallback at all; see below.

The colour tables are not here: they are not ROMs but a property of the
monitor, live in `src/videopal.js`, and are transcribed from agatcomp.ru's
measurements rather than from either emulator's data package — see
[HARDWARE.md](HARDWARE.md#the-monitor-and-the-sixteen-colours).

### `mouse`: the printer card's ROM

`cm6337.rom` is the ROM of the Agat-9 printer card, which is what both parallel
mice plug into — agat-emulator loads it for `DEV_MOUSE_PAR` exactly as it does
for the printer (`mouse9.c` is `printer9.c` with the cable swapped). Only its
**last 256 bytes** are used here, which is the card's `$Cn00` page and where
`mouse9.c` reads that page from too (`pcs->rom[(adr & 0xFF) | 0x700]`). The
driver proper lives in the card's `$C800-$CFFF` expansion window, which nothing
here decodes, so a program that calls the ROM rather than driving the ports
itself will not work.

The page matters even unread: MouseGraf 4.4 identifies a parallel mouse by
scanning slot ROM pages for the `$18 $90` this one starts with, and will not
look at the ports of a card without it.

AgatF ships a 256-byte `agatF-mmars.bin` which is this same page **with 17 bytes
changed**: the real ROM's `JMP $C800` at `$Cn40` — the jump into the expansion
window — is replaced by NOPs and an inline return. That is a modified ROM, and
this table is for unmodified ones, so `tools/build_roms.py` deliberately has no
AgatF fallback for this key. Either page satisfies MouseGraf's scan, which is
all that is used here, so nothing is lost by preferring the original.

Both projects were also read to work out how the hardware behaves, and this
emulator would not exist without them. Specific debts are noted in the source
where they apply — `baseram.c` for the two memory maps, `videoprocs.c`,
`videosel7.c` and `videosel9.c` for the video, `fdd.c` and `fdd1.c` for the two
floppy controllers, and `dsk2nib.c` / `dsk2hfe.c` for the sector encoders.

The ROMs themselves are Soviet-era firmware whose copyright status is unclear;
they are redistributed here on the same basis as the two projects above. If you
are their rights holder and would rather they were not, please open an issue.
