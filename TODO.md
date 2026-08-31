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
* Actions recorder, replayable in the emulator. `src/record.js`, `App.runTo`
  and the container's `recordings` are in — a take is the snapshot plus every
  input stamped with its cycle, a write or a machine change ends one, and
  `check.js record` proves a replay lands each input on the cycle it was
  recorded on, including one read back out of a container. What is left:
  - Naming a take, and offering it where a container's controls show. The
    panel calls one by its length and what stopped it; a container that
    carries one has a name for it and nothing on the page reads it yet.
  - Speed control, and then rewind: `runTo` is the seam for both. Rewind
    wants keyframes — re-simulation runs about 15x real time, so a snapshot
    every 30 s of machine time puts a 10-second step under a second.
  - The disk a take assumes. A write after a take was made, saved into the
    container, leaves the take starting from a disk it never saw — it still
    plays, it may not play the same. Left alone deliberately until it is seen
    to bite; then a digest of the disk in the take, so a mismatch is said
    rather than guessed at, and after that the take carrying its own diff from
    the payload, which is `writeBack`'s machinery at record time and belongs
    with the merge-on-save item above.
  - A write *inside* a take, which is the same diff plus keeping a replay's
    writes out of the patches that get saved.
* Printer support - a lot more details on https://gsqsoft.atlassian.net/browse/AGT-8
* In "Load" saves overview, wall clock is not enough - should be a date.
