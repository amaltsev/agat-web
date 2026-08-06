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
const hex = (v) => '$' + v.toString(16).toUpperCase();
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
    const dec = A.gcr140.decode44;
    eq('gcr140 T0S0 address field',
       [dec(media.bytes[i + 3], media.bytes[i + 4]),      // volume
        dec(media.bytes[i + 5], media.bytes[i + 6]),      // track
        dec(media.bytes[i + 7], media.bytes[i + 8])],     // sector
       [254, 0, 0]);
  } else {
    console.log('skip: gcr140 (no examples/rise-out.dsk)');
  }
}

// --- 140K GCR, the way back -------------------------------------------------
// The decoder has no upstream to be checked against, so what stands in for one
// is the encoder: over a whole real disk, denibblizing must give back the
// sector image byte for byte. That rides on the encoder's own chain of trust
// back to a compiled dsk2nib, so an error would have to be a matching pair.
{
  const dsk = path.join(H.ROOT, 'examples', 'rise-out.dsk');
  if (fs.existsSync(dsk)) {
    const s = H.sniffFile(ctx, dsk);
    const media = A.mount(s);
    let short = 0, wrong = 0;
    for (let t = 0; t < media.tracks; t++) {
      const got = A.gcr140.denibblizeTrack(media.bytes, media.trackBase(t),
                                           media.trackLen[t], t, s.prodos);
      if (got.got !== 16) { short++; continue; }
      for (let i = 0; i < 4096; i++) {
        if (got.bytes[i] !== s.payload[t * 4096 + i]) wrong++;
      }
    }
    eq('gcr140 round trip over 35 tracks', [short, wrong], [0, 0]);
  } else {
    console.log('skip: gcr140 round trip (no examples/rise-out.dsk)');
  }
}

// A data field that has been damaged is not a data field. Both refusals matter:
// a wrong sector quietly written into a saved .dsk is worse than a save that
// falls back to the nibble stream.
{
  const src = new ctx.Uint8Array(256);
  for (let i = 0; i < 256; i++) src[i] = (i * 11 + 5) & 0xff;
  const field = new ctx.Uint8Array(0x157);
  A.gcr140.code62(src, 0, field, 0);
  const out = new ctx.Uint8Array(256);
  eq('decode62 inverts code62', [A.gcr140.decode62(field, 0, out, 0),
                                 Buffer.compare(Buffer.from(out), Buffer.from(src))],
     [true, 0]);

  const bad = new ctx.Uint8Array(field);
  bad[0x156] = A.gcr140.CODE[(A.gcr140.DECODE[bad[0x156]] + 1) & 0x3f];
  eq('decode62 refuses a wrong checksum', A.gcr140.decode62(bad, 0, out, 0), false);

  const junk = new ctx.Uint8Array(field);
  junk[100] = 0x55;                          // never a disk byte
  eq('decode62 refuses a byte no disk carries',
     A.gcr140.decode62(junk, 0, out, 0), false);
}

