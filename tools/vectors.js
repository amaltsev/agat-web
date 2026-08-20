// Pure-function tests: no machine, no disk, no timing. Runs in well under a
// second and catches the transcription slips that are otherwise invisible until
// you are staring at a wrong screen.
//
//   node tools/vectors.js
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const ctx = H.loadModules();
const A = ctx.AGAT;

// An image off disk, sniffed. `H.sniffFile` is a promise because a container's
// payload may need inflating first; the files here are images, and the sniffer
// answers for one straight away.
const sniffImage = (p) =>
  A.sniff(new ctx.Uint8Array(fs.readFileSync(p)), path.basename(p));

// gcr140's output over the bundled example, whose chain of trust runs back to
// the encoder being verified byte-for-byte against a compiled dsk2nib. The
// digest is over an input file, so replacing that example replaces this: the
// way to re-pin it honestly is to check that the unchanged encoder still
// reproduces the previous digest from the previous disk, then take a new one.
const GCR_GOLDEN =
  '722e4b46646bb16bfc5c64ae06000f5399563411d38b73ddea2b3f6480c1a3ef';
let pass = 0, fail = 0;
const hex = (v) => '$' + v.toString(16).toUpperCase();
function eq(what, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log('FAIL ' + what + '\n  got  ' + g + '\n  want ' + w);
}

// --- Agat-7 banking ---------------------------------------------------------
// baseram.c:475-502. 128K: bit 3 picks the table pair, bits 2..0 index it.
{
  const K = 0x4000;
  const m = new A.Mem7(0x20000);
  eq('mem7 reset map', [m.map[0], m.map[1], m.map[2]], [0, K, 2 * K]);

  const NO = [2, 3, 6, 7, 2, 3, 4, 5];
  for (let s = 0; s < 8; s++) {
    m.setState(s);
    eq('mem7 128K state ' + s, [m.map[0], m.map[1], m.map[2]],
       [0, 1 * K, NO[s] * K]);
  }
  const NO1 = [1, 1, 4, 5, 1, 1, 4, 5], NO2 = [2, 3, 6, 7, 2, 3, 6, 7];
  for (let s = 0; s < 8; s++) {
    m.setState(8 | s);
    eq('mem7 128K state ' + (8 | s), [m.map[0], m.map[1], m.map[2]],
       [0, NO1[s] * K, NO2[s] * K]);
  }

  const m64 = new A.Mem7(0x10000);
  m64.setState(0); eq('mem7 64K state 0', m64.map[2], 2 * K);
  m64.setState(1); eq('mem7 64K state 1', m64.map[2], 3 * K);
  m64.setState(9); eq('mem7 64K state 9 (bit0 only)', m64.map[2], 3 * K);

  // 32K: $8000-$BFFF is not there at all.
  const m32 = new A.Mem7(0x8000);
  eq('mem7 32K $8000 open bus', m32.phys(0x8000), -1);
  eq('mem7 32K $7FFF present', m32.phys(0x7fff), 0x7fff);
  eq('mem7 phys is window-relative', new A.Mem7(0x20000).phys(0x4123), 0x4123);
}

// --- Agat-7 ОЗУ expansion ---------------------------------------------------
// xram7.c. The register is the slot's whole page and only seven bits of the
// address reach it, so $C480 is another name for $C400.
{
  const x = new A.Xram7();
  eq('xram 32K by default', x.size, 0x8000);
  eq('xram starts deselected', [x.selected(), x.readReg()], [false, 0]);

  x.writeReg(0xc408);
  eq('xram bit 3 selects it', [x.selected(), x.readReg()], [true, 8]);
  x.writeReg(0xc488);
  eq('xram register ignores address bit 7', x.readReg(), 8);
  x.writeReg(0xc4ff);
  eq('xram register keeps seven bits', x.readReg(), 0x7f);

  // Bank 0 is $0000, bank 1 is $4000, and with 32K fitted bank 2 wraps back
  // onto bank 0 — the 3-bit field reaches 128K, the card does not.
  const off = (state, a) => { x.state = state; return x.offset(a); };
  eq('xram bank 0 @ $8000', off(0x08, 0x8000), 0);
  eq('xram bank 0 @ $BFFF', off(0x08, 0xbfff), 0x3fff);
  eq('xram bank 1 @ $8000', off(0x09, 0x8000), 0x4000);
  eq('xram bank 2 wraps at 32K', off(0x0a, 0x8000), 0);
  const big = new A.Xram7({ size: 0x20000 });
  big.state = 0x0a;
  eq('xram bank 2 is its own at 128K', big.offset(0x8000), 0x8000);

  // Write protect answers reads and drops stores (xram7.c:44-49).
  const w = new A.Xram7();
  w.writeReg(0xc408);
  w.write(0x8000, 0x5a);
  eq('xram writes land', w.read(0x8000), 0x5a);
  w.writeReg(0xc418);                       // bit 4: protected
  w.write(0x8000, 0xff);
  eq('xram write protect drops stores', w.read(0x8000), 0x5a);
  eq('xram write protect still reads', w.writeProtected(), true);

  // Reset deselects and goes back to bank 0; the chips keep what is in them.
  w.reset();
  eq('xram reset deselects', [w.selected(), w.state], [false, 0]);
  eq('xram reset keeps contents', w.ram[0], 0x5a);
}

// --- what the App builds from a profile -------------------------------------
// The page's own wiring, without a page: App resolves the profile in its
// constructor, so a stub canvas is enough to check that the machine it would
// build is the machine that was asked for. Nothing here runs a frame.
{
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ createImageData: () => ({ data: [] }), putImageData: () => {} }),
  };
  const mk = (opts) => new A.App(Object.assign({ canvas }, opts));
  const cards = (app) => Object.keys(app.slots).map((n) => n + ':' + app.slots[n].card);

  const stock = mk({ model: 7 });
  eq('App stock Agat-7 base RAM', stock.ramSize, 0x10000);
  eq('App stock Agat-7 slots', cards(stock),
     ['2:psrom', '3:fdd140', '4:xram', '5:fdd840']);
  eq('App stock Agat-7 writes no slot diff', stock.slotDiff(), null);
  eq('App finds its drives', [stock.slotFor('nib140'), stock.slotFor('dsk840')], [3, 5]);

  const nine = mk({ model: 9, ramSize: 0x8000 });
  eq('App Agat-9 ignores a RAM size', nine.ramSize, 0x20000);
  eq('App Agat-9 slots', cards(nine), ['2:xram9', '5:fdd840', '6:fdd140']);

  // The App is asked for cards rather than for slots — see Machine.cardsOf —
  // and works the slot numbers out for the model it is building.
  const big = mk({ model: 7,
                   cards: { xram: { card: 'xram', ram: 0x20000 }, psrom: null } });
  eq('App override reaches the slots',
     [big.slots[4].ram, big.slots[2]], [0x20000, undefined]);
  eq('App slotDiff reports it in kilobytes',
     big.slotDiff(), { 2: null, 4: { card: 'xram', ram: 128 } });

  // A mouse is never stock, so it is a slot override and comes back out of
  // slotDiff() as one — which is what puts it in a saved container.
  const mouse = mk({ model: 9, cards: { mouse: { card: 'mouse-nippel' } } });
  eq('App fits a mouse where it was asked for',
     cards(mouse), ['2:xram9', '4:mouse-nippel', '5:fdd840', '6:fdd140']);
  eq('App mouse survives the round trip',
     mouse.slotDiff(), { 4: { card: 'mouse-nippel' } });

  // The same mouse on the other card is a card of its own in the slot map,
  // because which card it is decides which programs will look at it.
  const marsRom = mk({ model: 9, cards: { mouse: { card: 'mouse-mars-rom' } } });
  eq('App fits a «Марсианка» on a card with the ROM',
     cards(marsRom), ['2:xram9', '4:mouse-mars-rom', '5:fdd840', '6:fdd140']);
}

// --- the mice ---------------------------------------------------------------
// nippelmouse.c and mouse9.c. Both are relative: what a program can read is how
// far the mouse has moved, never where it is.
{
  // Ниппель: two 7-bit counters, read as nibbles, with a button in bit 3 of
  // each high one. This is MouseGraf 4.4's probe at $84F4, in order.
  const n = new A.MouseNippel();
  const rd = (r) => n.read(r);
  n.write(0xc);
  eq('nippel clears both counters', [rd(8), rd(9), rd(0xa), rd(0xb)], [0, 0, 0, 0]);
  n.write(0x8);
  eq('nippel presets both to $22', [rd(8), rd(9), rd(0xa), rd(0xb)], [2, 2, 2, 2]);

  n.write(0xc);
  n.move(5, 0);
  eq('nippel counts X up as the pointer goes right', [rd(8), rd(9)], [5, 0]);
  n.move(0, 3);
  eq('nippel counts Y down as the pointer goes down', [rd(0xa), rd(0xb)], [0x0d, 7]);
  n.move(0, -3);
  eq('nippel Y comes back', [rd(0xa), rd(0xb)], [0, 0]);

  // The counter is seven bits and wraps; a program that reads slower than the
  // mouse moves cannot tell 130 counts from 2, which is the hardware's own
  // limit and not something to paper over.
  n.write(0xc);
  n.move(130, 0);
  eq('nippel X wraps at seven bits', [rd(8), rd(9)], [2, 0]);

  // The sub-count remainder lives outside the counter, so clearing does not
  // throw it away: ten moves of a third of a count are three counts, whenever
  // the program happens to look.
  n.reset();
  for (let i = 0; i < 10; i++) n.move(0.5, 0);
  eq('nippel accumulates sub-count movement', rd(8), 5);
  n.reset();
  n.move(0.5, 0);
  n.write(0xc);                       // the program has read it and zeroed it
  n.move(0.5, 0);
  eq('nippel keeps the fraction across a clear', rd(8), 1);

  n.btn = 1;
  eq('nippel button A is bit 3 of the Y high nibble', [rd(0xb) & 8, rd(9) & 8], [8, 0]);
  n.btn = 2;
  eq('nippel button B is bit 3 of the X high nibble', [rd(0xb) & 8, rd(9) & 8], [0, 8]);
  n.btn = 0;
  eq('nippel decodes nothing else in the page', n.read(0), 0xff);

  // «Марсианка»: four direction lines in the bottom of port C, active low, one
  // pulse per step. The bit-to-direction mapping is MouseGraf 1.6's own table
  // at $6317, read out of the running program: bit 3 x+1, bit 2 x-1, bit 1
  // y-1, bit 0 y+1, against a value the driver inverts before it looks.
  const P = 256;                       // STEP_CYCLES in src/mouse.js
  const mars = new A.MouseMars();
  const lines = (t) => (~mars.read(2, t)) & 0x0f;
  const res = (m, t) => { m.write(0, 0x80); m.write(0, 0x00); return t; };
  eq('mars idles with no line asserted', lines(0), 0);
  mars.move(1, 0);                     // one step, with nothing queued behind it
  eq('mars asserts x+ for a step right', lines(P), 8);
  // Long enough to outlive any decode window — 14 cycles in MouseGraf 1.6, 102
  // in Klondike, which goes through its button handler first — and no longer
  // than a step, so a program that never clears is not left holding one.
  eq('mars holds the line across a decode window', lines(P + 102), 8);
  eq('mars lets go of it by itself after a step', lines(2 * P), 0);
  mars.reset();
  mars.move(1, 0);
  eq('mars asserts again', lines(3 * P), 8);
  res(mars);
  eq('mars RES takes it down early', lines(3 * P + 10), 0);

  // And the next step no sooner than a step interval after the last, which is
  // the ball rolling rather than anything the driver did.
  mars.reset();
  mars.move(2, 0);
  eq('mars asserts the first step at once', lines(1000), 8);
  res(mars);
  eq('mars sends nothing until the interval is up', lines(1000 + P - 1), 0);
  eq('mars sends the next step when it is', lines(1000 + P), 8);
  res(mars);
  eq('mars has nothing left to send', lines(1000 + 2 * P), 0);
  mars.move(-1, 1);
  eq('mars sends both axes in one state', lines(1000 + 3 * P), 4 | 1);
  res(mars);
  mars.move(0, -1);
  eq('mars sends y- upward', lines(1000 + 4 * P), 2);

  // The two buttons sit where the ММ-8031's do, and the driver reads them
  // through the same inversion.
  mars.btn = 1;
  eq('mars button A is bit 7, active low', mars.read(2, 1000 + 4 * P + 10) & 0xc0, 0x40);
  mars.btn = 2;
  eq('mars button B is bit 6', mars.read(2, 1000 + 4 * P + 20) & 0xc0, 0x80);
  mars.btn = 0;

  // RES is bit 7 of port A and not port A: the ММ-8031 shares these registers
  // and picks an axis with the same write, so a card that cleared on any of
  // them would be answering the wrong mouse.
  const held = new A.MouseMars();
  held.move(1, 0);
  eq('mars asserts a step', (~held.read(2, 1000)) & 0x0f, 8);
  held.write(0, 0x7f);
  eq('mars keeps it through a port A write without bit 7',
     (~held.read(2, 1010)) & 0x0f, 8);
  held.write(1, 0xff);
  eq('mars keeps it through a port B write', (~held.read(2, 1020)) & 0x0f, 8);
  held.write(0, 0x80);
  eq('mars RES takes it down at once', (~held.read(2, 1030)) & 0x0f, 0);

  // The card under either mouse, which is what a program reads before it will
  // look at the ports at all: with the printer card's ROM page fitted port B
  // answers $FF until something writes it, and on a bare card $00.
  const bare = new A.MouseMars(null);
  const carded = new A.MouseMars(new Uint8Array([0x18, 0x90]));
  eq('mars on a bare card has no page and $00 at port B',
     [bare.rom, bare.read(1)], [null, 0x00]);
  eq('mars on a card with the ROM has $FF at port B', carded.read(1), 0xff);
  carded.write(1, 0x12);
  eq('port B is a latch once it has been written', carded.read(1), 0x12);
  carded.reset();
  eq('and comes back to what the card answers', carded.read(1), 0xff);

  // ММ-8031: port C, read after a write to port A that says which axis and
  // latches it. A standing mouse reads $20 in the delta field, which is what
  // MouseGraf 4.4 tests for at $84D4.
  const p = new A.MouseMM8031();
  const latch = (axis) => { p.write(0, axis ? 0x80 : 0); return p.read(2); };
  eq('mm8031 idle X reads as no motion', latch(0) & 0x3c, 0x20);
  eq('mm8031 idle Y reads as no motion', latch(1) & 0x3c, 0x20);
  eq('mm8031 idle has both buttons up', latch(0) & 0xc0, 0xc0);

  // The scale is companded, so the reading is an index into the table rather
  // than a count: six counts is index 3, and the three that the index cannot
  // express stay behind for the next read.
  p.move(6, 0);
  eq('mm8031 reports six counts as index 3', (latch(0) >> 2) & 15, 8 + 3);
  eq('mm8031 has nothing left to report', (latch(0) >> 2) & 15, 8);
  p.move(-1, 0);
  eq('mm8031 reports a step back as index -1', (latch(0) >> 2) & 15, (8 - 1) & 15);

  // Index 4 is as far as it goes in one read — 15 counts — however far the
  // mouse has actually moved.
  p.move(400, 0);
  eq('mm8031 clamps a long sweep to index 4', (latch(0) >> 2) & 15, 8 + 4);

  p.reset();
  p.move(0, 6);
  eq('mm8031 reports Y inverted', (latch(1) >> 2) & 15, (8 - 3) & 15);

  p.btn = 1;
  eq('mm8031 buttons are active low, A in bit 7', p.read(2) & 0xc0, 0x40);
  p.btn = 2;
  eq('mm8031 button B is bit 6', p.read(2) & 0xc0, 0x80);
  p.btn = 0;
  p.write(1, 0x87);
  eq('mm8031 port B reads back its latch', p.read(1), 0x87);
}

