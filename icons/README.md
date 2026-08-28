# Icons

`agat-512.png` is the master; the other PNGs are derived from it.

| file | size | where it shows |
| --- | --- | --- |
| `agat-512.png` | 512×512 | the splash screen, and stores |
| `agat-192.png` | 192×192 | the Android install prompt |
| `agat-180.png` | 180×180 | iOS, from Add to Home Screen |
| `agat-maskable-512.png` | 512×512 | Android launchers, which crop it to their own shape |
| `favicon.svg` | any | the browser tab |

Ink `#fefefe` on `#14161a` — the page's `--bg`, and the manifest's
`background_color`. The PNGs are opaque to the edge, so the icon has no seam
where it meets the splash screen behind it.

The maskable one carries the same mark smaller: a launcher is allowed to crop
to a circle 80% of the width, and the whole lockup has to fit inside it.
