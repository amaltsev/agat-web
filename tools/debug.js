// Interactive-ish poking at a booting disk.
//
//   node tools/debug.js dump  <image> <untilPC> <addr> <len>  run, then hexdump
//   node tools/debug.js pcs   <image> <untilPC> <n>           log n PCs from there
//   node tools/debug.js until <image> <pc> [cycles]           run to a PC, report
//   node tools/debug.js ring  <image> <cycles> [n]            last n PCs before the end
//   node tools/debug.js crash <image> [cycles] [n]            how it got somewhere bad
//   node tools/debug.js flow  <image> [cycles] [n] [fromPC]   taken branches, loops folded
//
// AGAT_MODEL=7|9 overrides the model the image implies, AGAT_BOOT=cold skips
// the boot and cold-starts into the monitor, AGAT_SP=xx overrides the stack
// pointer bootSlot would have set.
const H = require('./harness');
const { loadModules, loadRoms, makeMachine } = H;

const cmd = process.argv[2];
const image = process.argv[3];
if (!cmd || !image) {
  console.log('usage: node tools/debug.js dump|pcs|until|ring|crash|flow <image> ...');
  process.exit(2);
}
const ctx = loadModules();

const hex = (n, w) => (n >>> 0).toString(16).toUpperCase().padStart(w || 4, '0');

function hexdump(read, addr, len) {
  const out = [];
  for (let r = 0; r < len; r += 16) {
    const row = [];
    let asc = '';
    for (let i = 0; i < 16; i++) {
      const v = read(addr + r + i);
      row.push(hex(v, 2));
      const c = v & 0x7f;
      asc += c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
    }
    out.push(`${hex(addr + r)}: ${row.join(' ')}  ${asc}`);
  }
  return out.join('\n');
}

function runTo(m, targetPC, maxCycles) {
  const cpu = m.cpu;
  const end = cpu.cycles + (maxCycles || 30e6);
  while (cpu.cycles < end && !cpu.halted) {
    cpu.step();
    if (cpu.pc === targetPC) return true;
  }
  return false;
}

