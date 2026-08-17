#!/usr/bin/env python3
"""Build a sound and interrupt test disk for any Agat emulator.

The point is to take RISE OUT out of the picture. It installs its own IRQ handler
on the sub-frame video interrupt, counts interrupts, and flips the speaker every
N of them for exactly 1000 interrupts, then stays silent for 500, then moves to
the next N. The table is 1, 2, 4, round and round.

Every number is derived from the interrupt alone, so the pitches say what the
interrupt rate is and the tone lengths say whether the counting is right. Two
emulators that disagree about either will not sound the same — which is the whole
reason for the disk, since the emulator under test cannot be asked to measure
itself.

Where the sub-frame interrupt is a level, as it is on the hardware and here, the
handler re-enters for as long as the line counter holds IRQ down, so the carrier
is the handler's own length and not the assertion rate: three brief tones near
7400, 3950 and 2050 Hz, the whole round about 0.7 s. An emulator that takes the
IRQ as an edge enters once per assertion instead and drops to that rate over 2, 4
and 8 — for the 1 kHz free-running timer some of them use, three leisurely
one-second tones at 500, 250 and 125 Hz.

The disk is not shipped: it is a diagnostic to be carried to another emulator,
and it is a few seconds to rebuild. It writes to $TMPDIR unless given a path.

It installs its handler the Apple way, through the monitor: the Agat-7's IRQ
vector at $FFFE points into ROM at $FA26, which saves A in $45 and then does
JMP ($03FE). So the handler address goes in $03FE/$03FF and the program needs no
ЭмПЗУ card and no particular slot configuration — which matters, because a test
that depends on the machine's setup cannot be used to compare two emulators.
"""
import sys, os, tempfile

# --- a two-pass assembler, only the modes this program uses ------------------

IMPL = {'sei': 0x78, 'cli': 0x58, 'rti': 0x40, 'rts': 0x60, 'pha': 0x48,
        'pla': 0x68, 'tax': 0xaa, 'txa': 0x8a, 'nop': 0xea}
IMM  = {'lda': 0xa9, 'ldx': 0xa2, 'ldy': 0xa0, 'cmp': 0xc9}
ZP   = {'lda': 0xa5, 'sta': 0x85, 'cmp': 0xc5, 'dec': 0xc6, 'inc': 0xe6,
        'ldx': 0xa6, 'stx': 0x86}
ABS  = {'lda': 0xad, 'sta': 0x8d, 'jmp': 0x4c, 'jsr': 0x20,
        'ldx': 0xae, 'stx': 0x8e}
ABSX = {'lda': 0xbd}
BRA  = {'bne': 0xd0, 'beq': 0xf0, 'bcc': 0x90, 'bcs': 0xb0}


def assemble(src, org):
    labels, out = {}, bytearray()
    for pass_no in (0, 1):
        pc, out = org, bytearray()
        for raw in src.splitlines():
            line = raw.split(';')[0].strip()
            if not line:
                continue
            if line.endswith(':'):
                labels[line[:-1]] = pc
                continue
            if '=' in line:
                name, val = line.split('=')
                labels[name.strip()] = value(val.strip(), labels, 0)
                continue
            parts = line.split(None, 1)
            op = parts[0].lower()
            arg = parts[1].strip() if len(parts) > 1 else ''

            if op == 'dfb':
                bs = [value(x.strip(), labels, pass_no) & 0xff for x in arg.split(',')]
                out += bytes(bs); pc += len(bs); continue
            if op in IMPL and not arg:
                out.append(IMPL[op]); pc += 1; continue
            if op in BRA:
                target = value(arg, labels, pass_no)
                off = target - (pc + 2)
                if pass_no and not -128 <= off <= 127:
                    raise SystemExit(f'branch out of range at ${pc:04X}: {line}')
                out += bytes([BRA[op], off & 0xff]); pc += 2; continue
            if arg.startswith('#'):
                out += bytes([IMM[op], value(arg[1:], labels, pass_no) & 0xff])
                pc += 2; continue
            if arg.lower().endswith(',x'):
                v = value(arg[:-2], labels, pass_no)
                out += bytes([ABSX[op], v & 0xff, v >> 8]); pc += 3; continue
            v = value(arg, labels, pass_no)
            # Zero page only when the operand is genuinely in page zero, never
            # for a forward reference that has not been resolved yet.
            if v < 0x100 and op in ZP and not (pass_no == 0 and arg[0].isalpha()
                                               and arg not in labels):
                out += bytes([ZP[op], v]); pc += 2
            else:
                out += bytes([ABS[op], v & 0xff, v >> 8]); pc += 3
    return bytes(out)