// --- pointer capture --------------------------------------------------------
// attachMouse against a stub DOM. Not a unit test of a pure function, but the
// alternative is a claim about the browser that nothing checks — and the bits a
// button lands on are exactly the kind of thing that is wrong silently.
{
  const bags = { canvas: {}, win: {}, doc: {} };
  const on = (bag) => (t, f) => { (bag[t] = bag[t] || []).push(f); };
  const fire = (bag, t, e) => (bag[t] || []).forEach((f) => f(e || {}));
  const click = (button) => fire(bags.canvas, 'mousedown', { button, preventDefault() {} });

  const doc = { pointerLockElement: null, addEventListener: on(bags.doc) };
  const canvas = {
    ownerDocument: doc,
    addEventListener: on(bags.canvas),
    requestPointerLock() { doc.pointerLockElement = canvas; fire(bags.doc, 'pointerlockchange'); },
    getBoundingClientRect: () => ({ width: 512, height: 512 }),
  };
  const hadListener = ctx.window.addEventListener;
  ctx.window.addEventListener = on(bags.win);

  const card = new A.MouseNippel();
  const app = { mouseCard: () => card, mouseCaptured: false };
  A.attachMouse(canvas, app);

  // The click that hands the pointer over is a press as well. Swallowing it
  // left MouseGraf — which draws no cursor until a button arrives — looking
  // dead in the browser while every headless test passed.
  click(0);
  eq('first click captures and presses', [app.mouseCaptured, card.btn], [true, 1]);
  fire(bags.win, 'mouseup', { button: 0 });

  click(0);
  eq('the host left button is button A', card.read(0xb) & 8, 8);
  click(2);
  eq('the host right button is button B', card.read(9) & 8, 8);
  fire(bags.win, 'mouseup', { button: 0 });
  eq('a release clears only its own bit', [card.read(0xb) & 8, card.read(9) & 8], [0, 8]);
  fire(bags.win, 'mouseup', { button: 2 });

  // 512 CSS pixels across a 256-count screen is half a count each, and the
  // halves have to survive being added up.
  card.write(0xc);
  for (let i = 0; i < 8; i++) fire(bags.win, 'mousemove', { movementX: 1, movementY: 0 });
  eq('eight host pixels are four counts', card.read(8), 4);

  // Nothing will report the release of a button held when the pointer goes.
  click(0);
  doc.pointerLockElement = null;
  fire(bags.doc, 'pointerlockchange');
  eq('losing the pointer releases the buttons', [app.mouseCaptured, card.btn], [false, 0]);
  fire(bags.win, 'mousemove', { movementX: 20, movementY: 0 });
  eq('and stops the movement', card.read(8), 4);

  ctx.window.addEventListener = hadListener;
}

// --- the info card ----------------------------------------------------------
// drawInfo against a stub DOM, for the same reason the capture test is here:
// what a container gets to put on the page is worth checking without one. The
// stub keeps children and textContent apart, which the card relies on — no node
// on it carries both.
{
  const el = () => ({
    tag: '', className: '', textContent: '', children: [],
    appendChild(c) { this.children.push(c); return c; },
    set innerHTML(v) { this.children = []; },
    get innerHTML() { return ''; },
  });
  const had = ctx.document;
  ctx.document = {
    createElement: (t) => Object.assign(el(), { tag: t }),
    createTextNode: (t) => Object.assign(el(), { tag: '#text', textContent: t }),
  };
  // A row is its own children when it has any, so the card reads back as the
  // lines the page draws. The prose rows run their pieces together, since a
  // link in a sentence is part of the sentence; the author-date-url row is
  // spaced, since its separators are drawn rather than written.
  const lines = (host) => host.children.map((k) => k.children.length
    ? k.children.map((c) => c.textContent).join(k.className === 'info-who' ? ' ' : '')
    : k.textContent);
  const classes = (host) => host.children.map((k) => k.className);

  const host = el();
  A.drawInfo(host, {
    title: 'RISE OUT', author: 'Andrew Maltsev', date: '1989',
    url: 'https://github.com/amaltsev/agat-rise-out/',
    info: 'A platform game for the Agat-7.', hint: 'Starts in ЛАТ.',
  });
  eq('the card is the title, who and when, what it is, and the hint', lines(host),
     ['RISE OUT', 'Andrew Maltsev · 1989 · github.com/amaltsev/agat-rise-out',
      'A platform game for the Agat-7.', 'Starts in ЛАТ.']);
  eq('in four rows of their own', classes(host),
     ['info-name', 'info-who', 'info-text', 'info-hint']);

  // The address keeps its scheme where it is followed, and is an <a> only
  // because it is http: a container is a file from elsewhere.
  const link = host.children[1].children[4];
  eq('the url is a link to what the container wrote',
     [link.tag, link.href, link.target, link.rel],
     ['a', 'https://github.com/amaltsev/agat-rise-out/', '_blank', 'noopener noreferrer']);

  A.drawInfo(host, { title: 'Trojan', url: 'javascript:alert(1)' });
  eq('a url that is not the web is printed and not linked',
     [host.children[1].children[0].tag, host.children[1].children[0].href],
     ['span', undefined]);

  // A bare address in the prose is the one thing recognised in it. The text
  // stays as the container wrote it — scheme and all, because there it is part
  // of a sentence — and the full stop after it belongs to the sentence.
  A.drawInfo(host, {
    info: 'Written up at https://agatcomp.ru/agat/x.shtml. Worth a read.',
    hint: 'See https://example.org/help',
  });
  eq('the prose is unchanged by being linked', lines(host),
     ['Written up at https://agatcomp.ru/agat/x.shtml. Worth a read.',
      'See https://example.org/help']);
  eq('and the address in it is a link, without the sentence around it',
     host.children[0].children.map((k) => k.tag + '|' + (k.href || '')),
     ['#text|', 'a|https://agatcomp.ru/agat/x.shtml', '#text|']);
  eq('a hint links the same way',
     host.children[1].children.map((k) => k.tag + '|' + (k.href || '')),
     ['#text|', 'a|https://example.org/help']);

  // A bracket the address opened is the address's own; one it did not is the
  // sentence's. Both addresses in a paragraph are links.
  A.drawInfo(host, { info: '(see https://a.ru/x) and https://b.ru/a_(b)!' });
  eq('a link stops where the sentence resumes',
     host.children[0].children.filter((k) => k.tag === 'a').map((k) => k.href),
     ['https://a.ru/x', 'https://b.ru/a_(b)']);

  // Only a scheme starts a link, and only the two the page will follow.
  A.drawInfo(host, { info: 'Try javascript:alert(1) or agatcomp.ru today' });
  eq('nothing else in a sentence becomes a link',
     [host.children[0].children.length, lines(host)[0]],
     [1, 'Try javascript:alert(1) or agatcomp.ru today']);

  // Only what the container named: no empty rows, and no separators around
  // something that is not there.
  A.drawInfo(host, { date: '1992' });
  eq('a card of one thing is one row of one thing',
     [lines(host), classes(host)], [['1992'], ['info-who']]);

  // A bare image brings none of the five, and an empty element is what the
  // stylesheet hides.
  A.drawInfo(host, {});
  eq('nothing to say draws nothing', host.children.length, 0);

  ctx.document = had;
}

// --- image sniffing ---------------------------------------------------------
{
  const cases = [
    [143360, 'dsk140'], [143364, 'dsk140'], [143488, 'dsk140'],
    [232960, 'nib140'],
    [860160, 'dsk840'], [860164, 'dsk840'], [860288, 'dsk840'],
    [947520, 'nib840'],
    [2068480, 'aim840'],
    [12345, null],
  ];
  for (const [size, kind] of cases) {
    const s = A.sniff(new ctx.Uint8Array(size), 'x.dsk');
    eq('sniff ' + size, s.kind, kind);
  }
  // The 256-byte "Agathe" header is a prefix, and shifts the payload.
  const sig = 'Agathe emulator virtual disk\r\n\x1aAD';
  const withHdr = new ctx.Uint8Array(256 + 143360);
  for (let i = 0; i < sig.length; i++) withHdr[i] = sig.charCodeAt(i);
  withHdr[48] = 1;
  const s = A.sniff(withHdr, 'x.dsk');
  eq('sniff headered dsk140', [s.kind, s.writeProtect, s.payload.length],
     ['dsk140', true, 143360]);
}

// --- 840K checksum ----------------------------------------------------------
// Self-validating: pull real sectors out of an .aim and check that the stored
// checksum is what our routine computes. No .aim ships with the repo, so point
// AGAT_AIM at one to run this; without it the block just skips.
{
  const aim = process.env.AGAT_AIM;
  if (aim && fs.existsSync(aim)) {
    const raw = fs.readFileSync(aim);
    const TW = 6464;
    let checked = 0, bad = 0;
    for (let t = 0; t < 8; t++) {
      for (let k = 0; k < 21; k++) {
        const i = (t * TW + 20 + 306 * k) * 2;         // word -> byte offset
        const data = new ctx.Uint8Array(256);
        for (let j = 0; j < 256; j++) data[j] = raw[i + (15 + j) * 2];
        const stored = raw[i + (15 + 256) * 2];
        if (A.aim840.checksum(data, 0) !== stored) bad++;
        checked++;
      }
    }
    eq('aim840 checksum over ' + checked + ' real sectors', bad, 0);
  } else {
    console.log('skip: aim840 checksum (set AGAT_AIM to an .aim to run it)');
  }
}

// --- 140K GCR ---------------------------------------------------------------
// The 6-and-2 encoder is the fiddliest transcription in the project. Its output
// for the bundled example is checked against a digest taken when it was
// verified byte-for-byte against agat-emulator's own dsk2nib.
{
  const dsk = path.join(H.ROOT, 'examples', 'rise-out.dsk');
  if (fs.existsSync(dsk)) {
    const media = ctx.AGAT.mount(sniffImage(dsk));
    eq('gcr140 track count', [media.tracks, media.stride], [35, 6656]);
    const sha = require('crypto').createHash('sha256')
      .update(Buffer.from(media.bytes)).digest('hex');
    eq('gcr140 nibble stream digest', sha, GCR_GOLDEN);
    // Address field of track 0 sector 0, 4-and-4 encoded.
    let i = 0;
    while (i < 200 && !(media.bytes[i] === 0xd5 && media.bytes[i + 1] === 0xaa &&
                        media.bytes[i + 2] === 0x96)) i++;
    const dec = A.gcr140.decode44;
    eq('gcr140 T0S0 address field',
       [dec(media.bytes[i + 3], media.bytes[i + 4]),      // volume
        dec(media.bytes[i + 5], media.bytes[i + 6]),      // track
        dec(media.bytes[i + 7], media.bytes[i + 8])],     // sector
       [254, 0, 0]);
  } else {
    console.log('skip: gcr140 (no examples/rise-out.dsk)');
  }
}

// --- 140K GCR, the way back -------------------------------------------------
// The decoder has no upstream to be checked against, so what stands in for one
// is the encoder: over a whole real disk, denibblizing must give back the
// sector image byte for byte. That rides on the encoder's own chain of trust
// back to a compiled dsk2nib, so an error would have to be a matching pair.
{
  const dsk = path.join(H.ROOT, 'examples', 'rise-out.dsk');
  if (fs.existsSync(dsk)) {
    const s = sniffImage(dsk);
    const media = A.mount(s);
    let short = 0, wrong = 0;
    for (let t = 0; t < media.tracks; t++) {
      const got = A.gcr140.denibblizeTrack(media.bytes, media.trackBase(t),
                                           media.trackLen[t], t, s.prodos);
      if (got.got !== 16) { short++; continue; }
      for (let i = 0; i < 4096; i++) {
        if (got.bytes[i] !== s.payload[t * 4096 + i]) wrong++;
      }
    }
    eq('gcr140 round trip over 35 tracks', [short, wrong], [0, 0]);
  } else {
    console.log('skip: gcr140 round trip (no examples/rise-out.dsk)');
  }
}

