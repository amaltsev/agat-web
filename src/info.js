// What the container says it is, drawn as a card.
//
// A container carries a `title`, an `author`, a `date` and a `url` — what the
// program is and where it came from — then `info`, which says the same thing at
// whatever length it takes, and last a `hint`, the one thing whoever is about to
// run it has to be told. Those six are the whole card, and they are the
// container's own words: nothing the emulator worked out goes on it, which is
// what keeps it apart from the status line beside the bar.
//
// The hint is drawn heavier than the prose above it. It is the line that is
// worth acting on rather than reading, and a card with two paragraphs on it is
// a card where that has to be visible without being read first.
//
// `notes` is deliberately not here. A hint is shown and `notes` is the file
// talking to whoever opens it (AGC.md).
//
// A bare image brings none of the six, and then the card draws nothing at all
// and leaves its host element empty for the stylesheet's `:empty` to hide, as
// the controls card and the keyboard are hidden.
//
// No DOM is touched at load: tools/harness.js evaluates every src/ module in a
// sandbox with no `document`.
(function (AGAT) {
  'use strict';

  function tag(name, cls, text) {
    var e = document.createElement(name);
    e.className = cls;
    e.textContent = text;
    return e;
  }

  // A container is a file from somewhere else and its `url` is whatever string
  // it chose. Only http(s) becomes a link — a `javascript:` URL made clickable
  // would be the container running code on this page — and anything else is
  // still printed, because it is what the file says.
  function isWeb(url) { return /^https?:\/\/\S+$/i.test(url); }

  // The address as it reads rather than as it is typed: on a line this short the
  // scheme is noise, and so is a trailing slash.
  function urlText(url) {
    return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }

  function where(url) {
    var a;
    if (!isWeb(url)) return tag('span', 'info-url', url);
    a = tag('a', 'info-url', urlText(url));
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  // `el` is emptied and refilled: the card belongs to whatever is loaded, so a
  // second container's identity replaces the first one's rather than joining it,
  // and an image that came with no container leaves the element empty.
  //
  // Each of the six is drawn only if it is there, so a container that names an
  // author and nothing else gets a line with an author on it rather than a row
  // of empty separators.
  AGAT.drawInfo = function (el, about) {
    about = about || {};
    var who = [], row, i;
    el.innerHTML = '';
    if (about.title) el.appendChild(tag('div', 'info-name', about.title));
    if (about.author) who.push(tag('span', 'info-by', about.author));
    if (about.date) who.push(tag('span', 'info-date', about.date));
    if (about.url) who.push(where(about.url));
    if (who.length) {
      row = tag('div', 'info-who', '');
      for (i = 0; i < who.length; i++) {
        if (i) row.appendChild(tag('span', 'info-sep', '·'));
        row.appendChild(who[i]);
      }
      el.appendChild(row);
    }
    if (about.info) el.appendChild(tag('div', 'info-text', about.info));
    if (about.hint) el.appendChild(tag('div', 'info-hint', about.hint));
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
