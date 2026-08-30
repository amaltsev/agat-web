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
* Merging patches from the *emulator* page. `edit-agc.html` does it per medium
  and `node tools/agc.js merge` on the command line; the emulator's own **Save
  AGC** still only ever appends a patch, which is right for a disk that is
  going back and wrong for one that is not. Add a "merge-in writes"
  option on save?
* Quick saves: the machine snapshotted on hide, so a tab switch is not a
  loss. The store, the panels and the container round trip are in place —
  `src/store.js` and the Load panel — so what is left is the ring itself and
  the questions in tmp/quick-save-open-questions.md: what a ring belongs to,
  how it is evicted, which pause snapshots, whether loading snapshots first,
  and splitting `written` so a save can quiet the leave dialogs.
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
* In "Load" saves overview, wall clock is not enough - should be a date.
