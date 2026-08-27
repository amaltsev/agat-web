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
//   node tools/check.js dosui                    the file manager, over a stub
//                                                document and a real disk
//   node tools/check.js urlkeys                  the page's address: a machine
//                                                built from a fragment, and the
//                                                fragment written back out
//   node tools/check.js modules                  the pages vs tools/modules.js
//   node tools/check.js state  <image> [cycles]  save the machine mid-run,
//                                                restore it into a fresh one,
//                                                and run both on: the two have
//                                                to stay in step
//
// --model=7|9 overrides the model a container names, --slot=N the boot slot,
// --cold skips the boot and cold-starts into the monitor instead,
// --keys=STR types a string once the machine is up (~ Return, _ Space, ^ Esc,
// ↑↓←→ the arrows) and --per=N is how many cycles each keystroke gets.
//
// `write` is what turns "the save worked" into something measurable:
//
//   node tools/check.js write dos33.dsk --keys='~SAVE_X~'
//   node tools/check.js write examples/TESTCOM7_840.agc 400000000 \
//        --keys='_↓↓↓↓↓↓~_' --per=3000000     # the factory 840K formatter
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
  const scripts = (page) => {
    const html = fs.readFileSync(path.join(H.ROOT, page), 'utf8');
    const out = [], re = /<script src="(src\/[^"]+)"/g;
    let mm;
    while ((mm = re.exec(html))) out.push(mm[1]);
    return { html: html, list: out };
  };
  const want = H.MODULES;
  let bad = false;

  // index.html runs the whole machine, so its list is the module list exactly.
  const main = scripts('index.html');
  const same = main.list.length === want.length && main.list.every((v, i) => v === want[i]);
  console.log('index.html : ' + main.list.join(' '));
  console.log('modules.js : ' + want.join(' '));
  console.log(same ? 'OK - in step' : 'MISMATCH');
  if (!same) bad = true;

  // The tool pages take a subset — no CPU, no video, no ROMs — but it has to
  // be a subset in the same order, because load order is what the one list is
  // for. A module inserted before one of these and not before it here is the
  // "works in Node, blank page in the browser" bug on a page nobody looks at
  // as often.
  for (const page of ['edit-dos.html']) {
    const p = scripts(page);
    let i = 0;
    const ok = p.list.every((f) => {
      while (i < want.length && want[i] !== f) i++;
      return i++ < want.length;
    });
    console.log(page + ' : ' + p.list.join(' '));
    console.log(ok ? 'OK - a subsequence' : 'MISMATCH - not in the module list, or out of order');
    if (!ok) bad = true;
  }

  // And the sheet they share, which is linked rather than copied.
  for (const page of ['index.html', 'edit-dos.html']) {
    const has = /<link rel="stylesheet" href="agat.css">/.test(scripts(page).html);
    console.log(page + ' : agat.css ' + (has ? 'linked' : 'MISSING'));
    if (!has) bad = true;
  }
  process.exit(bad ? 1 : 0);
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
      extra = '  model=' + (H.modelOf(s) || '-') + (s.writeProtect ? ' WP' : '');
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
  ctx.document = {
    createElement: el,
    // The card's prose is text nodes and links side by side, so a stub that
    // only makes elements cannot draw a container that wrote an address into
    // its `info`.
    createTextNode: (t) => Object.assign(el(), { textContent: t }),
    addEventListener() {}, removeEventListener() {},
  };

  // Either a container's keys and controls, or a map written on the command line
  // the way the container writes it: KeyW=^ names a remap, a bare Space declares
  // a key. Controls can only come from a file — they are grouped, and a group is
  // more than one argument's worth.
  const keys = {};
  let controls = null;
  const about = { title: '', author: '', date: '', url: '', info: '', hint: '' };
  for (const a of rest) {
    if (/=/.test(a)) { const [k, v] = a.split('='); keys[k] = v; continue; }
    if (!/\.agc$/i.test(a)) { keys[a] = null; continue; }
    const c = loaded.get(a);
    Object.assign(keys, c.keys);
    if (Object.keys(c.controls).length) Object.assign(controls = controls || {}, c.controls);
    // Several containers on one line are one panel and one card here, as their
    // keys are: the first file to name a thing is what the card says it is, and
    // the hints run together the way the key sets do.
    for (const f of ['title', 'author', 'date', 'url', 'info']) {
      about[f] = about[f] || c[f];
    }
    if (c.hint) about.hint = about.hint ? about.hint + ' ' + c.hint : c.hint;
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
  const panel = new A.ControlPanel(el(), {});
  const group = flags.group === true ? '' : (flags.group || '');
  for (const g of panel.groups) {
    console.log('  ' + g.name + (g.name === group ? '  ←' : ''));
    for (const line of g.el.children.slice(1)) {
      const [code, what] = line.children;
      console.log('    ' + code.textContent.padEnd(14) + (what ? what.textContent : ''));
    }
  }
  // And the card below the panel: what the container says it is, ending in the
  // hint, which is the other half of what a player is shown. Read back off the
  // built nodes rather than off the fields above, so this says what the page
  // draws. A row is its own children: the author-date-url line is spaced the
  // way the flex line spaces it, and the prose runs together, a link in a
  // sentence being part of the sentence.
  const card = el();
  A.drawInfo(card, about);
  for (const kid of card.children) {
    console.log('  ' + (kid.children.length
      ? kid.children.map((k) => k.textContent)
                    .join(kid.className === 'info-who' ? ' ' : '')
      : kid.textContent));
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
  // Measured as the drawing goes, off the widths on the nodes rather than off
  // the table they came from — the two gaps are the stylesheet's, .kb-row's
  // between caps and .kb-board's between blocks. The board is a flex row of
  // blocks and wraps when they do not fit the width it sized itself to, and a
  // wrapped block — the arrows under ПРОБЕЛ rather than beside it — looks
  // exactly like this drawing.
  const em = (v) => parseFloat(v) || 0;
  const lines = [];
  let wide = 0, blocks = 0;
  for (const b of view.blocks) {
    if (b.el.style.display === 'none') { lines.push(['  (block winnowed away)', '']); continue; }
    let most = 0;
    for (const r of b.rows) {
      if (r.el.style.display === 'none') continue;
      const pad = ' '.repeat(Math.round(em(r.el.style.marginLeft)));
      let w = em(r.el.style.marginLeft);
      for (const c of r.caps) w += em(c.el.style.width) + em(c.el.style.marginLeft);
      w += 0.18 * (r.caps.length - 1);
      // The row's own width beside it: a cap that grows is drawn no differently
      // from one that does not, and this is where ПРОБЕЛ filling its block
      // shows — its row measures what the widest row in the block measures.
      lines.push(['  ' + pad + r.caps.map(capText).join(' '), w.toFixed(2) + 'em']);
      most = Math.max(most, w);
    }
    wide += most + (blocks++ ? 1.4 : 0);
  }
  const col = Math.max(...lines.map(([l]) => l.length)) + 3;
  for (const [l, w] of lines) console.log(w ? l.padEnd(col) + w : l);
  const div = /\/ ([\d.]+)\)/.exec(view.board.style.fontSize || '');
  console.log('  board: ' + view.board.style.fontSize +
              (div ? '  ' + wide.toFixed(2) + 'em laid out, ' +
                     (wide <= +div[1] ? 'fits' : 'OVERFLOWS — the blocks wrap')
                   : ''));

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
// the one piece of behavior that lives in the page, and its hard cases are all
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
                          ['pc', 'PC keyboard'], ['used', 'All mapped']]) {
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
  };
  const unload = () => {
    A.keyboard.setRemap(null); A.keyboard.setControls(null);
  };
  const menu = () => kbdSel.options.map((o) => o.value);
  const marks = () => panel.groups.map((g) => g.el.className);

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
  eq('and the whole-set option says so', usedOpt.textContent, 'All mapped');
  eq('a board on `used` stays there', [kbdSel.value, applied], ['used', []]);

  // Nothing named at all.
  unload();
  applied = [];
  syncKbd(true);
  eq("a board with nothing to winnow by goes back to the machine's own",
     [kbdSel.value, applied, menu()], ['agat', ['agat'], ['', 'agat', 'pc']]);
  eq('and the panel is empty', panel.groups.length, 0);

  // The whole-set entry itself, bookmarked, with its container still on the
  // wire. The entry is in the static markup, so the address finds it and spends
  // `wantKbd` on it before anything is loaded — and then the sync takes the
  // entry back out, because nothing has named a key yet. It has to survive that
  // the way a group does.
  reset('used');
  eq('the address finds the entry the markup ships with', kbdSel.value, 'used');
  syncKbd(false);
  // The board shuts while it waits, rather than standing there winnowed by a
  // container that has not arrived — which is a board of nothing.
  eq('a sync before the container takes it out of the menu and holds the board',
     [menu(), wantKbd, applied], [['', 'agat', 'pc'], 'used', ['']]);
  load('rise-out.agc');
  syncKbd(true);
  eq('and the container puts both back',
     [kbdSel.value, wantKbd, applied], ['used', '', ['', 'used']]);

  // The panel is the groups and nothing else — the container's hint is drawn on
  // the info card below it, which tools/vectors.js checks.
  reset('');
  load('rise-out.agc');
  syncKbd(true);
  eq('every child of the panel is a group a tap can pick',
     [panel.groups.length, panel.el.children.filter((k) => !k.__group).length], [3, 0]);

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

