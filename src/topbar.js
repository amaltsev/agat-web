// The top row's menu, which is the same menu on all three pages.
//
// Each page writes its own masthead — the logo, then the page's name, and on
// index.html the pair is the control that starts the machine over. What is
// shared is the row's right-hand end: one button, and behind it the three
// pages, the page's own About, and where the source is. The list lives here
// rather than three times in three files, so a page added later is added once
// and shows up on all of them.
//
// About is a scroll and not a jump: index.html's address is the machine's —
// the container it is running, the model, the memory sizes — and following an
// `#help` fragment would throw all of that away. The other two pages have no
// use for their fragment either, so all three scroll.
//
// No DOM is touched at load: tools/harness.js evaluates every src/ module in a
// sandbox with no `document`.
(function (AGAT) {
  'use strict';

  // href, face. An empty href is the page's own About, which is handled here.
  var ITEMS = [
    ['index.html', 'Emulator'],
    ['edit-agc.html', 'Container editor'],
    ['edit-dos.html', 'DOS Viewer/Editor'],
    ['', 'About'],
    ['https://github.com/amaltsev/agat-web', 'Source on GitHub']
  ];

  // The page the menu is on gets a dim word rather than a link to itself.
  function mount(head, here) {
    var btn = document.createElement('button');
    btn.className = 'burger';
    btn.type = 'button';
    btn.title = 'The other pages, and what this one is';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Menu');
    btn.textContent = '☰';

    var menu = document.createElement('nav');
    menu.className = 'menu';
    menu.hidden = true;

    ITEMS.forEach(function (it) {
      var href = it[0], face = it[1];
      if (href && href === here) {
        var span = document.createElement('span');
        span.className = 'here';
        span.textContent = face;
        menu.appendChild(span);
        return;
      }
      var a = document.createElement('a');
      a.href = href || '#';
      a.textContent = face;
      // Off the site, so a new tab: the emulator page is a running machine,
      // and a disk written to and not saved does not survive leaving it.
      if (href.indexOf('http') === 0) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      if (!href) {
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          open(false);
          var help = document.getElementById('help');
          if (help) help.scrollIntoView({ behavior: 'smooth' });
        });
      }
      menu.appendChild(a);
    });

    function open(up) {
      menu.hidden = !up;
      btn.setAttribute('aria-expanded', up ? 'true' : 'false');
    }

    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      open(menu.hidden);
    });

    // Anywhere else on the page closes it. Mousedown rather than click, so the
    // menu is gone before whatever was clicked under it acts — and on the
    // emulator page a click on the screen is the pointer being handed to the
    // machine, which must not also be a click that lands inside a menu.
    document.addEventListener('mousedown', function (ev) {
      if (!menu.hidden && !menu.contains(ev.target) && ev.target !== btn) open(false);
    });

    // Esc closes it, but only while the keyboard is in the row: on the
    // emulator page Esc is how the pointer is taken back from the machine.
    head.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !menu.hidden) { open(false); btn.focus(); }
    });

    head.appendChild(btn);
    head.appendChild(menu);
  }

  AGAT.TopBar = { mount: mount };
})(window.AGAT = window.AGAT || {});
