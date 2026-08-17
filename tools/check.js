// Headless driver.
//
//   node tools/check.js boot   <image> [cycles]  boot and report where it got to
//   node tools/check.js io     <image> [cycles]  histogram of $C0xx accesses
//   node tools/check.js trace  <image> [cycles]  every $C0xx access, in order
//   node tools/check.js pages  <image> [cycles]  RAM write histogram by page
//   node tools/check.js write  <image> [cycles]  boot unlocked, then say what
//                                                the disk was written with
//   node tools/check.js sniff  <file...>         what the sniffer makes of each
//   node tools/check.js keys   <.agc | KeyW=^ | Space>
//                                                the controls panel and the
//                                                board a container leaves,
//                                                drawn in the terminal;
//                                                --group=NAME cuts it to one
//                                                control group, --rus switches
//                                                the layout, --view=agat draws
//                                                the whole machine's board
//   node tools/check.js kbdmenu                  the page's keyboard menu, run
//                                                against a stub <select>
//   node tools/check.js modules                  index.html vs tools/modules.js
//
// --model=7|9 overrides the model the filename implies, --slot=N the boot slot,
// --cold skips the boot and cold-starts into the monitor instead,
// --keys=STR types a string once the machine is up (~ Return, _ Space, ^ Esc)
// and --per=N is how many cycles each keystroke gets.
//
// `write` is what turns "the save worked" into something measurable:
//
//   node tools/check.js write dos33.dsk --keys='~SAVE_X~'
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
const die = (e) => { console.error(e.message || e); process.exit(1); };

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

// The commands that read a container are asynchronous, because reading one is:
// a payload may be gzipped. Each starts its own chain and then returns, rather
// than falling through to the boot at the bottom of the file.
if (cmd === 'sniff') {
  sniff().catch(die);
  return;
}

async function sniff() {
  for (const p of rest) {
    const s = await H.sniffFile(ctx, p);
    const size = fs.statSync(p).size;
    let extra = '';
    if (s.kind === 'fil') {
      extra = '  load=' + hex(s.loadAddr) + ' len=' + s.length +
              ' type=' + hex(s.fileType, 2) + ' "' + s.filName + '"';
    } else if (s.kind) {
      extra = '  model-hint=' + (s.hintModel || '-') + (s.writeProtect ? ' WP' : '');
    }
    // sniffFile unwraps a container to its first medium, so the line above
    // describes the image; this says which container it came out of.
    if (s.agc) {
      const c = s.agc;
      const key = (k) => {
        const v = c.keys[k], spec = v && typeof v === 'object' ? v : { code: v };
        return k + (spec.code ? '→' + spec.code : '') +
               (spec.hint ? ' (' + spec.hint + ')' : '');
      };
      extra += '\n         .agc "' + c.title + '"' +
               (c.author ? ' by ' + c.author : '') + (c.date ? ', ' + c.date : '') +
               '  Agat-' + (c.machine.model || '?') +
               (c.machine.ram ? ' ' + c.machine.ram + 'K' : '') +
               '  ' + c.media.length + ' media' +
               (c.url ? '\n         ' + c.url : '') +
               '\n         keys: ' + (Object.keys(c.keys).length
                 ? Object.keys(c.keys).map(key).join(', ') : 'none') +
               (Object.keys(c.controls).length
                 ? '\n         controls: ' + Object.keys(c.controls).map((g) =>
                     g + ' (' + Object.keys(c.controls[g]).length + ')').join(', ')
                 : '');
    }
    console.log((s.kind || 'unknown').padEnd(8) + ' ' +
                String(size).padStart(8) + '  ' + path.basename(p) + extra);
  }
  process.exit(0);
}

// The controls panel and the on-screen board, drawn in the terminal. The board
// is the winnowed one — the АГАТ board with everything the container did not
// name shrunk to a sliver — and between them they are the cheap way to see what
// a container will actually put in front of a player, without a browser. Neither
// touches any DOM until it is built, so a stub document is enough.
if (cmd === 'keys') {
  readContainers(rest).then(keysCmd).catch(die);
  return;
}