// The file manager, driven against a stub document. `src/dosui.js` is shipping
// code with no pure half — every one of its operations is a click on something
// it drew — so the only way to test it at all is to draw it somewhere and click
// on it, and the only way to test it cheaply is here. What this catches is the
// gap between what the panel shows and what the disk holds: a delete that
// leaves the row, a rename that renames the wrong entry, an Add that puts the
// bytes down under the wrong type.
if (cmd === 'dosui') {
  dosuiCmd().catch(die);
  return;
}

async function dosuiCmd() {
  const A = ctx.AGAT;

  // ---- a document, to the extent one is needed ----------------------------
  const el = (tag) => ({
    tag, children: [], style: {}, className: '', title: '',
    hidden: false, disabled: false, value: '', checked: false, type: '',
    parentNode: null, _l: [], _text: '',
    // Assigning textContent replaces everything in the element, which is how
    // the panel empties its list before redrawing it. A stub that only kept
    // the string would grow a second copy of the catalog on every refresh.
    set textContent(v) { this.children = []; this._text = String(v); },
    get textContent() { return this._text; },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    addEventListener(t, f) { this._l.push([t, f]); },
    removeEventListener(t, f) { this._l = this._l.filter((x) => x[1] !== f); },
    fire(t, ev) { for (const [tt, f] of this._l) if (tt === t) f(ev || {}); },
    focus() {}, select() {}, click() { this.fire('click'); },
  });
  const blobs = [];
  // A text node is an element with nothing but its text, which is all the
  // panel ever does with one.
  ctx.document = {
    createElement: el,
    createTextNode: (t) => { const n = el('#text'); n.textContent = t; return n; },
  };
  ctx.Blob = class Blob {
    constructor(parts, opts) {
      this.parts = parts;
      this.type = (opts && opts.type) || '';
      this.size = parts.reduce((n, p) =>
        n + (typeof p === 'string' ? Buffer.byteLength(p) : p.length), 0);
    }
  };
  ctx.URL = {
    createObjectURL(b) { blobs.push(b); return 'blob:' + blobs.length; },
    revokeObjectURL() {},
  };
  let answer = true;                       // what confirm() says this time
  ctx.confirm = () => answer;

  // Everything drawn, so a row or a button can be found by what it says.
  const all = (n, out) => {
    out = out || [];
    out.push(n);
    (n.children || []).forEach((c) => all(c, out));
    return out;
  };
  const byClass = (root, c) =>
    all(root).filter((n) => String(n.className).split(' ').indexOf(c) >= 0);
  const face = (root, text) => {
    const b = all(root).find((n) => n.tag === 'button' && n.textContent === text);
    if (!b) throw new Error('no button says "' + text + '"');
    return b;
  };
  const cells = (row) => row.children.map((c) => c.textContent);
  const boxed = (root, word) => {
    const l = all(root).find((n) => n.tag === 'label' &&
      n.children.some((c) => c.textContent === ' ' + word));
    if (!l) throw new Error('no checkbox says "' + word + '"');
    return l;
  };
  const rows = (root) => byClass(root, 'dos-row').map((r) => cells(r).slice(0, 4).join(' '));
  const named = (root, name) => {
    const r = byClass(root, 'dos-row').find((x) => cells(x)[3] === name);
    if (!r) throw new Error('no row for "' + name + '" among ' + rows(root).join(' | '));
    return r;
  };

  let pass = 0, fail = 0;
  const eq = (what, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++;
    console.log('FAIL ' + what + '\n  got  ' + g + '\n  want ' + w);
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // A File, to the extent the panel asks for one.
  const file = (name, bytes) => ({
    name,
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset,
                                                          bytes.byteOffset + bytes.length)),
  });

  const open = async (p) => {
    const s = await H.sniffFile(ctx, path.join(H.ROOT, p));
    const data = new ctx.Uint8Array(s.payload);
    const sec = new A.Sectors(s.kind, data, { prodos: s.prodos, name: s.name });
    return { s, data, sec, dos: new A.Dos33(sec) };
  };

  // ---- a disk, in a panel -------------------------------------------------
  const o = await open('examples/TESTCOM7_840.agc');
  const host = el('div');
  const said = [];
  const opened = [];
  let changes = 0;
  const ui = new A.DosUI(host, {
    onStatus: (m, bad) => said.push((bad ? '! ' : '') + m),
    onChange: () => { changes++; },
    onImage: (f) => { opened.push(f.name); },
  });

  // Before anything is mounted — which is when the first disk is dropped on a
  // page that opens files, and where `onImage` living on the mount rather than
  // on the panel used to answer "that is a disk image".
  const agc = new ctx.Uint8Array(
    fs.readFileSync(path.join(H.ROOT, 'examples/TESTOZU7_140.agc')));
  await ui.take([file('TESTOZU7_140.agc', agc)]);
  eq('a disk dropped on an empty panel is one to open', opened, ['TESTOZU7_140.agc']);
  await ui.take([file('x.fil', new ctx.Uint8Array(40 + 256))]);
  eq('and a file dropped on one has nowhere to go',
     said[said.length - 1], '! no disk open to put x.fil on');

  ui.mount(o.dos, { label: 'TestCom7_840.dsk', writable: true });

  eq('the catalog draws the columns DOS prints', rows(host),
     [' A 041 TEST', ' B 011 TEST.DATA']);
  eq('and the head says what the disk is',
     byClass(host, 'dos-head')[0].children.map((c) => c.textContent),
     ['TestCom7_840.dsk', ' 840K, 160 tracks of 21, ДИСК N 254']);
  eq('with the free count under it', byClass(host, 'dos-sum')[0].textContent,
     '2 files, 3117 free sectors of 3360');
  eq('and the row carries the length the file declares, and nothing else',
     byClass(host, 'dos-row')[1].children.map((c) => c.textContent).join('|'),
     '|B|011|TEST.DATA|2325|⋯');

  // ---- a row opens ---------------------------------------------------------
  eq('nothing is open to begin with', byClass(host, 'dos-strip').length, 0);
  named(host, 'TEST.DATA').fire('click');
  eq('a click opens that row and only it', byClass(host, 'dos-strip').length, 1);
  eq('and the row it opened is still the one it was',
     rows(host), [' A 041 TEST', ' B 011 TEST.DATA']);
  // The rest of what the file says about itself, which the row no longer
  // spends its width on: where the chain starts, what it holds, where it loads.
  eq('the open row spells out the rest, each field with a hint on it',
     byClass(host, 'dos-facts')[0].children.slice(1).map(
       (c) => c.textContent + (c.title ? '' : ' [no hint]')).join(' '),
     'ts=20/20 sectors=10 lists=1 len=2325 addr=$4C00');
  named(host, 'TEST.DATA').fire('click');
  eq('a second click shuts it', byClass(host, 'dos-strip').length, 0);

  // ---- out of the disk -----------------------------------------------------
  named(host, 'TEST.DATA').fire('click');
  const stream = o.dos.read(o.dos.find('TEST.DATA'));
  face(host, '.fil').fire('click');
  eq('the .fil is the stream with its catalog entry in front',
     blobs[blobs.length - 1].parts[0].length - stream.length, A.fil.HEADER);
  face(host, 'body').fire('click');
  eq('and the body is the length the file declares',
     blobs[blobs.length - 1].parts[0].length, 2325);
  const fil = blobs[blobs.length - 2].parts[0];

  // ---- lock, rename, delete ------------------------------------------------
  face(host, 'Lock').fire('click');
  eq('Lock sets the mark DOS draws as a star',
     [o.dos.find('TEST.DATA').locked, named(host, 'TEST.DATA').children[0].textContent],
     [true, '*']);
  face(host, 'Unlock').fire('click');
  eq('and Unlock clears it', o.dos.find('TEST.DATA').locked, false);

  face(host, 'Rename…').fire('click');
  byClass(host, 'dos-nm')[0].value = 'ДАННЫЕ';
  face(host, 'Rename').fire('click');
  eq('a rename reaches the entry it was opened on',
     [rows(host), o.dos.match('TEST.DATA').length], [[' A 041 TEST', ' B 011 ДАННЫЕ'], 0]);

  const free = o.dos.freeCount();
  eq('and the strip stays open on it, being the same entry',
     byClass(host, 'dos-strip').length, 1);
  answer = false;
  face(host, 'Delete').fire('click');
  eq('a delete that is refused deletes nothing',
     [rows(host).length, o.dos.freeCount()], [2, free]);
  answer = true;
  face(host, 'Delete').fire('click');
  eq('and one that is not gives the sectors back',
     [rows(host), o.dos.freeCount() - free], [[' A 041 TEST'], 11]);
  eq('the strip shuts with the file that was in it',
     byClass(host, 'dos-strip').length, 0);

  // ---- and back onto it ----------------------------------------------------
  // Downloaded before the rename, so the name it carries is the one it had
  // then — a .fil is a catalog entry and its stream, not a pointer at a disk.
  await ui.take([file('anything.fil', fil)]);
  eq('a .fil arrives knowing its own name and type', rows(host),
     [' A 041 TEST', ' B 011 TEST.DATA']);
  eq('and byte for byte',
     Buffer.compare(Buffer.from(o.dos.read(o.dos.find('TEST.DATA'))),
                    Buffer.from(stream)), 0);

  // A plain file stops and asks what it is.
  const adding = ui.take([file('blob.bin', new ctx.Uint8Array([1, 2, 3]))]);
  await tick();
  eq('a file that is not a .fil is asked about',
     byClass(host, 'dos-form-in').length, 1);
  const nm = byClass(host, 'dos-nm')[0];
  eq('with a name off the file and B for a type',
     [nm.value, all(host).find((n) => n.tag === 'select').value], ['BLOB', 'B']);
  face(host, 'Add').fire('click');
  eq('and a B file with no address will not go down',
     said[said.length - 1], '! a B file needs a load address');
  byClass(host, 'dos-ad')[0].value = '$2000';
  face(host, 'Add').fire('click');
  await adding;
  eq('with one, it does, prefix and all',
     Array.from(o.dos.read(o.dos.find('BLOB')).subarray(0, 7)),
     [0x00, 0x20, 3, 0, 1, 2, 3]);
  eq('and the form is put away', byClass(host, 'dos-form-in').length, 0);

  // A disk is not a file to put on a disk. This panel hands it back to the
  // page; one with nowhere to send it — the emulator page's, which edits the
  // disk in the drive — says so.
  await ui.take([file('d.dsk', new ctx.Uint8Array(143360))]);
  eq('a disk image dropped on the list goes to whoever can open it',
     opened[opened.length - 1], 'd.dsk');
  {
    const bare = new A.DosUI(el('div'), {
      onStatus: (m, bad) => said.push((bad ? '! ' : '') + m),
    });
    bare.mount(o.dos, { label: 'in a drive', writable: true });
    await bare.take([file('d.dsk', new ctx.Uint8Array(143360))]);
    eq('and one nobody can open says where it belongs', said[said.length - 1],
       '! d.dsk is a disk image — drop it on the screen to run it');
  }

  // ---- text ----------------------------------------------------------------
  const t = await open('examples/Alice_v3_840.agc');
  ui.mount(t.dos, { label: 'Alice_v3_840.dsk', writable: true });
  named(host, 'ALICE_RUN').fire('click');
  face(host, 'Edit text…').fire('click');
  const area = all(host).find((n) => n.tag === 'textarea');
  eq('a T file opens decoded', area.value.split('\n')[0], '[RAM2');
  eq('and a file with no leading CR opens with the box clear',
     [boxed(host, 'leading CR').box.checked, area.value.charAt(0)], [false, '[']);
  area.value = 'ЗАПУСK\nBRUN X\n';
  face(host, 'Save').fire('click');
  eq('and writes back in the Agat character set',
     A.dosfile.unpack(t.dos, t.dos.find('ALICE_RUN'), 'text').text,
     'ЗАПУСK\nBRUN X\n');
  eq('as one file, not two', t.dos.match('ALICE_RUN').length, 1);
  // Saving the file that is open is not "replacing a file already on the
  // disk", and is not asked about: with confirm() saying no, it still writes.
  named(host, 'ALICE_RUN').fire('click');
  face(host, 'Edit text…').fire('click');
  all(host).find((n) => n.tag === 'textarea').value = 'ОДНА\n';
  answer = false;
  face(host, 'Save').fire('click');
  answer = true;
  eq('and saving it again asks nothing about itself',
     [A.dosfile.unpack(t.dos, t.dos.find('ALICE_RUN'), 'text').text,
      t.dos.match('ALICE_RUN').length],
     ['ОДНА\n', 1]);

  // A file written the way asm-89 and the ИКП disks write one: the $8D in
  // front shows as the box ticked, and saving puts back one, not two.
  t.dos.create('ЛИД', 0x00, A.dosfile.pack('ABCDE', { text: true, lead: true }).data, {});
  ui.refresh();
  named(host, 'ЛИД').fire('click');
  face(host, 'Edit text…').fire('click');
  {
    const box = boxed(host, 'leading CR').box;
    const ta = all(host).find((n) => n.tag === 'textarea');
    eq('a file with a leading CR opens with the box ticked and the text plain',
       [box.checked, ta.value], [true, 'ABCDE\n']);
    face(host, 'Save').fire('click');
    eq('and saving it writes the same bytes back',
       Array.from(A.dosfile.body(t.dos, t.dos.find('ЛИД'),
                                 t.dos.read(t.dos.find('ЛИД')))).slice(0, 7),
       [0x8d, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0x8d]);
  }
  named(host, 'ЛИД').fire('click');
  face(host, 'Edit text…').fire('click');
  {
    // Untick it and the file becomes what DOS alone needs.
    boxed(host, 'leading CR').box.checked = false;
    face(host, 'Save').fire('click');
    eq('unticking it takes the leading CR off',
       Array.from(A.dosfile.body(t.dos, t.dos.find('ЛИД'),
                                 t.dos.read(t.dos.find('ЛИД')))).slice(0, 6),
       [0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0x8d]);
  }
  t.dos.remove(t.dos.find('ЛИД'));

  // ---- a T file typed from nothing -----------------------------------------
  face(host, 'New text file…').fire('click');
  face(host, 'Save').fire('click');
  eq('a new file with no name does not go down',
     said[said.length - 1], '! the file needs a name');
  byClass(host, 'dos-nm')[0].value = 'ЗАПИСКА';
  all(host).find((n) => n.tag === 'textarea').value = 'ДВЕ\nСТРОКИ\n';
  face(host, 'Save').fire('click');
  eq('and one with a name is a T file, in the Agat character set',
     [t.dos.find('ЗАПИСКА').typeLetter,
      A.dosfile.unpack(t.dos, t.dos.find('ЗАПИСКА'), 'text').text],
     ['T', 'ДВЕ\nСТРОКИ\n']);
  eq('the form goes away with it', byClass(host, 'dos-form')[0].hidden, true);
  named(host, 'ЗАПИСКА').fire('click');
  face(host, 'text').fire('click');
  eq('and downloads as UTF-8 text',
     [blobs[blobs.length - 1].parts[0], blobs[blobs.length - 1].type],
     ['ДВЕ\nСТРОКИ\n', 'text/plain;charset=utf-8']);
  t.dos.remove(t.dos.find('ЗАПИСКА'));

  // ---- a disk that will not be written -------------------------------------
  let unlocked = 0;
  ui.mount(t.dos, { label: 'Alice_v3_840.dsk', writable: false,
                    onUnlock: () => { unlocked++; } });
  eq('a locked disk says so and offers the way out',
     [byClass(host, 'dos-note')[0].hidden,
      byClass(host, 'dos-note')[0].children.map((c) => c.textContent)],
     [false, ['Read-only.', 'Allow writing']]);
  named(host, 'ALICE_RUN').fire('click');
  face(host, 'Delete').fire('click');
  eq('and nothing on it can be deleted',
     [said[said.length - 1], t.dos.match('ALICE_RUN').length],
     ['! the disk is read-only', 1]);
  await ui.take([file('anything.fil', fil)]);
  eq('nor anything added to it', said[said.length - 1], '! the disk is read-only');
  face(host, 'Allow writing').fire('click');
  eq('and the way out of it is the host\'s to answer', unlocked, 1);

  // The lock turns while the panel is up — the drive's own RO/RW button is
  // next to the one that opened it — and the panel is drawn from the lock.
  // ALICE_RUN's row is still the one open, from the delete that was refused.
  ui.setWritable(true, null);
  eq('unlocking redraws the panel without shutting the row that is open',
     [byClass(host, 'dos-note')[0].hidden, byClass(host, 'dos-strip').length],
     [true, 1]);
  face(host, 'Delete').fire('click');
  eq('and what it refused a moment ago now goes through',
     t.dos.match('ALICE_RUN').length, 0);
  ui.setWritable(false, () => {});
  eq('and locking it again says so', byClass(host, 'dos-note')[0].hidden, false);

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// The page's address, lifted out of index.html the way `kbdmenu` lifts the
// keyboard menu, and run around the loop it is really used in: a fragment into
// the menus, the menus into a machine, the machine back into a fragment. What
// makes it worth a test rather than a browser is that every interesting case is
// a *pair* — an address and the container it names — and the rule is that the
// address carries only what the container will not supply on reopening.
if (cmd === 'urlkeys') {
  H.loadRoms(ctx).then(urlkeysCmd).catch(die);
  return;
}

