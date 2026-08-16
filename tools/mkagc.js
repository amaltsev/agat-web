// Pack an image and the settings it needs into an .agc container.
//
//   node tools/mkagc.js <image...> [flags] > out.agc
//
//   --title=TEXT          what the program is called
//   --author=TEXT         who wrote it
//   --date=TEXT           when: "1989", "circa 1985", "1990-92"
//   --url=URL             where it came from, or where it is written up
//   --notes=TEXT          prose for the record: provenance, credits, what a
//                         patch does. Nothing shows it.
//   --hint=TEXT           one line to whoever plays it, printed under the
//                         controls
//   --model=7|9           the machine it wants
//   --ram=32|64|128       Agat-7 RAM, in K
//   --key=KEY[:CODE[:HINT]]   a key the program uses, repeatable, the hint
//                             saying what it does: --key=KeyW:^:Shoot right.
//                             With no code the key is declared as it already
//                             is: --key=Space::Jump
//   --patch=AT:HEX        patch, repeatable: --patch=45312:A96085
//   --diff=FILE           derive the patches by comparing FILE with the image
//   --width=N             base64 line width, a multiple of 4
//
// The writer is src/agc.js, the same one the page's Save button goes through,
// so a container written here and one written there are the same file.
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const argv = process.argv.slice(2);
const flags = {};
const files = argv.filter((a) => {
  // `[\s\S]` rather than `.`, so a value pasted with line breaks in it — a
  // --hint wrapped in the shell — is still that flag's value rather than a
  // filename that does not exist.
  const m = /^--([a-z]+)(?:=([\s\S]*))?$/.exec(a);
  if (!m) return true;
  // The repeatable flags collect; the rest are last-wins.
  if (m[1] === 'key' || m[1] === 'patch') (flags[m[1]] = flags[m[1]] || []).push(m[2]);
  else flags[m[1]] = m[2] === undefined ? true : m[2];
  return false;
});

if (!files.length) {
  console.error('need an image; see the header of tools/mkagc.js');
  process.exit(2);
}

const ctx = H.loadModules();
const A = ctx.AGAT;

// The differ is src/agc.js's, the same one the page's Save button runs over a
// disk that has been written to, so --diff and a save produce the same records.
const diff = A.agc.diff;

// KEY:VALUE:HINT, split on the first two colons — a value is `^`, `$5E` or a
// name and never contains one, so only the hint can. No value at all declares
// the key as it already is: `--key=Space` and `--key=Space::Jump` both say the
// program uses Space and leave what it sends alone.
const keys = {};
for (const k of flags.key || []) {
  const at = k.indexOf(':');
  const key = at < 0 ? k : k.slice(0, at);
  const rest = at < 0 ? '' : k.slice(at + 1);
  const cut = rest.indexOf(':');
  const value = cut < 0 ? rest : rest.slice(0, cut);
  const hint = cut < 0 ? '' : rest.slice(cut + 1);
  if (value && A.keyboard.resolveCode(value) < 0) {
    console.error('--key=' + k + ': ' + value + ' is not a code — try $5E, ^, or Up');
    process.exit(2);
  }
  keys[key] = value ? (hint ? { code: value, hint: hint } : value)
                    : (hint ? { hint: hint } : null);
}

const explicit = (flags.patch || []).map((p) => {
  const at = p.indexOf(':');
  if (at < 0) { console.error('--patch wants AT:HEX, got ' + p); process.exit(2); }
  return { at: Number(p.slice(0, at)), hex: p.slice(at + 1) };
});

try {
  let modelHint = 0;                 // not the container's `hint`: the 7a/9a
  const media = files.map((f, i) => {
    const bytes = new ctx.Uint8Array(fs.readFileSync(f));
    // Sniffed for the error, not for the container: a container holds the file
    // it was given. Refusing here beats writing something that will not load.
    const s = A.sniff(bytes, path.basename(f));
    if (!s.kind) throw new Error(f + ': not a recognised Agat image');
    if (s.kind === 'agc') throw new Error(f + ': already a container');
    if (!modelHint) modelHint = s.hintModel || 0;
    let patches = explicit;
    if (flags.diff) {
      if (i > 0) throw new Error('--diff applies to one image, and this is ' + f);
      patches = patches.concat(
        diff(bytes, new ctx.Uint8Array(fs.readFileSync(flags.diff)),
             Number(flags.width) || 0));
    }
    // The patches have to apply to what is being packed, or the container is
    // broken in a way only whoever loads it would find out.
    A.agc.applyPatches(bytes, patches);
    return { name: path.basename(f), bytes: bytes, patches: patches };
  });

  const model = Number(flags.model) || modelHint || 7;
  process.stdout.write(A.agc.build({
    title: flags.title || '',
    author: flags.author || '',
    date: flags.date || '',
    url: flags.url || '',
    notes: flags.notes || '',
    hint: flags.hint || '',
    model: model,
    ram: Number(flags.ram) || (model === 9 ? 128 : 64),
    keys: keys,
    media: media,
    width: Number(flags.width) || 0,
  }));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
