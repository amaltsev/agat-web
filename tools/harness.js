// Loads the browser modules under Node so a machine can be booted and traced
// without a browser. Shared by every tool in here.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MODULES } = require('./modules');

const ROOT = path.dirname(__dirname);

function loadModules() {
  const sandbox = {
    console, atob, btoa, Response, DecompressionStream, TextDecoder, TextEncoder,
    Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray, Int32Array,
    Promise, Math, Date, JSON, Object, Array, String, Number, Error,
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of MODULES) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) throw new Error('missing module ' + f);
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

function loadRoms(ctx) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'roms/roms.js'), 'utf8'), ctx,
                  { filename: 'roms.js' });
  return ctx.AGAT.loadRoms(ctx.window.AGAT_ROMS);
}

// Read a file off disk and classify it exactly as the browser does.
//
// An .agc is unwrapped to its first medium, with the container left on the
// result: a tool wants the image, and the machine the container names is a
// better default than the one a filename implies. Its own `hintModel` is what
// carries that, so every tool that already honours a `7a` in a path honours a
// container without being changed.
function sniffFile(ctx, p, displayName) {
  const bytes = new ctx.Uint8Array(fs.readFileSync(p));
  const s = ctx.AGAT.sniff(bytes, displayName || String(p));
  if (s.kind !== 'agc') return s;
  const first = s.agc.media[0];
  if (!first) throw new Error(p + ': container carries no media');
  const inner = ctx.AGAT.sniff(first.payload, first.name);
  inner.hintModel = s.agc.machine.model || inner.hintModel;
  inner.agc = s.agc;
  return inner;
}

function mountFile(ctx, p) {
  return ctx.AGAT.mount(sniffFile(ctx, p));
}

// Build a machine with the standard card complement for its model.
function makeMachine(ctx, roms, opts) {
  opts = opts || {};
  const A = ctx.AGAT;
  const model = opts.model === 7 ? 7 : 9;
  const slots = A.Machine.SLOTS[model];
  const m = new A.Machine({
    model: model,
    ramSize: opts.ramSize,
    sysmon: model === 7 ? roms.monitor7 : roms.monitor9,
  });
  if (slots.psrom && A.Psrom7) m.addCard(slots.psrom, new A.Psrom7());
  m.addCard(slots.fdd840, new A.Disk840({ rom: roms.teac }));
  if (A.Disk140) {
    m.addCard(slots.fdd140, new A.Disk140({
      rom: model === 7 ? roms.shugart7 : roms.shugart9,
    }));
  }
  if (opts.media) insert(m, opts.media);
  return m;
}

// Put media into whichever controller can read it; returns the slot used.
function insert(m, media) {
  const slots = ctx_SLOTS(m)[m.model];
  const slot = media.kind === 'nib140' ? slots.fdd140 : slots.fdd840;
  const card = m.cards[slot];
  if (!card || !card.insert) throw new Error('no controller for ' + media.kind);
  card.insert(media);
  return slot;
}

function ctx_SLOTS(m) { return m.constructor.SLOTS; }

module.exports = {
  loadModules, loadRoms, sniffFile, mountFile, makeMachine, insert,
  ROOT, MODULES,
};
