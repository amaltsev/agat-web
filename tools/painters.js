// Render each native mode from a synthetic pattern and print it as text art.
// No machine, no disk — this checks the addr -> (x,y) geometry on its own, which
// is the part of the renderer that is easy to get subtly wrong and impossible
// to eyeball on a real screen.
//
//   node tools/painters.js [vtype...]
const H = require('./harness');

const ctx = H.loadModules();
const A = ctx.AGAT;
const V = A.VTYPE;

const NAMES = {
  0: '64x64x4 (Agat-7)', 1: '128x128x4', 2: 'Text 32x32', 3: '256x256x1',
  4: 'Text 64x32', 5: '256x256x2 (Agat-9)', 6: '512x256x1 (Agat-9)',
  10: 'Text 64x32 inverse (Agat-7)',
};

// Down-sample the 512x256 index buffer to something printable.
function artOf(v, cols, rows) {
  const RAMP = ' .:-=+*#%@';
  const out = [];
  for (let r = 0; r < rows; r++) {
    let s = '';
    for (let c = 0; c < cols; c++) {
      const x = Math.floor(c * 512 / cols), y = Math.floor(r * 256 / rows);
      let sum = 0, n = 0;
      for (let dy = 0; dy < 256 / rows; dy++) {
        for (let dx = 0; dx < 512 / cols; dx++) {
          sum += v.idx[(y + dy) * 512 + x + dx]; n++;
        }
      }
      s += RAMP[Math.min(9, Math.round(sum / n / 15 * 9))];
    }
    out.push('|' + s + '|');
  }
  return out.join('\n');
}

H.loadRoms(ctx).then((roms) => {
  const want = process.argv.slice(2).map(Number);
  const ram = new ctx.Uint8Array(0x20000);
  const mask = ram.length - 1;

  // A pattern with structure in both axes: a diagonal, a border and a ramp.
  for (let i = 0; i < 0x4000; i++) {
    const b = ((i * 7) >> 4) & 0xff;
    ram[i] = b;
  }
  // A clearly asymmetric marker in the first bytes so orientation shows up.
  for (let i = 0; i < 64; i++) ram[i] = 0xff;
  for (let i = 0; i < 0x800; i += 2) { ram[i] = 0xc1; ram[i + 1] = 0x2f; }

  const pal = A.Palette.LIST[0];
  const modes = [V.LGR, V.MGR, V.T32, V.HGR, V.T64, V.MCGR, V.DGR, V.T64I];
  for (const vt of modes) {
    if (want.length && want.indexOf(vt) < 0) continue;
    const m0 = (vt === V.LGR || vt === V.T64I) ? 0x80 : 0x40;
    const font = m0 === 0x80 ? roms.font7 : roms.font9;
    const v = new A.Video(font, roms.palette, { m0: m0 });
    v.idx.fill(0);
    switch (vt) {
      case V.LGR: v.lgr(ram, mask, 0); break;
      case V.MGR: v.mgr(ram, mask, 0); break;
      case V.HGR: v.hgr(ram, mask, 0, pal); break;
      case V.DGR: v.dgr(ram, mask, 0, pal); break;
      case V.MCGR: v.mcgr(ram, mask, 0, pal); break;
      case V.T32: v.t32(ram, mask, 0, pal); break;
      case V.T64: v.t64(ram, mask, 0, pal.c2[1], pal.c2[0]); break;
      case V.T64I: v.t64(ram, mask, 0, 0, 15); break;
    }
    let lit = 0;
    for (let i = 0; i < v.idx.length; i++) if (v.idx[i]) lit++;
    console.log('=== vtype %d  %s  (%d%% of the raster lit) ===',
                vt, NAMES[vt], Math.round(lit * 100 / v.idx.length));
    console.log(artOf(v, 64, 16));
    console.log();
  }
}).catch((e) => { console.error(e); process.exit(1); });