// A data field that has been damaged is not a data field. Both refusals matter:
// a wrong sector quietly written into a saved .dsk is worse than a save that
// falls back to the nibble stream.
{
  const src = new ctx.Uint8Array(256);
  for (let i = 0; i < 256; i++) src[i] = (i * 11 + 5) & 0xff;
  const field = new ctx.Uint8Array(0x157);
  A.gcr140.code62(src, 0, field, 0);
  const out = new ctx.Uint8Array(256);
  eq('decode62 inverts code62', [A.gcr140.decode62(field, 0, out, 0),
                                 Buffer.compare(Buffer.from(out), Buffer.from(src))],
     [true, 0]);

  const bad = new ctx.Uint8Array(field);
  bad[0x156] = A.gcr140.CODE[(A.gcr140.DECODE[bad[0x156]] + 1) & 0x3f];
  eq('decode62 refuses a wrong checksum', A.gcr140.decode62(bad, 0, out, 0), false);

  const junk = new ctx.Uint8Array(field);
  junk[100] = 0x55;                          // never a disk byte
  eq('decode62 refuses a byte no disk carries',
     A.gcr140.decode62(junk, 0, out, 0), false);
}

// --- writing a 140K disk ----------------------------------------------------
// Through the register file, the way DOS does it: latch a byte into $C0ED and
// shift it out with $C0EC. What comes back is checked by denibblizing the track
// the drive wrote, so the read path, the write path and both codecs have to
// agree before this passes.
//
// A function rather than a block, and run at the end alongside the container
// tests: it saves what it wrote through `build`, and writing a container is a
// promise because compressing a payload is one.
async function diskWriteTests() {
  const dsk = path.join(H.ROOT, 'examples', 'rise-out.dsk');
  if (fs.existsSync(dsk)) {
    const s = await H.sniffFile(ctx, dsk);
    const media = A.mount(s);
    const card = new A.Disk140({});
    card.insert(media);
    eq('a disk arrives locked whatever it said', media.writeProtect, true);

    let now = 0;
    // One byte of track per call: spin() hands over one per 32 cycles, and
    // readData gives it up exactly once.
    const next = () => { now += A.Disk140.CYCLES_PER_BYTE; return card.read(0xc, now); };
    const shift = (b) => {
      now += A.Disk140.CYCLES_PER_BYTE;
      card.write(0xd, b, now);                 // STA $C08D,X
      card.read(0xc, now);                     // ORA $C08C,X
    };

    card.access(0x9, now);                     // $C0E9, motor on
    const before = new ctx.Uint8Array(media.bytes);
    card.read(0xf, now);                       // $C0EF, write mode
    for (let i = 0; i < 32; i++) shift(0x96);
    eq('a locked disk takes no writes',
       Buffer.compare(Buffer.from(media.bytes), Buffer.from(before)), 0);
    card.read(0xe, now);                       // $C0EE, back to reading

    media.locked = false;
    eq('unlocking clears the bit software reads',
       card.read(0xe, now) & 0x80, 0);

    // The head starts on track 10. Wind round to the data field of the sector
    // DOS calls 9, which is where file sector 3 was nibblized to.
    const want = A.gcr140.REN1[3];
    const win = [0, 0, 0];
    let addr = -1, found = false;
    for (let i = 0; i < media.stride * 2 && !found; i++) {
      win.shift(); win.push(next());
      if (win[0] === 0xd5 && win[1] === 0xaa && win[2] === 0x96) {
        const f = [];
        for (let j = 0; j < 8; j++) f.push(next());
        addr = A.gcr140.decode44(f[4], f[5]);
      } else if (addr === want && win[0] === 0xd5 && win[1] === 0xaa && win[2] === 0xad) {
        found = true;
      }
    }
    eq('wound to a data field on track 10', [found, card.track], [true, 10]);

    const wrote = new ctx.Uint8Array(256);
    for (let i = 0; i < 256; i++) wrote[i] = (i * 3 + 17) & 0xff;
    const field = new ctx.Uint8Array(0x157);
    A.gcr140.code62(wrote, 0, field, 0);
    card.read(0xf, now);                       // $C0EF, write mode
    for (let i = 0; i < field.length; i++) shift(field[i]);
    card.read(0xe, now);

    eq('the track is marked written', [media.written[10], media.isWritten()], [1, true]);
    const got = A.gcr140.denibblizeTrack(media.bytes, media.trackBase(10),
                                         media.trackLen[10], 10, s.prodos);
    eq('the written sector reads back', [got.got,
        Buffer.compare(Buffer.from(got.bytes.subarray(3 * 256, 4 * 256)),
                       Buffer.from(wrote))], [16, 0]);
    // Everything else on the track is where it was.
    let elsewhere = 0;
    for (let k = 0; k < 16; k++) {
      if (k === 3) continue;
      for (let i = 0; i < 256; i++) {
        if (got.bytes[k * 256 + i] !== s.payload[10 * 4096 + k * 256 + i]) elsewhere++;
      }
    }
    eq('the other 15 sectors are untouched', elsewhere, 0);

    // And out through the saving path, with no App around it: writeBack reads
    // the sources it is given and the card's media, and nothing else.
    const app = {
      sources: { 6: { name: 'rise-out.dsk', bytes: s.payload, patches: [],
                      kind: 'dsk140', offset: 0, prodos: s.prodos } },
      machine: { cards: { 6: card } },
    };
    const back = A.App.prototype.writeBack.call(app, 6);
    const want256 = new ctx.Uint8Array(s.payload);
    want256.set(wrote, 10 * 4096 + 3 * 256);
    eq('writeBack patches say what changed',
       [back.name, back.patches.length,
        Buffer.compare(Buffer.from(A.agc.applyPatches(back.bytes, back.patches)),
                       Buffer.from(want256))],
       ['rise-out.dsk', 1, 0]);
    eq('writeBack leaves the source alone, so saving twice is the same file',
       [app.sources[6].patches.length,
        JSON.stringify(A.App.prototype.writeBack.call(app, 6).patches) ===
        JSON.stringify(back.patches)],
       [0, true]);

    // Out through the container and back in, which is the whole of what the
    // Save button does. The sector this wrote is 256 bytes of a pattern that
    // gzip cannot help, so the patch stays base64 — while the disk it is a
    // patch to compresses, which is why the file is a fraction of the size of
    // the disk it carries.
    const file = await A.agc.build({ media: [{ name: back.name, bytes: back.bytes,
                                               patches: back.patches }] });
    const re = await A.agc.parse(Buffer.from(file, 'utf8'), 'rise-out.agc');
    eq('a saved container reopens with the write in it',
       [Object.keys(JSON.parse(file).media[0].patches[0]).join('+'),
        Buffer.compare(Buffer.from(re.media[0].payload), Buffer.from(want256))],
       ['at+data', 0]);
    eq('and is smaller than the disk it carries', file.length < s.payload.length,
       true);

    // A track that will not decode has no sector image to be a patch against.
    // One data-field prologue struck out is enough to lose that sector.
    const t10 = media.trackBase(10);
    for (let i = 0; i < media.stride; i++) {
      if (media.bytes[t10 + i] === 0xd5 && media.bytes[t10 + i + 1] === 0xaa &&
          media.bytes[t10 + i + 2] === 0xad) { media.bytes[t10 + i + 2] = 0x96; break; }
    }
    const fell = A.App.prototype.writeBack.call(app, 6);
    eq('an undecodable track saves as nibbles instead',
       [fell.name, fell.bytes.length, fell.patches.length],
       ['rise-out.nib', 35 * 6656, 0]);
  } else {
    console.log('skip: 140K writing (no examples/rise-out.dsk)');
  }
}

