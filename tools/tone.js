// PLAY500's interrupt handler, hand-assembled and run on a bare machine, so the
// emulator's interrupt timing and speaker path are measured with no game state
// in the way.
//   node tone.js "<dur,per,dur,per,...,0>" <$84 unit> <irqHz> <raster|held|pulse>
const { loadModules, loadRoms, makeMachine } =
  require('./harness');
const ctx = loadModules(), AGAT = ctx.AGAT;

(async () => {
  const roms = await loadRoms(ctx);
  const TABLE = (process.argv[2] || '3,12,4,8,2,16,0').split(',').map(Number);
  const UNIT = Number(process.argv[3] === undefined ? 16 : process.argv[3]);
  const IRQHZ = Number(process.argv[4] || 0);
  const MODEL = process.argv[5] || 'raster';

  const m = makeMachine(ctx, roms, { model: 7, ramSize: 0x10000 });
  m.reset();
  m.setIrqModel(MODEL);
  if (IRQHZ) m.setSubFrameHz(IRQHZ);

  // The handler, verbatim from RISE OUT's library at $30E3, relocated to $0300.
  const H = [
    0xc6,0x81, 0xd0,0x0b,               // DEC $81 / BNE +11
    0x8d,0x30,0xc0, 0x85,0x86,          // STA $C030 / STA $86
    0xa5,0x85, 0x85,0x81, 0xa5,0x86,    // LDA $85 / STA $81 / LDA $86
    0xc6,0x83, 0xd0,0x0c,               // DEC $83 / BNE +12
    0xc6,0x82, 0xf0,0x09,               // DEC $82 / BEQ +9
    0x85,0x86, 0xa5,0x84, 0x85,0x83, 0xa5,0x86,
    0x40,                               // $031F RTI
    0x78, 0x4c,0x21,0x03,               // $0320 SEI / JMP $0321  (note ended)
  ];
  H.forEach((b, i) => m.write(0x0300 + i, b));

  m.write(0x82, TABLE[0]); m.write(0x81, TABLE[1]); m.write(0x85, TABLE[1]);
  m.write(0x84, UNIT); m.write(0x83, UNIT);

  const MAIN = [0x8d,0x40,0xc0, 0x58, 0x4c,0x04,0x02];   // STA $C040 / CLI / spin
  MAIN.forEach((b, i) => m.write(0x0200 + i, b));

  m.psrom.state = 0x80;                       // write-enable the ЭмПЗУ
  m.write(0x0340, 0x40);                      // a bare RTI for the frame NMI
  m.write(0xfffe, 0x00); m.write(0xffff, 0x03);
  m.write(0xfffa, 0x40); m.write(0xfffb, 0x03);
  m.psrom.state = 0xa0;                       // read-enable it
  console.log('IRQ vector reads back as $' +
              ((m.read(0xfffe) | (m.read(0xffff) << 8)).toString(16)));

  const cpu = m.cpu;
  let takes = [];
  const int0 = cpu.interrupt.bind(cpu);
  cpu.interrupt = function (v, b) { takes.push([v, cpu.cycles]); return int0(v, b); };
  cpu.pc = 0x0200; cpu.s = 0xff; cpu.p = 0x24;
  m.speakerEdges.length = 0;
  const t0 = cpu.cycles, end = t0 + 3 * AGAT.CPU_HZ;
  while (cpu.cycles < end && !cpu.halted && cpu.pc !== 0x0321) cpu.step();

  const e = m.speakerEdges, period = m.irqPeriod(), hz = AGAT.CPU_HZ / period;
  const ints = n => (n / period);
  console.log(`IRQ ${Math.round(hz)} Hz (${MODEL})   $84 = ${UNIT}   table ${TABLE.join(',')}`);
  console.log(`flips ${e.length}   span ${e.length > 1 ? ((e[e.length-1]-e[0])/AGAT.CPU_HZ*1000).toFixed(1) : 0} ms` +
              `   ran ${((cpu.cycles-t0)/AGAT.CPU_HZ*1000).toFixed(1)} ms` +
              `   ${cpu.halted ? 'JAMMED' : (cpu.pc === 0x0321 ? 'note ended' : 'still going')}`);
  console.log('raw flips (cycles from start / gap in interrupts):');
  console.log('  ' + e.map((c, i) => ((c - t0)).toFixed(0) + (i ? '(+' + ints(c - e[i-1]).toFixed(1) + ')' : '')).join(' '));
  const irqT = takes.filter(t => t[0] === 0xfffe);
  console.log(`interrupts taken: IRQ ${irqT.length}, NMI ${takes.length - irqT.length}` +
    '   first IRQ gaps: ' + irqT.slice(1, 12).map((t, i) => (t[1] - irqT[i][1]).toFixed(0)).join(' '));
  let run = 0;
  for (let i = 1; i <= e.length; i++) {
    const g0 = e[run+1] - e[run], g = i < e.length ? e[i] - e[i-1] : -1;
    if (i === e.length || Math.abs(g - g0) > g0 * 0.25) {
      console.log(`   ${String((AGAT.CPU_HZ/(2*g0)).toFixed(1)).padStart(7)} Hz  ` +
        `${ints(g0).toFixed(1).padStart(5)} ints/flip  ${String(i-run).padStart(3)} flips  ` +
        `${((e[i-1]-e[run])/AGAT.CPU_HZ*1000).toFixed(1).padStart(7)} ms`);
      run = i; if (i < e.length) i++;
    }
  }
})();
