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
// result: a tool wants the image, and the container is where everything else it
// might want — the machine, the RAM size — is written down.
function sniffFile(ctx, p, displayName) {
  const bytes = new ctx.Uint8Array(fs.readFileSync(p));
  const s = ctx.AGAT.sniff(bytes, displayName || String(p));
  if (s.kind !== 'agc') return Promise.resolve(s);
  return ctx.AGAT.agc.parse(bytes, s.name).then((c) => {
    const first = c.media[0];
    if (!first) throw new Error(p + ': container carries no media');
    const inner = ctx.AGAT.sniff(first.payload, first.name);
    inner.agc = c;
    return inner;
  });
}

// The machine a sniffed file asks for, or 0 if nothing does — which is every
// bare image, since nothing about a disk says which Agat it belongs to. Written
// once here because each tool falls back to a different default of its own.
function modelOf(s) {
  return (s.agc && s.agc.machine.model) || 0;
}

function mountFile(ctx, p) {
  return sniffFile(ctx, p).then((s) => ctx.AGAT.mount(s));
}

// Build a machine with the stock card complement for its model — the same
// Machine.PROFILES the page builds from, so a tool and the browser cannot end
// up testing different hardware. `opts.slots` overrides it the way an .agc
// does, and `opts.agc` is a parsed container whose machine is taken whole:
// its base RAM and its cards, under whatever the command line says over them.
//
// A tool that took only the model out of a container ran the program on a
// machine the container did not describe — a container that moves the 840K
// controller to slot 6 booted the stock one at slot 5 — which is the one thing
// README promises the tools do not do.
function makeMachine(ctx, roms, opts) {
  opts = opts || {};
  const A = ctx.AGAT;
  const model = opts.model === 7 ? 7 : 9;
  const named = (opts.agc && opts.agc.machine) || null;
  const ramSize = opts.ramSize || (named && named.ram * 1024) || undefined;
  // Slot by slot, the flags winning: --mouse puts a mouse in a machine whose
  // container says nothing about one, and leaves the rest of it alone.
  const slots = named && named.slots
    ? Object.assign(A.agc.scaleSlots(named.slots), opts.slots || null)
    : opts.slots;
  const m = new A.Machine({
    model: model,
    ramSize: ramSize,
    sysmon: model === 7 ? roms.monitor7 : roms.monitor9,
  });
  m.slots = A.Machine.resolveSlots(model, slots);
  m.fit(m.slots, roms);
  if (opts.media) insert(m, opts.media);
  return m;
}

// The machine a container was saved in the middle of, put back into the machine
// just built — the same thing App.applyAgc does after the media load, so that a
// container carrying a `state` resumes at the command line as it does on the
// page. Returns the sentence for whoever is printing a line, empty when the
// container carried no state; a state that does not fit says why and the
// machine is left booting, which is the behavior the page has.
//
// `slots` beside `machine` is the whole of what state.js asks of an App, so the
// machine itself does — makeMachine hangs the resolved map on it.
function resume(ctx, m, agc) {
  if (!agc || !agc.state) return Promise.resolve('');
  const A = ctx.AGAT;
  const app = { machine: m, slots: m.slots };
  return A.state.restore(app, agc.state).then(
    (s) => A.state.describe(s),
    (e) => 'booted - ' + e.message);
}

// Where a tool boots when the medium did not decide it: the 840K controller of
// the machine that got built, which a container may have moved, and failing
// that the slot this model keeps one in — entering an empty slot's ROM is
// something a command can still ask for, so there is always a number.
function fddSlot(m) {
  const A = m.constructor;
  const n = A.slotOf(m.slots || A.resolveSlots(m.model, null), 'fdd840');
  return n < 0 ? A.SLOTS[m.model].fdd840 : n;
}

// Put media into whichever controller can read it, in the drive named or the
// first; returns the slot used.
function insert(m, media, drv) {
  const A = m.constructor;
  const slots = m.slots || A.resolveSlots(m.model, null);
  const slot = A.slotOf(slots, media.kind === 'nib140' ? 'fdd140' : 'fdd840');
  const card = m.cards[slot];
  if (!card || !card.insert) throw new Error('no controller for ' + media.kind);
  card.insert(media, drv);
  return slot;
}

// The keystrokes a --keys= string sends. `~` is Return, `_` Space, `^` Escape,
// and anything else is itself: enough to drive a menu or type a DOS command,
// and short enough to sit in a shell argument without quoting.
// One character of a --keys string, as the byte the Agat keyboard sends: the
// three ASCII stand-ins that survive a shell, and the arrows as themselves.
function keyCode(c) {
  if (c === '~') return 0x0d;
  if (c === '_') return 0x20;
  if (c === '^') return 0x1b;
  if (c === '↑') return 0x19;
  if (c === '↓') return 0x1a;
  if (c === '←') return 0x08;
  if (c === '→') return 0x15;
  return c.toUpperCase().charCodeAt(0);
}

module.exports = {
  loadModules, loadRoms, sniffFile, mountFile, modelOf, makeMachine, insert,
  fddSlot, keyCode, resume,
  ROOT, MODULES,
};