async function urlkeysCmd(roms) {
  const A = ctx.AGAT;
  const page = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
  const grab = (what, head) => {
    const at = page.indexOf(head + what + (head === '  var ' ? ' =' : '('));
    if (at < 0) throw new Error('index.html has no ' + head.trim() + ' ' + what);
    let depth = 0;
    for (let j = page.indexOf('{', at); j < page.length; j++) {
      if (page[j] === '{') depth++;
      else if (page[j] === '}' && --depth === 0) {
        // A function declaration ends at its brace; a `var` at the semicolon
        // after the object literal it is being handed.
        return page.slice(at, head === '  var ' ? page.indexOf(';', j) + 1 : j + 1);
      }
    }
    throw new Error(what + ' does not close');
  };

  // A <select> that answers the two things the page asks of one: what its
  // options are, and a value that goes blank when it is handed something none
  // of them carries.
  const sel = (values) => ({
    options: values.map((v) => ({ value: String(v) })),
    _value: String(values[0]),
    hidden: false, disabled: false,
    get value() {
      return this.options.some((o) => o.value === this._value) ? this._value : '';
    },
    set value(v) { this._value = String(v); },
  });

  let modelSel, ramSel, psromSel, xramSel, xram9Sel, mouseSel, kbdSel,
      monitorSel;
  let mouseSlot, url, agcUrl, urlCardLayer, wantKbd, app;
  const location = { hash: '', replace(h) { this.hash = h; } };
  global.AGAT = A;
  const document = { title: '' };
  const syncLayout = () => {};
  const syncMachineUI = () => { syncMenus(); };
  // A rebuild empties the drives, so the files panel goes with them. There are
  // no drives here.
  const closeFiles = () => {};
  for (const f of ['pick', 'readUrl', 'cardKeys', 'stockKb', 'syncMemEnabled',
                   'menuCards', 'readCard', 'urlCards', 'baseline', 'cardKey',
                   'saveUrl', 'readSettings', 'syncMenus', 'urlOverrides',
                   'applyModel']) {
    eval(grab(f, '  function '));
  }
  for (const v of ['MEM_CARDS', 'MEM_SEL']) eval(grab(v, '  var '));

  let pass = 0, fail = 0;
  const eq = (what, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++;
    console.log('FAIL ' + what + '\n  got  ' + g + '\n  want ' + w);
  };

  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ createImageData: () => ({ data: [] }),
                         putImageData: () => {} }),
  };
  ctx.requestAnimationFrame = () => {};

  // The containers this drives, by the name the address would give them. The
  // two bundled ones are the cases that matter — a stock Agat-7 and an Agat-9
  // with a card nothing else has.
  const files = {};
  for (const f of fs.readdirSync(path.join(H.ROOT, 'examples')).sort()) {
    if (/\.agc$/.test(f)) {
      files['examples/' + f] = fs.readFileSync(path.join(H.ROOT, 'examples', f));
    }
  }

  // The page, opened at an address: the fragment into the menus, a machine
  // built from those, the container the address names loaded into it, and the
  // menus and the address written back from the machine that resulted.
  const open = async (hash) => {
    location.hash = hash;
    readSettings();
    syncMemEnabled();
    // Every argument index.html hands the App, and in the same way: a menu
    // this leaves out is a menu the test cannot see the effect of, and it will
    // pass while the page it stands for does the other thing.
    app = new A.App({ canvas, model: Number(modelSel.value),
                      ramSize: Number(ramSel.value), monitor: monitorSel.value,
                      cards: menuCards(), onStatus: () => {} });
    app.roms = roms;
    app.build();
    if (agcUrl) {
      await app.load(ctx.Uint8Array.from(files[agcUrl]), agcUrl.split('/').pop(),
                     null, urlOverrides());
    }
    syncMenus();
    saveUrl();
    return location.hash;
  };
  // The same container arriving as a file instead: the address cannot name it,
  // so it is not what reopening the address would rebuild.
  const drop = async (name) => {
    agcUrl = '';
    await app.load(ctx.Uint8Array.from(files[name]), name.split('/').pop());
    syncMenus();
    saveUrl();
    return location.hash;
  };
  const fitted = () => Object.keys(app.slots).map((n) => n + ':' + app.slots[n].card);

  const start = () => { modelSel = sel([7, 9]); ramSel = sel([32768, 65536, 131072]);
    psromSel = sel([16, 32, 48, 64, 128, 0]); xramSel = sel([16, 32, 48, 64, 128, 0]);
    xram9Sel = sel([32, 64, 128, 0]);
    mouseSel = sel(['', 'nippel', 'mars', 'mars-rom', 'mm8031']);
    kbdSel = sel(['', 'agat', 'pc', 'used']);
    // From AGAT.MONITORS rather than a list written out here, so a monitor
    // added to the table is one this menu already offers. Its first key is
    // MONITOR_DEFAULT, which is what sel() takes as the value to start at.
    monitorSel = sel(Object.keys(A.MONITORS));
    MEM_SEL = { psrom: psromSel, xram: xramSel, xram9: xram9Sel }; };

  // --- a machine and no container: everything it is, written out -------------
  start();
  eq('a stock machine says nothing at all', await open(''), '#');
  eq('and is the stock machine', fitted(),
     ['2:psrom', '3:fdd140', '4:xram', '5:fdd840']);

  // The monitor is a standing choice like the memory sizes, and travels the
  // same way: named in the address only where it differs from the default,
  // read back into the menu, and handed to the App that paints with it.
  eq('the monitor is a difference', await open('#monitor=gray'), '#monitor=gray');
  eq('...and reaches the machine that paints',
     [app.monitor, monitorSel.value], ['gray', 'gray']);
  eq('the default monitor is not written out', await open(''), '#');
  eq('...and is the one the machine gets', app.monitor, A.MONITOR_DEFAULT);
  eq('a monitor no menu offers is not a choice', await open('#monitor=sepia'), '#');

  eq('a mouse is a difference', await open('#mouse=nippel'), '#mouse=nippel');
  eq('and is fitted where the Agat-7 leaves room', fitted(),
     ['2:psrom', '3:fdd140', '4:xram', '5:fdd840', '6:mouse-nippel']);
  eq('base RAM is a difference', await open('#ram=128'), '#ram=128');
  eq('so is the other machine', await open('#model=9'), '#model=9');
  eq('a card taken out is a difference', await open('#psrom=0'), '#psrom=0');
  eq('a card put back at its stock size is not',
     await open('#psrom=32'), '#');
  eq('a value no menu offers is not a choice', await open('#mouse=frog'), '#');
  eq('a mouse somewhere else keeps the slot it was given',
     await open('#mouse=nippel:3'), '#mouse=nippel:3');
  eq('...which is where it is fitted',
     A.Machine.slotOfClass(app.slots, 'mouse'), 3);

  // --- a container the address names -----------------------------------------
  start();
  eq('a container running as it asks says only which container',
     await open('#agc=examples%2Frise-out.agc'), '#agc=examples%2Frise-out.agc');
  eq('an Agat-9 container with a mouse says no more than that',
     await open('#agc=examples%2FKlondike.agc'), '#agc=examples%2FKlondike.agc');
  eq('and is the machine it asked for',
     [app.model, app.ramSize, fitted()],
     [9, 0x20000, ['2:xram9', '4:mouse-mars-rom', '5:fdd840', '6:fdd140']]);

  // A menu touched afterwards, which is the whole point of the diff: what the
  // container says stays out of the address, and what disagrees with it goes in.
  xram9Sel.value = '64';
  applyModel();
  eq('a card changed after a container is a difference and the rest is not',
     location.hash, '#agc=examples%2FKlondike.agc&xram9=64');
  eq('and the container keeps the mouse it named',
     A.Machine.slotOfClass(app.slots, 'mouse'), 4);
  mouseSel.value = '';
  applyModel();
  eq('a mouse taken away has to be said out loud',
     location.hash, '#agc=examples%2FKlondike.agc&xram9=64&mouse=');
  eq('and is gone', A.Machine.slotOfClass(app.slots, 'mouse'), -1);

  eq('an address may put the container on the other machine',
     await open('#agc=examples%2FKlondike.agc&model=7'),
     '#agc=examples%2FKlondike.agc&model=7');
  eq("where the container's cards go where the Agat-7 puts them", fitted(),
     ['2:psrom', '3:fdd140', '4:xram', '5:fdd840', '6:mouse-mars-rom']);

  // Every container in examples/, which is the whole of what the entry in the
  // program list has to produce: the list links to `#agc=<path>` and clicking
  // one must leave the address exactly there.
  start();
  for (const name of Object.keys(files)) {
    eq(name + ' runs at the address that names it',
       await open('#agc=' + encodeURIComponent(name)),
       '#agc=' + encodeURIComponent(name));
  }

  // --- the same container, dropped -------------------------------------------
  // Nothing in the address will bring it back, so the machine is written out in
  // full rather than left to it.
  start();
  await open('');
  eq('a dropped container writes its machine out',
     await drop('examples/Klondike.agc'), '#model=9&mouse=mars-rom');
  eq('and reopening that address builds the same machine, without the program',
     [await open('#model=9&mouse=mars-rom'), fitted()],
     ['#model=9&mouse=mars-rom',
      ['2:xram9', '4:mouse-mars-rom', '5:fdd840', '6:fdd140']]);

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// A snapshot is only worth anything if the machine it restores goes on running
// the same program the same way, and two machines that agree at the moment of
// the restore and disagree a second later is exactly the failure this can have.
// So: boot one, run it, save it, restore into a second, and then run *both* the
// same distance again and require them to still agree — on the clock, on the
// screen, and on every byte of RAM.
//
// The disk is not in a snapshot — a container carries what was written to it as
// patches instead — so the media is copied across by hand here, which is what
// the container does by another route and what leaves this measuring the state
// machinery alone.
if (cmd === 'state') {
  H.loadRoms(ctx).then(stateCmd).catch(die);
  return;
}

