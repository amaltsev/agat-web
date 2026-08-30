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
* Actions recorder, replayable in the emulator. `src/record.js` and
  `App.runTo` are in — a take is the snapshot plus every input stamped with
  its cycle, a write or a machine change ends one, and `check.js record`
  proves a replay lands each input on the cycle it was recorded on. What is
  left:
  - The recording into the container, one per container: an AGC field, the
    reader, the writer, `edit-agc.html` and AGC.md together, or the editor
    drops it on the next round trip. Sizing wants a rule — a take carries its
    own gzipped RAM.
  - The panel. On load a recording shows in a block like the controls do;
    clicking it loads the state and plays. "Record"? "Time Machine"? Its
    stub-document test goes beside `dosui` and `agcui`.
  - Take over mid-replay. `stopPlaying` already hands the machine back live,
    so what is missing is the control and the rule for it — only from Pause,
    or an explicit button, since the doors are shut while a replay runs.
  - Speed control, and then rewind: `runTo` is the seam for both. Rewind
    wants keyframes — re-simulation runs about 15x real time, so a snapshot
    every 30 s of machine time puts a 10-second step under a second.
  - A write inside a take, which means carrying the medium's bytes as of its
    start and keeping a replay's writes out of the patches that get saved.
* Printer support - a lot more details on https://gsqsoft.atlassian.net/browse/AGT-8
* In "Load" saves overview, wall clock is not enough - should be a date.
