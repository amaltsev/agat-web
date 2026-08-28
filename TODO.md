* A container that knows where it lives. A `hosted_at` field, with a digest to
  check the fetched copy against, would let a container dropped on the page put
  itself back into the address: today a dropped one cannot be named there at
  all, so the address carries its machine in full and not the program.
* Sound card: https://agatcomp.ru/agat/Hardware/SoundNCL.shtml
* Configurable char gen: https://gsqsoft.atlassian.net/browse/AGT-1
* `agc.js`'s `readJson` keeps only the fields it knows, so an unknown
  top-level or `media` field is dropped on load and gone from the next
  Save. AGC.md's implementer note asks a reader to carry through what it
  does not understand; only patch records do.
* AGC structure editor Web UI. The CLI is `tools/agc.js`: `set` for the
  metadata, `get`/`add`/`rm` for the media, `--at` for the order, `merge`
  for the patches. Nothing on the page does any of it — should it be part
  of the "Save AGC" prompt?
* The CLI drives one medium of a container, on the machine that container's
  `model` and `ram` name. `harness.js` unwraps an `.agc` to `media[0]`, and
  nothing hands `makeMachine` the container's `machine.slots` — so a second
  drive, a card the container asks for, and every medium after the first are
  all invisible to `check.js`, `shot.js` and `corpus.js`, which fit cards only
  from flags of their own. The page reads all of it, and where a disk goes is
  `App.place`/`App.mountSpot`: it is `src/` already, but reachable only through
  an `App`.
* PWA - for both desktop and phone app installs
* A way to merge patches into the disk from the page. `node tools/agc.js
  merge` does it on the command line. Especially useful for blank disks,
  but might be useful for all. Think the UI through if decided to
  implement this.
* Cache-busting on loading from src/ and agat.css