// --- writing a 140K disk ----------------------------------------------------
// Through the register file, the way DOS does it: latch a byte into $C0ED and
// shift it out with $C0EC. What comes back is checked by denibblizing the track
// the drive wrote, so the read path, the write path and both codecs have to
// agree before this passes.
{
  const dsk = path.join(H.ROOT, 'examples', 'rise-out.dsk');
  if (fs.existsSync(dsk)) {
    const s = H.sniffFile(ctx, dsk);
    const media = A.mount(s);
    const card = new A.Disk140({});
    card.insert(media);
    eq('a disk arrives locked whatever it said', media.writeProtect, true);

    let now = 0;
    // One byte of track per call: spin() hands over one per 32 cycles, and
    // readData gives it up exactly once.
    const next = () => { now += A.Disk140.CYCLES_PER_BYTE; return card.read(0xc, now); };
    const shift = (b) => {
      now += A.Disk140.CYCLES_PER_BYTE;
      card.write(0xd, b, now);                 // STA $C08D,X
      card.read(0xc, now);                     // ORA $C08C,X
    };

    card.access(0x9, now);                     // $C0E9, motor on
    const before = new ctx.Uint8Array(media.bytes);
    card.read(0xf, now);                       // $C0EF, write mode
    for (let i = 0; i < 32; i++) shift(0x96);
    eq('a locked disk takes no writes',
       Buffer.compare(Buffer.from(media.bytes), Buffer.from(before)), 0);
    card.read(0xe, now);                       // $C0EE, back to reading

    media.locked = false;
    eq('unlocking clears the bit software reads',
       card.read(0xe, now) & 0x80, 0);

    // The head starts on track 10. Wind round to the data field of the sector
    // DOS calls 9, which is where file sector 3 was nibblized to.
    const want = A.gcr140.REN1[3];
    const win = [0, 0, 0];
    let addr = -1, found = false;
    for (let i = 0; i < media.stride * 2 && !found; i++) {
      win.shift(); win.push(next());
      if (win[0] === 0xd5 && win[1] === 0xaa && win[2] === 0x96) {
        const f = [];
        for (let j = 0; j < 8; j++) f.push(next());
        addr = A.gcr140.decode44(f[4], f[5]);
      } else if (addr === want && win[0] === 0xd5 && win[1] === 0xaa && win[2] === 0xad) {
        found = true;
      }
    }
    eq('wound to a data field on track 10', [found, card.track], [true, 10]);

    const wrote = new ctx.Uint8Array(256);
    for (let i = 0; i < 256; i++) wrote[i] = (i * 3 + 17) & 0xff;
    const field = new ctx.Uint8Array(0x157);
    A.gcr140.code62(wrote, 0, field, 0);
    card.read(0xf, now);                       // $C0EF, write mode
    for (let i = 0; i < field.length; i++) shift(field[i]);
    card.read(0xe, now);

    eq('the track is marked written', [media.written[10], media.isWritten()], [1, true]);
    const got = A.gcr140.denibblizeTrack(media.bytes, media.trackBase(10),
                                         media.trackLen[10], 10, s.prodos);
    eq('the written sector reads back', [got.got,
        Buffer.compare(Buffer.from(got.bytes.subarray(3 * 256, 4 * 256)),
                       Buffer.from(wrote))], [16, 0]);
    // Everything else on the track is where it was.
    let elsewhere = 0;
    for (let k = 0; k < 16; k++) {
      if (k === 3) continue;
      for (let i = 0; i < 256; i++) {
        if (got.bytes[k * 256 + i] !== s.payload[10 * 4096 + k * 256 + i]) elsewhere++;
      }
    }
    eq('the other 15 sectors are untouched', elsewhere, 0);

    // And out through the saving path, with no App around it: writeBack reads
    // the sources it is given and the card's media, and nothing else.
    const app = {
      sources: { 6: { name: 'rise-out.dsk', bytes: s.payload, patches: [],
                      kind: 'dsk140', offset: 0, prodos: s.prodos } },
      machine: { cards: { 6: card } },
    };
    const back = A.App.prototype.writeBack.call(app, 6);
    const want256 = new ctx.Uint8Array(s.payload);
    want256.set(wrote, 10 * 4096 + 3 * 256);
    eq('writeBack patches say what changed',
       [back.name, back.patches.length,
        Buffer.compare(Buffer.from(A.agc.applyPatches(back.bytes, back.patches)),
                       Buffer.from(want256))],
       ['rise-out.dsk', 1, 0]);
    eq('writeBack leaves the source alone, so saving twice is the same file',
       [app.sources[6].patches.length,
        JSON.stringify(A.App.prototype.writeBack.call(app, 6).patches) ===
        JSON.stringify(back.patches)],
       [0, true]);

    // A track that will not decode has no sector image to be a patch against.
    // One data-field prologue struck out is enough to lose that sector.
    const t10 = media.trackBase(10);
    for (let i = 0; i < media.stride; i++) {
      if (media.bytes[t10 + i] === 0xd5 && media.bytes[t10 + i + 1] === 0xaa &&
          media.bytes[t10 + i + 2] === 0xad) { media.bytes[t10 + i + 2] = 0x96; break; }
    }
    const fell = A.App.prototype.writeBack.call(app, 6);
    eq('an undecodable track saves as nibbles instead',
       [fell.name, fell.bytes.length, fell.patches.length],
       ['rise-out.nib', 35 * 6656, 0]);
  } else {
    console.log('skip: 140K writing (no examples/rise-out.dsk)');
  }
}

