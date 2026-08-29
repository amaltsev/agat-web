// A file manager for Agat DOS 3.3 disks.
//
//   node tools/dos.js ls    <image> [pattern...]   the catalog, as DOS prints it
//   node tools/dos.js rm    <image> <name>...      delete
//   node tools/dos.js mv    <image> <old> <new>    rename
//   node tools/dos.js lock  <image> <name>...      set the lock mark
//   node tools/dos.js unlock <image> <name>...     clear it
//   node tools/dos.js get   <image> <name> [out]   a file off the disk
//   node tools/dos.js put   <image> <file> [name]  a file onto it
//   node tools/dos.js tget  <image> <name> [out]   the same, Agat text -> UTF-8
//   node tools/dos.js tput  <image> <file> [name]  the same, UTF-8 -> Agat text
//   node tools/dos.js new   <file> [140|840]       a formatted disk, empty
//
// `node tools/dos.js help` prints the flags, the details and some examples.
//
// `get` and `tget` write to standard output when `out` is `-`, and `tget` does
// it by default — so `tget <image> <name>` is how you read a text file without
// leaving one behind.
//
// It takes whatever the emulator takes — .dsk, .nib, .aim, 140K or 840K, with
// or without the "Agathe" header, and .agc containers — and it works out which
// by size, as everything here does.
//
// Reading flags:
//
//   --long, -l     `ls` also prints the T/S list, the load address and the
//                  length the file itself declares
//   --deleted      `ls` also prints the tombstones, with the track DOS parked
//                  in the last byte of the name
//   --raw          `get` writes the file's data stream as DOS stores it, whole
//                  sectors and all, instead of a .fil
//   --body         `get` writes the contents alone: the type's own length or
//                  address prefix off the front, and trimmed to the length it
//                  declares
//
// Writing flags:
//
//   --out=FILE     write the changed image here instead of over the original
//   --type=X       one of T I A B S R K D — what `put` is putting
//   --addr=$2000   the load address for a `B` file
//   --force        overwrite a name that is already on the disk
//   --lock         put the new file down locked
//   --lead         `tput` writes a $8D in front of the first line as well,
//                  which is what asm-89's editor and the ИКП disks' expect;
//                  without it a reader that does eats the first character
//   --medium=N     which medium of an .agc to work on; the first by default
//   --vtoc=T/S     where the VTOC is, if it is not track 17 sector 0
//
// `new` writes what INIT leaves behind without the system: a VTOC, an empty
// catalog and a free map, 140K unless the size says 840. There is no DOS on it,
// so it does not boot; it holds files. It refuses to write over a file that is
// already there, and `--force` says to anyway.
//
// Names are matched on what they *draw*: МАШИНИСТ finds the file whose name is
// half Cyrillic and half Latin look-alikes, which is how they were really
// typed. `*` and `?` glob. Since two different byte strings can draw the same
// word, a name that reaches two files is an error rather than a guess.
//
// `get` writes a .fil — the file's data stream with its catalog entry in front,
// which is what the page loads — so a B file taken off a disk can be dropped
// straight onto the emulator. `put` reads one back, or takes a plain file with
// --type= and, for a B file, --addr=.
//
// Writing changes only the sectors it has to. A .nib or an .aim has that one
// sector's data field re-encoded where it already sat, so every gap, sync field
// and index mark stays where it was and the rest of the image does not move.
// Saving an .agc rewrites the container: the change becomes a patch on the
// medium and everything else is written out again by the same writer the page's
// Save button uses. The image the container carries is left as it was found.
//
//   node tools/dos.js ls   examples/MouseGraf-16.agc 'MGR.ШРФ.*' -l
//   node tools/dos.js get  disk.dsk RUS_ALICE_GAME
//   node tools/dos.js put  disk.dsk snake.fil
//   node tools/dos.js tget disk.dsk ALICE_RUN
//   node tools/dos.js tput disk.dsk hello.txt ЗАПУСК
//   node tools/dos.js tput disk.dsk src.txt ИCXOД --lead
//   node tools/dos.js rm   disk.dsk 'OLD.*'
//   node tools/dos.js mv   disk.dsk KLAWA КЛАВА
//   node tools/dos.js new  data.dsk 840
const fs = require('fs');
const path = require('path');
const H = require('./harness');

