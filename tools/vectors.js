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

// gcr140's output over the bundled example, whose chain of trust runs back to
// the encoder being verified byte-for-byte against a compiled dsk2nib. The
// digest is over an input file, so replacing that example replaces this: the
// way to re-pin it honestly is to check that the unchanged encoder still
// reproduces the previous digest from the previous disk, then take a new one.
const GCR_GOLDEN =
  '722e4b46646bb16bfc5c64ae06000f5399563411d38b73ddea2b3f6480c1a3ef';
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
// checksum is what our routine computes. No .aim ships with the repo, so point
// AGAT_AIM at one to run this; without it the block just skips.
{
  const aim = process.env.AGAT_AIM;
  if (aim && fs.existsSync(aim)) {
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
    console.log('skip: aim840 checksum (set AGAT_AIM to an .aim to run it)');
  }
}

// --- 140K GCR ---------------------------------------------------------------
// The 6-and-2 encoder is the fiddliest transcription in the project. Its output
// for the bundled example is checked against a digest taken when it was
// verified byte-for-byte against agat-emulator's own dsk2nib.
{
  const dsk = path.join(H.ROOT, 'examples', 'rise-out.dsk');
  if (fs.existsSync(dsk)) {
    const media = ctx.AGAT.mount(H.sniffFile(ctx, dsk));
    eq('gcr140 track count', [media.tracks, media.stride], [35, 6656]);
    const sha = require('crypto').createHash('sha256')
      .update(Buffer.from(media.bytes)).digest('hex');
    eq('gcr140 nibble stream digest', sha, GCR_GOLDEN);
    // Address field of track 0 sector 0, 4-and-4 encoded.
    let i = 0;
    while (i < 200 && !(media.bytes[i] === 0xd5 && media.bytes[i + 1] === 0xaa &&
                        media.bytes[i + 2] === 0x96)) i++;
    const dec = (a, b) => ((a << 1) | 1) & b;
    eq('gcr140 T0S0 address field',
       [dec(media.bytes[i + 3], media.bytes[i + 4]),      // volume
        dec(media.bytes[i + 5], media.bytes[i + 6]),      // track
        dec(media.bytes[i + 7], media.bytes[i + 8])],     // sector
       [254, 0, 0]);
  } else {
    console.log('skip: gcr140 (no examples/rise-out.dsk)');
  }
}

// --- .fil -------------------------------------------------------------------
{
  const fil = path.join(H.ROOT, 'examples', 'snake.fil');
  if (fs.existsSync(fil)) {
    const s = H.sniffFile(ctx, fil);
    eq('fil sniff', [s.kind, s.loadAddr, s.length, s.filName],
       ['fil', 0x2000, 3874, 'SNAKE']);
  } else {
    console.log('skip: fil (no examples/snake.fil)');
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

    // --- what a reset has to undo -------------------------------------------
    // A machine that has already run something is not a fresh one, and loading
    // a new image resets rather than rebuilds it. Anything a program can leave
    // set that changes what the CPU fetches has to be cleared here, or the next
    // image boots into the last one's leftovers.
    const m = H.makeMachine(ctx, roms, { model: 7 });
    m.reset();
    const vec = (a) => m.read(a) | (m.read(a + 1) << 8);
    const vectors = [vec(0xfffa), vec(0xfffc), vec(0xfffe)];

    m.psrom.writeReg(0xc2a0);              // ЭмПЗУ read-enabled, as RISE OUT
    m.mem7.setState(9);                    // ...leaves them
    m.mode = 0x35;
    m.videoInts = true;
    m.cpu.nmiEdge = m.cpu.irqPending = true;
    m.cards[5].portC = 0xff;
    m.cards[3].motor = 1;
    m.reset();

    eq('reset frees $D000-$FFFF from the ЭмПЗУ', m.psrom.readsRam(), false);
    eq('reset restores the ROM vectors',
       [vec(0xfffa), vec(0xfffc), vec(0xfffe)], vectors);
    eq('reset takes no pending interrupt',
       [m.cpu.nmiEdge, m.cpu.irqPending, m.cpu.irqLine], [false, false, false]);
    eq('reset drops the 840K drive lines', m.cards[5].portC, 0);
    eq('reset stops the 140K motor', m.cards[3].motor, 0);
    eq('reset restores the video mode', [m.mode, m.videoInts], [0, false]);

    // --- the raster interrupt model -----------------------------------------
    // Run the line counter through one whole frame and describe the IRQ line's
    // shape, which is what the oscilloscope traces on agatcomp measure: the
    // Agat-7's ten assertions with one release cut in half, and the Agat-9's
    // single line in eight.
    const shape = (model) => {
      const mm = H.makeMachine(ctx, roms, { model: model });
      mm.reset();
      mm.setIrqModel('raster');
      mm.setVideoInts(true);
      const level = new Array(312), nmi = [], runs = [];
      mm.cpu.nmi = () => nmi.push(mm.rasterLine);
      for (let i = 0; i < 312; i++) {
        mm.pollRaster(mm.nextLine);
        level[mm.rasterLine] = mm.cpu.irqLine;
      }
      for (let line = 0; line < 312; line++) {
        if (line && level[line] === level[line - 1]) runs[runs.length - 1][1]++;
        else runs.push([level[line], 1]);
      }
      return { runs: runs, nmi: nmi };
    };

    const s7 = shape(7);
    eq('Agat-7 raster IRQ asserts ten times a frame',
       s7.runs.filter((r) => r[0]).length, 10);
    eq('Agat-7 raster IRQ is 16 lines on, 16 off',
       s7.runs.slice(0, 4), [[true, 16], [false, 16], [true, 16], [false, 16]]);
    eq('Agat-7 raster IRQ has one half-length release',
       s7.runs.filter((r) => !r[0] && r[1] === 8).length, 1);
    eq('Agat-7 takes NMI where blanking starts', s7.nmi, [256]);

    const s9 = shape(9);
    eq('Agat-9 raster IRQ asserts 39 times a frame',
       s9.runs.filter((r) => r[0]).length, 39);
    eq('Agat-9 raster IRQ is one line in eight',
       s9.runs.slice(0, 4), [[false, 7], [true, 1], [false, 7], [true, 1]]);
    eq('Agat-9 takes NMI where blanking ends', s9.nmi, [0]);

    done();
  }).catch((e) => { console.error(e); process.exit(1); });
}

function done() {
  console.log('\n%d passed, %d failed', pass, fail);
  process.exit(fail ? 1 : 0);
}
