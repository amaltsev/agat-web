// Pack an image and the settings it needs into an .agc container.
//
//   node tools/mkagc.js <image...> [flags] > out.agc
//
//   --title=TEXT          what the program is called
//   --author=TEXT         who wrote it
//   --date=TEXT           when: "1989", "circa 1985", "1990-92"
//   --url=URL             where it came from, or where it is written up
//   --notes=TEXT          prose: provenance, credits, what a patch does
//   --model=7|9           the machine it wants
//   --ram=32|64|128       Agat-7 RAM, in K
//   --irq=raster|held|pulse
//   --rate=HZ             sub-frame rate for the two free-running models
//   --key=CODE:VALUE[:NOTE]   remap, repeatable, the note saying what the key
//                             does: --key=KeyW:^:Shoot right
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
  const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
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

// Where two images differ, as patch records. Runs are joined across gaps of up
// to 8 identical bytes, because a patch that reads as one change should be one
// record: three separate `at`s for `A9 60 EA EA 85 84` helps nobody.
function diff(orig, mod) {
  if (orig.length !== mod.length) {
    throw new Error('--diff image is ' + mod.length + ' bytes, the original ' +
                    orig.length + ' — patches are byte-for-byte');
  }
  const out = [];
  let at = -1, last = -1;
  for (let i = 0; i < orig.length; i++) {
    if (orig[i] === mod[i]) continue;
    if (at < 0 || i - last > 8) {
      if (at >= 0) out.push([at, last]);
      at = i;
    }
    last = i;
  }
  if (at >= 0) out.push([at, last]);
  return out.map(([from, to]) => ({
    at: from,
    hex: A.agc.toHex(mod.subarray(from, to + 1)),
  }));
}

// CODE:VALUE:NOTE, split on the first two colons — a value is `^`, `$5E` or a
// name and never contains one, so only the note can.
const keys = {};
for (const k of flags.key || []) {
  const at = k.indexOf(':');
  if (at < 0) { console.error('--key wants CODE:VALUE, got ' + k); process.exit(2); }
  const code = k.slice(0, at), rest = k.slice(at + 1);
  const cut = rest.indexOf(':');
  const value = cut < 0 ? rest : rest.slice(0, cut);
  const note = cut < 0 ? '' : rest.slice(cut + 1);
  if (A.keyboard.resolveCode(value) < 0) {
    console.error('--key=' + k + ': ' + value + ' is not a code — try $5E, ^, or Up');
    process.exit(2);
  }
  keys[code] = note ? { code: value, note: note } : value;
}

const explicit = (flags.patch || []).map((p) => {
  const at = p.indexOf(':');
  if (at < 0) { console.error('--patch wants AT:HEX, got ' + p); process.exit(2); }
  return { at: Number(p.slice(0, at)), hex: p.slice(at + 1) };
});

try {
  let hint = 0;
  const media = files.map((f, i) => {
    const bytes = new ctx.Uint8Array(fs.readFileSync(f));
    // Sniffed for the error, not for the container: a container holds the file
    // it was given. Refusing here beats writing something that will not load.
    const s = A.sniff(bytes, path.basename(f));
    if (!s.kind) throw new Error(f + ': not a recognised Agat image');
    if (s.kind === 'agc') throw new Error(f + ': already a container');
    if (!hint) hint = s.hintModel || 0;
    let patches = explicit;
    if (flags.diff) {
      if (i > 0) throw new Error('--diff applies to one image, and this is ' + f);
      patches = patches.concat(
        diff(bytes, new ctx.Uint8Array(fs.readFileSync(flags.diff))));
    }
    // The patches have to apply to what is being packed, or the container is
    // broken in a way only whoever loads it would find out.
    A.agc.applyPatches(bytes, patches);
    return { name: path.basename(f), bytes: bytes, patches: patches };
  });

  const model = Number(flags.model) || hint || 7;
  process.stdout.write(A.agc.build({
    title: flags.title || '',
    author: flags.author || '',
    date: flags.date || '',
    url: flags.url || '',
    notes: flags.notes || '',
    model: model,
    ram: Number(flags.ram) || (model === 9 ? 128 : 64),
    irq: flags.irq || 'raster',
    rate: Number(flags.rate) || 0,
    keys: keys,
    media: media,
    width: Number(flags.width) || 0,
  }));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