// --- writing an 840K disk ---------------------------------------------------
// Through the register file, the way the factory driver does it (TESTCOM7's
// НГМД test, $DE5E-$DEFD): port C bit 6 up, bytes into +5 as +6 says the
// register is free, the sync strobe at +8 straight after the $FF. What comes
// back is checked by desectorizing the track, so the read path, the write path
// and both codecs have to agree before this passes — and the marks have to be
// where the boot ROM's read loop discards them.
//
// The three sources come out of one bundled .aim: a .dsk and a .nib are built
// from its sectors, so all three write-back branches are covered by one file.
async function disk840WriteTests() {
  const agc = path.join(H.ROOT, 'examples', 'Klondike.agc');
  if (!fs.existsSync(agc)) { console.log('skip: 840K writing (no examples/Klondike.agc)'); return; }
  const c = await A.agc.parse(new ctx.Uint8Array(fs.readFileSync(agc)), 'Klondike.agc');
  const aimSrc = A.sniff(c.media[0].payload, 'Klondike.aim');
  const aim = A.aim840;
  eq('the bundled Klondike is an .aim', aimSrc.kind, 'aim840');

  // The sector image behind the stream, and the .nib laid out from it.
  const whole = A.mount(aimSrc);
  const dsk = new ctx.Uint8Array(aim.TRACKS * aim.SECTORS * aim.SECSIZE);
  const nib = new ctx.Uint8Array(aim.TRACKS * aim.SECTORS * aim.NIB_RECORD);
  let short = 0;
  for (let t = 0; t < aim.TRACKS; t++) {
    const got = aim.desectorizeTrack(whole.bytes, whole.attrs, whole.trackBase(t),
                                     whole.trackLen[t], t);
    if (got.got !== aim.SECTORS) short++;
    dsk.set(got.bytes, t * aim.SECTORS * aim.SECSIZE);
    for (let sec = 0; sec < aim.SECTORS; sec++) {
      aim.nibRecord(t, sec, got.bytes.subarray(sec * 256, (sec + 1) * 256), nib,
                    (t * aim.SECTORS + sec) * aim.NIB_RECORD);
    }
  }
  eq('desectorizeTrack reads all 160 tracks of a real .aim', short, 0);
  eq('toAim gives a real .aim back byte for byte',
     Buffer.compare(Buffer.from(aim.toAim(whole)), Buffer.from(aimSrc.payload)), 0);
  const dskSrc = A.sniff(dsk, 'Klondike.dsk'), nibSrc = A.sniff(nib, 'Klondike.nib');
  eq('the built images sniff as dsk840 and nib840', [dskSrc.kind, nibSrc.kind], ['dsk840', 'nib840']);
  {
    // A synthesised stream reads back to the sectors it was built from, both ways.
    let wrong = 0;
    for (const src of [dskSrc, nibSrc]) {
      const m = A.mount(src);
      eq('a synthesised ' + src.kind + ' track is one revolution in the .aim slot', [m.stride, m.trackLen[0]], [aim.AIM_TRACK, aim.PHYS_TRACK]);
      for (let t = 0; t < aim.TRACKS; t += 37) {
        const got = aim.desectorizeTrack(m.bytes, m.attrs, m.trackBase(t), m.trackLen[t], t);
        if (got.got !== aim.SECTORS) wrong++;
        for (let i = 0; i < got.bytes.length; i++) {
          if (got.bytes[i] !== dsk[t * aim.SECTORS * aim.SECSIZE + i]) { wrong++; break; }
        }
      }
    }
    eq('dsk840 and nib840 streams desectorize to their sectors', wrong, 0);
  }

  // One sector rewritten through the controller, per source kind.
  const T = 10, SEC = 7;
  const wrote = new ctx.Uint8Array(256);
  for (let i = 0; i < 256; i++) wrote[i] = (i * 5 + 3) & 0xff;
  const cs = aim.checksum(wrote, 0);
  const CPB = A.Disk840.CYCLES_PER_BYTE;

  const rewrite = (src) => {
    const media = A.mount(src);
    const card = new A.Disk840({});
    card.insert(media);
    let now = 1000;
    const rd = (r) => card.read(r, now);
    const wr = (r, v) => card.write(r, v, now);
    // Poll like the ROM's LDA/BPL, seven cycles a look, so a byte is taken
    // within a few cycles of arriving — the driver's write of the next byte
    // 25 cycles later has to come before the boundary after it.
    const POLL = 7;
    const untilReady = () => { let n = 0; while (!(rd(6) & 0x80)) { now += POLL; if (++n > 100000) throw new Error('never ready'); } };
    const untilSync = () => { let n = 0; while (rd(6) & 0x40) { now += POLL; if (++n > 100000) throw new Error('no sync'); } };
    const next = () => { untilReady(); return rd(4); };

    wr(3, 0x0f);                          // motor on (port C bit 7 set)
    for (let i = 0; i < T / 2; i++) { wr(3, 0x05); wr(9, 0); }   // step in 5 cylinders
    eq('stepped to track 10', card.track, T);
    const before = new ctx.Uint8Array(media.bytes), beforeA = new ctx.Uint8Array(media.attrs);

    // Locked: the status says so, and the write register drops the byte.
    eq('a locked 840K disk answers status bit 5 clear', rd(1) & 0x20, 0);
    wr(3, 0x0d);                          // write mode
    wr(5, 0x96); now += CPB * 4; rd(6);
    wr(3, 0x0c);                          // read mode
    eq('a locked 840K disk takes no writes',
       Buffer.compare(Buffer.from(media.bytes), Buffer.from(before)), 0);
    media.locked = false;
    eq('unlocked, status bit 5 is set', rd(1) & 0x20, 0x20);

    // Find sector SEC's address field the ROM's way: strobe +A, wait for the
    // mark, discard the marked byte, then 95 6A vol trk sec 5A.
    let found = false, guard = 0;
    while (!found && guard++ < 200) {
      wr(0xa, 0); untilSync(); next();
      if (next() !== 0x95 || next() !== 0x6a) continue;
      next();                                        // volume
      const trk = next(), sec = next(), tail = next();
      if (trk === T && sec === SEC && tail === 0x5a) found = true;
    }
    eq('wound to the address field of T10 S7', found, true);
    const p5a = card.pos;

    // The driver's sequence, $DE5E: write mode, an AA at once, four more on
    // ready, then the data field with the strobe on the $FF.
    now += 25;                                       // the driver's few cycles
    wr(3, 0x0d);
    wr(5, 0xaa);
    for (let i = 0; i < 4; i++) { untilReady(); wr(5, 0xaa); }
    untilReady(); wr(5, 0xa4);
    untilReady(); wr(5, 0xff); wr(8, 0xff);
    for (const b of [0x6a, 0x95]) { untilReady(); wr(5, b); }
    for (let i = 0; i < 256; i++) { untilReady(); wr(5, wrote[i]); }
    for (const b of [cs, 0x5a, 0xaa]) { untilReady(); wr(5, b); }
    untilReady();
    wr(3, 0x0c);

    eq('the track is marked written', [media.written[T], media.isWritten()], [1, true]);
    const base = media.trackBase(T), len = media.trackLen[T];
    const at = (k) => base + ((p5a + k) % len);
    eq('the first byte lands behind the 5A, not on it',
       [media.bytes[at(0)], media.bytes[at(1)]], [0x5a, 0xaa]);
    eq('the mark is on the FF before 6A 95, and nowhere else in the field',
       [media.attrs[at(7)], media.bytes[at(7)], media.bytes[at(8)], media.bytes[at(9)],
        media.attrs.subarray(at(1), at(7)).some((a) => a & 0x81),
        media.attrs.subarray(at(8), at(8) + 260).some((a) => a & 0x81)],
       [1, 0xff, 0x6a, 0x95, false, false]);
    const got = aim.desectorizeTrack(media.bytes, media.attrs, base, len, T);
    eq('the written sector reads back', [got.got,
        Buffer.compare(Buffer.from(got.bytes.subarray(SEC * 256, (SEC + 1) * 256)),
                       Buffer.from(wrote))], [21, 0]);
    let elsewhere = 0;
    for (let k = 0; k < 21; k++) {
      if (k === SEC) continue;
      for (let i = 0; i < 256; i++) {
        if (got.bytes[k * 256 + i] !== dsk[(T * 21 + k) * 256 + i]) elsewhere++;
      }
    }
    eq('the other 20 sectors are untouched', elsewhere, 0);
    return { media, card, before, beforeA };
  };

  const want = new ctx.Uint8Array(dsk);
  want.set(wrote, (T * 21 + SEC) * 256);

  // dsk840: patches against the sector image.
  {
    const { media, card } = rewrite(dskSrc);
    const app = { sources: { 5: { name: 'Klondike.dsk', bytes: dsk, patches: [], kind: 'dsk840', offset: 0 } },
                  machine: { cards: { 5: card } } };
    const back = A.App.prototype.writeBack.call(app, 5);
    eq('dsk840 writeBack patches say what changed',
       [back.name, back.patches.length,
        Buffer.compare(Buffer.from(A.agc.applyPatches(back.bytes, back.patches)), Buffer.from(want))],
       ['Klondike.dsk', 1, 0]);
    eq('dsk840 writeBack leaves the source alone',
       [app.sources[5].patches.length,
        JSON.stringify(A.App.prototype.writeBack.call(app, 5).patches) === JSON.stringify(back.patches)],
       [0, true]);
    const file = await A.agc.build({ media: [{ name: back.name, bytes: back.bytes, patches: back.patches }] });
    const re = await A.agc.parse(Buffer.from(file, 'utf8'), 'Klondike.agc');
    eq('a saved 840K container reopens with the write in it',
       Buffer.compare(Buffer.from(re.media[0].payload), Buffer.from(want)), 0);
    // Strike out a mark and the track no longer decodes: the stream is saved.
    const base = media.trackBase(T);
    for (let i = 0; i < media.stride; i++) {
      if ((media.attrs[base + i] & 0x81) && media.bytes[base + i + 1] === 0x6a) { media.attrs[base + i] = 0; break; }
    }
    const fell = A.App.prototype.writeBack.call(app, 5);
    eq('an undecodable 840K track saves as .aim instead',
       [fell.name, fell.bytes.length, fell.patches.length], ['Klondike.aim', 2068480, 0]);
  }
  // nib840: the records rebuilt from the sectors.
  {
    const { card } = rewrite(nibSrc);
    const app = { sources: { 5: { name: 'Klondike.nib', bytes: nib, patches: [], kind: 'nib840', offset: 0 } },
                  machine: { cards: { 5: card } } };
    const back = A.App.prototype.writeBack.call(app, 5);
    const out = A.agc.applyPatches(back.bytes, back.patches);
    const rec = (T * 21 + SEC) * aim.NIB_RECORD;
    let others = 0;
    for (let i = 0; i < nib.length; i++) {
      if (i >= rec && i < rec + aim.NIB_RECORD) continue;
      if (out[i] !== nib[i]) others++;
    }
    eq('nib840 writeBack rewrites the one record',
       [back.name, others, Buffer.compare(Buffer.from(out.subarray(rec + 24, rec + 24 + 256)), Buffer.from(wrote)),
        out[rec + 24 + 256], out[rec + 24 + 257]],
       ['Klondike.nib', 0, 0, cs, 0x5a]);
  }
  // aim840: the stream itself, as patches.
  {
    const { card, media } = rewrite(aimSrc);
    const app = { sources: { 5: { name: 'Klondike.aim', bytes: aimSrc.payload, patches: [], kind: 'aim840', offset: 0 } },
                  machine: { cards: { 5: card } } };
    const back = A.App.prototype.writeBack.call(app, 5);
    const out = A.agc.applyPatches(back.bytes, back.patches);
    const re = A.mount(A.sniff(out, 'Klondike.aim'));
    const got = aim.desectorizeTrack(re.bytes, re.attrs, re.trackBase(T), re.trackLen[T], T);
    let span = 0;
    for (const p of back.patches) span += p.bytes.length;
    eq('aim840 writeBack patches the stream and it reloads with the sector',
       [back.name, back.patches.length > 0, span < 2 * 300 * 2, got.got,
        Buffer.compare(Buffer.from(got.bytes.subarray(SEC * 256, (SEC + 1) * 256)), Buffer.from(wrote))],
       ['Klondike.aim', true, true, 21, 0]);
    eq('the other 159 tracks of the .aim are as they were',
       Buffer.compare(Buffer.from(out.subarray(0, T * 6464 * 2)), Buffer.from(aimSrc.payload.subarray(0, T * 6464 * 2))), 0);
  }
}

// --- the drive lamps --------------------------------------------------------
// 0 dark, 1 spinning, 2 transferring. The distinction that matters is the last
// one: the boot loops poll the data register several times for every byte the
// disk has actually turned far enough to give, so a poll must not light it.
{
  const blank = (kind, stride, tracks) => new A.Media({
    kind, stride, tracks,
    bytes: new ctx.Uint8Array(stride * tracks),
    attrs: new ctx.Uint8Array(stride * tracks),
  });

  {
    const W = Math.ceil(A.Disk840.LAMP_BUSY);
    const c = new A.Disk840({});
    eq('840 lamp dark with no disk', c.lamp(0), 0);
    c.insert(blank('aim840', 6464, 160));
    eq('840 lamp dark with the motor off', c.lamp(0), 0);
    c.control(0x0f);                          // 8255 bit set/reset: port C7 = 1
    eq('840 lamp spins with the motor on', c.lamp(0), 1);
    const T = 100000;
    c.read(4, T);                             // the register that hands a byte over
    eq('840 lamp over a transfer',
       [c.lamp(T), c.lamp(T + W - 1), c.lamp(T + W)], [2, 2, 1]);
    c.control(0x0e);
    eq('840 lamp dark again when the motor drops', c.lamp(T), 0);
  }

  // The 840K byte clock keeps its phase however often the CPU looks. Polled
  // every 50 cycles — slower than a byte time — the disk still turns 6250
  // bytes in the 200 ms of one revolution, which is what TESTKOM9's speed
  // check measures between index pulses; a clock restarted from each poll
  // would turn one byte per poll and read half again too slow.
  {
    const c = new A.Disk840({});
    const media = blank('aim840', 6464, 160);
    for (let t = 0; t < 160; t++) media.trackLen[t] = 6250;
    c.insert(media);
    c.control(0x0f);
    const REV = Math.round(6250 * A.Disk840.CYCLES_PER_BYTE);
    let now = 1000, seen = 0;
    c.read(6, now);                           // the clock starts here
    let last = c.pos;
    while (now < 1000 + 4 * REV) { c.read(6, now); if (c.pos !== last) { seen += (c.pos - last + 6250) % 6250; last = c.pos; } now += 50; }
    eq('840K turns 6250 bytes a revolution under a slow poll',
       Math.abs(seen - 4 * 6250) <= 8, true);
    // And the index: 128 bytes of a track without a mark, 4 ms of the turn.
    let low = 0;
    for (let i = 0; i < 6250; i++) { c.read(6, now); if (!(c.read(1, now) & 0x10)) low++; now += A.Disk840.CYCLES_PER_BYTE; }
    eq('840K index is 128 bytes of an unmarked track', low, 128);
  }

  {
    const W = Math.ceil(A.Disk140.LAMP_BUSY);
    const c = new A.Disk140({});
    eq('140 lamp dark with no disk', c.lamp(0), 0);
    c.insert(blank('nib140', 6656, 35));
    eq('140 lamp dark with the motor off', c.lamp(0), 0);
    c.access(0x9, 0);                         // $C0E9, motor on
    eq('140 lamp spins with the motor on', c.lamp(0), 1);
    const T = 100000;
    c.read(0xc, T);                           // the disk has not turned yet
    eq('140 lamp is not lit by a poll', c.lamp(T), 1);
    c.read(0xc, T + 64);                      // two byte-times on, a byte lands
    eq('140 lamp over a transfer',
       [c.lamp(T + 64), c.lamp(T + 64 + W - 1), c.lamp(T + 64 + W)], [2, 2, 1]);
    c.read(0xc, T + 64);                      // same instant: nothing new to give
    eq('140 lamp is not held up by a poll', c.lamp(T + 64 + W), 1);
  }
}

// --- undocumented opcodes ---------------------------------------------------
// The Klaus Dormann test covers the official set and says nothing about either
// the undocumented opcodes or anyone's cycle counts. Both matter here: the
// sub-frame interrupt is the Agat's music clock, so an instruction that is a
// few cycles cheap shifts pitch and tempo.
//
// Counted against agat-emulator's own table (cpu/cpu6502.c, from
// oxyron.de/html/opcodes02.html), which carries all 105 of them. The
// read-modify-write group takes the legal read-modify-write counts and pays no
// page-cross penalty: the extra fetch happens whether or not the index carried.
{
  const step = (bytes, setup) => {
    const ram = new Uint8Array(0x10000);
    const cpu = new A.CPU({
      read: (a) => ram[a & 0xffff],
      write: (a, v) => { ram[a & 0xffff] = v & 0xff; },
    });
    ram[0xfffc] = 0x00; ram[0xfffd] = 0x02;
    cpu.reset();
    bytes.forEach((b, i) => { ram[0x0200 + i] = b; });
    if (setup) setup(cpu, ram);
    const c0 = cpu.cycles;
    cpu.step();
    return { cycles: cpu.cycles - c0, cpu: cpu, ram: ram };
  };

  // Every JAM, and only those, stops the CPU. A hole here is an opcode that
  // silently does nothing instead of the undocumented thing a game wanted.
  {
    const jam = [];
    for (let op = 0; op < 256; op++) if (step([op, 0x10, 0x03]).cpu.halted) jam.push(op);
    eq('exactly the twelve JAM opcodes halt', jam.map(hex),
       [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2].map(hex));
  }

  // The read-modify-write six, across all seven of their addressing modes.
  {
    const want = { 0x03: 8, 0x07: 5, 0x0f: 6, 0x13: 8, 0x17: 6, 0x1b: 7, 0x1f: 7 };
    const bad = [];
    for (const base of [0x00, 0x20, 0x40, 0x60, 0xc0, 0xe0]) {
      for (const off in want) {
        const op = base | Number(off);
        const got = step([op, 0x10, 0x03]).cycles;
        if (got !== want[off]) bad.push(hex(op) + ' ' + got + '!=' + want[off]);
      }
    }
    eq('SLO RLA SRE RRA DCP ISC cycle counts', bad, []);
  }

  // The rest, mode by mode, so a wrong addressing mode shows up as a wrong count.
  {
    const bad = [], want = {
      0xa7: 3, 0xb7: 4, 0xaf: 4, 0xbf: 4, 0xa3: 6, 0xb3: 5, 0xab: 2,   // LAX
      0x87: 3, 0x97: 4, 0x8f: 4, 0x83: 6,                              // SAX
      0x0b: 2, 0x2b: 2, 0x4b: 2, 0x6b: 2, 0xcb: 2, 0x8b: 2,            // ANC ALR ARR SBX XAA
      0x9b: 5, 0x9c: 5, 0x9e: 5, 0x9f: 5, 0x93: 6, 0xbb: 4,            // TAS SHY SHX AHX LAS
      0x1a: 2, 0x80: 2, 0x04: 3, 0x14: 4, 0x0c: 4, 0x1c: 4,            // the NOPs
    };
    for (const op in want) {
      const got = step([Number(op), 0x10, 0x03]).cycles;
      if (got !== want[op]) bad.push(hex(Number(op)) + ' ' + got + '!=' + want[op]);
    }
    eq('the remaining undocumented cycle counts', bad, []);
  }

  // And that a couple of them actually do the undocumented thing.
  {
    const r = step([0xa7, 0x40], (c, ram) => { ram[0x40] = 0x7f; });
    eq('LAX $40 loads A and X', [r.cpu.a, r.cpu.x], [0x7f, 0x7f]);
    const s = step([0x87, 0x40], (c) => { c.a = 0xf0; c.x = 0x3c; });
    eq('SAX $40 stores A & X', s.ram[0x40], 0x30);
    const t = step([0xcb, 0x10], (c) => { c.a = 0xf0; c.x = 0x3c; });
    eq('SBX #$10 puts (A & X) - imm in X', t.cpu.x, 0x20);
  }
}