// Every .agc named on the command line, read before anything is drawn: drawing
// a board is synchronous and reading a container is not.
function readContainers(args) {
  const want = args.filter((a) => !/=/.test(a) && /\.agc$/i.test(a));
  return Promise.all(want.map(
    (a) => ctx.AGAT.agc.parse(fs.readFileSync(a), path.basename(a))
  )).then((cs) => new Map(want.map((a, i) => [a, cs[i]])));
}

function keysCmd(loaded) {
  const A = ctx.AGAT;
  const el = () => ({
    children: [], style: {}, className: '', textContent: '', title: '',
    // parentNode as well as children: a tap lands on the deepest element under
    // the finger and is walked back up to the thing that owns it.
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    parentNode: null,
    _l: [],
    addEventListener(t, f) { this._l.push([t, f]); },
    removeEventListener(t, f) { this._l = this._l.filter((x) => x[1] !== f); },
    fire(t, ev) { for (const [tt, f] of this._l) if (tt === t) f(ev); },
    set innerHTML(v) { this.children = []; },
    get innerHTML() { return ''; },
  });
  ctx.document = { createElement: el, addEventListener() {}, removeEventListener() {} };

  // Either a container's keys and controls, or a map written on the command line
  // the way the container writes it: KeyW=^ names a remap, a bare Space declares
  // a key. Controls can only come from a file — they are grouped, and a group is
  // more than one argument's worth.
  const keys = {};
  let controls = null;
  let hint = '';
  for (const a of rest) {
    if (/=/.test(a)) { const [k, v] = a.split('='); keys[k] = v; continue; }
    if (!/\.agc$/i.test(a)) { keys[a] = null; continue; }
    const c = loaded.get(a);
    Object.assign(keys, c.keys);
    if (Object.keys(c.controls).length) Object.assign(controls = controls || {}, c.controls);
    // Several containers on one line are one panel here, as their keys are.
    if (c.hint) hint = hint ? hint + ' ' + c.hint : c.hint;
    console.log(c.title + (c.author ? ' — ' + c.author : ''));
  }
  const set = A.keyboard.setRemap(Object.keys(keys).length ? keys : null);
  const ctl = A.keyboard.setControls(controls);
  console.log('keys: ' + set.ok + ', ' + set.remapped + ' remapped' +
              (set.bad.length ? ', ignored ' + set.bad.join(', ') : ''));
  console.log('controls: ' + ctl.rows + ' in ' + ctl.groups + ' group(s)' +
              (ctl.bad.length ? ', ignored ' + ctl.bad.join(', ') : ''));

  // The panel as the page draws it, walked back out of the stub nodes: a group
  // is its name and then a line per row, and a line is the codes and the label.
  const panel = new A.ControlPanel(el(), { hint });
  const group = flags.group === true ? '' : (flags.group || '');
  for (const g of panel.groups) {
    console.log('  ' + g.name + (g.name === group ? '  ←' : ''));
    for (const line of g.el.children.slice(1)) {
      const [code, what] = line.children;
      console.log('    ' + code.textContent.padEnd(14) + (what ? what.textContent : ''));
    }
  }
  // Whatever the panel put below the groups — the container's hint, which is
  // the one child that belongs to no group. Read back off the built nodes, so
  // this says what the page draws rather than what it was handed.
  for (const kid of panel.el.children) {
    if (!kid.__group) console.log('  ' + kid.textContent);
  }

  const app = { machine: { kbdLatch: 0, cyrillic: !!flags.rus }, reset() {} };
  const view = new A.KeyView(el(), app, {
    view: flags.view === 'agat' ? 'agat' : 'used' + (group ? ':' + group : ''),
    rus: !!flags.rus,
  });
  // Read back off the caps rather than off the table they were built from, so
  // this shows what the page draws: the winnowed board puts the legend the
  // program reads on top, which is not always the order the machine prints.
  // A named legend gets a star, the terminal's version of the underline. It is
  // per half, not per cap — `K` and `К` are two controls on one key, and a cap
  // kept only as a stand-in has named neither of its legends.
  const half = (sp) => sp.textContent + (/\bnamed\b/.test(sp.className) ? '*' : '');
  const capText = (c) => c.gone ? '·'
    : '[' + half(c.top) + (c.bot.textContent ? '/' + half(c.bot) : '') + ']';
  for (const b of view.blocks) {
    if (b.el.style.display === 'none') { console.log('  (block winnowed away)'); continue; }
    for (const r of b.rows) {
      if (r.el.style.display === 'none') continue;
      const pad = ' '.repeat(Math.round(parseFloat(r.el.style.marginLeft) || 0));
      console.log('  ' + pad + r.caps.map(capText).join(' '));
    }
  }
  console.log('  board: ' + view.board.style.fontSize);

  // Then build every other board over the same container. Only the winnowed one
  // is drawn above, and a field that exists there and nowhere else — plan() sets
  // one — is a page that comes up blank on the board it opens with. Cheap to
  // rule out here, and there is nothing else that would.
  for (const v of ['agat', 'pc', 'used']) {
    new A.KeyView(el(), app, { view: v, rus: !!flags.rus });
  }
  console.log('  every board builds');
  process.exit(0);
}

