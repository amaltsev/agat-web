// Keyboard. The machine reads $C000 for the last key with bit 7 set as the
// "a key is waiting" strobe, and clears the strobe with any access to $C010 —
// so the emulator only ever has to hold one key code.
//
// The Apple-II-shaped software on these disks expects uppercase ASCII and the
// arrow codes $08/$15/$0B/$0A. Russian text on screen comes from the Agat
// character generator, not from the keyboard, so no layout switching is needed.
(function (AGAT) {
  'use strict';

  var SPECIAL = {
    Enter: 0x0d,
    Escape: 0x1b,
    Backspace: 0x08,
    Tab: 0x09,
    ArrowLeft: 0x08,
    ArrowRight: 0x15,
    ArrowUp: 0x0b,
    ArrowDown: 0x0a,
    ' ': 0x20,
  };

  function keyCode(e) {
    if (SPECIAL[e.key] !== undefined) return SPECIAL[e.key];
    if (e.key.length !== 1) return -1;
    var c = e.key.toUpperCase().charCodeAt(0);
    if (c > 0x7f) return -1;
    if (e.ctrlKey && c >= 0x40 && c < 0x60) return c & 0x1f;
    return c;
  }

  // Attach to a DOM element. Returns a detach function.
  AGAT.attachKeyboard = function (target, machine, opts) {
    opts = opts || {};
    function onKeyDown(e) {
      if (e.metaKey || e.altKey) return;
      var c = keyCode(e);
      if (c < 0) return;
      machine.keyDown(c);
      if (opts.onKey) opts.onKey(c);
      e.preventDefault();
    }
    target.addEventListener('keydown', onKeyDown);
    return function () { target.removeEventListener('keydown', onKeyDown); };
  };

  AGAT.keyCode = keyCode;
})(typeof globalThis !== 'undefined' && (globalThis.AGAT = globalThis.AGAT || {}));
