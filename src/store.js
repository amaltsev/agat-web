// Saves in the browser, and the list that shows them.
//
// A save here is an `.agc` — the same text **Save** downloads, written to
// IndexedDB instead of to a file. That is the whole design: there is no second
// format, no second reader, and a save loaded back out goes through
// `App.load()` the way a dropped file does, state block and all. Anything the
// container can carry is carried, and anything the page learns to put in a
// container is in the saves for free.
//
// **IndexedDB rather than localStorage.** A container with an 840K disk in it
// is upwards of half a megabyte; localStorage is a five-megabyte budget of
// UTF-16 and would hold two. IndexedDB also takes a string without a base64
// tax, and — with `navigator.storage.persist()` — is what an installed copy
// keeps rather than what the browser throws away when the disk fills up. That
// persistence is the entire point: a page whose saves are evicted while nobody
// is looking is worse than one that never offered to save.
//
// **Two object stores, not one.** `saves` holds what a row needs — the title,
// the machine, the size, when it was written — and `data` holds the container
// text under the same key. Drawing the list has to read every record, and with
// one store that means dragging every megabyte off the disk to print a date.
//
// The store is opened by probing for it, never by testing the protocol: a
// checkout opened as a file:// page has IndexedDB in some browsers and not in
// others, and a private window may have the object and refuse to open it.
// `Store.open()` resolves to null wherever any of that goes wrong, and the
// panel then offers a file and says why.
//
//   AGAT.Store.open().then(function (store) {
//     if (!store) …                              // no store here
//     return store.put({ name: …, text: …, … });
//   });
//
// `Store.memory()` is the same object over a plain array, for `check.js saveui`
// and for nothing else — a save that vanishes with the tab is not a save, so
// the page never falls back to it.
(function (AGAT) {
  'use strict';

  var DB = 'agat', DB_VERSION = 1, META = 'saves', DATA = 'data';

  // A key that sorts by when it was made and does not collide with a second
  // save in the same millisecond. Not autoIncrement: the same key has to go
  // into both stores, and knowing it before the transaction opens is simpler
  // than threading a generated one across two puts.
  function newId() {
    return Date.now().toString(36) + '-' +
           Math.floor(Math.random() * 0x1000000).toString(36);
  }

  // What a row is, out of what a save was put with. Held apart from the text so
  // the list can be drawn without reading the containers themselves.
  function metaOf(rec) {
    return {
      id: rec.id || newId(),
      name: rec.name,                    // the filename it would export as
      title: rec.title || rec.name,      // what the container calls itself
      model: rec.model,
      ram: rec.ram,                      // base RAM in KB
      cycles: rec.cycles || 0,           // the machine's own clock, at the save
      take: rec.take || 0,               // and the recording in it, in cycles
      size: rec.text.length,
      saved: rec.saved || Date.now(),
    };
  }

  // ---- the IndexedDB backend ------------------------------------------------

  function req(r) {
    return new Promise(function (ok, no) {
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error || new Error('store failed')); };
    });
  }

  // A transaction rather than its requests: a write is only a write once the
  // transaction commits, and `oncomplete` is the only event that says so.
  // Quota is reported here and not on the request — an over-budget put fails
  // the whole transaction — so this is where the message worth showing is made.
  function done(tx) {
    return new Promise(function (ok, no) {
      tx.oncomplete = function () { ok(); };
      tx.onabort = tx.onerror = function () {
        var e = tx.error || new Error('store failed');
        no(e.name === 'QuotaExceededError'
           ? new Error('no room left in the browser — delete a save')
           : e);
      };
    });
  }

  function IdbStore(db) { this.db = db; }

  IdbStore.prototype.list = function () {
    var tx = this.db.transaction(META, 'readonly');
    return req(tx.objectStore(META).getAll()).then(function (rows) {
      return rows.sort(function (a, b) { return b.saved - a.saved; });
    });
  };

  IdbStore.prototype.put = function (rec) {
    var meta = metaOf(rec);
    var tx = this.db.transaction([META, DATA], 'readwrite');
    tx.objectStore(META).put(meta);
    tx.objectStore(DATA).put({ id: meta.id, text: rec.text });
    return done(tx).then(function () { return meta; });
  };

  IdbStore.prototype.get = function (id) {
    var tx = this.db.transaction(DATA, 'readonly');
    return req(tx.objectStore(DATA).get(id)).then(function (row) {
      if (!row) throw new Error('that save is gone');
      return row.text;
    });
  };

  IdbStore.prototype.remove = function (id) {
    var tx = this.db.transaction([META, DATA], 'readwrite');
    tx.objectStore(META).delete(id);
    tx.objectStore(DATA).delete(id);
    return done(tx);
  };

  // ---- the memory backend, for the tests ------------------------------------

  function MemStore() { this.rows = []; this.text = {}; }

  MemStore.prototype.list = function () {
    return Promise.resolve(this.rows.slice().sort(function (a, b) {
      return b.saved - a.saved;
    }));
  };

  MemStore.prototype.put = function (rec) {
    var meta = metaOf(rec);
    this.rows.push(meta);
    this.text[meta.id] = rec.text;
    return Promise.resolve(meta);
  };

  MemStore.prototype.get = function (id) {
    var t = this.text[id];
    return t === undefined
      ? Promise.reject(new Error('that save is gone')) : Promise.resolve(t);
  };

  MemStore.prototype.remove = function (id) {
    var self = this;
    this.rows = this.rows.filter(function (r) { return r.id !== id; });
    delete self.text[id];
    return Promise.resolve();
  };

  // ---- opening one ----------------------------------------------------------

  // How much the browser is holding for this origin and how much it will hold,
  // for the line under the list. Both halves are optional — Safari answers
  // neither — and an answer nobody can give is not an error, it is a line the
  // panel leaves out.
  function usage() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) {
        return Promise.resolve(null);
      }
      return navigator.storage.estimate().then(function (e) {
        return { used: e.usage, quota: e.quota };
      }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  // Ask for the store to be kept. Chromium grants it to an installed copy
  // without prompting and refuses a page nobody has engaged with; Firefox
  // asks. Either way the answer is worth knowing and never worth blocking on,
  // so this is called beside the first save rather than before it.
  function persist() {
    try {
      if (!navigator.storage || !navigator.storage.persist) {
        return Promise.resolve(false);
      }
      return navigator.storage.persist().then(function (v) { return !!v; },
                                              function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  function open() {
    return new Promise(function (ok) {
      var r;
      try {
        if (!self.indexedDB) return ok(null);
        r = indexedDB.open(DB, DB_VERSION);
      } catch (e) { return ok(null); }
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(DATA)) {
          db.createObjectStore(DATA, { keyPath: 'id' });
        }
      };
      r.onsuccess = function () { ok(new IdbStore(r.result)); };
      // A private window that has the object and will not open it, a browser
      // holding the database open from another tab mid-upgrade: no store here,
      // which the panel can say something sensible about. `onblocked` fires
      // instead of either of the other two and would otherwise hang.
      r.onerror = function () { ok(null); };
      r.onblocked = function () { ok(null); };
    });
  }

  // ---- the list -------------------------------------------------------------

  // The rows, drawn into whatever element the panel gives it. Told what the
  // store is and what to do when a row is picked, and holding no state of its
  // own beyond the element: the panel redraws it after every change, so what is
  // on the screen is what a `list()` just said and never a cached copy of it.
  //
  //   var list = new AGAT.SaveList(element, {
  //     onLoad: function (rec) { … },    // a row was chosen
  //     onStatus: function (msg, isError) { … },
  //   });
  //   list.mount(store);                 // null for "there is no store"
  function SaveList(el, opts) {
    this.el = el;
    this.opts = opts || {};
    this.store = null;
  }

  SaveList.prototype.mount = function (store) {
    this.store = store || null;
    return this.refresh();
  };

  SaveList.prototype.refresh = function () {
    var self = this;
    if (!this.store) { this.draw([]); return Promise.resolve(); }
    return this.store.list().then(function (rows) {
      self.draw(rows);
      return usage().then(function (u) { self.drawUsage(u); });
    }, function (e) {
      self.draw([]);
      self.say(e.message, true);
    });
  };

  SaveList.prototype.say = function (msg, bad) {
    if (this.opts.onStatus) this.opts.onStatus(msg, bad);
  };

  function span(cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  // A stretch of machine time, as minutes and seconds — and hours where there
  // are any. Every duration on this page goes through here: how far into the
  // program a save is, how long a recording runs, how far a replay has got.
  // Machine time rather than the wall's, always: a paused machine and an
  // afternoon away from the desk both stop it, which is what makes it the
  // number that tells two saves of one program apart.
  function howLong(cycles) {
    var t = Math.round(cycles / AGAT.CPU_HZ);
    var s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    if (h) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
  }

  // Local time and no seconds: it is read by whoever is sitting here, and it
  // is answering "which of these is the one from this morning".
  function when(ms) {
    var d = new Date(ms), now = new Date();
    var day = d.toLocaleDateString(), today = now.toLocaleDateString();
    var clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return day === today ? clock : day + ' ' + clock;
  }

  // Never 0K: a save is a container and a container is never nothing, so a
  // round-to-zero reads as a row that failed to write rather than a small one.
  // Three steps, because the same function prints a save and a browser's whole
  // budget for the origin, and that is gigabytes.
  function size(n) {
    if (n >= 1024 * 1048576) return (n / (1024 * 1048576)).toFixed(1) + 'G';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'M';
    return Math.max(1, Math.round(n / 1024)) + 'K';
  }

  SaveList.prototype.draw = function (rows) {
    var self = this;
    this.el.textContent = '';
    if (!this.store) {
      this.el.appendChild(span('note', 'This browser has no place to keep ' +
                               'saves. Save to a file instead.'));
      return;
    }
    if (!rows.length) {
      this.el.appendChild(span('note', 'Nothing saved here yet.'));
      return;
    }
    rows.forEach(function (r) { self.el.appendChild(self.row(r)); });
  };

  SaveList.prototype.row = function (r) {
    var self = this;
    var el = document.createElement('div');
    el.className = 'save';
    // The machine and the weight of the file: worth having and not worth a
    // column on a phone, so it is said in full on the row and drawn only where
    // there is room for it.
    var what = 'Agat-' + r.model + ' ' + r.ram + 'K · ' + size(r.size);
    el.title = what;
    var open = document.createElement('button');
    open.className = 'save-name';
    open.textContent = r.title;
    // The row's own title again, because the button covers most of the row and
    // a title on a child is what a hover over it finds.
    open.title = what;
    open.addEventListener('click', function () {
      if (self.opts.onLoad) self.opts.onLoad(r);
    });
    el.appendChild(open);
    // How far in, then when it was taken: the first tells two saves of one
    // program apart and the second tells one program's saves from another's.
    // A save carrying a recording says how long *that* is instead, under a ▶:
    // the column is one field wide, and of the two numbers the recording is
    // the one somebody is looking for.
    el.appendChild(span('save-in', r.take ? '▶ ' + howLong(r.take)
                                          : howLong(r.cycles)));
    el.appendChild(span('save-when', when(r.saved)));
    el.appendChild(span('save-what', what));
    var del = document.createElement('button');
    del.className = 'save-del';
    del.textContent = '✕';
    del.title = 'Delete this save';
    del.setAttribute('aria-label', 'Delete ' + r.title);
    del.addEventListener('click', function () {
      // Asked about, the way the file manager asks before dropping a file.
      if (!confirm('Delete "' + r.title + '"?')) return;
      self.store.remove(r.id).then(function () {
        self.say('deleted ' + r.title);
        return self.refresh();
      }, function (e) { self.say(e.message, true); });
    });
    el.appendChild(del);
    return el;
  };

  // What the browser is holding, under the rows and ruled off from them: it is
  // about the store rather than about any save in it. Only the used half is
  // ours — the quota is the whole origin's and includes the cached shell — so
  // it is written as what is here rather than as a gauge.
  SaveList.prototype.drawUsage = function (u) {
    if (!u || !u.used) return;
    this.el.appendChild(document.createElement('hr'));
    this.el.appendChild(span('note', 'Total ' + size(u.used) +
                             (u.quota ? ' of about ' + size(u.quota) +
                                        ' available' : '')));
  };

  AGAT.Store = {
    open: open, memory: function () { return new MemStore(); },
    usage: usage, persist: persist,
  };
  // The one way a moment is written on this page, wherever it is written: the
  // saves list, and the Rec panel saying when a take was made.
  AGAT.when = when;
  AGAT.howLong = howLong;
  AGAT.SaveList = SaveList;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
