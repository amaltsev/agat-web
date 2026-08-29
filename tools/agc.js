// The .agc container from the command line: make one, read it, change it.
//
//   node tools/agc.js make  <image...> [flags]     a container from images
//   node tools/agc.js info  <file.agc>             what one holds
//   node tools/agc.js edit  <file.agc> [flags]     change what it says
//   node tools/agc.js get   <file.agc> [medium...] media out of it, as files
//   node tools/agc.js add   <file.agc> <file...>   images, or another container's
//                                                  media, into it
//   node tools/agc.js rm    <file.agc> <medium>... media out of it for good
//   node tools/agc.js merge <file.agc> [medium...] patches folded into the image
//
// `node tools/agc.js help` prints the flags, the details and some examples.
//
// `make` writes to standard output unless `--out` names a file; every other
// command that changes something writes the container back over itself, or to
// `--out`.
//
// What it says about the program — every one of these takes an empty value,
// which clears the field:
//
//   --title=TEXT          what the program is called
//   --author=TEXT         who wrote it
//   --date=TEXT           when: "1989", "circa 1985", "1990-92"
//   --url=URL             where it came from, or where it is written up
//   --notes=TEXT          prose for the record: provenance, credits, what a
//                         patch does. Nothing shows it.
//   --info=TEXT           what the program is, at whatever length it takes,
//                         printed on the card under the controls
//   --hint=TEXT           one line to whoever plays it, printed under that
//
// The machine it wants:
//
//   --model=7|9           the Agat-7 by default
//   --ram=32|64|128       base RAM, in K
//   --monitor=NAME        the monitor it was drawn for: color16 (the default,
//                         left unwritten), color8, color16inv or gray
//   --boot=WHAT           which drive starts: auto (the default, left
//                         unwritten), none, monitor, fdd140, fdd840 or slot:N
//   --slot=N:CARD[:RAM[:DRIVES]]   a card the stock machine does not have,
//                         repeatable: --slot=6:fdd840::2 for a controller with
//                         two drives. `--slot=N:none` empties the slot,
//                         `--slot=N:` says nothing about it and leaves the
//                         stock complement to fill it.
//
// The controls:
//
//   --key=KEY[:CODE[:HINT]]   a key the program uses, repeatable, the hint
//                             saying what it does: --key=KeyW:^:Shoot right.
//                             With no code the key is declared as it already
//                             is: --key=Space::Jump
//   --no-key=KEY          drop a key the container declares, repeatable
//
// The media, on `make` and `add`, applying to every file that command names:
//
//   --in=WHERE            the drive it goes in — fdd140, fdd840 or slot:N, with
//                         a `:2` for the second drive on that cable — or `none`
//                         for a medium the container carries without mounting.
//                         Unsaid, the drives fill in the order the media list.
//   --writable            a program may write to it; every medium is locked
//                         unless it says otherwise
//   --as=NAME             what to call the medium, for a single file
//   --at=N                put it at this position in the list rather than last,
//                         which is how the list is reordered
//   --patch=AT:HEX        patch, repeatable: --patch=45312:A96085
//   --diff=FILE           derive the patches by comparing FILE with the image
//
// How it is written:
//
//   --out=FILE            write here: over the original otherwise, and to
//                         standard output for `make`. `-` is standard output.
//   --width=N             base64 line width, a multiple of 4
//   --plain               never compress: a container to be hand-edited or
//                         read in a diff, whatever it costs
//   --gz                  always compress, even where it barely pays
//   --force               overwrite a file `get` would otherwise refuse to, and
//                         let `merge` throw away an annotated patch
//
// Left alone, a payload or a patch is compressed when that makes it smaller by
// a tenth, which for a disk image is nearly always and by a factor of ten.
//
// A medium is named on the command line by its position — 0 is the first — or
// by its name, where `*` and `?` glob: `get game.agc '*.dsk'`. `get` with no
// medium named takes them all, and so does `merge`.
//
// A container given to `make` or `add` contributes its media, patches and
// drives and nothing else; what it said about the program is the container's
// own and stays there.
//
// `merge` is for a disk that has been written to and is not going to be written
// back: it applies the patches to the payload and drops the records, so what
// the container carries is the disk as it now stands. An annotated patch is
// somebody's writing about a change and `merge` refuses to lose it silently;
// `--force` folds it in anyway.
//
// A field this reader does not know is dropped rather than carried through, so
// a hand-written key on the container itself does not survive an `edit`. Patch
// records are the exception: their annotations are kept. The fields that do
// survive keep the order the file had them in, so a change to one shows up in a
// diff as a change to one; a new container is written in the documented order.
//
// The writer is src/agc.js, the same one the page's Save button goes through,
// so a container written here and one written there are the same file.
//
//   node tools/agc.js make game.dsk --title="RISE OUT" --author="…" \
//     --date=1989 --model=7 --ram=64 --key="KeyW:^:Shoot right" > game.agc
//   node tools/agc.js info  game.agc
//   node tools/agc.js edit  game.agc --hint="Press РУС at the title screen."
//   node tools/agc.js get   game.agc 0 --out=/tmp
//   node tools/agc.js add   game.agc side-b.dsk --in=fdd140:2
//   node tools/agc.js merge game.agc '*.dsk'
const fs = require('fs');
const path = require('path');
const H = require('./harness');