// Flags first, so that one may sit anywhere — including where the command
// would be, which is where `--help` lands.
const flags = {};
const rest = process.argv.slice(2).filter((a) => {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
  if (m) { flags[m[1]] = m[2] === undefined ? true : m[2]; return false; }
  if (a === '-l') { flags.long = true; return false; }
  if (a === '-h') { flags.help = true; return false; }
  return true;
});
const cmd = rest.shift() || '';

// The help is the comment at the top of this file, read back off disk. There is
// only one of it, so the two cannot drift — which is the failure every tool
// with a usage string eventually has.
//
// The short form is everything down to the line that offers the long one, which
// is therefore the last thing a bare invocation prints. Splitting on that line
// rather than on a count or a blank keeps the two forms legible in the source:
// what a reader of the comment sees as the pointer is where the cut is.
const MORE = '`node tools/dos.js help` prints the flags, the details and some examples.';

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

const COMMANDS = ['ls', 'rm', 'mv', 'lock', 'unlock', 'get', 'put', 'tget', 'tput', 'new'];
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
const F = A.dosfile;
const die = (e) => { console.error(e.message || e); process.exit(1); };
const hex = (n, w) => '$' + (n >>> 0).toString(16).toUpperCase().padStart(w || 4, '0');

// ---- the image, and putting it back ----------------------------------------

// What the tool works on: the payload as a private copy, and enough of where it
// came from to write it out again. A container is unwrapped to one of its
// media; a bare file keeps its header and any trailing epilogue, which are
// spliced back around the payload on the way out.
async function load(p) {
  const bytes = new ctx.Uint8Array(fs.readFileSync(p));
  const s = A.sniff(bytes, path.basename(p));
  if (s.kind === 'agc') {
    const c = await A.agc.parse(bytes, s.name);
    const i = Number(flags.medium || 0);
    if (!c.media[i]) throw new Error(p + ': no medium ' + i);
    const inner = A.sniff(c.media[i].payload, c.media[i].name);
    if (!A.Sectors.KINDS[inner.kind]) {
      throw new Error(p + ': medium ' + i + ' (' + c.media[i].name +
                      ') is not a disk image');
    }
    return { path: p, kind: inner.kind, inner: inner, agc: c, index: i,
             base: c.media[i].payload,
             data: new ctx.Uint8Array(inner.payload) };
  }
  if (!A.Sectors.KINDS[s.kind]) {
    throw new Error(p + ': not a disk image' +
                    (s.kind ? ' (' + s.kind + ')' : ' (' + bytes.length + ' bytes)'));
  }
  return { path: p, kind: s.kind, inner: s, file: bytes,
           data: new ctx.Uint8Array(s.payload) };
}

async function save(img, sec) {
  if (!sec.dirty) return null;
  sec.pack();
  const out = flags.out || img.path;
  if (img.agc) {
    const patched = new ctx.Uint8Array(img.base);
    patched.set(img.data, img.inner.offset);
    const c = img.agc;
    // Only the medium that was edited is repatched. The others are handed back
    // the list they arrived with, so working on one disk of a container does
    // not quietly rewrite the record of another.
    const media = c.media.map((m, i) => ({
      name: m.name,
      bytes: m.bytes,
      patches: i === img.index ? A.agc.repatch(m.bytes, m.patches, patched)
                               : m.patches,
      mount: m.mount,
      writable: m.writable,
    }));
    const text = await A.agc.build({
      title: c.title, author: c.author, date: c.date, url: c.url,
      notes: c.notes, info: c.info, hint: c.hint,
      model: c.machine.model, ram: c.machine.ram, monitor: c.machine.monitor,
      boot: c.machine.boot, slots: c.machine.slots,
      keys: c.keys, controls: c.controls, state: c.state,
      media: media,
    });
    fs.writeFileSync(out, text);
  } else {
    const whole = new ctx.Uint8Array(img.file);
    whole.set(img.data, img.inner.offset);
    fs.writeFileSync(out, Buffer.from(whole));
  }
  return out;
}

// ---- printing ---------------------------------------------------------------