// --- the drive lamps --------------------------------------------------------
// 0 dark, 1 spinning, 2 transferring. The distinction that matters is the last
// one: the boot loops poll the data register several times for every byte the
// disk has actually turned far enough to give, so a poll must not light it.
{
  const blank = (kind, stride, tracks) => new A.Media({
    kind, stride, tracks,
    bytes: new ctx.Uint8Array(stride * tracks),
    attrs: new ctx.Uint8Array(stride * tracks),
  });

  {
    const W = Math.ceil(A.Disk840.LAMP_BUSY);
    const c = new A.Disk840({});
    eq('840 lamp dark with no disk', c.lamp(0), 0);
    c.insert(blank('aim840', 6464, 160));
    eq('840 lamp dark with the motor off', c.lamp(0), 0);
    c.control(0x0f);                          // 8255 bit set/reset: port C7 = 1
    eq('840 lamp spins with the motor on', c.lamp(0), 1);
    const T = 100000;
    c.read(4, T);                             // the register that hands a byte over
    eq('840 lamp over a transfer',
       [c.lamp(T), c.lamp(T + W - 1), c.lamp(T + W)], [2, 2, 1]);
    c.control(0x0e);
    eq('840 lamp dark again when the motor drops', c.lamp(T), 0);
  }

  {
    const W = Math.ceil(A.Disk140.LAMP_BUSY);
    const c = new A.Disk140({});
    eq('140 lamp dark with no disk', c.lamp(0), 0);
    c.insert(blank('nib140', 6656, 35));
    eq('140 lamp dark with the motor off', c.lamp(0), 0);
    c.access(0x9, 0);                         // $C0E9, motor on
    eq('140 lamp spins with the motor on', c.lamp(0), 1);
    const T = 100000;
    c.read(0xc, T);                           // the disk has not turned yet
    eq('140 lamp is not lit by a poll', c.lamp(T), 1);
    c.read(0xc, T + 64);                      // two byte-times on, a byte lands
    eq('140 lamp over a transfer',
       [c.lamp(T + 64), c.lamp(T + 64 + W - 1), c.lamp(T + 64 + W)], [2, 2, 1]);
    c.read(0xc, T + 64);                      // same instant: nothing new to give
    eq('140 lamp is not held up by a poll', c.lamp(T + 64 + W), 1);
  }
}

// --- undocumented opcodes ---------------------------------------------------
// The Klaus Dormann test covers the official set and says nothing about either
// the undocumented opcodes or anyone's cycle counts. Both matter here: the
// sub-frame interrupt is the Agat's music clock, so an instruction that is a
// few cycles cheap shifts pitch and tempo.
//
// Counted against agat-emulator's own table (cpu/cpu6502.c, from
// oxyron.de/html/opcodes02.html), which carries all 105 of them. The
// read-modify-write group takes the legal read-modify-write counts and pays no
// page-cross penalty: the extra fetch happens whether or not the index carried.
{
  const step = (bytes, setup) => {
    const ram = new Uint8Array(0x10000);
    const cpu = new A.CPU({
      read: (a) => ram[a & 0xffff],
      write: (a, v) => { ram[a & 0xffff] = v & 0xff; },
    });
    ram[0xfffc] = 0x00; ram[0xfffd] = 0x02;
    cpu.reset();
    bytes.forEach((b, i) => { ram[0x0200 + i] = b; });
    if (setup) setup(cpu, ram);
    const c0 = cpu.cycles;
    cpu.step();
    return { cycles: cpu.cycles - c0, cpu: cpu, ram: ram };
  };

  // Every JAM, and only those, stops the CPU. A hole here is an opcode that
  // silently does nothing instead of the undocumented thing a game wanted.
  {
    const jam = [];
    for (let op = 0; op < 256; op++) if (step([op, 0x10, 0x03]).cpu.halted) jam.push(op);
    eq('exactly the twelve JAM opcodes halt', jam.map(hex),
       [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2].map(hex));
  }

  // The read-modify-write six, across all seven of their addressing modes.
  {
    const want = { 0x03: 8, 0x07: 5, 0x0f: 6, 0x13: 8, 0x17: 6, 0x1b: 7, 0x1f: 7 };
    const bad = [];
    for (const base of [0x00, 0x20, 0x40, 0x60, 0xc0, 0xe0]) {
      for (const off in want) {
        const op = base | Number(off);
        const got = step([op, 0x10, 0x03]).cycles;
        if (got !== want[off]) bad.push(hex(op) + ' ' + got + '!=' + want[off]);
      }
    }
    eq('SLO RLA SRE RRA DCP ISC cycle counts', bad, []);
  }

  // The rest, mode by mode, so a wrong addressing mode shows up as a wrong count.
  {
    const bad = [], want = {
      0xa7: 3, 0xb7: 4, 0xaf: 4, 0xbf: 4, 0xa3: 6, 0xb3: 5, 0xab: 2,   // LAX
      0x87: 3, 0x97: 4, 0x8f: 4, 0x83: 6,                              // SAX
      0x0b: 2, 0x2b: 2, 0x4b: 2, 0x6b: 2, 0xcb: 2, 0x8b: 2,            // ANC ALR ARR SBX XAA
      0x9b: 5, 0x9c: 5, 0x9e: 5, 0x9f: 5, 0x93: 6, 0xbb: 4,            // TAS SHY SHX AHX LAS
      0x1a: 2, 0x80: 2, 0x04: 3, 0x14: 4, 0x0c: 4, 0x1c: 4,            // the NOPs
    };
    for (const op in want) {
      const got = step([Number(op), 0x10, 0x03]).cycles;
      if (got !== want[op]) bad.push(hex(Number(op)) + ' ' + got + '!=' + want[op]);
    }
    eq('the remaining undocumented cycle counts', bad, []);
  }

  // And that a couple of them actually do the undocumented thing.
  {
    const r = step([0xa7, 0x40], (c, ram) => { ram[0x40] = 0x7f; });
    eq('LAX $40 loads A and X', [r.cpu.a, r.cpu.x], [0x7f, 0x7f]);
    const s = step([0x87, 0x40], (c) => { c.a = 0xf0; c.x = 0x3c; });
    eq('SAX $40 stores A & X', s.ram[0x40], 0x30);
    const t = step([0xcb, 0x10], (c) => { c.a = 0xf0; c.x = 0x3c; });
    eq('SBX #$10 puts (A & X) - imm in X', t.cpu.x, 0x20);
  }
}

