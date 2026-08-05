# Bundled ROMs

`roms/roms.js` embeds eight binary blobs, ~8 KB gzipped, so that cloning the
repository and opening `index.html` is enough to run something. None of it is
ours. Regenerate with `python3 tools/build_roms.py --data <agat-emulator data dir>`.

| key | file | bytes | md5 |
|---|---|---|---|
| `monitor7` | `roms/monitor7.rom` | 2048 | `4af780cb333807b87dab689a813781ca` |
| `monitor9` | `roms/monitor9.rom` | 2048 | `011bfc048693e7f9dce33a44253477ac` |
| `teac` | `roms/teac.rom` | 256 | `6a3c80d51455d0187faeadebd136df26` |
| `shugart7` | `roms/shugart7.rom` | 256 | `31ec46c2d227320170353607ad1ac8ac` |
| `shugart9` | `roms/shugart9.rom` | 256 | `21f62cc6c64e0d01d19bc1f8e560ff81` |
| `font7` | `fnts/agathe7.fnt` | 2048 | `746e4e13e003f4d85be22c72c26fec7e` |
| `font9` | `fnts/agathe9.fnt` | 2048 | `3394cec9b91432a7e97da461a5e6a39f` |
| `palette` | `palette/16colorshigh.pal` | 166 | `3c9ca4527edd3001132d9e99aebde0ef` |

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

Both projects were also read to work out how the hardware behaves, and this
emulator would not exist without them. Specific debts are noted in the source
where they apply — `baseram.c` for the two memory maps, `videoprocs.c`,
`videosel7.c` and `videosel9.c` for the video, `fdd.c` and `fdd1.c` for the two
floppy controllers, and `dsk2nib.c` / `dsk2hfe.c` for the sector encoders.

The ROMs themselves are Soviet-era firmware whose copyright status is unclear;
they are redistributed here on the same basis as the two projects above. If you
are their rights holder and would rather they were not, please open an issue.
