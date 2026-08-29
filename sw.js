// The service worker: what makes the page installable, and what answers when
// the network does not. It is not a src/ module — nothing in Node evaluates it,
// and it has no window, no DOM and no AGAT. It is still written in the same ES5
// dialect as src/, so that reading one after the other is not a gear change.
//
// Scope is the directory this file is served from, which is why it is at the
// root beside index.html rather than in src/: a worker cannot claim pages above
// itself. Every path here is relative for the same reason the manifest's are —
// the app is served from /agat-web/ on GitHub Pages and from / in a checkout,
// and neither is allowed to be spelled out.
//
// Three answers, by what is being asked for:
//
//   the shell     stale-while-revalidate — the cache answers at once and the
//                 network refreshes the entry behind it, so a deploy is live on
//                 the next load and the whole shell moves together
//   examples/     cache-first, filled on first use — a program played once
//                 stays playable offline, and the 3.1M is never fetched up front
//   anything else network, untouched
//
// SHELL is tools/modules.js in load order, plus the pages, the sheet, the ROMs
// and the icons. `node tools/check.js pwa` asserts it against that list: a
// module added to src/ and not added here is a file the offline copy silently
// lacks.
//
// CACHE is not a release stamp and does not need bumping for a deploy —
// revalidation is what ships new code. Change it to throw the old cache away.
var CACHE = 'agat-shell-1';

var SHELL = [
  './',
  'index.html',
  'edit-dos.html',
  'edit-agc.html',
  'agat.css',
  'manifest.json',
  'roms/roms.js',
  'src/chars.js',
  'src/cpu6502.js',
  'src/mem7.js',
  'src/psrom7.js',
  'src/xram7.js',
  'src/xram9.js',
  'src/videosel.js',
  'src/videopal.js',
  'src/machine.js',
  'src/drive.js',
  'src/aim840.js',
  'src/gcr140.js',
  'src/unpack.js',
  'src/agc.js',
  'src/image.js',
  'src/sectors.js',
  'src/dos33.js',
  'src/disk840.js',
  'src/disk140.js',
  'src/video.js',
  'src/font.js',
  'src/mouse.js',
  'src/keyboard.js',
  'src/keyview.js',
  'src/info.js',
  'src/audio.js',
  'src/fil.js',
  'src/dosfile.js',
  'src/basic.js',
  'src/disasm.js',
  'src/dosui.js',
  'src/state.js',
  'src/app.js',
  'icons/agat-192.png',
  'icons/agat-512.png',
  'icons/agat-maskable-512.png',
  'icons/agat-180.png',
  'icons/favicon.svg'
];

// The shell as absolute URLs, resolved once against this file's own location,
// so a request can be tested for membership by its `url` — which is absolute,
// and which './' has to become before it can be compared to anything.
var SHELL_URLS = SHELL.map(function (p) { return new URL(p, self.location).href; });

function inShell(url) { return SHELL_URLS.indexOf(url) >= 0; }

// Every file, or none: a half-filled shell is a page that loads and then dies
// on a missing module, which looks like an emulator bug rather than a failed
// install. addAll is atomic in exactly that sense — one rejection and the
// install fails, and the previous worker, if any, stays in charge.
//
// The icons are the exception, and are taken one at a time and forgiven. They
// are decoration the browser fetches on its own terms, and artwork that 404s
// after a redesign must not be what takes the emulator offline. `check.js pwa`
// is where a missing icon is an error.
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    var app = SHELL.filter(function (p) { return p.indexOf('icons/') !== 0; });
    return c.addAll(app).then(function () {
      return Promise.all(SHELL.filter(function (p) {
        return p.indexOf('icons/') === 0;
      }).map(function (p) { return c.add(p).catch(function () {}); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

// One cache at a time. The examples live in it too, so a name change costs
// everything a reader has played — which is the point of changing it.
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.map(function (n) {
      return n === CACHE ? null : caches.delete(n);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  // A GET on this origin is the only thing worth an answer. Everything else —
  // a POST, another origin — goes to the network as if there were no worker,
  // which is what not calling respondWith() means.
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (inShell(url.href)) { e.respondWith(revalidate(req)); return; }

  // Everything the app fetches for itself: examples/ by the links on the page,
  // and a container an address names, which may be a path of the reader's own
  // beside them. Cached on the way past, and answered from the cache next time
  // — these are images of disks, and a disk image does not change under its
  // own name.
  if (/\/examples\//.test(url.pathname) || /\.(agc|dsk|aim|nib|fil)$/i.test(url.pathname)) {
    e.respondWith(cacheFirst(req));
  }
});

// Answer from the cache, then put whatever the network says in its place. The
// network copy is not awaited: the page has already been served, and a refresh
// that fails offline is not an error — it is the ordinary case.
function revalidate(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      var live = fetch(req).then(function (r) {
        if (r && r.ok) c.put(req, r.clone());
        return r;
      }, function () { return hit; });
      return hit || live;
    });
  });
}

function cacheFirst(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        if (r && r.ok) c.put(req, r.clone());
        return r;
      });
    });
  });
}
