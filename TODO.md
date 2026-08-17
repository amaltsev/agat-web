* Floppy write support on the 840K drive. The 140K one writes, and Save
  AGC keeps what it wrote as patches on the sector image; the 840K models
  no data-write register at all, and an `.aim` write would have to author
  the desync plane, which nothing here can check.
* Disk change support for writes. For when an editor is loaded from
  one disk, but the result wants to be written to another. For example
  to be able to actually edit some ASM code and save it. Maybe instead
  of overlays with patches we have now, we define more than one 'media'
  and it can be blank, with patches going over the blank media? Then the
  "system" boot disk can stay write protected (a flag in AGC), but the
  storage disk can then be changed to for work, replicating how it was
  done on device.
* Optimize URL parameters to only show the ones that override container
  defitions. Such that if AGC is running normally, only @agc= is present.
* Make UI scroll to top when one of software links is clicked
