// Runs Klaus Dormann's 6502 functional test against src/cpu6502.js.
//
//   node tools/cputest.js [path-to-6502_functional_test.bin]
//
// The image is loaded flat at $0000, execution starts at $0400, and the test
// signals failure by trapping (a branch to itself). Success is reaching $3469.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/cpu6502.js'), 'utf8'), ctx,
                { filename: 'cpu6502.js' });

const binPath = process.argv[2] ||
  path.join(ROOT, 'tools', '6502_functional_test.bin');
if (!fs.existsSync(binPath)) {
  console.error('missing ' + binPath + ' (Klaus Dormann 6502_functional_test.bin)');
  process.exit(2);
}

const mem = new Uint8Array(65536);
mem.set(fs.readFileSync(binPath));

const bus = {
  read: (a) => mem[a],
  write: (a, v) => { mem[a] = v; },
};

const cpu = new ctx.AGAT.CPU(bus);
cpu.reset();
cpu.pc = 0x0400;

const SUCCESS = 0x3469;
let last = -1, steps = 0;
const MAX = 200e6;
while (steps < MAX) {
  last = cpu.pc;
  cpu.step();
  steps++;
  if (cpu.pc === last) break;          // trap: branch to self
  if (cpu.pc === SUCCESS) {
    console.log('PASS  (%d instructions, %d cycles)', steps, cpu.cycles);
    process.exit(0);
  }
  if (cpu.halted) break;
}
console.log('FAIL at $%s after %d instructions%s',
            last.toString(16).toUpperCase().padStart(4, '0'), steps,
            cpu.halted ? ' (JAM $' + cpu.jamOpcode.toString(16) + ')' : ' (trap)');
process.exit(1);