// The keyboard menu's own logic, lifted out of index.html and run against a stub
// <select>. Everything else in src/ is testable because it is in src/; this is
// the one piece of behaviour that lives in the page, and its hard cases are all
// about load order — a bookmarked control group whose container is still on the
// wire, a second container that takes that group away — which is exactly what a
// browser makes tedious to reach and easy to get wrong. The functions are found
// by name and fail loudly if they are renamed.
if (cmd === 'kbdmenu') {
  // The two containers this drives, read up front for the same reason the
  // `keys` command reads its own: the menu's logic is synchronous.
  readContainers(['rise-out.agc', 'snake.agc'].map(
    (f) => path.join(H.ROOT, 'examples', f))).then(kbdmenuCmd).catch(die);
  return;
}

function kbdmenuCmd(loaded) {
  const A = ctx.AGAT;
  const page = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
  const grab = (name) => {
    const at = page.indexOf('function ' + name + '(');
    if (at < 0) throw new Error('index.html has no function ' + name);
    let depth = 0;
    for (let j = page.indexOf('{', at); j < page.length; j++) {
      if (page[j] === '{') depth++;
      else if (page[j] === '}' && --depth === 0) return page.slice(at, j + 1);
    }
    throw new Error(name + ' does not close');
  };

  // An <option>/<optgroup> pair and a <select> that answers `options` and `value`
  // the way one does: assigning a value no option carries leaves the select
  // showing nothing, and so does removing the option that was selected.
  const opt = (tag) => ({ tag, value: '', textContent: '', label: '', children: [],
                          appendChild(c) { this.children.push(c); return c; } });
  class Select {
    constructor() { this.kids = []; this._value = ''; this.disabled = false; }
    get options() {
      const out = [];
      for (const k of this.kids) k.tag === 'optgroup' ? out.push(...k.children) : out.push(k);
      return out;
    }
    get value() {
      return this.options.some((o) => o.value === this._value) ? this._value : '';
    }
    set value(v) { this._value = String(v); }
    appendChild(c) { this.kids.push(c); return c; }
    removeChild(c) { this.kids = this.kids.filter((x) => x !== c); }
    querySelector() { return this.options.find((o) => o.value === 'used'); }
  }
  const el = () => ({
    children: [], style: {}, className: '', textContent: '', title: '',
    // parentNode as well as children: a tap lands on the deepest element under
    // the finger and is walked back up to the thing that owns it.
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    parentNode: null,
    _l: [],
    addEventListener(t, f) { this._l.push([t, f]); },
    removeEventListener(t, f) { this._l = this._l.filter((x) => x[1] !== f); },
    fire(t, ev) { for (const [tt, f] of this._l) if (tt === t) f(ev); },
    set innerHTML(v) { this.children = []; },
    get innerHTML() { return ''; },
  });
  ctx.document = global.document = {
    createElement: (t) => (t === 'option' || t === 'optgroup' ? opt(t) : el()),
    addEventListener() {}, removeEventListener() {},
  };
  global.AGAT = A;

  let pass = 0, fail = 0;
  const eq = (what, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++;
    console.log('FAIL ' + what + '\n  got  ' + g + '\n  want ' + w);
  };

  // The page's variables, and the two things syncKbd calls that are not its own.
  let kbdSel, usedOpt, usedBox, wantKbd, panel, kbdChosen, handheld, controlsEl;
  let applied = [], saved = 0;
  // The App, as much of it as syncKbd touches: the container's hint, which the
  // panel is handed because it belongs to the container rather than to the
  // keyboard's tables.
  const app = { hint: '' };
  function applyKbd() {
    applied.push(kbdSel.value);
    if (panel) panel.mark(groupOf(kbdSel.value));
  }
  function saveUrl() { saved++; }
  eval(grab('pick'));
  eval(grab('groupOf'));
  eval(grab('pickGroup'));
  eval(grab('buildKbdOptions'));
  eval(grab('syncKbd'));
  eval(grab('hasKbdOption'));

  // The page as it opens: the four static options, and the address read before
  // any container is.
  const reset = (urlKbd) => {
    kbdSel = new Select();
    for (const [v, t] of [['', 'Keyboard off'], ['agat', 'АГАТ keyboard'],
                          ['pc', 'PC keyboard'], ['used', 'Only mapped keys']]) {
      const o = opt('option'); o.value = v; o.textContent = t; kbdSel.appendChild(o);
    }
    usedOpt = kbdSel.querySelector();
    usedBox = null; panel = null; controlsEl = el();
    applied = []; saved = 0; handheld = false;
    kbdChosen = !!urlKbd;
    wantKbd = pick(kbdSel, urlKbd) ? '' : (urlKbd || '');
  };
  const load = (f) => {
    const c = loaded.get(path.join(H.ROOT, 'examples', f));
    A.keyboard.setRemap(c.keys);
    A.keyboard.setControls(c.controls);
    app.hint = c.hint;
  };
  const unload = () => {
    A.keyboard.setRemap(null); A.keyboard.setControls(null); app.hint = '';
  };
  const menu = () => kbdSel.options.map((o) => o.value);
  const marks = () => panel.groups.map((g) => g.el.className);
  // Whatever the panel drew that belongs to no group, which is the hint.
  const hint = () => panel.el.children.filter((k) => !k.__group)
                          .map((k) => k.textContent).join('');

  // A bookmarked group, and the container it belongs to still on its way.
  reset('used:Cheats');
  syncKbd(false);
  eq('the group survives a sync before its container',
     [kbdSel.value, wantKbd], ['', 'used:Cheats']);
  load('rise-out.agc');
  syncKbd(true);
  eq('and is applied once the container brings the option', kbdSel.value, 'used:Cheats');
  eq('which opens the board', applied, ['used:Cheats']);
  eq('the panel marks the group the board is cut to', marks(),
     ['ctl-group', 'ctl-group on', 'ctl-group']);

  // A second container, whose groups are not the first one's.
  load('snake.agc');
  applied = [];
  syncKbd(true);
  eq('a group that is gone falls back to the whole container', kbdSel.value, 'used');
  eq("the menu is the new container's", menu(), ['', 'agat', 'pc', 'used', 'used:Игра']);
  eq('and the board is rebuilt rather than shut', applied, ['used']);

  // A container with keys and no controls: the board it always had.
  unload();
  A.keyboard.setRemap({ Space: null });
  applied = [];
  syncKbd(true);
  eq('no controls, no group entries', menu(), ['', 'agat', 'pc', 'used']);
  eq('and the whole-set option says so', usedOpt.textContent, 'Only mapped keys');
  eq('a board on `used` stays there', [kbdSel.value, applied], ['used', []]);

  // Nothing named at all.
  unload();
  applied = [];
  syncKbd(true);
  eq("a board with nothing to winnow by goes back to the machine's own",
     [kbdSel.value, applied, usedOpt.disabled], ['agat', ['agat'], true]);
  eq('and the panel is empty', panel.groups.length, 0);

  // The hint rides beside the controls rather than in them, so it is the App's
  // and the panel takes it on every rebuild: a second container's hint replaces
  // the first one's, and a bare image leaves none.
  reset('');
  load('rise-out.agc');
  app.hint = 'Starts in ЛАТ.';
  syncKbd(true);
  eq('a hint is drawn under the groups', hint(), 'Starts in ЛАТ.');
  eq('and is not a group the board can be cut to', panel.groups.length, 3);
  unload();
  syncKbd(true);
  eq('and goes when the container that brought it does', hint(), '');

  // The handheld default is the whole container, never one of its groups.
  reset('');
  handheld = true;
  load('rise-out.agc');
  syncKbd(true);
  eq('a handheld opens on the whole container', [kbdSel.value, applied], ['used', ['used']]);
  eq('with every group on the panel and none marked', marks(),
     ['ctl-group', 'ctl-group', 'ctl-group']);

  // A group nobody has — a typo, or a group renamed since the bookmark.
  reset('used:Nope');
  load('rise-out.agc');
  syncKbd(true);
  eq('an address naming a group nobody has still gets the controls board',
     [kbdSel.value, wantKbd, applied], ['used', '', ['used']]);

  unload();
  reset('used:Nope');
  syncKbd(true);
  eq('and with nothing loaded at all, nothing is opened',
     [kbdSel.value, wantKbd, applied], ['', '', []]);

  // Tapping a group on the panel. It goes through the menu rather than around
  // it, so the two cannot disagree and the address follows a finger as well as
  // it follows the <select>.
  unload();
  reset('');
  load('rise-out.agc');
  syncKbd(true);
  applied = []; saved = 0;
  eq('the board is shut to begin with', kbdSel.value, '');

  panel.el.fire('click', { target: panel.groups[1].el.children[1] });
  eq('a tap on a group opens the board at it',
     [kbdSel.value, applied, saved], ['used:Cheats', ['used:Cheats'], 1]);
  eq('and the panel marks it', marks(), ['ctl-group', 'ctl-group on', 'ctl-group']);

  panel.el.fire('click', { target: panel.groups[1].el });
  eq('a tap on the live group goes back to all of them',
     [kbdSel.value, applied.length], ['used', 2]);
  eq('and the panel marks none', marks(),
     ['ctl-group', 'ctl-group', 'ctl-group']);

  applied = [];
  panel.el.fire('click', { target: panel.el });
  eq('a tap between the groups does nothing', [kbdSel.value, applied], ['used', []]);

  // The panel is rebuilt on every load, and its listener lives on an element
  // that is not. One tap must stay one tap.
  for (let i = 0; i < 5; i++) syncKbd(true);
  applied = [];
  panel.el.fire('click', { target: panel.groups[0].el });
  eq('a tap after five reloads still fires once', applied, ['used:Play']);

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// --- everything else boots a machine ----------------------------------------

const target = rest[0];
const cycles = Number(rest[1] || 40e6);
if (!target) { console.error('need an image'); process.exit(2); }

H.loadRoms(ctx).then(async (roms) => {
  const sniffed = await H.sniffFile(ctx, target);
  const model = flags.model ? Number(flags.model) : (sniffed.hintModel || 9);
  const agc = sniffed.agc;
  const m = H.makeMachine(ctx, roms, {
    model: model,
    ramSize: agc && agc.machine.ram ? agc.machine.ram * 1024 : undefined,
  });
  let slot = ctx.AGAT.Machine.SLOTS[model].fdd840;
  if (sniffed.kind && sniffed.kind !== 'fil') {
    slot = H.insert(m, ctx.AGAT.mount(sniffed));
  }
  if (flags.slot) slot = Number(flags.slot);
  // The page makes this a click on the drive. Nothing writes until it happens,
  // so a `write` run that forgot it would report an honest but useless nothing.
  if (cmd === 'write') {
    const disk = m.cards[slot];
    if (!disk || !disk.media) { console.error('no disk in slot ' + slot); process.exit(2); }
    disk.media.locked = false;
  }

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
  // Keys go in before the watchdog below, because a program sitting at a prompt
  // is spinning on the keyboard and that is exactly what the watchdog calls
  // stuck. Nothing is typed unless --keys asked for it.
  if (flags.keys) {
    const per = Number(flags.per || 4e6);
    const run = (n) => { const e = cpu.cycles + n; while (cpu.cycles < e && !cpu.halted) cpu.step(); };
    run(per * 2);
    for (const c of flags.keys) { m.keyDown(H.keyCode(c)); run(per); }
  }
  let lastPC = -1, stuck = 0, stuckAt = -1;
  while (cpu.cycles < end && !cpu.halted) {
    cpu.step();
    if (cpu.pc === lastPC) { if (++stuck > 200000) { stuckAt = cpu.pc; break; } }
    else { stuck = 0; lastPC = cpu.pc; }
  }

  console.log('image      ' + path.basename(target) + '  (' + sniffed.kind + ')' +
              (agc ? '  .agc "' + agc.title + '"' : ''));
  console.log('machine    Agat-' + model + (flags.cold ? ', cold start' : ', boot slot ' + slot) +
              (flags.irq ? ', irq ' + flags.irq : ''));
  console.log('cycles     ' + cpu.cycles + ' (' + (cpu.cycles / 1.02e6).toFixed(2) + ' s)');
  console.log('pc         ' + hex(cpu.pc) + '   a=' + hex(cpu.a, 2) + ' x=' + hex(cpu.x, 2) +
              ' y=' + hex(cpu.y, 2) + ' s=' + hex(cpu.s, 2) + ' p=' + hex(cpu.p, 2));
  if (cpu.halted) console.log('HALTED     illegal opcode ' + hex(cpu.jamOpcode, 2) + ' at ' + hex(cpu.jamPC));
  if (stuckAt >= 0) console.log('SPINNING   tight loop at ' + hex(stuckAt));
  const card = m.cards[slot];
  if (card && card.hasDisk && card.hasDisk()) {
    console.log('disk head  track ' + card.track + ', byte ' + card.pos);
  }

  if (cmd === 'write') {
    const media = m.cards[slot].media;
    const tracks = [];
    for (let t = 0; t < media.tracks; t++) if (media.written[t]) tracks.push(t);
    console.log('written    ' + (tracks.length ? 'tracks ' + tracks.join(' ') : 'nothing'));
    // The save path itself, with no App around it: writeBack reads the sources
    // it is handed and the card's media, and nothing else. A container is
    // unwrapped by sniffFile, so its packed bytes are what a save writes back.
    const from = sniffed.agc && sniffed.agc.media[0];
    const sources = {};
    sources[slot] = {
      name: from ? from.name : path.basename(target),
      bytes: from ? from.bytes : new ctx.Uint8Array(fs.readFileSync(target)),
      patches: from ? from.patches : [],
      kind: sniffed.kind,
      offset: sniffed.offset || 0,
      prodos: !!sniffed.prodos,
    };
    const back = ctx.AGAT.App.prototype.writeBack.call({ sources, machine: m }, slot);
    const off = sources[slot].offset;
    console.log('save       ' + back.name + ', ' +
                (back.name === sources[slot].name
                   ? back.patches.length + ' patch' + (back.patches.length === 1 ? '' : 'es')
                   : 'as nibbles — a track would not decode back to sectors'));
    for (const p of back.patches.slice(0, 24)) {
      const n = p.bytes.length;
      const where = sniffed.kind === 'dsk140'
        ? '  T' + Math.floor((p.at - off) / 4096) +
          ' S' + Math.floor(((p.at - off) % 4096) / 256) : '';
      console.log('  at ' + String(p.at).padStart(7) + '  ' + String(n).padStart(4) +
                  ' bytes' + where);
    }
    if (back.patches.length > 24) console.log('  … ' + (back.patches.length - 24) + ' more');
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
