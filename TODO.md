* Disk change support for writes. For when an editor is loaded from
  one disk, but the result wants to be written to another. For example
  to be able to actually edit some ASM code and save it. Maybe instead
  of overlays with patches we have now, we define more than one 'media'
  and it can be blank, with patches going over the blank media? Then the
  "system" boot disk can stay write protected (a flag in AGC), but the
  storage disk can then be changed to for work, replicating how it was
  done on device. A container that carries a `state` makes this sharper: the
  machine resumes into whatever disks the container names, so which media a
  saved session comes back to is a question the format now has to answer.
* A container that knows where it lives. A `hosted_at` field, with a digest to
  check the fetched copy against, would let a container dropped on the page put
  itself back into the address: today a dropped one cannot be named there at
  all, so the address carries its machine in full and not the program.
* What does "Boot" do exactly? Fix or document better.
* Sound card: https://agatcomp.ru/agat/Hardware/SoundNCL.shtml
* Configurable char gen: https://gsqsoft.atlassian.net/browse/AGT-1
* Make space smaller when it's the only key left in that area of
  the keyboard (or make it always smaller in custom "controls" driven
  keyboars, about half the normal width).
* `agc.js`'s `readJson` keeps only the fields it knows, so an unknown
  top-level or `media` field is dropped on load and gone from the next
  Save. AGC.md's implementer note asks a reader to carry through what it
  does not understand; only patch records do.
