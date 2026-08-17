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
// Both paragraphs are still plain text — a `<b>` in one is printed and not
// obeyed — with one thing recognised in them: a bare `http`/`https` address
// becomes a link. A container that names where a program is written up says so
// in the middle of a sentence as often as in its `url` field.
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

  // The address as it reads rather than as it is typed: on a row of its own the
  // scheme is noise, and so is a trailing slash. In prose it is left exactly as
  // the container wrote it, because there it is part of a sentence.
  function urlText(url) {
    return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }

  function link(url, text) {
    var a;
    if (!isWeb(url)) return tag('span', 'info-url', text);
    a = tag('a', 'info-url', text);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  // A web address written into the prose. It has to start at a scheme, so
  // nothing else in a sentence can turn into a link, and it runs to the first
  // space.
  var WEB = /https?:\/\/\S+/;

  // Trailing punctuation belongs to the sentence and not to the address: `see
  // https://x/y.` ends in a full stop. A closing bracket is the address's own
  // only where the address opened one.
  function trimTail(url) {
    var c;
    while (url) {
      c = url.charAt(url.length - 1);
      if ('.,;:!?»'.indexOf(c) < 0 && !(c === ')' && url.indexOf('(') < 0)) break;
      url = url.slice(0, -1);
    }
    return url;
  }

  // One paragraph, with any web address in it made a link. Text and links go in
  // as separate nodes and never as markup: a container is a file from somewhere
  // else, and the only thing recognised in what it wrote is a scheme it typed
  // itself. What is not `http`/`https` is not a scheme this will follow, so a
  // `javascript:` URL is left standing as the text it is.
  function prose(cls, s) {
    var d = tag('div', cls, ''), rest = s, m, url;
    while ((m = WEB.exec(rest))) {
      url = trimTail(m[0]);
      if (m.index) d.appendChild(document.createTextNode(rest.slice(0, m.index)));
      d.appendChild(link(url, url));
      rest = rest.slice(m.index + url.length);
    }
    if (rest) d.appendChild(document.createTextNode(rest));
    return d;
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
    if (about.url) who.push(link(about.url, urlText(about.url)));
    if (who.length) {
      row = tag('div', 'info-who', '');
      for (i = 0; i < who.length; i++) {
        if (i) row.appendChild(tag('span', 'info-sep', '·'));
        row.appendChild(who[i]);
      }
      el.appendChild(row);
    }
    if (about.info) el.appendChild(prose('info-text', about.info));
    if (about.hint) el.appendChild(prose('info-hint', about.hint));
  };
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
