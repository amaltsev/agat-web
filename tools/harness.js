// Loads the browser modules under Node so a machine can be booted and traced
// without a browser. Shared by every tool in here.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MODULES } = require('./modules');

const ROOT = path.dirname(__dirname);

function loadModules() {
  const sandbox = {
    console, atob, btoa, Response, TextDecoder, TextEncoder,
    CompressionStream, DecompressionStream,
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

// Read a file off disk and classify it exactly as the browser does. A promise,
// because reading a container is one — its payload may be gzipped — and the
// browser's own load path is a promise for the same reason.
//
// An .agc is unwrapped to its first medium, with the container left on the
// result: a tool wants the image, and the machine the container names is a
// better default than the one a filename implies. Its own `hintModel` is what
// carries that, so every tool that already honours a `7a` in a path honours a
// container without being changed.
function sniffFile(ctx, p, displayName) {
  const bytes = new ctx.Uint8Array(fs.readFileSync(p));
  const s = ctx.AGAT.sniff(bytes, displayName || String(p));
  if (s.kind !== 'agc') return Promise.resolve(s);
  return ctx.AGAT.agc.parse(bytes, s.name).then((c) => {
    const first = c.media[0];
    if (!first) throw new Error(p + ': container carries no media');
    const inner = ctx.AGAT.sniff(first.payload, first.name);
    inner.hintModel = c.machine.model || inner.hintModel;
    inner.agc = c;
    return inner;
  });
}

function mountFile(ctx, p) {
  return sniffFile(ctx, p).then((s) => ctx.AGAT.mount(s));
}

// Build a machine with the stock card complement for its model — the same
// Machine.PROFILES the page builds from, so a tool and the browser cannot end
// up testing different hardware. `opts.slots` overrides it the way an .agc does.
function makeMachine(ctx, roms, opts) {
  opts = opts || {};
  const A = ctx.AGAT;
  const model = opts.model === 7 ? 7 : 9;
  const m = new A.Machine({
    model: model,
    ramSize: opts.ramSize,
    sysmon: model === 7 ? roms.monitor7 : roms.monitor9,
  });
  m.slots = A.Machine.resolveSlots(model, opts.slots);
  m.fit(m.slots, roms);
  if (opts.media) insert(m, opts.media);
  return m;
}

// Put media into whichever controller can read it; returns the slot used.
function insert(m, media) {
  const A = m.constructor;
  const slots = m.slots || A.resolveSlots(m.model, null);
  const slot = A.slotOf(slots, media.kind === 'nib140' ? 'fdd140' : 'fdd840');
  const card = m.cards[slot];
  if (!card || !card.insert) throw new Error('no controller for ' + media.kind);
  card.insert(media);
  return slot;
}

// The keystrokes a --keys= string sends. `~` is Return, `_` Space, `^` Escape,
// and anything else is itself: enough to drive a menu or type a DOS command,
// and short enough to sit in a shell argument without quoting.
function keyCode(c) {
  if (c === '~') return 0x0d;
  if (c === '_') return 0x20;
  if (c === '^') return 0x1b;
  return c.toUpperCase().charCodeAt(0);
}

module.exports = {
  loadModules, loadRoms, sniffFile, mountFile, makeMachine, insert, keyCode,
  ROOT, MODULES,
};