function header(img, dos) {
  const t = dos.title();
  const size = dos.perTrack === 16 ? '140K' : '840K';
  console.log(path.basename(img.path) + (img.agc ? ' [' + img.inner.name + ']' : '') +
              ' - ' + size + ' ' + img.kind + ', ' + dos.tracks + ' tracks of ' +
              dos.perTrack + ', ДИСК N ' + dos.volume + (t ? ', "' + t + '"' : ''));
}

function line(dos, e) {
  var s = (e.locked ? '*' : ' ') + e.typeLetter + ' ' +
          String(e.sectors).padStart(3, '0') + ' ' + e.name;
  if (e.deleted) s = s.replace(/^./, 'x') + '   (deleted, T/S list was on track ' +
                               e.tsTrack + ')';
  if (!flags.long) return s;
  const d = F.describe(dos, e);
  s = s.padEnd(44) + ' ts=' + d.tsTrack + '/' + d.tsSector;
  if (d.error) return s + ' ' + d.error;
  s += ' sectors=' + d.sectors + ' lists=' + d.lists;
  if (d.len !== undefined) s += ' len=' + d.len;
  if (d.addr !== undefined) s += ' addr=' + hex(d.addr);
  if (d.warn) s += ' -- ' + d.warn;
  return s;
}

// ---- commands ---------------------------------------------------------------

main().catch(die);

async function main() {
  const p = rest.shift();
  if (!p) throw new Error(cmd + ': need an image');
  if (cmd === 'new') return create(p);
  const img = await load(p);
  const sec = new A.Sectors(img.kind, img.data,
                            { prodos: img.inner.prodos, name: img.inner.name });
  const dos = new A.Dos33(sec);
  if (flags.vtoc) {
    const m = /^(\d+)[/:](\d+)$/.exec(flags.vtoc);
    if (!m) throw new Error('--vtoc=' + flags.vtoc + ': want track/sector');
    dos.vtocAt = { track: Number(m[1]), sector: Number(m[2]) };
    dos.reload();
  }

  if (cmd === 'ls') return ls(img, dos);
  if (cmd === 'rm') return commit(img, sec, rm(dos));
  if (cmd === 'mv') return commit(img, sec, mv(dos));
  if (cmd === 'lock') return commit(img, sec, lock(dos, true));
  if (cmd === 'unlock') return commit(img, sec, lock(dos, false));
  if (cmd === 'get') return get(dos, false);
  if (cmd === 'tget') return get(dos, true);
  if (cmd === 'put') return commit(img, sec, await put(dos, false));
  if (cmd === 'tput') return commit(img, sec, await put(dos, true));
}

// A disk with a VTOC and an empty catalog and nothing else. The size is the
// only thing to say about it, since everything else a DOS disk has is either
// the geometry's or the format's — src/dos33.js writes it, and the page's
// Empty button goes through the same call.
function create(p) {
  const size = String(rest.shift() || '140').replace(/k$/i, '');
  const kind = { 140: 'dsk140', 840: 'dsk840' }[size];
  if (!kind) throw new Error('new: 140 or 840, not "' + size + '"');
  if (fs.existsSync(p) && !flags.force) {
    throw new Error(p + ' is already there — --force to overwrite it');
  }
  const geo = A.Sectors.KINDS[kind];
  const data = new ctx.Uint8Array(geo.tracks * geo.perTrack * A.Dos33.SECSIZE);
  const dos = A.Dos33.format(new A.Sectors(kind, data, {}));
  fs.writeFileSync(p, Buffer.from(data));
  console.log('made ' + p + ', ' + kind + ', ' + dos.freeCount() + ' free sectors of ' +
              geo.tracks * geo.perTrack);
}

async function commit(img, sec, said) {
  const out = await save(img, sec);
  if (out) console.log(said + ' -> ' + out);
  else console.log(said);
}

function ls(img, dos) {
  header(img, dos);
  const opts = { deleted: !!flags.deleted };
  let files = rest.length ? [] : dos.list(opts);
  for (const pat of rest) {
    for (const e of dos.match(pat, opts)) {
      if (!files.some((f) => f.at.track === e.at.track &&
                             f.at.sector === e.at.sector &&
                             f.at.index === e.at.index)) files.push(e);
    }
  }
  for (const e of files) console.log(line(dos, e));
  const free = dos.freeCount();
  console.log(files.length + ' file' + (files.length === 1 ? '' : 's') + ', ' +
              free + ' free sector' + (free === 1 ? '' : 's') + ' of ' +
              dos.tracks * dos.perTrack);
}