def value(tok, labels, pass_no):
    tok = tok.strip()
    if tok.startswith('<'):
        return value(tok[1:], labels, pass_no) & 0xff
    if tok.startswith('>'):
        return (value(tok[1:], labels, pass_no) >> 8) & 0xff
    if tok.startswith('$'):
        return int(tok[1:], 16)
    if tok.isdigit():
        return int(tok)
    if tok in labels:
        return labels[tok]
    if pass_no:
        raise SystemExit('undefined symbol ' + tok)
    return 0x8000            # a wide placeholder, so pass 0 never picks zero page


SRC = r"""
PERIOD  = $F0
RELOAD  = $F1
TICKLO  = $F2
TICKHI  = $F3
MUTE    = $F4
IDX     = $F5
WANTLO  = $F6
WANTHI  = $F7

START:
        sei
; The monitor's IRQ handler jumps through $03FE, and its NMI vector points
; straight at $03FB, where it expects an instruction rather than an address.
        lda #<IRQH
        sta $03FE
        lda #>IRQH
        sta $03FF
        lda #$40                ; RTI, for the 50 Hz frame NMI
        sta $03FB
        lda #1
        sta MUTE
        lda #0
        sta IDX
        sta $C040               ; arm the video interrupts
        cli

SEQ:
        ldx IDX
        lda TAB,X
        bne PLAY
        lda #0                  ; end of table, round again
        sta IDX
        jmp SEQ
PLAY:
        sta PERIOD
        sta RELOAD
        lda #0
        sta MUTE
        jsr WAIT1000
        lda #1
        sta MUTE
        jsr WAIT500
        inc IDX
        jmp SEQ

WAIT1000:
        lda #$03
        ldx #$E8
        jmp WAITN
WAIT500:
        lda #$01
        ldx #$F4
WAITN:
        sta WANTHI
        stx WANTLO
        lda #0
        sta TICKLO
        sta TICKHI
WAITLOOP:
        lda TICKHI
        cmp WANTHI
        bcc WAITLOOP
        bne WAITEND
        lda TICKLO
        cmp WANTLO
        bcc WAITLOOP
WAITEND:
        rts

; One flip every PERIOD interrupts, and a 16-bit count of every interrupt.
; The monitor has already stashed the interrupted A in $45; restore it and RTI.
IRQH:
        lda MUTE
        bne TICK
        dec PERIOD
        bne TICK
        lda RELOAD
        sta PERIOD
        sta $C030
TICK:
        inc TICKLO
        bne OUT
        inc TICKHI
OUT:
        lda $45
        rti

TAB:
        dfb 1, 2, 4, 0
"""

# A bootable 140K disk. The controller ROM reads track 0 sector 0 into $0800 and
# jumps to $0801, the byte at $0800 being DOS's sector count and unread by us.
# The program fits in a sector, so it needs no second stage: the boot sector *is*
# the program. A disk is the common denominator -- every Agat emulator boots one.
ORG = 0x0801
code = assemble(SRC, ORG)
boot = bytes([0x01]) + code
if len(boot) > 256:
    raise SystemExit(f'boot sector overflow: {len(boot)} bytes')

img = bytearray(35 * 16 * 256)
img[0:len(boot)] = boot

dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    tempfile.gettempdir(), 'irqtest.dsk')
with open(dest, 'wb') as f:
    f.write(img)
print(f'{dest}: {len(code)} bytes of code at ${ORG:04X}, bootable from track 0 sector 0')