// --- the keyboard, and the two boards that draw it --------------------------
// The АГАТ board is a transcription of a photograph, and a transcription is
// exactly the kind of thing that is wrong in one place and looks right. These
// check it against the shipped scancode table rather than against the eye: a
// cap that carries a code nothing sends, or a code with no cap, fails here.
{
  const K = A.keyboard, V = A.keyview;

  // The split of decode() into a pure lookup has to change nothing.
  {
    const back = {};
    for (const name in K.SCAN) back[K.SCAN[name]] = name;
    let same = true;
    for (let layout = 0; layout < 2; layout++) {
      for (const scan in back) {
        for (const mod of [0, 1, 2]) {
          const e = { code: back[scan], shiftKey: mod === 1, ctrlKey: mod === 2 };
          if (K.decode(e, layout) !== K.codeFor(Number(scan), layout, mod)) same = false;
        }
      }
    }
    eq('codeFor and decode agree everywhere', same, true);
  }

  // Which host keys reach a code. The three below are the ones worth pinning:
  // Ч and Ю are unreachable in ЛАТ, and ¤ needs a shift the cap does not show.
  const names = (c) => K.routesTo(c).map(K.routeName).join(', ');
  eq('Ч ($5E) comes from РУС X', names(0x5e),
     'ЛАТ Shift+6, ЛАТ Shift+`, РУС X, РУС Shift+`');
  eq('Ю ($40) comes from РУС .', names(0x40), 'ЛАТ `, ЛАТ Shift+2, РУС `, РУС .');
  eq('¤ ($24) comes from ЛАТ Shift+4', names(0x24), 'ЛАТ Shift+4');
  {
    const stranded = [];
    for (let c = 0x20; c < 0x80; c++) if (!K.routesTo(c).length) stranded.push(hex(c));
    eq('every printable code has some host key', stranded, []);
  }

  // Every legend on the АГАТ board, and every code any plane can produce.
  const caps = new Set();
  let letters = 0, badLetter = 0;
  for (const rows of [V.AGAT_MAIN, V.AGAT_PAD]) {
    for (const r of rows) {
      for (const d of r.keys) {
        for (const k of ['u', 's', 'code']) {
          if (d[k] !== undefined) caps.add(d[k] & 0x7f);
        }
        // A letter cap's two legends are one byte in two character sets, and
        // РЕГ moves between them by exactly $20. That is what lets both fit.
        if (d.u >= 0x40 && d.u <= 0x5f && d.s !== undefined) {
          letters++;
          if (d.s !== d.u + 0x20) badLetter++;
        }
      }
    }
  }
  eq('the letter block is all 32 caps', letters, 32);
  eq('every letter cap is shifted by $20', badLetter, 0);

  const produced = new Set();
  for (let layout = 0; layout < 2; layout++) {
    for (let mod = 0; mod < 4; mod++) {
      for (let scan = 0; scan < 128; scan++) {
        const v = K.KEYMAP[((layout * 4 + mod) << 7) | scan];
        if (v && K.routesTo(v).length) produced.add(v & 0x7f);
      }
    }
  }
  const orphan = [...produced].filter((c) => !caps.has(c) && !caps.has(V.capCode(c)));
  eq('every code a host key sends lands on a cap', orphan.map(hex), []);
  const unsent = [...caps].filter((c) => !K.routesTo(c).length);
  eq('every АГАТ cap is reachable from the host', unsent.map(hex), []);

  // Caps drawn dead really are dead: ПВТ, РЕД and the pad's `=` are painted on
  // the machine and send nothing the shipped table carries.
  let dead = 0, wrongDead = 0;
  for (const rows of [V.AGAT_MAIN, V.AGAT_PAD]) {
    for (const r of rows) {
      for (const d of r.keys) {
        if (d.act !== 'none') continue;
        dead++;
        if (d.u !== undefined || d.code !== undefined) wrongDead++;
      }
    }
  }
  eq('three caps send nothing', dead, 3);
  eq('no dead cap secretly carries a code', wrongDead, 0);

  // The PC board is the other half of the answer, so it has to be all of it.
  const drawn = new Set();
  let twice = 0;
  for (const rows of [V.PC_MAIN, V.PC_NAV, V.PC_PAD]) {
    for (const r of rows) {
      for (const d of r.keys) {
        if (d.scan === undefined) continue;
        const key = d.scan + (d.ext ? 256 : 0);
        if (drawn.has(key)) twice++;
        drawn.add(key);
      }
    }
  }
  const want = new Set();
  for (const n in K.SCAN) want.add(K.SCAN[n]);
  for (const n in K.EXT_SCAN) want.add(K.EXT_SCAN[n] + 256);
  eq('the PC board draws no key twice', twice, 0);
  eq('the PC board draws every mapped scancode',
     [...want].filter((s) => !drawn.has(s)).map(hex), []);
  eq('the PC board draws nothing the table does not map',
     [...drawn].filter((s) => !want.has(s)).map(hex), []);
}