function rm(dos) {
  if (!rest.length) throw new Error('rm: need a name');
  const gone = [];
  for (const name of rest) {
    for (const e of expand(dos, name)) {
      dos.remove(e);
      gone.push('"' + e.name + '"');
    }
  }
  return 'deleted ' + gone.join(', ');
}

// One name, or every file a glob reaches. A glob that reaches nothing is an
// error, so a typo does not read as "nothing to do".
function expand(dos, name) {
  if (!/[*?]/.test(name)) return [dos.find(name)];
  const got = dos.match(name);
  if (!got.length) throw new Error('nothing matches "' + name + '"');
  return got;
}

function lock(dos, on) {
  if (!rest.length) throw new Error(cmd + ': need a name');
  const done = [];
  for (const name of rest) {
    for (const e of expand(dos, name)) {
      dos.setLocked(e, on);
      done.push('"' + e.name + '"');
    }
  }
  return (on ? 'locked ' : 'unlocked ') + done.join(', ');
}

function mv(dos) {
  if (rest.length !== 2) throw new Error('mv: need an old name and a new one');
  const e = dos.find(rest[0]);
  // The file being renamed is not a clash with itself — `КЛАВА` folds onto
  // `KLABA`, and a rename that only changes which alphabet a letter came from
  // is the commonest one there is.
  const clash = dos.match(rest[1]).filter((f) => f.at.off !== e.at.off ||
                                                 f.at.track !== e.at.track ||
                                                 f.at.sector !== e.at.sector);
  if (clash.length && !flags.force) {
    throw new Error('"' + clash[0].name + '" is already on the disk — --force to rename anyway');
  }
  const was = e.name;
  dos.rename(e, rest[1]);
  return '"' + was + '" -> "' + e.name + '"';
}

function get(dos, asText) {
  if (!rest.length) throw new Error(cmd + ': need a name');
  const e = dos.find(rest[0]);
  if (asText && e.type !== 0x00 && !flags.force) {
    throw new Error('"' + e.name + '" is type ' + e.typeLetter +
                    ', not T — tget --force to read it as text anyway');
  }
  const got = F.unpack(dos, e, asText ? 'text' :
                               flags.raw ? 'raw' : flags.body ? 'body' : 'fil');
  const out = got.text !== undefined ? Buffer.from(got.text, 'utf8')
                                     : Buffer.from(got.bytes);
  const to = rest[1] || (asText ? '-' : got.name);
  if (to === '-') process.stdout.write(out);
  else {
    fs.writeFileSync(to, out);
    console.log('"' + e.name + '" (' + e.typeLetter + ', ' +
                Math.ceil(dos.read(e).length / 256) + ' sectors) -> ' + to +
                ', ' + out.length + ' bytes');
  }
}

async function put(dos, asText) {
  const from = rest.shift();
  if (!from) throw new Error(cmd + ': need a file');
  let type = -1;
  if (flags.type) {
    type = A.Dos33.typeByte(flags.type);
    if (type < 0) throw new Error('--type=' + flags.type + ': one of ' + A.Dos33.TYPES);
  }
  if (flags.raw && type < 0) throw new Error('--raw needs --type');

  const got = F.pack(asText ? fs.readFileSync(from, 'utf8')
                            : new ctx.Uint8Array(fs.readFileSync(from)), {
    name: rest.shift() || '',
    type: type,
    addr: flags.addr,
    addrLabel: flags.addr === undefined ? undefined : '--addr=' + flags.addr,
    locked: !!flags.lock,
    text: asText,
    lead: !!flags.lead,
    raw: !!flags.raw,
  });
  const data = got.data, locked = got.locked;
  let name = got.name;
  type = got.type;

  if (!name) name = F.defaultName(from);
  const clash = dos.match(name);
  if (clash.length) {
    if (!flags.force) {
      throw new Error('"' + clash[0].name + '" is already on the disk — --force to replace it');
    }
    for (const e of clash) dos.remove(e);
  }
  const made = dos.create(name, type, data, { locked: locked });
  return 'wrote "' + name + '" (' + A.Dos33.typeLetter(type) + ', ' +
         made.sectors + ' sectors, T/S list at ' + made.track + '/' + made.sector + ')';
}
