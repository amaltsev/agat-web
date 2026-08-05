// Headless driver.
//
//   node tools/check.js boot   <image> [cycles]  boot and report where it got to
//   node tools/check.js io     <image> [cycles]  histogram of $C0xx accesses
//   node tools/check.js trace  <image> [cycles]  every $C0xx access, in order
//   node tools/check.js pages  <image> [cycles]  RAM write histogram by page
//   node tools/check.js sniff  <file...>         what the sniffer makes of each
//   node tools/check.js modules                  index.html vs tools/modules.js
//
// --model=7|9 overrides the model the filename implies, --slot=N the boot slot,
// --cold skips the boot and cold-starts into the monitor instead.
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const argv = process.argv.slice(2);
const cmd = argv.shift() || 'boot';
const flags = {};
const rest = argv.filter((a) => {
  const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
  if (!m) return true;
  flags[m[1]] = m[2] === undefined ? true : m[2];
  return false;
});

const hex = (n, w) => '$' + (n >>> 0).toString(16).toUpperCase().padStart(w || 4, '0');

// --- subcommands that need no machine ---------------------------------------

if (cmd === 'modules') {
  const html = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
  const inHtml = [];
  const re = /<script src="(src\/[^"]+)"/g;
  let mm;
  while ((mm = re.exec(html))) inHtml.push(mm[1]);
  const want = H.MODULES;
  const same = inHtml.length === want.length && inHtml.every((v, i) => v === want[i]);
  console.log('index.html : ' + inHtml.join(' '));
  console.log('modules.js : ' + want.join(' '));
  console.log(same ? 'OK - in step' : 'MISMATCH');
  process.exit(same ? 0 : 1);
}

const ctx = H.loadModules();

if (cmd === 'sniff') {
  for (const p of rest) {
    const s = H.sniffFile(ctx, p);
    const size = fs.statSync(p).size;
    let extra = '';
    if (s.kind === 'fil') {
      extra = '  load=' + hex(s.loadAddr) + ' len=' + s.length +
              ' type=' + hex(s.fileType, 2) + ' "' + s.filName + '"';
    } else if (s.kind) {
      extra = '  model-hint=' + (s.hintModel || '-') + (s.writeProtect ? ' WP' : '');
    }
    console.log((s.kind || 'unknown').padEnd(8) + ' ' +
                String(size).padStart(8) + '  ' + path.basename(p) + extra);
  }
  process.exit(0);
}

// --- everything else boots a machine ----------------------------------------

const target = rest[0];
const cycles = Number(rest[1] || 40e6);
if (!target) { console.error('need an image'); process.exit(2); }

H.loadRoms(ctx).then((roms) => {
  const sniffed = H.sniffFile(ctx, target);
  const model = flags.model ? Number(flags.model) : (sniffed.hintModel || 9);
  const m = H.makeMachine(ctx, roms, { model: model });
  let slot = ctx.AGAT.Machine.SLOTS[model].fdd840;
  if (sniffed.kind && sniffed.kind !== 'fil') {
    slot = H.insert(m, ctx.AGAT.mount(sniffed));
  }
  if (flags.slot) slot = Number(flags.slot);

  const seen = [];
  const pages = new Float64Array(256);
  if (cmd === 'trace') {
    let n = 0;
    m.trace = (rw, a, v, pc) => {
      if (n++ < 4000) seen.push(rw + ' ' + hex(a) + ' = ' + hex(v, 2) + '  pc=' + hex(pc));
    };
  }
  if (cmd === 'pages') {
    const orig = ctx.AGAT.Machine.prototype.write;
    m.write = function (a, v) { if (a < 0xc000) pages[a >> 8]++; orig.call(m, a, v); };
  }

  m.reset();
  if (!flags.cold) m.bootSlot(slot);

  const cpu = m.cpu;
  const end = cpu.cycles + cycles;
  let lastPC = -1, stuck = 0, stuckAt = -1;
  while (cpu.cycles < end && !cpu.halted) {
    cpu.step();
    if (cpu.pc === lastPC) { if (++stuck > 200000) { stuckAt = cpu.pc; break; } }
    else { stuck = 0; lastPC = cpu.pc; }
  }

  console.log('image      ' + path.basename(target) + '  (' + sniffed.kind + ')');
  console.log('machine    Agat-' + model + (flags.cold ? ', cold start' : ', boot slot ' + slot));
  console.log('cycles     ' + cpu.cycles + ' (' + (cpu.cycles / 1.02e6).toFixed(2) + ' s)');
  console.log('pc         ' + hex(cpu.pc) + '   a=' + hex(cpu.a, 2) + ' x=' + hex(cpu.x, 2) +
              ' y=' + hex(cpu.y, 2) + ' s=' + hex(cpu.s, 2) + ' p=' + hex(cpu.p, 2));
  if (cpu.halted) console.log('HALTED     illegal opcode ' + hex(cpu.jamOpcode, 2) + ' at ' + hex(cpu.jamPC));
  if (stuckAt >= 0) console.log('SPINNING   tight loop at ' + hex(stuckAt));
  const card = m.cards[slot];
  if (card && card.hasDisk && card.hasDisk()) {
    console.log('disk head  track ' + card.track + ', byte ' + card.pos);
  }

  if (cmd === 'io') {
    console.log('--- $C0xx accesses ---');
    for (const k of Object.keys(m.ioSeen).sort()) {
      console.log('  ' + k[0] + ' $' + k.slice(1).toUpperCase() + '  ' + m.ioSeen[k]);
    }
  }
  if (cmd === 'trace') console.log(seen.join('\n'));
  if (cmd === 'pages') {
    const rows = [];
    for (let p = 0; p < 256; p++) if (pages[p]) rows.push([p, pages[p]]);
    rows.sort((a, b) => b[1] - a[1]);
    console.log('--- busiest pages ---');
    for (const r of rows.slice(0, 20)) console.log('  ' + hex(r[0] * 256) + '  ' + r[1]);
  }
}).catch((e) => { console.error(e); process.exit(1); });