// --- the keyboard, and the two boards that draw it --------------------------
// The АГАТ board is a transcription of a photograph, and a transcription is
// exactly the kind of thing that is wrong in one place and looks right. These
// check it against the shipped scancode table rather than against the eye: a
// cap that carries a code nothing sends, or a code with no cap, fails here.
{
  const K = A.keyboard, V = A.keyview;

  // The split of decode() into a pure lookup has to change nothing.
  {
    const back = {};
    for (const name in K.SCAN) back[K.SCAN[name]] = name;
    let same = true;
    for (let layout = 0; layout < 2; layout++) {
      for (const scan in back) {
        for (const mod of [0, 1, 2]) {
          const e = { code: back[scan], shiftKey: mod === 1, ctrlKey: mod === 2 };
          if (K.decode(e, layout) !== K.codeFor(Number(scan), layout, mod)) same = false;
        }
      }
    }
    eq('codeFor and decode agree everywhere', same, true);
  }

  // Which host keys reach a code. The three below are the ones worth pinning:
  // Ч and Ю are unreachable in ЛАТ, and ¤ needs a shift the cap does not show.
  const names = (c) => K.routesTo(c).map(K.routeName).join(', ');
  eq('Ч ($5E) comes from РУС X', names(0x5e),
     'ЛАТ Shift+6, ЛАТ Shift+`, РУС X, РУС Shift+`');
  eq('Ю ($40) comes from РУС .', names(0x40), 'ЛАТ `, ЛАТ Shift+2, РУС `, РУС .');
  eq('¤ ($24) comes from ЛАТ Shift+4', names(0x24), 'ЛАТ Shift+4');
  {
    const stranded = [];
    for (let c = 0x20; c < 0x80; c++) if (!K.routesTo(c).length) stranded.push(hex(c));
    eq('every printable code has some host key', stranded, []);
  }

  // Every legend on the АГАТ board, and every code any plane can produce.
  const caps = new Set();
  let letters = 0, badLetter = 0;
  for (const rows of [V.AGAT_MAIN, V.AGAT_PAD]) {
    for (const r of rows) {
      for (const d of r.keys) {
        for (const k of ['u', 's', 'code']) {
          if (d[k] !== undefined) caps.add(d[k] & 0x7f);
        }
        // A letter cap's two legends are one byte in two character sets, and
        // РЕГ moves between them by exactly $20. That is what lets both fit.
        if (d.u >= 0x40 && d.u <= 0x5f && d.s !== undefined) {
          letters++;
          if (d.s !== d.u + 0x20) badLetter++;
        }
      }
    }
  }
  eq('the letter block is all 32 caps', letters, 32);
  eq('every letter cap is shifted by $20', badLetter, 0);

  const produced = new Set();
  for (let layout = 0; layout < 2; layout++) {
    for (let mod = 0; mod < 4; mod++) {
      for (let scan = 0; scan < 128; scan++) {
        const v = K.KEYMAP[((layout * 4 + mod) << 7) | scan];
        if (v && K.routesTo(v).length) produced.add(v & 0x7f);
      }
    }
  }
  const orphan = [...produced].filter((c) => !caps.has(c) && !caps.has(V.capCode(c)));
  eq('every code a host key sends lands on a cap', orphan.map(hex), []);
  const unsent = [...caps].filter((c) => !K.routesTo(c).length);
  eq('every АГАТ cap is reachable from the host', unsent.map(hex), []);

  // Caps drawn dead really are dead: ПВТ and the pad's `=` are painted on the
  // machine and send nothing the shipped table carries. РЕД is not one of them —
  // it is the machine's Esc, $9B.
  let dead = 0, wrongDead = 0;
  for (const rows of [V.AGAT_MAIN, V.AGAT_PAD]) {
    for (const r of rows) {
      for (const d of r.keys) {
        if (d.act !== 'none') continue;
        dead++;
        if (d.u !== undefined || d.code !== undefined) wrongDead++;
      }
    }
  }
  eq('two caps send nothing', dead, 2);
  eq('no dead cap secretly carries a code', wrongDead, 0);

  // The PC board is the other half of the answer, so it has to be all of it.
  const drawn = new Set();
  let twice = 0;
  for (const rows of [V.PC_MAIN, V.PC_NAV, V.PC_PAD]) {
    for (const r of rows) {
      for (const d of r.keys) {
        if (d.scan === undefined) continue;
        const key = d.scan + (d.ext ? 256 : 0);
        if (drawn.has(key)) twice++;
        drawn.add(key);
      }
    }
  }
  const want = new Set();
  for (const n in K.SCAN) want.add(K.SCAN[n]);
  for (const n in K.EXT_SCAN) want.add(K.EXT_SCAN[n] + 256);
  eq('the PC board draws no key twice', twice, 0);
  eq('the PC board draws every mapped scancode',
     [...want].filter((s) => !drawn.has(s)).map(hex), []);
  eq('the PC board draws nothing the table does not map',
     [...drawn].filter((s) => !want.has(s)).map(hex), []);
}

