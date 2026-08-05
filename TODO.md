* Preserve game options in URL - Agat-7, 64k should be bookmarkable
* Sounds
* Trying to load Rise Out after Snake does not work. Needs a full powercycle option? As far as I remember there was shadow memory that you normally reads from ROM, but can be modified at run time, at least partially. That's how the reset vector is set. Maybe has to do with that, as a guess?
* Implement an .agc format - Agat Container, binary as base64, binary patches (if any), title, machine hardware, quirks. All as JSON.
* Keyboard remap (also make it a part of .agc). I.e. ^ to w for Rise Out
