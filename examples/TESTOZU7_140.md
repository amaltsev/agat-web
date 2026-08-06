# ТЕСТ ПАМЯТИ — the factory memory test

`TESTOZU7_140.dsk` is the Agat-7 memory test as shipped by the manufacturer: a
bootable 140K disk that asks you to **declare** the machine's memory
configuration and then verifies that the machine really is that. That makes it
worth more than any assertion written here, because it was written against the
hardware rather than against a reading of an emulator's source.

It is the reason `src/xram7.js` exists — its **ДОПОЗУ** branch had nothing to
talk to until the ОЗУ expansion card was emulated.

## Running it

Drop it on the page, pick it from the examples line, or:

    index.html#model=7&agc=examples/TESTOZU7_140.dsk

It boots straight into the questions. Answer each with a single key; there is no
Return.

### 1. `ЗАДАЙТЕ КОНФИГУРАЦИЮ?` — which memory to test

| | |
|---|---|
| `1` | ОЗУ — base RAM on the motherboard |
| `2` | ДОПОЗУ — the ОЗУ expansion card |
| `3` | ОЗУ и ДОПОЗУ |
| `4` | ПЗУ — the ЭмПЗУ card |
| `5` | ОЗУ и ПЗУ |
| `6` | ДОПОЗУ и ПЗУ |
| `7` | ОЗУ, ДОПОЗУ и ПЗУ |

The manual's footnote: ОЗУ means the memory-and-interface cell, while ДОПОЗУ and
ПЗУ mean a RAM cell switched into extra-memory or ROM-emulator mode. In this
emulator's terms they are base RAM, the slot-4 card and the slot-2 card.

### 2. `ЗАДАЙТЕ НОМЕР РАЗЪЕМА?` — which slot

Asked only for ДОПОЗУ and ПЗУ, and takes `1` to `6`. On the stock machine here
that is **`4`** for the ДОПОЗУ and **`2`** for the ЭмПЗУ.

### 3. `ЗАДАЙТЕ ИСПОЛНЕНИЕ?` — how big the cell is

**`0` = 32K, `1` = 64K, `2` = 128K.** It starts at zero, which is easy to miss;
32K is the stock fitting for all three devices here.

Each question is prefixed with the cell it is about, so a combined configuration
asks the pair once per cell: `ПЗУ:ЗАДАЙТЕ ИСПОЛНЕНИЕ?`

### 4. `ЗАДАЙТЕ РЕЖИМ РАБОТЫ?` — how long to run

| | |
|---|---|
| `0` | fault diagnosis — sixteen passes of every test but "Шум", then 256 of "Шум", then it stops on its own |
| `1` | functional check — every test but "Шум", repeating until you intervene |

## Reading the result

The bar under the header is progress, and the counter beside the cell's name is
the pass number. **A clean run just advances the pass counter.** A failure prints
lines of

    Т255:БАНК 00:805E=34(B4)

which is test, bank, address, the byte read, and the byte expected in brackets.

## Headless

`tools/shot.js` takes the answers as its key string and can override the memory,
so a configuration can be declared to the test and contradicted in the emulator —
which is how you confirm the test is really reaching the card rather than
agreeing with itself:

```sh
node tools/shot.js examples/TESTOZU7_140.dsk 101  --model=7   # ОЗУ,    32K
node tools/shot.js examples/TESTOZU7_140.dsk 2401 --model=7   # ДОПОЗУ, slot 4, 32K
node tools/shot.js examples/TESTOZU7_140.dsk 4201 --model=7   # ПЗУ,    slot 2, 32K

node tools/shot.js examples/TESTOZU7_140.dsk 2401 --model=7 --xram=16   # must fail
```

All three pass on the stock Agat-7. **Base RAM above 32K does not**: `--ram=64`
under исполнение 1 and `--ram=128` under исполнение 2 both report errors beneath
`БАНК F0`. That predates the expansion card — it reproduces on the commit before
`xram7.js` was added — and is not yet explained.

## Where it came from

[agatcomp.su — Агат-7, комплект 5](https://agatcomp.su/agat/Paper/DocsShtat/A7_K5.shtml),
which has the disk and the 1986 factory manual it is documented in. The answers
above are transcribed from that manual.

Its licence is unknown. It is bundled here on the assumption that a Soviet
factory diagnostic from 1986 is about as close to public domain as anything
gets, and not as part of the MIT-licensed emulator — see the Licence section of
[README.md](../README.md). If the rights holder would rather it were not here,
it will be removed.
