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
// menu.** A menu would be the page's first popup — positioning, outside-click,
// keyboard dismissal, a layer — and the strip has somewhere to put the rename
// field and the text editor, which a menu would need a second surface for. The
// `⋯` at the right edge of every row is what says a row opens.
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
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < 4) s = '0' + s;
    return '$' + s;
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
    this.mode = '';                        // '', 'rename' or 'text', in that strip
    this.deleted = false;                  // are the tombstones shown
    this.lead = false;                     // what a new T file gets in front

    this.root = el('div', 'dos');
    this.headEl = el('div', 'dos-head');
    this.noteEl = el('div', 'dos-note');
    this.listEl = el('div', 'dos-list');
    this.formEl = el('div', 'dos-form');
    this.footEl = el('div', 'dos-foot');
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

  DosUI.prototype.fileEl = function (e) {
    var self = this, k = key(e);
    var wrap = el('div', 'dos-file' + (this.open === k ? ' open' : ''));
    var row = el('div', 'dos-row' + (e.deleted ? ' gone' : ''));
    row.appendChild(el('span', 'dos-mark', e.deleted ? 'x' : e.locked ? '*' : ''));
    row.appendChild(el('span', 'dos-type', e.typeLetter));
    row.appendChild(el('span', 'dos-sect', pad3(e.sectors)));
    row.appendChild(el('span', 'dos-name', e.name));

    var d = AGAT.dosfile.describe(this.dos, e);
    var dim = 'ts=' + d.tsTrack + '/' + d.tsSector;
    if (d.error) dim += ' ' + d.error;
    else {
      // Not the count in the column to the left: that is DOS's, and it counts
      // the file's T/S lists as well as its data — and it is one byte, so it
      // stops at 255. This is what the chain actually reaches.
      dim += ' sectors=' + d.sectors;
      if (d.len !== undefined) dim += ' len=' + d.len;
      if (d.addr !== undefined) dim += ' addr=' + hex(d.addr);
    }
    if (e.deleted) dim += ' deleted, T/S list was on track ' + e.tsTrack;
    row.appendChild(el('span', 'dos-dim', dim));
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

  DosUI.prototype.stripEl = function (e) {
    var self = this, s = el('div', 'dos-strip');
    var bar = el('div', 'dos-acts');

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
    // The two that open something rather than doing it carry the page's
    // ellipsis, which also keeps the button that opens the rename field from
    // reading the same as the one that commits it.
    act.appendChild(button('Edit text…', 'Read it as Agat text and write it back',
      function () { self.mode = 'text'; self.refresh(); }));
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
    if (this.mode === 'text') s.appendChild(this.textEl(e));
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

  // ---- text ----------------------------------------------------------------

  // A T file, decoded, in a box. Writing it back is a delete and a create,
  // which is what `put --force` does: DOS has no way to grow a file in place.
  DosUI.prototype.textEl = function (e) {
    var self = this, box = el('div', 'dos-text'), area = null, text;
    var shut = function () { self.mode = ''; self.refresh(); };
    try {
      text = AGAT.dosfile.unpack(this.dos, e, 'text').text;
    } catch (err) {
      // A file whose chain will not decode has no text to show. The message
      // is what there is, and Cancel is the way out of it.
      box.appendChild(el('div', 'dim', err.message));
    }
    var lead = null;
    if (text !== undefined) {
      if (e.type !== 0x00) {
        box.appendChild(el('div', 'dim', 'Type ' + e.typeLetter +
          ', not T — read as text anyway.'));
      }
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
          // there. The strip closes only once something has been written.
          self.lead = lead.box.checked;
          var wrote = self.put(AGAT.dosfile.pack(area.value, {
            text: true, lead: self.lead, name: e.name, locked: e.locked }),
            e.name, e);
          if (wrote) { self.open = ''; self.mode = ''; self.refresh(); }
        });
      }));
    }
    r.appendChild(button('Cancel', null, shut));
    if (lead) r.appendChild(lead);
    box.appendChild(r);
    // The list scrolls, and the editor opens somewhere down it. Bring the row
    // that saves into view — the box is no use without it — and put the cursor
    // in the text, which is what the click asked for.
    setTimeout(function () {
      if (area) area.focus();
      if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
    }, 0);
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
