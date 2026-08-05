// Read the text page back under several candidate layouts, so the one the disk
// is actually using identifies itself.
//
//   node tools/screen.js <disk> [keys] [cycles-per-key]
const { loadModules, loadAssets, makeMachine } = require('./harness');

const diskName = process.argv[2] || 'MS_01';
const keys = process.argv[3] || '~';
const per = Number(process.argv[4] || 8e6);
const ctx = loadModules();

const KOI7 = 'ЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ';

function ch(c) {
  c &= 0x7f;
  if (c >= 0x20 && c < 0x60) return String.fromCharCode(c);
  if (c >= 0x60) return KOI7[c - 0x60];
  return '.';
}

function appleText(ram, base) {
  const out = [];
  for (let row = 0; row < 24; row++) {
    const a = base + (row & 7) * 0x80 + (row >> 3) * 0x28;
    let s = '';
    for (let c = 0; c < 40; c++) s += ch(ram[a + c]);
    out.push(s);
  }
  return out;
}

function linear(ram, base, cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    let s = '';
    for (let c = 0; c < cols; c++) s += ch(ram[base + r * cols + c]);
    out.push(s);
  }
  return out;
}

function score(lines) {
  const t = lines.join('');
  let good = 0;
  for (const c of t) if (c !== '.' && c !== ' ' && c !== '@') good++;
  return good;
}

loadAssets(ctx, diskName).then(({ roms, disk }) => {
  const m = makeMachine(ctx, roms, disk);
  m.bootDisk();
  const cpu = m.cpu;
  const run = (n) => { const e = cpu.cycles + n; while (cpu.cycles < e && !cpu.halted) cpu.step(); };
  run(per * 2);
  for (const c of keys) {
    m.keyDown(c === '~' ? 0x0d : c === '_' ? 0x20 : c.toUpperCase().charCodeAt(0));
    run(per);
  }
  const cands = [
    ['apple text $0400 (40x24)', appleText(m.ram, 0x400)],
    ['apple text $0800 (40x24)', appleText(m.ram, 0x800)],
    ['linear  $0400 32x32', linear(m.ram, 0x400, 32, 32)],
    ['linear  $0400 40x24', linear(m.ram, 0x400, 40, 24)],
    ['linear  $0400 64x16', linear(m.ram, 0x400, 64, 16)],
  ];
  cands.sort((a, b) => score(b[1]) - score(a[1]));
  for (const [name, lines] of cands) {
    console.log('=== %s  (score %d) ===', name, score(lines));
    console.log(lines.map((l) => '|' + l + '|').join('\n'));
    console.log();
  }
}).catch((e) => { console.error(e); process.exit(1); });
