// The DOS 3.3 file manager, as a panel.
//
// One catalog, drawn into whatever element it is given, with the operations in
// `dosfile.js` behind its buttons. Two things mount it: `edit-dos.html`, over
// an image file it opened, and the emulator page, over the live disk in a
// drive. Neither knows anything about the other, and this knows nothing about
// either — it is handed a `Dos33` and told whether writing is allowed.
//
//   var ui = new AGAT.DosUI(element, {
//     onStatus: function (msg, isError) { … },   // the host keeps its own line
//     onChange: function () { … },               // something was written
//     onImage: function (file, sniffed) { … },   // a disk was dropped on it
//   });
//   ui.mount(dos, { label: 'Klondike.aim', writable: true, onUnlock: fn });
//
// The three callbacks belong to the page and are set once; what `mount` takes
// is what changes with the disk. `onImage` in particular: a disk dropped on an
// empty panel is the first thing that happens on a page that opens files, and
// the panel is empty exactly then.
//
// **The per-file actions expand under the row rather than dropping out of a
// menu.** The strip is where they are, with room for the rename field beside
// them, and the `⋯` at the right edge of every row is what says a row opens.
//
// **Looking inside a file is the one thing that gets a layer.** It is the only
// operation whose whole point is room — a hex dump is 70 columns wide and a
// text file is as long as it is, and the strip lives inside a list that
// scrolls — so **View** puts up the page's one popup, and the editor moved
// into it. It is drawn into the panel's own root rather than into
// `document.body`: this is handed a host element and does not reach outside
// it.
(function (AGAT) {
  'use strict';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function button(face, title, fn) {
    var b = el('button', null, face);
    if (title) b.title = title;
    b.addEventListener('click', fn);
    return b;
  }

  // A checkbox with its word beside it, which is two elements everywhere it
  // appears.
  function check(label, title, on) {
    var l = el('label', null), box = el('input');
    box.type = 'checkbox';
    box.checked = !!on;
    l.title = title;
    l.appendChild(box);
    l.appendChild(document.createTextNode(' ' + label));
    l.box = box;
    return l;
  }

  var LEAD_LABEL = 'leading CR';
  var LEAD_TITLE = 'A $8D before the first line. asm-89\'s editor and the one ' +
                   'that wrote the ИКП disks put one there and expect it back; ' +
                   'a reader that expects it eats the first character without it.';

  function pad3(n) {
    var s = String(n);
    while (s.length < 3) s = '0' + s;
    return s;
  }

  function hex(n) {
    return '$' + hexAt(n, 4);
  }

  function hexAt(n, wide) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < wide) s = '0' + s;
    return s;
  }

  // A file the browser hands to the person, which is the only way out of a
  // page for bytes. The revoke is on a timer because the click is not the
  // download: Chrome starts fetching the blob after the handler returns.
  function download(name, parts, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(parts, { type: type || 'application/octet-stream' }));
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }

  // ---- the panel -----------------------------------------------------------

  function DosUI(host, opts) {
    opts = opts || {};
    var self = this;
    this.onStatus = opts.onStatus || function () {};
    this.onChange = opts.onChange || function () {};
    // What to do with a whole disk dropped on the panel. Without one there is
    // nothing to be done with it: the emulator page's panel edits the disk
    // that is in the drive.
    this.onImage = opts.onImage || null;
    this.dos = null;
    this.label = '';
    this.writable = false;
    this.onUnlock = null;
    this.open = '';                        // which file's strip is open
    this.mode = '';                        // '' or 'rename', in that strip
    this.view = null;                      // the popup: {key, how, editing}
    this.esc = null;                       // its Escape listener, while it is up
    this.deleted = false;                  // are the tombstones shown
    this.lead = false;                     // what a new T file gets in front

    this.root = el('div', 'dos');
    this.headEl = el('div', 'dos-head');
    this.noteEl = el('div', 'dos-note');
    this.listEl = el('div', 'dos-list');
    this.formEl = el('div', 'dos-form');
    this.footEl = el('div', 'dos-foot');
    this.popHost = el('div', 'dos-pop-host');
    this.noteEl.hidden = true;
    this.formEl.hidden = true;

    var add = el('label', 'file');
    add.appendChild(document.createTextNode('Add file… '));
    this.addEl = el('input');
    this.addEl.type = 'file';
    this.addEl.multiple = true;
    this.addEl.addEventListener('change', function (e) {
      self.take(e.target.files);
      e.target.value = '';
    });
    add.appendChild(this.addEl);
    this.footEl.appendChild(add);
    this.footEl.appendChild(button('New text file…', 'Type a T file straight onto the disk',
      function () { self.newText(); }));

    var show = el('label', null);
    this.delEl = el('input');
    this.delEl.type = 'checkbox';
    this.delEl.addEventListener('change', function () {
      self.deleted = self.delEl.checked;
      self.refresh();
    });
    show.title = 'Files DOS has tombstoned — the sectors are free again';
    show.appendChild(this.delEl);
    show.appendChild(document.createTextNode(' deleted'));
    this.footEl.appendChild(show);

    this.root.appendChild(this.headEl);
    this.root.appendChild(this.noteEl);
    this.root.appendChild(this.listEl);
    this.root.appendChild(this.formEl);
    this.root.appendChild(this.footEl);
    this.root.appendChild(this.popHost);
    host.appendChild(this.root);

    ['dragenter', 'dragover'].forEach(function (t) {
      self.root.addEventListener(t, function (e) {
        e.preventDefault();
        self.root.classList.add('drag');
      });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      self.root.addEventListener(t, function (e) {
        e.preventDefault();
        self.root.classList.remove('drag');
      });
    });
    this.root.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) self.take(e.dataTransfer.files);
    });
  }

  // A different disk, or the same one again. `writable` is the host's answer,
  // not ours: a drive says its disk is locked, a file says it is not.
  DosUI.prototype.mount = function (dos, opts) {
    opts = opts || {};
    this.dos = null;                       // so setWritable does not draw twice
    this.label = opts.label || '';
    this.setWritable(opts.writable, opts.onUnlock);
    this.dos = dos;
    this.open = '';
    this.mode = '';
    this.dropEsc();
    this.view = null;
    this.hideForm();
    this.refresh();
  };

  // The write lock is the host's, and it can be turned while the panel is up —
  // the drive's own RO/RW button is right next to the one that opened this. So
  // it is set apart from `mount`, and setting it keeps the row that is open
  // open: somebody who unlocks a disk to delete the file they are looking at
  // should still be looking at it.
  DosUI.prototype.setWritable = function (writable, onUnlock) {
    this.writable = !!writable;
    this.onUnlock = onUnlock || null;
    if (this.dos) this.refresh();
  };

  DosUI.prototype.say = function (msg, isError) { this.onStatus(msg, isError); };

  // Written, so: the list is stale and whoever mounted us wants to know.
  DosUI.prototype.changed = function () {
    this.refresh();
    this.onChange();
  };

  DosUI.prototype.lockedWhy = function () {
    return this.onUnlock ? 'the disk is read-only' : 'this disk cannot be written';
  };

  // Every action goes through here: nothing is attempted on a locked disk, and
  // a file system that refuses says why in the status line rather than in the
  // console.
  DosUI.prototype.act = function (fn) {
    if (!this.writable) { this.say(this.lockedWhy(), true); return; }
    try {
      fn();
    } catch (e) {
      this.say(e.message, true);
      this.refresh();
    }
  };

  // ---- drawing -------------------------------------------------------------

  function key(entry) {
    return entry.at.track + '/' + entry.at.sector + '/' + entry.at.index;
  }

  DosUI.prototype.refresh = function () {
    var self = this, dos = this.dos;
    this.headEl.textContent = '';
    this.listEl.textContent = '';
    this.noteEl.hidden = true;
    this.addEl.disabled = !this.writable;
    if (!dos) {
      this.headEl.appendChild(el('span', 'dim', 'nothing open'));
      return;
    }

    // The line tools/dos.js prints above a catalog: what the disk is, and what
    // it calls itself.
    var t = dos.title();
    this.headEl.appendChild(el('b', null, this.label));
    this.headEl.appendChild(el('span', 'dim',
      (dos.perTrack === 16 ? ' 140K' : ' 840K') + ', ' + dos.tracks + ' tracks of ' +
      dos.perTrack + ', ДИСК N ' + dos.volume + (t ? ', "' + t + '"' : '')));

    var files = dos.list({ deleted: this.deleted });
    files.forEach(function (e) { self.listEl.appendChild(self.fileEl(e)); });

    // The popup is drawn from the same list as the rows under it, so a file
    // that is no longer on the disk takes its own view down with it.
    this.popHost.textContent = '';
    if (this.view) {
      var on = null;
      files.forEach(function (e) { if (key(e) === self.view.key) on = e; });
      if (on) this.popHost.appendChild(this.popEl(on));
      else this.dropEsc();
    }

    var free = dos.freeCount();
    this.listEl.appendChild(el('div', 'dos-sum',
      files.length + (files.length === 1 ? ' file, ' : ' files, ') +
      free + (free === 1 ? ' free sector of ' : ' free sectors of ') +
      dos.tracks * dos.perTrack));

    if (!this.writable) {
      this.noteEl.textContent = '';
      if (this.onUnlock) {
        this.noteEl.appendChild(document.createTextNode('Read-only.'));
        this.noteEl.appendChild(button('Allow writing',
          'The same as RO/RW on the drive', function () { self.onUnlock(); }));
      } else {
        this.noteEl.appendChild(
          document.createTextNode('Read only — this disk cannot be written.'));
      }
      this.noteEl.hidden = false;
    }
  };

  // The columns DOS prints, and then the one number a person reads a catalog
  // for that DOS does not print: how long the file is. Everything else the
  // file says about itself — where its T/S list is, how many sectors the chain
  // holds, where a `B` file loads — waits under the row, because on a healthy
  // disk it all follows from the two counts already on screen and it is the
  // name that the narrow screen has too little of.
  //
  // A file that contradicts itself is the exception, and it has to say so
  // before anyone clicks: the sector count goes red and carries the reason.
  DosUI.prototype.fileEl = function (e) {
    var self = this, k = key(e);
    var wrap = el('div', 'dos-file' + (this.open === k ? ' open' : ''));
    var row = el('div', 'dos-row' + (e.deleted ? ' gone' : ''));
    var d = e.deleted ? null : AGAT.dosfile.describe(this.dos, e);
    var bad = d && (d.error || d.warn);

    row.appendChild(el('span', 'dos-mark', e.deleted ? 'x' : e.locked ? '*' : ''));
    row.appendChild(el('span', 'dos-type', e.typeLetter));
    var sect = el('span', 'dos-sect' + (bad ? ' bad' : ''), pad3(e.sectors));
    sect.title = bad ? '"' + e.name + '": ' + (d.error || d.warn)
                     : 'Sectors, as the catalog counts them: the file\'s data ' +
                       'and its T/S lists together.';
    row.appendChild(sect);
    row.appendChild(el('span', 'dos-name', e.name));

    // A tombstone has no chain left to ask, and the track DOS parked in the
    // last byte of its name is the only thing it still knows.
    var tail = el('span', 'dos-len');
    if (e.deleted) {
      tail.textContent = 'track ' + e.tsTrack;
      tail.title = 'Deleted. Its T/S list was on this track, which is what an ' +
                   'undelete would need.';
    } else if (d.len !== undefined) {
      tail.textContent = String(d.len);
      tail.title = 'Bytes, as the file itself declares in its own first bytes.';
    }
    row.appendChild(tail);
    row.appendChild(el('span', 'dos-more', e.deleted ? '' : '⋯'));

    if (!e.deleted) {
      row.addEventListener('click', function () {
        self.open = self.open === k ? '' : k;
        self.mode = '';
        self.refresh();
      });
    }
    wrap.appendChild(row);
    if (this.open === k) wrap.appendChild(this.stripEl(e));
    return wrap;
  };

  // What the file says about itself, spelled out where there is room for it.
  // Each field carries what it is on hover, because none of them is obvious
  // from its name and the panel is the only place they are written down.
  DosUI.prototype.factsEl = function (e) {
    var d = AGAT.dosfile.describe(this.dos, e);
    var f = el('div', 'dos-acts dos-facts');
    var add = function (text, title, cls) {
      var x = el('span', cls || null, text);
      x.title = title;
      f.appendChild(x);
    };
    f.appendChild(el('span', 'key', 'On disk'));
    add('ts=' + d.tsTrack + '/' + d.tsSector,
        'The track and sector of the file\'s first T/S list, which is where ' +
        'the catalog entry points. Not the first sector of the data.');
    if (d.error) {
      add(d.error, 'The chain will not read, so nothing below it is known.', 'bad');
      return f;
    }
    add('sectors=' + d.sectors,
        'Data sectors the chain reaches. The catalog\'s count to the left is ' +
        'this plus the T/S lists, and it is one byte, so it stops at 255.');
    add('lists=' + d.lists,
        'T/S list sectors holding those pairs — 122 to a list.');
    if (d.len !== undefined) {
      add('len=' + d.len, 'Bytes, as the file itself declares: a length in the ' +
          'first two bytes of an `A` or `I` file, in bytes 3-4 of a `B` file, ' +
          'and up to the first $00 in a `T` file.');
    }
    if (d.addr !== undefined) {
      add('addr=' + hex(d.addr), 'The address a `B` file loads at, out of its ' +
          'own first two bytes.');
    }
    if (d.warn) add(d.warn, 'The file contradicts itself.', 'bad');
    return f;
  };

  DosUI.prototype.stripEl = function (e) {
    var self = this, s = el('div', 'dos-strip');
    var bar = el('div', 'dos-acts');

    s.appendChild(this.factsEl(e));
    bar.appendChild(el('span', 'key', 'Download'));
    bar.appendChild(button('.fil', 'The data stream with its catalog entry in front — what the emulator loads',
      function () { self.save(e, 'fil'); }));
    bar.appendChild(button('raw', 'The data stream as DOS stores it, whole sectors and all',
      function () { self.save(e, 'raw'); }));
    bar.appendChild(button('body', "The contents alone, without the type's own address and length",
      function () { self.save(e, 'body'); }));
    bar.appendChild(button('text', 'The contents as UTF-8',
      function () { self.save(e, 'text'); }));
    s.appendChild(bar);

    var act = el('div', 'dos-acts');
    act.appendChild(el('span', 'key', ''));
    // Rename carries the page's ellipsis, which keeps the button that opens
    // the field from reading the same as the one that commits it. View does
    // not: what it opens is a window onto the file, not a question.
    act.appendChild(button('View', 'Look inside it, and edit it if it is text',
      function () { self.setView(e, defaultHow(e)); }));
    act.appendChild(button('Rename…', null, function () {
      self.mode = 'rename'; self.refresh();
    }));
    act.appendChild(button(e.locked ? 'Unlock' : 'Lock',
      'The lock mark DOS shows as a star', function () {
        self.act(function () {
          var on = !e.locked;
          self.dos.setLocked(e, on);
          self.say('"' + e.name + '" ' + (on ? 'locked' : 'unlocked'));
          self.changed();
        });
      }));
    // Asked about inside `act`, not before it: a disk that will not be written
    // should say so rather than ask a question it is going to refuse.
    act.appendChild(button('Delete', null, function () {
      self.act(function () {
        if (!window.confirm('Delete "' + e.name + '"?')) return;
        var freed = self.dos.remove(e);
        self.say('deleted "' + e.name + '", ' + freed + ' sectors freed');
        self.open = '';
        self.changed();
      });
    }));
    s.appendChild(act);

    if (this.mode === 'rename') s.appendChild(this.renameEl(e));
    return s;
  };

  DosUI.prototype.renameEl = function (e) {
    var self = this, r = el('div', 'dos-acts');
    var f = el('input', 'dos-nm');
    f.type = 'text';
    f.maxLength = 30;
    f.value = e.name;
    var go = function () {
      self.act(function () {
        var was = e.name;
        // A file is not a clash with itself: a rename that only changes which
        // alphabet a letter came from is the commonest one there is.
        var clash = self.dos.match(f.value).filter(function (o) {
          return o.at.off !== e.at.off || o.at.track !== e.at.track ||
                 o.at.sector !== e.at.sector;
        });
        if (clash.length &&
            !window.confirm('"' + clash[0].name + '" is already on the disk. Rename anyway?')) return;
        self.dos.rename(e, f.value);
        self.mode = '';
        self.say('"' + was + '" → "' + e.name + '"');
        self.changed();
      });
    };
    f.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); go(); }
      if (ev.key === 'Escape') { self.mode = ''; self.refresh(); }
    });
    r.appendChild(el('span', 'key', 'Name'));
    r.appendChild(f);
    r.appendChild(button('Rename', null, go));
    r.appendChild(button('Cancel', null, function () { self.mode = ''; self.refresh(); }));
    setTimeout(function () { f.focus(); f.select(); }, 0);
    return r;
  };

  // ---- the popup -----------------------------------------------------------

  // The four ways of reading a file, in the order the strip's Download row
  // offers the same bytes — capitalized, so that neither the eye nor a test
  // can take one row's buttons for the other's.
  //
  // `Memory` is `Body` with the offsets counted from where the file loads,
  // which is the only way a dump of a `B` file lines up with a listing or with
  // the monitor. `Code` is the same bytes as instructions, and sits behind it.
  var VIEWS = [
    { how: 'text', face: 'Text', title: 'The contents as Agat text' },
    { how: 'basic', face: 'BASIC',
      title: 'The program, listed the way the machine lists it' },
    { how: 'mem', face: 'Memory',
      title: 'The contents in hex, at the address the file loads at' },
    { how: 'code', face: 'Code',
      title: 'The contents as 6502 instructions, from the first byte forward' },
    { how: 'body', face: 'Body',
      title: "The contents in hex, without the type's own address and length" },
    { how: 'raw', face: 'Raw',
      title: 'The stream as DOS stores it, whole sectors and all' },
  ];

  // Which views a file has. `Text` is for a `T` file and `Memory` for a `B`
  // one: reading an `I` file as text is a thing to do to a file, and the
  // Download row is where doing things to a file lives.
  function offers(e, how) {
    if (how === 'text') return e.type === 0x00;
    if (how === 'basic') return e.type === 0x02;
    if (how === 'mem' || how === 'code') return e.type === 0x04;
    return true;
  }

  function defaultHow(e) {
    return e.type === 0x00 ? 'text' : e.type === 0x02 ? 'basic' :
           e.type === 0x04 ? 'mem' : 'body';
  }

  DosUI.prototype.setView = function (e, how) {
    var self = this;
    if (!this.esc) {
      // Escape backs out one step: out of the editor to the view it was
      // opened from, and out of the view to the panel.
      this.esc = function (ev) {
        if (ev.key !== 'Escape' || !self.view) return;
        if (self.view.editing) { self.view.editing = false; self.refresh(); }
        else self.shutView();
      };
      document.addEventListener('keydown', this.esc);
    }
    this.view = { key: key(e), how: how, editing: false };
    this.refresh();
  };

  // The popup taken down, without the redraw — for a caller that is about to
  // redraw anyway.
  DosUI.prototype.dropEsc = function () {
    if (this.esc) document.removeEventListener('keydown', this.esc);
    this.esc = null;
    this.view = null;
  };

  DosUI.prototype.shutView = function () {
    this.dropEsc();
    this.refresh();
  };

  // One view, as the node to put in the popup. Throws what `unpack` throws: a
  // file whose chain will not decode has no view, and the message is what
  // there is to show instead.
  //
  // Everything but the listing is one string in a `<pre>`. The listing is the
  // same `<pre>` with a span to a piece, because `basic.list` has already
  // worked out which piece is a keyword, a string and a comment — it has to,
  // to read the line at all — and throwing that away to re-find it with a
  // regular expression would be both more code and less true.
  DosUI.prototype.viewEl = function (e, how) {
    if (how === 'basic') return this.basicEl(e);
    if (how === 'code') return this.codeEl(e);
    var pre = el('pre');
    if (how === 'text') {
      pre.textContent = AGAT.dosfile.unpack(this.dos, e, 'text').text;
      return pre;
    }
    var got = AGAT.dosfile.unpack(this.dos, e, how === 'raw' ? 'raw' : 'body');
    var base = 0;
    if (how === 'mem') base = AGAT.dosfile.describe(this.dos, e).addr || 0;
    pre.textContent = AGAT.dosfile.hexdump(got.bytes, base);
    return pre;
  };

  DosUI.prototype.basicEl = function (e) {
    var pre = el('pre', 'dos-bas');
    var got = AGAT.basic.list(AGAT.dosfile.unpack(this.dos, e, 'body').bytes);
    got.rows.forEach(function (r) {
      var row = el('div');
      // A statement continued onto a row of its own — an `!` — has no number,
      // and the column it would have taken is left empty so the two line up.
      row.appendChild(el('span', 'n', r.num === null ? '' : String(r.num)));
      r.parts.forEach(function (p) { row.appendChild(el('span', p.kind, p.text)); });
      pre.appendChild(row);
    });
    if (got.error) pre.appendChild(el('div', 'bad', got.error));
    return pre;
  };

  // A `B` file as instructions, at the address it loads at. Four columns —
  // address, the instruction's own bytes, the mnemonic, the operand — as spans
  // rather than as text, because an undocumented opcode is worth coloring: a
  // run of them is where the disassembler has fallen into data and is reading
  // it as code, which is the one thing a linear disassembly cannot get right
  // and the reader has to see.
  DosUI.prototype.codeEl = function (e) {
    var pre = el('pre', 'dos-dis');
    var bytes = AGAT.dosfile.unpack(this.dos, e, 'body').bytes;
    var base = AGAT.dosfile.describe(this.dos, e).addr || 0;
    AGAT.disasm.lines(bytes, base).forEach(function (r) {
      var row = el('div'), hx = '', i;
      for (i = 0; i < r.len; i++) hx += (i ? ' ' : '') + hexAt(bytes[r.at + i], 2);
      // The address column is bare, the way the dump beside it writes the same
      // number: the two views of a `B` file scroll to the same place.
      row.appendChild(el('span', 'a', hexAt(r.addr, 4)));
      row.appendChild(el('span', 'b', hx));
      row.appendChild(el('span', r.ill ? 'ill' : 'op', r.name));
      row.appendChild(el('span', 'arg', r.arg));
      pre.appendChild(row);
    });
    return pre;
  };

  DosUI.prototype.popEl = function (e) {
    var self = this, v = this.view;
    var pop = el('div', 'dos-pop');
    var box = el('div', 'dos-pop-box');
    // A click on the backdrop is a click outside, and shuts it; one inside the
    // box is not, and must not travel up to it.
    pop.addEventListener('click', function () { self.shutView(); });
    box.addEventListener('click', function (ev) {
      if (ev.stopPropagation) ev.stopPropagation();
    });

    var head = el('div', 'dos-pop-head');
    head.appendChild(el('b', null, e.name));
    head.appendChild(el('span', 'dim', e.typeLetter));
    if (!v.editing) {
      VIEWS.forEach(function (w) {
        var b = button(w.face, w.title, function () {
          v.how = w.how;
          self.refresh();
        });
        if (!offers(e, w.how)) b.disabled = true;
        else if (v.how === w.how) b.className = 'on';
        head.appendChild(b);
      });
    } else {
      head.appendChild(el('span', 'dim', 'editing'));
    }
    box.appendChild(head);

    if (v.editing) {
      box.appendChild(this.textEl(e));
    } else {
      var body = el('div', 'dos-pop-view');
      try {
        body.appendChild(this.viewEl(e, v.how));
      } catch (err) {
        body.appendChild(el('div', 'dim', err.message));
      }
      box.appendChild(body);
      var r = el('div', 'dos-acts');
      // Editing is for a `T` file: what the editor writes back is a `T` file,
      // whatever it was opened on.
      var ed = button('Edit', 'Change it and write it back as a T file',
        function () { v.editing = true; self.refresh(); });
      ed.disabled = e.type !== 0x00;
      r.appendChild(ed);
      r.appendChild(button('Close', null, function () { self.shutView(); }));
      box.appendChild(r);
    }
    pop.appendChild(box);
    return pop;
  };

  // ---- text ----------------------------------------------------------------

  // A T file, decoded, in a box, inside the popup that opened on it. Writing it
  // back is a delete and a create, which is what `put --force` does: DOS has no
  // way to grow a file in place.
  DosUI.prototype.textEl = function (e) {
    var self = this, box = el('div', 'dos-text'), area = null, text;
    // Out of the editor is back to the view it was opened from, not out of the
    // file: somebody who cancels an edit is still looking at the file.
    var shut = function () { self.view.editing = false; self.refresh(); };
    try {
      text = AGAT.dosfile.unpack(this.dos, e, 'text').text;
    } catch (err) {
      // A file whose chain will not decode has no text to show. The message
      // is what there is, and Cancel is the way out of it.
      box.appendChild(el('div', 'dim', err.message));
    }
    var lead = null;
    if (text !== undefined) {
      // The leading CR is the box's, not the text's: shown as a setting rather
      // than as a blank first line, so that saving writes back what the file
      // already had instead of a second one.
      lead = check(LEAD_LABEL, LEAD_TITLE, AGAT.dosfile.hasLead(text));
      area = el('textarea');
      area.value = AGAT.dosfile.dropLead(text);
      box.appendChild(area);
    }
    var r = el('div', 'dos-acts');
    if (area) {
      r.appendChild(button('Save', 'Write it back as a T file', function () {
        self.act(function () {
          // `put` replaces this very file, the new one written before the old
          // is removed — so a disk with no room says so and the file is still
          // there. The popup closes only once something has been written.
          self.lead = lead.box.checked;
          var wrote = self.put(AGAT.dosfile.pack(area.value, {
            text: true, lead: self.lead, name: e.name, locked: e.locked }),
            e.name, e);
          if (wrote) { self.open = ''; self.shutView(); }
        });
      }));
    }
    r.appendChild(button('Cancel', null, shut));
    if (lead) r.appendChild(lead);
    box.appendChild(r);
    // The cursor goes in the text, which is what the click asked for.
    setTimeout(function () { if (area) area.focus(); }, 0);
    return box;
  };

  // A T file typed from nothing. The name comes first, because an empty box
  // with no name on it is not yet a file.
  DosUI.prototype.newText = function () {
    var self = this;
    if (!this.writable) { this.say(this.lockedWhy(), true); return; }
    var box = el('div', 'dos-text');
    var top = el('div', 'dos-acts');
    var nm = el('input', 'dos-nm');
    nm.type = 'text';
    nm.maxLength = 30;
    nm.placeholder = 'name';
    top.appendChild(el('span', 'key', 'New T file'));
    top.appendChild(nm);
    box.appendChild(top);
    var area = el('textarea');
    box.appendChild(area);
    // Nothing to read the setting off for a file that does not exist yet, so
    // it carries over from the last one edited in this panel.
    var lead = check(LEAD_LABEL, LEAD_TITLE, this.lead);
    var r = el('div', 'dos-acts');
    r.appendChild(button('Save', null, function () {
      self.act(function () {
        if (!nm.value) throw new Error('the file needs a name');
        self.lead = lead.box.checked;
        // Put away only once it is on the disk: a replace that was declined
        // must not take the text that was typed with it.
        if (self.put(AGAT.dosfile.pack(area.value, {
          text: true, lead: self.lead, name: nm.value }), nm.value)) self.hideForm();
      });
    }));
    r.appendChild(button('Cancel', null, function () { self.hideForm(); }));
    r.appendChild(lead);
    box.appendChild(r);
    this.showForm(box);
    setTimeout(function () { nm.focus(); }, 0);
  };

  // ---- files in ------------------------------------------------------------

  // One at a time, because one of them may stop and ask: a queue of forms all
  // up at once is not an answerable question.
  DosUI.prototype.take = function (files) {
    var self = this, chain = Promise.resolve(), i;
    var step = function (f) {
      return function () {
        return self.takeOne(f).catch(function (err) { self.say(err.message, true); });
      };
    };
    for (i = 0; i < files.length; i++) chain = chain.then(step(files[i]));
    return chain;
  };

  DosUI.prototype.takeOne = function (file) {
    var self = this;
    return file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var s = AGAT.sniff(bytes, file.name);
      // A disk is not a file to put on a disk. Whoever mounted us may be able
      // to open it instead; on the emulator page nobody can, because the panel
      // edits the disk that is in the drive.
      if (s.kind && s.kind !== 'fil') {
        if (self.onImage) return self.onImage(file, s);
        throw new Error(file.name + ' is a disk image — drop it on the screen to run it');
      }
      if (!self.dos) throw new Error('no disk open to put ' + file.name + ' on');
      if (!self.writable) throw new Error(self.lockedWhy());
      // A .fil knows its own name, type and lock bit, so it needs no questions.
      if (s.kind === 'fil') {
        return self.put(AGAT.dosfile.pack(bytes, {}),
                        AGAT.dosfile.defaultName(file.name));
      }
      return self.ask(file, bytes);
    });
  };

  // What DOS needs to know that the bytes do not say: a name, a type, and for
  // a B file the address it loads at. One row of controls rather than a dialog
  // — the answer is three fields and it belongs beside the list it is joining.
  DosUI.prototype.ask = function (file, bytes) {
    var self = this;
    var isText = /\.(txt|text|md)$/i.test(file.name);
    var box = el('div', 'dos-form-in');

    var r1 = el('div', 'dos-acts');
    r1.appendChild(el('span', 'key', 'Add'));
    var nm = el('input', 'dos-nm');
    nm.type = 'text';
    nm.maxLength = 30;
    nm.value = AGAT.dosfile.defaultName(file.name);
    r1.appendChild(nm);

    var ty = el('select');
    ty.title = 'DOS file type';
    AGAT.Dos33.TYPES.split('').forEach(function (letter) {
      var o = el('option', null, letter);
      o.value = letter;
      ty.appendChild(o);
    });
    ty.value = isText ? 'T' : 'B';
    r1.appendChild(ty);

    var ad = el('input', 'dos-ad');
    ad.type = 'text';
    ad.placeholder = '$2000';
    ad.title = 'Where a B file loads';
    r1.appendChild(ad);

    var tx = check('UTF-8 text',
      'Re-encode UTF-8 into the Agat character set, with $8D line endings', isText);
    r1.appendChild(tx);
    var lead = check(LEAD_LABEL, LEAD_TITLE, this.lead);
    r1.appendChild(lead);

    var sync = function () {
      ad.hidden = ty.value !== 'B';
      tx.hidden = ty.value !== 'T';
      lead.hidden = ty.value !== 'T' || !tx.box.checked;
    };
    tx.box.addEventListener('change', sync);
    ty.addEventListener('change', sync);
    sync();

    box.appendChild(r1);
    box.appendChild(el('div', 'dim', file.name + ', ' + bytes.length + ' bytes'));

    return new Promise(function (resolve) {
      var done = function () { self.hideForm(); resolve(); };
      var r2 = el('div', 'dos-acts');
      r2.appendChild(el('span', 'key', ''));
      r2.appendChild(button('Add', null, function () {
        self.act(function () {
          var text = ty.value === 'T' && tx.box.checked;
          var input = text ? new TextDecoder().decode(bytes) : bytes;
          if (text) self.lead = lead.box.checked;
          // Put away only once the file is on the disk: a replace that was
          // declined leaves the question standing rather than dropping it.
          if (self.put(AGAT.dosfile.pack(input, {
            name: nm.value,
            type: AGAT.Dos33.typeByte(ty.value),
            addr: ad.value, addrLabel: ad.value,
            text: text, lead: text && self.lead,
          }), nm.value)) done();
        });
      }));
      r2.appendChild(button('Cancel', null, done));
      box.appendChild(r2);
      self.showForm(box);
      setTimeout(function () { nm.focus(); nm.select(); }, 0);
    });
  };

  // The last step for everything that arrives: a name that is already taken is
  // asked about, because replacing is what the answer usually is and losing
  // the old file silently is not. `over` is a file the caller already knows it
  // is replacing — the one open in the text editor — and is not asked about,
  // because "this file is already on the disk" is not a question about the
  // file you are saving. Returns whether anything was written.
  //
  // **The new file is written before the old one is removed**, so a create that
  // fails leaves the disk exactly as it was. The order costs room — for a
  // moment both are on the disk — and a disk too full to hold both is the one
  // case that has to be asked about a second time, because then the old file
  // really is gone before the new one exists.
  DosUI.prototype.put = function (got, fallback, over) {
    var name = got.name || fallback || '';
    if (!name) throw new Error('the file needs a name');
    var dos = this.dos, clash = dos.match(name), made, i;
    var news = over ? clash.filter(function (o) { return key(o) !== key(over); })
                    : clash;
    if (news.length &&
        !window.confirm('"' + news[0].name + '" is already on the disk. Replace it?')) {
      return false;
    }
    try {
      made = dos.create(name, got.type, got.data, { locked: got.locked });
    } catch (e) {
      // Only for the two ways a disk can be too full to hold both — no room
      // for the sectors, no room in the catalog. Anything else (a name that
      // will not fit, a sector that will not decode) would fail again after
      // deleting, having destroyed the file for nothing.
      if (!clash.length ||
          !(/are free$/.test(e.message) || /catalog is full$/.test(e.message))) throw e;
      if (!window.confirm(e.message + '.\n\nDelete "' + clash[0].name +
                          '" first and write over it?')) return false;
      for (i = 0; i < clash.length; i++) dos.remove(clash[i]);
      clash = [];
      made = dos.create(name, got.type, got.data, { locked: got.locked });
    }
    for (i = 0; i < clash.length; i++) dos.remove(clash[i]);
    this.say('wrote "' + name + '" (' + AGAT.Dos33.typeLetter(got.type) + ', ' +
             made.sectors + ' sectors)');
    this.changed();
    return true;
  };

  // ---- files out -----------------------------------------------------------

  DosUI.prototype.save = function (entry, how) {
    try {
      var got = AGAT.dosfile.unpack(this.dos, entry, how);
      if (got.text !== undefined) {
        download(got.name, [got.text], 'text/plain;charset=utf-8');
      } else {
        download(got.name, [got.bytes]);
      }
      this.say(got.name + ', ' +
               (got.text !== undefined ? got.text.length + ' characters'
                                       : got.bytes.length + ' bytes'));
    } catch (e) {
      this.say(e.message, true);
    }
  };

  // ---- the form area -------------------------------------------------------

  DosUI.prototype.showForm = function (node) {
    this.formEl.textContent = '';
    this.formEl.appendChild(node);
    this.formEl.hidden = false;
  };

  DosUI.prototype.hideForm = function () {
    this.formEl.textContent = '';
    this.formEl.hidden = true;
  };

  AGAT.DosUI = DosUI;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
