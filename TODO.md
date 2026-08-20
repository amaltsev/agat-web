* Disk change support for writes. For when an editor is loaded from
  one disk, but the result wants to be written to another. For example
  to be able to actually edit some ASM code and save it. Maybe instead
  of overlays with patches we have now, we define more than one 'media'
  and it can be blank, with patches going over the blank media? Then the
  "system" boot disk can stay write protected (a flag in AGC), but the
  storage disk can then be changed to for work, replicating how it was
  done on device.
* A container that knows where it lives. A `hosted_at` field, with a digest to
  check the fetched copy against, would let a container dropped on the page put
  itself back into the address: today a dropped one cannot be named there at
  all, so the address carries its machine in full and not the program.
* What does "Boot" do exactly? Fix or document better.
* Sound card: https://agatcomp.ru/agat/Hardware/SoundNCL.shtml
