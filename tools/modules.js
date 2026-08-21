// The module list, in load order. Single source of truth: index.html's <script>
// tags and the Node harness both come from here, and tools/check.js asserts the
// two agree — otherwise it is entirely possible to have something that works
// headlessly and renders a blank page in the browser.
const MODULES = [
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
  'src/state.js',
  'src/app.js',
];

module.exports = { MODULES };
