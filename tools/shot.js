// Boot an image, optionally send keys, write the screen out as a PNG.
//
//   node tools/shot.js <image> [keys] [cycles-per-key] [out.png] [--model=7|9]
//                      [--ram=32|64|128] [--psrom=KB] [--xram=KB]
//
// keys: ~ = Return, _ = Space, ^ = Escape, anything else is that character.
//
// The three size flags are kilobytes and override the Agat-7's stock memory;
// `0` pulls a card out. They are what drives the factory memory test, which
// asks for the configuration and then verifies it — so telling it one thing and
// the emulator another is how you find out which of the two is wrong:
//
//   node tools/shot.js examples/TESTOZU7_140.dsk 2401 --model=7  # ДОПОЗУ, slot 4
//   node tools/shot.js examples/TESTOZU7_140.dsk 4201 --model=7  # ЭмПЗУ, slot 2
//   node tools/shot.js examples/TESTOZU7_140.dsk 101  --model=7  # base RAM
//
// where the digits are конфигурация, then слот for a card, then исполнение
// (0 = 32K, 1 = 64K, 2 = 128K) and режим 1. See examples/TESTOZU7_140.md.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const H = require('./harness');

const argv = process.argv.slice(2);
const flags = {};
const rest = argv.filter((a) => {
  const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
  if (!m) return true;
  flags[m[1]] = m[2] === undefined ? true : m[2];
  return false;
});

const target = rest[0];
const keys = rest[1] || '';
const per = Number(rest[2] || 8e6);
const out = rest[3] || '/tmp/' + path.basename(target).replace(/\.[^.]+$/, '') + '.png';
const ctx = H.loadModules();

// --- PNG, truecolour, nearest-neighbour scaled ------------------------------

let TAB = null;
function crc32(buf) {
  if (!TAB) {
    TAB = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TAB[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TAB[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function png(width, height, rgba, scale) {
  scale = scale || 1;
  const w = width * scale, h = height * scale;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const s = (((y / scale) | 0) * width + ((x / scale) | 0)) * 4;
      raw[o++] = rgba[s]; raw[o++] = rgba[s + 1]; raw[o++] = rgba[s + 2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const keyCode = H.keyCode;

if (!target) { console.error('need an image'); process.exit(2); }

H.loadRoms(ctx).then((roms) => {
  const sniffed = H.sniffFile(ctx, target);
  const model = flags.model ? Number(flags.model) : (sniffed.hintModel || 9);
  const slots = {};
  const card = (n, name, kb) => {
    if (kb === undefined) return;
    slots[n] = Number(kb) ? { card: name, ram: Number(kb) * 1024 } : null;
  };
  card(2, 'psrom', flags.psrom);
  card(4, 'xram', flags.xram);
  const m = H.makeMachine(ctx, roms, {
    model: model,
    ramSize: flags.ram ? Number(flags.ram) * 1024 : undefined,
    slots: Object.keys(slots).length ? slots : undefined,
  });
  if (sniffed.kind === 'fil') {
    ctx.AGAT.loadFil(m, sniffed.payload);
  } else {
    let slot = ctx.AGAT.Machine.SLOTS[model].fdd840;
    if (sniffed.kind) slot = H.insert(m, ctx.AGAT.mount(sniffed));
    m.reset();
    if (!flags.cold) m.bootSlot(slot);
  }

  const cpu = m.cpu;
  const run = (n) => { const e = cpu.cycles + n; while (cpu.cycles < e && !cpu.halted) cpu.step(); };
  run(per * 2);
  for (const c of keys) { m.keyDown(keyCode(c)); run(per); }

  const v = new ctx.AGAT.Video(model === 7 ? roms.font7 : roms.font9, roms.palette, { m0: model === 7 ? 0x80 : 0x40 });
  v.render(m);
  fs.writeFileSync(out, png(v.width, v.height, v.pixels, 2));
  const mode = m.appleVideo
    ? 'apple ' + (m.text ? 'text' : (m.hires ? 'hires' : 'lores') + (m.mixed ? '+mixed' : ''))
    : (ctx.AGAT.MODE_NAMES[m.videoMode().vtype] || '?') +
      ' $' + m.mode.toString(16) + ' @$' + m.videoMode().base.toString(16);
  console.log(path.basename(target) + ': Agat-' + model + ' ' + sniffed.kind +
              ' ' + mode + ' pc=$' + cpu.pc.toString(16).toUpperCase() + ' -> ' + out);
  console.log(ctx.AGAT.Video.dumpText(m));
}).catch((e) => { console.error(e); process.exit(1); });