// The repeatable flags collect; the rest are last-wins.
const REPEAT = { key: 1, 'no-key': 1, patch: 1, slot: 1 };

const flags = {};
// Flags first, so that one may sit anywhere — including where the command
// would be, which is where `--help` lands.
const rest = process.argv.slice(2).filter((a) => {
  // `[\s\S]` rather than `.`, so a value pasted with line breaks in it — a
  // --hint wrapped in the shell — is still that flag's value rather than a
  // filename that does not exist.
  const m = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(a);
  if (!m) { if (a === '-h') { flags.help = true; return false; } return true; }
  if (REPEAT[m[1]]) (flags[m[1]] = flags[m[1]] || []).push(m[2] === undefined ? '' : m[2]);
  else flags[m[1]] = m[2] === undefined ? true : m[2];
  return false;
});
const cmd = rest.shift() || '';

// The help is the comment at the top of this file, read back off disk. There is
// only one of it, so the two cannot drift — which is the failure every tool
// with a usage string eventually has.
//
// The short form is everything down to the line that offers the long one, which
// is therefore the last thing a bare invocation prints.
const MORE = '`node tools/agc.js help` prints the flags, the details and some examples.';

function help(full) {
  const lines = fs.readFileSync(__filename, 'utf8').split('\n'), out = [];
  for (const l of lines) {
    if (!/^\/\//.test(l)) break;
    const text = l.replace(/^\/\/ ?/, '');
    out.push(text);
    if (!full && text === MORE) break;
  }
  return out.join('\n').replace(/\n+$/, '');
}

const COMMANDS = ['make', 'info', 'edit', 'get', 'add', 'rm', 'merge'];
if (!cmd || flags.help || cmd === 'help') {
  console.log(help(flags.help || cmd === 'help'));
  process.exit(0);
}
if (COMMANDS.indexOf(cmd) < 0) {
  console.error('no such command: "' + cmd + '" — one of ' + COMMANDS.join(' ') +
                ', or none at all for a summary');
  process.exit(2);
}

const ctx = H.loadModules();
const A = ctx.AGAT;
const die = (e) => { console.error(e.message || e); process.exit(1); };

// ---- flags -----------------------------------------------------------------

// A flag that wants a value, written without one: `--title` on its own says
// nothing, and clearing a field is `--title=`.
function value(name) {
  if (flags[name] === true) throw new Error('--' + name + ' wants a value; --' +
                                            name + '= clears the field');
  return flags[name];
}

// undefined lets the size rule decide, which is what the Save button does.
const gz = flags.gz ? true : (flags.plain ? false : undefined);

function bytesOf(p) {
  return new ctx.Uint8Array(fs.readFileSync(p));
}

// KEY:VALUE:HINT, split on the first two colons — a value is `^`, `$5E` or a
// name and never contains one, so only the hint can. No value at all declares
// the key as it already is: `--key=Space` and `--key=Space::Jump` both say the
// program uses Space and leave what it sends alone.
function keySpecs(was) {
  const keys = {};
  for (const k in was || {}) keys[k] = was[k];
  for (const k of flags.key || []) {
    const at = k.indexOf(':');
    const key = at < 0 ? k : k.slice(0, at);
    const tail = at < 0 ? '' : k.slice(at + 1);
    const cut = tail.indexOf(':');
    const code = cut < 0 ? tail : tail.slice(0, cut);
    const hint = cut < 0 ? '' : tail.slice(cut + 1);
    if (code && A.keyboard.resolveCode(code) < 0) {
      throw new Error('--key=' + k + ': ' + code +
                      ' is not a code — try $5E, ^, or Up');
    }
    keys[key] = code ? (hint ? { code: code, hint: hint } : code)
                     : (hint ? { hint: hint } : null);
  }
  for (const k of flags['no-key'] || []) {
    if (!(k in keys)) throw new Error('--no-key=' + k + ': the container does not declare it');
    delete keys[k];
  }
  return keys;
}

// N:CARD[:RAM[:DRIVES]] against what the container already says. `N:` drops the
// entry, leaving the slot to the model's stock complement; `N:none` writes the
// slot down as deliberately empty, which is a different thing.
function slotSpecs(was) {
  if (!flags.slot) return was;
  const out = {};
  for (const n in was || {}) out[n] = was[n];
  for (const s of flags.slot) {
    const bits = s.split(':');
    const n = Number(bits[0]);
    if (!(n >= 0 && n <= 7)) throw new Error('--slot=' + s + ': slots are 0 to 7');
    const card = bits[1] || '';
    if (!card) { delete out[n]; continue; }
    if (card === 'none') { out[n] = null; continue; }
    if (!A.agc.CARDS[card]) {
      throw new Error('--slot=' + s + ': ' + card + ' is not a card — one of ' +
                      Object.keys(A.agc.CARDS).join(', ') + ', or none');
    }
    out[n] = { card: card, ram: Number(bits[2]) || 0 };
    if (Number(bits[3]) === 2) out[n].drives = 2;
  }
  return Object.keys(out).length ? out : null;
}

// Everything a container says but its media, as `build` wants it: what the
// flags say, over what the container already said. `was` is the empty
// container for `make`, so one function decides both.
function spec(was) {
  const text = (name) => {
    const v = value(name);
    return v === undefined ? was[name] : String(v);
  };
  const m = was.machine;
  const model = flags.model === undefined ? (m.model || 7) : Number(value('model'));
  if (model !== 7 && model !== 9) {
    throw new Error('--model=' + flags.model + ': the Agat-7 or the Agat-9');
  }
  const ram = flags.ram === undefined ? (m.ram || (model === 9 ? 128 : 64))
                                      : Number(value('ram'));
  if ([32, 64, 128].indexOf(ram) < 0) throw new Error('--ram=' + flags.ram + ': 32, 64 or 128');
  const monitor = value('monitor') === undefined ? m.monitor : String(flags.monitor);
  if (monitor && !A.MONITORS[monitor]) {
    throw new Error('--monitor=' + monitor + ': not a monitor — try ' +
                    Object.keys(A.MONITORS).join(', '));
  }
  const boot = value('boot') === undefined ? m.boot : String(flags.boot);
  if (boot && !A.agc.BOOT.test(boot)) {
    throw new Error('--boot=' + boot + ': try auto, none, monitor, fdd140, ' +
                    'fdd840 or slot:N');
  }
  return {
    title: text('title'), author: text('author'), date: text('date'),
    url: text('url'), notes: text('notes'),
    info: text('info'), hint: text('hint'),
    model: model, ram: ram, monitor: monitor,
    boot: boot === 'auto' ? '' : boot,
    slots: slotSpecs(m.slots),
    keys: keySpecs(was.keys),
    controls: was.controls,
    state: was.state,
    width: Number(flags.width) || 0,
    gz: gz,
  };
}

// ---- containers ------------------------------------------------------------

// What `make` starts from: a container that says nothing at all.
const EMPTY = {
  title: '', author: '', date: '', url: '', notes: '', info: '', hint: '',
  machine: { model: 0, ram: 0, monitor: '', boot: '', slots: null },
  keys: {}, controls: {}, state: null, media: [],
};

async function read(p) {
  if (!p) throw new Error(cmd + ': need a container');
  const bytes = bytesOf(p);
  if (!A.agc.looks(bytes)) throw new Error(p + ': not an .agc container');
  const c = await A.agc.parse(bytes, path.basename(p));
  c.path = p;
  return c;
}

// The media of one file: a container's, whole, or the one image the file is.
// A container hands over its patches and its drives with them — where a disk
// goes is the disk's own business — and nothing else it says.
async function mediaOf(p) {
  const bytes = bytesOf(p);
  // Sniffed for the error, not for the container: a container holds the file it
  // was given. Refusing here beats writing something that will not load.
  const s = A.sniff(bytes, path.basename(p));
  if (s.kind === 'agc') {
    const c = await A.agc.parse(bytes, s.name);
    if (!c.media.length) throw new Error(p + ': carries no media');
    return c.media.map((m) => ({ name: m.name, bytes: m.bytes, patches: m.patches,
                                 mount: m.mount, writable: m.writable }));
  }
  if (!s.kind) throw new Error(p + ': not a recognized Agat image');
  return [{ name: path.basename(p), bytes: bytes, patches: [] }];
}

// The media `make` and `add` are given, with the flags that describe them
// applied: the patches, where they go and whether they may be written to.
async function incoming(paths) {
  if (!paths.length) throw new Error(cmd + ': need a file');
  const as = value('as');
  if (as !== undefined && paths.length > 1) {
    throw new Error('--as names one medium, and this is ' + paths.length + ' files');
  }
  const mount = value('in');
  if (mount !== undefined && mount !== '' && !A.agc.IN.test(mount)) {
    throw new Error('--in=' + mount + ': try none, fdd140, fdd840 or slot:N, ' +
                    'with :2 for the second drive');
  }

  // Patches are bytes everywhere but in the file, so a --patch is decoded here
  // and written back out by the same rule that decides every other record.
  const explicit = (flags.patch || []).map((p) => {
    const at = p.indexOf(':');
    if (at < 0) throw new Error('--patch wants AT:HEX, got ' + p);
    try {
      return { at: Number(p.slice(0, at)), bytes: A.agc.fromHex(p.slice(at + 1)) };
    } catch (e) {
      throw new Error('--patch=' + p + ': ' + e.message);
    }
  });

  const out = [];
  for (const p of paths) for (const m of await mediaOf(p)) out.push(m);
  if (flags.diff !== undefined && out.length !== 1) {
    throw new Error('--diff compares one image against one, and this is ' +
                    out.length + ' media');
  }
  for (const m of out) {
    m.patches = m.patches.concat(explicit);
    // The differ is src/agc.js's, the same one the page's Save button runs over
    // a disk that has been written to, so --diff and a save produce the same
    // records.
    if (flags.diff !== undefined) {
      m.patches = m.patches.concat(A.agc.diff(m.bytes, bytesOf(value('diff'))));
    }
    // The patches have to apply to what is being packed, or the container is
    // broken in a way only whoever loads it would find out.
    A.agc.applyPatches(m.bytes, m.patches);
    if (as !== undefined) m.name = as;
    if (mount !== undefined) m.mount = mount;
    if (flags.writable) m.writable = true;
  }
  return out;
}

// Which media a command was pointed at: a position, or a name where `*` and
// `?` glob. Nothing named is every medium, for the commands that allow it.
function select(c, names, all) {
  if (!names.length) {
    if (!all) throw new Error(cmd + ': need a medium — a position, or a name');
    return c.media.map((m, i) => i);
  }
  const out = [];
  for (const n of names) {
    let hit = [];
    if (/^\d+$/.test(n)) {
      if (!c.media[Number(n)]) throw new Error(c.path + ': no medium ' + n);
      hit = [Number(n)];
    } else {
      const re = new RegExp('^' + n.replace(/[.+^${}()|[\]\\]/g, '\\$&')
                                   .replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
      hit = c.media.map((m, i) => i).filter((i) => re.test(c.media[i].name));
      if (!hit.length) throw new Error(c.path + ': nothing matches "' + n + '"');
    }
    for (const i of hit) if (out.indexOf(i) < 0) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

// A container as its file. `make` goes to standard output unless told
// otherwise; everything else writes back over what it read.
async function write(c, media, to) {
  const s = spec(c);
  s.media = media;
  const text = asItWas(await A.agc.build(s), c.path);
  if (to === '-') { process.stdout.write(text); return '-'; }
  fs.writeFileSync(to, text);
  return to;
}

// The fields back in the order the container already had them. src/agc.js
// writes the documented order, which is what a new container should have and
// what the page's Save button produces; a container that has been hand-edited
// since is somebody's own arrangement, and an `edit` that changes one field and
// silently shuffles the rest makes a diff nobody can read. `make` has no file
// to take an order from and gets the documented one.
//
// A field the file did not have goes where the documented order puts it,
// relative to whatever of that order survives around it.
function asItWas(text, from) {
  if (!from) return text;
  const had = Object.keys(JSON.parse(fs.readFileSync(from, 'utf8')));
  const o = JSON.parse(text);
  const seq = had.filter((k) => k in o);
  for (const k of Object.keys(o)) {
    if (seq.indexOf(k) >= 0) continue;
    // The nearest field ahead of this one that the file did have: the new field
    // lands just after it, and first of all when there is none.
    const before = Object.keys(o).slice(0, Object.keys(o).indexOf(k))
                         .filter((p) => seq.indexOf(p) >= 0).pop();
    seq.splice(before === undefined ? 0 : seq.indexOf(before) + 1, 0, k);
  }
  const out = {};
  for (const k of seq) out[k] = o[k];
  return JSON.stringify(out, null, 2) + '\n';
}

// «1 medium», «2 media» — the plural of the word the container uses.
function count(n) {
  return n + (n === 1 ? ' medium' : ' media');
}

function said(where, media, what) {
  console.log(what + ' -> ' + where + ', ' + count(media.length));
}

// ---- commands ---------------------------------------------------------------

main().catch(die);

async function main() {
  if (cmd === 'make') return make();
  const c = await read(rest.shift());
  if (cmd === 'info') return info(c);
  if (cmd === 'edit') return edit(c);
  if (cmd === 'get') return get(c);
  if (cmd === 'add') return add(c);
  if (cmd === 'rm') return remove(c);
  if (cmd === 'merge') return merge(c);
}

async function make() {
  const media = place([], await incoming(rest));
  const to = value('out') === undefined ? '-' : String(flags.out);
  const where = await write(EMPTY, media, to);
  if (where !== '-') said(where, media, 'made');
}

async function edit(c) {
  const where = await write(c, c.media, value('out') === undefined ? c.path : String(flags.out));
  said(where, c.media, 'edited');
}

async function add(c) {
  const media = place(c.media, await incoming(rest));
  const where = await write(c, media, value('out') === undefined ? c.path : String(flags.out));
  said(where, media, 'added ' + (media.length - c.media.length));
}

// Where the new media go: last, or at `--at`, which is how the list is
// reordered — take a medium out and put it back at another position.
function place(had, added) {
  const at = value('at');
  if (at === undefined) return had.concat(added);
  const n = Number(at);
  if (!(n >= 0 && n <= had.length)) {
    throw new Error('--at=' + at + ': 0 to ' + had.length + ' for a list of ' +
                    had.length);
  }
  return had.slice(0, n).concat(added, had.slice(n));
}

async function remove(c) {
  const gone = select(c, rest, false);
  if (gone.length === c.media.length) {
    throw new Error('rm: that is every medium, and a container without one ' +
                    'carries nothing');
  }
  const media = c.media.filter((m, i) => gone.indexOf(i) < 0);
  const where = await write(c, media, value('out') === undefined ? c.path : String(flags.out));
  said(where, media, 'removed ' + gone.map((i) => '"' + c.media[i].name + '"').join(', '));
}

// The patches folded into the payload, so what the container carries is the
// disk as it now stands. What that loses is the record of what was changed,
// which is why an annotated patch stops it.
async function merge(c) {
  const on = select(c, rest, true);
  let folded = 0;
  const media = c.media.map((m, i) => {
    if (on.indexOf(i) < 0 || !m.patches.length) return m;
    const kept = m.patches.filter(A.agc.isAnnotated);
    if (kept.length && !flags.force) {
      throw new Error('"' + m.name + '": patch at ' + kept[0].at +
                      ' carries a note, which folding it in would lose — ' +
                      '--force to fold it anyway');
    }
    folded += m.patches.length;
    return { name: m.name, bytes: m.payload, patches: [],
             mount: m.mount, writable: m.writable };
  });
  if (!folded) { console.log('nothing to merge'); return; }
  const where = await write(c, media, value('out') === undefined ? c.path : String(flags.out));
  said(where, media, 'merged ' + folded + ' patch' + (folded === 1 ? '' : 'es'));
}

// A medium as a file, as the machine runs it: the payload with the patches
// applied. `--out=-` writes to standard output, and `--out=DIR` into a
// directory; otherwise each lands beside the working directory under its own
// name.
function get(c) {
  const want = select(c, rest, true);
  if (!want.length) throw new Error('get: the container carries no media');
  const out = value('out') === undefined ? '' : String(flags.out);
  if (out === '-' && want.length > 1) {
    throw new Error('get: ' + want.length + ' media do not fit on standard output');
  }
  const dir = out && out !== '-' && fs.existsSync(out) && fs.statSync(out).isDirectory()
            ? out : '';
  for (const i of want) {
    const m = c.media[i];
    if (out === '-') { process.stdout.write(Buffer.from(m.payload)); continue; }
    const to = dir ? path.join(dir, path.basename(m.name))
             : out && want.length === 1 ? out
             : path.basename(m.name);
    if (fs.existsSync(to) && !flags.force) {
      throw new Error(to + ' is already there — --force to overwrite it');
    }
    fs.writeFileSync(to, Buffer.from(m.payload));
    console.log('medium ' + i + ' "' + m.name + '" -> ' + to + ', ' +
                m.payload.length + ' bytes' +
                (m.patches.length ? ', ' + m.patches.length + ' patch' +
                                    (m.patches.length === 1 ? '' : 'es') +
                                    ' applied' : ''));
  }
}

// What the container says, laid out as YAML is — `name: value`, a block
// indented under its name — for no reason but that it reads well down a column.
// It is a convention and not a format: nothing parses this back.
//
// The order runs from what the program is to what it runs on: the machine, then
// the media it holds, then last the state it was saved in.
//
// The machine is printed whole — every field and every slot, whether the
// container names it or the model brings it — with `# default` against what the
// container does not say. What a container leaves out is most of what a machine
// is, and a listing that shows only the overrides makes a stock Agat-9 — two
// controllers and an ОЗУ card — look like a machine with nothing in it.
//
// The encodings come off the JSON rather than off the parse, since what a
// payload was written as is a property of the file and not of the bytes.
function info(c) {
  const raw = JSON.parse(fs.readFileSync(c.path, 'utf8'));
  say('agc', c.version + ', ' + fs.statSync(c.path).size + ' bytes on disk');
  say('title', c.title);
  say('author', c.author);
  say('date', c.date);
  say('url', c.url);
  const keys = Object.keys(c.keys);
  if (keys.length) {
    say('keys', keys.length);
    const rows = keys.map((k) => {
      const v = c.keys[k], code = typeof v === 'string' ? v : (v && v.code) || '';
      return { text: k + ': ' + (code || '(as it is)'),
               note: v && v.hint ? v.hint : '' };
    });
    column(rows, '  ', '');
  }
  const groups = Object.keys(c.controls);
  if (groups.length) say('controls', groups.join(', '));
  say('info', c.info);
  say('hint', c.hint);
  say('notes', c.notes);

  console.log('machine:');
  column(machineRows(c.machine), '  ', '# default');

  say('media', count(c.media.length));
  c.media.forEach((md, i) => {
    const s = A.sniff(md.payload, md.name);
    const enc = (raw.media || [])[i] || {};
    let line = '  ' + i + ': ' + md.name.padEnd(24) + ' ' +
               (s.kind || md.payload.length + ' bytes').padEnd(7) +
               ' ' + String(md.payload.length).padStart(7) +
               ' ' + (enc.gz ? 'gz' : enc.data ? 'base64' : 'hex');
    if (md.mount) line += ' in=' + md.mount;
    if (md.writable) line += ' writable';
    if (md.patches.length) {
      const notes = md.patches.filter(A.agc.isAnnotated).length;
      line += ' ' + md.patches.length + ' patch' +
              (md.patches.length === 1 ? '' : 'es') +
              (notes ? ' (' + notes + ' annotated)' : '');
    }
    console.log(line);
  });
  say('state', c.state ? 'the machine as it stood' : '');
}

// One field. A value with line breaks in it — a --notes of several paragraphs —
// becomes the block under its name rather than one very long line.
function say(name, v) {
  if (!v && v !== 0) return;
  const lines = String(v).split('\n');
  if (lines.length === 1) { console.log(name + ': ' + lines[0]); return; }
  console.log(name + ':');
  for (const l of lines) console.log('  ' + l);
}

// Rows with something said about some of them, in a column: the marks line up
// whatever the values are, which is what makes a block of defaults readable as
// a block. `note` is the mark itself where every row's is the same word.
function column(rows, indent, note) {
  const wide = rows.reduce((w, r) => (r.note ? Math.max(w, r.text.length) : w), 0);
  for (const r of rows) {
    console.log((indent + (r.note ? r.text.padEnd(wide) + '  ' + (note || r.note)
                                  : r.text)).replace(/\s+$/, ''));
  }
}

// The machine the container asks for, field by field, marked where the value is
// the model's rather than the container's. The slots are the resolved map —
// what would actually be fitted — so a slot the container says nothing about
// shows the card the stock complement puts there; `machine.slots` is consulted
// only for which of them to mark, and for a slot the container empties, which
// resolving takes out of the map altogether.
function machineRows(m) {
  const model = m.model || 7;
  const named = m.slots || {};
  const rows = [];
  const row = (k, v, own) => rows.push({ text: k + ': ' + v, note: own ? '' : 'default' });
  row('model', 'Agat-' + model, m.model);
  row('ram', (m.ram || (model === 9 ? 128 : 64)) + 'K', m.ram);
  row('monitor', m.monitor || 'color16', m.monitor);
  row('boot', m.boot || 'auto', m.boot);
  rows.push({ text: 'slots:', note: '' });
  // Sizes are kilobytes in a container and bytes in a machine, as they are on
  // the page: App.scaleSlots does this same multiplication on the way in.
  const scaled = {};
  for (const n in named) {
    scaled[n] = named[n] && { card: named[n].card, ram: named[n].ram * 1024 || 0,
                              drives: named[n].drives };
  }
  const fitted = A.Machine.resolveSlots(model, scaled);
  const slots = Object.keys(fitted).concat(Object.keys(named).filter((n) => !named[n]));
  for (const n of slots.sort((a, b) => a - b)) {
    const s = fitted[n];
    const what = !s ? 'empty'
               : s.card + (s.ram ? ', ' + (s.ram >> 10) + 'K' : '') +
                 (s.drives === 2 ? ', 2 drives' : '');
    rows.push({ text: '  ' + n + ': ' + what, note: n in named ? '' : 'default' });
  }
  return rows;
}
