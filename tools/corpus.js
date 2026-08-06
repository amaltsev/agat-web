// Walk a directory of images, boot each one, and report what happened —
// the project's regression harness.
//
//   node tools/corpus.js <dir> [--out=DIR] [--cycles=N] [--keys=~] [--md]
//                              [--ram=32|64|128] [--nocards]
//
// The model comes from the path (…7a… -> Agat-7, …9a… -> Agat-9), the way
// AgatF's own agat.sh infers it. With --out, a PNG is written per image.
//
// `--ram` overrides the Agat-7's base RAM and `--nocards` pulls both of its
// memory cards, which together are how you tell "this disk wants more memory"
// apart from "the emulator changed": run the corpus twice and diff.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./harness');

const argv = process.argv.slice(2);
const flags = {};
const rest = argv.filter((a) => {
  const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
  if (!m) return true;
  flags[m[1]] = m[2] === undefined ? true : m[2];
  return false;
});

const dir = rest[0];
if (!dir) { console.error('need a directory'); process.exit(2); }
const cycles = Number(flags.cycles || 16e6);
const keys = flags.keys || '';
const outDir = flags.out || null;
const ramSize = flags.ram ? Number(flags.ram) * 1024 : undefined;
const slots = flags.nocards ? { 2: null, 4: null } : undefined;
if (outDir) fs.mkdirSync(outDir, { recursive: true });

const ctx = H.loadModules();

// Names are handled as Buffers throughout: a lot of these images came off
// Russian media and carry CP866 filenames that are not valid UTF-8, which
// string paths would mangle into something that no longer opens.
function walk(d, acc) {
  const sep = Buffer.from(path.sep);
  for (const name of fs.readdirSync(d, { encoding: 'buffer' })) {
    const p = Buffer.concat([Buffer.from(d), sep, name]);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) walk(p, acc);
    else if (st.isFile() && st.size > 1024) acc.push(p);
  }
  return acc;
}

// A printable, filesystem-safe rendering of a Buffer path.
function show(p, base) {
  let s = p.toString('latin1');
  if (base) s = s.slice(Buffer.from(base).length + 1);
  return s.replace(/[^\x20-\x7e]/g, (c) => '%' + c.charCodeAt(0).toString(16));
}

const keyCode = H.keyCode;

H.loadRoms(ctx).then((roms) => {
  const files = walk(dir, []).sort();
  const rows = [];
  for (const p of files) {
    let row = { name: show(p, dir), kind: '-', model: '-', note: '' };
    try {
      const s = H.sniffFile(ctx, p, show(p));
      row.kind = s.kind || 'unknown';
      if (!s.kind) { rows.push(row); continue; }
      const model = s.hintModel || 9;
      row.model = model;
      const m = H.makeMachine(ctx, roms,
        { model: model, ramSize: ramSize, slots: slots });
      if (s.kind === 'fil') {
        if (!ctx.AGAT.loadFil) { row.note = 'fil loader pending'; rows.push(row); continue; }
        ctx.AGAT.loadFil(m, s.payload);
      } else {
        const slot = H.insert(m, ctx.AGAT.mount(s));
        m.reset();
        m.bootSlot(slot);
      }
      const cpu = m.cpu;
      const run = (n) => { const e = cpu.cycles + n; while (cpu.cycles < e && !cpu.halted) cpu.step(); };
      run(cycles);
      for (const c of keys) { m.keyDown(keyCode(c)); run(cycles / 2); }

      const v = new ctx.AGAT.Video(model === 7 ? roms.font7 : roms.font9,
                                   roms.palette, { m0: model === 7 ? 0x80 : 0x40 });
      v.render(m);
      let lit = 0;
      for (let i = 0; i < v.width * v.height; i++) if (v.idx[i]) lit++;
      row.ink = (lit * 100 / (v.width * v.height)).toFixed(1) + '%';
      row.mode = m.appleVideo ? 'apple' : 'v' + m.videoMode().vtype;
      row.pc = '$' + cpu.pc.toString(16).toUpperCase().padStart(4, '0');
      row.halted = cpu.halted;
      if (outDir) {
        const out = path.join(outDir, row.name.replace(/[\/\\]/g, '_') + '.png');
        execFileSync(process.execPath,
          [path.join(H.ROOT, 'tools/shot.js'), p.toString('latin1'), keys,
           String(cycles), out, '--model=' + model],
          { stdio: 'ignore' });
      }
    } catch (e) {
      row.note = e.message.slice(0, 40);
    }
    rows.push(row);
  }

  const sep = flags.md ? ' | ' : '  ';
  const head = ['image', 'kind', 'model', 'mode', 'ink', 'pc', 'note'];
  if (flags.md) {
    console.log('| ' + head.join(' | ') + ' |');
    console.log('|' + head.map(() => '---').join('|') + '|');
  }
  for (const r of rows) {
    const cells = [r.name, r.kind, r.model, r.mode || '-', r.ink || '-',
                   r.pc || '-', r.halted ? 'JAM ' + r.note : r.note];
    console.log((flags.md ? '| ' : '') + cells.join(sep) + (flags.md ? ' |' : ''));
  }
  const drawn = rows.filter((r) => r.ink && parseFloat(r.ink) > 0.5).length;
  console.log('\n%d images, %d drawing something', rows.length, drawn);
}).catch((e) => { console.error(e); process.exit(1); });