async function stateCmd(roms) {
  const A = ctx.AGAT;
  const target = rest[0];
  const cycles = Number(rest[1] || 40e6);
  if (!target) die('need an image');
  const sniffed = await H.sniffFile(ctx, target);
  const model = flags.model ? Number(flags.model) : (H.modelOf(sniffed) || 9);
  const agc = sniffed.agc;
  const build = () => {
    const m = H.makeMachine(ctx, roms, {
      model: model,
      ramSize: agc && agc.machine.ram ? agc.machine.ram * 1024 : undefined,
    });
    let slot = A.Machine.SLOTS[model].fdd840;
    if (sniffed.kind && sniffed.kind !== 'fil') slot = H.insert(m, A.mount(sniffed));
    if (flags.slot) slot = Number(flags.slot);
    m.reset();
    if (!flags.cold) m.bootSlot(slot);
    return { m, slot };
  };
  const run = (m, n) => {
    const end = m.cpu.cycles + n;
    while (m.cpu.cycles < end && !m.cpu.halted) m.cpu.step();
  };
  // `slots` beside `machine` is the whole of what state.js asks of an App, so a
  // two-field stand-in does here as it does for writeBack.
  const app = (m) => ({ machine: m, slots: m.slots });

  const a = build();
  run(a.m, cycles);
  const saved = await A.state.save(app(a.m));
  const text = JSON.stringify(saved);

  const b = build();
  const media = a.m.cards[a.slot] && a.m.cards[a.slot].media;
  if (media) {
    b.m.cards[b.slot].media.bytes.set(media.bytes);
    if (media.attrs) b.m.cards[b.slot].media.attrs.set(media.attrs);
  }
  await A.state.restore(app(b.m), JSON.parse(text));

  console.log('image      ' + path.basename(target) + '  (' + sniffed.kind + ')' +
              (agc ? '  .agc "' + agc.title + '"' : ''));
  console.log('machine    Agat-' + model + ', boot slot ' + a.slot);
  console.log('saved      ' + Math.round(text.length / 1024) + 'K at ' +
              hex(saved.cpu.pc) + ', ' + (saved.cycles / 1.02e6).toFixed(2) + ' s in');

  let bad = 0;
  const same = (what, x, y) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    bad++;
    console.log('DIFFERS    ' + what + '\n  saved   ' + JSON.stringify(x) +
                '\n  restored ' + JSON.stringify(y));
  };
  const shot = (m) => A.Video.dumpText(m);
  const regs = (m) => [m.cpu.cycles, m.cpu.pc, m.cpu.a, m.cpu.x, m.cpu.y,
                       m.cpu.s, m.cpu.p, m.rasterLine];
  same('the machine it came back as', regs(a.m), regs(b.m));
  same('the screen it came back with', shot(a.m), shot(b.m));

  // And then the half that only running can answer.
  run(a.m, cycles);
  run(b.m, cycles);
  same('the machine after another ' + (cycles / 1.02e6).toFixed(1) + ' s',
       regs(a.m), regs(b.m));
  same('the screen after it', shot(a.m), shot(b.m));
  let ram = -1;
  for (let i = 0; i < a.m.ram.length; i++) {
    if (a.m.ram[i] !== b.m.ram[i]) { ram = i; break; }
  }
  if (ram >= 0) {
    bad++;
    console.log('DIFFERS    RAM, first at ' + hex(ram, 5) + ': ' +
                hex(a.m.ram[ram], 2) + ' vs ' + hex(b.m.ram[ram], 2));
  }
  console.log('pc         ' + hex(a.m.cpu.pc) + ' both');
  console.log(bad ? 'DIVERGED' : 'OK - in step');
  process.exit(bad ? 1 : 0);
}

// --- everything else boots a machine ----------------------------------------

const target = rest[0];
const cycles = Number(rest[1] || 40e6);
if (!target) { console.error('need an image'); process.exit(2); }

H.loadRoms(ctx).then(async (roms) => {
  const sniffed = await H.sniffFile(ctx, target);
  const model = flags.model ? Number(flags.model) : (H.modelOf(sniffed) || 9);
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
  // A container may carry the machine it was saved in the middle of, and then
  // this runs on from there rather than from the boot ROM — the same thing the
  // page does, so that what a tool reports is what a browser would show.
  const resumed = flags.cold ? '' : await H.resume(ctx, m, agc);

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
  if (resumed) console.log('state      ' + resumed);
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
      const per = { dsk140: 4096, dsk840: 21 * 256 }[sniffed.kind];
      const where = per
        ? '  T' + Math.floor((p.at - off) / per) +
          ' S' + Math.floor(((p.at - off) % per) / 256) : '';
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