loadRoms(ctx).then(async (roms) => {
  // Same boot path as tools/check.js: insert the media, enter the controller's
  // ROM in whichever slot took it.
  const sniffed = await H.sniffFile(ctx, image);
  const model = Number(process.env.AGAT_MODEL) || sniffed.hintModel || 9;
  const m = makeMachine(ctx, roms, { model: model });
  let slot = ctx.AGAT.Machine.SLOTS[model].fdd840;
  if (sniffed.kind && sniffed.kind !== 'fil') {
    slot = H.insert(m, ctx.AGAT.mount(sniffed));
  }

  m.reset();
  if (process.env.AGAT_BOOT !== 'cold') m.bootSlot(slot);
  if (process.env.AGAT_SP) m.cpu.s = parseInt(process.env.AGAT_SP, 16) & 0xff;
  const cpu = m.cpu;

  if (cmd === 'dump') {
    const untilPC = parseInt(process.argv[4], 16);
    const addr = parseInt(process.argv[5], 16);
    const len = parseInt(process.argv[6] || '256', 10);
    if (!runTo(m, untilPC, 30e6)) return console.log('never reached $' + hex(untilPC));
    console.log('reached $%s at cycle %d', hex(untilPC), cpu.cycles);
    console.log(hexdump((a) => m.read(a), addr, len));
  } else if (cmd === 'pcs') {
    const untilPC = parseInt(process.argv[4], 16);
    const n = parseInt(process.argv[5] || '200', 10);
    if (!runTo(m, untilPC, 30e6)) return console.log('never reached $' + hex(untilPC));
    const seen = [];
    for (let i = 0; i < n; i++) {
      seen.push(`${hex(cpu.pc)} a=${hex(cpu.a, 2)} x=${hex(cpu.x, 2)} y=${hex(cpu.y, 2)} op=${hex(m.read(cpu.pc), 2)} s=${hex(cpu.s, 2)}`);
      cpu.step();
      if (cpu.halted) { seen.push('JAM'); break; }
    }
    console.log(seen.join('\n'));
  } else if (cmd === 'until') {
    const pc = parseInt(process.argv[4], 16);
    const cyc = Number(process.argv[5] || 30e6);
    console.log(runTo(m, pc, cyc)
      ? `reached $${hex(pc)} at cycle ${cpu.cycles}`
      : `not reached in ${cyc} cycles (stopped at $${hex(cpu.pc)})`);
  } else if (cmd === 'ring') {
    const cyc = Number(process.argv[4] || 5e6);
    const n = Number(process.argv[5] || 60);
    const ring = new Array(n).fill(0);
    let k = 0;
    const end = cpu.cycles + cyc;
    while (cpu.cycles < end && !cpu.halted) {
      ring[k++ % n] = cpu.pc;
      cpu.step();
    }
    const order = [];
    for (let i = 0; i < n; i++) order.push(hex(ring[(k + i) % n]));
    console.log('last %d PCs:\n%s', n, order.join(' '));
    console.log('stopped at $%s  a=%s x=%s y=%s s=%s', hex(cpu.pc), hex(cpu.a, 2),
                hex(cpu.x, 2), hex(cpu.y, 2), hex(cpu.s, 2));
  } else if (cmd === 'crash') {
    // Run until control lands somewhere it should not (the monitor, or an
    // address the loader never wrote to) and show how it got there.
    const cyc = Number(process.argv[4] || 60e6);
    const n = Number(process.argv[5] || 40);
    const ring = [];
    const end = cpu.cycles + cyc;
    const written = new Uint8Array(256);
    const origWrite = m.write.bind(m);
    m.write = (a, v) => { if (a < 0xc000) written[a >> 8] = 1; origWrite(a, v); };
    while (cpu.cycles < end && !cpu.halted) {
      const before = cpu.pc;
      cpu.step();
      if (cpu.pc < before || cpu.pc > before + 3) {
        ring.push(`${hex(before)} -> ${hex(cpu.pc)}  a=${hex(cpu.a, 2)} x=${hex(cpu.x, 2)} y=${hex(cpu.y, 2)} s=${hex(cpu.s, 2)}`);
        if (ring.length > n) ring.shift();
      }
      if (cpu.pc >= 0xf800 && cpu.cycles > 4e5) break;
    }
    console.log(ring.join('\n'));
    console.log('--- entered $%s at cycle %d', hex(cpu.pc), cpu.cycles);
    console.log('pages written:', Array.from(written.entries())
      .filter(([, v]) => v).map(([p]) => hex(p * 256)).join(' '));
  } else if (cmd === 'flow') {
    // Control-flow trace with loops collapsed: one line per taken jump/branch,
    // repeats folded into a count.
    const cyc = Number(process.argv[4] || 5e6);
    const limit = Number(process.argv[5] || 400);
    const from = process.argv[6] ? parseInt(process.argv[6], 16) : -1;
    if (from >= 0 && !runTo(m, from, 30e6)) return console.log('never reached $' + hex(from));
    const end = cpu.cycles + cyc;
    const out = [];
    while (cpu.cycles < end && !cpu.halted && out.length < limit) {
      const before = cpu.pc;
      cpu.step();
      const taken = cpu.pc < before || cpu.pc > before + 3;
      if (!taken) continue;
      const line = `${hex(before)} -> ${hex(cpu.pc)}  a=${hex(cpu.a, 2)} x=${hex(cpu.x, 2)} y=${hex(cpu.y, 2)}`;
      const last = out[out.length - 1];
      if (last && last.key === before * 65536 + cpu.pc) last.n++;
      else out.push({ key: before * 65536 + cpu.pc, line: line, n: 1 });
    }
    console.log(out.map((o) => o.line + (o.n > 1 ? `   x${o.n}` : '')).join('\n'));
    console.log('--- stopped at $%s after %d cycles', hex(cpu.pc), cpu.cycles);
  } else {
    console.log('usage: dump|pcs|until|ring|crash|flow');
  }
}).catch((e) => { console.error(e); process.exit(1); });