// --- .agc containers --------------------------------------------------------
// The format is the only thing here a person is expected to hand-edit, so what
// is pinned is what a hand-written file may rely on: the line shape, that a
// container round-trips, and that a patch is a diff rather than something baked
// into the payload.
{
  const K = A.keyboard;
  const bytes = new ctx.Uint8Array(200);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;

  const lines = A.agc.encode64(bytes);
  eq('base64 wraps at the MIME width', lines.slice(0, -1).map((l) => l.length),
     [76, 76, 76]);
  eq('every base64 line is whole groups',
     lines.filter((l) => l.length % 4).length, 0);
  eq('base64 round-trips', [...A.agc.decode64(lines)], [...bytes]);
  eq('base64 reads back as one string too',
     [...A.agc.decode64(lines.join('\n'))], [...bytes]);

  const src = A.agc.build({
    title: 'ИГРА', author: 'Кто-то', date: 'circa 1985', url: 'http://x/y',
    notes: 'n', model: 7, ram: 64, irq: 'held', rate: 500,
    keys: { KeyW: { code: '^', note: 'Shoot right' } },
    media: [{ name: 'x.dsk', bytes: bytes, patches: [{ at: 2, hex: 'AA BB' }] }],
  });
  const c = A.agc.parse(Buffer.from(src, 'utf8'), 'x.agc');
  eq('a container round-trips',
     [c.title, c.author, c.date, c.url, c.notes, c.machine.model, c.machine.ram,
      c.quirks.irq, c.quirks.rate, c.keys.KeyW, c.media.length, c.media[0].name],
     ['ИГРА', 'Кто-то', 'circa 1985', 'http://x/y', 'n', 7, 64, 'held', 500,
      { code: '^', note: 'Shoot right' }, 1, 'x.dsk']);
  // A date is what is known, not a year: "circa 1985" has to survive.
  eq('a date stays as it was written',
     ['1989', 'circa 1985', '1990-92'].map(
       (d) => A.agc.parse(Buffer.from(A.agc.build({ date: d, media: [] }), 'utf8')).date),
     ['1989', 'circa 1985', '1990-92']);
  eq('the payload is what was packed', [...c.media[0].bytes], [...bytes]);
  eq('patches reach the image the machine runs',
     [c.media[0].payload[1], c.media[0].payload[2], c.media[0].payload[3],
      c.media[0].payload[4]],
     [bytes[1], 0xaa, 0xbb, bytes[4]]);
  eq('patching leaves the packed copy alone',
     [c.media[0].bytes[2], c.media[0].bytes[3]], [bytes[2], bytes[3]]);
  eq('a patch off the end is refused', (() => {
    try { A.agc.applyPatches(bytes, [{ at: 199, hex: 'AABB' }]); return 'no'; }
    catch (e) { return 'threw'; }
  })(), 'threw');

  eq('a disk is not a container', A.agc.parse(bytes, 'x.dsk'), null);
  eq('other JSON is not a container',
     A.agc.parse(Buffer.from('{"hello":1}', 'utf8'), 'x.json'), null);
  eq('a broken container says so rather than passing for a disk', (() => {
    try { A.agc.parse(Buffer.from('{"agc": 1, ', 'utf8'), 'x.agc'); return 'no'; }
    catch (e) { return 'threw'; }
  })(), 'threw');
  eq('the sniffer prefers the container to the size table',
     A.sniff(Buffer.from(src, 'utf8'), 'x.agc').kind, 'agc');

  // How a code may be written in `keys`. The character form is the one worth
  // having: `"^"` is what a game's instructions say, not `$5E`.
  eq('codes resolve from every form they may be written in',
     ['^', '$5E', '0x5e', 'Up', '↑', 'Ю', 'Space', 'nonsense']
       .map(K.resolveCode),
     [0x5e, 0x5e, 0x5e, 0x99, 0x99, 0x60, 0x20, -1]);
}