// --- the `keys` reference table in the docs ---------------------------------
// AGC.md lists every name `keys` accepts and what each sends when it is not
// remapped. A hundred rows of transcription is exactly the kind of thing that
// rots quietly, so read them back and put every cell through resolveCode — the
// same reader a container's own codes go through — against the shipped table.
{
  const K = A.keyboard;
  const docs = ['AGC.md'].map(
    (f) => [f, fs.readFileSync(path.join(H.ROOT, f), 'utf8')]);

  // The four-plane tables put one key on a row and four cells after it; the
  // tables for keys that send one code whatever the layout put two keys on a
  // row to keep them short. Both start with a name in backticks, and only the
  // cell after a name is read: what a row says about РУС is a layout this
  // cannot see from here.
  const isKey = (s) => /^`\w+`$/.test(s) &&
                       (s.slice(1, -1) in K.SCAN || s.slice(1, -1) in K.EXT_SCAN);
  function rows(text) {
    const out = new Map();
    for (const line of text.split('\n')) {
      if (line.slice(0, 1) !== '|') continue;
      const cells = line.split('|').slice(1, -1).map((s) => s.trim());
      for (let i = 0; i < cells.length - 1; i++) {
        if (isKey(cells[i])) out.set(cells[i].slice(1, -1), cells[i + 1]);
      }
    }
    return out;
  }
  // A cell names the code and then gives it — `Q $51`, `Esc $9B` — so the code
  // is the last word. `—` for a key the table maps nowhere.
  const cell = (v) => v.split(/\s+/).pop().replace(/`/g, '');

  const named = docs.map(([f, text]) => [f, rows(text)]);
  eq('every key the tables map is listed',
     [...Object.keys(K.SCAN), ...Object.keys(K.EXT_SCAN)]
       .filter((k) => !named[0][1].has(k)), []);

  for (const [file, table] of named) {
    const wrong = [];
    for (const [name, text] of table) {
      const ext = name in K.EXT_SCAN;
      const scan = ext ? K.EXT_SCAN[name] : K.SCAN[name];
      const raw = K.KEYMAP[((K.LAT * 4 + (ext ? K.EXT : K.NORMAL)) << 7) | scan];
      const c = cell(text);
      const got = c === '—' ? 0 : K.resolveCode(c);
      // Bit 7, which codeFor sets on everything on its way to $C000, is what
      // two spellings of one code are allowed to differ in: Backquote's `@` is
      // $C0 in the shipped table and Digit2's is $40, and they are the same key.
      if ((got | 0x80) !== (raw | 0x80)) wrong.push(name + ' says ' + c);
    }
    eq(file + ' says what the table sends', wrong, []);
  }
}

// --- .agc containers --------------------------------------------------------
// The format is the only thing here a person is expected to hand-edit, so what
// is pinned is what a hand-written file may rely on: the line shape, that a
// container round-trips, and that a patch is a diff rather than something baked
// into the payload.
async function agcTests() {
  const K = A.keyboard;
  const bytes = new ctx.Uint8Array(200);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
  const patch = (at, hex, extra) =>
    Object.assign({ at: at, bytes: A.agc.fromHex(hex) }, extra || {});
  // What a rejection said, or that there was not one. Every way a container can
  // be wrong arrives this way now: reading one is a promise, because a payload
  // may be gzipped.
  const why = async (p) => {
    try { await p; return 'no throw'; } catch (e) { return e.message; }
  };

  const lines = A.agc.encode64(bytes);
  eq('base64 wraps at the MIME width', lines.slice(0, -1).map((l) => l.length),
     [76, 76, 76]);
  eq('every base64 line is whole groups',
     lines.filter((l) => l.length % 4).length, 0);
  eq('base64 round-trips', [...A.agc.decode64(lines)], [...bytes]);
  eq('base64 reads back as one string too',
     [...A.agc.decode64(lines.join('\n'))], [...bytes]);

  const src = await A.agc.build({
    title: 'ИГРА', author: 'Кто-то', date: 'circa 1985', url: 'http://x/y',
    notes: 'n', model: 7, ram: 64,
    keys: { KeyW: { code: '^', hint: 'Shoot right' } },
    media: [{ name: 'x.dsk', bytes: bytes, patches: [patch(2, 'AA BB')] }],
  });
  const c = await A.agc.parse(Buffer.from(src, 'utf8'), 'x.agc');
  eq('a container round-trips',
     [c.title, c.author, c.date, c.url, c.notes, c.machine.model, c.machine.ram,
      c.keys.KeyW, c.media.length, c.media[0].name],
     ['ИГРА', 'Кто-то', 'circa 1985', 'http://x/y', 'n', 7, 64,
      { code: '^', hint: 'Shoot right' }, 1, 'x.dsk']);
  // A hint is shown and `notes` is not, so a container carrying both has to
  // come back carrying both: the fields say the same kind of thing to two
  // different readers.
  {
    const both = await A.agc.parse(Buffer.from(await A.agc.build({
      notes: 'from a 1989 tape', info: 'A platform game of 1989.',
      hint: 'Starts in РУС.', media: [],
    }), 'utf8'));
    eq('the record, the description and the hint are three fields',
       [both.notes, both.info, both.hint],
       ['from a 1989 tape', 'A platform game of 1989.', 'Starts in РУС.']);
    // `info` is the other shown field and takes the hint's rule with it.
    eq('an info collapses to one paragraph',
       (await A.agc.parse(Buffer.from(await A.agc.build({
         info: '  Written\n\n  in 1989 for the\tAgat-7. ', media: [],
       }), 'utf8'))).info,
       'Written in 1989 for the Agat-7.');
    eq('a container with no info says nothing',
       /"info"/.test(await A.agc.build({ media: [] })), false);
    // One paragraph of plain text: a hand-wrapped hint is one line on the page,
    // so it is one line in the container that was written from it.
    eq('a hint collapses to one line',
       (await A.agc.parse(Buffer.from(await A.agc.build({
         hint: '  Hold\n\n  РЕГ   at the title\tscreen. ', media: [],
       }), 'utf8'))).hint,
       'Hold РЕГ at the title screen.');
    eq('a container with no hint says nothing',
       /"hint"/.test(await A.agc.build({ media: [] })), false);
  }
  // A date is what is known, not a year: "circa 1985" has to survive.
  eq('a date stays as it was written',
     await Promise.all(['1989', 'circa 1985', '1990-92'].map(async (d) =>
       (await A.agc.parse(Buffer.from(await A.agc.build({ date: d, media: [] }),
                                      'utf8'))).date)),
     ['1989', 'circa 1985', '1990-92']);
  eq('the payload is what was packed', [...c.media[0].bytes], [...bytes]);
  eq('patches reach the image the machine runs',
     [c.media[0].payload[1], c.media[0].payload[2], c.media[0].payload[3],
      c.media[0].payload[4]],
     [bytes[1], 0xaa, 0xbb, bytes[4]]);
  eq('patching leaves the packed copy alone',
     [c.media[0].bytes[2], c.media[0].bytes[3]], [bytes[2], bytes[3]]);
  // Unprefixed, because `applyPatches` is also called on its own — by
  // `tools/mkagc.js` and by the Save button — where there is no container to
  // name. The container's own reader is what adds the name; see below.
  eq('a patch off the end is refused', (() => {
    try { A.agc.applyPatches(bytes, [patch(199, 'AABB')]); return 'no'; }
    catch (e) { return 'threw'; }
  })(), 'threw');

  // The three encodings a record may be written in. A hand-written file uses
  // hex; a rewritten sector arrives as base64 or gzipped, and all of them have
  // to mean the same thing. `decodeBytes` is what every payload and every patch
  // is read through, so this is that one place tested once.
  {
    const two = new ctx.Uint8Array([0xaa, 0xbb]);
    const b64 = A.agc.encode64(two);
    const gz = A.agc.encode64(await A.gzip(two));
    const read = async (rec) => [...await A.agc.decodeBytes(rec, 'patch at 2')];
    eq('hex, base64 and gz all say the same bytes',
       [await read({ hex: 'AA BB' }), await read({ data: b64 }),
        await read({ data: b64.join('\n') }), await read({ gz: gz })],
       [[0xaa, 0xbb], [0xaa, 0xbb], [0xaa, 0xbb], [0xaa, 0xbb]]);
    eq('a record that gives two encodings is refused',
       await why(A.agc.decodeBytes({ hex: 'AABB', data: b64 }, 'patch at 2')),
       'patch at 2 gives hex and data — a record carries one of them');
    eq('a record that gives none is refused',
       await why(A.agc.decodeBytes({}, 'patch at 2')),
       'patch at 2 gives none of hex, data or gz');
    eq('a gz field that is not gzip says so',
       await why(A.agc.decodeBytes({ gz: A.agc.encode64(bytes) }, 'patch at 2')),
       'patch at 2: the gz is not valid gzip');
  }

  // Which encoding the writer reaches for, which is the whole rule: hex while a
  // person can read the bytes, then whichever of the two base64 forms is
  // smaller by `GAIN`. Dense bytes do not clear that bar and empty ones clear
  // it by a mile, which is why a poke stays readable and a disk gets small.
  {
    const dense = (n) => bytes.slice(0, n);
    const empty = (n) => new ctx.Uint8Array(n);
    const pick = async (b, opts) =>
      Object.keys(await A.agc.encodeBytes(b, opts || { hex: true }))[0];
    eq('a patch that can be read stays hex', await pick(dense(32)), 'hex');
    eq('one byte more goes to base64', await pick(dense(33)), 'data');
    eq('a payload is never hex, however short', await pick(dense(32), {}), 'data');
    eq('bytes that gzip cannot help stay base64', await pick(dense(200)), 'data');
    eq('an empty sector is worth compressing', await pick(empty(256)), 'gz');
    eq('and so is a track of them', await pick(empty(4096)), 'gz');
    // The two overrides, which are `mkagc --plain` and `mkagc --gz`.
    eq('gz: false keeps a payload readable whatever it costs',
       await pick(empty(4096), { gz: false }), 'data');
    eq('gz: true compresses one that has not earned it',
       await pick(dense(200), { gz: true, hex: true }), 'gz');
  }

  // The differ says where the changes are and nothing about how they are
  // written: one encoder decides that, for a patch and a payload alike.
  {
    const changed = (n) => {
      const mod = new ctx.Uint8Array(bytes);
      for (let i = 0; i < n; i++) mod[10 + i] = ~bytes[10 + i] & 0xff;
      return mod;
    };
    const small = changed(32), big = changed(33);
    eq('the differ hands back bytes, not an encoding',
       A.agc.diff(bytes, small).map((p) => [p.at, [...p.bytes].length]),
       [[10, 32]]);
    eq('and says what changed', [
      [...A.agc.applyPatches(bytes, A.agc.diff(bytes, small))],
      [...A.agc.applyPatches(bytes, A.agc.diff(bytes, big))]],
      [[...small], [...big]]);
    const written = async (mod) => Object.keys(JSON.parse(await A.agc.build({
      media: [{ name: 'x.dsk', bytes: bytes, patches: A.agc.diff(bytes, mod) }],
    })).media[0].patches[0]).join('+');
    eq('a small change is written as hex and a bigger one as base64',
       [await written(small), await written(big)], ['at+hex', 'at+data']);
    eq('the writer wraps base64 to the width it is given',
       JSON.parse(await A.agc.build({ width: 8, media: [{ name: 'x', bytes: bytes }] }))
         .media[0].data.map((l) => l.length),
       [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
        8, 8, 8, 8, 8, 8, 8, 8, 8, 4]);
    eq('a base64 patch survives being written and read back', await (async () => {
      const file = await A.agc.build({ media: [{ name: 'x.dsk', bytes: bytes,
                                                 patches: A.agc.diff(bytes, big) }] });
      const m = (await A.agc.parse(Buffer.from(file, 'utf8'), 'x.agc')).media[0];
      return [[...m.bytes], [...m.payload]];
    })(), [[...bytes], [...big]]);
  }

  // Compression, end to end: what it costs and that it round-trips. A disk
  // image is mostly empty, which is the whole reason any of this pays.
  {
    const disk = new ctx.Uint8Array(4096);
    for (let i = 0; i < 512; i++) disk[i] = (i * 11) & 0xff;
    const file = await A.agc.build({ media: [{ name: 'x.dsk', bytes: disk }] });
    const back = await A.agc.parse(Buffer.from(file, 'utf8'), 'x.agc');
    eq('a compressible payload is written as gz', /"gz":/.test(file), true);
    eq('and reads back byte for byte', [...back.media[0].payload], [...disk]);
    eq('and is a fraction of the size',
       file.length < (await A.agc.build({ gz: false,
                                          media: [{ name: 'x.dsk', bytes: disk }] })
                     ).length / 4, true);
    // There is one version, and everything the writer can emit is in it:
    // whether a payload or a patch was compressed is visible in the field it
    // landed in, and nothing has to be told apart by number.
    const stamp = async (spec) => JSON.parse(await A.agc.build(spec)).agc;
    eq('every container is written as agc 1',
       [await stamp({ media: [] }),
        await stamp({ media: [{ name: 'x', bytes: bytes }] }),
        await stamp({ gz: false, media: [{ name: 'x', bytes: disk }] }),
        await stamp({ media: [{ name: 'x', bytes: disk }] }),
        await stamp({ media: [{ name: 'x', bytes: bytes,
                                patches: [{ at: 0, bytes: new ctx.Uint8Array(64) }] }] })],
       [1, 1, 1, 1, 1]);
    eq('and reads back as the version it was written as', back.version, 1);
  }

  // A container is hand-edited, so a reader that drops what it does not
  // understand will eventually eat somebody's note about a patch.
  {
    const file = await A.agc.build({
      media: [{ name: 'x.dsk', bytes: bytes,
                patches: [patch(2, 'AA BB', { note: 'the JMP that skips the check' })] }],
    });
    const rec = JSON.parse(file).media[0].patches[0];
    eq('an unknown key on a patch is kept, after the bytes',
       Object.keys(rec).join('+'), 'at+hex+note');
    const re = await A.agc.parse(Buffer.from(file, 'utf8'), 'x.agc');
    eq('and survives being read back', re.media[0].patches[0].note,
       'the JMP that skips the check');
    eq('a second save still carries it',
       JSON.parse(await A.agc.build({ media: re.media }))
         .media[0].patches[0].note, 'the JMP that skips the check');
  }

  // What a broken container says is the whole of what the page can show, so it
  // has to name the file to open and the entry inside it to look at. Written
  // out by hand rather than built, because a file that will not read is not one
  // the writer would have produced.
  {
    const broken = (m) => Buffer.from(JSON.stringify({ agc: 1, media: [m] }), 'utf8');
    const bad = (b) => why(A.agc.parse(b, 'RISE.agc'));
    eq('an entry that will not decode names the file and the entry',
       await bad(broken({ name: 'game.dsk', data: 'not base64!!' })),
       'RISE.agc: media 0 (game.dsk): the data is not valid base64');
    eq('a patch off the end names the file and the entry',
       await bad(broken({ name: 'side2.dsk', data: A.agc.encode64(bytes),
                          patches: [{ at: 199, hex: 'AABB' }] })),
       'RISE.agc: media 0 (side2.dsk): patch at 199 (2 bytes) falls outside a ' +
       '200-byte image');
    eq('a patch that will not decode names the file and the entry',
       await bad(broken({ name: 'side2.dsk', data: A.agc.encode64(bytes),
                          patches: [{ at: 4, data: 'not base64!!' }] })),
       'RISE.agc: media 0 (side2.dsk): patch at 4: the data is not valid base64');
    eq('an entry with nothing in it is named the same way',
       await bad(broken({ name: 'game.dsk' })),
       'RISE.agc: media 0 (game.dsk) has no data');
    eq('an unnamed entry is still placed by its number',
       await bad(broken({ data: 'not base64!!' })),
       'RISE.agc: media 0: the data is not valid base64');
  }

  eq('a disk is not a container', await A.agc.parse(bytes, 'x.dsk'), null);
  eq('other JSON is not a container',
     await A.agc.parse(Buffer.from('{"hello":1}', 'utf8'), 'x.json'), null);
  eq('a broken container says so rather than passing for a disk',
     await why(A.agc.parse(Buffer.from('{"agc": 1, ', 'utf8'), 'x.agc')) !== 'no throw',
     true);
  // The one thing the version is still for: a file this cannot read is refused
  // rather than read as far as it goes.
  eq('a container from a newer emulator is refused',
     await why(A.agc.parse(Buffer.from('{"agc": 2}', 'utf8'), 'next.agc')),
     'next.agc: made by a newer emulator (agc 2, this reads 1)');
  // The sniffer answers for every file dropped on the page and cannot wait for
  // a payload to inflate, so it asks the cheap question and the loader reads it.
  // The version key is conventionally first and only conventionally: a
  // hand-edited container that puts its media above it is still one.
  eq('the sniffer picks a container out without reading it',
     [A.sniff(Buffer.from(src, 'utf8'), 'x.agc').kind,
      A.sniff(bytes, 'x.dsk').kind === 'agc',
      A.sniff(Buffer.from('{ "media": [], "notes": "' + 'x'.repeat(8000) +
                          '", "agc": 1 }', 'utf8'), 'late.agc').kind],
     ['agc', false, 'agc']);

  // How a code may be written in `keys`. The character form is the one worth
  // having: `"^"` is what a game's instructions say, not `$5E`.
  eq('codes resolve from every form they may be written in',
     ['^', '$5E', '0x5e', 'Up', '↑', 'Ю', 'Space', 'nonsense']
       .map(K.resolveCode),
     [0x5e, 0x5e, 0x5e, 0x99, 0x99, 0x60, 0x20, -1]);
}

// --- the keyboard remap -----------------------------------------------------
// A container puts a code on a host key. The remap is a layer in front of the
// shipped table, not an edit to it, and it captures the key in every plane —
// so a movement key does not turn into something else under a held РЕГ.
{
  const K = A.keyboard;
  const names = (c) => K.routesTo(c).map(K.routeName).join(', ');

  const r = K.setRemap({ KeyW: '^', ArrowUp: 'Esc', KeyZZ: '^', KeyX: 'nope' });
  eq('setRemap names what it could not use', [r.ok, r.bad],
     [2, ['KeyZZ → ^', 'KeyX → nope']]);
  eq('a remapped key sends its code in every plane',
     [K.codeFor(0x11, 0, 0), K.codeFor(0x11, 1, 1), K.codeFor(0x11, 1, 2)],
     [0xde, 0xde, 0xde]);
  eq('its neighbours are untouched', K.codeFor(0x12, 0, 0), 0xc5);
  // Scancode $48 is Numpad8 and, with an E0 in front of it, ↑. Remapping one
  // must not take the other: they are the same number in different planes.
  eq('an ext remap captures only the ext plane',
     [K.codeFor(0x48, 0, 3), K.codeFor(0x48, 0, 0)], [0x9b, 0x91]);

  eq('the remapped key reaches its new code', names(0x5e),
     'ЛАТ Shift+6, ЛАТ Shift+`, РУС X, РУС Shift+`, W (remap)');
  eq('and no longer reaches its old one', names(0x57), 'РУС D');

  // The long form says what the key is for, and that is what the board's
  // tooltip should read out — "which key is ^" is rarely the real question.
  K.setRemap({ KeyW: { code: '^', hint: 'Shoot right' } });
  eq('a hinted remap says what the key does',
     names(0x5e).split(', ').pop(), 'W (Shoot right)');
  eq('a hinted remap still sends the code', K.codeFor(0x11, 1, 1), 0xde);

  K.setRemap(null);
  eq('dropping the remap restores the table',
     [names(0x57), K.codeFor(0x11, 0, 0), K.codeFor(0x48, 0, 3)],
     ['ЛАТ W, РУС D', 0xd7, 0x99]);
}

// --- keys declared without a code -------------------------------------------
// An entry with no code says "the program uses this key as it is". It must be
// exactly as inert as no entry at all — the whole point is that a game whose
// keys need no remapping can still name them — while still counting as one of
// this program's keys, which is what the winnowed board is drawn from.
{
  const K = A.keyboard, V = A.keyview;
  const names = (c) => K.routesTo(c).map(K.routeName).join(', ');

  const r = K.setRemap({
    Space: { hint: 'Jump' }, ArrowUp: null, KeyW: { code: '^', hint: 'Shoot' },
    KeyQQ: null,
  });
  eq('a declared key counts, without counting as a remap',
     [r.ok, r.remapped, r.bad], [3, 1, ['KeyQQ']]);
  eq('and sends exactly what the table always had',
     [K.codeFor(0x39, 0, 0), K.codeFor(0x39, 1, 1), K.codeFor(0x48, 0, 3)],
     [0xa0, 0xa0, 0x99]);
  // The hint rides on the routes the table already had, in every plane the key
  // has one: it says what the key is for, and the key is the same key shifted.
  eq('a declared key keeps its layout and gains its hint', names(0x20),
     'ЛАТ Space (Jump), ЛАТ Shift+Space (Jump), ЛАТ Ctrl+Space (Jump), ' +
     'РУС Space (Jump), РУС Shift+Space (Jump), РУС Ctrl+Space (Jump)');
  eq('a declaration with nothing to say adds nothing', names(0x99),
     'ЛАТ Ctrl+Y, ↑, PgUp, РУС Ctrl+Y');

  // Which caps the "only mapped keys" board keeps, block by block. Space is its
  // own cap, ↑ is the machine's own arrow, and W is remapped to $5E, so the cap
  // kept for it is the ^/Ч one — where the code lands on the Agat's board, not
  // where the finger goes.
  const name = (d) => d.cap !== undefined ? d.cap
    : hex(d.u) + ' ' + V.CHAR[d.u] + (d.s === undefined ? '' : '/' + V.CHAR[d.s]);
  const kept = (layout) => {
    const used = V.capsUsed(K.usedCodes(layout));
    return V.VIEWS.used.map((rows) => {
      const whole = rows.some((row) => row.keys.some((d) => V.keeps(d, used)));
      const out = [];
      for (const row of rows) {
        for (const d of row.keys) {
          if (rows.whole ? !whole : !V.keeps(d, used)) continue;
          out.push(name(d));
        }
      }
      return out;
    });
  };
  eq('the winnowed board keeps the codes the keys reach, and no others',
     kept(K.LAT), [['$5E ^/Ч', 'ПРОБЕЛ'], ['↑', '←', '↓', '→'], []]);
  eq('a remapped cap is the same one in either layout', kept(K.RUS),
     [['$5E ^/Ч', 'ПРОБЕЛ'], ['↑', '←', '↓', '→'], []]);

  // The arrow cluster is whole or nothing: on the machine ↑ is held over ↓ by
  // ПВТ and РЕД, which this board does not draw, so a cluster missing one of its
  // four would be a hole rather than a shape.
  K.setRemap({ ArrowLeft: null });
  eq('one arrow brings the whole cluster', kept(K.LAT)[1], ['↑', '←', '↓', '→']);
  K.setRemap({ KeyA: { hint: 'Left' } });
  eq('and no arrow brings none of it', kept(K.LAT)[1], []);

  // A key declared as-is is a different cap in the other layout, because that
  // is what the machine does with it: the board has to be re-winnowed on ЛАТ/РУС
  // rather than worked out once. A is the A/А cap in ЛАТ and the F/Ф cap in РУС,
  // which is JCUKEN putting Ф where the finger already is.
  eq('a declared key follows the layout to another cap',
     [kept(K.LAT)[0], kept(K.RUS)[0]], [['$41 A/А'], ['$46 F/Ф']]);

  // The controls are the board's, not the program's, so the winnowed board draws
  // none of them — on a phone they were most of what was on the screen — with
  // one exception it cannot do without. A cap named on both legends can only
  // send the unshifted one by itself, so one РЕГ is carried, and plan() draws it
  // only when some cap is in that position.
  const acts = [];
  for (const rows of V.VIEWS.used)
    for (const row of rows)
      for (const d of row.keys) if (d.act) acts.push(d.act + ' ' + d.cap);
  eq('the winnowed board carries one control, and it is a register', acts,
     ['shift РЕГ']);

  // What a touch on a kept cap sends. $8B has no cap of its own on this machine
  // — it is УПР+K — so it is drawn on the K cap, and that cap has to send $8B
  // rather than the K it is painted with, since this board draws no УПР either.
  const kept1 = (used) => V.VIEWS.used[0].reduce((f, row) =>
    f || row.keys.filter((d) => V.keeps(d, used))[0], null);
  K.setRemap({ KeyK: { code: '$8B', hint: 'Ctrl-K' } });
  {
    const used = V.capsUsed(K.usedCodes(K.LAT));
    const cap = kept1(used);
    eq('a cap standing in for a code sends that code, not its own legend',
       [name(cap), hex(V.keeps(cap, used))], ['$4B K/К', '$8B']);
    // The half is kept for $8B, not for the K printed on it, so there is a code
    // on the cap and still nothing to underline.
    eq('and the half it is kept on is not a legend the program reads',
       V.kept(cap, used), { u: 0x8b, s: 0 });
  }

  // Esc is $9B, and on this machine $9B is the РЕД cap's own byte rather than
  // the УПР+Ш that also produces it. So it lands on РЕД, and `[` is untouched.
  K.setRemap({ Escape: { hint: 'Menu: Back' } });
  {
    const used = V.capsUsed(K.usedCodes(K.LAT));
    const cap = kept1(used);
    eq('Esc is kept on РЕД, not on the cap УПР would make it from',
       [name(cap), hex(V.keeps(cap, used))], ['РЕД', '$9B']);
    eq('and no other cap is kept for it',
       V.VIEWS.used[0].reduce((n, row) =>
         n + row.keys.filter((d) => V.keeps(d, used)).length, 0), 1);
  }

  // Both legends of one cap, which is Rise Out's two cheats on the K key. The
  // cap is kept once and marked twice; what a touch sends is still the unshifted
  // one, because this board has no РЕГ to hold.
  K.setRemap({ KeyK: { code: 'K' }, KeyL: { code: 'К' } });
  {
    const used = V.capsUsed(K.usedCodes(K.LAT));
    const cap = kept1(used);
    eq('a cap named on both halves reports both', [name(cap), V.kept(cap, used)],
       ['$4B K/К', { u: 0x4b, s: 0x6b }]);
    eq('and a touch still sends the unshifted one', hex(V.keeps(cap, used)), '$4B');
  }

  K.setRemap(null);
  eq('with no container there is nothing to winnow by', K.usedCodes(K.LAT), null);
  eq('and no keys to count', K.keyCount(), 0);
}

// --- the controls -----------------------------------------------------------
//
// `keys` is indexed by host scancode; `controls` by Agat code. The second is
// what a player asks — what does the program read, and what for — and it is the
// only one of the two that can be grouped, drawn as a card and used to cut the
// board down to one part of a game.
{
  const K = A.keyboard, V = A.keyview;

  const r = K.setControls({
    Play: { 'Up Down Left Right': 'Движение', Space: true, '^': 'Выстрел' },
    Cheats: { K: 'Самоубийство', 'К': 'Конец игры', 'Ъ+': 'not a code' },
    Empty: 'not a group',
  });
  eq('setControls counts rows and groups, and names what it could not use',
     [r.rows, r.groups, r.bad], [5, 2, ['Cheats: Ъ+', 'Empty']]);

  // File order, both ways down: the groups as the container lists them and the
  // rows as the group lists them. A row is one or more codes sharing a label, so
  // the four arrows are one line rather than four.
  eq('groups and rows keep the order the file gave them',
     K.controlGroups().map((g) => [g.name, g.rows.map((w) => w.codes.map(hex).join(' '))]),
     [['Play', ['$99 $9A $88 $95', '$20', '$5E']],
      ['Cheats', ['$4B', '$6B']]]);

  // There is no combination to write. РЕГ adds $20 across the letter block, so
  // what a person calls РЕГ+К is one byte, and one byte is what the encoder puts
  // in $C000 — `"К"` and `"$6B"` are the same control.
  eq('РЕГ+К is a code like any other',
     [K.resolveCode('К'), K.resolveCode('$6B')], [0x6b, 0x6b]);
  eq('and the two halves of one cap are two different controls',
     [K.controlLabel(0x4b), K.controlLabel(0x6b)], ['Самоубийство', 'Конец игры']);
  eq('a control with no label is still a control', K.controlLabel(0x20), '');

  // The KeyboardEvent.code spellings resolve too. `keys` and `controls` have
  // left-hand sides that look alike and are not, and an author carrying the
  // habit across from one to the other means the code.
  eq('the host spellings of the named codes resolve as the codes',
     ['Escape', 'ArrowUp', 'Esc', 'Up'].map(K.resolveCode), [0x9b, 0x99, 0x9b, 0x99]);
  // Printed with the machine's own cap legend where the machine has a cap, so
  // that the panel and the board beside it name the same key: $9B is Esc on the
  // host and РЕД here.
  eq('and a code is printable whether or not it has a glyph',
     [0x99, 0x20, 0x5e, 0x6b, 0x9b].map(K.codeName), ['↑', 'ПРОБЕЛ', '^', 'К', 'РЕД']);

  // What the board is winnowed by. Controls and keys are one set — a container
  // may say it either way, or both — but naming a group is asking for that group
  // alone, since the keys block is the program's whole set and folding it back
  // in would undo the narrowing.
  const codes = (t) => (t || []).map((v) => v && hex(v)).filter(Boolean).sort();
  K.setRemap({ KeyW: { code: '^' }, Space: null });
  eq('the board is winnowed by the controls and the keys together',
     codes(K.usedCodes(K.LAT)), ['$20', '$4B', '$5E', '$6B', '$88', '$95', '$99', '$9A']);
  eq('a group is exactly itself', codes(K.usedCodes(K.LAT, 'Cheats')), ['$4B', '$6B']);
  eq('a group nobody declared narrows to nothing at all',
     K.usedCodes(K.LAT, 'Nope'), null);

  // K and К are the two legends of one cap, so the winnowed board draws that one
  // cap for both — but a cap sends one byte, and this board draws no РЕГ. The
  // unshifted half wins, and the shifted control cannot be tapped. It types
  // fine: ЛАТ Shift+K, and the full АГАТ board has a РЕГ cap to latch.
  {
    const used = V.capsUsed(K.usedCodes(K.LAT, 'Cheats'));
    const cap = { u: 0x4b, s: 0x6b, up: 's' };
    eq('two controls on one cap leave only the unshifted one tappable',
       hex(V.keeps(cap, used)), '$4B');
  }

  K.setControls(null);
  eq('with the controls gone the keys still winnow the board',
     codes(K.usedCodes(K.LAT)), ['$20', '$5E']);
  eq('and no controls to count', [K.controlCount(), K.controlGroups()], [0, null]);
  K.setRemap(null);
}

// --- .fil -------------------------------------------------------------------
{
  const fil = path.join(H.ROOT, 'examples', 'snake.fil');
  if (fs.existsSync(fil)) {
    const s = sniffImage(fil);
    eq('fil sniff', [s.kind, s.loadAddr, s.length, s.filName],
       ['fil', 0x2000, 3874, 'SNAKE']);
  } else {
    console.log('skip: fil (no examples/snake.fil)');
  }
}

// --- the font/mask pairing --------------------------------------------------
// Agat-7 glyphs live in bits 7..1, Agat-9 in bits 6..0. Pairing a font with the
// wrong mask shifts every character and is maddening to spot on screen.
{
  H.loadRoms(ctx).then(async (roms) => {
    const row = (font, ch, r, m0) => {
      let s = '', m = m0;
      for (let k = 0; k < 7; k++, m >>= 1) s += (font[ch * 8 + r] & m) ? '#' : '.';
      return s;
    };
    eq('agathe7 $C1 row0 @ m0=$80', row(roms.font7, 0xc1, 0, 0x80), '...#...');
    eq('agathe7 $C1 row4 @ m0=$80', row(roms.font7, 0xc1, 4, 0x80), '.#####.');
    eq('agathe9 $C1 row4 @ m0=$40', row(roms.font9, 0xc1, 4, 0x40), '..####.');
    const MON = ctx.AGAT.MONITORS;
    eq('default monitor palette has 16 entries', ctx.AGAT.monitorPalette().length, 16);
    eq('color16 $F is white', MON.color16[15], [255, 255, 255]);
    eq('color8 ignores the brightness bit', MON.color8[15], MON.color8[7]);
    eq('color16inv flips it', MON.color16inv[15], MON.color16[7]);
    // Dimming black is still black: ЯБ3.089.026 ТО л.47 names both $0 and $8
    // черный, so neither may borrow the common monitor's near-black grey $8.
    eq('color16inv keeps both blacks black',
       [MON.color16inv[0], MON.color16inv[8]], [[0, 0, 0], [0, 0, 0]]);

    // --- what a reset has to undo -------------------------------------------
    // A machine that has already run something is not a fresh one, and loading
    // a new image resets rather than rebuilds it. Anything a program can leave
    // set that changes what the CPU fetches has to be cleared here, or the next
    // image boots into the last one's leftovers.
    const m = H.makeMachine(ctx, roms, { model: 7 });
    m.reset();
    const vec = (a) => m.read(a) | (m.read(a + 1) << 8);
    const vectors = [vec(0xfffa), vec(0xfffc), vec(0xfffe)];

    m.psrom.writeReg(0xc2a0);              // ЭмПЗУ read-enabled, as RISE OUT
    m.xram.writeReg(0xc40b);               // ...leaves them, expansion on bank 3
    m.mem7.setState(9);
    m.mode = 0x35;
    m.videoInts = true;
    m.cpu.nmiEdge = m.cpu.irqPending = true;
    m.cards[5].portC = 0xff;
    m.cards[3].motor = 1;
    m.reset();

    eq('reset frees $D000-$FFFF from the ЭмПЗУ', m.psrom.readsRam(), false);
    eq('reset deselects the ОЗУ expansion', m.xram.selected(), false);
    eq('reset restores the ROM vectors',
       [vec(0xfffa), vec(0xfffc), vec(0xfffe)], vectors);
    eq('reset takes no pending interrupt',
       [m.cpu.nmiEdge, m.cpu.irqPending, m.cpu.irqLine], [false, false, false]);
    eq('reset drops the 840K drive lines', m.cards[5].portC, 0);
    eq('reset stops the 140K motor', m.cards[3].motor, 0);
    eq('reset restores the video mode', [m.mode, m.videoInts], [0, false]);

    // --- the standard machine -----------------------------------------------
    // 64K on the board (ТО4 табл.1: блок системный ФгЗ.038.650, "ОЗУ — 64К
    // байт"), a 32K ЭмПЗУ in slot 2 and a 32K ОЗУ expansion in slot 4: 128K in
    // three devices, with agat-emulator's card complement (sysconf.c:72-77).
    {
      const s = H.makeMachine(ctx, roms, { model: 7 });
      s.reset();
      eq('stock Agat-7 base RAM is 64K', s.ramSize, 0x10000);
      eq('stock Agat-7 fits both memory cards',
         [s.psrom.size, s.xram.size], [0x8000, 0x8000]);
      eq('stock Agat-7 is 128K in total',
         (s.ramSize + s.psrom.size + s.xram.size) >> 10, 128);

      // The expansion boots deselected — ТО4 §3.4.4, "после включения питания
      // всегда происходит автоматическая установка нулевого слова состояния" —
      // so $8000-$BFFF is base RAM until something claims it.
      s.write(0x8000, 0x33);
      eq('$8000 is base RAM before the expansion is selected', s.read(0x8000), 0x33);

      s.write(0xc408, 0);                  // select it, bank 0
      s.write(0x8000, 0x44);
      eq('the expansion covers base RAM while selected', s.read(0x8000), 0x44);
      s.write(0xc409, 0);                  // bank 1
      eq('another bank is another 16K', s.read(0x8000), 0);
      s.write(0xc408, 0);
      eq('and back again', s.read(0x8000), 0x44);

      // Deselecting hands the address straight back — it is what
      // agat-emulator's XRAM_RELEASE exists for.
      s.write(0xc400, 0);
      eq('releasing gives base RAM back untouched', s.read(0x8000), 0x33);

      // $C0F0-$C0FF is the base RAM bank register, and it lands inside the
      // $C080+16n slot range: the Agat-7 has six I/O slots, and the seventh
      // slot's page is this instead (ТО4 табл.9). Decoded after the slot range
      // it would be swallowed by the empty slot 7, and $8000-$BFFF would be
      // pinned to one array — which is what the factory memory test's
      // "ОШИБКА ВКЛЮЧЕНИЯ БАНКА" catches.
      s.write(0xc0f1, 0);
      eq('the second switchable array is a different 16K', s.read(0x8000), 0);
      s.write(0x8000, 0x55);
      s.write(0xc0f0, 0);
      eq('and the first one is still there', s.read(0x8000), 0x33);
      s.read(0xc0f1);                      // a read switches too: the value is the address
      eq('reading the bank register switches as well', s.read(0x8000), 0x55);
      s.read(0xc0f0);

      // The 32K board is a fitting the manual allows and the emulator still
      // takes: two arrays, no bank register, and nothing behind $8000-$BFFF
      // until the expansion claims it.
      const small = H.makeMachine(ctx, roms, { model: 7, ramSize: 0x8000 });
      small.reset();
      small.write(0xc0f1, 0);
      eq('a 32K board has no bank register to switch', small.mem7.map[2], 0x8000);
      eq('$8000 is open bus on a 32K board', small.read(0x8000), 0xff);
      small.write(0x8000, 0x11);
      eq('a store into open bus goes nowhere', small.read(0x8000), 0xff);
      small.write(0xc408, 0);
      small.write(0x8000, 0x22);
      eq('the expansion still answers there', small.read(0x8000), 0x22);
      small.write(0xc400, 0);
      eq('and deselecting leaves nothing behind it', small.read(0x8000), 0xff);

      // Neither memory card decodes $C080+16n — psrom7.c and xram7.c fill
      // io_sel and never baseio_sel — so those pages are open bus, the same
      // $FF an empty slot gives (memory.c:4).
      eq('$C0A0 is not a window into the ЭмПЗУ', s.read(0xc0a0), 0xff);
      eq('$C0C0 is not a window into the expansion', s.read(0xc0c0), 0xff);
      eq('an empty slot answers the same', s.read(0xc090), 0xff);
    }

    // --- slot overrides, and the container that carries them -----------------
    {
      const M = A.Machine;
      const stock = M.resolveSlots(7, null);
      eq('the stock Agat-7 slot map',
         [stock[2].card, stock[3].card, stock[4].card, stock[5].card],
         ['psrom', 'fdd140', 'xram', 'fdd840']);
      eq('slotOf finds the 140K drive', M.slotOf(stock, 'fdd140'), 3);

      const over = M.resolveSlots(7, { 4: { card: 'xram', ram: 0x20000 }, 2: null });
      eq('an override resizes a card', over[4].ram, 0x20000);
      eq('null empties a slot', over[2], undefined);
      eq('and leaves the rest alone', over[5].card, 'fdd840');

      const sized = M.resolveSlots(7, { 4: { ram: 0x10000 } });
      eq('a size alone keeps the card', [sized[4].card, sized[4].ram],
         ['xram', 0x10000]);

      const built = H.makeMachine(ctx, roms, {
        model: 7, slots: { 4: { card: 'xram', ram: 0x20000 } },
      });
      eq('makeMachine honours an override', built.xram.size, 0x20000);

      // Round trip: build a container naming slots and read it back.
      const src = await A.agc.build({
        title: 'slots', model: 7, ram: 32,
        slots: { 4: { card: 'xram', ram: 128 } },
        media: [{ name: 'x.dsk', bytes: new ctx.Uint8Array(143360) }],
      });
      const back = await A.agc.parse(ctx.Uint8Array.from(Buffer.from(src)), 'slots.agc');
      eq('slots survive the round trip', back.machine.slots[4],
         { card: 'xram', ram: 128 });

      const plain = await A.agc.build({
        title: 'plain', model: 7, ram: 64,
        media: [{ name: 'x.dsk', bytes: new ctx.Uint8Array(143360) }],
      });
      eq('a container without slots carries no slots field',
         (await A.agc.parse(ctx.Uint8Array.from(Buffer.from(plain)), 'p.agc')).machine.slots,
         null);

      // resolveSlots resizes a stock card from a bare size, but a container
      // cannot ask for that: `card` names what the entry is, and without one
      // there is nothing to fit.
      const sizeOnly = await A.agc.parse(Buffer.from(JSON.stringify(
        { agc: 1, machine: { model: 7, slots: { 4: { ram: 128 }, 2: null } } }), 'utf8'),
        's.agc');
      eq('a slot entry with no card is dropped', sizeOnly.machine.slots, { 2: null });

      // --- and the same machine said as cards --------------------------------
      // Slot numbers belong to a model, so what has to survive a change of one
      // is carried by what the cards are. A mouse is a class of its own: the
      // machine takes one at most and which one it is is the whole choice.
      eq('a mouse of any make is the mouse',
         [M.classOf('mouse-mars-rom'), M.classOf('xram9')], ['mouse', 'xram9']);
      eq('each model keeps a class where it keeps it',
         [M.stockSlot(7, 'fdd140'), M.stockSlot(9, 'fdd140'),
          M.stockSlot(7, 'mouse'), M.stockSlot(9, 'mouse')], [3, 6, 6, 4]);
      eq('a class a model does not take has no slot',
         [M.stockSlot(9, 'psrom'), M.stockSlot(7, 'xram9')], [-1, -1]);

      const asCards = M.cardsOf(9, { 4: { card: 'mouse-mars', ram: 0 }, 2: null });
      eq('an override map read as cards', asCards,
         { xram9: null, mouse: { card: 'mouse-mars', ram: 0, slot: 4 } });
      eq('the same cards on an Agat-7', M.slotsFor(7, asCards, 9),
         { 6: { card: 'mouse-mars', ram: 0 } });
      eq('...and back on the machine they were named for',
         M.slotsFor(9, asCards, 9),
         { 4: { card: 'mouse-mars', ram: 0 }, 2: null });

      // A card somewhere other than its model's own slot keeps the slot it was
      // given, and only on the model it was given for.
      const odd = { mouse: { card: 'mouse-nippel', ram: 0, slot: 1 } };
      eq('an odd slot is kept', M.slotsFor(9, odd, 9), { 1: { card: 'mouse-nippel', ram: 0 } });
      eq('...and given up on the other machine', M.slotsFor(7, odd, 9),
         { 6: { card: 'mouse-nippel', ram: 0 } });
      eq('cards with nothing to say resolve to no overrides',
         M.slotsFor(7, {}, 7), null);

      eq('a layer over another wins class by class',
         M.mergeCards({ psrom: null, xram: { card: 'xram', ram: 0x8000 } },
                      { psrom: { card: 'psrom', ram: 0x4000 } }),
         { psrom: { card: 'psrom', ram: 0x4000 },
           xram: { card: 'xram', ram: 0x8000 } });
      eq('and a mouse replaces a mouse rather than joining it',
         M.slotsFor(9, M.mergeCards({ mouse: { card: 'mouse-mars', slot: 4 } },
                                    { mouse: { card: 'mouse-nippel' } }), 9),
         { 4: { card: 'mouse-nippel', ram: 0 } });
    }

    // --- a container, and what the address says over it ----------------------
    // The page loads a container the URL names and hands it whatever else the
    // fragment carried. The two go in together, because applying them apart is
    // a second build() — and build() resets the CPU without booting anything,
    // which is a machine sitting in the monitor with its disk still in the
    // drive. bootSlot leaves pc at $C000 + slot*256 and a reset does not, so pc
    // alone says which of the two the medium got.
    {
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({ createImageData: () => ({ data: [] }),
                             putImageData: () => {} }),
      };
      ctx.requestAnimationFrame = () => {};   // App.start() wants one; no frame runs
      const agc = async (spec) => ctx.Uint8Array.from(Buffer.from(await A.agc.build(
        Object.assign({ media: [{ name: 'x.dsk', bytes: new ctx.Uint8Array(143360) }] },
                      spec))));
      const load = async (bytes, over) => {
        const app = new A.App({ canvas, model: 7, onStatus: () => {} });
        app.roms = roms;
        app.build();
        await app.load(bytes, 'x.agc', null, over);
        return app;
      };
      // What examples/rise-out.agc says, and the address the page writes for it.
      const stock = await agc({ model: 7, ram: 64 });

      const plain = await load(stock);
      eq('a container builds the machine it names',
         [plain.model, plain.ramSize], [7, 0x10000]);
      eq('...and boots its medium', [plain.drives[3].name, plain.machine.cpu.pc],
         ['x.dsk', 0xc300]);

      const same = await load(stock, { model: 7, ramSize: 0x10000 });
      eq('an address agreeing with the container changes nothing',
         [same.model, same.ramSize], [7, 0x10000]);
      eq('...and still leaves the medium booting', same.machine.cpu.pc, 0xc300);

      const other = await load(stock, { ramSize: 0x20000, cards: { psrom: null } });
      eq('an address disagreeing with it wins',
         [other.ramSize, other.slots[2]], [0x20000, undefined]);
      eq('...on the machine the medium boots on', other.machine.cpu.pc, 0xc300);

      const nine = await load(stock, { model: 9 });
      eq('an address may name the other machine',
         [nine.model, nine.ramSize], [9, 0x20000]);
      eq('...where the 140K drive is slot 6', nine.machine.cpu.pc, 0xc600);

      // And out again, which is the Save button: what was loaded, the machine
      // it is running as, and the payload it came in with, byte for byte.
      const saved = await plain.toAgc();
      const reopened = await A.agc.parse(Buffer.from(saved, 'utf8'), 'x.agc');
      eq('a container saved from a running machine reopens as itself',
         [reopened.machine.model, reopened.machine.ram, reopened.media.length,
          reopened.media[0].name, reopened.media[0].payload.length,
          [...reopened.media[0].payload].some((b) => b !== 0)],
         [7, 64, 1, 'x.dsk', 143360, false]);

      const carded = await agc({ model: 7, ram: 64,
                                 slots: { 4: { card: 'xram', ram: 128 } } });
      eq('a container sizes its cards', (await load(carded)).slots[4].ram, 0x20000);
      // A card the address names is the address's, at whatever size — including
      // the stock one, which is a choice and not the absence of one. It says
      // nothing about the cards it does not name.
      const resized = await load(carded,
        { cards: { xram: { card: 'xram', ram: 0x8000 } } });
      eq('an address of stock sizes puts them back', resized.slots[4].ram, 0x8000);

      const both = await agc({ model: 9, ram: 128,
                               slots: { 4: { card: 'mouse-mars-rom' },
                                        2: { card: 'xram9', ram: 64 } } });
      const one = await load(both, { cards: { xram9: { card: 'xram9', ram: 0x8000 } } });
      eq('an address naming one card leaves the others alone',
         [one.slots[2].ram, one.slots[4].card], [0x8000, 'mouse-mars-rom']);

      // The container's slot numbers are about the machine it named. Asked for
      // on the other one, its cards go where that machine puts them — a mouse
      // at slot 4 on an Agat-9 is a mouse at slot 6 on an Agat-7, and slot 4
      // there is the ОЗУ expansion's.
      const seven = await load(both, { model: 7 });
      eq('a container\'s cards move with the model',
         [seven.slots[4].card, seven.slots[6].card, seven.slots[2].card],
         ['xram', 'mouse-mars-rom', 'psrom']);
    }

    // --- the video interrupts ------------------------------------------------
    // Run the line counter through one whole frame and describe the IRQ line's
    // shape, which is what the oscilloscope traces on agatcomp measure: the
    // Agat-7's ten assertions with one release cut in half, and the Agat-9's
    // single line in eight.
    const shape = (model) => {
      const mm = H.makeMachine(ctx, roms, { model: model });
      mm.reset();
      mm.setVideoInts(true);
      const level = new Array(312), nmi = [], runs = [];
      mm.cpu.nmi = () => nmi.push(mm.rasterLine);
      for (let i = 0; i < 312; i++) {
        mm.pollInterrupts(mm.nextLine);
        level[mm.rasterLine] = mm.cpu.irqLine;
      }
      for (let line = 0; line < 312; line++) {
        if (line && level[line] === level[line - 1]) runs[runs.length - 1][1]++;
        else runs.push([level[line], 1]);
      }
      return { runs: runs, nmi: nmi };
    };

    const s7 = shape(7);
    eq('Agat-7 raster IRQ asserts ten times a frame',
       s7.runs.filter((r) => r[0]).length, 10);
    eq('Agat-7 raster IRQ is 16 lines on, 16 off',
       s7.runs.slice(0, 4), [[true, 16], [false, 16], [true, 16], [false, 16]]);
    eq('Agat-7 raster IRQ has one half-length release',
       s7.runs.filter((r) => !r[0] && r[1] === 8).length, 1);
    eq('Agat-7 takes NMI where blanking starts', s7.nmi, [256]);

    const s9 = shape(9);
    eq('Agat-9 raster IRQ asserts 39 times a frame',
       s9.runs.filter((r) => r[0]).length, 39);
    eq('Agat-9 raster IRQ is one line in eight',
       s9.runs.slice(0, 4), [[false, 7], [true, 1], [false, 7], [true, 1]]);
    eq('Agat-9 takes NMI where blanking ends', s9.nmi, [0]);

    // Last, because they are the two asynchronous ones: everything a container
    // is read or written through is a promise now that a payload may be
    // gzipped.
    await diskWriteTests();
    await disk840WriteTests();
    await agcTests();
    done();
  }).catch((e) => { console.error(e); process.exit(1); });
}

function done() {
  console.log('\n%d passed, %d failed', pass, fail);
  process.exit(fail ? 1 : 0);
}
