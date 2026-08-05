#!/usr/bin/env python3
"""Build examples/irqtest.fil — a sound and interrupt test for any Agat emulator.

The point is to take RISE OUT out of the picture. It installs its own IRQ handler
on the sub-frame video interrupt, counts interrupts, and flips the speaker every
N of them for exactly 1000 interrupts, then stays silent for 500, then moves to
the next N. The table is 1, 2, 4, so on an Agat-7 whose sub-frame interrupt is
1 kHz you hear, over and over:

    500 Hz for 1.0 s   -  silence 0.5 s
    250 Hz for 1.0 s   -  silence 0.5 s
    125 Hz for 1.0 s   -  silence 0.5 s

Every number is derived from the interrupt alone, so the pitches say what the
interrupt rate is and the 1.0 s tones say whether the counting is right. Two
emulators that disagree about either will not sound the same.

Agat-7: the vectors live at $FFFA/$FFFE, which is ЭмПЗУ card RAM, so the program
pages the card the way RISE OUT's SETR does — write-enabled to store, then
read-enabled so the CPU can fetch through it.
"""
import sys, os

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
; Install the vectors. A store anywhere in the slot-2 page sets the ЭмПЗУ's
; state from the address: $C280 clears the read-enable bit so stores land in
; card RAM, $C2A0 sets it so the CPU fetches vectors back out of it.
        sta $C280
        lda #<IRQH
        sta $FFFE
        lda #>IRQH
        sta $FFFF
        lda #<NMIH
        sta $FFFA
        lda #>NMIH
        sta $FFFB
        sta $C2A0
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

NMIH:
        rti

; One flip every PERIOD interrupts, and a 16-bit count of every interrupt.
IRQH:
        pha
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
        pla
        rti

TAB:
        dfb 1, 2, 4, 0
"""

ORG = 0x0800
code = assemble(SRC, ORG)

name = b'IRQTEST'
hdr = bytearray(0x2c)
hdr[0:30] = bytes(b | 0x80 for b in name).ljust(30, b'\xa0')
hdr[0x27] = 0x04                                   # DOS type B
hdr[0x28], hdr[0x29] = ORG & 0xff, ORG >> 8
hdr[0x2a], hdr[0x2b] = len(code) & 0xff, len(code) >> 8
blob = bytes(hdr) + code
# The sniffer's rule is (size - 40) % 256 == 0, matching the real corpus: the
# 4-byte address/length pair counts as part of the first sector's payload.
blob += b'\x00' * ((40 - len(blob)) % 256)

dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'examples', 'irqtest.fil')
with open(dest, 'wb') as f:
    f.write(blob)
print(f'{dest}: {len(code)} bytes of code at ${ORG:04X}, {len(blob)} total')