// --- the keyboard remap -----------------------------------------------------
// A container puts a code on a host key. The remap is a layer in front of the
// shipped table, not an edit to it, and it captures the key in every plane —
// so a movement key does not turn into something else under a held РЕГ.
{
  const K = A.keyboard;
  const names = (c) => K.routesTo(c).map(K.routeName).join(', ');

  const r = K.setRemap({ KeyW: '^', ArrowUp: 'Esc', KeyZZ: '^', KeyX: 'nope' });
  eq('setRemap names what it could not use', [r.ok, r.bad],
     [2, ['KeyZZ → ^', 'KeyX → nope']]);
  eq('a remapped key sends its code in every plane',
     [K.codeFor(0x11, 0, 0), K.codeFor(0x11, 1, 1), K.codeFor(0x11, 1, 2)],
     [0xde, 0xde, 0xde]);
  eq('its neighbours are untouched', K.codeFor(0x12, 0, 0), 0xc5);
  // Scancode $48 is Numpad8 and, with an E0 in front of it, ↑. Remapping one
  // must not take the other: they are the same number in different planes.
  eq('an ext remap captures only the ext plane',
     [K.codeFor(0x48, 0, 3), K.codeFor(0x48, 0, 0)], [0x9b, 0x91]);

  eq('the remapped key reaches its new code', names(0x5e),
     'ЛАТ Shift+6, ЛАТ Shift+`, РУС X, РУС Shift+`, W (remap)');
  eq('and no longer reaches its old one', names(0x57), 'РУС D');

  // The long form says what the key is for, and that is what the board's
  // tooltip should read out — "which key is ^" is rarely the real question.
  K.setRemap({ KeyW: { code: '^', note: 'Shoot right' } });
  eq('a noted remap says what the key does',
     names(0x5e).split(', ').pop(), 'W (Shoot right)');
  eq('a noted remap still sends the code', K.codeFor(0x11, 1, 1), 0xde);

  K.setRemap(null);
  eq('dropping the remap restores the table',
     [names(0x57), K.codeFor(0x11, 0, 0), K.codeFor(0x48, 0, 3)],
     ['ЛАТ W, РУС D', 0xd7, 0x99]);
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
