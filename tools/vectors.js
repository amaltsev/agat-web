// Pure-function tests: no machine, no disk, no timing. Runs in well under a
// second and catches the transcription slips that are otherwise invisible until
// you are staring at a wrong screen.
//
//   node tools/vectors.js
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const ctx = H.loadModules();
const A = ctx.AGAT;

let pass = 0, fail = 0;
function eq(what, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log('FAIL ' + what + '\n  got  ' + g + '\n  want ' + w);
}

// --- Agat-7 banking ---------------------------------------------------------
// baseram.c:475-502. 128K: bit 3 picks the table pair, bits 2..0 index it.
{
  const K = 0x4000;
  const m = new A.Mem7(0x20000);
  eq('mem7 reset map', [m.map[0], m.map[1], m.map[2]], [0, K, 2 * K]);

  const NO = [2, 3, 6, 7, 2, 3, 4, 5];
  for (let s = 0; s < 8; s++) {
    m.setState(s);
    eq('mem7 128K state ' + s, [m.map[0], m.map[1], m.map[2]],
       [0, 1 * K, NO[s] * K]);
  }
  const NO1 = [1, 1, 4, 5, 1, 1, 4, 5], NO2 = [2, 3, 6, 7, 2, 3, 6, 7];
  for (let s = 0; s < 8; s++) {
    m.setState(8 | s);
    eq('mem7 128K state ' + (8 | s), [m.map[0], m.map[1], m.map[2]],
       [0, NO1[s] * K, NO2[s] * K]);
  }

  const m64 = new A.Mem7(0x10000);
  m64.setState(0); eq('mem7 64K state 0', m64.map[2], 2 * K);
  m64.setState(1); eq('mem7 64K state 1', m64.map[2], 3 * K);
  m64.setState(9); eq('mem7 64K state 9 (bit0 only)', m64.map[2], 3 * K);

  // 32K: $8000-$BFFF is not there at all.
  const m32 = new A.Mem7(0x8000);
  eq('mem7 32K $8000 open bus', m32.phys(0x8000), -1);
  eq('mem7 32K $7FFF present', m32.phys(0x7fff), 0x7fff);
  eq('mem7 phys is window-relative', new A.Mem7(0x20000).phys(0x4123), 0x4123);
}

// --- image sniffing ---------------------------------------------------------
{
  const cases = [
    [143360, 'dsk140'], [143364, 'dsk140'], [143488, 'dsk140'],
    [232960, 'nib140'],
    [860160, 'dsk840'], [860164, 'dsk840'], [860288, 'dsk840'],
    [947520, 'nib840'],
    [2068480, 'aim840'],
    [12345, null],
  ];
  for (const [size, kind] of cases) {
    const s = A.sniff(new ctx.Uint8Array(size), 'x.dsk');
    eq('sniff ' + size, s.kind, kind);
  }
  // The 256-byte "Agathe" header is a prefix, and shifts the payload.
  const sig = 'Agathe emulator virtual disk\r\n\x1aAD';
  const withHdr = new ctx.Uint8Array(256 + 143360);
  for (let i = 0; i < sig.length; i++) withHdr[i] = sig.charCodeAt(i);
  withHdr[48] = 1;
  const s = A.sniff(withHdr, 'x.dsk');
  eq('sniff headered dsk140', [s.kind, s.writeProtect, s.payload.length],
     ['dsk140', true, 143360]);
}

// --- 840K checksum ----------------------------------------------------------
// Self-validating: pull real sectors out of an .aim and check that the stored
// checksum is what our routine computes.
{
  const aim = path.join(H.ROOT, '..', 'master-serge', 'disks', 'MS_11.aim');
  if (fs.existsSync(aim)) {
    const raw = fs.readFileSync(aim);
    const TW = 6464;
    let checked = 0, bad = 0;
    for (let t = 0; t < 8; t++) {
      for (let k = 0; k < 21; k++) {
        const i = (t * TW + 20 + 306 * k) * 2;         // word -> byte offset
        const data = new ctx.Uint8Array(256);
        for (let j = 0; j < 256; j++) data[j] = raw[i + (15 + j) * 2];
        const stored = raw[i + (15 + 256) * 2];
        if (A.aim840.checksum(data, 0) !== stored) bad++;
        checked++;
      }
    }
    eq('aim840 checksum over ' + checked + ' real sectors', bad, 0);
  } else {
    console.log('skip: aim840 checksum (no local .aim)');
  }
}

// --- the font/mask pairing --------------------------------------------------
// Agat-7 glyphs live in bits 7..1, Agat-9 in bits 6..0. Pairing a font with the
// wrong mask shifts every character and is maddening to spot on screen.
{
  H.loadRoms(ctx).then((roms) => {
    const row = (font, ch, r, m0) => {
      let s = '', m = m0;
      for (let k = 0; k < 7; k++, m >>= 1) s += (font[ch * 8 + r] & m) ? '#' : '.';
      return s;
    };
    eq('agathe7 $C1 row0 @ m0=$80', row(roms.font7, 0xc1, 0, 0x80), '...#...');
    eq('agathe7 $C1 row4 @ m0=$80', row(roms.font7, 0xc1, 4, 0x80), '.#####.');
    eq('agathe9 $C1 row4 @ m0=$40', row(roms.font9, 0xc1, 4, 0x40), '..####.');
    eq('palette has 16 entries', roms.palette.length, 16);
    eq('palette[15] is white', roms.palette[15], [255, 255, 255]);
    done();
  }).catch((e) => { console.error(e); process.exit(1); });
}

function done() {
  console.log('\n%d passed, %d failed', pass, fail);
  process.exit(fail ? 1 : 0);
}
