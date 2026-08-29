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
* The CLI drives one medium of a container, on the machine that container's
  `model` and `ram` name. `harness.js` unwraps an `.agc` to `media[0]`, and
  nothing hands `makeMachine` the container's `machine.slots` — so a second
  drive, a card the container asks for, and every medium after the first are
  all invisible to `check.js`, `shot.js` and `corpus.js`, which fit cards only
  from flags of their own. The page reads all of it, and where a disk goes is
  `App.place`/`App.mountSpot`: it is `src/` already, but reachable only through
  an `App`.
* Merging patches from the *emulator* page. `edit-agc.html` does it per medium
  and `node tools/agc.js merge` on the command line; the emulator's own **Save
  AGC** still only ever appends a patch, which is right for a disk that is
  going back and wrong for one that is not. Add a "merge-in writes"
  option on save?
* Rework how saving and loading works. Supporting both the saves in
  browser normal flow, and persistence in the installed PWA app (which
  intuitively feelds like it should be preserving because it's an app-like
  UI, but currently it does not).
  - "Open..." -> "Load". Unfolds a panel with options to open a file, or
    load from internally saved states and the quick-save. Shows a
    timestamp and some basic info for the quick save and internal saves
    (need a better name for the internal save).
  - "Save AGC" -> "Save". The panel offers to export as an AGC (current
    functionality), or save the same into the PWA local storage (gated on
    availability, not working in file:///).
  - On hide (and on pressing "pause" in the ui) the current machine
    state is saved into "quick save" slot, overriding it unconditionally.
  - Need a way to trim old unused local storage saves - manually or
    automatically? Probably just an explicit trash icon is the cleanest.
* Actions recorder, replayable in the emulator
  - A button to start recording. Saves the current machine state, then
    records input register changes for keyboard & mouse and CPU cycle on
    which they happen. Will also need to record the wall clock of when the
    machine was started.
  - If we extend "pause" / "play" analogy further, then there could be
    "rewind" and "ff" buttons as well, going back or forward in recorded
    time. Maybe one click is 10 seconds, several quick clicks in a row
    progressively further, like youtube. Forward playing will likely
    benefit from a speed control - normal by default, but also buttons
    to slow down/speed up.
  - The recording goes into the container on save. Should probably
    design for several named recordings in one container.
  - On load recordings are shown in blocks similar to how controls
    show. Clicking a recording loads the state and starts playing. A
    user can pause/rewind/forward the recording, or take over and start
    controlling the machine at any point. To avoid accidental take
    overs, maybe that works only from Pause state, or we have an
    explicit control for take over and normally keyboard and mouse are
    inactive.
  - The UI seems relatively complex, so should open as a
    panel... "Record"? "Time Machine"?
* Printer support - a lot more details on https://gsqsoft.atlassian.net/browse/AGT-8
