# PS1 SPU import demos

Original synthetic VAB and PSF fixtures. These files contain no game code,
game samples or external recordings. Data and generator use BSD-3-Clause;
see [LICENSE](LICENSE).

Downloads:

- [VAB bank](spu-synth-demo.vab): two programs, three Tones.
- Split bank: select [demo.vh](demo.vh) and [demo.vb](demo.vb) together.
- [Standalone PSF](standalone.psf): two contiguous VAB banks.
- [MiniPSF demo ZIP](spu-psf-demo.zip): two banks, with primary and secondary library overlays.

In **SPU Synth**, open **PSF / VAB**. In **Playground**, select PS1 mode,
open **SPU**, and choose **Prepare audio**.
Open a VAB or VH + VB pair, choose a Tone, and load it to play.

For MiniPSF, extract the ZIP and use **Open PSF folder…** to select **Demo**.
Choose `track.minipsf`, then **Extract VAB banks**, a bank and Tone, and load
the Tone. Keep all three files and the `lib` subdirectory together.
Playground uses **Load Tone into Voice N**, then Hold / Sustain / Keyboard;
SPU Synth uses **Load selected Tone**, then the keyboard.

The unpacked [Demo/track.minipsf](Demo/track.minipsf),
[Demo/lib/Bank.psflib](Demo/lib/Bank.psflib) and
[Demo/patch.psflib](Demo/patch.psflib) are also provided.

These assets live outside `release/` and are automatically included under
`samples/spu-import/` in both Playground ZIPs. Deleting `release/` does not
delete them. The package builder regenerates the binary assets from the
original fixtures before copying samples.

From the repository root:

```sh
node scripts/build_spu_import_demos.mjs
node scripts/build_spu_import_demos.mjs --check
```
